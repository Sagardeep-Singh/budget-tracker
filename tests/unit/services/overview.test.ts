import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    budget: { findMany: vi.fn() },
    transaction: { groupBy: vi.fn(), findMany: vi.fn() },
    account: { findFirst: vi.fn() },
    categoryRule: { findMany: vi.fn() },
  },
}));

vi.mock('@/lib/db/prisma', () => ({ prisma: prismaMock }));

const { getOverviewData } = await import('@/lib/services/overview');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getOverviewData', () => {
  it('computes hero fraction, day bars, and triage stats for a month with no credit card', async () => {
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
      { categoryId: 'cat-1', _sum: { amount: 150 } },
    ]);
    prismaMock.account.findFirst.mockResolvedValue(null);

    const monthTransactions = [
      {
        id: 't1',
        type: 'EXPENSE',
        amount: 150,
        date: new Date(Date.UTC(2026, 2, 5)),
        isPayment: false,
        payee: 'Store',
        category: { name: 'Groceries' },
      },
      {
        id: 't2',
        type: 'INCOME',
        amount: 500,
        date: new Date(Date.UTC(2026, 2, 5)),
        isPayment: false,
        payee: 'Payroll',
        category: null,
      },
    ];
    prismaMock.transaction.findMany
      .mockResolvedValueOnce(monthTransactions) // month-scoped query
      .mockResolvedValueOnce([{ payee: 'Uncategorized Co', note: null }]); // triage: uncategorized
    prismaMock.categoryRule.findMany.mockResolvedValue([]);

    const result = await getOverviewData('user-1', { month: 202603, day: 5 });

    expect(result.hero.usedFraction).toBeCloseTo(0.75);
    expect(result.hero.leftLabel).toBe('Left to spend');
    expect(result.hero.leftAmount).toBe('50.00');
    expect(result.hero.income).toBe('500.00');
    expect(result.hero.expense).toBe('150.00');

    const day5 = result.dayBars.find((d) => d.day === 5);
    expect(day5).toEqual({ day: 5, income: 500, expense: 150 });

    expect(result.selectedDay.day).toBe(5);
    expect(result.selectedDay.spent).toBe('150.00');
    expect(result.selectedDay.rows).toHaveLength(2);

    expect(result.triage).toEqual({ total: 1, matched: 0 });
    expect(result.cycleCard).toBeNull();
  });
});
