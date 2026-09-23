import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { openaiClient, OPENAI_FALLBACK_MODEL } from '@/lib/ai/openai';
import {
  AiInvalidResponseError,
  AiModelRejectedError,
  AiProviderAuthError,
  AiProviderUnavailableError,
  AiRateLimitedError,
} from '@/lib/ai/errors';
import type { AiSuggestionRequest } from '@/lib/ai/types';

/** Deliberately not the fallback constant: every suggest call in this file
 * proves the *parameter* drives the request. */
const MODEL = 'gpt-unit-test-model';

const API_KEY = 'sk-openai-unit-test-key-abcd1234';

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

const brokenJsonResponse = (): Response =>
  ({
    ok: true,
    status: 200,
    json: async () => {
      throw new SyntaxError('Unexpected token < in JSON at position 0');
    },
  }) as unknown as Response;

const completion = (content: string): unknown => ({ choices: [{ message: { content } }] });

const signal = (): AbortSignal => AbortSignal.timeout(5_000);

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('openai listModels', () => {
  it('resolves [] on a 200 with an empty list', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { data: [] }));
    await expect(openaiClient.listModels(API_KEY, signal())).resolves.toEqual([]);
    // No query string, unlike Anthropic: /v1/models is unpaginated here.
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.openai.com/v1/models');
    expect(fetchMock.mock.calls[0][1].method).toBe('GET');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${API_KEY}`);
  });

  it('resolves the parsed model list on 200, newest first, labelled by id', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        data: [
          { id: 'gpt-old', created: 100 },
          { id: 'gpt-new', created: 300 },
        ],
      }),
    );
    await expect(openaiClient.listModels(API_KEY, signal())).resolves.toEqual([
      { id: 'gpt-new', label: 'gpt-new' },
      { id: 'gpt-old', label: 'gpt-old' },
    ]);
  });

  it('applies the chat filter inside the adapter, not just in isolation', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        data: [
          { id: 'whisper-1', created: 400 },
          { id: 'text-embedding-3-small', created: 350 },
          { id: 'gpt-4o-mini', created: 300 },
        ],
      }),
    );
    await expect(openaiClient.listModels(API_KEY, signal())).resolves.toEqual([
      { id: 'gpt-4o-mini', label: 'gpt-4o-mini' },
    ]);
  });

  it("passes cache: 'no-store' and sends no body", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { data: [] }));
    await openaiClient.listModels(API_KEY, signal());
    // The mechanism behind "the list is fetched live on every Settings render".
    expect(fetchMock.mock.calls[0][1].cache).toBe('no-store');
    expect(fetchMock.mock.calls[0][1].body).toBeUndefined();
  });

  it('throws AiInvalidResponseError on an unparseable list body', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { data: 'not-an-array' }));
    await expect(openaiClient.listModels(API_KEY, signal())).rejects.toBeInstanceOf(
      AiInvalidResponseError,
    );
  });

  it.each([401, 403])('throws AiProviderAuthError on %i', async (status) => {
    fetchMock.mockResolvedValue(jsonResponse(status, {}));
    await expect(openaiClient.listModels(API_KEY, signal())).rejects.toBeInstanceOf(
      AiProviderAuthError,
    );
  });

  it('throws AiRateLimitedError on 429', async () => {
    fetchMock.mockResolvedValue(jsonResponse(429, {}));
    await expect(openaiClient.listModels(API_KEY, signal())).rejects.toBeInstanceOf(
      AiRateLimitedError,
    );
  });

  it('throws AiProviderUnavailableError on 5xx', async () => {
    fetchMock.mockResolvedValue(jsonResponse(503, {}));
    await expect(openaiClient.listModels(API_KEY, signal())).rejects.toBeInstanceOf(
      AiProviderUnavailableError,
    );
  });

  it('throws AiProviderUnavailableError with the timeout message on a network rejection', async () => {
    fetchMock.mockRejectedValue(new DOMException('The operation timed out.', 'TimeoutError'));
    await expect(openaiClient.listModels(API_KEY, signal())).rejects.toThrowError(
      'The request to OpenAI timed out. Try again in a few minutes.',
    );
  });

  it('never leaks the api key in a thrown error', async () => {
    for (const status of [401, 429, 500, 404]) {
      fetchMock.mockResolvedValue(jsonResponse(status, { error: { message: API_KEY } }));
      const error = await openaiClient.listModels(API_KEY, signal()).catch((e: Error) => e);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).not.toContain(API_KEY);
      expect((error as Error).stack ?? '').not.toContain(API_KEY);
    }
  });
});

describe('openai suggestCategory', () => {
  it('resolves a match for a real category id', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, completion(JSON.stringify({ categoryId: 'cat-food' }))),
    );
    await expect(openaiClient.suggestCategory(API_KEY, MODEL, REQUEST, signal())).resolves.toEqual({
      outcome: 'match',
      categoryId: 'cat-food',
    });
  });

  it('resolves { outcome: none } for the "none" sentinel', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, completion(JSON.stringify({ categoryId: 'none' }))),
    );
    await expect(openaiClient.suggestCategory(API_KEY, MODEL, REQUEST, signal())).resolves.toEqual({
      outcome: 'none',
    });
  });

  it('throws AiInvalidResponseError on a non-JSON body', async () => {
    fetchMock.mockResolvedValue(brokenJsonResponse());
    await expect(
      openaiClient.suggestCategory(API_KEY, MODEL, REQUEST, signal()),
    ).rejects.toBeInstanceOf(AiInvalidResponseError);
  });

  it('throws AiInvalidResponseError when the message content is not JSON', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, completion('I think Food.')));
    await expect(
      openaiClient.suggestCategory(API_KEY, MODEL, REQUEST, signal()),
    ).rejects.toBeInstanceOf(AiInvalidResponseError);
  });

  it('throws AiInvalidResponseError when the choices array is missing', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { id: 'chatcmpl-1' }));
    await expect(
      openaiClient.suggestCategory(API_KEY, MODEL, REQUEST, signal()),
    ).rejects.toBeInstanceOf(AiInvalidResponseError);
  });

  it('throws AiInvalidResponseError when the id is outside the caller-supplied set', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, completion(JSON.stringify({ categoryId: 'cat-someone-elses' }))),
    );
    await expect(
      openaiClient.suggestCategory(API_KEY, MODEL, REQUEST, signal()),
    ).rejects.toBeInstanceOf(AiInvalidResponseError);
  });

  it('never echoes the response body in the invalid-response error', async () => {
    const marker = 'PROVIDER-BODY-LEAK-MARKER';
    fetchMock.mockResolvedValue(jsonResponse(200, completion(marker)));
    const error = await openaiClient
      .suggestCategory(API_KEY, MODEL, REQUEST, signal())
      .catch((e: Error) => e);
    expect((error as Error).message).not.toContain(marker);
    expect((error as Error).message).not.toContain(API_KEY);
  });

  it('posts to chat/completions with the pinned model and a strict json_schema', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, completion(JSON.stringify({ categoryId: 'cat-fun' }))),
    );
    const abort = signal();
    await openaiClient.suggestCategory(API_KEY, MODEL, REQUEST, abort);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe(`Bearer ${API_KEY}`);
    expect(init.signal).toBe(abort);

    const body = JSON.parse(init.body);
    // The parameter, not the constant, is what goes on the wire.
    expect(body.model).toBe(MODEL);
    expect(MODEL).not.toBe(OPENAI_FALLBACK_MODEL);
    expect(body.response_format.type).toBe('json_schema');
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.response_format.json_schema.schema.properties.categoryId.enum).toEqual([
      'cat-food',
      'cat-fun',
      'none',
    ]);
  });

  it.each([404, 400])(
    'maps %i to AiModelRejectedError carrying the model that was actually sent',
    async (status) => {
      fetchMock.mockResolvedValue(jsonResponse(status, {}));
      const error = await openaiClient
        .suggestCategory(API_KEY, MODEL, REQUEST, signal())
        .catch((e: Error) => e);
      expect(error).toBeInstanceOf(AiModelRejectedError);
      expect((error as InstanceType<typeof AiModelRejectedError>).provider).toBe('OPENAI');
      expect((error as InstanceType<typeof AiModelRejectedError>).modelId).toBe(MODEL);
      expect((error as Error).message).toBe(
        "OpenAI wouldn't accept the AI model saved in your Settings. Pick a different model in Settings.",
      );
      expect((error as Error).message).not.toContain(MODEL);
    },
  );

  it.each([402, 418])(
    'still falls back to AiProviderUnavailableError on an unenumerated status (%i) even with a model in context',
    async (status) => {
      fetchMock.mockResolvedValue(jsonResponse(status, {}));
      await expect(
        openaiClient.suggestCategory(API_KEY, MODEL, REQUEST, signal()),
      ).rejects.toThrowError("OpenAI couldn't handle that request. Try again in a few minutes.");
    },
  );
});
