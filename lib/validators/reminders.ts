import { z } from 'zod';

export const REMINDER_CADENCES = ['DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY'] as const;

export const reminderCadenceSchema = z.enum(REMINDER_CADENCES, {
  message: 'Pick a cadence of daily, weekly, biweekly, or monthly',
});

/**
 * Full-object PATCH rather than a partial one: the toggle and the cadence are a
 * single user-visible setting, and accepting `enabled` on its own would leave the
 * server guessing which cadence a freshly-opted-in user meant.
 */
export const updateReminderPreferenceSchema = z.object({
  enabled: z.boolean(),
  cadence: reminderCadenceSchema,
});

export type ReminderCadence = z.infer<typeof reminderCadenceSchema>;
export type UpdateReminderPreferenceInput = z.infer<typeof updateReminderPreferenceSchema>;
