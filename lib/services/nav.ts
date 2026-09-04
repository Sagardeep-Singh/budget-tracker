import { prisma } from '@/lib/db/prisma';

export type NavCounts = {
  transactions: number;
  categorize: number;
  budgets: number;
  accounts: number;
  rules: number;
};

const currentMonth = (): number => {
  const now = new Date();
  return now.getUTCFullYear() * 100 + (now.getUTCMonth() + 1);
};

export const getNavCounts = async (userId: string): Promise<NavCounts> => {
  const [transactions, categorize, budgets, accounts, rules] = await Promise.all([
    prisma.transaction.count({ where: { userId } }),
    prisma.transaction.count({ where: { userId, categoryId: null } }),
    prisma.budget.count({ where: { userId, month: currentMonth() } }),
    prisma.account.count({ where: { userId } }),
    prisma.categoryRule.count({ where: { userId } }),
  ]);

  return { transactions, categorize, budgets, accounts, rules };
};
