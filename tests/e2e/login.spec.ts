import { test, expect } from '@playwright/test';

const EMAIL = process.env.ADMIN_EMAIL ?? 'dev@example.com';
const PASSWORD = process.env.ADMIN_PASSWORD ?? 'devpassword123';

test('signs in with valid credentials and reaches the dashboard', async ({ page }) => {
  await page.goto('/login');

  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page).toHaveURL(/\/dashboard/);
});

test('shows an error for invalid credentials', async ({ page }) => {
  await page.goto('/login');

  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill('wrong-password');
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});
