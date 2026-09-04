import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    categoryRule: { findMany: vi.fn() },
    transaction: { findMany: vi.fn() },
  },
}));

vi.mock('@/lib/db/prisma', () => ({ prisma: prismaMock }));

const { listCategoryRules } = await import('@/lib/services/categoryRules');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('listCategoryRules', () => {
  it('counts current transactions whose category and text both match the rule', async () => {
    prismaMock.categoryRule.findMany.mockResolvedValue([
      {
        id: 'r1',
        categoryId: 'cat-1',
        matchText: 'whole foods',
        priority: 0,
        category: { name: 'Groceries' },
      },
    ]);
    prismaMock.transaction.findMany.mockResolvedValue([
      { categoryId: 'cat-1', payee: 'Whole Foods #1', note: null },
      { categoryId: 'cat-1', payee: 'Whole Foods #2', note: null },
      // right category, but text doesn't match the rule — not counted
      { categoryId: 'cat-1', payee: 'Rent', note: null },
      // text matches, but a different category — not counted (user recategorized it)
      { categoryId: 'cat-2', payee: 'Whole Foods #3', note: null },
    ]);

    const result = await listCategoryRules('user-1');

    expect(result).toEqual([
      {
        id: 'r1',
        categoryId: 'cat-1',
        categoryName: 'Groceries',
        matchText: 'whole foods',
        priority: 0,
        appliedCount: 2,
      },
    ]);
  });
});
