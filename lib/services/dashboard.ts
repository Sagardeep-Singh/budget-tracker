import { prisma } from '@/lib/db/prisma';

export type DashboardSummary = {
  month: number;
  income: string;
  expense: string;
  net: string;
  recent: {
    id: string;
    amount: string;
    type: string;
    date: string;
    payee: string | null;
    categoryName: string | null;
  }[];
};

const currentMonth = (): number => {
  const now = new Date();
  return now.getUTCFullYear() * 100 + (now.getUTCMonth() + 1);
};

const monthRange = (month: number): { start: Date; end: Date } => {
  const year = Math.floor(month / 100);
  const monthIndex = (month % 100) - 1;
  const start = new Date(Date.UTC(year, monthIndex, 1));
  const end = new Date(Date.UTC(year, monthIndex + 1, 1));
  return { start, end };
};

export const getDashboardSummary = async (userId: string): Promise<DashboardSummary> => {
  const month = currentMonth();
  const { start, end } = monthRange(month);

  const [sums, recent] = await Promise.all([
    prisma.transaction.groupBy({
      by: ['type'],
      where: { userId, date: { gte: start, lt: end } },
      _sum: { amount: true },
    }),
    prisma.transaction.findMany({
      where: { userId },
      include: { category: { select: { name: true } } },
      orderBy: { date: 'desc' },
      take: 8,
    }),
  ]);

  const income = Number(sums.find((s) => s.type === 'INCOME')?._sum.amount ?? 0);
  const expense = Number(sums.find((s) => s.type === 'EXPENSE')?._sum.amount ?? 0);

  return {
    month,
    income: income.toFixed(2),
    expense: expense.toFixed(2),
    net: (income - expense).toFixed(2),
    recent: recent.map((t) => ({
      id: t.id,
      amount: Number(t.amount).toFixed(2),
      type: t.type,
      date: t.date.toISOString(),
      payee: t.payee,
      categoryName: t.category?.name ?? null,
    })),
  };
};
