import { test, expect, type Page } from '@playwright/test';
import {
  addTransactionThroughApi,
  programProbe,
  seedAccountAndCategories,
  signUpFreshUser,
  uniqueApiKey,
} from './fixtures/ai-control';

/**
 * Every test signs up its own user: `UserAiSettings` is one row per user, so
 * sharing the dev login across `fullyParallel: true` workers would have these
 * tests racing each other's key state. The provider itself is the local fixture
 * server, keyed by the (unique per test) API key — see fixtures/ai-control.ts.
 */

const disclosureDialog = (page: Page) =>
  page.getByRole('dialog').filter({ hasText: 'Review what gets sent' });

const saveKey = async (page: Page, apiKey: string): Promise<void> => {
  await page.locator('#ai-api-key').fill(apiKey);
  await page.getByRole('button', { name: 'Save key' }).click();
};

test('first-time save shows the disclosure; accepting saves and masks the key', async ({
  page,
}) => {
  const apiKey = uniqueApiKey();
  await signUpFreshUser(page, 'ai-settings');
  await seedAccountAndCategories(page);
  await programProbe(page.request, apiKey, { status: 200 });

  await page.goto('/settings');
  await saveKey(page, apiKey);

  const dialog = disclosureDialog(page);
  await expect(dialog).toBeVisible();
  // Past the loading skeleton: the preview is populated from the real endpoint.
  await expect(dialog.getByText('Payee')).toBeVisible();
  await expect(dialog.getByText(/names of all \d+ of your categories/)).toBeVisible();

  await dialog.getByRole('button', { name: 'Looks good, continue' }).click();

  await expect(dialog).toBeHidden();
  await expect(page.locator('#ai-api-key')).toHaveValue('');
  await expect(page.getByText('Anthropic key saved and verified.')).toBeVisible();

  await page.reload();
  await expect(page.getByText('Anthropic key saved and verified.')).toBeVisible();
  await expect(page.locator('#ai-api-key')).toHaveAttribute('placeholder', /a1b2$/);
});

test('swapping to the second provider does not re-show the disclosure', async ({ page }) => {
  const anthropicKey = uniqueApiKey();
  const openaiKey = uniqueApiKey('sk-openai-e2e');
  await signUpFreshUser(page, 'ai-swap');
  await seedAccountAndCategories(page);
  await programProbe(page.request, anthropicKey, { status: 200 });
  await programProbe(page.request, openaiKey, { status: 200 });

  await page.goto('/settings');
  await saveKey(page, anthropicKey);
  await disclosureDialog(page).getByRole('button', { name: 'Looks good, continue' }).click();
  await expect(page.getByText('Anthropic key saved and verified.')).toBeVisible();

  await page.getByRole('button', { name: 'OpenAI', exact: true }).click();
  await saveKey(page, openaiKey);

  // Asserted as a count, not a wait-and-miss: the dialog must never appear.
  await expect(page.getByText('OpenAI key saved and verified.')).toBeVisible();
  await expect(disclosureDialog(page)).toHaveCount(0);
});

test('a key the provider rejects is refused, not persisted', async ({ page }) => {
  const apiKey = uniqueApiKey();
  await signUpFreshUser(page, 'ai-reject');
  await seedAccountAndCategories(page);
  await programProbe(page.request, apiKey, { status: 401 });

  await page.goto('/settings');
  await saveKey(page, apiKey);
  await disclosureDialog(page).getByRole('button', { name: 'Looks good, continue' }).click();

  await expect(
    page.getByRole('alert').filter({ hasText: 'Your Anthropic API key was rejected.' }),
  ).toHaveText('Your Anthropic API key was rejected. Check it in Settings and save it again.');

  await page.reload();
  await expect(page.getByText(/key saved/)).toHaveCount(0);
  await expect(page.locator('#ai-api-key')).toHaveAttribute('placeholder', 'sk-...');
});

test('a provider outage on save persists the key unverified, with an informational notice', async ({
  page,
}) => {
  const apiKey = uniqueApiKey();
  await signUpFreshUser(page, 'ai-outage');
  await seedAccountAndCategories(page);
  await programProbe(page.request, apiKey, { status: 500 });

  await page.goto('/settings');
  await saveKey(page, apiKey);
  await disclosureDialog(page).getByRole('button', { name: 'Looks good, continue' }).click();

  // role="status", not role="alert" — a provider outage is not the user's error.
  await expect(page.getByRole('status').filter({ hasText: 'not yet verified' })).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: 'not yet verified' })).toHaveCount(0);

  await page.reload();
  await expect(page.getByText(/key saved — not yet verified/)).toBeVisible();
});

test('removing the key takes the Suggest affordance away app-wide', async ({ page }) => {
  const apiKey = uniqueApiKey();
  await signUpFreshUser(page, 'ai-remove');
  const { accountId } = await seedAccountAndCategories(page);
  await addTransactionThroughApi(page, accountId, { payee: `Suggestable ${Date.now()}` });
  await programProbe(page.request, apiKey, { status: 200 });

  await page.goto('/settings');
  await saveKey(page, apiKey);
  await disclosureDialog(page).getByRole('button', { name: 'Looks good, continue' }).click();
  await expect(page.getByText('Anthropic key saved and verified.')).toBeVisible();

  await page.goto('/categorize');
  await expect(page.getByRole('button', { name: 'Suggest with AI' }).first()).toBeEnabled();

  await page.goto('/settings');
  await page.getByRole('button', { name: 'Remove key' }).click();
  await expect(page.getByRole('button', { name: 'Remove key' })).toHaveCount(0);

  await page.goto('/categorize');
  const suggest = page.getByRole('button', { name: 'Suggest with AI' });
  const count = await suggest.count();
  if (count > 0) {
    // Accepted alternative to absence: disabled, with the reason on screen.
    await expect(suggest.first()).toBeDisabled();
    await expect(page.getByText('Add an API key in Settings first.').first()).toBeVisible();
  }
});

test('the toggles gate on a configured key and persist independently', async ({ page }) => {
  const apiKey = uniqueApiKey();
  await signUpFreshUser(page, 'ai-toggles');
  await seedAccountAndCategories(page);
  await programProbe(page.request, apiKey, { status: 200 });

  await page.goto('/settings');
  const note = page.getByRole('switch', { name: 'Include the transaction note' });
  const amount = page.getByRole('switch', { name: 'Include the amount' });

  await expect(note).toHaveAttribute('aria-checked', 'false');
  await expect(note).toBeDisabled();
  await expect(amount).toBeDisabled();
  await expect(page.getByText('Save an API key to turn these on.')).toBeVisible();

  await saveKey(page, apiKey);
  await disclosureDialog(page).getByRole('button', { name: 'Looks good, continue' }).click();
  await expect(page.getByText('Anthropic key saved and verified.')).toBeVisible();

  const notePatched = page.waitForResponse(
    (r) => r.url().includes('/api/settings/ai/toggles') && r.ok(),
  );
  await note.click();
  await expect(note).toHaveAttribute('aria-checked', 'true');
  await notePatched;

  await page.reload();
  await expect(page.getByRole('switch', { name: 'Include the transaction note' })).toHaveAttribute(
    'aria-checked',
    'true',
  );

  const amountPatched = page.waitForResponse(
    (r) => r.url().includes('/api/settings/ai/toggles') && r.ok(),
  );
  await page.getByRole('switch', { name: 'Include the amount' }).click();
  await amountPatched;

  await page.reload();
  // One toggle's PATCH must not clobber the other.
  await expect(page.getByRole('switch', { name: 'Include the transaction note' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(page.getByRole('switch', { name: 'Include the amount' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
});
