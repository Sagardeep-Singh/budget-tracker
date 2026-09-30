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

test.use({ viewport: { width: 1280, height: 800 } });

test('the period picked on one screen is what every other screen opens on', async ({ page }) => {
  await login(page);
  const year = new Date().getUTCFullYear();

  await page
    .getByRole('button', { name: /\w+ \d{4}$/ })
    .first()
    .click();
  await page.getByRole('button', { name: 'Jan', exact: true }).first().click();
  await expect(page).toHaveURL(new RegExp(`month=${year}01`));

  for (const path of ['/budgets', '/trends', '/categorize']) {
    await page.goto(path);
    await expect(page.getByRole('button', { name: `January ${year}` }).first()).toBeVisible();
  }

  await page.goto('/transactions');
  await expect(page).toHaveURL(new RegExp(`from=${year}-01-01&to=${year}-01-31`));
  await expect(page.getByRole('button', { name: `January ${year}` }).first()).toBeVisible();

  // All time picked on Transactions carries to Categorize too.
  await page
    .getByRole('button', { name: `January ${year}` })
    .first()
    .click();
  await page.getByRole('button', { name: 'All time' }).first().click();
  await page.goto('/categorize');
  await expect(page.getByRole('button', { name: 'All time' }).first()).toBeVisible();
});

test('typing in the payee search never waits on the server', async ({ page }) => {
  await login(page);
  await page.goto('/transactions');
  await expect(page).toHaveURL(/from=/);

  // Filtering is client-side, so no RSC request should fire while typing.
  let serverRenders = 0;
  page.on('request', (request) => {
    if (request.headers()['rsc'] && request.url().includes('/transactions')) serverRenders += 1;
  });

  const search = page.getByPlaceholder('Search payee', { exact: true });
  await search.click();
  for (const ch of 'coffee') {
    await page.keyboard.type(ch);
    await page.waitForTimeout(350);
  }
  await expect(page).toHaveURL(/payee=coffee/);
  await expect(search).toHaveValue('coffee');
  expect(serverRenders).toBe(0);
});
