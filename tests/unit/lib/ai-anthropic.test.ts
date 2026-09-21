import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { anthropicClient, ANTHROPIC_MODEL } from '@/lib/ai/anthropic';
import {
  AiInvalidResponseError,
  AiProviderAuthError,
  AiProviderUnavailableError,
  AiRateLimitedError,
} from '@/lib/ai/errors';
import type { AiSuggestionRequest } from '@/lib/ai/types';

const API_KEY = 'sk-ant-unit-test-key-abcd1234';

const REQUEST: AiSuggestionRequest = {
  payee: 'Blue Bottle',
  type: 'EXPENSE',
  categories: [
    { id: 'cat-food', name: 'Food' },
    { id: 'cat-fun', name: 'Fun' },
  ],
};

const fetchMock = vi.fn();

const jsonResponse = (status: number, body: unknown): Response =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

/** A 200 whose body is not JSON at all. */
const brokenJsonResponse = (): Response =>
  ({
    ok: true,
    status: 200,
    json: async () => {
      throw new SyntaxError('Unexpected token < in JSON at position 0');
    },
  }) as unknown as Response;

const toolUse = (categoryId: string): unknown => ({
  content: [{ type: 'tool_use', name: 'pick_category', input: { categoryId } }],
});

const signal = (): AbortSignal => AbortSignal.timeout(5_000);

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('anthropic listModels', () => {
  it('resolves on 200', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { data: [] }));
    await expect(anthropicClient.listModels(API_KEY, signal())).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.anthropic.com/v1/models');
    expect(fetchMock.mock.calls[0][1].method).toBe('GET');
    expect(fetchMock.mock.calls[0][1].headers['x-api-key']).toBe(API_KEY);
  });

  it.each([401, 403])('throws AiProviderAuthError on %i', async (status) => {
    fetchMock.mockResolvedValue(jsonResponse(status, {}));
    await expect(anthropicClient.listModels(API_KEY, signal())).rejects.toBeInstanceOf(
      AiProviderAuthError,
    );
  });

  it('throws AiRateLimitedError on 429', async () => {
    fetchMock.mockResolvedValue(jsonResponse(429, {}));
    await expect(anthropicClient.listModels(API_KEY, signal())).rejects.toBeInstanceOf(
      AiRateLimitedError,
    );
  });

  it('throws AiProviderUnavailableError on 5xx', async () => {
    fetchMock.mockResolvedValue(jsonResponse(503, {}));
    await expect(anthropicClient.listModels(API_KEY, signal())).rejects.toBeInstanceOf(
      AiProviderUnavailableError,
    );
  });

  it('throws AiProviderUnavailableError with the timeout message on a network rejection', async () => {
    fetchMock.mockRejectedValue(new DOMException('The operation timed out.', 'TimeoutError'));
    await expect(anthropicClient.listModels(API_KEY, signal())).rejects.toThrowError(
      'The request to Anthropic timed out. Try again in a few minutes.',
    );
  });

  it('never leaks the api key in a thrown error', async () => {
    for (const status of [401, 429, 500, 404]) {
      fetchMock.mockResolvedValue(jsonResponse(status, { error: { message: API_KEY } }));
      const error = await anthropicClient.listModels(API_KEY, signal()).catch((e: Error) => e);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).not.toContain(API_KEY);
      expect((error as Error).stack ?? '').not.toContain(API_KEY);
    }
  });
});

describe('anthropic suggestCategory', () => {
  it('resolves a match for a real category id', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, toolUse('cat-food')));
    await expect(anthropicClient.suggestCategory(API_KEY, REQUEST, signal())).resolves.toEqual({
      outcome: 'match',
      categoryId: 'cat-food',
    });
  });

  it('resolves { outcome: none } for the "none" sentinel', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, toolUse('none')));
    await expect(anthropicClient.suggestCategory(API_KEY, REQUEST, signal())).resolves.toEqual({
      outcome: 'none',
    });
  });

  it('throws AiInvalidResponseError on a non-JSON body', async () => {
    fetchMock.mockResolvedValue(brokenJsonResponse());
    await expect(
      anthropicClient.suggestCategory(API_KEY, REQUEST, signal()),
    ).rejects.toBeInstanceOf(AiInvalidResponseError);
  });

  it('throws AiInvalidResponseError when no tool-call block is present', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { content: [{ type: 'text', text: 'I think Food.' }] }),
    );
    await expect(
      anthropicClient.suggestCategory(API_KEY, REQUEST, signal()),
    ).rejects.toBeInstanceOf(AiInvalidResponseError);
  });

  it('throws AiInvalidResponseError when the id is outside the caller-supplied set', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, toolUse('cat-someone-elses')));
    await expect(
      anthropicClient.suggestCategory(API_KEY, REQUEST, signal()),
    ).rejects.toBeInstanceOf(AiInvalidResponseError);
  });

  it('never echoes the response body in the invalid-response error', async () => {
    const marker = 'PROVIDER-BODY-LEAK-MARKER';
    fetchMock.mockResolvedValue(jsonResponse(200, { content: [{ type: 'text', text: marker }] }));
    const error = await anthropicClient
      .suggestCategory(API_KEY, REQUEST, signal())
      .catch((e: Error) => e);
    expect((error as Error).message).not.toContain(marker);
    expect((error as Error).message).not.toContain(API_KEY);
  });

  it('posts to the messages endpoint with the pinned model and a forced tool choice', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, toolUse('cat-fun')));
    const abort = signal();
    await anthropicClient.suggestCategory(API_KEY, REQUEST, abort);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.method).toBe('POST');
    expect(init.headers['x-api-key']).toBe(API_KEY);
    expect(init.headers['anthropic-version']).toBe('2023-06-01');
    // The exact signal instance, proving the caller's hard timeout wires through.
    expect(init.signal).toBe(abort);

    const body = JSON.parse(init.body);
    expect(body.model).toBe(ANTHROPIC_MODEL);
    expect(body.tool_choice).toEqual({ type: 'tool', name: 'pick_category' });
    expect(body.tools[0].input_schema.properties.categoryId.enum).toEqual([
      'cat-food',
      'cat-fun',
      'none',
    ]);
  });

  it('falls back to AiProviderUnavailableError on an unenumerated status (404)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, {}));
    await expect(anthropicClient.suggestCategory(API_KEY, REQUEST, signal())).rejects.toThrowError(
      "Anthropic couldn't handle that request. Try again in a few minutes.",
    );
  });
});
