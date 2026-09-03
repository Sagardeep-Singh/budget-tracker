import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    categoryRule: { findMany: vi.fn() },
    category: { findMany: vi.fn() },
    transaction: { findMany: vi.fn(), createMany: vi.fn() },
    account: { findMany: vi.fn() },
  },
}));

vi.mock('@/lib/db/prisma', () => ({ prisma: prismaMock }));

const { previewImport, commitImport } = await import('@/lib/services/csvImport');
const { ServiceValidationError } = await import('@/lib/services/common');

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.transaction.findMany.mockResolvedValue([]);
});

describe('previewImport', () => {
  it('flags a row as a duplicate when an identical transaction already exists', async () => {
    prismaMock.categoryRule.findMany.mockResolvedValue([]);
    prismaMock.category.findMany.mockResolvedValue([]);
    prismaMock.transaction.findMany.mockResolvedValue([
      { accountId: 'acc-1', date: new Date('2026-03-01'), amount: 42, payee: 'Coffee Shop' },
    ]);

    const result = await previewImport('user-1', [
      {
        accountId: 'acc-1',
        date: '2026-03-01',
        amount: 42,
        type: 'EXPENSE',
        payee: 'Coffee Shop',
      },
    ]);

    expect(result[0].duplicate).toBe(true);
    expect(result[0].include).toBe(false);
  });

  it('flags the second of two identical rows within the same file as a duplicate', async () => {
    prismaMock.categoryRule.findMany.mockResolvedValue([]);
    prismaMock.category.findMany.mockResolvedValue([]);

    const row = {
      accountId: 'acc-1',
      date: '2026-03-01',
      amount: 42,
      type: 'EXPENSE' as const,
      payee: 'Coffee Shop',
    };
    const result = await previewImport('user-1', [row, { ...row }]);

    expect(result[0].duplicate).toBe(false);
    expect(result[0].include).toBe(true);
    expect(result[1].duplicate).toBe(true);
    expect(result[1].include).toBe(false);
  });

  it('suggests a category from matching rules and includes non-duplicate rows', async () => {
    prismaMock.categoryRule.findMany.mockResolvedValue([
      { categoryId: 'cat-1', matchText: 'coffee', priority: 0 },
    ]);
    prismaMock.category.findMany.mockResolvedValue([{ id: 'cat-1', name: 'Dining' }]);

    const result = await previewImport('user-1', [
      {
        accountId: 'acc-1',
        date: '2026-03-02',
        amount: 10,
        type: 'EXPENSE',
        payee: 'Coffee Shop',
      },
    ]);

    expect(result[0].categoryId).toBe('cat-1');
    expect(result[0].categoryName).toBe('Dining');
    expect(result[0].include).toBe(true);
  });
});

describe('commitImport', () => {
  it('rejects when a row references an account the user does not own', async () => {
    prismaMock.account.findMany.mockResolvedValue([]);

    await expect(
      commitImport('user-1', {
        rows: [
          {
            accountId: 'acc-missing',
            date: new Date(),
            amount: 10,
            type: 'EXPENSE',
            include: true,
          },
        ],
      }),
    ).rejects.toThrow(ServiceValidationError);
  });

  it('only creates transactions for rows marked include', async () => {
    prismaMock.account.findMany.mockResolvedValue([{ id: 'acc-1' }]);
    prismaMock.transaction.createMany.mockResolvedValue({ count: 1 });

    const result = await commitImport('user-1', {
      rows: [
        { accountId: 'acc-1', date: new Date(), amount: 10, type: 'EXPENSE', include: true },
        { accountId: 'acc-1', date: new Date(), amount: 5, type: 'EXPENSE', include: false },
      ],
    });

    expect(prismaMock.transaction.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.arrayContaining([expect.anything()]) }),
    );
    expect(prismaMock.transaction.createMany.mock.calls[0][0].data).toHaveLength(1);
    expect(result).toEqual({ imported: 1, skippedDuplicates: 0 });
  });

  it('re-checks against the database and skips rows that already exist, even if included', async () => {
    prismaMock.account.findMany.mockResolvedValue([{ id: 'acc-1' }]);
    prismaMock.transaction.findMany.mockResolvedValue([
      { accountId: 'acc-1', date: new Date('2026-03-01'), amount: 42, payee: 'Coffee Shop' },
    ]);
    prismaMock.transaction.createMany.mockResolvedValue({ count: 0 });

    const result = await commitImport('user-1', {
      rows: [
        {
          accountId: 'acc-1',
          date: new Date('2026-03-01'),
          amount: 42,
          type: 'EXPENSE',
          payee: 'Coffee Shop',
          include: true,
        },
      ],
    });

    // simulates a resubmitted/stale preview: the row looks includable to the
    // client, but a matching transaction already landed in the database
    expect(prismaMock.transaction.createMany).not.toHaveBeenCalled();
    expect(result).toEqual({ imported: 0, skippedDuplicates: 1 });
  });

  it('skips a second identical row within the same commit batch', async () => {
    prismaMock.account.findMany.mockResolvedValue([{ id: 'acc-1' }]);
    prismaMock.transaction.createMany.mockResolvedValue({ count: 1 });

    const row = {
      accountId: 'acc-1',
      date: new Date('2026-03-01'),
      amount: 42,
      type: 'EXPENSE' as const,
      payee: 'Coffee Shop',
      include: true,
    };
    const result = await commitImport('user-1', { rows: [row, { ...row }] });

    expect(prismaMock.transaction.createMany.mock.calls[0][0].data).toHaveLength(1);
    expect(result).toEqual({ imported: 1, skippedDuplicates: 1 });
  });
});
