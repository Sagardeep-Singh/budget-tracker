import { describe, expect, it } from 'vitest';
import {
  getCalendarMonthPeriod,
  getNextStatementPeriod,
  getPreviousStatementPeriod,
  getStatementPeriod,
  isStatementPeriod,
} from '@/lib/statement';

const iso = (date: Date): string => date.toISOString();

describe('getStatementPeriod', () => {
  it('covers the day after the previous close through this month close, inclusive', () => {
    const period = getStatementPeriod(15, new Date('2026-03-10T00:00:00Z'));
    expect(iso(period.start)).toBe('2026-02-16T00:00:00.000Z');
    expect(iso(period.end)).toBe('2026-03-16T00:00:00.000Z');
  });

  it('rolls into next month once the reference date is past the close day', () => {
    const period = getStatementPeriod(15, new Date('2026-03-20T00:00:00Z'));
    expect(iso(period.start)).toBe('2026-03-16T00:00:00.000Z');
    expect(iso(period.end)).toBe('2026-04-16T00:00:00.000Z');
  });

  it('handles the December -> January year wraparound', () => {
    const period = getStatementPeriod(5, new Date('2026-01-02T00:00:00Z'));
    expect(iso(period.start)).toBe('2025-12-06T00:00:00.000Z');
    expect(iso(period.end)).toBe('2026-01-06T00:00:00.000Z');
  });

  it('handles a statement day at the boundary itself', () => {
    const period = getStatementPeriod(15, new Date('2026-03-15T00:00:00Z'));
    expect(iso(period.start)).toBe('2026-02-16T00:00:00.000Z');
    expect(iso(period.end)).toBe('2026-03-16T00:00:00.000Z');
  });
});

describe('getPreviousStatementPeriod / getNextStatementPeriod', () => {
  it('navigate adjacent periods without skipping or overlapping', () => {
    const current = getStatementPeriod(28, new Date('2026-02-10T00:00:00Z'));
    const previous = getPreviousStatementPeriod(28, current);
    const next = getNextStatementPeriod(28, current);

    expect(previous.end.getTime()).toBe(current.start.getTime());
    expect(next.start.getTime()).toBe(current.end.getTime());
  });
});

describe('getCalendarMonthPeriod', () => {
  it('returns the first-of-month to first-of-next-month range', () => {
    const period = getCalendarMonthPeriod(202603);
    expect(iso(period.start)).toBe('2026-03-01T00:00:00.000Z');
    expect(iso(period.end)).toBe('2026-04-01T00:00:00.000Z');
  });

  it('handles December correctly', () => {
    const period = getCalendarMonthPeriod(202512);
    expect(iso(period.start)).toBe('2025-12-01T00:00:00.000Z');
    expect(iso(period.end)).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('isStatementPeriod', () => {
  it('is true for exactly one statement period', () => {
    expect(isStatementPeriod(15, getStatementPeriod(15, new Date('2026-03-10T00:00:00Z')))).toBe(
      true,
    );
  });

  it('is false for a calendar month or a period for a different close day', () => {
    expect(isStatementPeriod(15, getCalendarMonthPeriod(202603))).toBe(false);
    expect(isStatementPeriod(15, getStatementPeriod(20, new Date('2026-03-10T00:00:00Z')))).toBe(
      false,
    );
  });
});
