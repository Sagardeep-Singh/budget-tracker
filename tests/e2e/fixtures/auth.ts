import { expect, type Page } from '@playwright/test';

/**
 * Signup never signs the user in (so it can't reveal whether an email is
 * already registered); it lands on /login with a neutral banner. Specs that
 * need a fresh, signed-in user go through both steps.
 */
export const signUpThenSignIn = async (
  page: Page,
  { name, email, password }: { name: string; email: string; password: string },
): Promise<void> => {
  await page.goto('/signup');
  await page.getByLabel('Name').fill(name);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/login\?signup=/);

  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);
};
