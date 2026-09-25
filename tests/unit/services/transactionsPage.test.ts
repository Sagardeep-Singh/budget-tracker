import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import {
  DEFAULT_TRANSACTION_FILTERS,
  type TransactionFilters,
} from '@/lib/transactions/transaction-filters';
import {
  decodeTransactionCursor,
  encodeTransactionCursor,
  type QuickFilter,
} from '@/lib/transactions/transaction-scope';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    transaction: {
      findMany: vi.fn(),
      count: vi.fn(),
      groupBy: vi.fn(),
    },
  },
}));

vi.mock('@/lib/db/prisma', () => ({ prisma: prismaMock }));

const { buildTransactionWhere, getTransactionsPage, matchesDeferredPayee } =
  await import('@/lib/services/transactionsPage');
const { ServiceValidationError } = await import('@/lib/services/common');

type Scope = Parameters<typeof buildTransactionWhere>[1];

const scope = (
  filters: Partial<TransactionFilters> = {},
  extra: Partial<Omit<Scope, 'filters'>> = {},
): Scope => ({
  filters: { ...DEFAULT_TRANSACTION_FILTERS, ...filters },
  period: null,
  mobileSearch: '',
  quickFilter: 'all',
  ...extra,
});

type DbRowInput = {
  id: string;
  date: string;
  amount: number | string;
  type?: 'INCOME' | 'EXPENSE';
  payee?: string | null;
  categoryId?: string | null;
  isPayment?: boolean;
  isTransfer?: boolean;
  reimbursementIncome?: boolean;
};

/** A DB row carrying both the full `include` shape and the Mode B lean `select` shape. */
const dbRow = (input: DbRowInput): Record<string, unknown> => ({
  id: input.id,
  userId: 'user-1',
  accountId: 'acc-1',
  categoryId: input.categoryId ?? null,
  amount: new Prisma.Decimal(input.amount),
  type: input.type ?? 'EXPENSE',
  date: new Date(input.date),
  payee: input.payee ?? null,
  note: null,
  isPayment: input.isPayment ?? false,
  importBatchId: null,
  isTransfer: input.isTransfer ?? false,
  transferMatchId: null,
  isReimbursable: false,
  reimbursementExpectedAmount: null,
  reimbursementCompletedAt: null,
  account: { name: 'Checking' },
  category: input.categoryId ? { name: 'Food' } : null,
  importBatch: null,
  reimbursementExpenseLinks: [],
  reimbursementIncomeLinks: input.reimbursementIncome ? [{ amount: input.amount }] : [],
  _count: { reimbursementIncomeLinks: input.reimbursementIncome ? 1 : 0 },
});

/** `count` of rows, newest first, one per day walking back from 2026-06-30. */
const rowsDescending = (count: number): Record<string, unknown>[] =>
  Array.from({ length: count }, (_, i) =>
    dbRow({
      id: `tx-${String(1000 - i).padStart(4, '0')}`,
      date: new Date(Date.UTC(2026, 5, 30) - i * 86_400_000).toISOString(),
      amount: 10,
    }),
  );

type GroupByArgs = { by: string[]; where: { AND?: unknown[] } };

/**
 * Dispatches `groupBy` on its `by` shape (and, for the summary pair, on whether
 * the reimbursement-income relation filter is present) so a test that feeds the
 * wrong mock to the wrong query shape fails instead of passing by accident.
 */
const mockGroupBy = (data: {
  summary?: unknown[];
  summaryReimb?: unknown[];
  older?: unknown[];
  days?: unknown[];
}): void => {
  prismaMock.transaction.groupBy.mockImplementation(async (args: GroupByArgs) => {
    const by = args.by.join(',');
    if (by === 'type,isPayment,isTransfer') {
      const isReimb = JSON.stringify(args.where).includes('reimbursementIncomeLinks');
      return isReimb ? (data.summaryReimb ?? []) : (data.summary ?? []);
    }
    if (by === 'date,type') return data.days ?? [];
    if (by === 'type') return data.older ?? [];
    throw new Error(`unexpected groupBy by=${by}`);
  });
};

const groupByCallsWith = (by: string): GroupByArgs[] =>
  (prismaMock.transaction.groupBy.mock.calls as [GroupByArgs][])
    .map(([args]) => args)
    .filter((args) => args.by.join(',') === by);

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.transaction.count.mockResolvedValue(0);
  mockGroupBy({});
});

describe('buildTransactionWhere', () => {
  const where = (s: Scope, mobile = false): Record<string, unknown> =>
    buildTransactionWhere('user-1', s, { mobile }) as Record<string, unknown>;
  const clauses = (s: Scope, mobile = false): unknown[] =>
    (where(s, mobile).AND as unknown[] | undefined) ?? [];

  it('always scopes by userId and emits nothing else (no empty AND) for default filters', () => {
    expect(where(scope())).toEqual({ userId: 'user-1' });
    expect(where(scope(), true)).toEqual({ userId: 'user-1' });
  });

  it('trims the payee and matches it case-insensitively', () => {
    expect(clauses(scope({ payee: '  Coffee  ' }))).toEqual([
      { payee: { contains: 'Coffee', mode: 'insensitive' } },
    ]);
  });

  it('treats a whitespace-only payee as no filter', () => {
    expect(where(scope({ payee: '   ' }))).toEqual({ userId: 'user-1' });
  });

  it('maps accountIds to an `in` clause and ignores an empty list', () => {
    expect(clauses(scope({ accountIds: ['a', 'b'] }))).toEqual([{ accountId: { in: ['a', 'b'] } }]);
    expect(where(scope({ accountIds: [] }))).toEqual({ userId: 'user-1' });
  });

  it('maps categoryIds to an `in` clause (which never matches a NULL category)', () => {
    // `in` never matches NULL in SQL: this is why the clause reproduces
    // "no category never matches an active categoryIds filter" — proven
    // against fixture rows in transactionsPage.parity.test.ts.
    expect(clauses(scope({ categoryIds: ['c1'] }))).toEqual([{ categoryId: { in: ['c1'] } }]);
  });

  it('turns `from` alone into an inclusive UTC-midnight lower bound only', () => {
    expect(clauses(scope({ from: '2026-06-10' }))).toEqual([
      { date: { gte: new Date('2026-06-10T00:00:00.000Z') } },
    ]);
  });

  it('turns `to` alone into an exclusive bound at the NEXT day (day-inclusive)', () => {
    expect(clauses(scope({ to: '2026-06-20' }))).toEqual([
      { date: { lt: new Date('2026-06-21T00:00:00.000Z') } },
    ]);
  });

  it('puts `from` and `to` as separate entries in one AND array', () => {
    const s = scope({ from: '2026-06-10', to: '2026-06-20' });
    expect(where(s).date).toBeUndefined();
    expect(clauses(s)).toEqual([
      { date: { gte: new Date('2026-06-10T00:00:00.000Z') } },
      { date: { lt: new Date('2026-06-21T00:00:00.000Z') } },
    ]);
  });

  it('adds the period as its own gte/lt entries, same shape as from/to, alongside them', () => {
    const start = new Date('2026-06-05T00:00:00.000Z');
    const end = new Date('2026-07-05T00:00:00.000Z');
    expect(clauses(scope({}, { period: { start, end } }))).toEqual([
      { date: { gte: start } },
      { date: { lt: end } },
    ]);
    expect(
      clauses(scope({ from: '2026-06-10', to: '2026-06-20' }, { period: { start, end } })),
    ).toEqual([
      { date: { gte: new Date('2026-06-10T00:00:00.000Z') } },
      { date: { lt: new Date('2026-06-21T00:00:00.000Z') } },
      { date: { gte: start } },
      { date: { lt: end } },
    ]);
  });

  it('ignores a malformed from/to (lenient: a stale bookmark degrades to no filter)', () => {
    expect(where(scope({ from: 'garbage', to: '2026-13-45' }))).toEqual({ userId: 'user-1' });
  });

  it('maps type directly', () => {
    expect(clauses(scope({ type: 'INCOME' }))).toEqual([{ type: 'INCOME' }]);
  });

  it('maps a valid amount range to gte/lte numbers', () => {
    expect(clauses(scope({ amountMin: '20', amountMax: '100' }))).toEqual([
      { amount: { gte: 20 } },
      { amount: { lte: 100 } },
    ]);
  });

  it('omits an unparseable bound entirely rather than sending NaN', () => {
    expect(where(scope({ amountMin: 'abc' }))).toEqual({ userId: 'user-1' });
    const mixed = clauses(scope({ amountMin: 'abc', amountMax: '100' }));
    expect(mixed).toEqual([{ amount: { lte: 100 } }]);
    expect(JSON.stringify(mixed)).not.toContain('gte');
  });

  it('maps the three boolean flags', () => {
    expect(clauses(scope({ hideTransfers: true }))).toEqual([{ isTransfer: false }]);
    expect(clauses(scope({ hidePayments: true }))).toEqual([{ isPayment: false }]);
    expect(clauses(scope({ uncategorizedOnly: true }))).toEqual([{ categoryId: null }]);
  });

  it('emits both uncategorizedOnly and categoryIds without throwing or overwriting', () => {
    expect(clauses(scope({ uncategorizedOnly: true, categoryIds: ['c1'] }))).toEqual([
      { categoryId: { in: ['c1'] } },
      { categoryId: null },
    ]);
  });

  it('never adds a skippedAt clause, even with every filter populated (Decision 9)', () => {
    const everything = scope(
      {
        from: '2026-01-01',
        to: '2026-12-31',
        accountIds: ['a'],
        categoryIds: ['c'],
        payee: 'Coffee',
        type: 'EXPENSE',
        amountMin: '1',
        amountMax: '2',
        hideTransfers: true,
        hidePayments: true,
        uncategorizedOnly: true,
      },
      {
        period: { start: new Date('2026-01-01'), end: new Date('2026-02-01') },
        mobileSearch: 'Tea',
        quickFilter: 'spending',
      },
    );
    expect(JSON.stringify(where(everything, true))).not.toContain('skippedAt');
    expect(JSON.stringify(where(everything, false))).not.toContain('skippedAt');
  });

  it('omits mobileSearch and quickFilter from the desktop scope regardless of value', () => {
    expect(where(scope({}, { mobileSearch: 'foo', quickFilter: 'spending' }), false)).toEqual({
      userId: 'user-1',
    });
  });

  it('maps each quick filter in the mobile scope', () => {
    const qf = (quickFilter: QuickFilter): unknown[] => clauses(scope({}, { quickFilter }), true);
    expect(qf('uncategorized')).toEqual([{ categoryId: null }]);
    expect(qf('spending')).toEqual([{ type: 'EXPENSE' }]);
    expect(qf('income')).toEqual([{ type: 'INCOME' }]);
    expect(qf('all')).toEqual([]);
  });

  it('lets uncategorizedOnly and the uncategorized pill co-exist', () => {
    expect(
      clauses(scope({ uncategorizedOnly: true }, { quickFilter: 'uncategorized' }), true),
    ).toEqual([{ categoryId: null }, { categoryId: null }]);
  });

  it('keeps the desktop type filter under mobile: true when the pill is "all"', () => {
    expect(clauses(scope({ type: 'INCOME' }, { quickFilter: 'all' }), true)).toEqual([
      { type: 'INCOME' },
    ]);
  });

  it('adds a non-amount mobile search as a second, independent payee clause', () => {
    expect(clauses(scope({ payee: 'Cafe' }, { mobileSearch: ' Coffee ' }), true)).toEqual([
      { payee: { contains: 'Cafe', mode: 'insensitive' } },
      { payee: { contains: 'Coffee', mode: 'insensitive' } },
    ]);
  });

  it('emits no Prisma clause for an amount-shaped mobile search (matched in JS, Mode B)', () => {
    expect(where(scope({}, { mobileSearch: '12.50' }), true)).toEqual({ userId: 'user-1' });
  });

  // Probe result (plan doc, Architecture §4): Prisma 6.19.3 `contains` does NOT
  // escape LIKE metacharacters, so a `%`/`_` term must never reach `contains`.
  it('never sends a %/_ term through a Prisma contains clause', () => {
    expect(where(scope({ payee: '100%' }), true)).toEqual({ userId: 'user-1' });
    expect(where(scope({ payee: 'Whole_Foods' }), true)).toEqual({ userId: 'user-1' });
    expect(where(scope({}, { mobileSearch: 'a_b' }), true)).toEqual({ userId: 'user-1' });
  });
});

describe('matchesDeferredPayee', () => {
  it('passes everything when the payee is Prisma-handled or empty', () => {
    expect(matchesDeferredPayee('Anything', { ...DEFAULT_TRANSACTION_FILTERS, payee: 'Cof' })).toBe(
      true,
    );
    expect(matchesDeferredPayee(null, DEFAULT_TRANSACTION_FILTERS)).toBe(true);
  });

  it('matches a %/_ term literally and case-insensitively', () => {
    const filters = { ...DEFAULT_TRANSACTION_FILTERS, payee: '100%' };
    expect(matchesDeferredPayee('The 100% Coffee Co', filters)).toBe(true);
    expect(matchesDeferredPayee('1000 Coffee', filters)).toBe(false);
    expect(matchesDeferredPayee(null, filters)).toBe(false);
    expect(
      matchesDeferredPayee('WHOLE_FOODS', { ...DEFAULT_TRANSACTION_FILTERS, payee: 'whole_f' }),
    ).toBe(true);
    expect(
      matchesDeferredPayee('WholeXFoods', { ...DEFAULT_TRANSACTION_FILTERS, payee: 'whole_f' }),
    ).toBe(false);
  });
});

describe('getTransactionsPage — Mode A', () => {
  type FindManyArgs = {
    where: { userId?: string; AND?: unknown[] };
    take?: number;
    orderBy?: unknown;
    include?: unknown;
    select?: unknown;
  };
  const pageCall = (): FindManyArgs =>
    prismaMock.transaction.findMany.mock.calls[0][0] as FindManyArgs;

  it('fetches limit + 1 in (date desc, id desc) order; exactly `limit` rows means no more', async () => {
    prismaMock.transaction.findMany.mockResolvedValue(rowsDescending(3));

    const result = await getTransactionsPage('user-1', { ...scope(), limit: 3 });

    expect(pageCall().take).toBe(4);
    expect(pageCall().orderBy).toEqual([{ date: 'desc' }, { id: 'desc' }]);
    expect(pageCall().include).toBeDefined();
    expect(result.rows).toHaveLength(3);
    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeNull();
  });

  it('drops the extra row and cursors from the last KEPT row when there is more', async () => {
    const rows = rowsDescending(51);
    prismaMock.transaction.findMany.mockResolvedValue(rows);

    const result = await getTransactionsPage('user-1', { ...scope(), limit: 50 });

    expect(result.rows).toHaveLength(50);
    expect(result.hasMore).toBe(true);
    const cursor = decodeTransactionCursor(result.nextCursor!);
    expect(cursor?.id).toBe(rows[49].id);
    expect(cursor?.date.getTime()).toBe((rows[49].date as Date).getTime());
    expect(result.rows.map((r) => r.id)).not.toContain(rows[50].id);
  });

  it('serializes rows through toFrontend (money as strings, ISO dates)', async () => {
    prismaMock.transaction.findMany.mockResolvedValue([
      dbRow({ id: 't1', date: '2026-06-15T00:00:00.000Z', amount: '12.5', payee: 'Cafe' }),
    ]);
    const result = await getTransactionsPage('user-1', { ...scope(), limit: 50 });
    expect(result.rows[0]).toMatchObject({
      id: 't1',
      amount: '12.50',
      date: '2026-06-15T00:00:00.000Z',
      accountName: 'Checking',
      payee: 'Cafe',
    });
  });

  it('ANDs the exact keyset clause onto the scope predicate for a cursor', async () => {
    prismaMock.transaction.findMany.mockResolvedValue([]);
    const d = new Date('2026-06-15T00:00:00.000Z');
    const cursor = encodeTransactionCursor({ date: d, id: 'tx-50' });

    await getTransactionsPage('user-1', { ...scope({ type: 'EXPENSE' }), limit: 50, cursor });

    expect(pageCall().where).toEqual({
      AND: [
        { userId: 'user-1', AND: [{ type: 'EXPENSE' }] },
        { OR: [{ date: { lt: d } }, { date: d, id: { lt: 'tx-50' } }] },
      ],
    });
  });

  it('rejects a malformed cursor before running any query', async () => {
    await expect(
      getTransactionsPage('user-1', { ...scope(), limit: 50, cursor: 'not-a-cursor!!' }),
    ).rejects.toEqual(new ServiceValidationError('Invalid cursor'));
    expect(prismaMock.transaction.findMany).not.toHaveBeenCalled();
    expect(prismaMock.transaction.count).not.toHaveBeenCalled();
    expect(prismaMock.transaction.groupBy).not.toHaveBeenCalled();
  });

  it('short-circuits an empty page but still computes the scope aggregates', async () => {
    prismaMock.transaction.findMany.mockResolvedValue([]);
    // full scope empty, desktop scope not (quick filter narrows it to nothing)
    prismaMock.transaction.count
      .mockResolvedValueOnce(0) // full scope
      .mockResolvedValueOnce(7) // desktop scope
      .mockResolvedValueOnce(2); // desktop uncategorized
    mockGroupBy({
      summary: [{ type: 'INCOME', isPayment: false, isTransfer: false, _sum: { amount: 40 } }],
    });

    const result = await getTransactionsPage('user-1', {
      ...scope({}, { quickFilter: 'uncategorized' }),
      limit: 50,
    });

    expect(result).toMatchObject({
      rows: [],
      nextCursor: null,
      hasMore: false,
      runningBalanceStart: '0.00',
      dayTotals: [],
      totalCount: 0,
      desktopCount: 7,
      uncategorizedCount: 2,
    });
    expect(result.summary.credit).toBe('40.00');
    expect(groupByCallsWith('date,type')).toHaveLength(0);
    expect(groupByCallsWith('type')).toHaveLength(0);
  });

  it('computes runningBalanceStart from the strictly-older aggregate, as an exact string', async () => {
    const rows = rowsDescending(2);
    prismaMock.transaction.findMany.mockResolvedValue(rows);
    mockGroupBy({
      older: [
        { type: 'INCOME', _sum: { amount: new Prisma.Decimal('500') } },
        { type: 'EXPENSE', _sum: { amount: new Prisma.Decimal('120') } },
      ],
    });

    const result = await getTransactionsPage('user-1', { ...scope(), limit: 50 });

    expect(result.runningBalanceStart).toBe('380.00');
    const [older] = groupByCallsWith('type');
    const last = rows[1];
    expect(older.where).toEqual({
      AND: [
        { userId: 'user-1' },
        {
          OR: [{ date: { lt: last.date } }, { date: last.date, id: { lt: last.id } }],
        },
      ],
    });
  });

  it('converts Decimal sums exactly (no float drift, no Decimal leak)', async () => {
    prismaMock.transaction.findMany.mockResolvedValue(rowsDescending(1));
    mockGroupBy({
      older: [{ type: 'INCOME', _sum: { amount: new Prisma.Decimal('123.45') } }],
      summary: [
        {
          type: 'INCOME',
          isPayment: false,
          isTransfer: false,
          _sum: { amount: new Prisma.Decimal('0.1') },
        },
        {
          type: 'EXPENSE',
          isPayment: false,
          isTransfer: false,
          _sum: { amount: new Prisma.Decimal('0.3') },
        },
      ],
    });

    const result = await getTransactionsPage('user-1', { ...scope(), limit: 50 });

    expect(result.runningBalanceStart).toBe('123.45');
    expect(result.summary).toEqual({
      credit: '0.10',
      debit: '0.30',
      payments: '0.00',
      transfers: '0.00',
      reimbursementIncome: '0.00',
      net: '-0.20',
    });
  });

  it('folds summary cells with payment > transfer > reimbursement income > type precedence', async () => {
    prismaMock.transaction.findMany.mockResolvedValue(rowsDescending(1));
    mockGroupBy({
      summary: [
        { type: 'EXPENSE', isPayment: true, isTransfer: true, _sum: { amount: 50 } },
        { type: 'EXPENSE', isPayment: false, isTransfer: true, _sum: { amount: 30 } },
        { type: 'INCOME', isPayment: false, isTransfer: false, _sum: { amount: 200 } },
        { type: 'EXPENSE', isPayment: false, isTransfer: false, _sum: { amount: 80 } },
      ],
      summaryReimb: [{ type: 'INCOME', isPayment: false, isTransfer: false, _sum: { amount: 45 } }],
    });

    const result = await getTransactionsPage('user-1', { ...scope(), limit: 50 });

    expect(result.summary).toEqual({
      payments: '50.00', // payment AND transfer -> payments only
      transfers: '30.00',
      reimbursementIncome: '45.00',
      credit: '155.00', // 200 - 45 reimbursement share
      debit: '80.00',
      net: '75.00',
    });
  });

  it('clamps a reimbursement share larger than its cell instead of going negative', async () => {
    prismaMock.transaction.findMany.mockResolvedValue(rowsDescending(1));
    mockGroupBy({
      summary: [{ type: 'INCOME', isPayment: false, isTransfer: false, _sum: { amount: 20 } }],
      summaryReimb: [{ type: 'INCOME', isPayment: false, isTransfer: false, _sum: { amount: 35 } }],
    });

    const result = await getTransactionsPage('user-1', { ...scope(), limit: 50 });

    expect(result.summary.reimbursementIncome).toBe('20.00');
    expect(result.summary.credit).toBe('0.00');
  });

  it('folds day totals from distinct instants into one signed UTC-day entry', async () => {
    prismaMock.transaction.findMany.mockResolvedValue([
      dbRow({ id: 'b', date: '2026-06-15T14:00:00.000Z', amount: 25 }),
      dbRow({ id: 'a', date: '2026-06-14T00:00:00.000Z', amount: 5 }),
    ]);
    mockGroupBy({
      days: [
        { date: new Date('2026-06-15T00:00:00.000Z'), type: 'INCOME', _sum: { amount: 100 } },
        { date: new Date('2026-06-15T14:00:00.000Z'), type: 'EXPENSE', _sum: { amount: 25 } },
        { date: new Date('2026-06-14T00:00:00.000Z'), type: 'EXPENSE', _sum: { amount: 5 } },
      ],
    });

    const result = await getTransactionsPage('user-1', { ...scope(), limit: 50 });

    expect(result.dayTotals).toEqual([
      { day: '2026-06-15', total: '75.00' },
      { day: '2026-06-14', total: '-5.00' },
    ]);
    const [days] = groupByCallsWith('date,type');
    // window: oldest row's UTC day (inclusive) to the day after the newest (exclusive)
    expect(days.where.AND?.[1]).toEqual({
      date: {
        gte: new Date('2026-06-14T00:00:00.000Z'),
        lt: new Date('2026-06-16T00:00:00.000Z'),
      },
    });
  });

  it('reuses the full-scope count when the mobile params are at their defaults', async () => {
    prismaMock.transaction.findMany.mockResolvedValue(rowsDescending(1));
    prismaMock.transaction.count.mockResolvedValueOnce(10).mockResolvedValueOnce(3);

    const result = await getTransactionsPage('user-1', { ...scope(), limit: 50 });

    expect(prismaMock.transaction.count).toHaveBeenCalledTimes(2);
    expect(result.totalCount).toBe(10);
    expect(result.desktopCount).toBe(10);
    expect(result.uncategorizedCount).toBe(3);
  });

  it('runs the desktop-scope count and summary separately once a mobile param is set', async () => {
    prismaMock.transaction.findMany.mockResolvedValue(rowsDescending(1));
    prismaMock.transaction.count
      .mockResolvedValueOnce(6) // full scope (spending only)
      .mockResolvedValueOnce(10) // desktop scope
      .mockResolvedValueOnce(1); // desktop uncategorized

    const result = await getTransactionsPage('user-1', {
      ...scope({}, { quickFilter: 'spending' }),
      limit: 50,
    });

    expect(prismaMock.transaction.count).toHaveBeenCalledTimes(3);
    expect(result.totalCount).toBe(6);
    expect(result.desktopCount).toBe(10);
    const calls = prismaMock.transaction.count.mock.calls.map(([a]) => a);
    expect(calls[0]).toEqual({ where: { userId: 'user-1', AND: [{ type: 'EXPENSE' }] } });
    expect(calls[1]).toEqual({ where: { userId: 'user-1' } });
    expect(calls[2]).toEqual({ where: { AND: [{ userId: 'user-1' }, { categoryId: null }] } });
    // the summary is desktop-scoped: no quick-filter clause in its predicate
    const [summaryAll] = groupByCallsWith('type,isPayment,isTransfer');
    expect(summaryAll.where).toEqual({ userId: 'user-1' });
    // while rows and the running balance use the mobile-inclusive scope
    expect(pageCall().where).toEqual({ userId: 'user-1', AND: [{ type: 'EXPENSE' }] });
  });

  it('scopes the page query, counts and every aggregate by userId', async () => {
    prismaMock.transaction.findMany.mockResolvedValue(rowsDescending(2));

    await getTransactionsPage('user-42', { ...scope({ type: 'INCOME' }), limit: 50 });

    const containsUser = (value: unknown): boolean =>
      JSON.stringify(value).includes('"userId":"user-42"');
    expect(containsUser(pageCall().where)).toBe(true);
    for (const [args] of prismaMock.transaction.count.mock.calls) {
      expect(containsUser(args)).toBe(true);
    }
    for (const [args] of prismaMock.transaction.groupBy.mock.calls) {
      expect(containsUser(args)).toBe(true);
    }
    expect(groupByCallsWith('type')).toHaveLength(1);
  });
});

describe('getTransactionsPage — Mode B', () => {
  type FindManyArgs = {
    where: { userId?: string; id?: { in: string[] } };
    select?: Record<string, unknown>;
    include?: unknown;
    orderBy?: unknown;
  };

  /**
   * `scanRows` answers the lean scan (`select`); the hydration query (`include`)
   * returns the requested ids in REVERSE order, so a service relying on `in`
   * preserving order would come back wrong.
   */
  const mockScan = (scanRows: Record<string, unknown>[]): void => {
    prismaMock.transaction.findMany.mockImplementation(async (args: FindManyArgs) => {
      if (args.select) return scanRows;
      if (args.include) {
        const ids = args.where.id!.in;
        return scanRows.filter((r) => ids.includes(r.id as string)).reverse();
      }
      throw new Error('unexpected findMany shape');
    });
  };
  const scanCall = (): FindManyArgs =>
    (prismaMock.transaction.findMany.mock.calls as [FindManyArgs][]).find(([a]) => a.select)![0];
  const hydrateCall = (): FindManyArgs =>
    (prismaMock.transaction.findMany.mock.calls as [FindManyArgs][]).find(([a]) => a.include)![0];

  const amounts = [
    dbRow({ id: 'r3', date: '2026-06-15T00:00:00.000Z', amount: '112.50', payee: 'Grocer' }),
    dbRow({ id: 'r2', date: '2026-06-14T00:00:00.000Z', amount: '12.00', payee: 'Cafe' }),
    dbRow({ id: 'r1', date: '2026-06-13T00:00:00.000Z', amount: '212.50', payee: 'Rent' }),
  ];

  it('scans with the lean select, not the 5-relation include', async () => {
    mockScan(amounts);
    await getTransactionsPage('user-1', { ...scope({}, { mobileSearch: '12.50' }), limit: 50 });

    expect(scanCall().select).toEqual({
      id: true,
      date: true,
      amount: true,
      type: true,
      payee: true,
      categoryId: true,
      isPayment: true,
      isTransfer: true,
      _count: { select: { reimbursementIncomeLinks: true } },
    });
    expect(scanCall()).not.toHaveProperty('include');
    expect(scanCall().where).toEqual({ userId: 'user-1' });
  });

  it('matches the amount as a formatted-string substring, like the old mobile search', async () => {
    mockScan(amounts);
    const result = await getTransactionsPage('user-1', {
      ...scope({}, { mobileSearch: '12.50' }),
      limit: 50,
    });
    expect(result.rows.map((r) => r.id)).toEqual(['r3', 'r1']);

    vi.clearAllMocks();
    mockScan(amounts);
    const partial = await getTransactionsPage('user-1', {
      ...scope({}, { mobileSearch: '12.5' }),
      limit: 50,
    });
    // "12.5" matches "112.50" and "212.50" but not "12.00"
    expect(partial.rows.map((r) => r.id)).toEqual(['r3', 'r1']);
  });

  it('keeps a row that matches on payee OR amount', async () => {
    const rows = [
      dbRow({ id: 'p', date: '2026-06-15T00:00:00.000Z', amount: '1.00', payee: 'Shop 42' }),
      dbRow({ id: 'a', date: '2026-06-14T00:00:00.000Z', amount: '42.00', payee: 'Cafe' }),
      dbRow({ id: 'n', date: '2026-06-13T00:00:00.000Z', amount: '7.00', payee: 'Rent' }),
    ];
    mockScan(rows);
    const result = await getTransactionsPage('user-1', {
      ...scope({}, { mobileSearch: '42' }),
      limit: 50,
    });
    expect(result.rows.map((r) => r.id)).toEqual(['p', 'a']);
  });

  it('hydrates by userId + id list with an explicit order, and re-imposes comparator order', async () => {
    mockScan(amounts);
    const result = await getTransactionsPage('user-1', {
      ...scope({}, { mobileSearch: '12.50' }),
      limit: 50,
    });
    expect(hydrateCall().where).toEqual({ userId: 'user-1', id: { in: ['r3', 'r1'] } });
    expect(hydrateCall().orderBy).toEqual([{ date: 'desc' }, { id: 'desc' }]);
    // the mock hydrated r1 before r3; the response is still newest-first
    expect(result.rows.map((r) => r.id)).toEqual(['r3', 'r1']);
  });

  const five = [5, 4, 3, 2, 1].map((n) =>
    dbRow({ id: `m${n}`, date: `2026-06-1${n}T00:00:00.000Z`, amount: '1.00', payee: `P${n}` }),
  );

  it('pages the in-memory match list with the keyset comparator, no extra round trip', async () => {
    mockScan(five);
    const cursor = encodeTransactionCursor({ date: five[1].date as Date, id: 'm4' });
    const result = await getTransactionsPage('user-1', {
      ...scope({}, { mobileSearch: '1.00' }),
      limit: 50,
      cursor,
    });
    expect(result.rows.map((r) => r.id)).toEqual(['m3', 'm2', 'm1']);
    expect(prismaMock.transaction.findMany).toHaveBeenCalledTimes(2);
  });

  it('degrades gracefully on a stale cursor that matches no row', async () => {
    mockScan(five);
    // between m4 (06-14) and m3 (06-13): a row that has since been deleted
    const cursor = encodeTransactionCursor({
      date: new Date('2026-06-13T12:00:00.000Z'),
      id: 'gone',
    });
    const result = await getTransactionsPage('user-1', {
      ...scope({}, { mobileSearch: '1.00' }),
      limit: 50,
      cursor,
    });
    expect(result.rows.map((r) => r.id)).toEqual(['m3', 'm2', 'm1']);
  });

  it('folds every aggregate from the scan in JS — no count, no groupBy', async () => {
    const rows = [
      dbRow({ id: 'x4', date: '2026-06-15T09:00:00.000Z', amount: '10.00', type: 'INCOME' }),
      dbRow({ id: 'x3', date: '2026-06-15T00:00:00.000Z', amount: '1.00' }),
      dbRow({ id: 'x2', date: '2026-06-14T00:00:00.000Z', amount: '100.00', isPayment: true }),
      dbRow({
        id: 'x1',
        date: '2026-06-13T00:00:00.000Z',
        amount: '1000.00',
        type: 'INCOME',
        reimbursementIncome: true,
      }),
    ];
    mockScan(rows);

    const result = await getTransactionsPage('user-1', {
      ...scope({}, { mobileSearch: '0' }),
      limit: 2,
    });

    expect(prismaMock.transaction.count).not.toHaveBeenCalled();
    expect(prismaMock.transaction.groupBy).not.toHaveBeenCalled();
    expect(result.rows.map((r) => r.id)).toEqual(['x4', 'x3']);
    expect(result.hasMore).toBe(true);
    expect(decodeTransactionCursor(result.nextCursor!)?.id).toBe('x3');
    expect(result.totalCount).toBe(4);
    // older than x3: -100 (payment, still counted in the balance) + 1000
    expect(result.runningBalanceStart).toBe('900.00');
    expect(result.dayTotals).toEqual([{ day: '2026-06-15', total: '9.00' }]);
    expect(result.summary).toEqual({
      credit: '10.00',
      debit: '1.00',
      payments: '100.00',
      transfers: '0.00',
      reimbursementIncome: '1000.00',
      net: '9.00',
    });
  });

  it('applies the quick filter in JS and keeps it out of the desktop-scope counts', async () => {
    const rows = [
      dbRow({ id: 'c', date: '2026-06-15T00:00:00.000Z', amount: '5.00', categoryId: 'cat' }),
      dbRow({ id: 'u', date: '2026-06-14T00:00:00.000Z', amount: '5.00' }),
      dbRow({ id: 'i', date: '2026-06-13T00:00:00.000Z', amount: '5.00', type: 'INCOME' }),
    ];
    mockScan(rows);
    const result = await getTransactionsPage('user-1', {
      ...scope({}, { mobileSearch: '5', quickFilter: 'spending' }),
      limit: 50,
    });
    expect(result.rows.map((r) => r.id)).toEqual(['c', 'u']);
    expect(result.totalCount).toBe(2);
    expect(result.desktopCount).toBe(3);
    expect(result.uncategorizedCount).toBe(2);
  });

  it('applies the JS payee predicate to the desktop scope only when a %/_ payee triggered Mode B', async () => {
    const rows = [
      dbRow({ id: 'y3', date: '2026-06-15T00:00:00.000Z', amount: '3.00', payee: '100% Juice' }),
      dbRow({ id: 'y2', date: '2026-06-14T00:00:00.000Z', amount: '4.00', payee: '1000 Oaks' }),
      dbRow({ id: 'y1', date: '2026-06-13T00:00:00.000Z', amount: '5.00', payee: 'Cafe' }),
    ];

    // amount-shaped mobile search: desktop scope is the scan itself
    mockScan(rows);
    const amountShaped = await getTransactionsPage('user-1', {
      ...scope({}, { mobileSearch: '5.00' }),
      limit: 50,
    });
    expect(amountShaped.desktopCount).toBe(3);
    expect(amountShaped.summary.debit).toBe('12.00');
    expect(amountShaped.rows.map((r) => r.id)).toEqual(['y1']);

    // `%` desktop payee: the desktop scope needs the literal JS payee match
    vi.clearAllMocks();
    mockScan(rows);
    const percent = await getTransactionsPage('user-1', { ...scope({ payee: '100%' }), limit: 50 });
    expect(scanCall().where).toEqual({ userId: 'user-1' }); // no LIKE clause sent
    expect(percent.desktopCount).toBe(1);
    expect(percent.summary.debit).toBe('3.00');
    expect(percent.rows.map((r) => r.id)).toEqual(['y3']);
  });

  it('returns the empty-page shape without hydrating when nothing matches', async () => {
    mockScan(amounts);
    const result = await getTransactionsPage('user-1', {
      ...scope({}, { mobileSearch: '999' }),
      limit: 50,
    });
    expect(result).toMatchObject({
      rows: [],
      nextCursor: null,
      hasMore: false,
      runningBalanceStart: '0.00',
      dayTotals: [],
      totalCount: 0,
      desktopCount: 3,
    });
    expect(prismaMock.transaction.findMany).toHaveBeenCalledTimes(1);
  });
});
