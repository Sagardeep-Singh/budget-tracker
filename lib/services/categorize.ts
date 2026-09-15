import { prisma } from '@/lib/db/prisma';

export type CategoryRuleMatcher = { categoryId: string; matchText: string; priority: number };

/** Case-insensitive substring matcher for a rule's matchText. */
export const compileRuleMatcher = (matchText: string): { test: (haystack: string) => boolean } => {
  const needle = matchText.toLowerCase();
  return { test: (haystack: string) => haystack.toLowerCase().includes(needle) };
};

/**
 * First rule (lowest priority number) whose matchText matches the
 * payee/note wins. No match returns null so callers can fall back to an
 * "Other" category or leave uncategorized.
 */
/** Precompiles matchers once so callers matching many rows against the same
 * rule set (import preview, categorize queue, stats) don't recompile a
 * RegExp per row per rule. */
const compileMatchers = (
  rules: CategoryRuleMatcher[],
): Array<{ categoryId: string; matcher: { test: (haystack: string) => boolean } }> =>
  [...rules]
    .sort((a, b) => a.priority - b.priority)
    .map((rule) => ({ categoryId: rule.categoryId, matcher: compileRuleMatcher(rule.matchText) }));

export const matchCategoryRule = (rules: CategoryRuleMatcher[], text: string): string | null => {
  for (const { categoryId, matcher } of compileMatchers(rules)) {
    if (matcher.test(text)) {
      return categoryId;
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
    // a transfer leg or a card payment isn't spending or income — it never
    // needs a category, so keep it out of the triage queue entirely
    where: { userId, categoryId: null, skippedAt: null, isTransfer: false, isPayment: false },
    include: { account: { select: { name: true } } },
    orderBy: { date: 'desc' },
  });

  const matchers = rules.map((r) => ({ rule: r, matcher: compileRuleMatcher(r.matchText) }));

  return transactions.map((tx) => {
    const haystack = `${tx.payee ?? ''} ${tx.note ?? ''}`;
    const rule = matchers.find((m) => m.matcher.test(haystack))?.rule;
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
      // a transfer leg or a card payment isn't spending or income — it never
      // needs a category, so keep it out of the triage queue entirely
      where: { userId, categoryId: null, skippedAt: null, isTransfer: false, isPayment: false },
      select: { payee: true, note: true },
    }),
  ]);

  const matchers = compileMatchers(rules);
  const matched = uncategorized.filter((tx) => {
    const haystack = `${tx.payee ?? ''} ${tx.note ?? ''}`;
    return matchers.some((m) => m.matcher.test(haystack));
  }).length;

  return { total: uncategorized.length, matched };
};
