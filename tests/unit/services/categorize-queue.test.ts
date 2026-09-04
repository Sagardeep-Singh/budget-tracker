import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    categoryRule: { findMany: vi.fn() },
    transaction: { findMany: vi.fn() },
  },
}));

vi.mock('@/lib/db/prisma', () => ({ prisma: prismaMock }));

const { getCategorizeQueue } = await import('@/lib/services/categorize');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getCategorizeQueue', () => {
  it('attaches the lowest-priority matching rule as a suggestion, and leaves unmatched rows without one', async () => {
    prismaMock.categoryRule.findMany.mockResolvedValue([
      {
        categoryId: 'cat-1',
        matchText: 'whole foods',
        priority: 0,
        category: { name: 'Groceries' },
      },
    ]);
    prismaMock.transaction.findMany.mockResolvedValue([
      {
        id: 't1',
        payee: 'Whole Foods #12',
        note: null,
        amount: 42.5,
        date: new Date('2026-03-05'),
        account: { name: 'Checking' },
      },
      {
        id: 't2',
        payee: 'Mystery Charge',
        note: null,
        amount: 10,
        date: new Date('2026-03-06'),
        account: { name: 'Checking' },
      },
    ]);

    const result = await getCategorizeQueue('user-1');

    expect(result).toEqual([
      {
        id: 't1',
        payee: 'Whole Foods #12',
        meta: 'Checking · 2026-03-05',
        amount: '42.50',
        suggestedCategoryId: 'cat-1',
        suggestedCategoryName: 'Groceries',
        why: 'A rule matches "whole foods" in this transaction.',
      },
      {
        id: 't2',
        payee: 'Mystery Charge',
        meta: 'Checking · 2026-03-06',
        amount: '10.00',
        suggestedCategoryId: null,
        suggestedCategoryName: null,
        why: null,
      },
    ]);
    expect(prismaMock.transaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1', categoryId: null } }),
    );
  });
});
