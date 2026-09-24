import { describe, expect, it } from 'vitest';

import {
  aiProviderSchema,
  saveAiSettingsSchema,
  updateAiModelSchema,
  updateAiTogglesSchema,
} from '@/lib/validators/ai-settings';
import { suggestWithAiSchema } from '@/lib/validators/categorize-ai';

const key = (length: number): string => 'k'.repeat(length);

const validSave = {
  provider: 'ANTHROPIC' as const,
  apiKey: key(30),
  sendNote: false,
  sendAmount: false,
};

describe('aiProviderSchema', () => {
  it('accepts the two supported providers', () => {
    expect(aiProviderSchema.parse('ANTHROPIC')).toBe('ANTHROPIC');
    expect(aiProviderSchema.parse('OPENAI')).toBe('OPENAI');
  });

  it.each(['GEMINI', 'anthropic', '', undefined, null, 3])('rejects %p', (value) => {
    const parsed = aiProviderSchema.safeParse(value);
    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues[0].message).toBe('Pick a provider of Anthropic or OpenAI');
  });
});

describe('saveAiSettingsSchema', () => {
  it('parses a full valid payload and trims the key', () => {
    const parsed = saveAiSettingsSchema.parse({
      ...validSave,
      apiKey: `  ${key(30)}  `,
      sendNote: true,
    });
    expect(parsed).toEqual({
      provider: 'ANTHROPIC',
      apiKey: key(30),
      sendNote: true,
      sendAmount: false,
    });
  });

  it('rejects a 19-char key and accepts a 20-char key', () => {
    const short = saveAiSettingsSchema.safeParse({ ...validSave, apiKey: key(19) });
    expect(short.success).toBe(false);
    expect(short.error!.issues[0].message).toBe('That does not look like an API key');
    expect(saveAiSettingsSchema.safeParse({ ...validSave, apiKey: key(20) }).success).toBe(true);
  });

  it('accepts a 400-char key and rejects a 401-char key', () => {
    expect(saveAiSettingsSchema.safeParse({ ...validSave, apiKey: key(400) }).success).toBe(true);
    expect(saveAiSettingsSchema.safeParse({ ...validSave, apiKey: key(401) }).success).toBe(false);
  });

  it('measures the trimmed length, not the padded one', () => {
    expect(saveAiSettingsSchema.safeParse({ ...validSave, apiKey: '   short   ' }).success).toBe(
      false,
    );
  });

  it('requires both toggles — a partial payload cannot silently zero one out', () => {
    expect(saveAiSettingsSchema.safeParse({ ...validSave, sendNote: undefined }).success).toBe(
      false,
    );
    expect(saveAiSettingsSchema.safeParse({ ...validSave, sendAmount: undefined }).success).toBe(
      false,
    );
  });

  it('rejects a non-boolean toggle', () => {
    expect(saveAiSettingsSchema.safeParse({ ...validSave, sendNote: 'true' }).success).toBe(false);
  });
});

describe('updateAiTogglesSchema', () => {
  it('parses the two toggles', () => {
    expect(updateAiTogglesSchema.parse({ sendNote: true, sendAmount: false })).toEqual({
      sendNote: true,
      sendAmount: false,
    });
  });

  it('rejects a smuggled apiKey or provider outright (strict), rather than silently dropping it', () => {
    expect(
      updateAiTogglesSchema.safeParse({ sendNote: true, sendAmount: false, apiKey: key(30) })
        .success,
    ).toBe(false);
    expect(
      updateAiTogglesSchema.safeParse({ sendNote: true, sendAmount: false, provider: 'OPENAI' })
        .success,
    ).toBe(false);
  });

  it('requires both toggles', () => {
    expect(updateAiTogglesSchema.safeParse({ sendNote: true }).success).toBe(false);
  });
});

describe('suggestWithAiSchema', () => {
  it('parses a transaction id', () => {
    expect(suggestWithAiSchema.parse({ transactionId: 'txn-1' })).toEqual({
      transactionId: 'txn-1',
    });
  });

  it.each([{}, { transactionId: '' }, { transactionId: null }, { transactionId: 7 }, []])(
    'rejects %p',
    (value) => {
      expect(suggestWithAiSchema.safeParse(value).success).toBe(false);
    },
  );
});

describe('updateAiModelSchema', () => {
  it.each(['claude-3-5-haiku-latest', 'gpt-4o-mini', 'o3', 'ft:gpt-4o-mini:acme:v1'])(
    'accepts the plausible model id %s',
    (modelId) => {
      expect(updateAiModelSchema.parse({ modelId })).toEqual({ modelId });
    },
  );

  it('rejects an empty id with the pick-a-model message', () => {
    const parsed = updateAiModelSchema.safeParse({ modelId: '' });
    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues[0].message).toBe('Pick a model');
  });

  it('rejects a whitespace-only id, which trims to empty', () => {
    expect(updateAiModelSchema.safeParse({ modelId: '   ' }).success).toBe(false);
  });

  it('rejects an id past the 200-character bound', () => {
    expect(updateAiModelSchema.safeParse({ modelId: 'a'.repeat(201) }).success).toBe(false);
    expect(updateAiModelSchema.safeParse({ modelId: 'a'.repeat(200) }).success).toBe(true);
  });

  it.each(['gpt 4o mini', '../../etc/passwd', 'gpt-4o/mini', 'gpt-4o?x=1', 'gpt<4o>'])(
    'rejects %s, which is not shaped like a model id',
    (modelId) => {
      const parsed = updateAiModelSchema.safeParse({ modelId });
      expect(parsed.success).toBe(false);
      expect(parsed.error!.issues[0].message).toBe('That does not look like a model id');
    },
  );

  it('rejects a smuggled apiKey outright rather than silently dropping it', () => {
    expect(
      updateAiModelSchema.safeParse({ modelId: 'gpt-4o-mini', apiKey: 'sk-attacker' }).success,
    ).toBe(false);
  });

  it.each([{}, { modelId: 123 }, { modelId: null }, []])('rejects %p', (value) => {
    expect(updateAiModelSchema.safeParse(value).success).toBe(false);
  });
});
