import { prisma } from '@/lib/db/prisma';
import { DuplicateFilenameError, ServiceValidationError } from '@/lib/services/common';
import { matchCategoryRule } from '@/lib/services/categorize';
import {
  findActiveBatchByFilename,
  normalizeFilename,
  type FrontendImportBatch,
} from '@/lib/services/importBatches';
import type {
  CommitImportInput,
  ImportRowInput,
  PreviewImportInput,
} from '@/lib/validators/csv-import';

export type PreviewRow = ImportRowInput & { categoryName: string | null };

export type FilenameWarning = {
  /** the matched active batch, so the client can name it */
  batch: FrontendImportBatch;
  /** this file's submitted row count */
  submittedRowCount: number;
  /** decision 5: compare submitted row counts, not post-dedupe ones */
  rowCountMatches: boolean;
  dateRangeMatches: boolean;
};

export type PreviewResult = {
  rows: PreviewRow[];
  filenameWarning: FilenameWarning | null;
};

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

/** min/max transaction date across a set of rows, used for the batch's date range */
const dateRange = (dates: Date[]): { dateFrom: Date; dateTo: Date } => {
  const times = dates.map((d) => d.getTime());
  return { dateFrom: new Date(Math.min(...times)), dateTo: new Date(Math.max(...times)) };
};

export const previewImport = async (
  userId: string,
  input: PreviewImportInput,
): Promise<PreviewResult> => {
  const [rules, categories, existingKeys, conflict] = await Promise.all([
    prisma.categoryRule.findMany({
      where: { userId },
      select: { categoryId: true, matchText: true, priority: true },
    }),
    prisma.category.findMany({ where: { userId }, select: { id: true, name: true } }),
    loadExistingKeys(userId),
    findActiveBatchByFilename(userId, input.accountId, input.filename),
  ]);

  const categoryNames = new Map(categories.map((c) => [c.id, c.name]));
  const seenInBatch = new Set<string>();

  const rows = input.rows.map((row) => {
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

  // Advisory only (story 2): the warning never excludes or mutates a row.
  let filenameWarning: FilenameWarning | null = null;
  if (conflict) {
    const { dateFrom, dateTo } = dateRange(rows.map((r) => r.date));
    filenameWarning = {
      batch: conflict,
      submittedRowCount: rows.length,
      rowCountMatches: rows.length === conflict.rowCount,
      dateRangeMatches:
        dateFrom.toISOString() === conflict.dateFrom && dateTo.toISOString() === conflict.dateTo,
    };
  }

  return { rows, filenameWarning };
};

export const commitImport = async (
  userId: string,
  input: CommitImportInput,
): Promise<{ batchId: string | null; imported: number; skippedDuplicates: number }> => {
  const account = await prisma.account.findFirst({
    where: { id: input.accountId, userId },
    select: { id: true },
  });
  if (!account) {
    throw new ServiceValidationError('Account not found');
  }

  // Ordering is normative: the filename gate runs *before* row-level dedupe and
  // before the zero-row early return. Re-importing an identical file makes every
  // row a row-level duplicate, which would otherwise return `imported: 0` and never
  // surface the conflict at all.
  const conflict = await findActiveBatchByFilename(userId, input.accountId, input.filename);
  if (conflict && !input.overrideDuplicateFilename) {
    throw new DuplicateFilenameError(
      `"${conflict.filename}" was already imported into this account`,
      conflict,
    );
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
    if (row.duplicate) {
      // flagged as a duplicate at preview and still included: an explicit user
      // override (story 2a), so neither key check applies. Still seeded into
      // `seenInBatch` so a later non-flagged row with this key dedupes.
      seenInBatch.add(key);
      return true;
    }
    // not flagged at preview but matching now: stale preview / double submit.
    // Unchanged protection.
    if (existingKeys.has(key) || seenInBatch.has(key)) return false;
    seenInBatch.add(key);
    return true;
  });
  const skippedDuplicates = requested.length - rowsToImport.length;

  if (rowsToImport.length === 0) {
    // no batch created, so no filename is reserved (story 1)
    return { batchId: null, imported: 0, skippedDuplicates };
  }

  // metrics span every *submitted* row, including excluded ones, so the preview
  // comparison against a prior batch is like-for-like (decision 5)
  const { dateFrom, dateTo } = dateRange(input.rows.map((r) => r.date));

  const { batchId, imported } = await prisma.$transaction(async (tx) => {
    // batch first: the transactions' foreign key requires it to exist
    const batch = await tx.importBatch.create({
      data: {
        userId,
        accountId: input.accountId,
        filename: input.filename,
        filenameNormalized: normalizeFilename(input.filename),
        rowCount: input.rows.length,
        importedCount: rowsToImport.length,
        skippedDuplicates,
        dateFrom,
        dateTo,
      },
    });
    const created = await tx.transaction.createMany({
      data: rowsToImport.map((row) => ({
        userId,
        accountId: row.accountId,
        categoryId: row.categoryId ?? null,
        amount: Math.abs(row.amount),
        type: row.type,
        date: row.date,
        payee: row.payee,
        note: row.note,
        importBatchId: batch.id,
      })),
    });
    return { batchId: batch.id, imported: created.count };
  });

  return { batchId, imported, skippedDuplicates };
};
