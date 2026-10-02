import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { ServiceValidationError } from '@/lib/services/common';
import {
  fromCents,
  listPendingReimbursementExpenseIds,
  toCents,
} from '@/lib/services/reimbursements';
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
import { parseDateParam, rangeToDates } from '@/lib/period-selection';
import { summarizeTransactions } from '@/lib/transactions/transaction-summary';
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
  /** desktop-scope count of rows with no category, ignoring the pill-controlled
   * `type`/`uncategorizedOnly` filters — the mobile Uncategorized pill badge */
  uncategorizedCount: number;
  /** desktop-scope totals, computed by `summarizeTransactions` (reimbursement-netted) */
  summary: TransactionSummary;
  /** full-scope totals (mobile search included) — the mobile totals card */
  mobileSummary: TransactionSummary;
  /** full-day totals for every UTC day this page's rows touch, page-boundary independent */
  dayTotals: DayTotal[];
};

const ORDER_BY: Prisma.TransactionOrderByWithRelationInput[] = [{ date: 'desc' }, { id: 'desc' }];
const DAY_MS = 24 * 60 * 60 * 1000;

const signedCents = (type: string, amount: unknown): number =>
  type === 'INCOME' ? toCents(amount) : -toCents(amount);

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

export type BuildWhereOptions = {
  mobile: boolean;
  /** required when `filters.pendingReimbursementsOnly` is set */
  pendingReimbursementIds?: string[];
};

/** True when some text term must be matched in JS rather than by a Prisma clause. */
const needsModeB = (scope: TransactionScope): boolean =>
  (scope.filters.payee.trim() !== '' && !prismaSafePayee(scope.filters)) ||
  (scope.mobileSearch.trim() !== '' && !prismaSafeMobileSearch(scope.mobileSearch));

/** The scope with the mobile pills' `type`/`uncategorizedOnly` filters cleared,
 * so the Uncategorized badge doesn't drop to its own subset when a pill is on. */
const withoutPillFilters = (scope: TransactionScope): TransactionScope => ({
  ...scope,
  filters: { ...scope.filters, type: null, uncategorizedOnly: false },
});

/**
 * The one predicate behind the page query and every aggregate.
 * `mobile: false` omits `mobileSearch` — the desktop scope.
 *
 * Every constraint lands in a single `AND` array (never top-level keys):
 * `payee` is constrained by both the desktop filter and mobile search, and
 * `categoryId` by both `categoryIds` and `uncategorizedOnly` — top-level keys
 * would silently overwrite one another.
 *
 * Text terms Prisma cannot express faithfully are OMITTED here and matched in JS
 * by `getTransactionsPage` (Mode B): an amount-shaped mobile search (it has to
 * match `Number(amount).toFixed(2)` as a string), and any term containing `%`/`_`
 * (Prisma 6.19.3's `contains` does not escape LIKE metacharacters — see the
 * "Probe result" section of `docs/feature-plans/transactions-server-side-pagination.md`).
 * {@link matchesDeferredPayee} is the JS half for the desktop payee.
 *
 * `pendingReimbursementsOnly` depends on a derived status (linked total vs
 * expected amount) Prisma can't compare, so the caller resolves the matching
 * ids first ({@link listPendingReimbursementExpenseIds}) and passes them in.
 *
 * No `skippedAt` clause, deliberately: skipped transactions stay visible (Decision 9).
 */
export const buildTransactionWhere = (
  userId: string,
  scope: TransactionScope,
  options: BuildWhereOptions,
): Prisma.TransactionWhereInput => {
  const { filters } = scope;
  const and: Prisma.TransactionWhereInput[] = [];

  const payee = prismaSafePayee(filters);
  if (payee) and.push({ payee: { contains: payee, mode: 'insensitive' } });
  if (filters.accountIds.length > 0) and.push({ accountId: { in: filters.accountIds } });
  // `in` never matches NULL — exactly "no category never matches an active categoryIds filter"
  if (filters.categoryIds.length > 0) and.push({ categoryId: { in: filters.categoryIds } });

  // day-inclusive `to`: strictly before the NEXT day's UTC midnight
  const dates = rangeToDates({
    from: parseDateParam(filters.from),
    to: parseDateParam(filters.to),
  });
  if (dates.gte) and.push({ date: { gte: dates.gte } });
  if (dates.lt) and.push({ date: { lt: dates.lt } });

  if (filters.type) and.push({ type: filters.type });
  const amountMin = finiteAmount(filters.amountMin);
  if (amountMin !== null) and.push({ amount: { gte: amountMin } });
  const amountMax = finiteAmount(filters.amountMax);
  if (amountMax !== null) and.push({ amount: { lte: amountMax } });
  if (filters.hideTransfers) and.push({ isTransfer: false });
  if (filters.hidePayments) and.push({ isPayment: false });
  if (filters.uncategorizedOnly) and.push({ categoryId: null });
  if (filters.pendingReimbursementsOnly) {
    if (!options.pendingReimbursementIds) {
      throw new Error('pendingReimbursementIds is required when pendingReimbursementsOnly is set');
    }
    and.push({ id: { in: options.pendingReimbursementIds } });
  }

  if (options.mobile) {
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
  if (!term || prismaSafePayee(filters)) return true;
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
    pendingReimbursementsOnly: query.pendingReimbursementsOnly,
  },
  mobileSearch: query.mobileSearch,
  limit: query.limit,
  cursor: query.cursor,
});

/** Rows strictly older than `cursor` in the `(date desc, id desc)` order. */
const olderThan = (cursor: TransactionCursor): Prisma.TransactionWhereInput => ({
  OR: [{ date: { lt: cursor.date } }, { date: cursor.date, id: { lt: cursor.id } }],
});

/** The columns `summarizeTransactions` needs, selected without the display relations. */
const SUMMARY_SELECT = {
  amount: true,
  type: true,
  isPayment: true,
  isTransfer: true,
  isReimbursable: true,
  reimbursementExpectedAmount: true,
  reimbursementCompletedAt: true,
  reimbursementExpenseLinks: { select: { amount: true } },
  reimbursementIncomeLinks: { select: { amount: true } },
} as const;

type SummaryRow = {
  amount: unknown;
  type: string;
  isPayment: boolean;
  isTransfer: boolean;
  isReimbursable: boolean;
  reimbursementExpectedAmount: unknown;
  reimbursementCompletedAt: Date | null;
  reimbursementExpenseLinks: { amount: unknown }[];
  reimbursementIncomeLinks: { amount: unknown }[];
};

const sumLinks = (links: { amount: unknown }[]): string =>
  fromCents(links.reduce((sum, l) => sum + toCents(l.amount), 0));

/**
 * Totals through the same `summarizeTransactions` the client used before
 * pagination, so Debit stays netted of reimbursements exactly as Overview's
 * Out is. It needs per-row reimbursement fields, so this reads lean rows over
 * the whole scope rather than a `groupBy`.
 */
const summarizeRows = (rows: SummaryRow[]): TransactionSummary => {
  const totals = summarizeTransactions(
    rows.map((r) => ({
      amount: fromCents(toCents(r.amount)),
      type: r.type as FrontendTransaction['type'],
      isPayment: r.isPayment,
      isTransfer: r.isTransfer,
      isReimbursementIncome: r.reimbursementIncomeLinks.length > 0,
      isReimbursable: r.isReimbursable,
      reimbursementExpectedAmount:
        r.reimbursementExpectedAmount == null
          ? null
          : fromCents(toCents(r.reimbursementExpectedAmount)),
      reimbursementLinkedTotal: sumLinks(r.reimbursementExpenseLinks),
      reimbursementCompletedManually: r.reimbursementCompletedAt !== null,
      reimbursementIncomeLinkedTotal: sumLinks(r.reimbursementIncomeLinks),
    })),
  );
  return {
    credit: totals.credit.toFixed(2),
    debit: totals.debit.toFixed(2),
    payments: totals.payments.toFixed(2),
    transfers: totals.transfers.toFixed(2),
    reimbursementIncome: totals.reimbursementIncome.toFixed(2),
    net: totals.net.toFixed(2),
  };
};

/** Totals plus the row count, both from one lean scan of the scope. */
const summarize = async (
  where: Prisma.TransactionWhereInput,
): Promise<{ summary: TransactionSummary; count: number }> => {
  const rows = (await prisma.transaction.findMany({
    where,
    select: SUMMARY_SELECT,
  })) as SummaryRow[];
  return { summary: summarizeRows(rows), count: rows.length };
};

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

type PageAggregates = Pick<
  TransactionsPageResult,
  'totalCount' | 'desktopCount' | 'uncategorizedCount' | 'summary' | 'mobileSummary'
>;

/** The page envelope both modes share once they've picked their rows. */
const toPageResult = (
  rows: Parameters<typeof toFrontend>[0][],
  page: { hasMore: boolean; runningBalanceCents: number; byDay: Map<string, number> },
  aggregates: PageAggregates,
): TransactionsPageResult => {
  const oldest = rows[rows.length - 1];
  return {
    rows: rows.map(toFrontend),
    nextCursor:
      page.hasMore && oldest ? encodeTransactionCursor({ date: oldest.date, id: oldest.id }) : null,
    hasMore: page.hasMore,
    runningBalanceStart: fromCents(page.runningBalanceCents),
    dayTotals: toDayTotals(page.byDay),
    ...aggregates,
  };
};

const EMPTY_PAGE = { hasMore: false, runningBalanceCents: 0, byDay: new Map<string, number>() };

/**
 * Mode A — every clause is a Prisma clause. The page query runs alongside the
 * counts and summary; the running-balance and day-total aggregates depend on
 * the page's own rows, so they are a second phase (skipped for an empty page).
 */
const getPageModeA = async (
  userId: string,
  request: TransactionsPageRequest,
  cursor: TransactionCursor | null,
  pendingReimbursementIds: string[] | undefined,
): Promise<TransactionsPageResult> => {
  const where = buildTransactionWhere(userId, request, {
    mobile: true,
    pendingReimbursementIds,
  });
  const mobileDefaults = request.mobileSearch.trim() === '';
  const desktopWhere = mobileDefaults
    ? where
    : buildTransactionWhere(userId, request, { mobile: false, pendingReimbursementIds });
  const pillFreeWhere = buildTransactionWhere(userId, withoutPillFilters(request), {
    mobile: false,
    pendingReimbursementIds,
  });

  const [found, uncategorizedCount, desktop, mobileOrNull] = await Promise.all([
    prisma.transaction.findMany({
      where: cursor ? { AND: [where, olderThan(cursor)] } : where,
      include,
      orderBy: ORDER_BY,
      take: request.limit + 1,
    }),
    prisma.transaction.count({ where: { AND: [pillFreeWhere, { categoryId: null }] } }),
    summarize(desktopWhere),
    mobileDefaults ? Promise.resolve(null) : summarize(where),
  ]);
  const mobile = mobileOrNull ?? desktop;

  const hasMore = found.length > request.limit;
  const rows = hasMore ? found.slice(0, request.limit) : found;
  const base = {
    totalCount: mobile.count,
    desktopCount: desktop.count,
    uncategorizedCount,
    summary: desktop.summary,
    mobileSummary: mobile.summary,
  };
  if (rows.length === 0) return toPageResult([], EMPTY_PAGE, base);

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

  return toPageResult(rows, { hasMore, runningBalanceCents, byDay }, base);
};

type ScanRow = SummaryRow & {
  id: string;
  date: Date;
  payee: string | null;
  categoryId: string | null;
};

/**
 * Mode B — a text term Prisma can't express faithfully is active (amount-shaped
 * mobile search, or a `%`/`_` term). One lean scan over the desktop-scope
 * Prisma predicate, the remaining text predicates in JS, the page
 * window taken with the same comparator as Mode A's keyset, then only the page
 * is hydrated. Every aggregate is folded in JS from the scan — no second scan,
 * no `count`/`groupBy`.
 */
const getPageModeB = async (
  userId: string,
  request: TransactionsPageRequest,
  cursor: TransactionCursor | null,
  pendingReimbursementIds: string[] | undefined,
): Promise<TransactionsPageResult> => {
  // Scanned without the pill-controlled `type`/`uncategorizedOnly` filters so
  // the Uncategorized badge can be counted from the same scan; they're
  // re-applied in JS for the desktop scope below.
  const scan = (await prisma.transaction.findMany({
    where: buildTransactionWhere(userId, withoutPillFilters(request), {
      mobile: false,
      pendingReimbursementIds,
    }),
    select: { id: true, date: true, payee: true, categoryId: true, ...SUMMARY_SELECT },
  })) as ScanRow[];

  const { type, uncategorizedOnly } = request.filters;
  const searchLower = request.mobileSearch.trim().toLowerCase();
  // sorted here rather than by Postgres, so the order is exactly the keyset comparator's
  const pillFree = scan
    .filter((r) => matchesDeferredPayee(r.payee, request.filters))
    .sort(compareTransactionOrder);
  const desktop = pillFree.filter(
    (r) => (!type || r.type === type) && (!uncategorizedOnly || !r.categoryId),
  );
  const full = desktop.filter((r) => {
    if (!searchLower) return true;
    // byte-identical to the mobile search this replaces: payee OR formatted amount
    return (
      (r.payee ?? '').toLowerCase().includes(searchLower) ||
      Number(r.amount).toFixed(2).includes(searchLower)
    );
  });

  const base = {
    totalCount: full.length,
    desktopCount: desktop.length,
    uncategorizedCount: pillFree.filter((r) => !r.categoryId).length,
    summary: summarizeRows(desktop),
    mobileSummary: summarizeRows(full),
  };

  const after = cursor ? full.filter((r) => isOlderThanCursor(r, cursor)) : full;
  const pageRows = after.slice(0, request.limit);
  const hasMore = after.length > request.limit;
  if (pageRows.length === 0) return toPageResult([], EMPTY_PAGE, base);

  const hydrated = await prisma.transaction.findMany({
    where: { userId, id: { in: pageRows.map((r) => r.id) } },
    include,
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

  return toPageResult(rows, { hasMore, runningBalanceCents, byDay }, base);
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
  const pendingReimbursementIds = request.filters.pendingReimbursementsOnly
    ? await listPendingReimbursementExpenseIds(userId)
    : undefined;
  return needsModeB(request)
    ? getPageModeB(userId, request, cursor, pendingReimbursementIds)
    : getPageModeA(userId, request, cursor, pendingReimbursementIds);
};
