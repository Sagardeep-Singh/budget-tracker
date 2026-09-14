import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { ServiceValidationError } from '@/lib/services/common';
import { compileRuleMatcher } from '@/lib/services/categorize';
import type {
  CreateCategoryRuleInput,
  UpdateCategoryRuleInput,
} from '@/lib/validators/category-rules';
import type {
  ExportedCategoryRule,
  ImportedCategoryRule,
} from '@/lib/validators/category-rule-transfer';

export type FrontendCategoryRule = {
  id: string;
  categoryId: string;
  categoryName: string;
  matchText: string;
  priority: number;
  /** Count of the user's current transactions this rule's match text and
   * category both agree with — an approximation of "applied", since a
   * transaction's category isn't tagged with which rule (if any) set it. */
  appliedCount: number;
};

const toFrontend = (
  rule: {
    id: string;
    categoryId: string;
    matchText: string;
    priority: number;
    category: { name: string };
  },
  appliedCount: number,
): FrontendCategoryRule => ({
  id: rule.id,
  categoryId: rule.categoryId,
  categoryName: rule.category.name,
  matchText: rule.matchText,
  priority: rule.priority,
  appliedCount,
});

export const listCategoryRules = async (userId: string): Promise<FrontendCategoryRule[]> => {
  const [rules, transactions] = await Promise.all([
    prisma.categoryRule.findMany({
      where: { userId },
      include: { category: { select: { name: true } } },
      orderBy: [{ priority: 'asc' }, { matchText: 'asc' }],
    }),
    prisma.transaction.findMany({
      where: { userId, categoryId: { not: null } },
      select: { categoryId: true, payee: true, note: true },
    }),
  ]);

  return rules.map((rule) => {
    const matcher = compileRuleMatcher(rule.matchText);
    const appliedCount = transactions.filter(
      (t) => t.categoryId === rule.categoryId && matcher.test(`${t.payee ?? ''} ${t.note ?? ''}`),
    ).length;
    return toFrontend(rule, appliedCount);
  });
};

export const createCategoryRule = async (
  userId: string,
  input: CreateCategoryRuleInput,
): Promise<FrontendCategoryRule> => {
  const category = await prisma.category.findFirst({
    where: { id: input.categoryId, userId },
  });
  if (!category) {
    throw new ServiceValidationError('Category not found');
  }

  const rule = await prisma.categoryRule.create({
    data: {
      userId,
      categoryId: input.categoryId,
      matchText: input.matchText,
      priority: input.priority,
    },
    include: { category: { select: { name: true } } },
  });
  return toFrontend(rule, 0);
};

export const updateCategoryRule = async (
  userId: string,
  ruleId: string,
  input: UpdateCategoryRuleInput,
): Promise<FrontendCategoryRule> => {
  const existing = await prisma.categoryRule.findFirst({ where: { id: ruleId, userId } });
  if (!existing) {
    throw new ServiceValidationError('Rule not found');
  }

  const rule = await prisma.categoryRule.update({
    where: { id: ruleId },
    data: input,
    include: { category: { select: { name: true } } },
  });
  return toFrontend(rule, 0);
};

export const deleteCategoryRule = async (userId: string, ruleId: string): Promise<void> => {
  const existing = await prisma.categoryRule.findFirst({ where: { id: ruleId, userId } });
  if (!existing) {
    throw new ServiceValidationError('Rule not found');
  }
  await prisma.categoryRule.delete({ where: { id: ruleId } });
};

/** categoryName, not categoryId — ids aren't portable across users/instances. */
export const exportCategoryRules = async (userId: string): Promise<ExportedCategoryRule[]> => {
  const rules = await prisma.categoryRule.findMany({
    where: { userId },
    include: { category: { select: { name: true } } },
    orderBy: [{ priority: 'asc' }, { matchText: 'asc' }],
  });
  return rules.map((rule) => ({
    matchText: rule.matchText,
    categoryName: rule.category.name,
    priority: rule.priority,
  }));
};

export type ImportRowStatus = 'ready' | 'skip' | 'will-create';

type ClassifiedImportRow = ImportedCategoryRule & {
  categoryId: string | null;
  newCategoryName: string | null;
  status: ImportRowStatus;
  reason?: string;
};

/**
 * Shared by preview (read-only) and commit: missing-category and
 * duplicate-row decisions are made once here so a row that's shown as
 * "will import" in the preview is classified the same way at commit time.
 * Dedup guards both against rows already in the DB and against duplicate
 * rows within the same uploaded file.
 *
 * `db` defaults to the singleton but accepts a transaction client so commit
 * can re-classify inside its own transaction, keeping the reads coherent with
 * the category/rule writes it performs.
 */
const classifyImportRows = async (
  userId: string,
  rows: ImportedCategoryRule[],
  db: Prisma.TransactionClient = prisma,
): Promise<ClassifiedImportRow[]> => {
  const [categories, existingRules] = await Promise.all([
    db.category.findMany({ where: { userId }, select: { id: true, name: true } }),
    db.categoryRule.findMany({
      where: { userId },
      select: { categoryId: true, matchText: true },
    }),
  ]);
  const categoryIdByName = new Map(categories.map((c) => [c.name.toLowerCase(), c.id]));
  const existingKeys = new Set(existingRules.map((r) => `${r.categoryId}|${r.matchText}`));
  /** First-occurrence casing wins for a category that doesn't exist yet. */
  const pendingNameByLower = new Map<string, string>();

  return rows.map((row) => {
    const lowerName = row.categoryName.toLowerCase();
    const categoryId = categoryIdByName.get(lowerName);
    if (!categoryId) {
      // No such category yet: opt-in creation, surfaced per row in the
      // preview so nothing is created behind the user's back.
      const newCategoryName = pendingNameByLower.get(lowerName) ?? row.categoryName;
      pendingNameByLower.set(lowerName, newCategoryName);
      // Keyed on the name, not an id — there is no id to key on yet.
      const pendingKey = `${lowerName}|${row.matchText}`;
      if (existingKeys.has(pendingKey)) {
        return {
          ...row,
          categoryId: null,
          newCategoryName: null,
          status: 'skip',
          reason: 'Already exists',
        };
      }
      existingKeys.add(pendingKey);
      return { ...row, categoryId: null, newCategoryName, status: 'will-create' };
    }
    const key = `${categoryId}|${row.matchText}`;
    if (existingKeys.has(key)) {
      return {
        ...row,
        categoryId,
        newCategoryName: null,
        status: 'skip',
        reason: 'Already exists',
      };
    }
    existingKeys.add(key); // guard against duplicate rows within the same file
    return { ...row, categoryId, newCategoryName: null, status: 'ready' };
  });
};

export type ImportPreviewRow = {
  matchText: string;
  categoryName: string;
  priority: number;
  status: ImportRowStatus;
  reason?: string;
  /** Present iff `status === 'will-create'`: the canonical casing to create. */
  newCategoryName?: string;
};

/**
 * Read-only classification for the import confirmation step: lets the UI
 * show what each row will do before anything is written, so the user can
 * deselect any row (not just skipped ones) before committing.
 */
export const previewCategoryRuleImport = async (
  userId: string,
  rows: ImportedCategoryRule[],
): Promise<ImportPreviewRow[]> => {
  const classified = await classifyImportRows(userId, rows);
  return classified.map(
    ({ matchText, categoryName, priority, status, reason, newCategoryName }) => ({
      matchText,
      categoryName,
      priority,
      status,
      reason,
      newCategoryName: newCategoryName ?? undefined,
    }),
  );
};

export type ImportCategoryRulesResult = {
  imported: number;
  skipped: Array<{ matchText: string; reason: string }>;
  /** Canonical names of the categories this commit created, deduped. */
  createdCategories: string[];
};

/**
 * Lenient by design (decision 4 in the plan): a bad row is skipped with a
 * reason, not a reason to reject the whole file. Re-classifies at write
 * time rather than trusting the caller's preview — the DB state (existing
 * rules, categories) may have changed between preview and confirm, and a
 * category referenced as `will-create` at preview time may exist by now
 * (created out-of-band, or by an earlier row of this same commit), in which
 * case it resolves to an id and is never created twice.
 *
 * Everything runs in one transaction, including the classification reads: the
 * rule-level dedupe has no DB unique constraint, so the reads have to be
 * coherent with the writes, and a created category must not survive a failed
 * rule insert.
 */
export const importCategoryRules = async (
  userId: string,
  rows: ImportedCategoryRule[],
): Promise<ImportCategoryRulesResult> =>
  prisma.$transaction(async (tx) => {
    const classified = await classifyImportRows(userId, rows, tx);

    const namesToCreate: string[] = [];
    const seenLower = new Set<string>();
    for (const row of classified) {
      if (row.status !== 'will-create' || !row.newCategoryName) continue;
      const lower = row.newCategoryName.toLowerCase();
      if (seenLower.has(lower)) continue;
      seenLower.add(lower);
      namesToCreate.push(row.newCategoryName);
    }

    const createdIdByName = new Map<string, string>();
    if (namesToCreate.length > 0) {
      // `createCategory` in lib/services/categories.ts is the wrong shape here:
      // it throws on duplicates and takes no transaction client. `skipDuplicates`
      // covers the narrow race where a concurrent transaction created the same
      // name since this transaction's classification read.
      await tx.category.createMany({
        data: namesToCreate.map((name) => ({ userId, name, isDefault: false })),
        skipDuplicates: true,
      });
      // `createMany` returns no rows, so ids have to be read back.
      const created = await tx.category.findMany({
        where: { userId, name: { in: namesToCreate } },
        select: { id: true, name: true },
      });
      for (const category of created) {
        createdIdByName.set(category.name.toLowerCase(), category.id);
      }
    }

    const toCreate = classified
      .filter((r) => r.status === 'ready' || r.status === 'will-create')
      .map((r) => ({
        userId,
        categoryId:
          r.status === 'ready'
            ? (r.categoryId as string)
            : (createdIdByName.get((r.newCategoryName as string).toLowerCase()) as string),
        matchText: r.matchText,
        priority: r.priority,
      }));
    const skipped = classified
      .filter((r) => r.status === 'skip')
      .map((r) => ({ matchText: r.matchText, reason: r.reason as string }));

    if (toCreate.length > 0) {
      await tx.categoryRule.createMany({ data: toCreate });
    }

    return { imported: toCreate.length, skipped, createdCategories: namesToCreate };
  });
