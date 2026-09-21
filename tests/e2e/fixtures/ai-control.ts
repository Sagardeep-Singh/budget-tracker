import type { APIRequestContext, Page } from '@playwright/test';

/**
 * Client for the local provider fixture (`ai-provider-server.ts`). Kept in its
 * own module so a spec can import these helpers without importing — and
 * therefore starting — the server itself.
 */
export const AI_FIXTURE_URL = `http://127.0.0.1:${process.env.AI_FIXTURE_PORT ?? 4599}`;

/** Every spec uses its own key: the fixture keys all of its state by the
 * presented key, which is what makes `fullyParallel: true` safe here. */
export const uniqueApiKey = (prefix = 'sk-ant-e2e'): string =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}-a1b2`;

type Programmed = { status?: number; delayMs?: number; categoryId?: string; raw?: unknown };

export const programProbe = async (
  request: APIRequestContext,
  apiKey: string,
  programmed: Programmed,
): Promise<void> => {
  await request.post(`${AI_FIXTURE_URL}/__control/probe?key=${encodeURIComponent(apiKey)}`, {
    data: programmed,
  });
};

export const programSuggest = async (
  request: APIRequestContext,
  apiKey: string,
  programmed: Programmed,
): Promise<void> => {
  await request.post(`${AI_FIXTURE_URL}/__control/suggest?key=${encodeURIComponent(apiKey)}`, {
    data: programmed,
  });
};

export const lastProviderRequest = async (
  request: APIRequestContext,
  apiKey: string,
): Promise<{ url: string; method: string; body: Record<string, unknown> } | null> => {
  const response = await request.get(
    `${AI_FIXTURE_URL}/__control/last-request?key=${encodeURIComponent(apiKey)}`,
  );
  return (await response.json()).lastRequest;
};

/** The user-message text the adapter actually sent, for toggle assertions. */
export const lastUserMessage = (body: Record<string, unknown> | undefined): string => {
  if (!body) return '';
  const messages = body.messages as Array<{ role: string; content: string }> | undefined;
  return messages?.find((m) => m.role === 'user')?.content ?? '';
};

const EMAIL_DOMAIN = 'example.com';

export const signUpFreshUser = async (page: Page, tag: string): Promise<string> => {
  const email = `${tag}-${Date.now()}-${Math.random().toString(36).slice(2)}@${EMAIL_DOMAIN}`;
  await page.goto('/signup');
  await page.getByLabel('Name').fill('AI Person');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('a-long-enough-password');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.waitForURL(/\/dashboard/);
  return email;
};

/**
 * Configure + verify + accept through the real endpoints, mirroring how other
 * specs create fixture data via real API calls rather than a seed script. Used
 * by the Categorize specs, whose subject is the queue, not the Settings form.
 */
export const configureAiThroughApi = async (
  page: Page,
  apiKey: string,
  toggles: { sendNote: boolean; sendAmount: boolean } = { sendNote: false, sendAmount: false },
): Promise<void> => {
  await programProbe(page.request, apiKey, { status: 200 });
  const saved = await page.request.put('/api/settings/ai', {
    data: { provider: 'ANTHROPIC', apiKey, ...toggles },
  });
  if (!saved.ok()) {
    throw new Error(`fixture setup: PUT /api/settings/ai failed with ${saved.status()}`);
  }
  await page.request.post('/api/settings/ai/disclosure');
};

/** A fresh sign-up starts with nothing, so every spec seeds its own account and
 * a small category set through the real endpoints. */
export const seedAccountAndCategories = async (
  page: Page,
  names: string[] = ['Food', 'Fun', 'Bills'],
): Promise<{ accountId: string; categories: Array<{ id: string; name: string }> }> => {
  const account = await page.request.post('/api/accounts', {
    data: { name: 'E2E Checking', type: 'CHECKING', startingBalance: 0 },
  });
  if (!account.ok()) {
    throw new Error(`fixture setup: POST /api/accounts failed with ${account.status()}`);
  }
  const categories: Array<{ id: string; name: string }> = [];
  for (const name of names) {
    const created = await page.request.post('/api/categories', { data: { name } });
    if (!created.ok()) {
      throw new Error(`fixture setup: POST /api/categories failed with ${created.status()}`);
    }
    categories.push(await created.json());
  }
  return { accountId: (await account.json()).id, categories };
};

/** Creates an uncategorized, rule-unmatched transaction via the real API. */
export const addTransactionThroughApi = async (
  page: Page,
  accountId: string,
  fields: { payee: string; amount?: string; note?: string },
): Promise<string> => {
  const created = await page.request.post('/api/transactions', {
    data: {
      accountId,
      amount: fields.amount ?? '9.99',
      type: 'EXPENSE',
      date: new Date().toISOString().slice(0, 10),
      payee: fields.payee,
      ...(fields.note === undefined ? {} : { note: fields.note }),
    },
  });
  if (!created.ok()) {
    throw new Error(`fixture setup: POST /api/transactions failed with ${created.status()}`);
  }
  return (await created.json()).id;
};
