import { ANTHROPIC_FALLBACK_MODEL, anthropicClient } from '@/lib/ai/anthropic';
import { OPENAI_FALLBACK_MODEL, openaiClient } from '@/lib/ai/openai';
import type { AiProviderClient, AiProviderName } from '@/lib/ai/types';

/**
 * The only thing services import from `lib/ai/`. Adding a third provider is one
 * new adapter file plus one enum value plus one line here.
 */
export { ANTHROPIC_FALLBACK_MODEL, OPENAI_FALLBACK_MODEL };

/**
 * Last resort only: reached when the row's `modelId` is still null, i.e. the
 * key was saved during a provider outage and no Settings render has since
 * succeeded in fetching a list. A stale id here is low-stakes — it surfaces as
 * `AiModelRejectedError`, which points the user at the picker.
 */
export const getFallbackModel = (provider: AiProviderName): string =>
  provider === 'ANTHROPIC' ? ANTHROPIC_FALLBACK_MODEL : OPENAI_FALLBACK_MODEL;

/**
 * Hard outbound timeout, applied by the caller via `AbortSignal.timeout` so it
 * exists in exactly one place rather than once per adapter. Long enough for a
 * short classification call, short enough that a hung provider can't pin a
 * serverless function.
 */
export const AI_TIMEOUT_MS = 10_000;

/**
 * Shorter than `AI_TIMEOUT_MS`, because this one sits on the Settings *render*
 * path: the model list is fetched on every Settings load, so a hung provider
 * would otherwise add the full suggest timeout to every one of them.
 */
export const AI_LIST_TIMEOUT_MS = 5_000;

/**
 * Per-user, per-UTC-day cap on `POST /api/categorize/suggest-ai`. Kept small
 * deliberately: it protects the user's own provider spend, and it is what makes
 * "no bulk suggestions" a server-enforced property rather than a UI choice.
 */
export const AI_DAILY_SUGGEST_LIMIT = 20;

const CLIENTS: Record<AiProviderName, AiProviderClient> = {
  ANTHROPIC: anthropicClient,
  OPENAI: openaiClient,
};

export const getAiProviderClient = (provider: AiProviderName): AiProviderClient =>
  CLIENTS[provider];
