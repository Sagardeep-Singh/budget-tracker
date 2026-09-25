import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { ServiceValidationError } from '@/lib/services/common';
import { toCents } from '@/lib/services/reimbursements';
import { include, toFrontend, type FrontendTransaction } from '@/lib/services/transactions';
import {
  compareTransactionOrder,
  dayKey,
  decodeTransactionCursor,
  encodeTransactionCursor,
  isAmountSubstringCandidate,
  isOlderThanCursor,
  needsExactStringMatch,
  type TransactionCursor,
  type TransactionScope,
} from '@/lib/transactions/transaction-scope';
import type { TransactionFilters } from '@/lib/transactions/transaction-filters';
import type { TransactionsPageQuery } from '@/lib/validators/transactions';

/**
 * The Transactions page's paginated read path: one page of rows plus every
 * full-scope aggregate the page renders (counts, summary, running-balance
 * opening total, per-day totals), all derived from ONE where-builder so the
 * page and its aggregates cannot drift apart.
 *
 * Money leaves this module as `toFixed(2)` strings summed in integer cents —
 * never a raw `Decimal`, never a float total — matching every other service's
 * serialization edge (see `FrontendTransaction.amount`).
 *
 * `listTransactions` in `lib/services/transactions.ts` is deliberately
 * untouched: the import-batch detail page keeps its plain-array contract.
 */

export type TransactionsPageRequest = TransactionScope & {
  /** page size; the validator clamps it to 1..100 */
  limit: number;
  /** opaque cursor string from the previous page's `nextCursor`; absent = first page */
  cursor?: string;
};

export type TransactionSummary = {
  credit: string;
  debit: string;
  payments: string;
  transfers: string;
  reimbursementIncome: string;
  /** credit - debit, precomputed so the client does no money arithmetic */
  net: string;
};

/** Signed day total, keyed by UTC `YYYY-MM-DD` (NOT `formatDate` output). */
export type DayTotal = { day: string; total: string };

export type TransactionsPageResult = {
  /** newest-first, `(date desc, id desc)`, at most `limit` items */
  rows: FrontendTransaction[];
  /** null when there is nothing older to load */
  nextCursor: string | null;
  hasMore: boolean;
  /** signed cumulative total of every in-scope row strictly OLDER than this page's oldest row */
  runningBalanceStart: string;
  /** full-scope row count (mobile params included) — the mobile count line */
  totalCount: number;
  /** desktop-scope row count (mobile params omitted) — the "N transactions" label */
  desktopCount: number;
  /** desktop-scope count of rows with no category — the mobile Uncategorized pill badge */
  uncategorizedCount: number;
  /** desktop-scope totals; bucket precedence isPayment > isTransfer > isReimbursementIncome > type */
  summary: TransactionSummary;
  /** full-day totals for every UTC day this page's rows touch, page-boundary independent */
  dayTotals: DayTotal[];
};

const ORDER_BY: Prisma.TransactionOrderByWithRelationInput[] = [{ date: 'desc' }, { id: 'desc' }];
const DAY_MS = 24 * 60 * 60 * 1000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

const fromCents = (cents: number): string => (cents / 100).toFixed(2);
const signedCents = (type: string, amount: unknown): number =>
  type === 'INCOME' ? toCents(amount) : -toCents(amount);

/** UTC midnight of a `YYYY-MM-DD` string, or `null` when it isn't a real day. */
const utcDay = (value: string | null): Date | null => {
  if (!value || !ISO_DAY.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || dayKey(date) !== value ? null : date;
};

const finiteAmount = (value: string | null): number | null => {
  if (value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/** A payee term Prisma's `contains` can be trusted with (no LIKE metacharacters). */
const prismaSafePayee = (filters: TransactionFilters): string | null => {
  const term = filters.payee.trim();
  return term && !needsExactStringMatch(term) ? term : null;
};

/** Mode A mobile search: a term that can only ever match the payee branch. */
const prismaSafeMobileSearch = (mobileSearch: string): string | null => {
  const term = mobileSearch.trim();
  return term && !isAmountSubstringCandidate(term) && !needsExactStringMatch(term) ? term : null;
};

/**
 * The one predicate behind the page query and every aggregate.
 * `mobile: false` omits `mobileSearch`/`quickFilter` — the desktop scope.
 *
 * Every constraint lands in a single `AND` array (never top-level keys): `date`
 * is constrained by both `from`/`to` and `period`, `payee` by both the desktop
 * filter and mobile search, `categoryId` by both `categoryIds` and the
 * uncategorized flags, and `type` by both the type filter and the quick-filter
 * pills — top-level keys would silently overwrite one another.
 *
 * Text terms Prisma cannot express faithfully are OMITTED here and matched in JS
 * by `getTransactionsPage` (Mode B): an amount-shaped mobile search (it has to
 * match `Number(amount).toFixed(2)` as a string), and any term containing `%`/`_`
 * (Prisma 6.19.3's `contains` does not escape LIKE metacharacters — see the
 * "Probe result" section of `docs/feature-plans/transactions-server-side-pagination.md`).
 * {@link matchesDeferredPayee} is the JS half for the desktop payee.
 *
 * No `skippedAt` clause, deliberately: skipped transactions stay visible (Decision 9).
 */
export const buildTransactionWhere = (
  userId: string,
  scope: TransactionScope,
  options: { mobile: boolean },
): Prisma.TransactionWhereInput => {
  const { filters, period } = scope;
  const and: Prisma.TransactionWhereInput[] = [];

  const payee = prismaSafePayee(filters);
  if (payee) and.push({ payee: { contains: payee, mode: 'insensitive' } });
  if (filters.accountIds.length > 0) and.push({ accountId: { in: filters.accountIds } });
  // `in` never matches NULL — exactly "no category never matches an active categoryIds filter"
  if (filters.categoryIds.length > 0) and.push({ categoryId: { in: filters.categoryIds } });

  const from = utcDay(filters.from);
  if (from) and.push({ date: { gte: from } });
  const to = utcDay(filters.to);
  // day-inclusive `to`: strictly before the NEXT day's UTC midnight
  if (to) and.push({ date: { lt: new Date(to.getTime() + DAY_MS) } });
  if (period) {
    and.push({ date: { gte: period.start } });
    and.push({ date: { lt: period.end } });
  }

  if (filters.type) and.push({ type: filters.type });
  const amountMin = finiteAmount(filters.amountMin);
  if (amountMin !== null) and.push({ amount: { gte: amountMin } });
  const amountMax = finiteAmount(filters.amountMax);
  if (amountMax !== null) and.push({ amount: { lte: amountMax } });
  if (filters.hideTransfers) and.push({ isTransfer: false });
  if (filters.hidePayments) and.push({ isPayment: false });
  if (filters.uncategorizedOnly) and.push({ categoryId: null });

  if (options.mobile) {
    if (scope.quickFilter === 'uncategorized') and.push({ categoryId: null });
    if (scope.quickFilter === 'spending') and.push({ type: 'EXPENSE' });
    if (scope.quickFilter === 'income') and.push({ type: 'INCOME' });
    const search = prismaSafeMobileSearch(scope.mobileSearch);
    if (search) and.push({ payee: { contains: search, mode: 'insensitive' } });
  }

  return and.length > 0 ? { userId, AND: and } : { userId };
};

/**
 * JS half of the desktop payee filter: `true` when {@link buildTransactionWhere}
 * already handled it in Prisma (or there is no payee filter), otherwise the same
 * case-insensitive `String.includes` `matchesTransactionFilters` uses.
 */
export const matchesDeferredPayee = (
  payee: string | null,
  filters: TransactionFilters,
): boolean => {
  const term = filters.payee.trim();
  if (!term || !needsExactStringMatch(term)) return true;
  return (payee ?? '').toLowerCase().includes(term.toLowerCase());
};

/** Maps the validated query onto the service request (pure shape conversion). */
export const toTransactionsPageRequest = (
  query: TransactionsPageQuery,
): TransactionsPageRequest => ({
  filters: {
    from: query.from ?? null,
    to: query.to ?? null,
    accountIds: query.accountIds,
    categoryIds: query.categoryIds,
    payee: query.payee,
    type: query.type ?? null,
    amountMin: query.amountMin ?? null,
    amountMax: query.amountMax ?? null,
    hideTransfers: query.hideTransfers,
    hidePayments: query.hidePayments,
    uncategorizedOnly: query.uncategorizedOnly,
  },
  period:
    query.periodStart && query.periodEnd
      ? { start: query.periodStart, end: query.periodEnd }
      : null,
  mobileSearch: query.mobileSearch,
  quickFilter: query.quickFilter,
  limit: query.limit,
  cursor: query.cursor,
});

/** Rows strictly older than `cursor` in the `(date desc, id desc)` order. */
const olderThan = (cursor: TransactionCursor): Prisma.TransactionWhereInput => ({
  OR: [{ date: { lt: cursor.date } }, { date: cursor.date, id: { lt: cursor.id } }],
});

type SummaryCents = {
  credit: number;
  debit: number;
  payments: number;
  transfers: number;
  reimbursementIncome: number;
};

const emptySummary = (): SummaryCents => ({
  credit: 0,
  debit: 0,
  payments: 0,
  transfers: 0,
  reimbursementIncome: 0,
});

/**
 * Adds one bucket-cell's total to the summary with today's precedence:
 * payment, then transfer, then reimbursement income, then type. `reimbCents`
 * is the share of the cell that is reimbursement income; it is clamped to
 * `[0, cents]` so an (invariant-violating) larger `reimb` sum can never drive
 * credit/debit negative.
 */
const addToSummary = (
  acc: SummaryCents,
  cell: { type: string; isPayment: boolean; isTransfer: boolean },
  cents: number,
  reimbCents: number,
): void => {
  if (cell.isPayment) {
    acc.payments += cents;
  } else if (cell.isTransfer) {
    acc.transfers += cents;
  } else {
    const reimb = Math.min(Math.max(reimbCents, 0), cents);
    acc.reimbursementIncome += reimb;
    if (cell.type === 'INCOME') acc.credit += cents - reimb;
    else acc.debit += cents - reimb;
  }
};

const toSummary = (acc: SummaryCents): TransactionSummary => ({
  credit: fromCents(acc.credit),
  debit: fromCents(acc.debit),
  payments: fromCents(acc.payments),
  transfers: fromCents(acc.transfers),
  reimbursementIncome: fromCents(acc.reimbursementIncome),
  net: fromCents(acc.credit - acc.debit),
});

const toDayTotals = (byDay: Map<string, number>): DayTotal[] =>
  [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([day, cents]) => ({ day, total: fromCents(cents) }));

/** Inclusive start / exclusive end of the UTC days a newest-first page spans. */
const pageDayWindow = (rows: { date: Date }[]): { start: Date; end: Date } => {
  const start = new Date(`${dayKey(rows[rows.length - 1].date)}T00:00:00.000Z`);
  const end = new Date(new Date(`${dayKey(rows[0].date)}T00:00:00.000Z`).getTime() + DAY_MS);
  return { start, end };
};

type SummaryCell = {
  type: string;
  isPayment: boolean;
  isTransfer: boolean;
  _sum: { amount: unknown };
};

const cellKey = (c: { type: string; isPayment: boolean; isTransfer: boolean }): string =>
  `${c.type}|${c.isPayment}|${c.isTransfer}`;

const summarize = async (where: Prisma.TransactionWhereInput): Promise<TransactionSummary> => {
  const by: Prisma.TransactionScalarFieldEnum[] = ['type', 'isPayment', 'isTransfer'];
  const [all, reimb] = (await Promise.all([
    prisma.transaction.groupBy({ by, where, _sum: { amount: true } }),
    prisma.transaction.groupBy({
      by,
      where: { AND: [where, { reimbursementIncomeLinks: { some: {} } }] },
      _sum: { amount: true },
    }),
  ])) as unknown as [SummaryCell[], SummaryCell[]];

  const reimbByCell = new Map(reimb.map((c) => [cellKey(c), toCents(c._sum.amount ?? 0)]));
  const acc = emptySummary();
  for (const cell of all) {
    addToSummary(acc, cell, toCents(cell._sum.amount ?? 0), reimbByCell.get(cellKey(cell)) ?? 0);
  }
  return toSummary(acc);
};

const EMPTY_PAGE_TAIL = {
  nextCursor: null,
  hasMore: false,
  runningBalanceStart: '0.00',
  dayTotals: [] as DayTotal[],
};

/**
 * Mode A — every clause is a Prisma clause. The page query runs alongside the
 * counts and summary; the running-balance and day-total aggregates depend on
 * the page's own rows, so they are a second phase (skipped for an empty page).
 */
const getPageModeA = async (
  userId: string,
  request: TransactionsPageRequest,
  cursor: TransactionCursor | null,
): Promise<TransactionsPageResult> => {
  const where = buildTransactionWhere(userId, request, { mobile: true });
  const mobileDefaults = request.mobileSearch.trim() === '' && request.quickFilter === 'all';
  const desktopWhere = mobileDefaults
    ? where
    : buildTransactionWhere(userId, request, { mobile: false });

  const [found, totalCount, desktopCountOrNull, uncategorizedCount, summary] = await Promise.all([
    prisma.transaction.findMany({
      where: cursor ? { AND: [where, olderThan(cursor)] } : where,
      include,
      orderBy: ORDER_BY,
      take: request.limit + 1,
    }),
    prisma.transaction.count({ where }),
    mobileDefaults ? Promise.resolve(null) : prisma.transaction.count({ where: desktopWhere }),
    prisma.transaction.count({ where: { AND: [desktopWhere, { categoryId: null }] } }),
    summarize(desktopWhere),
  ]);
  const desktopCount = desktopCountOrNull ?? totalCount;

  const hasMore = found.length > request.limit;
  const rows = hasMore ? found.slice(0, request.limit) : found;
  const base = { totalCount, desktopCount, uncategorizedCount, summary };
  if (rows.length === 0) return { rows: [], ...EMPTY_PAGE_TAIL, ...base };

  const oldest = rows[rows.length - 1];
  const window = pageDayWindow(rows);
  const [olderByType, dayRows] = (await Promise.all([
    prisma.transaction.groupBy({
      by: ['type'],
      where: { AND: [where, olderThan(oldest)] },
      _sum: { amount: true },
    }),
    prisma.transaction.groupBy({
      by: ['date', 'type'],
      where: { AND: [where, { date: { gte: window.start, lt: window.end } }] },
      _sum: { amount: true },
    }),
  ])) as unknown as [
    { type: string; _sum: { amount: unknown } }[],
    { date: Date; type: string; _sum: { amount: unknown } }[],
  ];

  const runningBalanceCents = olderByType.reduce(
    (sum, r) => sum + signedCents(r.type, r._sum.amount ?? 0),
    0,
  );
  const byDay = new Map<string, number>();
  for (const r of dayRows) {
    const key = dayKey(r.date);
    byDay.set(key, (byDay.get(key) ?? 0) + signedCents(r.type, r._sum.amount ?? 0));
  }

  return {
    rows: rows.map(toFrontend),
    nextCursor: hasMore ? encodeTransactionCursor({ date: oldest.date, id: oldest.id }) : null,
    hasMore,
    runningBalanceStart: fromCents(runningBalanceCents),
    dayTotals: toDayTotals(byDay),
    ...base,
  };
};

type ScanRow = {
  id: string;
  date: Date;
  amount: unknown;
  type: string;
  payee: string | null;
  categoryId: string | null;
  isPayment: boolean;
  isTransfer: boolean;
  _count: { reimbursementIncomeLinks: number };
};

/**
 * Mode B — a text term Prisma can't express faithfully is active (amount-shaped
 * mobile search, or a `%`/`_` term). One lean scan over the desktop-scope
 * Prisma predicate, the remaining text/quick-filter predicates in JS, the page
 * window taken with the same comparator as Mode A's keyset, then only the page
 * is hydrated. Every aggregate is folded in JS from the scan — no second scan,
 * no `count`/`groupBy`.
 */
const getPageModeB = async (
  userId: string,
  request: TransactionsPageRequest,
  cursor: TransactionCursor | null,
): Promise<TransactionsPageResult> => {
  const scan = (await prisma.transaction.findMany({
    where: buildTransactionWhere(userId, request, { mobile: false }),
    select: {
      id: true,
      date: true,
      amount: true,
      type: true,
      payee: true,
      categoryId: true,
      isPayment: true,
      isTransfer: true,
      _count: { select: { reimbursementIncomeLinks: true } },
    },
    orderBy: ORDER_BY,
  })) as ScanRow[];

  const searchLower = request.mobileSearch.trim().toLowerCase();
  const desktop = scan
    .filter((r) => matchesDeferredPayee(r.payee, request.filters))
    .sort(compareTransactionOrder);
  const full = desktop.filter((r) => {
    if (request.quickFilter === 'uncategorized' && r.categoryId) return false;
    if (request.quickFilter === 'spending' && r.type !== 'EXPENSE') return false;
    if (request.quickFilter === 'income' && r.type !== 'INCOME') return false;
    if (!searchLower) return true;
    // byte-identical to the mobile search this replaces: payee OR formatted amount
    return (
      (r.payee ?? '').toLowerCase().includes(searchLower) ||
      Number(r.amount).toFixed(2).includes(searchLower)
    );
  });

  const acc = emptySummary();
  for (const r of desktop) {
    const cents = toCents(r.amount);
    addToSummary(acc, r, cents, r._count.reimbursementIncomeLinks > 0 ? cents : 0);
  }
  const base = {
    totalCount: full.length,
    desktopCount: desktop.length,
    uncategorizedCount: desktop.filter((r) => !r.categoryId).length,
    summary: toSummary(acc),
  };

  const after = cursor ? full.filter((r) => isOlderThanCursor(r, cursor)) : full;
  const pageRows = after.slice(0, request.limit);
  const hasMore = after.length > request.limit;
  if (pageRows.length === 0) return { rows: [], ...EMPTY_PAGE_TAIL, ...base };

  const hydrated = await prisma.transaction.findMany({
    where: { userId, id: { in: pageRows.map((r) => r.id) } },
    include,
    orderBy: ORDER_BY,
  });
  // `in` doesn't promise order; re-impose the scan's comparator order explicitly
  const position = new Map(pageRows.map((r, i) => [r.id, i]));
  const rows = hydrated
    .filter((r) => position.has(r.id))
    .sort((a, b) => position.get(a.id)! - position.get(b.id)!);

  const oldest = pageRows[pageRows.length - 1];
  const window = pageDayWindow(pageRows);
  let runningBalanceCents = 0;
  const byDay = new Map<string, number>();
  for (const r of full) {
    const signed = signedCents(r.type, r.amount);
    if (isOlderThanCursor(r, oldest)) runningBalanceCents += signed;
    if (r.date >= window.start && r.date < window.end) {
      const key = dayKey(r.date);
      byDay.set(key, (byDay.get(key) ?? 0) + signed);
    }
  }

  return {
    rows: rows.map(toFrontend),
    nextCursor: hasMore ? encodeTransactionCursor({ date: oldest.date, id: oldest.id }) : null,
    hasMore,
    runningBalanceStart: fromCents(runningBalanceCents),
    dayTotals: toDayTotals(byDay),
    ...base,
  };
};

/** True when some text term must be matched in JS rather than by a Prisma clause. */
const needsModeB = (request: TransactionScope): boolean => {
  const payee = request.filters.payee.trim();
  const search = request.mobileSearch.trim();
  return (
    (payee !== '' && needsExactStringMatch(payee)) ||
    (search !== '' && (isAmountSubstringCandidate(search) || needsExactStringMatch(search)))
  );
};

export const getTransactionsPage = async (
  userId: string,
  request: TransactionsPageRequest,
): Promise<TransactionsPageResult> => {
  let cursor: TransactionCursor | null = null;
  if (request.cursor !== undefined) {
    cursor = decodeTransactionCursor(request.cursor);
    if (!cursor) throw new ServiceValidationError('Invalid cursor');
  }
  return needsModeB(request)
    ? getPageModeB(userId, request, cursor)
    : getPageModeA(userId, request, cursor);
};
