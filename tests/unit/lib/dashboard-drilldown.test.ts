import { describe, expect, it } from 'vitest';
import {
  overviewCategoryHref,
  overviewDayHref,
  overviewExpenseHref,
  overviewIncomeHref,
  overviewNetHref,
} from '@/lib/dashboard/drilldown';
import { parseTransactionFilters } from '@/lib/transactions/transaction-filters';

const paramsOf = (href: string): URLSearchParams => new URL(href, 'http://x').searchParams;

describe('overview drill-down hrefs', () => {
  it('scopes income to the month without transfers or card payments', () => {
    const filters = parseTransactionFilters(paramsOf(overviewIncomeHref(202602)));
    expect(filters).toMatchObject({
      from: '2026-02-01',
      to: '2026-02-28',
      type: 'INCOME',
      hideTransfers: true,
      hidePayments: true,
    });
  });

  it('scopes spending to the month without transfers', () => {
    const filters = parseTransactionFilters(paramsOf(overviewExpenseHref(202603)));
    expect(filters).toMatchObject({
      from: '2026-03-01',
      to: '2026-03-31',
      type: 'EXPENSE',
      hideTransfers: true,
      hidePayments: false,
    });
  });

  it('keeps both types for net', () => {
    const filters = parseTransactionFilters(paramsOf(overviewNetHref(202603)));
    expect(filters.type).toBeNull();
    expect(filters.hideTransfers).toBe(true);
    expect(filters.hidePayments).toBe(true);
  });

  it('filters to the given categories', () => {
    const filters = parseTransactionFilters(
      paramsOf(overviewCategoryHref(202603, ['cat-1', 'cat-2'])),
    );
    expect(filters.categoryIds).toEqual(['cat-1', 'cat-2']);
    expect(filters.uncategorizedOnly).toBe(false);
    expect(filters.type).toBe('EXPENSE');
  });

  it('falls back to uncategorized-only when no ids are given', () => {
    const filters = parseTransactionFilters(paramsOf(overviewCategoryHref(202603, [])));
    expect(filters.categoryIds).toEqual([]);
    expect(filters.uncategorizedOnly).toBe(true);
  });

  it('links a single day, optionally opening one transaction', () => {
    expect(overviewDayHref(202603, 5)).toBe('/transactions?from=2026-03-05&to=2026-03-05');
    const params = paramsOf(overviewDayHref(202603, 5, 'tx-1'));
    expect(params.get('from')).toBe('2026-03-05');
    expect(params.get('tx')).toBe('tx-1');
  });
});
