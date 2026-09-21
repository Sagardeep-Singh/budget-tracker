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
import type { AiProviderClient, AiSuggestionRequest, AiSuggestionResult } from '@/lib/ai/types';

/**
 * Hand-rolled `fetch` transport for OpenAI — the mirror image of
 * `lib/ai/anthropic.ts`; read that file's header for the base-URL and timeout
 * rationale, which applies identically here.
 */
const BASE_URL = process.env.AI_OPENAI_BASE_URL ?? 'https://api.openai.com';

/**
 * Cheapest current-generation tier.
 *
 * TODO: reverify this id against https://platform.openai.com/docs/models before
 * shipping. A retired id surfaces as a 404 → `AiProviderUnavailableError`.
 */
export const OPENAI_MODEL = 'gpt-4o-mini';

const SCHEMA_NAME = 'pick_category';

const provider = 'OPENAI' as const;

const asUnavailable = (): AiProviderUnavailableError =>
  new AiProviderUnavailableError(provider, 'timeout');

export const listModels = async (apiKey: string, signal: AbortSignal): Promise<void> => {
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}/v1/models`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
      signal,
    });
  } catch {
    throw asUnavailable();
  }
  if (!response.ok) {
    throw classifyProviderStatus(provider, response.status);
  }
};

export const suggestCategory = async (
  apiKey: string,
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
        model: OPENAI_MODEL,
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
    throw classifyProviderStatus(provider, response.status);
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
