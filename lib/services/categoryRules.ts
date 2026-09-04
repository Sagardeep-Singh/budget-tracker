import { prisma } from '@/lib/db/prisma';
import { ServiceValidationError } from '@/lib/services/common';
import type {
  CreateCategoryRuleInput,
  UpdateCategoryRuleInput,
} from '@/lib/validators/category-rules';

export type FrontendCategoryRule = {
  id: string;
  categoryId: string;
  categoryName: string;
  matchText: string;
  priority: number;
  /** Count of the user's current transactions this rule's match text and
   * category both agree with — an approximation of "applied", since a
   * transaction's category isn't tagged with which rule (if any) set it. */
  appliedCount: number;
};

const toFrontend = (
  rule: {
    id: string;
    categoryId: string;
    matchText: string;
    priority: number;
    category: { name: string };
  },
  appliedCount: number,
): FrontendCategoryRule => ({
  id: rule.id,
  categoryId: rule.categoryId,
  categoryName: rule.category.name,
  matchText: rule.matchText,
  priority: rule.priority,
  appliedCount,
});

export const listCategoryRules = async (userId: string): Promise<FrontendCategoryRule[]> => {
  const [rules, transactions] = await Promise.all([
    prisma.categoryRule.findMany({
      where: { userId },
      include: { category: { select: { name: true } } },
      orderBy: [{ priority: 'asc' }, { matchText: 'asc' }],
    }),
    prisma.transaction.findMany({
      where: { userId, categoryId: { not: null } },
      select: { categoryId: true, payee: true, note: true },
    }),
  ]);

  return rules.map((rule) => {
    const matchText = rule.matchText.toLowerCase();
    const appliedCount = transactions.filter(
      (t) =>
        t.categoryId === rule.categoryId &&
        `${t.payee ?? ''} ${t.note ?? ''}`.toLowerCase().includes(matchText),
    ).length;
    return toFrontend(rule, appliedCount);
  });
};

export const createCategoryRule = async (
  userId: string,
  input: CreateCategoryRuleInput,
): Promise<FrontendCategoryRule> => {
  const category = await prisma.category.findFirst({
    where: { id: input.categoryId, userId },
  });
  if (!category) {
    throw new ServiceValidationError('Category not found');
  }

  const rule = await prisma.categoryRule.create({
    data: {
      userId,
      categoryId: input.categoryId,
      matchText: input.matchText,
      priority: input.priority,
    },
    include: { category: { select: { name: true } } },
  });
  return toFrontend(rule, 0);
};

export const updateCategoryRule = async (
  userId: string,
  ruleId: string,
  input: UpdateCategoryRuleInput,
): Promise<FrontendCategoryRule> => {
  const existing = await prisma.categoryRule.findFirst({ where: { id: ruleId, userId } });
  if (!existing) {
    throw new ServiceValidationError('Rule not found');
  }

  const rule = await prisma.categoryRule.update({
    where: { id: ruleId },
    data: input,
    include: { category: { select: { name: true } } },
  });
  return toFrontend(rule, 0);
};

export const deleteCategoryRule = async (userId: string, ruleId: string): Promise<void> => {
  const existing = await prisma.categoryRule.findFirst({ where: { id: ruleId, userId } });
  if (!existing) {
    throw new ServiceValidationError('Rule not found');
  }
  await prisma.categoryRule.delete({ where: { id: ruleId } });
};
