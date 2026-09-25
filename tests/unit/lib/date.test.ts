import { describe, expect, it } from 'vitest';

import { daysInMonth, monthRange } from '@/lib/date';

describe('monthRange', () => {
  it('returns the month as a half-open UTC range', () => {
    const { start, end } = monthRange(202603);
    expect(start.toISOString()).toBe('2026-03-01T00:00:00.000Z');
    expect(end.toISOString()).toBe('2026-04-01T00:00:00.000Z');
  });

  it('rolls the year over for December', () => {
    const { start, end } = monthRange(202612);
    expect(start.toISOString()).toBe('2026-12-01T00:00:00.000Z');
    expect(end.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('uses UTC midnight boundaries regardless of the host timezone', () => {
    const { start } = monthRange(202601);
    expect(start.getUTCHours()).toBe(0);
    expect(start.getUTCDate()).toBe(1);
  });
});

describe('daysInMonth', () => {
  it('counts 31-, 30- and 28-day months', () => {
    expect(daysInMonth(202601)).toBe(31);
    expect(daysInMonth(202604)).toBe(30);
    expect(daysInMonth(202602)).toBe(28);
  });

  it('counts 29 days in a leap February', () => {
    expect(daysInMonth(202402)).toBe(29);
  });

  it('counts December without spilling into the next year', () => {
    expect(daysInMonth(202612)).toBe(31);
  });
});
