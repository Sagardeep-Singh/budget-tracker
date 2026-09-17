import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    budget: { findMany: vi.fn() },
    transaction: { groupBy: vi.fn(), findMany: vi.fn() },
    account: { findFirst: vi.fn() },
    categoryRule: { findMany: vi.fn() },
    reimbursementLink: { findMany: vi.fn() },
  },
}));

vi.mock('@/lib/db/prisma', () => ({ prisma: prismaMock }));

const { getOverviewData } = await import('@/lib/services/overview');

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.reimbursementLink.findMany.mockResolvedValue([]);
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
        _count: { reimbursementIncomeLinks: 0 },
        payee: 'Store',
        category: { name: 'Groceries' },
      },
      {
        id: 't2',
        type: 'INCOME',
        amount: 500,
        date: new Date(Date.UTC(2026, 2, 5)),
        isPayment: false,
        _count: { reimbursementIncomeLinks: 0 },
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
    expect(result.hero.hasBudget).toBe(true);
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

  it('flags hasBudget false when no budget exists, instead of a misleading $0.00', async () => {
    prismaMock.budget.findMany.mockResolvedValue([]);
    prismaMock.transaction.groupBy.mockResolvedValue([]);
    prismaMock.account.findFirst.mockResolvedValue(null);
    prismaMock.transaction.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    prismaMock.categoryRule.findMany.mockResolvedValue([]);

    const result = await getOverviewData('user-1', { month: 202603 });

    expect(result.hero.hasBudget).toBe(false);
    expect(result.hero.leftAmount).toBe('0.00');
  });

  it('breaks down every expense by category, including unbudgeted, uncategorized, and excluding transfers', async () => {
    prismaMock.budget.findMany.mockResolvedValue([]);
    prismaMock.transaction.groupBy.mockResolvedValue([]);
    prismaMock.account.findFirst.mockResolvedValue(null);
    prismaMock.transaction.findMany
      .mockResolvedValueOnce([
        {
          id: 't1',
          type: 'EXPENSE',
          amount: 100,
          date: new Date(Date.UTC(2026, 2, 5)),
          isPayment: false,
          _count: { reimbursementIncomeLinks: 0 },
          isTransfer: false,
          payee: 'Store',
          categoryId: 'cat-1',
          category: { name: 'Groceries' },
        },
        {
          id: 't2',
          type: 'EXPENSE',
          amount: 40,
          date: new Date(Date.UTC(2026, 2, 6)),
          isPayment: false,
          _count: { reimbursementIncomeLinks: 0 },
          isTransfer: false,
          payee: 'Unknown',
          categoryId: null,
          category: null,
        },
        {
          id: 't3',
          type: 'INCOME',
          amount: 500,
          date: new Date(Date.UTC(2026, 2, 5)),
          isPayment: false,
          _count: { reimbursementIncomeLinks: 0 },
          isTransfer: false,
          payee: 'Payroll',
          categoryId: null,
          category: null,
        },
        {
          // a transfer leg carrying a category shouldn't count as spending in
          // this category, even though it's typed EXPENSE
          id: 't4',
          type: 'EXPENSE',
          amount: 250,
          date: new Date(Date.UTC(2026, 2, 7)),
          isPayment: false,
          _count: { reimbursementIncomeLinks: 0 },
          isTransfer: true,
          payee: 'Payment to Visa',
          categoryId: 'cat-1',
          category: { name: 'Groceries' },
        },
      ])
      .mockResolvedValueOnce([]);
    prismaMock.categoryRule.findMany.mockResolvedValue([]);

    const result = await getOverviewData('user-1', { month: 202603 });

    expect(result.expenseBreakdown).toEqual([
      { categoryId: 'cat-1', categoryName: 'Groceries', amount: '100.00', fraction: 100 / 140 },
      { categoryId: null, categoryName: 'Uncategorized', amount: '40.00', fraction: 40 / 140 },
    ]);
  });

  it('keeps both legs of a transfer out of income, expense, day bars and day spend', async () => {
    prismaMock.budget.findMany.mockResolvedValue([
      {
        id: 'b1',
        categoryId: 'cat-1',
        month: 202603,
        limitAmount: 300,
        category: { name: 'Groceries' },
      },
    ]);
    prismaMock.transaction.groupBy.mockResolvedValue([
      { categoryId: 'cat-1', _sum: { amount: 60 } },
    ]);
    prismaMock.account.findFirst.mockResolvedValue(null);

    prismaMock.transaction.findMany
      .mockResolvedValueOnce([
        {
          id: 't1',
          type: 'EXPENSE',
          amount: 60,
          date: new Date(Date.UTC(2026, 2, 5)),
          isPayment: false,
          _count: { reimbursementIncomeLinks: 0 },
          isTransfer: false,
          payee: 'Store',
          category: { name: 'Groceries' },
        },
        {
          id: 't2',
          type: 'EXPENSE',
          amount: 400,
          date: new Date(Date.UTC(2026, 2, 5)),
          isPayment: false,
          _count: { reimbursementIncomeLinks: 0 },
          isTransfer: true,
          payee: 'Payment to Visa',
          category: null,
        },
        {
          // isPayment: false on purpose — the income leg of a checking ->
          // savings transfer has no isPayment fallback, so this asserts the
          // isTransfer gate itself
          id: 't3',
          type: 'INCOME',
          amount: 400,
          date: new Date(Date.UTC(2026, 2, 6)),
          isPayment: false,
          _count: { reimbursementIncomeLinks: 0 },
          isTransfer: true,
          payee: 'Transfer in',
          category: null,
        },
      ])
      .mockResolvedValueOnce([]);
    prismaMock.categoryRule.findMany.mockResolvedValue([]);

    const result = await getOverviewData('user-1', { month: 202603, day: 5 });

    expect(result.hero.expense).toBe('60.00');
    expect(result.hero.income).toBe('0.00');
    expect(result.dayBars.find((d) => d.day === 5)).toEqual({ day: 5, income: 0, expense: 60 });
    expect(result.dayBars.find((d) => d.day === 6)).toEqual({ day: 6, income: 0, expense: 0 });
    expect(result.selectedDay.spent).toBe('60.00');
    // transfers stay visible in the ledger — they're real transactions, just
    // not spending
    expect(result.selectedDay.rows.map((r) => r.id)).toEqual(['t1', 't2']);
  });

  it('excludes an income transaction with an active reimbursement link from income totals', async () => {
    prismaMock.budget.findMany.mockResolvedValue([]);
    prismaMock.transaction.groupBy.mockResolvedValue([]);
    prismaMock.account.findFirst.mockResolvedValue(null);
    prismaMock.transaction.findMany
      .mockResolvedValueOnce([
        {
          id: 't1',
          type: 'INCOME',
          amount: 100,
          date: new Date(Date.UTC(2026, 2, 5)),
          isPayment: false,
          isTransfer: false,
          _count: { reimbursementIncomeLinks: 1 },
          payee: 'Reimbursement',
          category: null,
        },
      ])
      .mockResolvedValueOnce([]);
    prismaMock.categoryRule.findMany.mockResolvedValue([]);

    const result = await getOverviewData('user-1', { month: 202603, day: 5 });

    expect(result.hero.income).toBe('0.00');
    expect(result.dayBars.find((d) => d.day === 5)?.income).toBe(0);
  });

  it('counts an otherwise-identical income row once it has no active links', async () => {
    prismaMock.budget.findMany.mockResolvedValue([]);
    prismaMock.transaction.groupBy.mockResolvedValue([]);
    prismaMock.account.findFirst.mockResolvedValue(null);
    prismaMock.transaction.findMany
      .mockResolvedValueOnce([
        {
          id: 't1',
          type: 'INCOME',
          amount: 100,
          date: new Date(Date.UTC(2026, 2, 5)),
          isPayment: false,
          isTransfer: false,
          _count: { reimbursementIncomeLinks: 0 },
          payee: 'Payroll',
          category: null,
        },
      ])
      .mockResolvedValueOnce([]);
    prismaMock.categoryRule.findMany.mockResolvedValue([]);

    const result = await getOverviewData('user-1', { month: 202603, day: 5 });

    expect(result.hero.income).toBe('100.00');
  });

  it('nets a reimbursed expense out of hero.expense, the pie, day bars, and daySpent', async () => {
    prismaMock.budget.findMany.mockResolvedValue([]);
    prismaMock.transaction.groupBy.mockResolvedValue([]);
    prismaMock.account.findFirst.mockResolvedValue(null);
    prismaMock.transaction.findMany
      .mockResolvedValueOnce([
        {
          id: 'exp-1',
          type: 'EXPENSE',
          amount: 100,
          date: new Date(Date.UTC(2026, 2, 5)),
          isPayment: false,
          isTransfer: false,
          _count: { reimbursementIncomeLinks: 0 },
          payee: 'Office supplies',
          categoryId: 'cat-1',
          category: { name: 'Work' },
        },
      ])
      .mockResolvedValueOnce([]);
    prismaMock.reimbursementLink.findMany.mockResolvedValue([
      {
        amount: 40,
        expenseTransactionId: 'exp-1',
        expense: { categoryId: 'cat-1', date: new Date(Date.UTC(2026, 2, 5)) },
      },
    ]);
    prismaMock.categoryRule.findMany.mockResolvedValue([]);

    const result = await getOverviewData('user-1', { month: 202603, day: 5 });

    expect(result.hero.expense).toBe('60.00');
    expect(result.expenseBreakdown).toEqual([
      { categoryId: 'cat-1', categoryName: 'Work', amount: '60.00', fraction: 1 },
    ]);
    expect(result.dayBars.find((d) => d.day === 5)?.expense).toBe(60);
    expect(result.selectedDay.spent).toBe('60.00');
    // the ledger row itself still shows the full, gross amount — it happened,
    // it's just not counted as full out-of-pocket spend anymore
    expect(result.selectedDay.rows[0].amount).toBe('100.00');
  });

  it('does not net reimbursements out of the credit card cycle balance/spend', async () => {
    prismaMock.budget.findMany.mockResolvedValue([]);
    prismaMock.transaction.groupBy.mockResolvedValue([]);
    const statementDay = 1;
    prismaMock.account.findFirst.mockResolvedValue({
      id: 'card-1',
      name: 'Visa',
      statementDay,
      startingBalance: 0,
    });
    prismaMock.transaction.findMany
      .mockResolvedValueOnce([]) // month-scoped query
      .mockResolvedValueOnce([]) // triage
      .mockResolvedValueOnce([
        {
          id: 'exp-1',
          accountId: 'card-1',
          type: 'EXPENSE',
          amount: 100,
          date: new Date(),
          isTransfer: false,
        },
      ]) // cycle-scoped query
      .mockResolvedValueOnce([
        {
          id: 'exp-1',
          accountId: 'card-1',
          type: 'EXPENSE',
          amount: 100,
          date: new Date(),
          isTransfer: false,
        },
      ]); // all-time query for balance
    prismaMock.reimbursementLink.findMany.mockResolvedValue([
      {
        amount: 40,
        expenseTransactionId: 'exp-1',
        expense: { categoryId: null, date: new Date() },
      },
    ]);
    prismaMock.categoryRule.findMany.mockResolvedValue([]);

    const result = await getOverviewData('user-1');

    expect(result.cycleCard?.cycleSpend).toBe('100.00');
    expect(result.cycleCard?.balance).toBe('-100.00');
  });
});
