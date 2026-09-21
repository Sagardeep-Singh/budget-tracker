import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  prismaMock,
  clientMock,
  getAiProviderClientMock,
  isConfiguredMock,
  loadAiCredentialsMock,
  matchCategoryRuleMock,
} = vi.hoisted(() => {
  const clientMock = {
    provider: 'ANTHROPIC' as const,
    listModels: vi.fn(),
    suggestCategory: vi.fn(),
  };
  return {
    clientMock,
    getAiProviderClientMock: vi.fn(() => clientMock),
    isConfiguredMock: vi.fn(() => true),
    loadAiCredentialsMock: vi.fn(),
    matchCategoryRuleMock: vi.fn<(rules: unknown, text: string) => string | null>(() => null),
    prismaMock: {
      userAiSettings: { findUnique: vi.fn(), updateMany: vi.fn() },
      transaction: { findFirst: vi.fn(), findMany: vi.fn() },
      category: { findMany: vi.fn() },
      categoryRule: { findMany: vi.fn() },
    },
  };
});

vi.mock('@/lib/db/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/crypto/secrets', () => ({ isSecretEncryptionConfigured: isConfiguredMock }));
vi.mock('@/lib/services/aiSettings', () => ({ loadAiCredentials: loadAiCredentialsMock }));
vi.mock('@/lib/services/categorize', async () => {
  const actual = await vi.importActual<typeof import('@/lib/services/categorize')>(
    '@/lib/services/categorize',
  );
  return { ...actual, matchCategoryRule: matchCategoryRuleMock };
});
vi.mock('@/lib/ai', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ai')>('@/lib/ai');
  return { ...actual, getAiProviderClient: getAiProviderClientMock };
});

const { AI_DAILY_SUGGEST_LIMIT } = await import('@/lib/ai');
const {
  AiDisclosureRequiredError,
  AiInvalidResponseError,
  AiProviderAuthError,
  AiProviderUnavailableError,
  AiRateLimitedError,
  AiUnavailableError,
} = await import('@/lib/ai/errors');
const { ServiceValidationError } = await import('@/lib/services/common');
const { buildSuggestionPayload } = await import('@/lib/ai/prompt');
const { suggestCategoryWithAi, getAiDisclosurePreview, formatAiAmount } =
  await import('@/lib/services/aiCategorize');

const CATEGORIES = [
  { id: 'cat-food', name: 'Food' },
  { id: 'cat-fun', name: 'Fun' },
];

const CREDENTIALS = {
  provider: 'ANTHROPIC' as const,
  apiKey: 'sk-ant-decrypted-key-1234',
  sendNote: false,
  sendAmount: false,
  disclosureAccepted: true,
};

const TX = {
  id: 'txn-1',
  payee: 'Blue Bottle',
  note: 'unique-note-token',
  type: 'EXPENSE' as const,
  amount: '12.50',
};

const lastRequest = (): Record<string, unknown> => clientMock.suggestCategory.mock.calls.at(-1)![1];

beforeEach(() => {
  vi.clearAllMocks();
  isConfiguredMock.mockReturnValue(true);
  loadAiCredentialsMock.mockResolvedValue({ ...CREDENTIALS });
  matchCategoryRuleMock.mockReturnValue(null);
  getAiProviderClientMock.mockReturnValue(clientMock);
  prismaMock.userAiSettings.updateMany.mockResolvedValue({ count: 1 });
  prismaMock.transaction.findFirst.mockResolvedValue({ ...TX });
  prismaMock.transaction.findMany.mockResolvedValue([]);
  prismaMock.categoryRule.findMany.mockResolvedValue([]);
  prismaMock.category.findMany.mockResolvedValue(CATEGORIES);
  prismaMock.userAiSettings.findUnique.mockResolvedValue(null);
  clientMock.suggestCategory.mockResolvedValue({ outcome: 'match', categoryId: 'cat-food' });
});

describe('suggestCategoryWithAi — gates, in the documented order', () => {
  it('throws AiUnavailableError and touches no table when the master key is unset', async () => {
    isConfiguredMock.mockReturnValue(false);
    await expect(suggestCategoryWithAi('user-1', 'txn-1')).rejects.toBeInstanceOf(
      AiUnavailableError,
    );
    expect(loadAiCredentialsMock).not.toHaveBeenCalled();
    expect(prismaMock.userAiSettings.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.transaction.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.category.findMany).not.toHaveBeenCalled();
  });

  it('throws "Add an API key in Settings first." before any rate-limit or provider call', async () => {
    loadAiCredentialsMock.mockResolvedValue(null);
    await expect(suggestCategoryWithAi('user-1', 'txn-1')).rejects.toThrowError(
      'Add an API key in Settings first.',
    );
    expect(prismaMock.userAiSettings.updateMany).not.toHaveBeenCalled();
    expect(clientMock.suggestCategory).not.toHaveBeenCalled();
  });

  it('throws AiDisclosureRequiredError before the rate-limit updateManys', async () => {
    loadAiCredentialsMock.mockResolvedValue({ ...CREDENTIALS, disclosureAccepted: false });
    await expect(suggestCategoryWithAi('user-1', 'txn-1')).rejects.toBeInstanceOf(
      AiDisclosureRequiredError,
    );
    expect(prismaMock.userAiSettings.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.transaction.findFirst).not.toHaveBeenCalled();
  });
});

describe('suggestCategoryWithAi — rate limit', () => {
  it('rolls the counter over for a previous day, then claims a slot', async () => {
    await suggestCategoryWithAi('user-1', 'txn-1');

    const [rollover, claim] = prismaMock.userAiSettings.updateMany.mock.calls.map((c) => c[0]);
    expect(rollover.where.userId).toBe('user-1');
    // Covers the never-suggested row too: `NULL <> today` is NULL in SQL, so a
    // bare `{ not: today }` would never roll a fresh row over.
    expect(rollover.where.OR).toEqual([
      { suggestCountDate: null },
      { suggestCountDate: { not: expect.any(Number) } },
    ]);
    expect(rollover.data).toEqual({
      suggestCountDate: expect.any(Number),
      suggestCount: 0,
    });
    expect(claim.where.userId).toBe('user-1');
    expect(claim.where.suggestCount).toEqual({ lt: AI_DAILY_SUGGEST_LIMIT });
    expect(claim.data).toEqual({ suggestCount: { increment: 1 } });
    // Same day key in both statements.
    expect(claim.where.suggestCountDate).toBe(rollover.data.suggestCountDate);
    expect(rollover.where.OR[1].suggestCountDate.not).toBe(rollover.data.suggestCountDate);
  });

  it('throws the local-cap error and makes no provider call when the claim fails', async () => {
    prismaMock.userAiSettings.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 0 });
    const error = await suggestCategoryWithAi('user-1', 'txn-1').catch((e: Error) => e);
    expect(error).toBeInstanceOf(AiRateLimitedError);
    expect((error as Error).message).toBe(
      `You've hit today's limit of ${AI_DAILY_SUGGEST_LIMIT} AI suggestions. Try again tomorrow.`,
    );
    expect(clientMock.suggestCategory).not.toHaveBeenCalled();
    expect(prismaMock.transaction.findFirst).not.toHaveBeenCalled();
  });

  it('lets the first N calls through and only rejects the (N+1)th', async () => {
    for (let i = 0; i < AI_DAILY_SUGGEST_LIMIT; i += 1) {
      await expect(suggestCategoryWithAi('user-1', `txn-${i}`)).resolves.toMatchObject({
        outcome: 'match',
      });
    }
    prismaMock.userAiSettings.updateMany.mockResolvedValue({ count: 0 });
    await expect(suggestCategoryWithAi('user-1', 'txn-overflow')).rejects.toBeInstanceOf(
      AiRateLimitedError,
    );
  });
});

describe('suggestCategoryWithAi — eligibility', () => {
  it('queries with exactly the getCategorizeQueue predicate plus the id', async () => {
    await suggestCategoryWithAi('user-1', 'txn-1');
    expect(prismaMock.transaction.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'txn-1',
        userId: 'user-1',
        categoryId: null,
        skippedAt: null,
        isTransfer: false,
        isPayment: false,
      },
    });
  });

  it.each([
    'already categorized',
    'skipped',
    'a transfer leg',
    'a card payment',
    "another user's row",
  ])('rejects a row that is %s (the where-clause simply misses)', async () => {
    prismaMock.transaction.findFirst.mockResolvedValue(null);
    await expect(suggestCategoryWithAi('user-1', 'txn-1')).rejects.toThrowError(
      'That transaction is no longer in the categorize queue.',
    );
    expect(clientMock.suggestCategory).not.toHaveBeenCalled();
  });

  it('refuses a row a rule already matches, without calling the provider', async () => {
    matchCategoryRuleMock.mockReturnValue('cat-food');
    const error = await suggestCategoryWithAi('user-1', 'txn-1').catch((e: Error) => e);
    expect(error).toBeInstanceOf(ServiceValidationError);
    expect((error as Error).message).toBe('A rule already categorizes this transaction.');
    expect(clientMock.suggestCategory).not.toHaveBeenCalled();
  });

  it('short-circuits a zero-category user without a network call, after spending the slot', async () => {
    prismaMock.category.findMany.mockResolvedValue([]);
    await expect(suggestCategoryWithAi('user-1', 'txn-1')).resolves.toEqual({ outcome: 'none' });
    expect(clientMock.suggestCategory).not.toHaveBeenCalled();
    // The claim happens at step 4, before this short-circuit at step 7.
    expect(prismaMock.userAiSettings.updateMany).toHaveBeenCalledTimes(2);
  });
});

describe('suggestCategoryWithAi — opt-in toggles', () => {
  it('sends neither note nor amount when both toggles are off', async () => {
    await suggestCategoryWithAi('user-1', 'txn-1');
    expect(lastRequest()).not.toHaveProperty('note');
    expect(lastRequest()).not.toHaveProperty('amount');
    expect(lastRequest()).toMatchObject({ payee: 'Blue Bottle', type: 'EXPENSE' });
  });

  it('sends the note verbatim when sendNote is on', async () => {
    loadAiCredentialsMock.mockResolvedValue({ ...CREDENTIALS, sendNote: true });
    await suggestCategoryWithAi('user-1', 'txn-1');
    expect(lastRequest().note).toBe('unique-note-token');
  });

  it('sends the amount as a fixed-2 string when sendAmount is on', async () => {
    loadAiCredentialsMock.mockResolvedValue({ ...CREDENTIALS, sendAmount: true });
    await suggestCategoryWithAi('user-1', 'txn-1');
    expect(lastRequest().amount).toBe('12.50');
  });

  it('sends "0.00" for a zero amount rather than omitting it', async () => {
    loadAiCredentialsMock.mockResolvedValue({ ...CREDENTIALS, sendAmount: true });
    prismaMock.transaction.findFirst.mockResolvedValue({ ...TX, amount: 0 });
    await suggestCategoryWithAi('user-1', 'txn-1');
    expect(lastRequest().amount).toBe('0.00');
  });

  it('formats the Decimal(12,2) ceiling without breaking', async () => {
    loadAiCredentialsMock.mockResolvedValue({ ...CREDENTIALS, sendAmount: true });
    prismaMock.transaction.findFirst.mockResolvedValue({ ...TX, amount: '9999999999.99' });
    await suggestCategoryWithAi('user-1', 'txn-1');
    expect(lastRequest().amount).toBe('9999999999.99');
  });

  it('rounds extra precision the same way the rest of the app does', async () => {
    loadAiCredentialsMock.mockResolvedValue({ ...CREDENTIALS, sendAmount: true });
    prismaMock.transaction.findFirst.mockResolvedValue({ ...TX, amount: '19.999' });
    await suggestCategoryWithAi('user-1', 'txn-1');
    expect(lastRequest().amount).toBe('20.00');
  });

  it('omits the note when the transaction has none, even with sendNote on', async () => {
    loadAiCredentialsMock.mockResolvedValue({ ...CREDENTIALS, sendNote: true });
    prismaMock.transaction.findFirst.mockResolvedValue({ ...TX, note: null });
    await suggestCategoryWithAi('user-1', 'txn-1');
    expect(lastRequest()).not.toHaveProperty('note');
  });
});

describe('suggestCategoryWithAi — result mapping', () => {
  it('resolves the category name from the already-loaded list, with no second round trip', async () => {
    await expect(suggestCategoryWithAi('user-1', 'txn-1')).resolves.toEqual({
      outcome: 'match',
      categoryId: 'cat-food',
      categoryName: 'Food',
    });
    expect(prismaMock.category.findMany).toHaveBeenCalledTimes(1);
  });

  it('maps the provider "none" outcome straight through', async () => {
    clientMock.suggestCategory.mockResolvedValue({ outcome: 'none' });
    await expect(suggestCategoryWithAi('user-1', 'txn-1')).resolves.toEqual({ outcome: 'none' });
  });

  it('turns an id outside the loaded list into { outcome: none }, never a throw', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    clientMock.suggestCategory.mockResolvedValue({ outcome: 'match', categoryId: 'cat-ghost' });
    await expect(suggestCategoryWithAi('user-1', 'txn-1')).resolves.toEqual({ outcome: 'none' });
    warn.mockRestore();
  });

  it('catches AiInvalidResponseError and returns { outcome: none }, logging name only', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    clientMock.suggestCategory.mockRejectedValue(new AiInvalidResponseError('ANTHROPIC'));
    await expect(suggestCategoryWithAi('user-1', 'txn-1')).resolves.toEqual({ outcome: 'none' });
    expect(JSON.stringify(warn.mock.calls)).not.toContain(CREDENTIALS.apiKey);
    warn.mockRestore();
  });

  it.each([
    ['AiProviderAuthError', new AiProviderAuthError('ANTHROPIC'), AiProviderAuthError],
    [
      'AiRateLimitedError (provider 429)',
      new AiRateLimitedError({ reason: 'provider', provider: 'ANTHROPIC' }),
      AiRateLimitedError,
    ],
    [
      'AiProviderUnavailableError',
      new AiProviderUnavailableError('ANTHROPIC', 'server'),
      AiProviderUnavailableError,
    ],
  ])('propagates %s rather than swallowing it', async (_label, thrown, ctor) => {
    clientMock.suggestCategory.mockRejectedValue(thrown);
    await expect(suggestCategoryWithAi('user-1', 'txn-1')).rejects.toBeInstanceOf(ctor);
  });

  it('never leaks the decrypted key in a propagated error', async () => {
    clientMock.suggestCategory.mockRejectedValue(new AiProviderAuthError('ANTHROPIC'));
    const error = await suggestCategoryWithAi('user-1', 'txn-1').catch((e: Error) => e);
    expect(`${(error as Error).message}${(error as Error).stack}`).not.toContain(
      CREDENTIALS.apiKey,
    );
  });
});

describe('getAiDisclosurePreview', () => {
  it('builds from the most recent eligible, unmatched queue row', async () => {
    prismaMock.userAiSettings.findUnique.mockResolvedValue({ sendNote: true, sendAmount: true });
    prismaMock.transaction.findMany.mockResolvedValue([
      { payee: 'Blue Bottle', note: 'unique-note-token', type: 'EXPENSE', amount: '12.50' },
    ]);

    const preview = await getAiDisclosurePreview('user-1');

    expect(preview.exampleFromRealTransaction).toBe(true);
    expect(preview.categoryCount).toBe(2);
    expect(preview.fields).toEqual([
      { label: 'Payee', value: 'Blue Bottle' },
      { label: 'Type', value: 'EXPENSE' },
      { label: 'Note', value: 'unique-note-token' },
      { label: 'Amount', value: '12.50' },
    ]);

    // No drift: every previewed value is literally in the built payload.
    const payload = buildSuggestionPayload({
      payee: 'Blue Bottle',
      type: 'EXPENSE',
      categories: CATEGORIES,
      note: 'unique-note-token',
      amount: '12.50',
    });
    for (const field of preview.fields) {
      expect(payload.user).toContain(field.value);
    }
  });

  it('skips rule-matched rows when choosing the example', async () => {
    prismaMock.transaction.findMany.mockResolvedValue([
      { payee: 'Matched', note: null, type: 'EXPENSE', amount: '1.00' },
      { payee: 'Unmatched', note: null, type: 'EXPENSE', amount: '2.00' },
    ]);
    matchCategoryRuleMock.mockImplementation((_rules: unknown, text: string) =>
      text.includes('Matched') ? 'cat-food' : null,
    );
    const preview = await getAiDisclosurePreview('user-1');
    expect(preview.fields[0]).toEqual({ label: 'Payee', value: 'Unmatched' });
  });

  it('falls back to a synthetic example when the queue is empty', async () => {
    prismaMock.transaction.findMany.mockResolvedValue([]);
    const preview = await getAiDisclosurePreview('user-1');
    expect(preview.exampleFromRealTransaction).toBe(false);
    expect(preview.fields.length).toBeGreaterThan(0);
  });

  it('honours the stored toggles — no note or amount field when both are off', async () => {
    prismaMock.userAiSettings.findUnique.mockResolvedValue({ sendNote: false, sendAmount: false });
    prismaMock.transaction.findMany.mockResolvedValue([
      { payee: 'Blue Bottle', note: 'unique-note-token', type: 'EXPENSE', amount: '12.50' },
    ]);
    const preview = await getAiDisclosurePreview('user-1');
    expect(preview.fields.map((f) => f.label)).toEqual(['Payee', 'Type']);
    expect(JSON.stringify(preview)).not.toContain('unique-note-token');
  });

  it('checks no gate — no disclosure check, no rate-limit write, no provider call', async () => {
    await getAiDisclosurePreview('user-1');
    expect(prismaMock.userAiSettings.updateMany).not.toHaveBeenCalled();
    expect(clientMock.suggestCategory).not.toHaveBeenCalled();
    expect(loadAiCredentialsMock).not.toHaveBeenCalled();
  });

  it('scopes every query by userId', async () => {
    await getAiDisclosurePreview('user-1');
    const calls = [
      prismaMock.userAiSettings.findUnique,
      prismaMock.category.findMany,
      prismaMock.categoryRule.findMany,
      prismaMock.transaction.findMany,
    ];
    for (const call of calls) {
      expect(call.mock.calls[0][0].where.userId).toBe('user-1');
    }
  });

  it.each([
    ['0', '0.00'],
    ['19.999', '20.00'],
  ])('formats %s identically in the preview and in the outbound request', async (raw, expected) => {
    prismaMock.userAiSettings.findUnique.mockResolvedValue({
      sendNote: false,
      sendAmount: true,
    });
    const tx = { payee: 'Blue Bottle', note: null, type: 'EXPENSE' as const, amount: raw };
    prismaMock.transaction.findMany.mockResolvedValue([tx]);
    prismaMock.transaction.findFirst.mockResolvedValue({ id: 'txn-1', ...tx });
    loadAiCredentialsMock.mockResolvedValue({ ...CREDENTIALS, sendAmount: true });

    const preview = await getAiDisclosurePreview('user-1');
    await suggestCategoryWithAi('user-1', 'txn-1');

    const previewAmount = preview.fields.find((f) => f.label === 'Amount')!.value;
    expect(previewAmount).toBe(expected);
    expect(lastRequest().amount).toBe(previewAmount);
    expect(formatAiAmount(raw)).toBe(expected);
  });
});

describe('suggestCategoryWithAi — every query is userId-scoped', () => {
  it('passes userId in the where clause of each Prisma call it makes', async () => {
    await suggestCategoryWithAi('user-1', 'txn-1');
    const wheres = [
      ...prismaMock.userAiSettings.updateMany.mock.calls.map((c) => c[0].where),
      ...prismaMock.transaction.findFirst.mock.calls.map((c) => c[0].where),
      ...prismaMock.categoryRule.findMany.mock.calls.map((c) => c[0].where),
      ...prismaMock.category.findMany.mock.calls.map((c) => c[0].where),
    ];
    expect(wheres.length).toBeGreaterThan(0);
    for (const where of wheres) {
      expect(where.userId).toBe('user-1');
    }
  });
});
