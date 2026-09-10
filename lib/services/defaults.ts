import { prisma } from '@/lib/db/prisma';

export const DEFAULT_CATEGORIES = [
  'Groceries',
  'Rent',
  'Utilities',
  'Transport',
  'Dining',
  'Income',
  'Other',
];

export const DEFAULT_RULES: Record<string, string[]> = {
  Groceries: ['grocery', 'supermarket', 'whole foods', 'trader joe', 'safeway', 'kroger'],
  Rent: ['rent', 'landlord', 'property management'],
  Utilities: ['electric', 'water bill', 'gas company', 'internet', 'utility', 'comcast', 'verizon'],
  Transport: ['uber', 'lyft', 'gas station', 'transit', 'parking', 'shell', 'chevron'],
  Dining: ['restaurant', 'coffee', 'cafe', 'starbucks', 'doordash', 'grubhub'],
  Income: ['payroll', 'salary', 'direct deposit', 'paycheck'],
};

/**
 * Provisions the starter categories, category rules, and checking account
 * for a brand-new user. Used only by the dev seed script — real sign-ups
 * (credentials and Google) intentionally start with no prepopulated data.
 */
export const provisionDefaultsForUser = async (userId: string): Promise<void> => {
  await prisma.category.createMany({
    data: DEFAULT_CATEGORIES.map((name) => ({ userId, name, isDefault: true })),
  });
  const categories = await prisma.category.findMany({ where: { userId } });
  const categoryIdByName = new Map(categories.map((c) => [c.name, c.id]));

  await prisma.categoryRule.createMany({
    data: Object.entries(DEFAULT_RULES).flatMap(([categoryName, matchTexts]) => {
      const categoryId = categoryIdByName.get(categoryName);
      if (!categoryId) return [];
      return matchTexts.map((matchText, index) => ({
        userId,
        categoryId,
        matchText,
        priority: index,
      }));
    }),
  });

  await prisma.account.create({
    data: { userId, name: 'Checking', type: 'CHECKING', startingBalance: 0 },
  });
};
