import { prisma } from '@/lib/db/prisma';
import { ServiceValidationError } from '@/lib/services/common';
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

  const [budgets, spentByCategory] = await Promise.all([
    prisma.budget.findMany({
      where: { userId, month },
      include: { category: { select: { name: true } } },
      orderBy: { category: { name: 'asc' } },
    }),
    prisma.transaction.groupBy({
      by: ['categoryId'],
      where: { userId, type: 'EXPENSE', date: { gte: start, lt: end }, categoryId: { not: null } },
      _sum: { amount: true },
    }),
  ]);

  const spentMap = new Map(
    spentByCategory.map((row) => [row.categoryId as string, Number(row._sum.amount ?? 0)]),
  );

  return budgets.map((budget) => ({
    id: budget.id,
    categoryId: budget.categoryId,
    categoryName: budget.category.name,
    month: budget.month,
    limitAmount: Number(budget.limitAmount).toFixed(2),
    spent: (spentMap.get(budget.categoryId) ?? 0).toFixed(2),
  }));
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
