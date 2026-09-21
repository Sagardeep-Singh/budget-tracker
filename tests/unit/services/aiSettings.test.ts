import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock, cryptoMock, clientMock, getAiProviderClientMock } = vi.hoisted(() => {
  const clientMock = {
    provider: 'ANTHROPIC' as const,
    listModels: vi.fn(),
    suggestCategory: vi.fn(),
  };
  return {
    clientMock,
    getAiProviderClientMock: vi.fn(() => clientMock),
    prismaMock: {
      userAiSettings: {
        findUnique: vi.fn(),
        upsert: vi.fn(),
        updateMany: vi.fn(),
        deleteMany: vi.fn(),
      },
    },
    cryptoMock: {
      encryptSecret: vi.fn((plaintext: string) => `v1:iv:tag:ct-of-${plaintext.length}`),
      decryptSecret: vi.fn(() => 'sk-ant-decrypted-key-1234'),
      isSecretEncryptionConfigured: vi.fn(() => true),
    },
  };
});

vi.mock('@/lib/db/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/crypto/secrets', () => cryptoMock);
vi.mock('@/lib/ai', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ai')>('@/lib/ai');
  return { ...actual, getAiProviderClient: getAiProviderClientMock };
});

const { AiProviderAuthError, AiProviderUnavailableError, AiRateLimitedError } =
  await import('@/lib/ai/errors');
const { ServiceValidationError } = await import('@/lib/services/common');
const aiSettingsModule = await import('@/lib/services/aiSettings');
const {
  getAiSettings,
  saveAiSettings,
  updateAiToggles,
  acceptAiDisclosure,
  removeAiSettings,
  loadAiCredentials,
} = aiSettingsModule;

const API_KEY = 'sk-ant-e2e-fixture-key-a1b2';

const SAVE_INPUT = {
  provider: 'ANTHROPIC' as const,
  apiKey: API_KEY,
  sendNote: false,
  sendAmount: false,
};

const row = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'ai-1',
  userId: 'user-1',
  provider: 'ANTHROPIC',
  encryptedApiKey: 'v1:iv:tag:ct',
  keyLast4: 'a1b2',
  verifiedAt: new Date('2026-09-01T00:00:00.000Z'),
  sendNote: false,
  sendAmount: false,
  disclosureAcceptedAt: new Date('2026-09-01T00:00:00.000Z'),
  suggestCountDate: null,
  suggestCount: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const FRONTEND_KEYS = [
  'configured',
  'provider',
  'maskedKey',
  'verified',
  'sendNote',
  'sendAmount',
  'disclosureAccepted',
  'available',
];

beforeEach(() => {
  vi.clearAllMocks();
  cryptoMock.isSecretEncryptionConfigured.mockReturnValue(true);
  cryptoMock.encryptSecret.mockImplementation(
    (plaintext: string) => `v1:iv:tag:ct-of-${plaintext.length}`,
  );
  getAiProviderClientMock.mockReturnValue(clientMock);
  clientMock.listModels.mockResolvedValue(undefined);
  prismaMock.userAiSettings.upsert.mockImplementation(
    async (args: { create: Record<string, unknown> }) => row(args.create),
  );
  prismaMock.userAiSettings.updateMany.mockResolvedValue({ count: 1 });
  prismaMock.userAiSettings.deleteMany.mockResolvedValue({ count: 1 });
});

describe('getAiSettings', () => {
  it('returns the unconfigured shape when there is no row', async () => {
    prismaMock.userAiSettings.findUnique.mockResolvedValue(null);
    await expect(getAiSettings('user-1')).resolves.toEqual({
      configured: false,
      provider: null,
      maskedKey: null,
      verified: false,
      sendNote: false,
      sendAmount: false,
      disclosureAccepted: false,
      available: true,
    });
  });

  it('masks from keyLast4 without ever decrypting', async () => {
    prismaMock.userAiSettings.findUnique.mockResolvedValue(row());
    const settings = await getAiSettings('user-1');
    expect(settings.configured).toBe(true);
    expect(settings.verified).toBe(true);
    expect(settings.disclosureAccepted).toBe(true);
    expect(settings.maskedKey).toBe('••••••••a1b2');
    expect(cryptoMock.decryptSecret).not.toHaveBeenCalled();
  });

  it('reports disclosureAccepted: false when the stamp is null', async () => {
    prismaMock.userAiSettings.findUnique.mockResolvedValue(row({ disclosureAcceptedAt: null }));
    await expect(getAiSettings('user-1')).resolves.toMatchObject({ disclosureAccepted: false });
  });

  it('scopes the read by userId', async () => {
    prismaMock.userAiSettings.findUnique.mockResolvedValue(null);
    await getAiSettings('user-1');
    expect(prismaMock.userAiSettings.findUnique).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
    });
  });

  it('still reports configured when the deployment has no master key', async () => {
    cryptoMock.isSecretEncryptionConfigured.mockReturnValue(false);
    prismaMock.userAiSettings.findUnique.mockResolvedValue(row());
    const settings = await getAiSettings('user-1');
    expect(settings).toMatchObject({ configured: true, available: false });
    expect(settings.maskedKey).toBe('••••••••a1b2');
  });

  it('returns exactly the FrontendAiSettings keys — no Prisma field leaks', async () => {
    prismaMock.userAiSettings.findUnique.mockResolvedValue(row());
    expect(Object.keys(await getAiSettings('user-1')).sort()).toEqual([...FRONTEND_KEYS].sort());
  });
});

describe('saveAiSettings', () => {
  it('persists an encrypted key with verifiedAt set when the probe returns 200', async () => {
    const result = await saveAiSettings('user-1', SAVE_INPUT);

    const args = prismaMock.userAiSettings.upsert.mock.calls[0][0];
    expect(args.where).toEqual({ userId: 'user-1' });
    expect(args.create.encryptedApiKey).toMatch(/^v1:/);
    expect(args.create.encryptedApiKey).not.toBe(API_KEY);
    expect(args.create.keyLast4).toBe('a1b2');
    expect(args.create.verifiedAt).toBeInstanceOf(Date);
    expect(args.update.verifiedAt).toBeInstanceOf(Date);
    expect(result.warning).toBeNull();
    expect(cryptoMock.encryptSecret).toHaveBeenCalledWith(API_KEY, 'user-1');
  });

  it('returns exactly FrontendAiSettings plus warning', async () => {
    const result = await saveAiSettings('user-1', SAVE_INPUT);
    expect(Object.keys(result).sort()).toEqual([...FRONTEND_KEYS, 'warning'].sort());
  });

  it.each([401, 403])('refuses to persist when the probe rejects the key (%i)', async () => {
    clientMock.listModels.mockRejectedValue(new AiProviderAuthError('ANTHROPIC'));
    await expect(saveAiSettings('user-1', SAVE_INPUT)).rejects.toBeInstanceOf(AiProviderAuthError);
    expect(prismaMock.userAiSettings.upsert).not.toHaveBeenCalled();
  });

  it('persists unverified with a warning when the provider is rate-limiting', async () => {
    clientMock.listModels.mockRejectedValue(
      new AiRateLimitedError({ reason: 'provider', provider: 'ANTHROPIC' }),
    );
    const result = await saveAiSettings('user-1', SAVE_INPUT);
    expect(prismaMock.userAiSettings.upsert.mock.calls[0][0].create.verifiedAt).toBeNull();
    expect(result.warning).toContain('not yet verified');
    expect(result.verified).toBe(false);
  });

  it('persists unverified with a warning on a 5xx', async () => {
    clientMock.listModels.mockRejectedValue(new AiProviderUnavailableError('ANTHROPIC', 'server'));
    const result = await saveAiSettings('user-1', SAVE_INPUT);
    expect(prismaMock.userAiSettings.upsert.mock.calls[0][0].update.verifiedAt).toBeNull();
    expect(result.warning).not.toBeNull();
  });

  it('persists unverified with a warning on a network error / timeout', async () => {
    clientMock.listModels.mockRejectedValue(new AiProviderUnavailableError('ANTHROPIC', 'timeout'));
    const result = await saveAiSettings('user-1', SAVE_INPUT);
    expect(prismaMock.userAiSettings.upsert.mock.calls[0][0].update.verifiedAt).toBeNull();
    expect(result.warning).not.toBeNull();
  });

  it('fully replaces provider and key material on a provider swap', async () => {
    await saveAiSettings('user-1', {
      ...SAVE_INPUT,
      provider: 'OPENAI',
      apiKey: 'sk-openai-zzzz9999',
    });
    const update = prismaMock.userAiSettings.upsert.mock.calls[0][0].update;
    expect(update.provider).toBe('OPENAI');
    expect(update.keyLast4).toBe('9999');
    expect(update.encryptedApiKey).toMatch(/^v1:/);
  });

  it('never leaks the raw key through an error message or the console', async () => {
    const spies = [
      vi.spyOn(console, 'log').mockImplementation(() => {}),
      vi.spyOn(console, 'warn').mockImplementation(() => {}),
      vi.spyOn(console, 'error').mockImplementation(() => {}),
    ];
    for (const failure of [
      new AiProviderAuthError('ANTHROPIC'),
      new AiRateLimitedError({ reason: 'provider', provider: 'ANTHROPIC' }),
      new AiProviderUnavailableError('ANTHROPIC', 'server'),
    ]) {
      clientMock.listModels.mockRejectedValue(failure);
      const outcome = await saveAiSettings('user-1', SAVE_INPUT).catch((e: Error) => e);
      const text = outcome instanceof Error ? `${outcome.message}${outcome.stack}` : '';
      expect(text).not.toContain(API_KEY);
    }
    for (const spy of spies) {
      expect(JSON.stringify(spy.mock.calls)).not.toContain(API_KEY);
      spy.mockRestore();
    }
  });
});

describe('updateAiToggles', () => {
  it('writes only the two toggle columns, scoped by userId', async () => {
    prismaMock.userAiSettings.findUnique.mockResolvedValue(row({ sendNote: true }));
    await updateAiToggles('user-1', { sendNote: true, sendAmount: false });

    const args = prismaMock.userAiSettings.updateMany.mock.calls[0][0];
    expect(args.where).toEqual({ userId: 'user-1' });
    expect(Object.keys(args.data).sort()).toEqual(['sendAmount', 'sendNote']);
    expect(args.data).not.toHaveProperty('encryptedApiKey');
    expect(args.data).not.toHaveProperty('provider');
    expect(args.data).not.toHaveProperty('verifiedAt');
  });

  it('leaves the stored key byte-for-byte alone even given a smuggled apiKey field', async () => {
    prismaMock.userAiSettings.findUnique.mockResolvedValue(row());
    await updateAiToggles('user-1', {
      sendNote: true,
      sendAmount: true,
      // @ts-expect-error — the point of the test: the service has no path for it
      apiKey: 'sk-attacker-supplied-key-9999',
    });
    const data = prismaMock.userAiSettings.updateMany.mock.calls[0][0].data;
    expect(JSON.stringify(data)).not.toContain('sk-attacker-supplied-key-9999');
    expect(cryptoMock.encryptSecret).not.toHaveBeenCalled();
  });

  it('throws and creates nothing when no row exists', async () => {
    prismaMock.userAiSettings.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      updateAiToggles('user-1', { sendNote: true, sendAmount: false }),
    ).rejects.toBeInstanceOf(ServiceValidationError);
    expect(prismaMock.userAiSettings.upsert).not.toHaveBeenCalled();
  });
});

describe('acceptAiDisclosure', () => {
  it('stamps disclosureAcceptedAt scoped by userId', async () => {
    prismaMock.userAiSettings.findUnique.mockResolvedValue(row({ disclosureAcceptedAt: null }));
    const settings = await acceptAiDisclosure('user-1');
    const args = prismaMock.userAiSettings.updateMany.mock.calls[0][0];
    expect(args.where).toEqual({ userId: 'user-1' });
    expect(args.data.disclosureAcceptedAt).toBeInstanceOf(Date);
    expect(settings.disclosureAccepted).toBe(true);
  });

  it('throws when there is nothing to accept for', async () => {
    prismaMock.userAiSettings.findUnique.mockResolvedValue(null);
    await expect(acceptAiDisclosure('user-1')).rejects.toBeInstanceOf(ServiceValidationError);
  });

  it('is idempotent — a second call does not throw or re-stamp', async () => {
    prismaMock.userAiSettings.findUnique.mockResolvedValue(row());
    await expect(acceptAiDisclosure('user-1')).resolves.toMatchObject({
      disclosureAccepted: true,
    });
    expect(prismaMock.userAiSettings.updateMany).not.toHaveBeenCalled();
  });
});

describe('removeAiSettings', () => {
  it('uses deleteMany scoped by userId and is idempotent', async () => {
    prismaMock.userAiSettings.deleteMany.mockResolvedValue({ count: 0 });
    await expect(removeAiSettings('user-1')).resolves.toEqual({ ok: true });
    expect(prismaMock.userAiSettings.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
    });
  });
});

describe('module surface', () => {
  it('exports no `loadDecryptedKey` — the plaintext path is not a public name', () => {
    expect('loadDecryptedKey' in aiSettingsModule).toBe(false);
  });

  it('decrypts with the userId as AAD when the sibling service asks for credentials', async () => {
    prismaMock.userAiSettings.findUnique.mockResolvedValue(row());
    const credentials = await loadAiCredentials('user-1');
    expect(cryptoMock.decryptSecret).toHaveBeenCalledWith('v1:iv:tag:ct', 'user-1');
    expect(credentials).toEqual({
      provider: 'ANTHROPIC',
      apiKey: 'sk-ant-decrypted-key-1234',
      sendNote: false,
      sendAmount: false,
      disclosureAccepted: true,
    });
  });

  it('returns null when no row exists', async () => {
    prismaMock.userAiSettings.findUnique.mockResolvedValue(null);
    await expect(loadAiCredentials('user-1')).resolves.toBeNull();
  });

  it('turns an undecryptable blob into an actionable error, never echoing it', async () => {
    prismaMock.userAiSettings.findUnique.mockResolvedValue(row());
    cryptoMock.decryptSecret.mockImplementation(() => {
      throw new Error('unsupported state or unable to authenticate data');
    });
    const error = await loadAiCredentials('user-1').catch((e: Error) => e);
    expect(error).toBeInstanceOf(ServiceValidationError);
    expect((error as Error).message).not.toContain('v1:iv:tag:ct');
  });
});
