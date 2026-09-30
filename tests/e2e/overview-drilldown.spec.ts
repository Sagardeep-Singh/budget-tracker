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

// A past month, so every link has to carry Overview's month rather than
// falling back to the Transactions default.
const MONTH = 202602;

const seed = async (page: Page, payee: string): Promise<{ id: string }> => {
  const accounts: Array<{ id: string }> = await (await page.request.get('/api/accounts')).json();
  const created = await page.request.post('/api/transactions', {
    data: {
      accountId: accounts[0].id,
      type: 'EXPENSE',
      amount: 12.34,
      date: '2026-02-10',
      payee,
    },
  });
  expect(created.ok()).toBe(true);
  return created.json();
};

test('Out on Overview opens the month’s spending in Transactions', async ({ page }) => {
  await login(page);
  await seed(page, `E2E Drilldown Out ${Date.now()}`);

  await page.goto(`/dashboard?month=${MONTH}`);
  await page.getByRole('link', { name: /^Out/ }).first().click();

  await expect(page).toHaveURL(/\/transactions\?/);
  const url = new URL(page.url());
  expect(url.searchParams.get('from')).toBe('2026-02-01');
  expect(url.searchParams.get('to')).toBe('2026-02-28');
  expect(url.searchParams.get('type')).toBe('EXPENSE');
  expect(url.searchParams.get('hideTransfers')).toBe('true');
});

test('a day panel row opens that transaction’s drawer on Transactions', async ({ page }) => {
  await login(page);
  const payee = `E2E Drilldown Row ${Date.now()}`;
  const tx = await seed(page, payee);

  await page.goto(`/dashboard?month=${MONTH}&day=10`);
  await page.getByTestId('day-panel-desktop').getByRole('link', { name: payee }).click();

  await expect(page).toHaveURL(new RegExp(`tx=${tx.id}`));
  const drawer = page.getByRole('dialog');
  await expect(drawer.getByText(payee).first()).toBeVisible();

  await drawer.getByRole('button', { name: /close/i }).first().click();
  await expect(page).not.toHaveURL(/tx=/);
  expect(new URL(page.url()).searchParams.get('from')).toBe('2026-02-10');
});
