import { describe, expect, it } from 'vitest';

import { AI_DAILY_SUGGEST_LIMIT, AI_TIMEOUT_MS, getAiProviderClient } from '@/lib/ai';
import { anthropicClient } from '@/lib/ai/anthropic';
import { openaiClient } from '@/lib/ai/openai';

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
});
