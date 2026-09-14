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

const ROUTES = ['/dashboard', '/transactions', '/budgets', '/accounts', '/settings', '/trends'];

test('no screen overflows horizontally at 402px', async ({ page }) => {
  await login(page);

  for (const route of ROUTES) {
    await page.goto(route);
    await expect(page.locator('nav[aria-label="Primary"]').nth(1)).toBeVisible();

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));

    expect(
      overflow.scrollWidth,
      `${route} overflows horizontally (${overflow.scrollWidth} > ${overflow.clientWidth})`,
    ).toBeLessThanOrEqual(overflow.clientWidth + 1);
  }
});

test('the Transactions filter row scrolls horizontally instead of wrapping', async ({ page }) => {
  await login(page);
  await page.goto('/transactions');

  const filters = page.getByTestId('transaction-filters');
  await expect(filters).toBeVisible();

  const metrics = await filters.evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
    height: el.getBoundingClientRect().height,
  }));

  // Scrolling (not wrapping) keeps the header a single row tall while the
  // content extends past the container's visible width.
  expect(metrics.scrollWidth).toBeGreaterThan(metrics.clientWidth);
  expect(metrics.height).toBeLessThan(100);
});
