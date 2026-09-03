import { randomUUID } from 'crypto';
import { prisma } from '@/lib/db/prisma';
import { ServiceValidationError } from '@/lib/services/common';
import { matchCategoryRule } from '@/lib/services/categorize';
import type { CommitImportInput, ImportRowInput } from '@/lib/validators/csv-import';

export type PreviewRow = ImportRowInput & { categoryName: string | null; duplicate: boolean };

export type RawImportRow = {
  accountId: string;
  date: string;
  amount: number;
  type: 'INCOME' | 'EXPENSE';
  payee?: string;
  note?: string;
};

const duplicateKey = (row: {
  accountId: string;
  date: Date | string;
  amount: number;
  payee?: string | null;
}): string => {
  const isoDate = typeof row.date === 'string' ? row.date : row.date.toISOString();
  return `${row.accountId}|${isoDate.slice(0, 10)}|${row.amount.toFixed(2)}|${row.payee ?? ''}`;
};

const loadExistingKeys = async (userId: string): Promise<Set<string>> => {
  const existing = await prisma.transaction.findMany({
    where: { userId },
    select: { accountId: true, date: true, amount: true, payee: true },
  });
  return new Set(
    existing.map((t) => duplicateKey({ ...t, date: t.date, amount: Number(t.amount) })),
  );
};

export const previewImport = async (
  userId: string,
  rawRows: RawImportRow[],
): Promise<PreviewRow[]> => {
  const [rules, categories, existingKeys] = await Promise.all([
    prisma.categoryRule.findMany({
      where: { userId },
      select: { categoryId: true, matchText: true, priority: true },
    }),
    prisma.category.findMany({ where: { userId }, select: { id: true, name: true } }),
    loadExistingKeys(userId),
  ]);

  const categoryNames = new Map(categories.map((c) => [c.id, c.name]));
  const seenInBatch = new Set<string>();

  return rawRows.map((row) => {
    const text = `${row.payee ?? ''} ${row.note ?? ''}`;
    const categoryId = matchCategoryRule(rules, text);
    const key = duplicateKey(row);
    // flag against existing DB rows, and against an earlier row in this same
    // file (two identical CSV rows shouldn't both import silently)
    const duplicate = existingKeys.has(key) || seenInBatch.has(key);
    seenInBatch.add(key);

    return {
      accountId: row.accountId,
      date: new Date(row.date),
      amount: row.amount,
      type: row.type,
      payee: row.payee,
      note: row.note,
      categoryId,
      categoryName: categoryId ? (categoryNames.get(categoryId) ?? null) : null,
      include: !duplicate,
      duplicate,
    };
  });
};

export const commitImport = async (
  userId: string,
  input: CommitImportInput,
): Promise<{ imported: number; skippedDuplicates: number }> => {
  const accountIds = [...new Set(input.rows.map((r) => r.accountId))];
  const accounts = await prisma.account.findMany({
    where: { id: { in: accountIds }, userId },
    select: { id: true },
  });
  if (accounts.length !== accountIds.length) {
    throw new ServiceValidationError('One or more accounts are invalid');
  }

  // Re-check against the database at commit time, not just whatever the
  // client's preview said: the preview snapshot goes stale the moment a
  // commit happens (e.g. a resubmitted/duplicated request), so trusting the
  // client-supplied `include` flag alone would let already-imported rows
  // back in.
  const existingKeys = await loadExistingKeys(userId);
  const requested = input.rows.filter((r) => r.include);
  const seenInBatch = new Set<string>();
  const rowsToImport = requested.filter((row) => {
    const key = duplicateKey(row);
    if (existingKeys.has(key) || seenInBatch.has(key)) return false;
    seenInBatch.add(key);
    return true;
  });
  const skippedDuplicates = requested.length - rowsToImport.length;

  if (rowsToImport.length === 0) {
    return { imported: 0, skippedDuplicates };
  }

  const importBatchId = randomUUID();
  const result = await prisma.transaction.createMany({
    data: rowsToImport.map((row) => ({
      userId,
      accountId: row.accountId,
      categoryId: row.categoryId ?? null,
      amount: Math.abs(row.amount),
      type: row.type,
      date: row.date,
      payee: row.payee,
      note: row.note,
      importBatchId,
    })),
  });

  return { imported: result.count, skippedDuplicates };
};
