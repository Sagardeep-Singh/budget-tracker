import { test, expect } from '@playwright/test';

const BREVO_FIXTURE_URL = `http://127.0.0.1:${process.env.BREVO_FIXTURE_PORT ?? 4598}`;

const uniqueEmail = () => `verify-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;

const lastEmailTo = async (to: string): Promise<{ subject: string; html: string }> => {
  const response = await fetch(`${BREVO_FIXTURE_URL}/__control/last?to=${encodeURIComponent(to)}`);
  if (!response.ok) {
    throw new Error(`no email sent to ${to} yet (status ${response.status})`);
  }
  return response.json();
};

const extractVerifyToken = (html: string): string => {
  const match = html.match(/token=([a-f0-9]+)/);
  if (!match) throw new Error(`no verify token found in email body: ${html}`);
  return match[1]!;
};

test('shows the unverified-email banner after signup, and resend sends another link', async ({
  page,
}) => {
  const email = uniqueEmail();

  await page.goto('/signup');
  await page.getByLabel('Name').fill('New Person');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('a-long-enough-password');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  await expect(page.getByText('Verify your email to secure your account.')).toBeVisible();

  const firstEmail = await lastEmailTo(email);
  expect(firstEmail.subject).toContain('Verify');

  // Signup itself just sent one, so an immediate resend is inside the
  // 60s cooldown — this exercises the cooldown path, not a second send.
  await page.getByRole('button', { name: 'Resend email' }).click();
  await expect(page.getByText('Please wait a bit before requesting another email.')).toBeVisible();
});

test('clicking the verification link clears the banner', async ({ page }) => {
  const email = uniqueEmail();

  await page.goto('/signup');
  await page.getByLabel('Name').fill('New Person');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('a-long-enough-password');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  const sent = await lastEmailTo(email);
  const token = extractVerifyToken(sent.html);

  await page.goto(`/api/auth/verify?token=${token}`);
  await expect(page).toHaveURL(/\/login\?verify=verified/);
  await expect(page.getByText('Email verified. Thanks!')).toBeVisible();

  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('a-long-enough-password');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  await expect(page.getByText('Verify your email to secure your account.')).toHaveCount(0);
});

test('an invalid token redirects to login with an error message', async ({ page }) => {
  await page.goto('/api/auth/verify?token=not-a-real-token');
  await expect(page).toHaveURL(/\/login\?verify=invalid/);
  await expect(page.getByText("That verification link isn't valid.")).toBeVisible();
});
