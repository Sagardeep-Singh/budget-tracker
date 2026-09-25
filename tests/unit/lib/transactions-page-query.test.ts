import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_TRANSACTION_FILTERS,
  parseTransactionFilters,
} from '@/lib/transactions/transaction-filters';
import type { TransactionScope } from '@/lib/transactions/transaction-scope';
import {
  TRANSACTIONS_PAGE_SIZE,
  transactionsPageSearchParams,
  transactionsPageUrl,
} from '@/lib/transactions/transactions-page-query';
import { transactionsPageQuerySchema } from '@/lib/validators/transactions';

// the request mapper lives in the service module, which imports the Prisma singleton
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
const { toTransactionsPageRequest } = await import('@/lib/services/transactionsPage');

const scope = (overrides: Partial<TransactionScope> = {}): TransactionScope => ({
  filters: DEFAULT_TRANSACTION_FILTERS,
  period: null,
  mobileSearch: '',
  quickFilter: 'all',
  ...overrides,
});

describe('transactionsPageSearchParams', () => {
  it('is empty for the default scope', () => {
    expect(transactionsPageSearchParams(scope()).toString()).toBe('');
  });

  it('keeps the bookmarkable desktop filter param names', () => {
    const params = transactionsPageSearchParams(
      scope({
        filters: {
          ...DEFAULT_TRANSACTION_FILTERS,
          accountIds: ['a', 'b'],
          payee: 'Cafe',
          hideTransfers: true,
        },
      }),
    );
    expect(params.get('accountIds')).toBe('a,b');
    expect(params.get('payee')).toBe('Cafe');
    expect(params.get('hideTransfers')).toBe('true');
  });

  it('adds period and mobile params only when non-default', () => {
    const start = new Date('2026-06-05T00:00:00.000Z');
    const end = new Date('2026-07-05T00:00:00.000Z');
    const params = transactionsPageSearchParams(
      scope({ period: { start, end }, mobileSearch: '12.5', quickFilter: 'income' }),
    );
    expect(params.get('periodStart')).toBe(start.toISOString());
    expect(params.get('periodEnd')).toBe(end.toISOString());
    expect(params.get('mobileSearch')).toBe('12.5');
    expect(params.get('quickFilter')).toBe('income');
    expect(transactionsPageSearchParams(scope({ mobileSearch: '   ' })).has('mobileSearch')).toBe(
      false,
    );
  });

  it('round-trips through the validator and the request mapper to the same scope', () => {
    const original = scope({
      filters: parseTransactionFilters(
        new URLSearchParams('accountIds=a&from=2026-06-01&to=2026-06-30&type=EXPENSE&amountMin=5'),
      ),
      period: {
        start: new Date('2026-06-05T00:00:00.000Z'),
        end: new Date('2026-07-05T00:00:00.000Z'),
      },
      mobileSearch: 'tea',
      quickFilter: 'uncategorized',
    });
    const params = new URL(
      transactionsPageUrl(transactionsPageSearchParams(original).toString(), 'abc'),
      'http://x',
    ).searchParams;
    const request = toTransactionsPageRequest(
      transactionsPageQuerySchema.parse(Object.fromEntries(params)),
    );
    const { limit, cursor, ...roundTripped } = request;
    expect(roundTripped).toEqual(original);
    expect(limit).toBe(TRANSACTIONS_PAGE_SIZE);
    expect(cursor).toBe('abc');
  });
});

describe('transactionsPageUrl', () => {
  it('always asks for the paginated envelope at the page size, cursor only when given', () => {
    expect(transactionsPageUrl('payee=Cafe')).toBe(
      '/api/transactions?payee=Cafe&paginated=1&limit=50',
    );
    expect(transactionsPageUrl('', 'c1')).toBe('/api/transactions?paginated=1&limit=50&cursor=c1');
  });
});
