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

/**
 * Model id only — `.strict()`, following `updateAiTogglesSchema`: a client that
 * smuggles an `apiKey` or `provider` field gets a 400 rather than a silent drop.
 *
 * Deliberately not checked against a live list: that would cost a provider call
 * per model change, and the list is not ground truth for what the completion
 * endpoint accepts anyway (a rejected id surfaces as `AiModelRejectedError`).
 * This only bounds the value to a plausible model id.
 */
export const updateAiModelSchema = z
  .object({
    modelId: z
      .string()
      .trim()
      .min(1, 'Pick a model')
      .max(200)
      .regex(/^[A-Za-z0-9._:-]+$/, 'That does not look like a model id'),
  })
  .strict();

export type SaveAiSettingsInput = z.infer<typeof saveAiSettingsSchema>;
export type UpdateAiTogglesInput = z.infer<typeof updateAiTogglesSchema>;
export type UpdateAiModelInput = z.infer<typeof updateAiModelSchema>;
