import { test, expect, type Page } from '@playwright/test';

const EMAIL = process.env.ADMIN_EMAIL ?? 'dev@example.com';
const PASSWORD = process.env.ADMIN_PASSWORD ?? 'devpassword123';

const login = async (page: Page): Promise<void> => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
};

const csv = (payee: string): string => `Date,Amount,Payee\n2026-03-01,-12.34,${payee}\n`;

const importFile = async (page: Page, filename: string, payee: string): Promise<void> => {
  await page.goto('/import');
  await page.locator('#csvfile').setInputFiles({
    name: filename,
    mimeType: 'text/csv',
    buffer: Buffer.from(csv(payee)),
  });
  await expect(page.locator('#account')).toBeVisible();
  await page.getByRole('button', { name: 'Preview' }).click();
  await page.getByRole('button', { name: /^Import 1 rows$/ }).click();
  await expect(page.getByText(/Imported 1 transaction/)).toBeVisible();
};

test('an imported row shows a non-interactive filename chip and links to history from the drawer', async ({
  page,
}) => {
  await login(page);

  const stamp = Date.now();
  const filename = `E2E-Chip-${stamp}.csv`;
  const payee = `E2E Chip ${stamp}`;
  await importFile(page, filename, payee);

  await page.goto('/transactions');
  const row = page.locator('.ledger-row').filter({ hasText: payee });
  await expect(row).toContainText(filename);

  // clicking the chip opens the detail drawer, it does not navigate
  await row.getByText(filename).click();
  await expect(page).toHaveURL(/\/transactions$/);
  const drawer = page.getByRole('dialog', { name: 'Transaction' });
  await expect(drawer).toBeVisible();

  const link = drawer.getByRole('link', { name: `Imported from ${filename}` });
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/import\/history\/[^/]+$/);
  await expect(page.getByText(filename)).toBeVisible();
});

test('a manually entered transaction shows no import indicator anywhere', async ({ page }) => {
  await login(page);
  await page.goto('/transactions');

  const payee = `E2E Manual ${Date.now()}`;
  await page.getByRole('button', { name: 'Add transaction' }).click();
  const addDrawer = page.getByRole('dialog', { name: 'Add transaction' });
  await addDrawer.getByLabel('Payee').fill(payee);
  await addDrawer.locator('#amount').fill('7.50');
  await addDrawer.getByRole('button', { name: 'Save transaction' }).click();
  await expect(addDrawer).toBeHidden();

  const row = page.locator('.ledger-row').filter({ hasText: payee });
  await expect(row).toBeVisible();
  await expect(row).not.toContainText('.csv');

  await row.click();
  const drawer = page.getByRole('dialog', { name: 'Transaction' });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText('Imported from')).toBeHidden();
});
