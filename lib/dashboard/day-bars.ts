import type { OverviewDayBar } from '@/lib/services/overview';

export type ByDayBarsMode = 'week' | 'month';

/**
 * The Overview by-day chart shows every day of the month at desktop width and a
 * 7-day window around the selected day on mobile, where ~30 bars are unreadable.
 *
 * The window is clamped to the current month — it never wraps into the previous
 * or next month — so near day 1 or the month's end it slides rather than
 * spilling. Returns a new array; the input is never mutated.
 */
export const getByDayBars = (
  days: OverviewDayBar[],
  mode: ByDayBarsMode,
  referenceDay: number,
  daysInMonth: number,
): OverviewDayBar[] => {
  if (mode === 'month') return [...days];

  const lastPossibleStart = Math.max(daysInMonth - 6, 1);
  const reference = Math.min(Math.max(referenceDay, 1), daysInMonth);
  const start = Math.min(Math.max(reference - 3, 1), lastPossibleStart);
  const end = start + 6;

  return days.filter((d) => d.day >= start && d.day <= end);
};
