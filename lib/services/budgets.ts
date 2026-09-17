import { prisma } from '@/lib/db/prisma';
import { ServiceValidationError } from '@/lib/services/common';
import { listReimbursedAmountsByExpenseDate } from '@/lib/services/reimbursements';
import type { CreateBudgetInput, UpdateBudgetInput } from '@/lib/validators/budgets';

export type FrontendBudget = {
  id: string;
  categoryId: string;
  categoryName: string;
  month: number;
  limitAmount: string;
  spent: string;
};

const monthRange = (month: number): { start: Date; end: Date } => {
  const year = Math.floor(month / 100);
  const monthIndex = (month % 100) - 1;
  const start = new Date(Date.UTC(year, monthIndex, 1));
  const end = new Date(Date.UTC(year, monthIndex + 1, 1));
  return { start, end };
};

export const listBudgets = async (userId: string, month: number): Promise<FrontendBudget[]> => {
  const { start, end } = monthRange(month);

  const [rows, spentByCategory, reimbursedExpenses] = await Promise.all([
    // Budgets repeat month over month until changed: pull every row at or
    // before the requested month and keep, per category, only the most
    // recent one — that's the value in effect for this month.
    prisma.budget.findMany({
      where: { userId, month: { lte: month } },
      include: { category: { select: { name: true } } },
      orderBy: [{ categoryId: 'asc' }, { month: 'desc' }],
    }),
    prisma.transaction.groupBy({
      by: ['categoryId'],
      // a transfer between the user's own accounts isn't spending, even when
      // it carries a category — keep it out of budget spend so this agrees
      // with the dashboard's expense total
      where: {
        userId,
        type: 'EXPENSE',
        isTransfer: false,
        date: { gte: start, lt: end },
        categoryId: { not: null },
      },
      _sum: { amount: true },
    }),
    // net reimbursements out of spend, attributed to the *expense's* month —
    // a reimbursement received later still reduces the month the money was spent in
    listReimbursedAmountsByExpenseDate(userId, start, end),
  ]);

  const effectiveByCategory = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    if (!effectiveByCategory.has(row.categoryId)) {
      effectiveByCategory.set(row.categoryId, row);
    }
  }

  const spentMap = new Map(
    spentByCategory.map((row) => [row.categoryId as string, Number(row._sum.amount ?? 0)]),
  );

  const reimbursedByCategory = new Map<string, number>();
  for (const r of reimbursedExpenses) {
    if (!r.categoryId) continue;
    reimbursedByCategory.set(
      r.categoryId,
      (reimbursedByCategory.get(r.categoryId) ?? 0) + Number(r.amount),
    );
  }

  return [...effectiveByCategory.values()]
    .sort((a, b) => a.category.name.localeCompare(b.category.name))
    .map((budget) => {
      const grossSpent = spentMap.get(budget.categoryId) ?? 0;
      const reimbursed = reimbursedByCategory.get(budget.categoryId) ?? 0;
      return {
        id: budget.id,
        categoryId: budget.categoryId,
        categoryName: budget.category.name,
        month: budget.month,
        limitAmount: Number(budget.limitAmount).toFixed(2),
        spent: Math.max(0, grossSpent - reimbursed).toFixed(2),
      };
    });
};

export const createBudget = async (
  userId: string,
  input: CreateBudgetInput,
): Promise<FrontendBudget> => {
  const category = await prisma.category.findFirst({ where: { id: input.categoryId, userId } });
  if (!category) {
    throw new ServiceValidationError('Category not found');
  }

  const existing = await prisma.budget.findFirst({
    where: { userId, categoryId: input.categoryId, month: input.month },
  });
  if (existing) {
    throw new ServiceValidationError('A budget for this category and month already exists');
  }

  const budget = await prisma.budget.create({
    data: {
      userId,
      categoryId: input.categoryId,
      month: input.month,
      limitAmount: input.limitAmount,
    },
  });

  return {
    id: budget.id,
    categoryId: budget.categoryId,
    categoryName: category.name,
    month: budget.month,
    limitAmount: Number(budget.limitAmount).toFixed(2),
    spent: '0.00',
  };
};

export const updateBudget = async (
  userId: string,
  budgetId: string,
  input: UpdateBudgetInput,
): Promise<void> => {
  const existing = await prisma.budget.findFirst({ where: { id: budgetId, userId } });
  if (!existing) {
    throw new ServiceValidationError('Budget not found');
  }
  await prisma.budget.update({ where: { id: budgetId }, data: { limitAmount: input.limitAmount } });
};

export const deleteBudget = async (userId: string, budgetId: string): Promise<void> => {
  const existing = await prisma.budget.findFirst({ where: { id: budgetId, userId } });
  if (!existing) {
    throw new ServiceValidationError('Budget not found');
  }
  await prisma.budget.delete({ where: { id: budgetId } });
};
