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

const addTransaction = async (
  page: Page,
  { payee, amount, type }: { payee: string; amount: string; type: 'EXPENSE' | 'INCOME' },
): Promise<void> => {
  await page.getByRole('button', { name: 'Add transaction' }).click();
  const drawer = page.getByRole('dialog', { name: 'Add transaction' });
  await expect(drawer).toBeVisible();
  if (type === 'INCOME') {
    // The type toggle ("Spend"/"Income") sits above the amount field; a
    // category chip can also be named "Income", so scope to the first match.
    await drawer.getByRole('button', { name: 'Income' }).first().click();
  }
  await drawer.getByLabel('Payee').fill(payee);
  await drawer.locator('#amount').fill(amount);
  await drawer.getByRole('button', { name: 'Save transaction' }).click();
  await expect(drawer).toBeHidden();
};

test('payee search filters immediately and the filters dialog applies type + amount range, syncing to the URL', async ({
  page,
}) => {
  await login(page);
  await page.goto('/transactions');

  const stamp = Date.now();
  const coffeePayee = `E2E Filter Coffee ${stamp}`;
  const paycheckPayee = `E2E Filter Paycheck ${stamp}`;

  await addTransaction(page, { payee: coffeePayee, amount: '4.50', type: 'EXPENSE' });
  await addTransaction(page, { payee: paycheckPayee, amount: '900.00', type: 'INCOME' });

  const coffeeRow = page.locator('.ledger-row').filter({ hasText: coffeePayee });
  const paycheckRow = page.locator('.ledger-row').filter({ hasText: paycheckPayee });
  await expect(coffeeRow).toBeVisible();
  await expect(paycheckRow).toBeVisible();

  // The payee search box filters as-you-type, with no "Apply" step.
  await page.getByPlaceholder('Search payee', { exact: true }).fill(`Coffee ${stamp}`);
  await expect(coffeeRow).toBeVisible();
  await expect(paycheckRow).toBeHidden();
  await page.getByPlaceholder('Search payee', { exact: true }).fill('');
  await expect(paycheckRow).toBeVisible();

  // The default current-month range lives in the period selector, not the
  // dialog, so the badge starts empty.
  const filtersButton = page.getByRole('button', { name: /^Filters/ });
  await expect(filtersButton.locator('span')).toHaveCount(0);

  await filtersButton.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  await dialog.getByRole('button', { name: 'Income', exact: true }).click();
  await dialog.getByPlaceholder('Min').fill('100');
  await dialog.getByRole('button', { name: 'Apply' }).click();
  await expect(dialog).toBeHidden();

  // Two active filter groups (type + amount range) -> badge reads "2".
  await expect(filtersButton.locator('span')).toHaveText('2');
  await expect(paycheckRow).toBeVisible();
  await expect(coffeeRow).toBeHidden();

  // Filter state is in the URL and survives a reload.
  await expect(page).toHaveURL(/type=INCOME/);
  await expect(page).toHaveURL(/amountMin=100/);
  await page.reload();
  await expect(page.getByRole('button', { name: /^Filters/ }).locator('span')).toHaveText('2');
  await expect(page.locator('.ledger-row').filter({ hasText: paycheckPayee })).toBeVisible();
  await expect(page.locator('.ledger-row').filter({ hasText: coffeePayee })).toBeHidden();

  // "Reset" inside the dialog clears every group and the badge disappears. The
  // period selector's month stays put.
  await page.getByRole('button', { name: /^Filters/ }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Reset' }).click();
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByRole('button', { name: /^Filters/ }).locator('span')).toHaveCount(0);
  await expect(page.locator('.ledger-row').filter({ hasText: coffeePayee })).toBeVisible();
  await expect(page.locator('.ledger-row').filter({ hasText: paycheckPayee })).toBeVisible();
});

test('the period selector, quick filters and dialog share one URL state', async ({ page }) => {
  await login(page);
  await page.goto('/transactions');
  await expect(page).toHaveURL(/from=\d{4}-\d{2}-01&to=/);

  const now = new Date();
  const monthName = now.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
  const period = page.getByRole('button', { name: `${monthName} ${now.getUTCFullYear()}` });
  await expect(period).toBeVisible();

  // Custom range from the selector writes from/to and relabels the pill.
  await period.click();
  // The picker body also sits in the (hidden) mobile sheet, so scope to the visible one.
  await page
    .getByLabel('From', { exact: true })
    .filter({ visible: true })
    .fill(`${now.getUTCFullYear()}-01-03`);
  await page
    .getByLabel('To', { exact: true })
    .filter({ visible: true })
    .fill(`${now.getUTCFullYear()}-01-20`);
  await page.getByRole('button', { name: 'Apply range' }).click();
  await expect(page).toHaveURL(new RegExp(`from=${now.getUTCFullYear()}-01-03`));
  await expect(page.getByRole('button', { name: /^Jan 3 – Jan 20, \d{4}$/ })).toBeVisible();

  // "Spending" in the dialog is the same filter the mobile pill writes.
  await page.getByRole('button', { name: /^Filters/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Spending', exact: true }).click();
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page).toHaveURL(/type=EXPENSE/);
  // Applying dialog filters keeps the custom range.
  await expect(page).toHaveURL(new RegExp(`from=${now.getUTCFullYear()}-01-03`));
});
