import { transactionFiltersToSearchParams } from '@/lib/transactions/transaction-filters';
import type { TransactionScope } from '@/lib/transactions/transaction-scope';

/** Decision 3: the Transactions page loads 50 rows at a time. */
export const TRANSACTIONS_PAGE_SIZE = 50;

/**
 * The scope half of a `GET /api/transactions?paginated=1` query string.
 *
 * The desktop filters reuse `transactionFiltersToSearchParams`, so they keep
 * the exact bookmarkable param names and default-omission rules the URL already
 * uses; the period and mobile params are appended only when non-default.
 *
 * Its `toString()` doubles as the Transactions view's request key: the server
 * page (`app/(protected)/transactions/page.tsx`) and the client view build the
 * same scope through this one function, so "is the SSR page still the page for
 * what's on screen?" is a plain string comparison rather than a second,
 * hand-rolled serialization that could drift.
 */
export const transactionsPageSearchParams = (scope: TransactionScope): URLSearchParams => {
  const params = transactionFiltersToSearchParams(scope.filters);
  if (scope.period) {
    params.set('periodStart', scope.period.start.toISOString());
    params.set('periodEnd', scope.period.end.toISOString());
  }
  if (scope.mobileSearch.trim()) params.set('mobileSearch', scope.mobileSearch);
  if (scope.quickFilter !== 'all') params.set('quickFilter', scope.quickFilter);
  return params;
};

/** Full API URL for one page of `scope`; `cursor` absent = first page. */
export const transactionsPageUrl = (scopeKey: string, cursor?: string | null): string => {
  const params = new URLSearchParams(scopeKey);
  params.set('paginated', '1');
  params.set('limit', String(TRANSACTIONS_PAGE_SIZE));
  if (cursor) params.set('cursor', cursor);
  return `/api/transactions?${params.toString()}`;
};
