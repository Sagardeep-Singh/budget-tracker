import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    budget: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    transaction: {
      groupBy: vi.fn(),
    },
    category: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock('@/lib/db/prisma', () => ({ prisma: prismaMock }));

const { listBudgets, createBudget } = await import('@/lib/services/budgets');
const { ServiceValidationError } = await import('@/lib/services/common');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('listBudgets', () => {
  it('pairs each budget with expense spend for that category and month', async () => {
    prismaMock.budget.findMany.mockResolvedValue([
      {
        id: 'b1',
        categoryId: 'cat-1',
        month: 202603,
        limitAmount: 200,
        category: { name: 'Groceries' },
      },
    ]);
    prismaMock.transaction.groupBy.mockResolvedValue([
      { categoryId: 'cat-1', _sum: { amount: 75.5 } },
    ]);

    const result = await listBudgets('user-1', 202603);

    expect(result).toEqual([
      {
        id: 'b1',
        categoryId: 'cat-1',
        categoryName: 'Groceries',
        month: 202603,
        limitAmount: '200.00',
        spent: '75.50',
      },
    ]);
  });
});

describe('createBudget', () => {
  it('rejects a duplicate budget for the same category and month', async () => {
    prismaMock.category.findFirst.mockResolvedValue({ id: 'cat-1', name: 'Groceries' });
    prismaMock.budget.findFirst.mockResolvedValue({ id: 'existing' });

    await expect(
      createBudget('user-1', { categoryId: 'cat-1', month: 202603, limitAmount: 100 }),
    ).rejects.toThrow(ServiceValidationError);
    expect(prismaMock.budget.create).not.toHaveBeenCalled();
  });
});
