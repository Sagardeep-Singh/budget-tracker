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
import { parseModelsResponse } from '@/lib/ai/models';
import type {
  AiModelSummary,
  AiProviderClient,
  AiSuggestionRequest,
  AiSuggestionResult,
} from '@/lib/ai/types';

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
 * Last-resort model id, used only when the user's stored `modelId` is still
 * null — i.e. the key was saved during a provider outage and no Settings render
 * has since managed to fetch a list. Cheapest current-generation tier, since
 * this is one short classification per call and the user pays for it.
 *
 * A stale id here is low-stakes and needs no periodic reverification: it is
 * reached only when the list fetch itself failed, and it surfaces as
 * `AiModelRejectedError`, which points the user straight at the Settings model
 * picker rather than at a dead end.
 */
export const ANTHROPIC_FALLBACK_MODEL = 'claude-4-5-haiku-latest';

const TOOL_NAME = 'pick_category';
const MAX_TOKENS = 256;

const provider = 'ANTHROPIC' as const;

/** Any transport-level rejection — DNS failure, connection reset, or the
 * `TimeoutError` that `AbortSignal.timeout` rejects with. All one user story:
 * "we couldn't reach the provider". Never carries the original error as a
 * `cause`, which could echo the request. */
const asUnavailable = (): AiProviderUnavailableError =>
  new AiProviderUnavailableError(provider, 'timeout');

/**
 * `?limit=100` is a constant, not derived from anything about the user: it
 * comfortably exceeds Anthropic's catalogue, so one page is the whole list and
 * the `has_more` envelope can be ignored rather than multiplying the
 * Settings-render cost.
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
    response = await fetch(`${BASE_URL}/v1/models?limit=100`, {
      method: 'GET',
      headers: { 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VERSION },
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
  // Every model Anthropic lists takes /v1/messages with tools, so there is
  // nothing to filter out here.
  return parseModelsResponse(provider, body);
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
    response = await fetch(`${BASE_URL}/v1/messages`, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'content-type': 'application/json',
      },
      signal,
      body: JSON.stringify({
        model,
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
