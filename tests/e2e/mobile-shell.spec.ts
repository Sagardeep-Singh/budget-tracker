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

// Both navs carry aria-label="Primary"; the sidebar comes first in the DOM.
const sidebar = (page: import('@playwright/test').Page) =>
  page.locator('nav[aria-label="Primary"]').first();
const bottomNav = (page: import('@playwright/test').Page) =>
  page.locator('nav[aria-label="Primary"]').nth(1);

test.describe('mobile width', () => {
  test.use({ viewport: { width: 402, height: 874 } });

  test('sidebar is hidden and the bottom nav is visible', async ({ page }) => {
    await login(page);

    await expect(sidebar(page)).toBeHidden();
    await expect(bottomNav(page)).toBeVisible();

    for (const label of ['Overview', 'Transactions', 'Categorize', 'Budgets']) {
      await expect(bottomNav(page).getByRole('link', { name: label })).toBeVisible();
    }
    await expect(bottomNav(page).getByRole('button', { name: 'More' })).toBeVisible();
  });

  test('the "More" modal reaches the remaining nav items and closes on navigation', async ({
    page,
  }) => {
    await login(page);

    await bottomNav(page).getByRole('button', { name: 'More' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    for (const label of ['Trends', 'Accounts', 'Rules', 'Import', 'Settings']) {
      await expect(dialog.getByRole('link', { name: label })).toBeVisible();
    }
    await expect(dialog.getByRole('button', { name: 'Sign out' })).toBeVisible();

    await dialog.getByRole('link', { name: 'Settings' }).click();
    await expect(page).toHaveURL(/\/settings/);
    await expect(dialog).toBeHidden();
  });

  test('Overview shows the mobile hero ring, not the desktop one', async ({ page }) => {
    await login(page);

    // Both sizes are in the DOM; only the mobile geometry may be displayed.
    // (:not([role]) excludes the expense pie, which is also 152px wide.)
    await expect(page.locator('svg[width="152"]:not([role])')).toBeHidden();
    await expect(page.locator('svg[width="132"]:not([role])')).toBeVisible();
  });

  test('Overview shows the mobile category rings, not the desktop ones', async ({ page }) => {
    await login(page);

    const mobileCategoryRings = page.locator('svg[width="66"]');
    test.skip((await mobileCategoryRings.count()) === 0, 'no budgets seeded for this user');
    await expect(page.locator('svg[width="88"]').first()).toBeHidden();
    await expect(mobileCategoryRings.first()).toBeVisible();
  });

  test('sidebar and bottom-nav Categorize badge state agree', async ({ page }) => {
    await login(page);

    // Read both regardless of visibility — only one is displayed at a time.
    const sidebarBadge = sidebar(page).locator('a[href="/categorize"] span').last();
    const count = Number((await sidebarBadge.textContent())?.trim() ?? '0');

    const dot = page.getByTestId('nav-dot-categorize');
    if (count > 0) {
      await expect(dot).toHaveCount(1);
      await expect(dot).toHaveClass(/bg-rose/);
    } else {
      await expect(dot).toHaveCount(0);
    }
  });
});

test.describe('desktop width (regression)', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('sidebar is visible and the bottom nav is hidden', async ({ page }) => {
    await login(page);

    await expect(sidebar(page)).toBeVisible();
    await expect(bottomNav(page)).toBeHidden();
    await expect(page.getByRole('link', { name: /Log a transaction/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /Log a spend/ })).toBeHidden();
  });

  test('Overview keeps the desktop hero ring', async ({ page }) => {
    await login(page);

    await expect(page.locator('svg[width="152"]:not([role])')).toBeVisible();
    await expect(page.locator('svg[width="132"]:not([role])')).toBeHidden();
  });

  test('Overview keeps the desktop category rings', async ({ page }) => {
    await login(page);

    const desktopCategoryRings = page.locator('svg[width="88"]');
    test.skip((await desktopCategoryRings.count()) === 0, 'no budgets seeded for this user');
    await expect(desktopCategoryRings.first()).toBeVisible();
    await expect(page.locator('svg[width="66"]').first()).toBeHidden();
  });
});
