import { test, expect, type Page } from '@playwright/test';
import {
  addTransactionThroughApi,
  configureAiThroughApi,
  lastProviderRequest,
  lastUserMessage,
  programSuggest,
  seedAccountAndCategories,
  signUpFreshUser,
  uniqueApiKey,
} from './fixtures/ai-control';
import { AI_DAILY_SUGGEST_LIMIT } from '@/lib/ai';

/**
 * Shared setup: a fresh user with a configured + verified + disclosure-accepted
 * Anthropic key, driven through the real endpoints (mirroring how other specs
 * build fixture data), plus one eligible uncategorized transaction. The
 * "provider" is the local fixture server; see fixtures/ai-provider-server.ts
 * for why `page.route()` cannot be used here.
 */
type Setup = {
  apiKey: string;
  accountId: string;
  categories: Array<{ id: string; name: string }>;
};

const setUp = async (
  page: Page,
  tag: string,
  toggles?: { sendNote: boolean; sendAmount: boolean },
): Promise<Setup> => {
  const apiKey = uniqueApiKey();
  await signUpFreshUser(page, tag);
  const { accountId, categories } = await seedAccountAndCategories(page);
  await configureAiThroughApi(page, apiKey, toggles);
  return { apiKey, accountId, categories };
};

test('grouped payee cards: a suggestion pre-fills the batch choice and can be applied', async ({
  page,
}) => {
  const { apiKey, accountId, categories } = await setUp(page, 'ai-group');
  const payee = `E2E AI Group ${Date.now()}`;
  await addTransactionThroughApi(page, accountId, { payee });
  await programSuggest(page.request, apiKey, { status: 200, categoryId: categories[0].id });

  await page.goto('/categorize');
  const card = page.getByTestId('payee-group-card').filter({ hasText: payee });
  await expect(card).toBeVisible();

  await card.getByRole('button', { name: 'Suggest with AI' }).click();

  // The suggestion lands in the card's existing batch choice — pre-selected,
  // not applied.
  const chosen = card.getByRole('button', { name: categories[0].name });
  await expect(chosen).toHaveClass(/border-iris/);

  await card.getByRole('button', { name: /^Categorize all 1$/ }).click();
  await expect(card).toBeHidden();

  await page.reload();
  await expect(page.getByTestId('payee-group-card').filter({ hasText: payee })).toHaveCount(0);
});

test('desktop table: the compact button is icon-only and the Select is controlled', async ({
  page,
}) => {
  const { apiKey, accountId, categories } = await setUp(page, 'ai-table');
  const payee = `E2E AI Table ${Date.now()}`;
  await addTransactionThroughApi(page, accountId, { payee });
  await programSuggest(page.request, apiKey, { status: 200, categoryId: categories[1].id });

  await page.goto('/categorize');
  await page.getByRole('button', { name: 'One by one' }).click();
  const row = page.locator('.ledger-row').filter({ hasText: payee });
  await expect(row).toBeVisible();

  const button = row.getByRole('button', { name: 'Suggest with AI' });
  // Compact variant: named only by aria-label, with no visible label text.
  await expect(button).toHaveText('');
  await button.click();

  // Controlled: the Select reflects the suggestion the same way a rule match
  // pre-fills it today.
  await expect(row.locator('select')).toHaveValue(categories[1].id);

  await row.getByRole('button', { name: 'Apply' }).click();
  await expect(row).toBeHidden();
  await page.reload();
  await expect(page.locator('.ledger-row').filter({ hasText: payee })).toHaveCount(0);
});

test.describe('mobile width', () => {
  test.use({ viewport: { width: 402, height: 874 } });

  test('mobile cards: the non-compact icon+label button renders and the chip applies', async ({
    page,
  }) => {
    const { apiKey, accountId, categories } = await setUp(page, 'ai-mobile');
    const payee = `E2E AI Mobile ${Date.now()}`;
    await addTransactionThroughApi(page, accountId, { payee });
    await programSuggest(page.request, apiKey, { status: 200, categoryId: categories[2].id });

    await page.goto('/categorize');
    await page.getByRole('button', { name: 'One by one' }).click();
    const card = page.getByTestId('categorize-card-mobile').filter({ hasText: payee });
    await expect(card).toBeVisible();

    const button = card.getByRole('button', { name: 'Suggest with AI' });
    await expect(button).toHaveText('Suggest with AI');
    await button.click();

    // The suggested chip sorts first and takes the accent treatment.
    const chips = card.getByRole('button').filter({ hasNotText: 'Skip' });
    await expect(chips.nth(1)).toHaveText(categories[2].name);

    await card.getByRole('button', { name: categories[2].name }).click();
    await expect(card).toBeHidden();
  });
});

test('a rule-matched row never offers Suggest at all', async ({ page }) => {
  const { accountId, categories } = await setUp(page, 'ai-rule');
  const payee = `E2E AI Ruled ${Date.now()}`;
  await page.request.post('/api/rules', {
    data: { categoryId: categories[0].id, matchText: payee, priority: 0 },
  });
  await addTransactionThroughApi(page, accountId, { payee });

  await page.goto('/categorize');
  const card = page.getByTestId('payee-group-card').filter({ hasText: payee });
  await expect(card).toBeVisible();
  await expect(card.getByText('Rule match')).toBeVisible();
  // Absent, not merely disabled.
  await expect(card.getByRole('button', { name: 'Suggest with AI' })).toHaveCount(0);
});

const errorCase = async (
  page: Page,
  tag: string,
  programmed: { status?: number; delayMs?: number; categoryId?: string; raw?: unknown },
): Promise<{ page: Page; payee: string }> => {
  const { apiKey, accountId } = await setUp(page, tag);
  const payee = `E2E AI ${tag} ${Date.now()}`;
  await addTransactionThroughApi(page, accountId, { payee });
  await programSuggest(page.request, apiKey, programmed);
  await page.goto('/categorize');
  await page.getByTestId('payee-group-card').filter({ hasText: payee }).waitFor();
  await page
    .getByTestId('payee-group-card')
    .filter({ hasText: payee })
    .getByRole('button', { name: 'Suggest with AI' })
    .click();
  return { page, payee };
};

test('provider 401 surfaces the exact rejected-key copy', async ({ page }) => {
  await errorCase(page, 'ai-e401', { status: 401 });
  await expect(page.getByRole('alert').filter({ hasText: 'API key was rejected' })).toHaveText(
    'Your Anthropic API key was rejected. Check it in Settings and save it again.',
  );
});

test('provider 429 surfaces the exact rate-limit copy', async ({ page }) => {
  await errorCase(page, 'ai-e429', { status: 429 });
  await expect(page.getByRole('alert').filter({ hasText: 'rate-limiting' })).toHaveText(
    'Anthropic is rate-limiting your key right now. Wait a minute and try again.',
  );
});

test('provider 500 surfaces the exact having-trouble copy', async ({ page }) => {
  await errorCase(page, 'ai-e500', { status: 500 });
  await expect(page.getByRole('alert').filter({ hasText: 'having trouble' })).toHaveText(
    'Anthropic is having trouble right now. Try again in a few minutes.',
  );
});

/**
 * The one intentionally slow test in the suite: it waits out the real
 * AI_TIMEOUT_MS (10s). Deliberately not multiplied across providers or render
 * sites — one case is enough to prove the hard timeout fires.
 */
test('a provider that hangs past the timeout surfaces the timed-out copy', async ({ page }) => {
  test.setTimeout(90_000);
  await errorCase(page, 'ai-etimeout', { status: 200, delayMs: 13_000 });
  await expect(page.getByRole('alert').filter({ hasText: 'timed out' })).toHaveText(
    'The request to Anthropic timed out. Try again in a few minutes.',
    { timeout: 30_000 },
  );
});

test('the "none" sentinel is informational, not an alert', async ({ page }) => {
  await errorCase(page, 'ai-enone', { status: 200, categoryId: 'none' });
  await expect(page.getByRole('status').filter({ hasText: 'No confident match' })).toHaveText(
    'No confident match — pick a category yourself.',
  );
  await expect(page.getByRole('alert').filter({ hasText: 'No confident match' })).toHaveCount(0);
});

test('a response naming a category that is not the user\'s reads as "no confident match"', async ({
  page,
}) => {
  await errorCase(page, 'ai-eghost', {
    status: 200,
    raw: {
      content: [{ type: 'tool_use', name: 'pick_category', input: { categoryId: 'cat-ghost' } }],
    },
  });
  await expect(page.getByRole('status').filter({ hasText: 'No confident match' })).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: 'No confident match' })).toHaveCount(0);
});

test('the (N+1)th suggestion of the day hits the local cap', async ({ page }) => {
  test.setTimeout(120_000);
  const { apiKey, accountId, categories } = await setUp(page, 'ai-cap');
  await programSuggest(page.request, apiKey, { status: 200, categoryId: categories[0].id });

  // Spend the whole day's quota through the real endpoint — faster than N UI
  // round trips, and the cap is a server property either way.
  for (let i = 0; i < AI_DAILY_SUGGEST_LIMIT; i += 1) {
    const id = await addTransactionThroughApi(page, accountId, {
      payee: `E2E AI Cap ${i} ${Date.now()}`,
    });
    const response = await page.request.post('/api/categorize/suggest-ai', {
      data: { transactionId: id },
    });
    expect(response.status(), `suggestion ${i + 1} should be under the cap`).toBe(200);
  }

  const overflowPayee = `E2E AI Cap overflow ${Date.now()}`;
  await addTransactionThroughApi(page, accountId, { payee: overflowPayee });
  await page.goto('/categorize');
  await page
    .getByTestId('payee-group-card')
    .filter({ hasText: overflowPayee })
    .getByRole('button', { name: 'Suggest with AI' })
    .click();

  await expect(page.getByRole('alert').filter({ hasText: "today's limit" })).toHaveText(
    `You've hit today's limit of ${AI_DAILY_SUGGEST_LIMIT} AI suggestions. Try again tomorrow.`,
  );
});

test('the note/amount opt-ins are enforced at the real HTTP boundary', async ({ page }) => {
  const { apiKey, accountId, categories } = await setUp(page, 'ai-optin', {
    sendNote: false,
    sendAmount: false,
  });
  const noteToken = `note-token-${Date.now()}`;
  const payee = `E2E AI Optin ${Date.now()}`;
  const transactionId = await addTransactionThroughApi(page, accountId, {
    payee,
    amount: '42.50',
    note: noteToken,
  });
  await programSuggest(page.request, apiKey, { status: 200, categoryId: categories[0].id });

  await page.request.post('/api/categorize/suggest-ai', { data: { transactionId } });
  let sent = await lastProviderRequest(page.request, apiKey);
  expect(lastUserMessage(sent?.body)).toContain(payee);
  expect(lastUserMessage(sent?.body)).not.toContain(noteToken);
  expect(lastUserMessage(sent?.body)).not.toContain('42.50');

  // Data minimization at the real HTTP boundary, not just in the builder: the
  // account name and the transaction date must never leave the server. This is
  // what would catch a future field added to AiSuggestionRequest.
  const wholeBody = JSON.stringify(sent?.body);
  expect(wholeBody).not.toContain('E2E Checking');
  expect(wholeBody).not.toContain(new Date().toISOString().slice(0, 10));
  for (const flag of ['isTransfer', 'isPayment', 'skippedAt', 'accountId']) {
    expect(wholeBody).not.toContain(flag);
  }

  await page.request.patch('/api/settings/ai/toggles', {
    data: { sendNote: true, sendAmount: true },
  });

  const second = await addTransactionThroughApi(page, accountId, {
    payee: `${payee} two`,
    amount: '42.50',
    note: noteToken,
  });
  await page.request.post('/api/categorize/suggest-ai', { data: { transactionId: second } });
  sent = await lastProviderRequest(page.request, apiKey);
  expect(lastUserMessage(sent?.body)).toContain(noteToken);
  expect(lastUserMessage(sent?.body)).toContain('42.50');
});
