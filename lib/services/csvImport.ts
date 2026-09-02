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

export const previewImport = async (
  userId: string,
  rawRows: RawImportRow[],
): Promise<PreviewRow[]> => {
  const [rules, categories, existing] = await Promise.all([
    prisma.categoryRule.findMany({
      where: { userId },
      select: { categoryId: true, matchText: true, priority: true },
    }),
    prisma.category.findMany({ where: { userId }, select: { id: true, name: true } }),
    prisma.transaction.findMany({
      where: { userId },
      select: { accountId: true, date: true, amount: true, payee: true },
    }),
  ]);

  const categoryNames = new Map(categories.map((c) => [c.id, c.name]));
  const existingKeys = new Set(
    existing.map(
      (t) =>
        `${t.accountId}|${t.date.toISOString().slice(0, 10)}|${Number(t.amount).toFixed(2)}|${t.payee ?? ''}`,
    ),
  );

  return rawRows.map((row) => {
    const text = `${row.payee ?? ''} ${row.note ?? ''}`;
    const categoryId = matchCategoryRule(rules, text);
    const key = `${row.accountId}|${row.date.slice(0, 10)}|${row.amount.toFixed(2)}|${row.payee ?? ''}`;

    return {
      accountId: row.accountId,
      date: new Date(row.date),
      amount: row.amount,
      type: row.type,
      payee: row.payee,
      note: row.note,
      categoryId,
      categoryName: categoryId ? (categoryNames.get(categoryId) ?? null) : null,
      include: !existingKeys.has(key),
      duplicate: existingKeys.has(key),
    };
  });
};

export const commitImport = async (
  userId: string,
  input: CommitImportInput,
): Promise<{ imported: number }> => {
  const accountIds = [...new Set(input.rows.map((r) => r.accountId))];
  const accounts = await prisma.account.findMany({
    where: { id: { in: accountIds }, userId },
    select: { id: true },
  });
  if (accounts.length !== accountIds.length) {
    throw new ServiceValidationError('One or more accounts are invalid');
  }

  const rowsToImport = input.rows.filter((r) => r.include);
  if (rowsToImport.length === 0) {
    return { imported: 0 };
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

  return { imported: result.count };
};
