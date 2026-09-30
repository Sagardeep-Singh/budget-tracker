import { test, expect, type Page } from '@playwright/test';

const EMAIL = process.env.ADMIN_EMAIL ?? 'dev@example.com';
const PASSWORD = process.env.ADMIN_PASSWORD ?? 'devpassword123';

const login = async (page: Page): Promise<void> => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);
};

test('clicking a budget card opens its transactions for the same month and category', async ({
  page,
}) => {
  await login(page);

  const stamp = Date.now();
  const created = await page.request.post('/api/categories', {
    data: { name: `E2E Budget Drilldown ${stamp}` },
  });
  expect(created.ok()).toBe(true);
  const category: { id: string; name: string } = await created.json();

  // A past month, so the drill-down has to carry the budget's month rather
  // than falling back to the Transactions default (the current month).
  const month = 202601;
  const budget = await page.request.post('/api/budgets', {
    data: { categoryId: category.id, month, limitAmount: 100 },
  });
  expect(budget.ok()).toBe(true);

  await page.goto(`/budgets?month=${month}`);
  await page.getByRole('link', { name: category.name }).click();

  await expect(page).toHaveURL(/\/transactions\?/);
  const url = new URL(page.url());
  expect(url.searchParams.get('from')).toBe('2026-01-01');
  expect(url.searchParams.get('to')).toBe('2026-01-31');
  expect(url.searchParams.get('categoryIds')).toBe(category.id);
  expect(url.searchParams.get('type')).toBe('EXPENSE');
  // The period selector reflects the budget's month.
  await expect(page.getByRole('button', { name: 'January 2026' }).first()).toBeVisible();
});
