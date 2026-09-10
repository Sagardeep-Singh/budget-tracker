import { test, expect } from '@playwright/test';

const EMAIL = process.env.ADMIN_EMAIL ?? 'dev@example.com';
const PASSWORD = process.env.ADMIN_PASSWORD ?? 'devpassword123';

const login = async (page: import('@playwright/test').Page): Promise<void> => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
};

test('global "Log a transaction" opens a right-side drawer, not a centered dialog, and creates a transaction', async ({
  page,
}) => {
  await login(page);

  await page.getByRole('link', { name: /Log a transaction/ }).click();
  await expect(page).toHaveURL(/overlay=add/);

  const drawer = page.getByRole('dialog', { name: 'Log a transaction' });
  await expect(drawer).toBeVisible();

  const box = await drawer.boundingBox();
  expect(box).not.toBeNull();
  // A right-side drawer sits flush against the viewport's right edge and is
  // far narrower than a centered modal — this distinguishes it from Modal.
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  expect(box!.x + box!.width).toBeGreaterThan(viewport!.width - 5);
  expect(box!.width).toBeLessThan(viewport!.width * 0.6);

  const payee = `E2E Drawer Add ${Date.now()}`;
  await drawer.getByLabel('Payee').fill(payee);
  await drawer.locator('#amount').fill('12.34');
  await drawer.getByRole('button', { name: 'Save transaction' }).click();

  await expect(drawer).toBeHidden();
  await expect(page).not.toHaveURL(/overlay=add/);
  await expect(page.getByText(payee)).toBeVisible();
});

test('Escape closes the global add-transaction drawer without creating a transaction', async ({
  page,
}) => {
  await login(page);

  await page.getByRole('link', { name: /Log a transaction/ }).click();
  const drawer = page.getByRole('dialog', { name: 'Log a transaction' });
  await expect(drawer).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await expect(page).not.toHaveURL(/overlay=add/);
});

test('Transactions screen "Add transaction" button opens the same drawer pattern', async ({
  page,
}) => {
  await login(page);
  await page.goto('/transactions');

  await page.getByRole('button', { name: 'Add transaction' }).click();
  const drawer = page.getByRole('dialog', { name: 'Add transaction' });
  await expect(drawer).toBeVisible();

  const payee = `E2E Page Add ${Date.now()}`;
  await drawer.getByLabel('Payee').fill(payee);
  await drawer.locator('#amount').fill('5.00');
  await drawer.getByRole('button', { name: 'Save transaction' }).click();

  await expect(drawer).toBeHidden();
  await expect(page.getByText(payee)).toBeVisible();
});
