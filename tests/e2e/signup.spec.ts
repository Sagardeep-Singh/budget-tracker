import { test, expect, type Page } from '@playwright/test';
import { signUpThenSignIn } from './fixtures/auth';

const BREVO_FIXTURE_URL = `http://127.0.0.1:${process.env.BREVO_FIXTURE_PORT ?? 4598}`;

const uniqueEmail = () => `signup-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;

const lastEmailTo = async (to: string): Promise<{ subject: string; html: string }> => {
  const response = await fetch(`${BREVO_FIXTURE_URL}/__control/last?to=${encodeURIComponent(to)}`);
  if (!response.ok) {
    throw new Error(`no email sent to ${to} yet (status ${response.status})`);
  }
  return response.json();
};

const submitSignup = async (
  page: Page,
  email: string,
  password = 'a-long-enough-password',
): Promise<void> => {
  await page.goto('/signup');
  await page.getByLabel('Name').fill('Someone');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
};

test('signs up with name/email/password, signs in, and lands on an empty dashboard', async ({
  page,
}) => {
  await signUpThenSignIn(page, {
    name: 'New Person',
    email: uniqueEmail(),
    password: 'a-long-enough-password',
  });

  await page.goto('/accounts');
  await expect(page.getByText('No accounts yet.')).toBeVisible();

  await page.goto('/categories');
  await expect(page.getByText('Groceries')).toHaveCount(0);
});

test('a taken email gets the same response as a new one, and the owner is emailed', async ({
  page,
}) => {
  const email = uniqueEmail();

  await submitSignup(page, email);
  await expect(page).toHaveURL(/\/login\?signup=check-email/);
  const firstBanner = await page.getByRole('status').innerText();
  expect((await lastEmailTo(email)).subject).toContain('Verify');

  await submitSignup(page, email, 'a-different-long-password');
  await expect(page).toHaveURL(/\/login\?signup=check-email/);
  expect(await page.getByRole('status').innerText()).toBe(firstBanner);
  await expect(page.locator('form').getByRole('alert')).toHaveCount(0);
  expect((await lastEmailTo(email)).subject).toBe('You already have a Track a Loonie account');

  // The second attempt didn't touch the account: the original password still works.
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('a-different-long-password');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.locator('form').getByRole('alert')).toBeVisible();
  // The form resets after a failed action, so both fields need filling again.
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('a-long-enough-password');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);
});

test('hides the Google option when it is not configured', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('button', { name: /Continue with Google/i })).toHaveCount(0);

  await page.goto('/signup');
  await expect(page.getByRole('button', { name: /Continue with Google/i })).toHaveCount(0);
});
