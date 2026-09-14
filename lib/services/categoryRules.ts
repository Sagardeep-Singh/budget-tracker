import { prisma } from '@/lib/db/prisma';
import { ServiceValidationError } from '@/lib/services/common';
import { compileRuleMatcher } from '@/lib/services/categorize';
import { invalidRuleRegexError } from '@/lib/validators/category-rules';
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

export type ImportCategoryRulesResult = {
  imported: number;
  skipped: Array<{ matchText: string; reason: string }>;
};

/**
 * Lenient by design (decision 4 in the plan): a bad row is skipped with a
 * reason, not a reason to reject the whole file. Matches by category name
 * against the importing user's own existing categories — never creates a
 * category as a side effect. Skips a row whose (categoryId, matchText)
 * already exists, so re-running the same import is a no-op the second time.
 */
export const importCategoryRules = async (
  userId: string,
  rows: ImportedCategoryRule[],
): Promise<ImportCategoryRulesResult> => {
  const [categories, existingRules] = await Promise.all([
    prisma.category.findMany({ where: { userId }, select: { id: true, name: true } }),
    prisma.categoryRule.findMany({
      where: { userId },
      select: { categoryId: true, matchText: true },
    }),
  ]);
  const categoryIdByName = new Map(categories.map((c) => [c.name.toLowerCase(), c.id]));
  const existingKeys = new Set(existingRules.map((r) => `${r.categoryId}|${r.matchText}`));

  const toCreate: Array<{
    userId: string;
    categoryId: string;
    matchText: string;
    priority: number;
  }> = [];
  const skipped: Array<{ matchText: string; reason: string }> = [];

  for (const row of rows) {
    const regexError = invalidRuleRegexError(row.matchText);
    if (regexError) {
      skipped.push({ matchText: row.matchText, reason: regexError });
      continue;
    }
    const categoryId = categoryIdByName.get(row.categoryName.toLowerCase());
    if (!categoryId) {
      skipped.push({
        matchText: row.matchText,
        reason: `Category "${row.categoryName}" not found`,
      });
      continue;
    }
    const key = `${categoryId}|${row.matchText}`;
    if (existingKeys.has(key)) {
      skipped.push({ matchText: row.matchText, reason: 'Already exists' });
      continue;
    }
    existingKeys.add(key); // guard against duplicate rows within the same file
    toCreate.push({ userId, categoryId, matchText: row.matchText, priority: row.priority });
  }

  if (toCreate.length > 0) {
    await prisma.categoryRule.createMany({ data: toCreate });
  }

  return { imported: toCreate.length, skipped };
};
