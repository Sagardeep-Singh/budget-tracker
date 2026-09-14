import { describe, expect, it } from 'vitest';
import {
  commitImportSchema,
  importFilenameSchema,
  importRowSchema,
  previewImportSchema,
} from '@/lib/validators/csv-import';
import { listImportBatchesQuerySchema } from '@/lib/validators/import-batches';

const rawRow = {
  accountId: 'acc-1',
  date: '2026-03-01',
  amount: 12,
  type: 'EXPENSE' as const,
};

const commitRow = {
  accountId: 'acc-1',
  date: new Date('2026-03-01'),
  amount: 12,
  type: 'EXPENSE' as const,
  include: true,
  duplicate: false,
};

describe('importFilenameSchema', () => {
  it('rejects an empty filename', () => {
    expect(importFilenameSchema.safeParse('').success).toBe(false);
    expect(importFilenameSchema.safeParse('   ').success).toBe(false);
  });

  it('rejects a filename longer than 255 characters', () => {
    expect(importFilenameSchema.safeParse('a'.repeat(256)).success).toBe(false);
    expect(importFilenameSchema.safeParse('a'.repeat(255)).success).toBe(true);
  });

  it('trims surrounding whitespace', () => {
    expect(importFilenameSchema.parse('  march.csv  ')).toBe('march.csv');
  });

  it('accepts a unicode filename', () => {
    expect(importFilenameSchema.parse('märz-café.csv')).toBe('märz-café.csv');
  });
});

describe('previewImportSchema', () => {
  it('requires accountId, filename and rows', () => {
    expect(previewImportSchema.safeParse({ rows: [rawRow] }).success).toBe(false);
    expect(previewImportSchema.safeParse({ accountId: 'acc-1', rows: [rawRow] }).success).toBe(
      false,
    );
    expect(
      previewImportSchema.safeParse({ accountId: 'acc-1', filename: 'march.csv', rows: [rawRow] })
        .success,
    ).toBe(true);
  });

  it('rejects an empty row list', () => {
    const parsed = previewImportSchema.safeParse({
      accountId: 'acc-1',
      filename: 'march.csv',
      rows: [],
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects more than 2000 rows', () => {
    const parsed = previewImportSchema.safeParse({
      accountId: 'acc-1',
      filename: 'march.csv',
      rows: Array.from({ length: 2001 }, () => rawRow),
    });
    expect(parsed.success).toBe(false);
  });
});

describe('importRowSchema', () => {
  it('defaults duplicate to false when the key is absent from the payload', () => {
    // Zod strips undeclared keys, so a legacy/malformed client payload must read
    // as "not flagged at preview" — never as a silent override.
    const parsed = importRowSchema.parse({
      accountId: 'acc-1',
      date: '2026-03-01',
      amount: 12,
      type: 'EXPENSE',
      include: true,
    });
    expect(parsed.duplicate).toBe(false);
  });

  it('keeps an explicit duplicate: true flag', () => {
    const parsed = importRowSchema.parse({ ...commitRow, duplicate: true });
    expect(parsed.duplicate).toBe(true);
  });
});

describe('commitImportSchema', () => {
  const base = { accountId: 'acc-1', filename: 'march.csv', rows: [commitRow] };

  it('defaults overrideDuplicateFilename to false when absent', () => {
    const parsed = commitImportSchema.parse(base);
    expect(parsed.overrideDuplicateFilename).toBe(false);
  });

  it('rejects a row belonging to a different account, with the error on rows', () => {
    const parsed = commitImportSchema.safeParse({
      ...base,
      rows: [commitRow, { ...commitRow, accountId: 'acc-2' }],
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0].path).toEqual(['rows']);
    }
  });

  it('accepts 2000 rows and rejects 2001', () => {
    const rows = (n: number): unknown[] => Array.from({ length: n }, () => commitRow);
    expect(commitImportSchema.safeParse({ ...base, rows: rows(2000) }).success).toBe(true);
    expect(commitImportSchema.safeParse({ ...base, rows: rows(2001) }).success).toBe(false);
  });
});

describe('listImportBatchesQuerySchema', () => {
  it('defaults limit to 25 when absent', () => {
    expect(listImportBatchesQuerySchema.parse({}).limit).toBe(25);
  });

  it('coerces a string limit to a number', () => {
    expect(listImportBatchesQuerySchema.parse({ limit: '10' }).limit).toBe(10);
  });

  it('rejects limits outside 1-100', () => {
    expect(listImportBatchesQuerySchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(listImportBatchesQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
    expect(listImportBatchesQuerySchema.safeParse({ limit: 100 }).success).toBe(true);
  });

  it('treats cursor as optional but rejects an empty string', () => {
    expect(listImportBatchesQuerySchema.parse({}).cursor).toBeUndefined();
    expect(listImportBatchesQuerySchema.safeParse({ cursor: '' }).success).toBe(false);
    expect(listImportBatchesQuerySchema.parse({ cursor: 'batch-1' }).cursor).toBe('batch-1');
  });
});
