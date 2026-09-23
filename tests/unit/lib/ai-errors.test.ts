import { describe, expect, it } from 'vitest';

import {
  aiErrorToResponse,
  AiDisclosureRequiredError,
  AiInvalidResponseError,
  AiModelRejectedError,
  AiProviderAuthError,
  AiProviderUnavailableError,
  AiRateLimitedError,
  AiUnavailableError,
  classifyProviderStatus,
} from '@/lib/ai/errors';
import { ServiceValidationError } from '@/lib/services/common';

describe('aiErrorToResponse', () => {
  it('maps AiProviderAuthError to a 400 naming the provider', () => {
    expect(aiErrorToResponse(new AiProviderAuthError('ANTHROPIC'))).toEqual({
      status: 400,
      message: 'Your Anthropic API key was rejected. Check it in Settings and save it again.',
    });
    expect(aiErrorToResponse(new AiProviderAuthError('OPENAI'))).toEqual({
      status: 400,
      message: 'Your OpenAI API key was rejected. Check it in Settings and save it again.',
    });
  });

  it('keeps the provider-429 and local-cap 429 messages distinct', () => {
    expect(
      aiErrorToResponse(new AiRateLimitedError({ reason: 'provider', provider: 'OPENAI' })),
    ).toEqual({
      status: 429,
      message: 'OpenAI is rate-limiting your key right now. Wait a minute and try again.',
    });
    expect(aiErrorToResponse(new AiRateLimitedError({ reason: 'cap', limit: 20 }))).toEqual({
      status: 429,
      message: "You've hit today's limit of 20 AI suggestions. Try again tomorrow.",
    });
  });

  it('maps all three AiProviderUnavailableError flavors to 502 with their own copy', () => {
    expect(aiErrorToResponse(new AiProviderUnavailableError('ANTHROPIC', 'server'))).toEqual({
      status: 502,
      message: 'Anthropic is having trouble right now. Try again in a few minutes.',
    });
    expect(aiErrorToResponse(new AiProviderUnavailableError('ANTHROPIC', 'timeout'))).toEqual({
      status: 502,
      message: 'The request to Anthropic timed out. Try again in a few minutes.',
    });
    expect(aiErrorToResponse(new AiProviderUnavailableError('ANTHROPIC', 'other'))).toEqual({
      status: 502,
      message: "Anthropic couldn't handle that request. Try again in a few minutes.",
    });
  });

  it('maps AiUnavailableError to 503', () => {
    expect(aiErrorToResponse(new AiUnavailableError())).toEqual({
      status: 503,
      message: "AI suggestions aren't available on this deployment.",
    });
  });

  it('maps AiDisclosureRequiredError to 409', () => {
    expect(aiErrorToResponse(new AiDisclosureRequiredError('OPENAI'))).toEqual({
      status: 409,
      message: 'Review what gets sent to OpenAI, then try again.',
    });
  });

  it('maps any ServiceValidationError to a 400 carrying its own message', () => {
    expect(
      aiErrorToResponse(new ServiceValidationError('Add an API key in Settings first.')),
    ).toEqual({ status: 400, message: 'Add an API key in Settings first.' });
    expect(
      aiErrorToResponse(
        new ServiceValidationError('That transaction is no longer in the categorize queue.'),
      ),
    ).toEqual({
      status: 400,
      message: 'That transaction is no longer in the categorize queue.',
    });
  });

  it('returns null for anything that is not ours, so the route rethrows', () => {
    expect(aiErrorToResponse(new Error('unrelated'))).toBeNull();
    expect(aiErrorToResponse('not even an error')).toBeNull();
  });

  it('maps AiModelRejectedError to an actionable 400, distinct from the unavailable 502', () => {
    expect(aiErrorToResponse(new AiModelRejectedError('ANTHROPIC', 'model-x'))).toEqual({
      status: 400,
      message:
        "Anthropic wouldn't accept the AI model saved in your Settings. Pick a different model in Settings.",
    });
    expect(aiErrorToResponse(new AiModelRejectedError('OPENAI', 'model-x'))).toEqual({
      status: 400,
      message:
        "OpenAI wouldn't accept the AI model saved in your Settings. Pick a different model in Settings.",
    });
    // Neither shadows the other in the instanceof chain.
    expect(aiErrorToResponse(new AiProviderUnavailableError('ANTHROPIC', 'other'))).not.toEqual(
      aiErrorToResponse(new AiModelRejectedError('ANTHROPIC', 'model-x')),
    );
  });

  it('has no row for AiInvalidResponseError — it never reaches the route layer', () => {
    // Asserted by absence: the service catches it and returns { outcome: 'none' }.
    // If it ever did reach the mapper it would fall through to null, not a
    // plausible-looking 400.
    expect(aiErrorToResponse(new AiInvalidResponseError('ANTHROPIC'))).toBeNull();
  });
});

describe('classifyProviderStatus', () => {
  it('is exhaustive — no status falls through unclassified', () => {
    for (const status of [400, 402, 404, 418, 451, 499]) {
      const error = classifyProviderStatus('ANTHROPIC', status);
      expect(error).toBeInstanceOf(AiProviderUnavailableError);
    }
    expect(classifyProviderStatus('ANTHROPIC', 401)).toBeInstanceOf(AiProviderAuthError);
    expect(classifyProviderStatus('ANTHROPIC', 403)).toBeInstanceOf(AiProviderAuthError);
    expect(classifyProviderStatus('ANTHROPIC', 429)).toBeInstanceOf(AiRateLimitedError);
    expect(classifyProviderStatus('ANTHROPIC', 500)).toBeInstanceOf(AiProviderUnavailableError);
    expect(classifyProviderStatus('ANTHROPIC', 599)).toBeInstanceOf(AiProviderUnavailableError);
  });

  // The loop above is kept verbatim on purpose: it is the regression guard
  // proving the context-free call path (which is the only one `listModels`
  // uses) is unchanged by the optional `context` parameter added below.
  describe('with a model in context — the suggestCategory call path', () => {
    const context = { modelId: 'model-x' };

    it.each([400, 404])('maps %i to AiModelRejectedError', (status) => {
      const error = classifyProviderStatus('ANTHROPIC', status, context);
      expect(error).toBeInstanceOf(AiModelRejectedError);
      expect((error as AiModelRejectedError).modelId).toBe('model-x');
      expect((error as AiModelRejectedError).provider).toBe('ANTHROPIC');
      // The id is carried on the property, never in the user-facing copy.
      expect(error.message).not.toContain('model-x');
    });

    it.each([402, 418, 451, 499])(
      'leaves the catch-all status %i as AiProviderUnavailableError',
      (status) => {
        expect(classifyProviderStatus('ANTHROPIC', status, context)).toBeInstanceOf(
          AiProviderUnavailableError,
        );
      },
    );

    it.each([401, 403, 429, 500, 599])('leaves status %i unaffected by context', (status) => {
      const withContext = classifyProviderStatus('ANTHROPIC', status, context);
      const without = classifyProviderStatus('ANTHROPIC', status);
      expect(withContext.constructor).toBe(without.constructor);
      expect(withContext.message).toBe(without.message);
    });
  });
});
