import { describe, expect, it } from 'vitest';
import {
  REMINDER_CADENCES,
  reminderCadenceSchema,
  updateReminderPreferenceSchema,
} from '@/lib/validators/reminders';

describe('reminderCadenceSchema', () => {
  it('accepts every cadence the schema enum declares', () => {
    for (const cadence of REMINDER_CADENCES) {
      expect(reminderCadenceSchema.safeParse(cadence).success).toBe(true);
    }
  });

  it('rejects an unknown cadence', () => {
    expect(reminderCadenceSchema.safeParse('HOURLY').success).toBe(false);
    expect(reminderCadenceSchema.safeParse('YEARLY').success).toBe(false);
  });

  it('is case-sensitive, so a lowercased client value is rejected rather than coerced', () => {
    expect(reminderCadenceSchema.safeParse('daily').success).toBe(false);
  });

  it('rejects non-string cadences', () => {
    expect(reminderCadenceSchema.safeParse(null).success).toBe(false);
    expect(reminderCadenceSchema.safeParse(1).success).toBe(false);
    expect(reminderCadenceSchema.safeParse(undefined).success).toBe(false);
  });
});

describe('updateReminderPreferenceSchema', () => {
  it('accepts a full enabled + cadence object', () => {
    const parsed = updateReminderPreferenceSchema.parse({ enabled: true, cadence: 'WEEKLY' });
    expect(parsed).toEqual({ enabled: true, cadence: 'WEEKLY' });
  });

  it('requires cadence even when only toggling enabled', () => {
    // Full-object PATCH by design: a client must not be able to flip `enabled`
    // and leave the server guessing at a cadence.
    expect(updateReminderPreferenceSchema.safeParse({ enabled: true }).success).toBe(false);
  });

  it('requires enabled', () => {
    expect(updateReminderPreferenceSchema.safeParse({ cadence: 'DAILY' }).success).toBe(false);
  });

  it('rejects a truthy non-boolean enabled rather than coercing it', () => {
    expect(
      updateReminderPreferenceSchema.safeParse({ enabled: 'yes', cadence: 'DAILY' }).success,
    ).toBe(false);
    expect(updateReminderPreferenceSchema.safeParse({ enabled: 1, cadence: 'DAILY' }).success).toBe(
      false,
    );
  });

  it('rejects an empty body', () => {
    expect(updateReminderPreferenceSchema.safeParse({}).success).toBe(false);
    expect(updateReminderPreferenceSchema.safeParse(null).success).toBe(false);
  });

  it('strips unknown keys instead of persisting them', () => {
    const parsed = updateReminderPreferenceSchema.parse({
      enabled: false,
      cadence: 'MONTHLY',
      lastSentAt: '2026-01-01T00:00:00.000Z',
    });
    expect(parsed).toEqual({ enabled: false, cadence: 'MONTHLY' });
  });
});
