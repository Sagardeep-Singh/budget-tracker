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
 * Hand-rolled `fetch` transport for Anthropic — no SDK (see the architecture
 * doc's §3). One POST for the suggestion, one GET for the save-time probe.
 *
 * The base URL is a module constant read from server-side deploy config only.
 * It is never a request field and never reachable from user input, so there is
 * no SSRF surface; the override exists exclusively so the e2e suite can point
 * outbound calls at a local fixture server (approved 2026-09-18).
 *
 * The caller owns the timeout: the `AbortSignal` handed in is passed straight to
 * `fetch` unchanged, so `AI_TIMEOUT_MS` is applied in exactly one place.
 */
const BASE_URL = process.env.AI_ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com';

const ANTHROPIC_VERSION = '2023-06-01';

/**
 * Cheapest current-generation tier — this is one short classification per call
 * and the user pays for it.
 *
 * TODO: reverify this id against https://docs.anthropic.com/en/docs/about-claude/models
 * before shipping. A retired id surfaces as a 404, which the classifier maps to
 * `AiProviderUnavailableError` ("couldn't handle that request"), not a crash.
 */
export const ANTHROPIC_MODEL = 'claude-3-5-haiku-latest';

const TOOL_NAME = 'pick_category';
const MAX_TOKENS = 256;

const provider = 'ANTHROPIC' as const;

/** Any transport-level rejection — DNS failure, connection reset, or the
 * `TimeoutError` that `AbortSignal.timeout` rejects with. All one user story:
 * "we couldn't reach the provider". Never carries the original error as a
 * `cause`, which could echo the request. */
const asUnavailable = (): AiProviderUnavailableError =>
  new AiProviderUnavailableError(provider, 'timeout');

export const listModels = async (apiKey: string, signal: AbortSignal): Promise<void> => {
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}/v1/models`, {
      method: 'GET',
      headers: { 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VERSION },
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
    response = await fetch(`${BASE_URL}/v1/messages`, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'content-type': 'application/json',
      },
      signal,
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: MAX_TOKENS,
        system,
        messages: [{ role: 'user', content: user }],
        tools: [
          {
            name: TOOL_NAME,
            description: 'Record the chosen category id, or "none" if nothing fits.',
            input_schema: {
              type: 'object',
              properties: {
                categoryId: { type: 'string', enum: buildCategoryChoiceValues(categoryIds) },
              },
              required: ['categoryId'],
              additionalProperties: false,
            },
          },
        ],
        // Forced tool use: the model cannot answer in prose.
        tool_choice: { type: 'tool', name: TOOL_NAME },
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

  const content = (body as { content?: unknown })?.content;
  const toolUse = Array.isArray(content)
    ? content.find(
        (block: unknown): block is { input: unknown } =>
          typeof block === 'object' &&
          block !== null &&
          (block as { type?: unknown }).type === 'tool_use' &&
          (block as { name?: unknown }).name === TOOL_NAME,
      )
    : undefined;

  if (!toolUse) {
    throw new AiInvalidResponseError(provider);
  }

  const parsed = buildCategoryChoiceSchema(categoryIds).safeParse(toolUse.input);
  if (!parsed.success) {
    // Deliberately drops the Zod issue detail: it would quote the offending
    // value, i.e. part of the provider's response body.
    throw new AiInvalidResponseError(provider);
  }

  return parsed.data.categoryId === NO_MATCH_SENTINEL
    ? { outcome: 'none' }
    : { outcome: 'match', categoryId: parsed.data.categoryId };
};

export const anthropicClient: AiProviderClient = { provider, listModels, suggestCategory };
