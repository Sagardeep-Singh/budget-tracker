import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 402, height: 874 } });

const EMAIL = process.env.ADMIN_EMAIL ?? 'dev@example.com';
const PASSWORD = process.env.ADMIN_PASSWORD ?? 'devpassword123';

const login = async (page: import('@playwright/test').Page): Promise<void> => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);
};

const cta = (page: import('@playwright/test').Page) =>
  page.getByRole('link', { name: /Log a spend/ });

const shell = (page: import('@playwright/test').Page) => page.getByTestId('log-a-spend-mobile');

/** Types an amount by tapping keypad keys, the only input this screen has. */
const tapAmount = async (page: import('@playwright/test').Page, amount: string): Promise<void> => {
  for (const char of amount) {
    await shell(page)
      .getByRole('button', { name: char === '.' ? 'Decimal point' : char, exact: true })
      .click();
  }
};

test('the sticky CTA appears on Overview and Transactions only', async ({ page }) => {
  await login(page);
  await expect(cta(page)).toBeVisible();

  await page.goto('/transactions');
  await expect(cta(page)).toBeVisible();

  for (const route of ['/budgets', '/accounts', '/settings']) {
    await page.goto(route);
    await expect(cta(page)).toHaveCount(0);
  }
});

test('the CTA opens the full-screen keypad shell, not the desktop drawer', async ({ page }) => {
  await login(page);
  await cta(page).click();
  await expect(page).toHaveURL(/overlay=add/);

  await expect(shell(page)).toBeVisible();
  await expect(shell(page).getByRole('button', { name: '7', exact: true })).toBeVisible();
  // No text amount field in this shell; the desktop form's #amount is in the
  // DOM but hidden behind the lg-only wrapper.
  await expect(shell(page).locator('input[type="number"]')).toHaveCount(0);
  await expect(page.locator('#amount')).toBeHidden();

  const box = await shell(page).boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(box!.x).toBe(0);
  expect(box!.width).toBe(viewport!.width);
});

test('the Transactions header "Add transaction" button is desktop-only', async ({ page }) => {
  await login(page);
  await page.goto('/transactions');
  await expect(page.getByRole('button', { name: 'Add transaction' })).toBeHidden();
  await expect(cta(page)).toBeVisible();
});

test('a transaction can be created with the keypad', async ({ page }) => {
  await login(page);
  await page.goto('/transactions');
  await cta(page).click();
  await expect(shell(page)).toBeVisible();

  const payee = `E2E Keypad ${Date.now()}`;
  await shell(page).getByLabel('Payee').fill(payee);
  await tapAmount(page, '7.89');

  await shell(page).getByRole('button', { name: 'Save transaction' }).click();

  await expect(shell(page)).toHaveCount(0);
  await expect(page).not.toHaveURL(/overlay=add/);
  await expect(page.getByText(payee)).toBeVisible();
});

test('Save stays blocked until the keypad holds a valid amount', async ({ page }) => {
  await login(page);
  await cta(page).click();

  const save = shell(page).getByRole('button', { name: 'Save transaction' });
  await expect(save).toBeDisabled();

  // A lone decimal point is a state a native number input can never reach.
  await tapAmount(page, '.');
  await expect(save).toBeDisabled();

  await tapAmount(page, '5');
  await expect(save).toBeEnabled();

  await shell(page).getByRole('button', { name: 'Delete last digit' }).click();
  await expect(save).toBeDisabled();
});

test('Escape closes the keypad shell without creating anything', async ({ page }) => {
  await login(page);
  await cta(page).click();
  await expect(shell(page)).toBeVisible();

  const payee = `E2E Keypad Escape ${Date.now()}`;
  await shell(page).getByLabel('Payee').fill(payee);
  await tapAmount(page, '3');
  await page.keyboard.press('Escape');

  await expect(shell(page)).toHaveCount(0);
  await expect(page).not.toHaveURL(/overlay=add/);
  // Closing must release the body scroll lock — two overlays mount at once
  // here (the hidden desktop drawer and this shell), so it is easy to leave
  // one lock behind.
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');

  await page.goto('/transactions');
  await expect(page.getByText(payee)).toHaveCount(0);
});

test('Cancel closes the keypad shell without creating anything', async ({ page }) => {
  await login(page);
  await cta(page).click();

  const payee = `E2E Keypad Cancel ${Date.now()}`;
  await shell(page).getByLabel('Payee').fill(payee);
  await tapAmount(page, '4');
  // `exact` matters: the dev database has category chips whose names contain
  // "Cancel" from earlier runs.
  await shell(page).getByRole('button', { name: 'Cancel', exact: true }).click();

  await expect(shell(page)).toHaveCount(0);
  await expect(page).not.toHaveURL(/overlay=add/);

  await page.goto('/transactions');
  await expect(page.getByText(payee)).toHaveCount(0);
});

test('a category is still suggested from the payee on the keypad screen', async ({ page }) => {
  await login(page);
  await cta(page).click();
  await expect(shell(page)).toBeVisible();

  // "Starbucks" matches a seeded Dining rule.
  await shell(page).getByLabel('Payee').fill('Starbucks');
  await expect(shell(page).getByText('(suggested)')).toBeVisible({ timeout: 5000 });
});
