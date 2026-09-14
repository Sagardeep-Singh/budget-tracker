import { prisma } from '@/lib/db/prisma';

export type CategoryRuleMatcher = { categoryId: string; matchText: string; priority: number };

/** `/pattern/flags` — a leading and trailing slash, valid JS regex flags only.
 * Restricting flags to the real set (not any `[a-z]*`) keeps a plain literal
 * like "/home/user" from back-matching as body "home" + bogus flags "user". */
const REGEX_RULE = /^\/(.+)\/([gimsuy]*)$/;

/**
 * Compiles a rule's matchText into a matcher against raw (non-lowered) text.
 *
 * `/pattern/flags` is a regex — matched with flags exactly as written, so
 * (unlike literal mode) it is case-sensitive unless the rule includes `i`.
 * That's standard regex-literal semantics and the least surprising choice
 * for anyone deliberately opting into regex syntax.
 *
 * Anything else — including a `/.../`-shaped pattern that fails to compile —
 * falls back to a case-insensitive substring match. Invalid regexes are
 * rejected up front at create/update time (see the Zod schema); this
 * fallback is defense-in-depth so matching itself never throws.
 */
export const compileRuleMatcher = (matchText: string): { test: (haystack: string) => boolean } => {
  const parsed = REGEX_RULE.exec(matchText);
  if (parsed) {
    try {
      const regex = new RegExp(parsed[1], parsed[2]);
      return { test: (haystack: string) => regex.test(haystack) };
    } catch {
      // falls through to the literal match below
    }
  }
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
    where: { userId, categoryId: null, skippedAt: null },
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
      where: { userId, categoryId: null, skippedAt: null },
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
