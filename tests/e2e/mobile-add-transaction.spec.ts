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

test('the CTA opens a drawer that fits the mobile viewport', async ({ page }) => {
  await login(page);
  await cta(page).click();
  await expect(page).toHaveURL(/overlay=add/);

  const drawer = page.getByRole('dialog', { name: 'Log a transaction' });
  await expect(drawer).toBeVisible();

  const box = await drawer.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width);
});

test('a transaction can be created from the mobile CTA', async ({ page }) => {
  await login(page);
  await page.goto('/transactions');
  await cta(page).click();

  const drawer = page.getByRole('dialog', { name: 'Log a transaction' });
  await expect(drawer).toBeVisible();

  const payee = `E2E Mobile CTA ${Date.now()}`;
  await drawer.getByLabel('Payee').fill(payee);
  await drawer.locator('#amount').fill('7.89');
  await drawer.getByRole('button', { name: 'Save transaction' }).click();

  await expect(drawer).toBeHidden();
  await expect(page).not.toHaveURL(/overlay=add/);
  await expect(page.getByText(payee)).toBeVisible();
});

test('Escape closes the mobile CTA drawer without creating anything', async ({ page }) => {
  await login(page);
  await cta(page).click();

  const drawer = page.getByRole('dialog', { name: 'Log a transaction' });
  await expect(drawer).toBeVisible();

  const payee = `E2E Mobile Escape ${Date.now()}`;
  await drawer.getByLabel('Payee').fill(payee);
  await page.keyboard.press('Escape');

  await expect(drawer).toBeHidden();
  await expect(page).not.toHaveURL(/overlay=add/);

  await page.goto('/transactions');
  await expect(page.getByText(payee)).toHaveCount(0);
});
