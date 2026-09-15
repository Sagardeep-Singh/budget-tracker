import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 402, height: 874 } });

const EMAIL = process.env.ADMIN_EMAIL ?? 'dev@example.com';
const PASSWORD = process.env.ADMIN_PASSWORD ?? 'devpassword123';
const BOTTOM_NAV_HEIGHT = 60;

const login = async (page: import('@playwright/test').Page): Promise<void> => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);
};

test('the bottom nav stays clickable on Transactions while the CTA is present', async ({
  page,
}) => {
  await login(page);
  await page.goto('/transactions');

  const bottomNav = page.locator('nav[aria-label="Primary"]').nth(1);
  await expect(bottomNav).toBeVisible();
  await expect(page.getByRole('link', { name: /Log a spend/ })).toBeVisible();

  const budgets = bottomNav.getByRole('link', { name: 'Budgets' });
  await expect(budgets).toBeInViewport();
  await budgets.click();
  await expect(page).toHaveURL(/\/budgets/);
});

test('the last transaction row clears the fixed bottom nav', async ({ page }) => {
  await login(page);
  await page.goto('/transactions');

  const rows = page.getByTestId('transaction-row-mobile');
  const count = await rows.count();
  test.skip(count === 0, 'no transactions seeded for this user');

  const lastRow = rows.last();
  await expect(lastRow).toBeVisible();
  await lastRow.scrollIntoViewIfNeeded();
  await expect(lastRow).toBeInViewport();

  const box = await lastRow.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  // Scrolled to the end, the last row must sit above the fixed bottom nav
  // rather than underneath it — that's what the screen's bottom padding buys.
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height - BOTTOM_NAV_HEIGHT);
});
