import type { TransactionFilters } from '@/lib/transactions/transaction-filters';

/**
 * Pure (DB-free) definitions shared by the paginated read path: the request
 * scope, the total order pagination is built on, the opaque cursor codec and
 * the two search-shape predicates that decide whether a text term can be
 * handed to Prisma at all.
 *
 * Kept out of `lib/services/transactionsPage.ts` so the ordering/cursor rules
 * have one home that the service, the route and the tests all read from, and
 * so they are unit-testable without mocking Prisma.
 */

/** Mobile quick-filter pills. Mirrors the pill set in `transactions-view.tsx`. */
export type QuickFilter = 'all' | 'uncategorized' | 'spending' | 'income';

export type TransactionScope = {
  /** the desktop filter set, unchanged shape, straight off the URL */
  filters: TransactionFilters;
  /** the Period Picker's `[start, end)` window; `null` = All time */
  period: { start: Date; end: Date } | null;
  /** mobile search box: payee OR formatted-amount substring. `''` = no filter */
  mobileSearch: string;
  /** mobile quick-filter pills */
  quickFilter: QuickFilter;
};

export type TransactionCursor = { date: Date; id: string };

/** Anything sortable/comparable by the `(date desc, id desc)` total order. */
export type OrderedRow = { date: Date; id: string };

/**
 * The one comparator behind the page `orderBy`, the keyset predicate, Mode B's
 * in-memory sort/slice and the strictly-older running-balance predicate.
 *
 * Sign convention, pinned because any inversion silently corrupts pagination:
 * it is a `.sort()` comparator for **newest first**, so
 * `compareTransactionOrder(a, b) > 0` means **`a` is older than `b`** — which
 * is exactly the "strictly older than the cursor" test Mode B filters on, and
 * mirrors `orderBy: [{ date: 'desc' }, { id: 'desc' }]`.
 */
export const compareTransactionOrder = (a: OrderedRow, b: OrderedRow): number => {
  const byDate = b.date.getTime() - a.date.getTime();
  if (byDate !== 0) return byDate;
  if (a.id === b.id) return 0;
  return a.id < b.id ? 1 : -1;
};

/** True when `row` sits strictly older than `cursor` in the total order above. */
export const isOlderThanCursor = (row: OrderedRow, cursor: TransactionCursor): boolean =>
  compareTransactionOrder(row, cursor) > 0;

const toBase64Url = (value: string): string =>
  Buffer.from(value, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

export const encodeTransactionCursor = (cursor: TransactionCursor): string =>
  toBase64Url(JSON.stringify({ d: cursor.date.toISOString(), i: cursor.id }));

/** `null` on any malformed input (bad base64, bad JSON, missing/invalid fields). */
export const decodeTransactionCursor = (raw: string): TransactionCursor | null => {
  if (!raw) return null;
  // Reject anything outside the base64url alphabet up front: Buffer's base64
  // decoder is lenient and would silently drop stray characters.
  if (!/^[A-Za-z0-9_-]+$/.test(raw)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const { d, i } = parsed as { d?: unknown; i?: unknown };
  if (typeof d !== 'string' || typeof i !== 'string' || i === '') return null;
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return null;
  return { date, id: i };
};

/**
 * Today's mobile search matches `Number(amount).toFixed(2).includes(term)`, and
 * `toFixed(2)` output only ever contains `[0-9.]` (amounts are positive; the
 * sign lives in `type`). So a term of only digits/dots is the exact set of
 * terms that *can* match the amount branch — not an approximation — and is the
 * set that has to be matched in JS rather than by a Prisma clause.
 */
export const isAmountSubstringCandidate = (term: string): boolean => /^[0-9.]+$/.test(term.trim());

/**
 * Prisma 6.19.3's `contains` compiles to `LIKE '%<param>%'` **without**
 * escaping LIKE metacharacters — probed against the local Postgres, see
 * `docs/feature-plans/transactions-server-side-pagination.md`
 * ("Probe result: Prisma 6.19.3 `contains` escaping"): `contains: '%'` matched
 * every row with a payee instead of the rows literally containing a percent
 * sign. Any term carrying `%` or `_` therefore has to be matched in JS to keep
 * `matchesTransactionFilters`' plain `String.includes` semantics.
 */
export const needsExactStringMatch = (term: string): boolean =>
  term.includes('%') || term.includes('_');

/**
 * UTC calendar day of an instant, as `YYYY-MM-DD`. Derived from the ISO string
 * so it agrees with both `formatDate`'s pinned `timeZone: 'UTC'` and the
 * client's own `t.date.slice(0, 10)` grouping, regardless of the host's `TZ`.
 */
export const dayKey = (date: Date): string => date.toISOString().slice(0, 10);
