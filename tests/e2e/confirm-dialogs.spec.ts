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

test('cancelling a delete confirmation keeps the category', async ({ page }) => {
  await login(page);
  await page.goto('/categories');

  const name = `E2E Cancel ${Date.now()}`;
  await page.getByPlaceholder('New category name').fill(name);
  await page.getByRole('button', { name: 'Add' }).click();

  const row = page.locator('.ledger-row').filter({ hasText: name });
  await row.getByRole('button', { name: 'Delete' }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Delete this category?');

  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(name)).toBeVisible();
});

test('confirming a delete removes the category, Escape dismisses the dialog', async ({ page }) => {
  await login(page);
  await page.goto('/categories');

  const name = `E2E Confirm ${Date.now()}`;
  await page.getByPlaceholder('New category name').fill(name);
  await page.getByRole('button', { name: 'Add' }).click();

  const row = page.locator('.ledger-row').filter({ hasText: name });
  await row.getByRole('button', { name: 'Delete' }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  // Escape dismisses without deleting.
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.getByText(name)).toBeVisible();

  await row.getByRole('button', { name: 'Delete' }).click();
  await dialog.getByRole('button', { name: 'Delete' }).click();

  await expect(page.getByText(name)).toBeHidden();
});
