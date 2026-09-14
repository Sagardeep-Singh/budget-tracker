import { describe, expect, it } from 'vitest';
import { getByDayBars } from '@/lib/dashboard/day-bars';
import type { OverviewDayBar } from '@/lib/services/overview';

const monthOf = (daysInMonth: number): OverviewDayBar[] =>
  Array.from({ length: daysInMonth }, (_, i) => ({ day: i + 1, income: i, expense: i * 2 }));

describe('getByDayBars', () => {
  it('returns every day unchanged in month mode', () => {
    const days = monthOf(30);
    const result = getByDayBars(days, 'month', 15, 30);

    expect(result).toHaveLength(30);
    expect(result.map((d) => d.day)).toEqual(days.map((d) => d.day));
    expect(result[0]).toEqual(days[0]);
  });

  it('returns exactly 7 days in week mode', () => {
    const result = getByDayBars(monthOf(31), 'week', 15, 31);
    expect(result).toHaveLength(7);
  });

  it('includes the reference day in the week window', () => {
    for (const reference of [1, 2, 5, 15, 27, 30, 31]) {
      const result = getByDayBars(monthOf(31), 'week', reference, 31);
      expect(result).toHaveLength(7);
      expect(result.map((d) => d.day)).toContain(reference);
    }
  });

  it('clamps to the start of the month rather than crossing into the previous one', () => {
    expect(getByDayBars(monthOf(31), 'week', 1, 31).map((d) => d.day)).toEqual([
      1, 2, 3, 4, 5, 6, 7,
    ]);
    expect(getByDayBars(monthOf(31), 'week', 3, 31).map((d) => d.day)).toEqual([
      1, 2, 3, 4, 5, 6, 7,
    ]);
  });

  it('clamps to the end of the month rather than crossing into the next one', () => {
    expect(getByDayBars(monthOf(31), 'week', 31, 31).map((d) => d.day)).toEqual([
      25, 26, 27, 28, 29, 30, 31,
    ]);
    expect(getByDayBars(monthOf(30), 'week', 30, 30).map((d) => d.day)).toEqual([
      24, 25, 26, 27, 28, 29, 30,
    ]);
  });

  it('centres the window on the reference day when there is room on both sides', () => {
    expect(getByDayBars(monthOf(31), 'week', 15, 31).map((d) => d.day)).toEqual([
      12, 13, 14, 15, 16, 17, 18,
    ]);
  });

  it('handles a 28-day February at both boundaries', () => {
    expect(getByDayBars(monthOf(28), 'week', 1, 28).map((d) => d.day)).toEqual([
      1, 2, 3, 4, 5, 6, 7,
    ]);
    expect(getByDayBars(monthOf(28), 'week', 28, 28).map((d) => d.day)).toEqual([
      22, 23, 24, 25, 26, 27, 28,
    ]);
    expect(getByDayBars(monthOf(28), 'week', 14, 28)).toHaveLength(7);
  });

  it('does not mutate the input array', () => {
    const days = monthOf(31);
    const snapshot = days.map((d) => ({ ...d }));

    getByDayBars(days, 'week', 15, 31);
    getByDayBars(days, 'month', 15, 31);

    expect(days).toEqual(snapshot);
    expect(getByDayBars(days, 'month', 15, 31)).not.toBe(days);
  });
});
