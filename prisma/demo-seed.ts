import bcrypt from 'bcryptjs';
import { prisma } from '../lib/db/prisma';
import { provisionDefaultsForUser, DEFAULT_RULES } from '../lib/services/defaults';

/**
 * Large, deterministic demo dataset for one fixed demo user — safe to run
 * repeatedly (including periodically against a live deployment) because it
 * only ever touches that one user's own rows, scoped by userId. It never
 * runs a global deleteMany like prisma/seed.ts, and it never enumerates or
 * touches any other user's account/transaction/budget/category data.
 *
 * Deterministic: seeded PRNG, so the generated dataset (row counts, dates,
 * amounts) is identical across runs — useful as a stable fixture for
 * manual QA and for pointing e2e tests at real volume instead of a handful
 * of rows.
 */

export const DEMO_EMAIL = process.env.DEMO_EMAIL ?? 'demo@ledger.app';
export const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? 'demopassword123';
const MONTHS_BACK = 6;

// mulberry32 — small, fast, seeded PRNG so the dataset is reproducible.
const makeRng = (seed: number): (() => number) => {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const pick = <T>(rng: () => number, arr: T[]): T => arr[Math.floor(rng() * arr.length)];

const MONTH_KEY = (year: number, month1to12: number): number => year * 100 + month1to12;

// Payees that don't match any DEFAULT_RULES matchText — land uncategorized
// in the categorize queue, same as real-world unmatched CSV imports.
const UNCATEGORIZED_PAYEES = [
  "sq *goldie's donuts & bak",
  'pc express 1556',
  'sp evaca',
  'tst* corner bistro',
  'paypal *misc merch',
  'venmo transfer',
];

const buildPayeePools = (): Array<{ category: string; payees: string[] }> =>
  Object.entries(DEFAULT_RULES).map(([category, matchTexts]) => ({
    category,
    // realistic merchant-looking strings that still contain the rule's
    // match text, so category rules actually fire (and "Applied" counts
    // on the Rules screen are non-zero, not a demo-data artifact)
    payees: matchTexts.map((m) => `${m} #${1 + Math.floor(m.length / 3)}`),
  }));

export const seedDemoData = async (): Promise<{
  userId: string;
  accounts: number;
  categories: number;
  categoryRules: number;
  transactions: number;
  budgets: number;
}> => {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);
  const user = await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    update: { passwordHash, name: 'Demo' },
    create: { email: DEMO_EMAIL, passwordHash, name: 'Demo' },
  });

  // Scoped to this user only — safe to run repeatedly against a live
  // deployment without touching any other user's data.
  await prisma.transaction.deleteMany({ where: { userId: user.id } });
  await prisma.budget.deleteMany({ where: { userId: user.id } });
  await prisma.categoryRule.deleteMany({ where: { userId: user.id } });
  await prisma.category.deleteMany({ where: { userId: user.id } });
  await prisma.account.deleteMany({ where: { userId: user.id } });

  // Categories + rules + a Checking account.
  await provisionDefaultsForUser(user.id);

  const [savings, creditCard] = await Promise.all([
    prisma.account.create({
      data: { userId: user.id, name: 'Savings', type: 'SAVINGS', startingBalance: 5000 },
    }),
    prisma.account.create({
      data: {
        userId: user.id,
        name: 'Rewards Card',
        type: 'CREDIT_CARD',
        startingBalance: 0,
        statementDay: 15,
      },
    }),
  ]);
  const checking = await prisma.account.findFirstOrThrow({
    where: { userId: user.id, type: 'CHECKING' },
  });

  const categories = await prisma.category.findMany({ where: { userId: user.id } });
  const categoryIdByName = new Map(categories.map((c) => [c.name, c.id]));
  const payeePools = buildPayeePools();

  const rng = makeRng(20260910);
  const now = new Date();
  const transactions: Array<{
    userId: string;
    accountId: string;
    categoryId: string | null;
    amount: number;
    type: 'INCOME' | 'EXPENSE';
    date: Date;
    payee: string;
    isPayment: boolean;
    skippedAt: Date | null;
  }> = [];

  for (let m = MONTHS_BACK - 1; m >= 0; m -= 1) {
    const monthDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - m, 1));
    const year = monthDate.getUTCFullYear();
    const month1to12 = monthDate.getUTCMonth() + 1;
    const daysInMonth = new Date(Date.UTC(year, month1to12, 0)).getUTCDate();

    // Monthly transfer into Savings.
    transactions.push({
      userId: user.id,
      accountId: savings.id,
      categoryId: null,
      amount: 200 + Math.round(rng() * 150),
      type: 'INCOME',
      date: new Date(Date.UTC(year, month1to12 - 1, 2)),
      payee: 'Transfer from Checking',
      isPayment: false,
      skippedAt: null,
    });

    // Paycheck, twice a month, on Checking.
    for (const day of [1, 15]) {
      transactions.push({
        userId: user.id,
        accountId: checking.id,
        categoryId: categoryIdByName.get('Income') ?? null,
        amount: 2200 + Math.round(rng() * 300),
        type: 'INCOME',
        date: new Date(Date.UTC(year, month1to12 - 1, day)),
        payee: 'Employer direct deposit payroll',
        isPayment: false,
        skippedAt: null,
      });
    }

    // ~25 categorized expenses/month, spread across Checking + Rewards Card.
    for (let i = 0; i < 25; i += 1) {
      const day = 1 + Math.floor(rng() * daysInMonth);
      const pool = pick(rng, payeePools);
      const account = rng() < 0.6 ? creditCard : checking;
      transactions.push({
        userId: user.id,
        accountId: account.id,
        categoryId: categoryIdByName.get(pool.category) ?? null,
        amount: Math.round((5 + rng() * 145) * 100) / 100,
        type: 'EXPENSE',
        date: new Date(Date.UTC(year, month1to12 - 1, day)),
        payee: pick(rng, pool.payees),
        isPayment: false,
        skippedAt: null,
      });
    }

    // ~6 uncategorized expenses/month — populates the categorize queue.
    for (let i = 0; i < 6; i += 1) {
      const day = 1 + Math.floor(rng() * daysInMonth);
      transactions.push({
        userId: user.id,
        accountId: rng() < 0.5 ? checking.id : creditCard.id,
        categoryId: null,
        amount: Math.round((3 + rng() * 90) * 100) / 100,
        type: 'EXPENSE',
        date: new Date(Date.UTC(year, month1to12 - 1, day)),
        payee: pick(rng, UNCATEGORIZED_PAYEES),
        isPayment: false,
        // ~half already reviewed-and-skipped, so the queue looks lived-in
        // rather than pristine.
        skippedAt: rng() < 0.5 ? new Date(Date.UTC(year, month1to12 - 1, day + 1)) : null,
      });
    }

    // Credit card statement payment: a Checking expense paying down the
    // card, mirrored as an isPayment income on the card (same pairing a
    // real bank export produces — see the account-aware CSV import sign
    // convention and the credit-card statement cycle feature).
    const paymentDay = Math.min(20, daysInMonth);
    const paymentAmount = 300 + Math.round(rng() * 400);
    transactions.push({
      userId: user.id,
      accountId: checking.id,
      categoryId: null,
      amount: paymentAmount,
      type: 'EXPENSE',
      date: new Date(Date.UTC(year, month1to12 - 1, paymentDay)),
      payee: 'Payment to Rewards Card',
      isPayment: false,
      skippedAt: null,
    });
    transactions.push({
      userId: user.id,
      accountId: creditCard.id,
      categoryId: null,
      amount: paymentAmount,
      type: 'INCOME',
      date: new Date(Date.UTC(year, month1to12 - 1, paymentDay)),
      payee: 'Payment received - thank you',
      isPayment: true,
      skippedAt: null,
    });
  }

  await prisma.transaction.createMany({ data: transactions });

  // Budgets for a few categories, set a few months apart so the carry-
  // forward-until-changed behavior has something to actually carry.
  const budgetCategories = ['Groceries', 'Dining', 'Transport'];
  const oldestMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (MONTHS_BACK - 1), 1),
  );
  const midMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1));
  const budgetRows: Array<{
    userId: string;
    categoryId: string;
    month: number;
    limitAmount: number;
  }> = [];
  for (const name of budgetCategories) {
    const categoryId = categoryIdByName.get(name);
    if (!categoryId) continue;
    budgetRows.push({
      userId: user.id,
      categoryId,
      month: MONTH_KEY(oldestMonth.getUTCFullYear(), oldestMonth.getUTCMonth() + 1),
      limitAmount: 300 + Math.round(rng() * 200),
    });
    budgetRows.push({
      userId: user.id,
      categoryId,
      month: MONTH_KEY(midMonth.getUTCFullYear(), midMonth.getUTCMonth() + 1),
      limitAmount: 350 + Math.round(rng() * 200),
    });
  }
  await prisma.budget.createMany({ data: budgetRows });

  const categoryRuleCount = await prisma.categoryRule.count({ where: { userId: user.id } });

  return {
    userId: user.id,
    accounts: 3,
    categories: categories.length,
    categoryRules: categoryRuleCount,
    transactions: transactions.length,
    budgets: budgetRows.length,
  };
};
