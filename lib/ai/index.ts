import { ANTHROPIC_MODEL, anthropicClient } from '@/lib/ai/anthropic';
import { OPENAI_MODEL, openaiClient } from '@/lib/ai/openai';
import type { AiProviderClient, AiProviderName } from '@/lib/ai/types';

/**
 * The only thing services import from `lib/ai/`. Adding a third provider is one
 * new adapter file plus one enum value plus one line here.
 */
export { ANTHROPIC_MODEL, OPENAI_MODEL };

/**
 * Hard outbound timeout, applied by the caller via `AbortSignal.timeout` so it
 * exists in exactly one place rather than once per adapter. Long enough for a
 * short classification call, short enough that a hung provider can't pin a
 * serverless function.
 */
export const AI_TIMEOUT_MS = 10_000;

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
