import { prisma } from '@/lib/db/prisma';

export type CategoryRuleMatcher = { categoryId: string; matchText: string; priority: number };

/**
 * First rule (lowest priority number) whose matchText appears in the
 * payee/note, case-insensitive, wins. No match returns null so callers can
 * fall back to an "Other" category or leave uncategorized.
 */
export const matchCategoryRule = (rules: CategoryRuleMatcher[], text: string): string | null => {
  const haystack = text.toLowerCase();
  const sorted = [...rules].sort((a, b) => a.priority - b.priority);
  for (const rule of sorted) {
    if (haystack.includes(rule.matchText.toLowerCase())) {
      return rule.categoryId;
    }
  }
  return null;
};

export const suggestCategoryId = async (userId: string, text: string): Promise<string | null> => {
  const rules = await prisma.categoryRule.findMany({
    where: { userId },
    select: { categoryId: true, matchText: true, priority: true },
  });
  return matchCategoryRule(rules, text);
};

export type CategorizeQueueRow = {
  id: string;
  payee: string;
  meta: string;
  amount: string;
  suggestedCategoryId: string | null;
  suggestedCategoryName: string | null;
  why: string | null;
};

export const getCategorizeQueue = async (userId: string): Promise<CategorizeQueueRow[]> => {
  const rules = await prisma.categoryRule.findMany({
    where: { userId },
    include: { category: { select: { name: true } } },
    orderBy: { priority: 'asc' },
  });
  const transactions = await prisma.transaction.findMany({
    where: { userId, categoryId: null },
    include: { account: { select: { name: true } } },
    orderBy: { date: 'desc' },
  });

  return transactions.map((tx) => {
    const haystack = `${tx.payee ?? ''} ${tx.note ?? ''}`.toLowerCase();
    const rule = rules.find((r) => haystack.includes(r.matchText.toLowerCase()));
    return {
      id: tx.id,
      payee: tx.payee || tx.note || 'Transaction',
      meta: `${tx.account.name} · ${tx.date.toISOString().slice(0, 10)}`,
      amount: Number(tx.amount).toFixed(2),
      suggestedCategoryId: rule?.categoryId ?? null,
      suggestedCategoryName: rule?.category.name ?? null,
      why: rule ? `A rule matches "${rule.matchText}" in this transaction.` : null,
    };
  });
};

export type CategorizeQueueStats = { total: number; matched: number };

export const getCategorizeQueueStats = async (userId: string): Promise<CategorizeQueueStats> => {
  const [rules, uncategorized] = await Promise.all([
    prisma.categoryRule.findMany({
      where: { userId },
      select: { categoryId: true, matchText: true, priority: true },
    }),
    prisma.transaction.findMany({
      where: { userId, categoryId: null },
      select: { payee: true, note: true },
    }),
  ]);

  const matched = uncategorized.filter(
    (tx) => matchCategoryRule(rules, `${tx.payee ?? ''} ${tx.note ?? ''}`) !== null,
  ).length;

  return { total: uncategorized.length, matched };
};
