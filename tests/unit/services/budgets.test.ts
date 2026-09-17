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
    reimbursementLink: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock('@/lib/db/prisma', () => ({ prisma: prismaMock }));

const { listBudgets, createBudget } = await import('@/lib/services/budgets');
const { ServiceValidationError } = await import('@/lib/services/common');

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.reimbursementLink.findMany.mockResolvedValue([]);
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
    // a transfer leg isn't spending, even when it carries a category
    expect(prismaMock.transaction.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ isTransfer: false }),
      }),
    );
  });

  it('carries a budget forward into later months until a newer one overrides it', async () => {
    prismaMock.budget.findMany.mockResolvedValue([
      {
        id: 'b-newer',
        categoryId: 'cat-1',
        month: 202602,
        limitAmount: 250,
        category: { name: 'Groceries' },
      },
      {
        id: 'b-older',
        categoryId: 'cat-1',
        month: 202601,
        limitAmount: 200,
        category: { name: 'Groceries' },
      },
    ]);
    prismaMock.transaction.groupBy.mockResolvedValue([]);

    const result = await listBudgets('user-1', 202604);

    expect(result).toEqual([
      {
        id: 'b-newer',
        categoryId: 'cat-1',
        categoryName: 'Groceries',
        month: 202602,
        limitAmount: '250.00',
        spent: '0.00',
      },
    ]);
  });
});

describe('listBudgets reimbursement net-out', () => {
  it('subtracts the reimbursed amount from spend for that category', async () => {
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
      { categoryId: 'cat-1', _sum: { amount: 100 } },
    ]);
    prismaMock.reimbursementLink.findMany.mockResolvedValue([
      {
        amount: 40,
        expenseTransactionId: 'tx-1',
        expense: { categoryId: 'cat-1', date: new Date('2026-03-05') },
      },
    ]);

    const result = await listBudgets('user-1', 202603);

    expect(result[0].spent).toBe('60.00');
  });

  it('clamps spend at 0 when reimbursements exceed the gross spend', async () => {
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
      { categoryId: 'cat-1', _sum: { amount: 30 } },
    ]);
    prismaMock.reimbursementLink.findMany.mockResolvedValue([
      {
        amount: 50,
        expenseTransactionId: 'tx-1',
        expense: { categoryId: 'cat-1', date: new Date('2026-03-05') },
      },
    ]);

    const result = await listBudgets('user-1', 202603);

    expect(result[0].spent).toBe('0.00');
  });

  it('nets out by the expense date, independent of when the reimbursement was recorded', async () => {
    // listReimbursedAmountsByExpenseDate is itself scoped by [start, end) on the expense's
    // date — this mock only proves listBudgets applies whatever it returns, keyed by
    // categoryId, without re-deriving month scoping of its own.
    prismaMock.budget.findMany.mockResolvedValue([
      {
        id: 'b1',
        categoryId: 'cat-1',
        month: 202601,
        limitAmount: 200,
        category: { name: 'Groceries' },
      },
    ]);
    prismaMock.transaction.groupBy.mockResolvedValue([
      { categoryId: 'cat-1', _sum: { amount: 100 } },
    ]);
    prismaMock.reimbursementLink.findMany.mockResolvedValue([
      {
        amount: 20,
        expenseTransactionId: 'tx-1',
        expense: { categoryId: 'cat-1', date: new Date('2026-01-10') },
      },
    ]);

    const result = await listBudgets('user-1', 202601);

    expect(result[0].spent).toBe('80.00');
  });

  it('leaves spend unchanged for a category with no reimbursed amount', async () => {
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

    expect(result[0].spent).toBe('75.50');
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
