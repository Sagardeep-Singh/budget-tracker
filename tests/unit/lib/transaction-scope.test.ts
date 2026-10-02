import { describe, expect, it } from 'vitest';
import {
  compareTransactionOrder,
  dayKey,
  decodeTransactionCursor,
  encodeTransactionCursor,
  isAmountSubstringCandidate,
  isOlderThanCursor,
  needsExactStringMatch,
} from '@/lib/transactions/transaction-scope';

const base64url = (value: string): string =>
  Buffer.from(value, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

describe('encodeTransactionCursor / decodeTransactionCursor', () => {
  it('round-trips a cursor', () => {
    const date = new Date('2026-06-15T00:00:00.000Z');
    const decoded = decodeTransactionCursor(encodeTransactionCursor({ date, id: 'tx-1' }));

    expect(decoded).not.toBeNull();
    expect(decoded!.id).toBe('tx-1');
    expect(decoded!.date.getTime()).toBe(date.getTime());
  });

  it('returns null for an empty string', () => {
    expect(decodeTransactionCursor('')).toBeNull();
  });

  it('returns null for malformed base64', () => {
    expect(decodeTransactionCursor('not-base64url-!!!')).toBeNull();
  });

  it('returns null for valid base64 that is not JSON', () => {
    expect(decodeTransactionCursor(base64url('not json'))).toBeNull();
  });

  it('returns null when the date field is not a date', () => {
    expect(
      decodeTransactionCursor(base64url(JSON.stringify({ d: 'not-a-date', i: 'x' }))),
    ).toBeNull();
  });

  it('returns null when the date field is missing', () => {
    expect(decodeTransactionCursor(base64url(JSON.stringify({ i: 'x' })))).toBeNull();
  });

  it('returns null when the id field is missing', () => {
    expect(
      decodeTransactionCursor(base64url(JSON.stringify({ d: new Date().toISOString() }))),
    ).toBeNull();
  });
});

describe('compareTransactionOrder', () => {
  const older = { date: new Date('2026-06-10T00:00:00.000Z'), id: 'b' };
  const newer = { date: new Date('2026-06-15T00:00:00.000Z'), id: 'a' };

  it('sorts the later date first (newest-first comparator)', () => {
    expect(compareTransactionOrder(newer, older)).toBeLessThan(0);
    expect(compareTransactionOrder(older, newer)).toBeGreaterThan(0);
    expect([older, newer].sort(compareTransactionOrder)).toEqual([newer, older]);
  });

  it('breaks a same-date tie by the larger id first', () => {
    const date = new Date('2026-06-15T00:00:00.000Z');
    const low = { date, id: 'ckaa' };
    const high = { date, id: 'ckzz' };

    expect(compareTransactionOrder(high, low)).toBeLessThan(0);
    expect(compareTransactionOrder(low, high)).toBeGreaterThan(0);
    expect([low, high].sort(compareTransactionOrder)).toEqual([high, low]);
  });

  it('returns 0 for rows identical on both date and id', () => {
    const row = { date: new Date('2026-06-15T00:00:00.000Z'), id: 'same' };
    expect(compareTransactionOrder(row, { ...row })).toBe(0);
  });

  it('pins the sign convention the keyset predicate is built from: > 0 means the first row is older', () => {
    // `orderBy: [{ date: 'desc' }, { id: 'desc' }]` plus the keyset clause
    // `{ OR: [{ date: { lt: d } }, { date: d, id: { lt: i } }] }` both mean
    // "strictly older than the cursor" — so a positive comparator result must
    // be exactly the rows that clause would select.
    const cursor = { date: new Date('2026-06-15T00:00:00.000Z'), id: 'ckmm' };
    const olderByDate = { date: new Date('2026-06-14T00:00:00.000Z'), id: 'ckzz' };
    const olderById = { date: cursor.date, id: 'ckll' };
    const newerById = { date: cursor.date, id: 'cknn' };

    expect(compareTransactionOrder(olderByDate, cursor)).toBeGreaterThan(0);
    expect(isOlderThanCursor(olderByDate, cursor)).toBe(true);
    expect(isOlderThanCursor(olderById, cursor)).toBe(true);
    expect(isOlderThanCursor(newerById, cursor)).toBe(false);
    // the cursor row itself is never re-returned
    expect(isOlderThanCursor(cursor, cursor)).toBe(false);
  });
});

describe('isAmountSubstringCandidate', () => {
  it('is false for an empty or whitespace-only term', () => {
    expect(isAmountSubstringCandidate('')).toBe(false);
    expect(isAmountSubstringCandidate('   ')).toBe(false);
  });

  it('is true for a digits-and-dots term', () => {
    expect(isAmountSubstringCandidate('12.50')).toBe(true);
    expect(isAmountSubstringCandidate('12')).toBe(true);
  });

  it('is true for any `[0-9.]+` shape, not only a strict decimal grammar', () => {
    expect(isAmountSubstringCandidate('.')).toBe(true);
    expect(isAmountSubstringCandidate('12.5.0')).toBe(true);
  });

  it('is false for a term containing any other character', () => {
    expect(isAmountSubstringCandidate('Coffee')).toBe(false);
    expect(isAmountSubstringCandidate('12.50a')).toBe(false);
    expect(isAmountSubstringCandidate('-12')).toBe(false);
  });
});

describe('needsExactStringMatch', () => {
  // Probe (see the plan doc's "Probe result: Prisma 6.19.3 `contains` escaping")
  // found `contains` does NOT escape LIKE metacharacters, so this branch is kept.
  it('is false for an empty term', () => {
    expect(needsExactStringMatch('')).toBe(false);
  });

  it('is false for a plain term', () => {
    expect(needsExactStringMatch('Coffee')).toBe(false);
    expect(needsExactStringMatch('12.50')).toBe(false);
  });

  it('is true for a term containing a percent sign', () => {
    expect(needsExactStringMatch('100%')).toBe(true);
    expect(needsExactStringMatch('100% Coffee')).toBe(true);
  });

  it('is true for a term containing an underscore, digits or not', () => {
    expect(needsExactStringMatch('Whole_Foods')).toBe(true);
    expect(needsExactStringMatch('_')).toBe(true);
  });
});

describe('Mode B trigger (isAmountSubstringCandidate or needsExactStringMatch)', () => {
  const isModeB = (term: string): boolean =>
    term.trim() !== '' && (isAmountSubstringCandidate(term) || needsExactStringMatch(term));

  it.each([
    ['', false],
    ['   ', false],
    ['12.50', true],
    ['.', true],
    ['12.5.0', true],
    ['Coffee', false],
    ['100%', true],
    ['Whole_Foods', true],
  ] as [string, boolean][])('term %j → Mode B: %s', (term, expected) => {
    expect(isModeB(term)).toBe(expected);
  });
});

describe('dayKey', () => {
  it('returns the UTC calendar day of a UTC-midnight instant', () => {
    expect(dayKey(new Date('2026-06-15T00:00:00.000Z'))).toBe('2026-06-15');
  });

  it('returns the UTC calendar day of a non-midnight instant', () => {
    expect(dayKey(new Date('2026-06-15T23:00:00.000Z'))).toBe('2026-06-15');
  });

  it('derives from UTC, not local time', () => {
    // 23:00Z on the 15th is already the 16th in any TZ east of UTC+1 — the key
    // must still read '2026-06-15' so it matches the client's date.slice(0,10).
    expect(dayKey(new Date(Date.UTC(2026, 5, 15, 23, 0, 0)))).toBe('2026-06-15');
    expect(dayKey(new Date(Date.UTC(2026, 5, 15, 0, 30, 0)))).toBe('2026-06-15');
  });
});
