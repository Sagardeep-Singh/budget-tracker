import { test, expect } from '@playwright/test';

const uniqueEmail = () => `signup-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;

test('signs up with name/email/password and lands on the dashboard with starter data', async ({
  page,
}) => {
  const email = uniqueEmail();

  await page.goto('/signup');
  await page.getByLabel('Name').fill('New Person');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('a-long-enough-password');
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page).toHaveURL(/\/dashboard/);

  await page.goto('/accounts');
  await expect(page.getByText('Checking').first()).toBeVisible();

  await page.goto('/categories');
  await expect(page.getByText('Groceries').first()).toBeVisible();
});

test('rejects sign-up with an email that already exists', async ({ page }) => {
  await page.goto('/signup');
  await page.getByLabel('Name').fill('Dev');
  await page.getByLabel('Email').fill(process.env.ADMIN_EMAIL ?? 'dev@example.com');
  await page.getByLabel('Password').fill('a-long-enough-password');
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page).toHaveURL(/\/signup/);
});

test('hides the Google option when it is not configured', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('button', { name: /Continue with Google/i })).toHaveCount(0);

  await page.goto('/signup');
  await expect(page.getByRole('button', { name: /Continue with Google/i })).toHaveCount(0);
});
