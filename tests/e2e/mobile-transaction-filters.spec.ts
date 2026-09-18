import { test, expect, type Page } from '@playwright/test';

test.use({ viewport: { width: 402, height: 874 } });

const EMAIL = process.env.ADMIN_EMAIL ?? 'dev@example.com';
const PASSWORD = process.env.ADMIN_PASSWORD ?? 'devpassword123';

const login = async (page: Page): Promise<void> => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);
};

const cta = (page: Page) => page.getByRole('link', { name: /Log a spend/ });
const shell = (page: Page) => page.getByTestId('log-a-spend-mobile');

/** Types an amount by tapping keypad keys, the only amount input this screen has. */
const tapAmount = async (page: Page, amount: string): Promise<void> => {
  for (const char of amount) {
    await shell(page)
      .getByRole('button', { name: char === '.' ? 'Decimal point' : char, exact: true })
      .click();
  }
};

const addTransaction = async (
  page: Page,
  { payee, amount }: { payee: string; amount: string },
): Promise<void> => {
  await cta(page).click();
  await expect(shell(page)).toBeVisible();
  await shell(page).getByLabel('Payee').fill(payee);
  await tapAmount(page, amount);
  await shell(page).getByRole('button', { name: 'Save transaction' }).click();
  await expect(shell(page)).toHaveCount(0);
};

test('the mobile Filters button opens the same filter dialog as desktop and narrows the list via the URL', async ({
  page,
}) => {
  await login(page);
  await page.goto('/transactions');

  const stamp = Date.now();
  const cafePayee = `E2E Mobile Filter Cafe ${stamp}`;
  const rentPayee = `E2E Mobile Filter Rent ${stamp}`;

  await addTransaction(page, { payee: cafePayee, amount: '5.25' });
  await addTransaction(page, { payee: rentPayee, amount: '1500.00' });

  const cafeRow = page.getByTestId('transaction-row-mobile').filter({ hasText: cafePayee });
  const rentRow = page.getByTestId('transaction-row-mobile').filter({ hasText: rentPayee });
  await expect(cafeRow).toBeVisible();
  await expect(rentRow).toBeVisible();

  const filtersButton = page.getByTestId('mobile-filters-button');
  await expect(filtersButton.locator('span')).toHaveCount(0);

  await filtersButton.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.locator('#filter-amount-max').fill('100');
  await dialog.getByRole('button', { name: 'Apply' }).click();
  await expect(dialog).toBeHidden();

  await expect(page).toHaveURL(/amountMax=100/);
  await expect(cafeRow).toBeVisible();
  await expect(rentRow).toBeHidden();

  // The badge reflects the one active group (amount range) from the same
  // dialog state the desktop button reads.
  await expect(filtersButton.locator('span')).toHaveText('1');
});
