import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    transaction: {
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
  it('counts only rows that are still in the Categorize queue for the user', async () => {
    prismaMock.transaction.count.mockResolvedValue(12);

    const result = await getNavCounts('user-1');

    expect(result).toEqual({ categorize: 12 });
    expect(prismaMock.transaction.count).toHaveBeenCalledTimes(1);
    expect(prismaMock.transaction.count).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        categoryId: null,
        skippedAt: null,
        isTransfer: false,
        isPayment: false,
      },
    });
  });

  it('returns zero when every uncategorized row is skipped or excluded', async () => {
    prismaMock.transaction.count.mockResolvedValue(0);

    expect(await getNavCounts('user-1')).toEqual({ categorize: 0 });
  });
});
