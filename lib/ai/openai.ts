import {
  AiInvalidResponseError,
  classifyProviderStatus,
  AiProviderUnavailableError,
} from '@/lib/ai/errors';
import {
  buildCategoryChoiceSchema,
  buildCategoryChoiceValues,
  buildSuggestionPayload,
  NO_MATCH_SENTINEL,
} from '@/lib/ai/prompt';
import { filterChatModels, parseModelsResponse } from '@/lib/ai/models';
import type {
  AiModelSummary,
  AiProviderClient,
  AiSuggestionRequest,
  AiSuggestionResult,
} from '@/lib/ai/types';

/**
 * Hand-rolled `fetch` transport for OpenAI — the mirror image of
 * `lib/ai/anthropic.ts`; read that file's header for the base-URL and timeout
 * rationale, which applies identically here.
 */
const BASE_URL = process.env.AI_OPENAI_BASE_URL ?? 'https://api.openai.com';

/**
 * Last-resort model id, used only when the user's stored `modelId` is still
 * null — i.e. the key was saved during a provider outage and no Settings render
 * has since managed to fetch a list. Cheapest current-generation tier.
 *
 * A stale id here is low-stakes and needs no periodic reverification: it is
 * reached only when the list fetch itself failed, and it surfaces as
 * `AiModelRejectedError`, which points the user straight at the Settings model
 * picker rather than at a dead end.
 */
export const OPENAI_FALLBACK_MODEL = 'gpt-4o-mini';

const SCHEMA_NAME = 'pick_category';

const provider = 'OPENAI' as const;

const asUnavailable = (): AiProviderUnavailableError =>
  new AiProviderUnavailableError(provider, 'timeout');

/**
 * No query string: unlike Anthropic, `/v1/models` here is unpaginated.
 *
 * `cache: 'no-store'`: this now runs on a server-component render path as well
 * as from a POST handler, and the product decision is that the list is fetched
 * live on every Settings render. (Within-a-render memoization is separately
 * opted out of by passing a `signal`.)
 */
export const listModels = async (
  apiKey: string,
  signal: AbortSignal,
): Promise<AiModelSummary[]> => {
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}/v1/models`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: 'no-store',
      signal,
    });
  } catch {
    throw asUnavailable();
  }
  if (!response.ok) {
    throw classifyProviderStatus(provider, response.status);
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new AiInvalidResponseError(provider);
  }
  // The list mixes in embeddings/audio/image models that cannot satisfy the
  // structured-output contract below; keep them out of the picker.
  return filterChatModels(parseModelsResponse(provider, body));
};

export const suggestCategory = async (
  apiKey: string,
  model: string,
  request: AiSuggestionRequest,
  signal: AbortSignal,
): Promise<AiSuggestionResult> => {
  const { system, user, categoryIds } = buildSuggestionPayload(request);

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      signal,
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        // Structured outputs: `strict: true` is what makes the enum binding,
        // so the model cannot answer in prose or invent a category id.
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: SCHEMA_NAME,
            strict: true,
            schema: {
              type: 'object',
              properties: {
                categoryId: { type: 'string', enum: buildCategoryChoiceValues(categoryIds) },
              },
              required: ['categoryId'],
              additionalProperties: false,
            },
          },
        },
      }),
    });
  } catch {
    throw asUnavailable();
  }

  if (!response.ok) {
    // `context` is what turns a 400/404 into the actionable
    // "pick a different model" error rather than a generic 502.
    throw classifyProviderStatus(provider, response.status, { modelId: model });
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new AiInvalidResponseError(provider);
  }

  const choices = (body as { choices?: unknown })?.choices;
  const content = Array.isArray(choices)
    ? (choices[0] as { message?: { content?: unknown } } | undefined)?.message?.content
    : undefined;

  if (typeof content !== 'string') {
    throw new AiInvalidResponseError(provider);
  }

  let answer: unknown;
  try {
    answer = JSON.parse(content);
  } catch {
    throw new AiInvalidResponseError(provider);
  }

  const parsed = buildCategoryChoiceSchema(categoryIds).safeParse(answer);
  if (!parsed.success) {
    // Zod's issue detail would quote the offending value from the provider's
    // body; drop it.
    throw new AiInvalidResponseError(provider);
  }

  return parsed.data.categoryId === NO_MATCH_SENTINEL
    ? { outcome: 'none' }
    : { outcome: 'match', categoryId: parsed.data.categoryId };
};

export const openaiClient: AiProviderClient = { provider, listModels, suggestCategory };
