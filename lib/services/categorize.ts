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
