import { test, expect } from '@playwright/test';

const EMAIL = process.env.ADMIN_EMAIL ?? 'dev@example.com';
const PASSWORD = process.env.ADMIN_PASSWORD ?? 'devpassword123';

const login = async (page: import('@playwright/test').Page): Promise<void> => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);
};

const addUncategorizedTransaction = async (
  page: import('@playwright/test').Page,
  payee: string,
): Promise<void> => {
  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Add transaction' }).click();
  const drawer = page.getByRole('dialog', { name: 'Add transaction' });
  await expect(drawer).toBeVisible();
  await drawer.getByLabel('Payee').fill(payee);
  await drawer.locator('#amount').fill('9.99');
  await drawer.getByRole('button', { name: 'Save transaction' }).click();
  await expect(drawer).toBeHidden();
};

test('skipping a transaction persists — it does not reappear after reload', async ({ page }) => {
  const payee = `E2E Skip ${Date.now()}`;
  await login(page);
  await addUncategorizedTransaction(page, payee);

  await page.goto('/categorize');
  const row = page.locator('.ledger-row').filter({ hasText: payee });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Skip' }).click();
  await expect(row).toBeHidden();

  await page.reload();
  await expect(page.locator('.ledger-row').filter({ hasText: payee })).toHaveCount(0);
});

test('picking a category from the dropdown categorizes immediately, no separate confirm step', async ({
  page,
}) => {
  const payee = `E2E Dropdown ${Date.now()}`;
  await login(page);
  await addUncategorizedTransaction(page, payee);

  await page.goto('/categorize');
  const row = page.locator('.ledger-row').filter({ hasText: payee });
  await expect(row).toBeVisible();

  // No "Change" button and no separate suggestion-accept button — just the
  // dropdown and Skip.
  await expect(row.getByRole('button', { name: 'Change' })).toHaveCount(0);

  await row.locator('select').selectOption({ index: 1 });
  await expect(row).toBeHidden();

  await page.reload();
  await expect(page.locator('.ledger-row').filter({ hasText: payee })).toHaveCount(0);
});

test.describe('mobile width', () => {
  test.use({ viewport: { width: 402, height: 874 } });

  test('tapping a category chip categorizes immediately, no dropdown involved', async ({
    page,
  }) => {
    const payee = `E2E Chip ${Date.now()}`;
    await login(page);
    await addUncategorizedTransaction(page, payee);

    await page.goto('/categorize');
    const card = page.getByTestId('categorize-card-mobile').filter({ hasText: payee });
    await expect(card).toBeVisible();

    // the mobile card has no <select> at all — only chip buttons and Skip
    await expect(card.locator('select')).toHaveCount(0);

    const firstChip = card.getByRole('button').filter({ hasNotText: 'Skip' }).first();
    await firstChip.click();
    await expect(card).toBeHidden();

    await page.reload();
    await expect(page.getByTestId('categorize-card-mobile').filter({ hasText: payee })).toHaveCount(
      0,
    );
  });
});
