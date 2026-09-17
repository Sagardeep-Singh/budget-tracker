import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TRANSACTION_FILTERS,
  countActiveFilterGroups,
  matchesTransactionFilters,
  parseTransactionFilters,
  transactionFiltersToSearchParams,
  type TransactionFilters,
} from '@/lib/transactions/transaction-filters';
import type { FrontendTransaction } from '@/lib/services/transactions';

const tx = (overrides: Partial<FrontendTransaction> = {}): FrontendTransaction => ({
  id: 't1',
  accountId: 'acc1',
  accountName: 'Checking',
  categoryId: 'cat1',
  categoryName: 'Groceries',
  amount: '50.00',
  type: 'EXPENSE',
  date: '2026-06-15T00:00:00.000Z',
  payee: 'Whole Foods',
  note: null,
  isPayment: false,
  importBatchId: null,
  importBatchFilename: null,
  isTransfer: false,
  transferMatchId: null,
  isReimbursable: false,
  reimbursementExpectedAmount: null,
  reimbursementLinkedTotal: '0.00',
  reimbursementOutstanding: '0.00',
  reimbursementStatus: null,
  reimbursementCompletedManually: false,
  isReimbursementIncome: false,
  reimbursementIncomeLinkedTotal: '0.00',
  ...overrides,
});

describe('countActiveFilterGroups', () => {
  it('is 0 for the default filters', () => {
    expect(countActiveFilterGroups(DEFAULT_TRANSACTION_FILTERS)).toBe(0);
  });

  it('counts a multi-select group as 1 regardless of how many ids are selected', () => {
    expect(
      countActiveFilterGroups({
        ...DEFAULT_TRANSACTION_FILTERS,
        accountIds: ['a', 'b', 'c'],
      }),
    ).toBe(1);
  });

  it('counts each flag toggle independently', () => {
    expect(
      countActiveFilterGroups({
        ...DEFAULT_TRANSACTION_FILTERS,
        hideTransfers: true,
        hidePayments: true,
        uncategorizedOnly: true,
      }),
    ).toBe(3);
  });

  it('counts a date range, amount range, and type as one group each', () => {
    expect(
      countActiveFilterGroups({
        ...DEFAULT_TRANSACTION_FILTERS,
        from: '2026-01-01',
        amountMin: '10',
        type: 'INCOME',
      }),
    ).toBe(3);
  });

  it('excludes the payee search box from the count', () => {
    expect(countActiveFilterGroups({ ...DEFAULT_TRANSACTION_FILTERS, payee: 'coffee' })).toBe(0);
  });
});

describe('URL param round-trip', () => {
  it('parses back to the default filters from empty params', () => {
    expect(parseTransactionFilters(new URLSearchParams())).toEqual(DEFAULT_TRANSACTION_FILTERS);
  });

  it('round-trips every field through serialize -> parse', () => {
    const filters: TransactionFilters = {
      from: '2026-01-01',
      to: '2026-01-31',
      accountIds: ['acc1', 'acc2'],
      categoryIds: ['cat1'],
      payee: 'Whole Foods',
      type: 'EXPENSE',
      amountMin: '10.50',
      amountMax: '100',
      hideTransfers: true,
      hidePayments: true,
      uncategorizedOnly: true,
    };

    const params = transactionFiltersToSearchParams(filters);
    expect(parseTransactionFilters(params)).toEqual(filters);
  });

  it('omits default-valued fields from the serialized params', () => {
    const params = transactionFiltersToSearchParams({
      ...DEFAULT_TRANSACTION_FILTERS,
      payee: 'coffee',
    });
    expect(params.toString()).toBe('payee=coffee');
  });

  it('falls back to no-filter on a malformed type param rather than throwing', () => {
    const params = new URLSearchParams('type=BOGUS');
    expect(parseTransactionFilters(params).type).toBeNull();
  });

  it('drops empty segments from a malformed ids param', () => {
    const params = new URLSearchParams('accountIds=a,,b,');
    expect(parseTransactionFilters(params).accountIds).toEqual(['a', 'b']);
  });
});

describe('matchesTransactionFilters', () => {
  it('matches everything under the default filters', () => {
    expect(matchesTransactionFilters(tx(), DEFAULT_TRANSACTION_FILTERS)).toBe(true);
  });

  it('filters by payee, case-insensitively', () => {
    const filters = { ...DEFAULT_TRANSACTION_FILTERS, payee: 'whole' };
    expect(matchesTransactionFilters(tx({ payee: 'Whole Foods' }), filters)).toBe(true);
    expect(matchesTransactionFilters(tx({ payee: 'Trader Joes' }), filters)).toBe(false);
    expect(matchesTransactionFilters(tx({ payee: null }), filters)).toBe(false);
  });

  it('filters by accountIds membership', () => {
    const filters = { ...DEFAULT_TRANSACTION_FILTERS, accountIds: ['acc1', 'acc2'] };
    expect(matchesTransactionFilters(tx({ accountId: 'acc1' }), filters)).toBe(true);
    expect(matchesTransactionFilters(tx({ accountId: 'acc3' }), filters)).toBe(false);
  });

  it('filters by categoryIds membership, excluding uncategorized rows', () => {
    const filters = { ...DEFAULT_TRANSACTION_FILTERS, categoryIds: ['cat1'] };
    expect(matchesTransactionFilters(tx({ categoryId: 'cat1' }), filters)).toBe(true);
    expect(matchesTransactionFilters(tx({ categoryId: 'cat2' }), filters)).toBe(false);
    expect(matchesTransactionFilters(tx({ categoryId: null }), filters)).toBe(false);
  });

  it('filters by date range inclusively on both ends', () => {
    const filters = { ...DEFAULT_TRANSACTION_FILTERS, from: '2026-06-10', to: '2026-06-20' };
    expect(matchesTransactionFilters(tx({ date: '2026-06-10T00:00:00.000Z' }), filters)).toBe(true);
    expect(matchesTransactionFilters(tx({ date: '2026-06-20T23:59:59.000Z' }), filters)).toBe(true);
    expect(matchesTransactionFilters(tx({ date: '2026-06-09T23:59:59.000Z' }), filters)).toBe(
      false,
    );
    expect(matchesTransactionFilters(tx({ date: '2026-06-21T00:00:00.000Z' }), filters)).toBe(
      false,
    );
  });

  it('filters by transaction type', () => {
    const filters = { ...DEFAULT_TRANSACTION_FILTERS, type: 'INCOME' as const };
    expect(matchesTransactionFilters(tx({ type: 'INCOME' }), filters)).toBe(true);
    expect(matchesTransactionFilters(tx({ type: 'EXPENSE' }), filters)).toBe(false);
  });

  it('filters by amount range', () => {
    const filters = { ...DEFAULT_TRANSACTION_FILTERS, amountMin: '20', amountMax: '100' };
    expect(matchesTransactionFilters(tx({ amount: '50.00' }), filters)).toBe(true);
    expect(matchesTransactionFilters(tx({ amount: '10.00' }), filters)).toBe(false);
    expect(matchesTransactionFilters(tx({ amount: '150.00' }), filters)).toBe(false);
  });

  it('hides transfers when hideTransfers is set', () => {
    const filters = { ...DEFAULT_TRANSACTION_FILTERS, hideTransfers: true };
    expect(matchesTransactionFilters(tx({ isTransfer: true }), filters)).toBe(false);
    expect(matchesTransactionFilters(tx({ isTransfer: false }), filters)).toBe(true);
  });

  it('hides card payments when hidePayments is set', () => {
    const filters = { ...DEFAULT_TRANSACTION_FILTERS, hidePayments: true };
    expect(matchesTransactionFilters(tx({ isPayment: true }), filters)).toBe(false);
    expect(matchesTransactionFilters(tx({ isPayment: false }), filters)).toBe(true);
  });

  it('shows only uncategorized rows when uncategorizedOnly is set', () => {
    const filters = { ...DEFAULT_TRANSACTION_FILTERS, uncategorizedOnly: true };
    expect(matchesTransactionFilters(tx({ categoryId: null }), filters)).toBe(true);
    expect(matchesTransactionFilters(tx({ categoryId: 'cat1' }), filters)).toBe(false);
  });

  it('combines multiple active filters with AND', () => {
    const filters: TransactionFilters = {
      ...DEFAULT_TRANSACTION_FILTERS,
      accountIds: ['acc1'],
      type: 'EXPENSE',
      amountMin: '10',
    };
    expect(
      matchesTransactionFilters(
        tx({ accountId: 'acc1', type: 'EXPENSE', amount: '50.00' }),
        filters,
      ),
    ).toBe(true);
    expect(
      matchesTransactionFilters(
        tx({ accountId: 'acc2', type: 'EXPENSE', amount: '50.00' }),
        filters,
      ),
    ).toBe(false);
  });
});
