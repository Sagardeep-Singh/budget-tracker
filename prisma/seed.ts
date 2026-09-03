import bcrypt from 'bcryptjs';
import { prisma } from '../lib/db/prisma';

const DEFAULT_CATEGORIES = [
  'Groceries',
  'Rent',
  'Utilities',
  'Transport',
  'Dining',
  'Income',
  'Other',
];

const DEFAULT_RULES: Record<string, string[]> = {
  Groceries: ['grocery', 'supermarket', 'whole foods', 'trader joe', 'safeway', 'kroger'],
  Rent: ['rent', 'landlord', 'property management'],
  Utilities: ['electric', 'water bill', 'gas company', 'internet', 'utility', 'comcast', 'verizon'],
  Transport: ['uber', 'lyft', 'gas station', 'transit', 'parking', 'shell', 'chevron'],
  Dining: ['restaurant', 'coffee', 'cafe', 'starbucks', 'doordash', 'grubhub'],
  Income: ['payroll', 'salary', 'direct deposit', 'paycheck'],
};

const main = async (): Promise<void> => {
  const email = process.env.ADMIN_EMAIL ?? 'dev@example.com';
  const password = process.env.ADMIN_PASSWORD ?? 'devpassword123';

  // destructive: local dev only, never run against production
  await prisma.transaction.deleteMany();
  await prisma.categoryRule.deleteMany();
  await prisma.budget.deleteMany();
  await prisma.category.deleteMany();
  await prisma.account.deleteMany();
  await prisma.user.deleteMany();

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({ data: { email, passwordHash } });

  await prisma.category.createMany({
    data: DEFAULT_CATEGORIES.map((name) => ({ userId: user.id, name, isDefault: true })),
  });
  const categories = await prisma.category.findMany({ where: { userId: user.id } });
  const categoryIdByName = new Map(categories.map((c) => [c.name, c.id]));

  await prisma.categoryRule.createMany({
    data: Object.entries(DEFAULT_RULES).flatMap(([categoryName, matchTexts]) => {
      const categoryId = categoryIdByName.get(categoryName);
      if (!categoryId) return [];
      return matchTexts.map((matchText, index) => ({
        userId: user.id,
        categoryId,
        matchText,
        priority: index,
      }));
    }),
  });

  const checking = await prisma.account.create({
    data: { userId: user.id, name: 'Checking', type: 'CHECKING', startingBalance: 0 },
  });

  console.log(
    `Seeded user ${user.email} with default categories, category rules, and account "${checking.name}"`,
  );
};

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
