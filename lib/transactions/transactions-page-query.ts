import { transactionFiltersToSearchParams } from '@/lib/transactions/transaction-filters';
import type { TransactionScope } from '@/lib/transactions/transaction-scope';

export const TRANSACTIONS_PAGE_SIZE = 50;

/**
 * Scope part of the paginated query. Its `toString()` is also the view's
 * request key, shared by the server page and the client.
 */
export const transactionsPageSearchParams = (scope: TransactionScope): URLSearchParams => {
  const params = transactionFiltersToSearchParams(scope.filters);
  if (scope.mobileSearch.trim()) params.set('mobileSearch', scope.mobileSearch);
  return params;
};

/** API URL for one page; no `cursor` = first page. */
export const transactionsPageUrl = (scopeKey: string, cursor?: string | null): string => {
  const params = new URLSearchParams(scopeKey);
  params.set('paginated', '1');
  params.set('limit', String(TRANSACTIONS_PAGE_SIZE));
  if (cursor) params.set('cursor', cursor);
  return `/api/transactions?${params.toString()}`;
};
