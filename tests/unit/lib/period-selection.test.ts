import { describe, expect, it } from 'vitest';
import {
  decodePeriodCookie,
  encodePeriodCookie,
  monthToRange,
  parseDateParam,
  periodSelectionLabel,
  periodToRange,
  rangeFromSelection,
  rangeToDates,
  selectionFromRange,
  selectionMonth,
} from '@/lib/period-selection';

describe('parseDateParam', () => {
  it('accepts a real yyyy-mm-dd date', () => {
    expect(parseDateParam('2026-02-28')).toBe('2026-02-28');
  });

  it.each([null, undefined, '', '2026-2-1', '2026-02-30', 'garbage', '2026-13-01'])(
    'rejects %s',
    (value) => {
      expect(parseDateParam(value)).toBeNull();
    },
  );
});

describe('monthToRange', () => {
  it('covers the whole month, inclusive, including leap years', () => {
    expect(monthToRange(202609)).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(monthToRange(202802)).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });
});

describe('periodToRange', () => {
  it('turns an exclusive end into an inclusive last day', () => {
    expect(
      periodToRange({
        start: new Date('2026-08-16T00:00:00Z'),
        end: new Date('2026-09-16T00:00:00Z'),
      }),
    ).toEqual({ from: '2026-08-16', to: '2026-09-15' });
  });
});

describe('selectionFromRange', () => {
  it('is all time with no bounds', () => {
    expect(selectionFromRange({ from: null, to: null })).toEqual({ kind: 'all' });
  });

  it('recognizes an exact calendar month', () => {
    expect(selectionFromRange({ from: '2026-09-01', to: '2026-09-30' })).toEqual({
      kind: 'month',
      month: 202609,
    });
  });

  it('treats a partial month, a span of months, or an open side as custom', () => {
    expect(selectionFromRange({ from: '2026-09-01', to: '2026-09-29' }).kind).toBe('custom');
    expect(selectionFromRange({ from: '2026-08-01', to: '2026-09-30' }).kind).toBe('custom');
    expect(selectionFromRange({ from: '2026-09-01', to: null }).kind).toBe('custom');
  });

  it('round-trips with rangeFromSelection', () => {
    for (const range of [
      { from: null, to: null },
      { from: '2026-09-01', to: '2026-09-30' },
      { from: '2026-09-03', to: '2026-10-02' },
    ]) {
      expect(rangeFromSelection(selectionFromRange(range))).toEqual(range);
    }
  });
});

describe('rangeToDates', () => {
  it('is half-open in UTC, with the end day included', () => {
    expect(rangeToDates({ from: '2026-09-01', to: '2026-09-30' })).toEqual({
      gte: new Date('2026-09-01T00:00:00Z'),
      lt: new Date('2026-10-01T00:00:00Z'),
    });
  });

  it('omits missing sides', () => {
    expect(rangeToDates({ from: null, to: null })).toEqual({});
    expect(rangeToDates({ from: null, to: '2026-09-30' })).toEqual({
      lt: new Date('2026-10-01T00:00:00Z'),
    });
  });
});

describe('periodSelectionLabel', () => {
  it('labels each kind of selection', () => {
    expect(periodSelectionLabel({ kind: 'all' })).toBe('All time');
    expect(periodSelectionLabel({ kind: 'month', month: 202609 })).toBe('September 2026');
    expect(periodSelectionLabel({ kind: 'custom', from: '2026-09-03', to: '2026-09-20' })).toBe(
      'Sep 3 – Sep 20, 2026',
    );
    expect(periodSelectionLabel({ kind: 'custom', from: '2025-12-20', to: '2026-01-05' })).toBe(
      'Dec 20, 2025 – Jan 5, 2026',
    );
    expect(periodSelectionLabel({ kind: 'custom', from: '2026-09-03', to: null })).toBe(
      'From Sep 3, 2026',
    );
    expect(periodSelectionLabel({ kind: 'custom', from: null, to: '2026-09-20' })).toBe(
      'Until Sep 20, 2026',
    );
  });
});

describe('period cookie', () => {
  it('round-trips every kind of selection', () => {
    for (const selection of [
      { kind: 'all' as const },
      { kind: 'month' as const, month: 202609 },
      { kind: 'custom' as const, from: '2026-09-03', to: '2026-09-20' },
      { kind: 'custom' as const, from: null, to: '2026-09-20' },
    ]) {
      expect(decodePeriodCookie(encodePeriodCookie(selection))).toEqual(selection);
    }
  });

  it('reads a stored range that is exactly one month as that month', () => {
    expect(decodePeriodCookie('r:2026-09-01:2026-09-30')).toEqual({ kind: 'month', month: 202609 });
  });

  it('ignores a missing or tampered value rather than throwing', () => {
    for (const value of [undefined, '', 'm:202613', 'm:abc', 'r::', 'r:2026-02-30:', 'garbage']) {
      expect(decodePeriodCookie(value)).toBeNull();
    }
  });
});

describe('selectionMonth', () => {
  it('uses the month, the month a range ends in, or the fallback', () => {
    expect(selectionMonth({ kind: 'month', month: 202601 }, 202609)).toBe(202601);
    expect(selectionMonth({ kind: 'custom', from: '2026-03-10', to: '2026-04-05' }, 202609)).toBe(
      202604,
    );
    expect(selectionMonth({ kind: 'custom', from: '2026-03-10', to: null }, 202609)).toBe(202603);
    expect(selectionMonth({ kind: 'all' }, 202609)).toBe(202609);
    expect(selectionMonth(null, 202609)).toBe(202609);
  });
});
