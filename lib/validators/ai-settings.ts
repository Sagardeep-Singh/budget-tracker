import { z } from 'zod';

export const AI_PROVIDERS = ['ANTHROPIC', 'OPENAI'] as const;

export const aiProviderSchema = z.enum(AI_PROVIDERS, {
  message: 'Pick a provider of Anthropic or OpenAI',
});

/**
 * Full-object PUT, following `updateReminderPreferenceSchema`: provider and key
 * are one user-visible setting, and a partial write would leave the server
 * guessing which provider a new key belongs to.
 */
export const saveAiSettingsSchema = z.object({
  provider: aiProviderSchema,
  apiKey: z.string().trim().min(20, 'That does not look like an API key').max(400),
  sendNote: z.boolean(),
  sendAmount: z.boolean(),
});

/**
 * Toggles only — no key round-trip, so flipping a toggle can never re-submit or
 * overwrite the stored key. `.strict()` rather than Zod's default unknown-key
 * stripping: a client that smuggles an `apiKey` field gets an outright 400
 * instead of a silent drop, which is the same closed-by-construction guarantee
 * but debuggable.
 */
export const updateAiTogglesSchema = z
  .object({
    sendNote: z.boolean(),
    sendAmount: z.boolean(),
  })
  .strict();

export type SaveAiSettingsInput = z.infer<typeof saveAiSettingsSchema>;
export type UpdateAiTogglesInput = z.infer<typeof updateAiTogglesSchema>;
