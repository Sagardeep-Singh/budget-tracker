import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    transaction: {
      count: vi.fn(),
    },
    budget: {
      count: vi.fn(),
    },
    account: {
      count: vi.fn(),
    },
    categoryRule: {
      count: vi.fn(),
    },
  },
}));

vi.mock('@/lib/db/prisma', () => ({ prisma: prismaMock }));

const { getNavCounts } = await import('@/lib/services/nav');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getNavCounts', () => {
  it('scopes every count to the given user', async () => {
    prismaMock.transaction.count.mockResolvedValueOnce(104).mockResolvedValueOnce(12);
    prismaMock.budget.count.mockResolvedValue(4);
    prismaMock.account.count.mockResolvedValue(2);
    prismaMock.categoryRule.count.mockResolvedValue(31);

    const result = await getNavCounts('user-1');

    expect(result).toEqual({
      transactions: 104,
      categorize: 12,
      budgets: 4,
      accounts: 2,
      rules: 31,
    });
    expect(prismaMock.transaction.count).toHaveBeenNthCalledWith(1, {
      where: { userId: 'user-1' },
    });
    expect(prismaMock.transaction.count).toHaveBeenNthCalledWith(2, {
      where: { userId: 'user-1', categoryId: null },
    });
  });
});
