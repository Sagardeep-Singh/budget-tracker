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

test('a CSV with separate credit and debit columns imports credits as income and debits as spending', async ({
  page,
}) => {
  await login(page);
  await page.goto('/import');

  const stamp = Date.now();
  const content = [
    'Date,Description,Debit,Credit,Balance',
    `2026-03-02,E2E Split Grocer ${stamp},"$1,025.40",,500.00`,
    `2026-03-03,E2E Split Payroll ${stamp},,2000.00,2500.00`,
    '2026-03-04,Opening balance,,,2500.00',
  ].join('\n');

  await page.locator('#csvfile').setInputFiles({
    name: `E2E-Split-${stamp}.csv`,
    mimeType: 'text/csv',
    buffer: Buffer.from(content),
  });

  // No "Amount" header, but Debit + Credit are found: the split layout is picked.
  await expect(page.locator('#amountLayout')).toHaveValue('split');
  await expect(page.locator('#creditCol')).toHaveValue('Credit');
  await expect(page.locator('#debitCol')).toHaveValue('Debit');

  await page.getByRole('button', { name: 'Preview' }).click();
  // The balance-only row has neither a credit nor a debit, so it's dropped.
  const importButton = page.getByRole('button', { name: 'Import 2 rows' }).first();
  await expect(importButton).toBeVisible();
  await importButton.click();
  await expect(page.getByText(/Imported 2 transactions/)).toBeVisible();

  await page.goto('/transactions?from=2026-03-01&to=2026-03-31');
  const grocer = page.locator('.ledger-row').filter({ hasText: `E2E Split Grocer ${stamp}` });
  const payroll = page.locator('.ledger-row').filter({ hasText: `E2E Split Payroll ${stamp}` });
  await expect(grocer).toContainText('−1025.40');
  await expect(payroll).toContainText('+2000.00');
});
