import { prisma } from '@/lib/db/prisma';
import { listBudgets } from '@/lib/services/budgets';
import { getCategorizeQueueStats } from '@/lib/services/categorize';
import { getStatementPeriod } from '@/lib/statement';

export type OverviewDayBar = { day: number; income: number; expense: number };

export type OverviewDayEntry = {
  id: string;
  payee: string;
  categoryName: string | null;
  amount: string;
  tone: 'income' | 'expense';
};

export type OverviewBudgetRing = {
  id: string;
  categoryName: string;
  fraction: number;
  pctLabel: string;
  left: string;
  over: boolean;
};

export type OverviewCycleCard = {
  accountName: string;
  cycleLabel: string;
  cycleSpend: string;
  balance: string;
  closesInDays: number;
  progress: number;
};

export type OverviewData = {
  month: number;
  daysInMonth: number;
  dailyPace: string;
  hero: {
    usedFraction: number;
    over: boolean;
    leftLabel: string;
    leftAmount: string;
    limit: string;
    spent: string;
    metaLine: string;
    paceAmount: string;
    paceTail: string;
    paceNote: string;
    paceTone: 'sky' | 'rose' | 'neutral';
    income: string;
    expense: string;
    net: string;
  };
  budgetRings: OverviewBudgetRing[];
  dayBars: OverviewDayBar[];
  selectedDay: {
    day: number;
    weekday: string;
    dateLabel: string;
    fraction: number;
    over: boolean;
    spent: string;
    note: string;
    rows: OverviewDayEntry[];
  };
  triage: { total: number; matched: number };
  cycleCard: OverviewCycleCard | null;
};

const currentMonth = (): number => {
  const now = new Date();
  return now.getUTCFullYear() * 100 + (now.getUTCMonth() + 1);
};

const monthRange = (month: number): { start: Date; end: Date; daysInMonth: number } => {
  const year = Math.floor(month / 100);
  const monthIndex = (month % 100) - 1;
  const start = new Date(Date.UTC(year, monthIndex, 1));
  const end = new Date(Date.UTC(year, monthIndex + 1, 1));
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  return { start, end, daysInMonth };
};

const WEEKDAY_FORMATTER = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long' });
const DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  month: 'long',
  day: 'numeric',
});

export const getOverviewData = async (
  userId: string,
  options: { month?: number; day?: number } = {},
): Promise<OverviewData> => {
  const month = options.month ?? currentMonth();
  const { start, end, daysInMonth } = monthRange(month);
  const isCurrentMonth = month === currentMonth();
  const now = new Date();
  const todayOfMonth = isCurrentMonth ? now.getUTCDate() : daysInMonth;

  const [budgets, transactions, cardAccount] = await Promise.all([
    listBudgets(userId, month),
    prisma.transaction.findMany({
      where: { userId, date: { gte: start, lt: end } },
      include: { category: { select: { name: true } } },
      orderBy: { date: 'asc' },
    }),
    prisma.account.findFirst({
      where: { userId, type: 'CREDIT_CARD', statementDay: { not: null } },
      orderBy: { createdAt: 'asc' },
    }),
  ]);

  const limit = budgets.reduce((sum, b) => sum + Number(b.limitAmount), 0);
  const spent = budgets.reduce((sum, b) => sum + Number(b.spent), 0);
  const usedFraction = limit > 0 ? spent / limit : 0;
  const over = spent > limit && limit > 0;

  const income = transactions
    .filter((t) => t.type === 'INCOME' && !t.isPayment)
    .reduce((sum, t) => sum + Number(t.amount), 0);
  const expense = transactions
    .filter((t) => t.type === 'EXPENSE')
    .reduce((sum, t) => sum + Number(t.amount), 0);

  const daysRemaining = Math.max(daysInMonth - todayOfMonth, 0);
  const dailyPace = limit > 0 ? limit / daysInMonth : 0;
  const expectedSpendByNow = dailyPace * todayOfMonth;
  const pacedUnder = limit === 0 || spent <= expectedSpendByNow;
  const paceAmount =
    daysRemaining > 0 ? Math.max(limit - spent, 0) / daysRemaining : Math.max(limit - spent, 0);

  const paceNote =
    limit === 0
      ? 'Set a budget to see how your spending is pacing this month.'
      : pacedUnder
        ? `You're pacing under budget. At this rate you'll finish the month with money to spare.`
        : `You're spending faster than your budget pace — slow down to land on target.`;

  const dayMap = new Map<number, { income: number; expense: number }>();
  for (let d = 1; d <= daysInMonth; d += 1) dayMap.set(d, { income: 0, expense: 0 });
  for (const t of transactions) {
    const d = t.date.getUTCDate();
    const bucket = dayMap.get(d)!;
    if (t.type === 'INCOME' && !t.isPayment) bucket.income += Number(t.amount);
    if (t.type === 'EXPENSE') bucket.expense += Number(t.amount);
  }
  const dayBars: OverviewDayBar[] = Array.from(dayMap.entries()).map(([day, v]) => ({
    day,
    income: v.income,
    expense: v.expense,
  }));

  const selectedDayNum = Math.min(Math.max(options.day ?? todayOfMonth, 1), daysInMonth);
  const selectedDate = new Date(
    Date.UTC(Math.floor(month / 100), (month % 100) - 1, selectedDayNum),
  );
  const dayTransactions = transactions.filter((t) => t.date.getUTCDate() === selectedDayNum);
  const daySpent = dayTransactions
    .filter((t) => t.type === 'EXPENSE')
    .reduce((sum, t) => sum + Number(t.amount), 0);
  const dayFraction = dailyPace > 0 ? daySpent / dailyPace : 0;
  const dayOver = dailyPace > 0 && daySpent > dailyPace;

  const triage = await getCategorizeQueueStats(userId);

  let cycleCard: OverviewCycleCard | null = null;
  if (cardAccount && cardAccount.statementDay) {
    const period = getStatementPeriod(cardAccount.statementDay, now);
    const [cycleTransactions, allTransactions] = await Promise.all([
      prisma.transaction.findMany({
        where: { accountId: cardAccount.id, date: { gte: period.start, lt: period.end } },
      }),
      prisma.transaction.findMany({ where: { accountId: cardAccount.id } }),
    ]);
    const cycleSpend = cycleTransactions
      .filter((t) => t.type === 'EXPENSE')
      .reduce((sum, t) => sum + Number(t.amount), 0);
    const net = allTransactions.reduce(
      (sum, t) => sum + (t.type === 'INCOME' ? Number(t.amount) : -Number(t.amount)),
      0,
    );
    const balance = Number(cardAccount.startingBalance) + net;
    const totalDays = Math.round((period.end.getTime() - period.start.getTime()) / 86_400_000);
    const elapsedDays = Math.min(
      Math.max(Math.round((now.getTime() - period.start.getTime()) / 86_400_000), 0),
      totalDays,
    );
    const closesInDays = Math.max(
      Math.round((period.end.getTime() - 86_400_000 - now.getTime()) / 86_400_000),
      0,
    );

    cycleCard = {
      accountName: cardAccount.name,
      cycleLabel: `${DATE_FORMATTER.format(period.start)} – ${DATE_FORMATTER.format(
        new Date(period.end.getTime() - 86_400_000),
      )}`,
      cycleSpend: cycleSpend.toFixed(2),
      balance: balance.toFixed(2),
      closesInDays,
      progress: totalDays > 0 ? elapsedDays / totalDays : 0,
    };
  }

  return {
    month,
    daysInMonth,
    dailyPace: dailyPace.toFixed(2),
    hero: {
      usedFraction,
      over,
      leftLabel: over ? 'Over budget by' : 'Left to spend',
      leftAmount: Math.abs(limit - spent).toFixed(2),
      limit: limit.toFixed(2),
      spent: spent.toFixed(2),
      metaLine: `${daysRemaining} ${daysRemaining === 1 ? 'day' : 'days'} left`,
      paceAmount: paceAmount.toFixed(2),
      paceTail: over ? 'over pace' : 'left to spend per day',
      paceNote,
      paceTone: limit === 0 ? 'neutral' : pacedUnder ? 'sky' : 'rose',
      income: income.toFixed(2),
      expense: expense.toFixed(2),
      net: (income - expense).toFixed(2),
    },
    budgetRings: budgets.slice(0, 4).map((b) => {
      const budgetLimit = Number(b.limitAmount);
      const budgetSpent = Number(b.spent);
      const fraction = budgetLimit > 0 ? budgetSpent / budgetLimit : 0;
      return {
        id: b.id,
        categoryName: b.categoryName,
        fraction,
        pctLabel: `${Math.round(Math.min(fraction, 1) * 100)}%`,
        left: `${budgetSpent > budgetLimit ? 'Over by' : ''} ${Math.abs(budgetLimit - budgetSpent).toFixed(2)}`.trim(),
        over: budgetSpent > budgetLimit,
      };
    }),
    dayBars,
    selectedDay: {
      day: selectedDayNum,
      weekday: WEEKDAY_FORMATTER.format(selectedDate),
      dateLabel: DATE_FORMATTER.format(selectedDate),
      fraction: dayFraction,
      over: dayOver,
      spent: daySpent.toFixed(2),
      note:
        dailyPace === 0
          ? 'Set a budget to see this day against your pace.'
          : dayOver
            ? `${Math.round((dayFraction - 1) * 100)}% over the day's pace.`
            : `${Math.round((1 - dayFraction) * 100)}% under the day's pace.`,
      rows: dayTransactions.map((t) => ({
        id: t.id,
        payee: t.payee ?? t.category?.name ?? 'Transaction',
        categoryName: t.category?.name ?? 'Uncategorized',
        amount: Number(t.amount).toFixed(2),
        tone: t.type === 'INCOME' ? 'income' : 'expense',
      })),
    },
    triage,
    cycleCard,
  };
};
