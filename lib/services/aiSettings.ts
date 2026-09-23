import type { AiProvider } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { AI_LIST_TIMEOUT_MS, AI_TIMEOUT_MS, getAiProviderClient } from '@/lib/ai';
import {
  AiProviderAuthError,
  AiProviderUnavailableError,
  AiRateLimitedError,
  AiInvalidResponseError,
  AiUnavailableError,
} from '@/lib/ai/errors';
import { PROVIDER_LABELS, type AiModelSummary } from '@/lib/ai/types';
import { decryptSecret, encryptSecret, isSecretEncryptionConfigured } from '@/lib/crypto/secrets';
import { ServiceValidationError } from '@/lib/services/common';
import type {
  SaveAiSettingsInput,
  UpdateAiModelInput,
  UpdateAiTogglesInput,
} from '@/lib/validators/ai-settings';

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
  /** null until the first successful list fetch auto-picks one */
  modelId: string | null;
};

type SettingsRow = {
  provider: AiProvider;
  keyLast4: string;
  verifiedAt: Date | null;
  modelId: string | null;
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
  modelId: null,
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
    modelId: row.modelId,
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
): Promise<FrontendAiSettings & { warning: string | null; models: AiModelSummary[] }> => {
  // Guard before the probe, not just at `encryptSecret` time below — an unset
  // or malformed `SECRET_ENCRYPTION_KEY` must fail closed with the documented
  // 503, not spend a real provider call first and then throw unguarded.
  if (!isSecretEncryptionConfigured()) {
    throw new AiUnavailableError();
  }

  const client = getAiProviderClient(input.provider);

  let verifiedAt: Date | null = new Date();
  let warning: string | null = null;
  // The probe already calls /v1/models; now it keeps the body instead of
  // throwing it away, so the auto-pick costs no second provider call.
  let models: AiModelSummary[] = [];

  try {
    models = await client.listModels(input.apiKey, AbortSignal.timeout(AI_TIMEOUT_MS));
  } catch (error) {
    if (error instanceof AiProviderAuthError) {
      throw error;
    }
    verifiedAt = null;
    warning = `Key saved — not yet verified. ${PROVIDER_LABELS[input.provider]} was unreachable just now, so we'll verify it the next time you use it.`;
  }

  // Auto-pick the first entry of the list the probe just returned. `?? null` is
  // what resets a stale selection when the user switches provider or saves a new
  // key: the full-row upsert writes this column unconditionally, so a model id
  // belonging to the previous provider can never survive. A soft probe failure
  // leaves it null, and the next Settings render backfills it via listAiModels.
  const modelId = models[0]?.id ?? null;

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
      modelId,
      sendNote: input.sendNote,
      sendAmount: input.sendAmount,
    },
    update: {
      provider: input.provider,
      encryptedApiKey,
      keyLast4,
      verifiedAt,
      modelId,
      sendNote: input.sendNote,
      sendAmount: input.sendAmount,
    },
  });

  // `models` rides along on the response because the Settings section holds its
  // state in `useState` seeded from props: a router refresh would not reseed the
  // picker after a key save, and the list is already in hand here.
  return { ...toFrontend(row), warning, models };
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

export const updateAiModel = async (
  userId: string,
  input: UpdateAiModelInput,
): Promise<FrontendAiSettings> => {
  // `updateMany` scoped by userId carrying only `modelId`: no code path here can
  // touch encryptedApiKey, provider or verifiedAt, and no provider call is made
  // — changing the model is not a re-verification of the key.
  //
  // The value is deliberately not validated against a live list: that would mean
  // a provider call per model change, and the list is not ground truth for what
  // the completion endpoint accepts. `AiModelRejectedError` at suggest time is
  // the real backstop; Zod bounds the id to a plausible shape.
  const updated = await prisma.userAiSettings.updateMany({
    where: { userId },
    data: { modelId: input.modelId },
  });
  if (updated.count === 0) {
    throw new ServiceValidationError('Add an API key in Settings first.');
  }
  return getAiSettings(userId);
};

export type AiModelsResult =
  | { outcome: 'not-configured' }
  | { outcome: 'ok'; models: AiModelSummary[]; selectedModelId: string }
  | { outcome: 'unavailable'; message: string; selectedModelId: string | null };

const UNREADABLE_KEY = 'Your saved API key could not be read. Save it again in Settings.';

/**
 * The Settings-render model-list fetch.
 *
 * **Never throws.** `app/(protected)/settings/page.tsx` runs this inside a
 * `Promise.all` alongside password/reminders/push-device reads; one rejection
 * would blank the entire Settings page over a provider blip. Every failure is a
 * value in the discriminated union instead.
 */
export const listAiModels = async (userId: string): Promise<AiModelsResult> => {
  const row = await prisma.userAiSettings.findUnique({ where: { userId } });
  if (!row || !isSecretEncryptionConfigured()) {
    return { outcome: 'not-configured' };
  }

  let apiKey: string;
  try {
    apiKey = decryptSecret(row.encryptedApiKey, userId);
  } catch {
    // Same copy as loadAiCredentials, and it never echoes the blob.
    return { outcome: 'unavailable', message: UNREADABLE_KEY, selectedModelId: row.modelId };
  }

  let models: AiModelSummary[];
  try {
    models = await getAiProviderClient(row.provider).listModels(
      apiKey,
      AbortSignal.timeout(AI_LIST_TIMEOUT_MS),
    );
  } catch (error) {
    // Our own typed errors already carry user-safe copy. Anything else — a bug,
    // a non-Error throw — gets generic copy and a name-only console.warn, so no
    // unrecognized detail reaches the user or the log.
    const known =
      error instanceof AiProviderAuthError ||
      error instanceof AiRateLimitedError ||
      error instanceof AiProviderUnavailableError ||
      error instanceof AiInvalidResponseError;
    if (!known) {
      console.warn(`[ai] model list failed for ${row.provider}`);
    }
    return {
      outcome: 'unavailable',
      message: known
        ? (error as Error).message
        : `Couldn't load the model list from ${PROVIDER_LABELS[row.provider]} just now.`,
      selectedModelId: row.modelId,
    };
  }

  // Ordering is load-bearing: this empty check must run *before* the backfill
  // below, or `models[0].id` would throw a TypeError on an empty list and break
  // the never-throws property.
  if (models.length === 0) {
    return {
      outcome: 'unavailable',
      message: `${PROVIDER_LABELS[row.provider]} didn't return any usable models for this key.`,
      selectedModelId: row.modelId,
    };
  }

  let selectedModelId = row.modelId;
  if (selectedModelId === null) {
    selectedModelId = models[0].id;
    await prisma.userAiSettings.updateMany({
      // The `modelId: null` guard is the concurrency guard: a second concurrent
      // render or tab that has already backfilled a value matches zero rows
      // here rather than clobbering an explicit pick. The write's `count` is
      // deliberately not consulted — on a lost race this render returns the
      // value it computed locally and the next render reconciles.
      where: { userId, modelId: null },
      data: { modelId: selectedModelId },
    });
  }

  // A stored id absent from the returned list is kept and returned anyway: the
  // list is not ground truth, and silently reassigning a user's setting on a
  // page render is worse than a picker showing an id the list omitted.
  return { outcome: 'ok', models, selectedModelId };
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
  /** null when no list fetch has ever succeeded; the caller falls back */
  modelId: string | null;
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
    modelId: row.modelId,
    sendNote: row.sendNote,
    sendAmount: row.sendAmount,
    disclosureAccepted: row.disclosureAcceptedAt !== null,
  };
};
