import { describe, expect, it } from 'vitest';

import {
  AI_DAILY_SUGGEST_LIMIT,
  AI_LIST_TIMEOUT_MS,
  AI_TIMEOUT_MS,
  getAiProviderClient,
  getFallbackModel,
} from '@/lib/ai';
import { anthropicClient, ANTHROPIC_FALLBACK_MODEL } from '@/lib/ai/anthropic';
import { openaiClient, OPENAI_FALLBACK_MODEL } from '@/lib/ai/openai';

describe('getAiProviderClient', () => {
  it('returns the Anthropic adapter for ANTHROPIC', () => {
    const client = getAiProviderClient('ANTHROPIC');
    expect(client.provider).toBe('ANTHROPIC');
    expect(client.listModels).toBe(anthropicClient.listModels);
    expect(client.suggestCategory).toBe(anthropicClient.suggestCategory);
  });

  it('returns the OpenAI adapter for OPENAI', () => {
    const client = getAiProviderClient('OPENAI');
    expect(client.provider).toBe('OPENAI');
    expect(client.listModels).toBe(openaiClient.listModels);
    expect(client.suggestCategory).toBe(openaiClient.suggestCategory);
  });
});

describe('module constants', () => {
  it('pins a hard outbound timeout and a small daily cap', () => {
    expect(AI_TIMEOUT_MS).toBeGreaterThan(0);
    expect(AI_DAILY_SUGGEST_LIMIT).toBeGreaterThan(0);
  });

  it('keeps the list timeout strictly shorter than the suggest timeout', () => {
    // The list fetch sits on the Settings *render* path, so its blast radius
    // is every Settings load rather than one explicit user action.
    expect(AI_LIST_TIMEOUT_MS).toBeGreaterThan(0);
    expect(AI_LIST_TIMEOUT_MS).toBeLessThan(AI_TIMEOUT_MS);
  });
});

describe('getFallbackModel', () => {
  it("returns each adapter's own fallback constant", () => {
    expect(getFallbackModel('ANTHROPIC')).toBe(ANTHROPIC_FALLBACK_MODEL);
    expect(getFallbackModel('OPENAI')).toBe(OPENAI_FALLBACK_MODEL);
  });
});
