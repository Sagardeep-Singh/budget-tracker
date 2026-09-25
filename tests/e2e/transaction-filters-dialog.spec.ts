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

  // The payee search box needs no "Apply" step: once typing pauses (300ms
  // debounce) the list is re-queried server-side. Wait for that request
  // rather than asserting synchronously after the keystroke.
  const searchSettled = (): Promise<unknown> =>
    page.waitForResponse(
      (r) => r.url().includes('/api/transactions?') && r.url().includes('paginated=1'),
    );
  let settled = searchSettled();
  await page.getByPlaceholder('Search payee', { exact: true }).fill(`Coffee ${stamp}`);
  await settled;
  await expect(coffeeRow).toBeVisible();
  await expect(paycheckRow).toBeHidden();
  settled = searchSettled();
  await page.getByPlaceholder('Search payee', { exact: true }).fill('');
  await settled;
  await expect(paycheckRow).toBeVisible();

  // No filter group active yet: the "Filters" button shows no badge.
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

  // "Reset" inside the dialog clears every group and the badge disappears.
  await page.getByRole('button', { name: /^Filters/ }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Reset' }).click();
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByRole('button', { name: /^Filters/ }).locator('span')).toHaveCount(0);
  await expect(page.locator('.ledger-row').filter({ hasText: coffeePayee })).toBeVisible();
  await expect(page.locator('.ledger-row').filter({ hasText: paycheckPayee })).toBeVisible();
});
