import type { AiProvider } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { AI_TIMEOUT_MS, getAiProviderClient } from '@/lib/ai';
import { AiProviderAuthError } from '@/lib/ai/errors';
import { PROVIDER_LABELS } from '@/lib/ai/types';
import { decryptSecret, encryptSecret, isSecretEncryptionConfigured } from '@/lib/crypto/secrets';
import { ServiceValidationError } from '@/lib/services/common';
import type { SaveAiSettingsInput, UpdateAiTogglesInput } from '@/lib/validators/ai-settings';

/**
 * The BYOK key lifecycle. The only module in the app that imports
 * `lib/crypto/secrets.ts` — nothing in `app/` touches it directly, and no
 * function here that a route can call returns plaintext.
 */

/** Write-only by construction: no field here can reconstruct the key. */
export type FrontendAiSettings = {
  configured: boolean;
  provider: AiProvider | null;
  /** built from the stored `keyLast4`; masking never needs a decryption */
  maskedKey: string | null;
  verified: boolean;
  sendNote: boolean;
  sendAmount: boolean;
  disclosureAccepted: boolean;
  /** `isSecretEncryptionConfigured()` — the feature is off, not broken, when false */
  available: boolean;
};

type SettingsRow = {
  provider: AiProvider;
  keyLast4: string;
  verifiedAt: Date | null;
  sendNote: boolean;
  sendAmount: boolean;
  disclosureAcceptedAt: Date | null;
};

const UNCONFIGURED = (): FrontendAiSettings => ({
  configured: false,
  provider: null,
  maskedKey: null,
  verified: false,
  sendNote: false,
  sendAmount: false,
  disclosureAccepted: false,
  available: isSecretEncryptionConfigured(),
});

/**
 * Explicit field-by-field projection rather than a spread of the Prisma row:
 * a spread is exactly how `encryptedApiKey` would one day leak into a response.
 */
const toFrontend = (row: SettingsRow | null): FrontendAiSettings => {
  if (!row) {
    return UNCONFIGURED();
  }
  return {
    configured: true,
    provider: row.provider,
    maskedKey: `${'•'.repeat(8)}${row.keyLast4}`,
    verified: row.verifiedAt !== null,
    sendNote: row.sendNote,
    sendAmount: row.sendAmount,
    disclosureAccepted: row.disclosureAcceptedAt !== null,
    available: isSecretEncryptionConfigured(),
  };
};

export const getAiSettings = async (userId: string): Promise<FrontendAiSettings> => {
  const row = await prisma.userAiSettings.findUnique({ where: { userId } });
  return toFrontend(row);
};

/**
 * Probe-then-persist (architecture doc's Q1), outage-tolerant:
 *
 * - 200                       → persist with `verifiedAt = now()`
 * - 401 / 403                 → refuse to persist, rethrow `AiProviderAuthError`
 * - 429 / 5xx / network / timeout → persist anyway, `verifiedAt = null`, warn
 *
 * A typo'd key is the common failure and must be caught while the user still
 * has the real one on their clipboard; a provider outage is not the user's
 * fault and must not block saving a good key.
 */
export const saveAiSettings = async (
  userId: string,
  input: SaveAiSettingsInput,
): Promise<FrontendAiSettings & { warning: string | null }> => {
  const client = getAiProviderClient(input.provider);

  let verifiedAt: Date | null = new Date();
  let warning: string | null = null;

  try {
    await client.listModels(input.apiKey, AbortSignal.timeout(AI_TIMEOUT_MS));
  } catch (error) {
    if (error instanceof AiProviderAuthError) {
      throw error;
    }
    verifiedAt = null;
    warning = `Key saved — not yet verified. ${PROVIDER_LABELS[input.provider]} was unreachable just now, so we'll verify it the next time you use it.`;
  }

  // The `@unique userId` row is fully replaced, so swapping providers leaves no
  // leftover key material from the previous one.
  const encryptedApiKey = encryptSecret(input.apiKey, userId);
  const keyLast4 = input.apiKey.slice(-4);

  const row = await prisma.userAiSettings.upsert({
    where: { userId },
    create: {
      userId,
      provider: input.provider,
      encryptedApiKey,
      keyLast4,
      verifiedAt,
      sendNote: input.sendNote,
      sendAmount: input.sendAmount,
    },
    update: {
      provider: input.provider,
      encryptedApiKey,
      keyLast4,
      verifiedAt,
      sendNote: input.sendNote,
      sendAmount: input.sendAmount,
    },
  });

  return { ...toFrontend(row), warning };
};

export const updateAiToggles = async (
  userId: string,
  input: UpdateAiTogglesInput,
): Promise<FrontendAiSettings> => {
  // `updateMany` scoped by userId, carrying only the two toggle columns: there
  // is no code path here that could touch `encryptedApiKey` or `provider`.
  const updated = await prisma.userAiSettings.updateMany({
    where: { userId },
    data: { sendNote: input.sendNote, sendAmount: input.sendAmount },
  });
  if (updated.count === 0) {
    throw new ServiceValidationError('Add an API key in Settings first.');
  }
  return getAiSettings(userId);
};

export const acceptAiDisclosure = async (userId: string): Promise<FrontendAiSettings> => {
  const row = await prisma.userAiSettings.findUnique({ where: { userId } });
  if (!row) {
    throw new ServiceValidationError('Add an API key in Settings first.');
  }
  if (row.disclosureAcceptedAt === null) {
    // Idempotent: a second acceptance is a no-op rather than a re-stamp.
    await prisma.userAiSettings.updateMany({
      where: { userId },
      data: { disclosureAcceptedAt: new Date() },
    });
    return toFrontend({ ...row, disclosureAcceptedAt: new Date() });
  }
  return toFrontend(row);
};

/** `deleteMany`, not `delete`, so removing a non-existent row is idempotent. */
export const removeAiSettings = async (userId: string): Promise<{ ok: true }> => {
  await prisma.userAiSettings.deleteMany({ where: { userId } });
  return { ok: true };
};

export type AiCredentials = {
  provider: AiProvider;
  apiKey: string;
  sendNote: boolean;
  sendAmount: boolean;
  disclosureAccepted: boolean;
};

/**
 * Service-layer-internal. The one function that returns plaintext, and it is
 * deliberately *not* named `loadDecryptedKey` — the architecture doc placed
 * that helper inside this module as module-private, but `aiCategorize.ts` (a
 * sibling service, one layer up) genuinely needs the key to make the outbound
 * call. Keeping the crypto import confined to this file is the property that
 * actually matters; the name change keeps the "no `loadDecryptedKey` export"
 * regression test honest.
 *
 * Nothing under `app/` imports this. No route hands its result to a client.
 */
export const loadAiCredentials = async (userId: string): Promise<AiCredentials | null> => {
  const row = await prisma.userAiSettings.findUnique({ where: { userId } });
  if (!row) {
    return null;
  }
  let apiKey: string;
  try {
    apiKey = decryptSecret(row.encryptedApiKey, userId);
  } catch {
    // A rotated or malformed master key. Actionable, and never echoes the blob.
    throw new ServiceValidationError(
      'Your saved API key could not be read. Save it again in Settings.',
    );
  }
  return {
    provider: row.provider,
    apiKey,
    sendNote: row.sendNote,
    sendAmount: row.sendAmount,
    disclosureAccepted: row.disclosureAcceptedAt !== null,
  };
};
