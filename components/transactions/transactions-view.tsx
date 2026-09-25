'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeftRight,
  HandCoins,
  Loader2,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
  Upload,
} from 'lucide-react';
import { Drawer } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Money } from '@/components/ui/money';
import { TransactionForm } from '@/components/transactions/transaction-form';
import { TransactionFiltersDialog } from '@/components/transactions/transaction-filters-dialog';
import { MatchTransfersDialog } from '@/components/transactions/match-transfers-dialog';
import { PeriodPicker, type PeriodMode } from '@/components/transactions/period-picker';
import { deleteJSON, getJSON, postJSON, type ApiFailure } from '@/lib/api-client';
import { cn } from '@/lib/cn';
import {
  getCalendarMonthPeriod,
  getNextStatementPeriod,
  getPreviousStatementPeriod,
  getStatementPeriod,
  type Period,
} from '@/lib/statement';
import {
  countActiveFilterGroups,
  parseTransactionFilters,
  transactionFiltersToSearchParams,
  type TransactionFilters,
} from '@/lib/transactions/transaction-filters';
import type { QuickFilter } from '@/lib/transactions/transaction-scope';
import {
  transactionsPageSearchParams,
  transactionsPageUrl,
} from '@/lib/transactions/transactions-page-query';
import type { FrontendAccount } from '@/lib/services/accounts';
import type { FrontendCategory } from '@/lib/services/categories';
import type { FrontendTransaction } from '@/lib/services/transactions';
import type { TransactionsPageResult } from '@/lib/services/transactionsPage';
import { formatDate } from '@/lib/format';
import { categoryColorVar } from '@/lib/ui/category-color';

const toYyyymm = (date: Date): number => date.getUTCFullYear() * 100 + (date.getUTCMonth() + 1);

const toCents = (value: string | number): number => Math.round(Number(value) * 100);

/**
 * Rows arrive newest-first across every loaded page, so grouping in arrival
 * order keys each day once — a Load more that lands mid-day appends into the
 * existing group instead of opening a duplicate header for the same date.
 * Keyed on the ISO day (UTC, same as the server's `dayTotals`); `formatDate`
 * is only the label.
 */
const groupByDay = (list: FrontendTransaction[]): [string, FrontendTransaction[]][] => {
  const groups = new Map<string, FrontendTransaction[]>();
  for (const t of list) {
    const key = t.date.slice(0, 10);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(t);
  }
  return Array.from(groups.entries());
};

/**
 * `invalid-request` (a 400: our own params/cursor were rejected) must not be
 * retried verbatim; `network` (offline, aborted connection, 5xx) retries the
 * identical request.
 */
type FetchErrorKind = 'invalid-request' | 'network';
const classifyFailure = (res: ApiFailure): FetchErrorKind =>
  res.status === 400 ? 'invalid-request' : 'network';

type Tree = 'desktop' | 'mobile';

const plural = (n: number): string => (n === 1 ? '' : 's');

/** Scope part of a request key (`<scope query>#<reloadNonce>`); `#` is always %-encoded inside the query. */
const scopeOf = (requestKey: string): string => requestKey.slice(0, requestKey.lastIndexOf('#'));

export const TransactionsView = ({
  initialPage,
  initialRequestKey,
  accounts,
  categories,
}: {
  /** server-rendered page 1 for `initialRequestKey` */
  initialPage: TransactionsPageResult;
  /** the scope query string that produced `initialPage` */
  initialRequestKey: string;
  accounts: FrontendAccount[];
  categories: FrontendCategory[];
}): React.ReactElement => {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [dialogKey, setDialogKey] = useState(0);
  const [open, setOpen] = useState(false);
  const [drawerKey, setDrawerKey] = useState(0);
  const [detail, setDetail] = useState<FrontendTransaction | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const [matchPending, setMatchPending] = useState(false);
  const [matchResult, setMatchResult] = useState<string | null>(null);
  const [periodMode, setPeriodMode] = useState<PeriodMode>('ALL');
  const [periodAnchor, setPeriodAnchor] = useState(() => new Date());
  const [mobileSearch, setMobileSearch] = useState('');
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('all');
  const [filtersDialogOpen, setFiltersDialogOpen] = useState(false);
  const [filtersDialogKey, setFiltersDialogKey] = useState(0);
  const [matchDialogOpen, setMatchDialogOpen] = useState(false);
  const [matchDialogKey, setMatchDialogKey] = useState(0);

  // --- server-paginated list state -------------------------------------------
  // `pages` are the loaded pages for `pagesKey` (page 1 + every Load more).
  // A request key is `<scope query>#<reloadNonce>`; mutations bump the nonce.
  const [pages, setPages] = useState<TransactionsPageResult[]>([initialPage]);
  const [pagesKey, setPagesKey] = useState(`${initialRequestKey}#0`);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [scopeError, setScopeError] = useState<{ key: string; kind: FetchErrorKind } | null>(null);
  const [scopeRetry, setScopeRetry] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<FetchErrorKind | null>(null);
  const [announcements, setAnnouncements] = useState<Record<Tree, string>>({
    desktop: '',
    mobile: '',
  });
  const pagesKeyRef = useRef(pagesKey);
  const desktopListRef = useRef<HTMLDivElement>(null);
  const mobileListRef = useRef<HTMLDivElement>(null);
  const desktopStatusRef = useRef<HTMLParagraphElement>(null);
  const mobileStatusRef = useRef<HTMLParagraphElement>(null);
  const desktopLoadMoreRef = useRef<HTMLDivElement>(null);
  const mobileLoadMoreRef = useRef<HTMLDivElement>(null);

  // The SSR page is adopted once, on mount; after that the client owns every
  // fetch. A server re-render with the SAME URL scope whose page 1 actually
  // CHANGED, though, is a `router.refresh()` after a mutation made outside
  // this component (the layout's add-transaction overlay, the form hook, the
  // reimbursement panel), so it refetches the current scope. An identical
  // re-render (opening/closing the `?overlay=add` overlay, a no-op refresh)
  // is ignored so it can't collapse Load-more'd pages, and a re-render for a
  // NEW URL scope is just the echo of our own filter/URL push, already
  // fetched client-side: ignored too.
  const [ssrSeen, setSsrSeen] = useState(() => ({
    page: initialPage,
    key: initialRequestKey,
    signature: JSON.stringify(initialPage),
  }));
  if (initialPage !== ssrSeen.page) {
    const signature = JSON.stringify(initialPage);
    setSsrSeen({ page: initialPage, key: initialRequestKey, signature });
    if (initialRequestKey === ssrSeen.key && signature !== ssrSeen.signature) {
      setReloadNonce((n) => n + 1);
    }
  }

  // The URL is the source of truth for every filter except the payee search
  // box (below) — re-derived on every searchParams change rather than
  // mirrored into separate component state, so there's one place filter
  // state can drift from the URL: nowhere.
  const filters = useMemo(() => parseTransactionFilters(searchParams), [searchParams]);
  const activeFilterCount = countActiveFilterGroups(filters);

  // The search box is local state; once typing pauses for 300ms the value
  // "settles" — it becomes part of the server request (no Apply step, but no
  // request per keystroke either) and is pushed to the URL in the same beat.
  // Filtering is a network round trip now, so it is deliberately debounced;
  // the previous rows stay visible (dimmed) until the new ones land.
  const [payeeDraft, setPayeeDraft] = useState(filters.payee);
  const [settledPayee, setSettledPayee] = useState(filters.payee);
  // Re-seeds `payeeDraft` when `filters.payee` changes from outside this
  // input (the filters dialog's "Reset", browser back/forward, a pasted
  // URL) — adjusted during render, React's documented pattern for syncing
  // state to a prop change, rather than in an effect (which would commit
  // the stale draft for one extra frame first).
  const [payeeSyncedFrom, setPayeeSyncedFrom] = useState(filters.payee);
  // Payee values we've pushed to the URL ourselves that it hasn't caught up
  // to yet, oldest first. When the URL's payee lands on one of them it's the
  // echo of our own debounced push completing, not an external change, and
  // must not stomp on whatever the user has typed since (this used to happen:
  // the URL round-trip for one keystroke could land after the user had
  // already typed several more, snapping the input back mid-word). A queue,
  // not just the last value: two quick settles (type, pause, clear) can both
  // be in flight, and the older echo must not read as an external change.
  const [pendingPayeePushes, setPendingPayeePushes] = useState<string[]>([]);
  if (filters.payee !== payeeSyncedFrom) {
    setPayeeSyncedFrom(filters.payee);
    const echoAt = pendingPayeePushes.indexOf(filters.payee);
    if (echoAt >= 0) {
      setPendingPayeePushes(pendingPayeePushes.slice(echoAt + 1));
    } else {
      setPayeeDraft(filters.payee);
      setSettledPayee(filters.payee);
      setPendingPayeePushes([]);
    }
  }
  // What the URL's payee is, or will be once our pushes land — the debounce
  // compares against this, never the possibly-stale `filters.payee`, or a
  // settle that happens while an earlier push is in flight would be skipped.
  const payeeUrlTargetRef = useRef(filters.payee);
  useEffect(() => {
    if (pendingPayeePushes.length === 0) payeeUrlTargetRef.current = filters.payee;
  }, [filters.payee, pendingPayeePushes]);

  const pushFilters = useCallback(
    (next: TransactionFilters): void => {
      const query = transactionFiltersToSearchParams(next).toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router],
  );

  useEffect(() => {
    if (payeeDraft === settledPayee) return;
    const timeout = setTimeout(() => {
      setSettledPayee(payeeDraft);
      if (payeeDraft === payeeUrlTargetRef.current) return;
      payeeUrlTargetRef.current = payeeDraft;
      setPendingPayeePushes((pushes) => [...pushes, payeeDraft]);
      pushFilters({ ...filters, payee: payeeDraft });
    }, 300);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run on payeeDraft changes; `filters`/`pushFilters` reacting here would restart the debounce on every unrelated filter change
  }, [payeeDraft]);

  // Same 300ms settle for the mobile search box (it had none while it filtered in memory).
  const [settledMobileSearch, setSettledMobileSearch] = useState('');
  useEffect(() => {
    if (mobileSearch === settledMobileSearch) return;
    const timeout = setTimeout(() => setSettledMobileSearch(mobileSearch), 300);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- debounce keystrokes only; the settled value changing must not restart it
  }, [mobileSearch]);

  const selectedAccountId = filters.accountIds.length === 1 ? filters.accountIds[0] : null;
  const selectedAccount = accounts.find((a) => a.id === selectedAccountId);
  const canUseStatementView =
    selectedAccount?.type === 'CREDIT_CARD' && !!selectedAccount.statementDay;

  const openFiltersDialog = (): void => {
    setFiltersDialogKey((k) => k + 1);
    setFiltersDialogOpen(true);
  };

  const handleApplyFilters = (next: TransactionFilters): void => {
    // Switching away from (or into) exactly one selected account changes
    // whether the statement/month Period Picker is even shown, so its state
    // resets the same way the old single-select dropdown's onChange did.
    const nextSingleAccountId = next.accountIds.length === 1 ? next.accountIds[0] : null;
    if (nextSingleAccountId !== selectedAccountId) {
      setPeriodMode('ALL');
      setPeriodAnchor(new Date());
    }
    pushFilters(next);
  };

  const period: Period | null = useMemo(() => {
    if (periodMode === 'ALL') return null;
    if (periodMode === 'STATEMENT' && selectedAccount?.statementDay) {
      return getStatementPeriod(selectedAccount.statementDay, periodAnchor);
    }
    if (periodMode === 'MONTH') {
      return getCalendarMonthPeriod(toYyyymm(periodAnchor));
    }
    return null;
  }, [periodMode, periodAnchor, selectedAccount]);

  const shiftPeriod = (direction: 'prev' | 'next'): void => {
    if (!period) return;
    if (periodMode === 'STATEMENT' && selectedAccount?.statementDay) {
      const next =
        direction === 'prev'
          ? getPreviousStatementPeriod(selectedAccount.statementDay, period)
          : getNextStatementPeriod(selectedAccount.statementDay, period);
      setPeriodAnchor(next.start);
      return;
    }
    const anchor = new Date(periodAnchor);
    anchor.setUTCMonth(anchor.getUTCMonth() + (direction === 'prev' ? -1 : 1));
    setPeriodAnchor(anchor);
  };

  const openCreate = (): void => {
    setDialogKey((k) => k + 1);
    setOpen(true);
  };

  const openDetail = (tx: FrontendTransaction): void => {
    setDetail(tx);
    setDrawerKey((k) => k + 1);
  };

  const handleDelete = async (id: string): Promise<void> => {
    setDeletePending(true);
    await deleteJSON(`/api/transactions/${id}`);
    setDeletePending(false);
    setConfirmDeleteId(null);
    setDetail(null);
    setReloadNonce((n) => n + 1);
    router.refresh();
  };

  const openMatchDialog = (): void => {
    setMatchDialogKey((k) => k + 1);
    setMatchDialogOpen(true);
  };

  const handleMatchTransfers = async (range: { from: Date; to: Date }): Promise<void> => {
    setMatchPending(true);
    setMatchResult(null);
    const res = await postJSON<{ matched: number }>('/api/transactions/match-transfers', range);
    setMatchPending(false);
    if (!res.ok) {
      setMatchResult('Could not match transfers. Try again.');
      return;
    }
    setMatchDialogOpen(false);
    const data = res.data;
    setMatchResult(
      data.matched === 0
        ? 'No new transfer pairs found.'
        : `Matched ${data.matched} transfer pair${data.matched === 1 ? '' : 's'}.`,
    );
    setReloadNonce((n) => n + 1);
    router.refresh();
  };

  const scopeKey = useMemo(
    () =>
      transactionsPageSearchParams({
        filters: { ...filters, payee: settledPayee },
        period,
        mobileSearch: settledMobileSearch,
        quickFilter,
      }).toString(),
    [filters, settledPayee, period, settledMobileSearch, quickFilter],
  );
  const requestKey = `${scopeKey}#${reloadNonce}`;
  // Page 1 for the current key is in flight (or about to be): previous rows
  // stay on screen, dimmed, until it lands.
  const pending = requestKey !== pagesKey && scopeError?.key !== requestKey;
  const currentScopeError = scopeError?.key === requestKey ? scopeError.kind : null;

  useEffect(() => {
    pagesKeyRef.current = pagesKey;
  }, [pagesKey]);

  // Any request-key change fetches page 1 and REPLACES `pages` (never appends);
  // a superseded request is aborted and its late response dropped.
  useEffect(() => {
    if (requestKey === pagesKey) return;
    const key = requestKey;
    const scopeChanged = scopeOf(key) !== scopeOf(pagesKey);
    const controller = new AbortController();
    void getJSON<TransactionsPageResult>(transactionsPageUrl(scopeOf(key)), {
      signal: controller.signal,
    }).then((res) => {
      if (controller.signal.aborted) return;
      if (!res.ok) {
        setScopeError({ key, kind: classifyFailure(res) });
        return;
      }
      const page = res.data;
      setPages([page]);
      setPagesKey(key);
      setScopeError(null);
      setMoreError(null);
      setAnnouncements({
        desktop: `${page.rows.length} of ${page.desktopCount} shown.`,
        mobile: `${page.rows.length} of ${page.totalCount} shown.`,
      });
      if (scopeChanged) {
        // back to the newest rows, but only if the list's top is scrolled
        // past — never yank the filter controls out from under the user
        for (const el of [desktopListRef.current, mobileListRef.current]) {
          if (el && el.offsetParent !== null && el.getBoundingClientRect().top < 0) {
            el.scrollIntoView({ block: 'start' });
          }
        }
      }
    });
    return () => controller.abort();
    // `scopeRetry` is a dependency only so "Try again" re-runs a failed fetch for the same key
  }, [requestKey, pagesKey, scopeRetry]);

  const retryScope = (): void => {
    setScopeError(null);
    setScopeRetry((n) => n + 1);
  };

  const lastPage = pages[pages.length - 1];
  const canLoadMore = !pending && requestKey === pagesKey && lastPage.hasMore;

  const loadMore = async (tree: Tree): Promise<void> => {
    if (moreError === 'invalid-request') {
      // the server rejected our cursor: don't replay it — start over from page 1
      setMoreError(null);
      setReloadNonce((n) => n + 1);
      return;
    }
    const key = pagesKey;
    const cursor = lastPage.nextCursor;
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    setMoreError(null);
    const res = await getJSON<TransactionsPageResult>(transactionsPageUrl(scopeOf(key), cursor));
    setLoadingMore(false);
    if (pagesKeyRef.current !== key) return; // the scope moved on while this was in flight
    if (!res.ok) {
      setMoreError(classifyFailure(res));
      return;
    }
    const page = res.data;
    const rendered = pages.reduce((n, p) => n + p.rows.length, 0) + page.rows.length;
    setPages((prev) => [...prev, page]);
    const message = (count: number): string =>
      `Loaded ${page.rows.length} more transaction${plural(page.rows.length)}. ${rendered} of ${count} shown.`;
    setAnnouncements({
      desktop: message(pages[0].desktopCount),
      mobile: message(pages[0].totalCount),
    });
    // Once the list is exhausted the button unmounts: move focus to the status
    // line rather than letting it drop to <body>. Otherwise keep it on the
    // button (disabling a focused button while loading can blur it).
    requestAnimationFrame(() => {
      const row = tree === 'desktop' ? desktopLoadMoreRef.current : mobileLoadMoreRef.current;
      const status = tree === 'desktop' ? desktopStatusRef.current : mobileStatusRef.current;
      if (page.hasMore) row?.querySelector('button')?.focus();
      else status?.focus();
    });
  };

  const rows = pages.flatMap((p) => p.rows);
  const { summary, desktopCount, totalCount, uncategorizedCount } = pages[0];
  const net = Number(summary.net);

  // Each page's dayTotals entry is the authoritative full-day total, so later
  // pages overwrite rather than add.
  const dayTotals = new Map<string, number>();
  for (const page of pages) {
    for (const d of page.dayTotals) dayTotals.set(d.day, Number(d.total));
  }
  const dayTotalOf = (day: string, dayRows: FrontendTransaction[]): number =>
    dayTotals.get(day) ??
    dayRows.reduce((sum, t) => sum + (t.type === 'INCOME' ? 1 : -1) * Number(t.amount), 0);

  // Running balance, walked oldest-first within each page from that page's own
  // server-computed opening total (in cents, so it can't drift).
  const runningBalance = new Map<string, number>();
  for (const page of pages) {
    let cents = toCents(page.runningBalanceStart);
    for (let i = page.rows.length - 1; i >= 0; i--) {
      const t = page.rows[i];
      cents += t.type === 'INCOME' ? toCents(t.amount) : -toCents(t.amount);
      runningBalance.set(t.id, cents / 100);
    }
  }

  const days = groupByDay(rows);

  const renderLoadMore = (tree: Tree): React.ReactElement => (
    <div
      ref={tree === 'desktop' ? desktopLoadMoreRef : mobileLoadMoreRef}
      className={tree === 'desktop' ? 'mt-5.5 flex flex-col items-center gap-2' : 'mt-5'}
    >
      {canLoadMore && (
        <>
          <Button
            type="button"
            variant="secondary"
            loading={loadingMore}
            onClick={() => void loadMore(tree)}
            className={tree === 'mobile' ? 'w-full py-3' : undefined}
          >
            {moreError ? 'Try again' : 'Load more'}
          </Button>
          {moreError && (
            <p role="alert" className="text-rose mt-2 text-center text-[13px]">
              Couldn&apos;t load more transactions. Try again.
            </p>
          )}
        </>
      )}
      <p
        ref={tree === 'desktop' ? desktopStatusRef : mobileStatusRef}
        tabIndex={-1}
        role="status"
        aria-live="polite"
        data-testid={`transactions-load-status-${tree}`}
        className="sr-only"
      >
        {announcements[tree]}
      </p>
    </div>
  );

  const renderScopeError = (): React.ReactElement | null =>
    currentScopeError ? (
      <div role="alert" className="text-rose mt-3 flex items-center gap-3 text-[13px]">
        <span>Couldn&apos;t load transactions. Try again.</span>
        <Button type="button" variant="secondary" onClick={retryScope} className="px-3 py-1">
          Try again
        </Button>
      </div>
    ) : null;

  const SearchIcon = pending ? Loader2 : Search;
  const searchIconClass = cn('text-ink-muted shrink-0', pending && 'animate-spin');
  return (
    <div className="mt-6.5 pb-20 lg:pb-0">
      {/* Desktop-only filter row; the mobile screen gets its own search +
          quick-filter pills below, matching the mockup. */}
      <div
        data-testid="transaction-filters-desktop"
        className="hidden items-center gap-2 lg:flex lg:flex-wrap"
      >
        <div
          data-testid="transactions-search-desktop"
          data-pending={pending ? 'true' : 'false'}
          className="border-line bg-paper-raised flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-2"
        >
          <SearchIcon size={15} className={searchIconClass} aria-hidden="true" />
          <input
            type="text"
            value={payeeDraft}
            onChange={(e) => setPayeeDraft(e.target.value)}
            placeholder="Search payee"
            className="placeholder:text-ink-muted/70 w-36 bg-transparent text-[13px] outline-none"
          />
        </div>
        <Button
          type="button"
          variant="secondary"
          onClick={openFiltersDialog}
          icon={SlidersHorizontal}
          className="shrink-0 px-4 py-2"
        >
          Filters
          {activeFilterCount > 0 && (
            <span className="bg-iris text-paper-raised rounded-full px-1.5 py-0.5 font-mono text-[11px] tabular-nums">
              {activeFilterCount}
            </span>
          )}
        </Button>
        <div className="hidden flex-1 lg:block" />
        <Link
          href="/import"
          className="border-line text-ink inline-flex shrink-0 items-center gap-1.5 rounded-full border px-4 py-2 text-sm"
        >
          <Upload size={15} />
          Import CSV
        </Link>
        <Button
          type="button"
          variant="secondary"
          onClick={openMatchDialog}
          icon={ArrowLeftRight}
          loading={matchPending}
          className="shrink-0 px-4 py-2"
        >
          Match transfers
        </Button>
        {/* Desktop-only: below lg the sticky "+ Log a spend" CTA already covers
            this screen, and a second entry point crowds the filter row.
            Visibility lives on a wrapper, not the Button's className — `cn` is
            a plain join, so `hidden` would sit alongside the Button's own base
            `inline-flex` rather than overriding it. */}
        <div className="hidden shrink-0 lg:block">
          <Button type="button" onClick={openCreate} icon={Plus} className="px-4 py-2">
            Add transaction
          </Button>
        </div>
      </div>

      {matchResult && (
        <p className="text-ink-muted mt-2 text-sm" role="status">
          {matchResult}
        </p>
      )}

      {selectedAccountId && (
        <div className="mt-3 hidden lg:block">
          <PeriodPicker
            mode={periodMode}
            onModeChange={(m) => {
              setPeriodMode(m);
              setPeriodAnchor(new Date());
            }}
            period={period}
            onPrev={() => shiftPeriod('prev')}
            onNext={() => shiftPeriod('next')}
            allowStatement={canUseStatementView}
          />
          {selectedAccount?.type === 'CREDIT_CARD' && !selectedAccount.statementDay && (
            <p className="text-ink-muted mt-1 text-xs">
              Set a statement day on this account to view by statement.
            </p>
          )}
        </div>
      )}

      <div
        data-testid="transactions-summary"
        aria-busy={pending}
        className={cn(
          'border-line bg-paper-raised mt-3.5 hidden items-start gap-3 rounded-[14px] border px-6 py-3.5 transition-opacity lg:flex lg:flex-row lg:items-center lg:justify-between lg:gap-6',
          pending && 'opacity-60',
        )}
      >
        <span className="text-ink-muted text-[12.5px] font-medium whitespace-nowrap">
          {desktopCount} transaction{plural(desktopCount)}
          {period ? ' in this period' : ''}
        </span>
        {/* Wraps rather than scrolls below lg: a scroll container would hide Net
            off-screen with no affordance. */}
        <div className="flex flex-wrap items-center gap-x-6.5 gap-y-2.5 text-[13.5px] lg:flex-nowrap">
          <span className="flex items-baseline gap-1.5">
            <span className="text-ink-muted text-xs">Credit</span>
            <span className="text-sky font-mono tabular-nums">
              +{Number(summary.credit).toFixed(2)}
            </span>
          </span>
          <span className="flex items-baseline gap-1.5">
            <span className="text-ink-muted text-xs">Debit</span>
            <span className="text-rose font-mono tabular-nums">
              −{Number(summary.debit).toFixed(2)}
            </span>
          </span>
          <span className="border-line flex items-baseline gap-1.5 border-l-0 pl-0 lg:border-l lg:pl-6.5">
            <span className="text-ink-muted text-xs">Net</span>
            <span className={cn('font-mono tabular-nums', net >= 0 ? 'text-sky' : 'text-rose')}>
              {net >= 0 ? '+' : '−'}
              {Math.abs(net).toFixed(2)}
            </span>
          </span>
          {Number(summary.payments) > 0 && (
            <span className="border-line flex items-baseline gap-1.5 border-l-0 pl-0 lg:border-l lg:pl-6.5">
              <span className="text-ink-muted text-xs">Payments (excluded)</span>
              <Money value={summary.payments} tone="neutral" />
            </span>
          )}
          {Number(summary.transfers) > 0 && (
            <span className="border-line flex items-baseline gap-1.5 border-l-0 pl-0 lg:border-l lg:pl-6.5">
              <span className="text-ink-muted text-xs">Transfers (excluded)</span>
              <Money value={summary.transfers} tone="neutral" />
            </span>
          )}
          {Number(summary.reimbursementIncome) > 0 && (
            <span className="border-line flex items-baseline gap-1.5 border-l-0 pl-0 lg:border-l lg:pl-6.5">
              <span className="text-ink-muted text-xs">Reimbursement income (excluded)</span>
              <Money value={summary.reimbursementIncome} tone="neutral" />
            </span>
          )}
        </div>
      </div>

      <div className="hidden lg:block">{renderScopeError()}</div>

      <div
        ref={desktopListRef}
        data-testid="transactions-list-desktop"
        aria-busy={pending}
        className={cn(
          'hidden transition-opacity lg:block',
          pending && 'pointer-events-none opacity-60',
        )}
      >
        {rows.length === 0 ? (
          <p className="text-ink-muted mt-6 text-sm">
            No transactions match. Log one to get started.
          </p>
        ) : (
          days.map(([day, dayRows]) => {
            const dayTotal = dayTotalOf(day, dayRows);
            return (
              <div key={day} className="mt-5.5" data-testid="transaction-day-desktop">
                <div className="flex items-baseline gap-3 px-0.5 pb-2">
                  <span className="text-ink-muted font-mono text-xs tracking-[0.06em]">
                    {formatDate(day)}
                  </span>
                  <span className="bg-line h-px flex-1" />
                  <span
                    data-testid="transaction-day-total"
                    className={cn('font-mono text-xs', dayTotal >= 0 ? 'text-sky' : 'text-rose')}
                  >
                    {dayTotal >= 0 ? '+' : '−'}
                    {Math.abs(dayTotal).toFixed(2)}
                  </span>
                </div>
                <div className="border-line bg-paper-raised rounded-[14px] border px-6">
                  {dayRows.map((t) => (
                    <div
                      key={t.id}
                      onClick={() => openDetail(t)}
                      className="ledger-row flex cursor-pointer items-center gap-3 py-3.5 lg:gap-5"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">
                          {t.payee || t.categoryName || 'Transaction'}
                        </div>
                        <div className="text-ink-muted mt-0.5 text-xs">{t.accountName}</div>
                        {/* non-interactive chip: the row already owns the click
                          (opens the detail drawer). The link to the history
                          entry lives in that drawer instead. */}
                        {t.importBatchFilename && (
                          <div className="text-ink-muted mt-0.5 flex items-center gap-1 text-[11px]">
                            <Upload size={11} />
                            <span className="truncate">{t.importBatchFilename}</span>
                          </div>
                        )}
                        {t.isReimbursable && (
                          <div className="text-ink-muted mt-0.5 flex items-center gap-1 text-[11px]">
                            <HandCoins size={11} />
                            {t.reimbursementStatus === 'COMPLETE' ? (
                              <span>Reimbursable · reimbursed</span>
                            ) : (
                              <span className="flex items-center gap-1">
                                Reimbursable ·{' '}
                                <Money
                                  value={t.reimbursementOutstanding}
                                  tone="neutral"
                                  className="text-[11px]"
                                />{' '}
                                pending
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                      <span
                        className={cn(
                          'shrink-0 rounded-full px-2.5 py-1 text-[12.5px]',
                          t.categoryName
                            ? 'border-line text-ink-muted border'
                            : 'border-rose bg-rose-soft text-rose border',
                        )}
                      >
                        {t.categoryName ?? 'Uncategorized'}
                      </span>
                      <span
                        className={cn(
                          'shrink-0 text-right font-mono text-sm tabular-nums lg:w-[100px]',
                          t.type === 'INCOME' ? 'text-sky' : 'text-rose',
                        )}
                      >
                        {t.type === 'INCOME' ? '+' : '−'}
                        {Number(t.amount).toFixed(2)}
                      </span>
                      {/* Running balance is a desktop-only column: at 402px it squeezed
                        the payee cell to zero width. */}
                      <span
                        data-testid="running-balance"
                        className="text-ink-muted hidden w-[86px] shrink-0 text-right font-mono text-xs tabular-nums lg:block"
                      >
                        {(runningBalance.get(t.id) ?? 0).toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })
        )}
        {renderLoadMore('desktop')}
      </div>

      <div className="lg:hidden">
        <div className="flex items-center gap-2">
          <div
            data-testid="transactions-search-mobile"
            data-pending={pending ? 'true' : 'false'}
            className="border-line bg-paper-raised flex flex-1 items-center gap-2.25 rounded-full border px-3.75 py-0"
          >
            <SearchIcon size={15} className={searchIconClass} aria-hidden="true" />
            <input
              type="text"
              value={mobileSearch}
              onChange={(e) => setMobileSearch(e.target.value)}
              placeholder="Search payee or amount"
              className="placeholder:text-ink-muted/70 min-h-[46px] flex-1 bg-transparent text-sm outline-none"
            />
          </div>
          <button
            type="button"
            onClick={openFiltersDialog}
            aria-label="Filters"
            data-testid="mobile-filters-button"
            className="border-line bg-paper-raised text-ink relative flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-full border"
          >
            <SlidersHorizontal size={17} />
            {activeFilterCount > 0 && (
              <span className="bg-iris text-paper-raised absolute -top-1 -right-1 flex h-4.5 min-w-4.5 items-center justify-center rounded-full px-1 font-mono text-[10px] tabular-nums">
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>

        <div
          data-testid="transaction-filters"
          className="-mx-4.5 mt-3 flex gap-2 overflow-x-auto px-4.5 pb-0.5"
        >
          {(
            [
              ['all', 'All'],
              ['uncategorized', `Uncategorized ${uncategorizedCount}`],
              ['spending', 'Spending'],
              ['income', 'Income'],
            ] as [QuickFilter, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setQuickFilter(key)}
              className={cn(
                'shrink-0 rounded-full px-3.5 py-2 text-[12.5px] font-medium',
                quickFilter === key
                  ? 'bg-ink text-paper-raised'
                  : 'border-line text-ink bg-paper-raised border',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {/* "transfers excluded" is a known, pre-existing copy bug (the count
            does not exclude transfers) — deliberately left as-is, see the
            pagination plan's Decision 10. */}
        <p className={cn('text-ink-muted mt-3.5 text-[12.5px]', pending && 'opacity-60')}>
          {totalCount} transaction{plural(totalCount)} · transfers excluded
        </p>

        {renderScopeError()}

        <div
          ref={mobileListRef}
          data-testid="transactions-list-mobile"
          aria-busy={pending}
          className={cn('transition-opacity', pending && 'pointer-events-none opacity-60')}
        >
          {rows.length === 0 ? (
            <p className="text-ink-muted mt-6 text-sm">
              No transactions match. Log one to get started.
            </p>
          ) : (
            days.map(([day, dayRows]) => {
              const dayTotal = dayTotalOf(day, dayRows);
              return (
                <div key={day} className="mt-5">
                  <div className="flex items-baseline justify-between gap-2.5 px-0.5 pb-2">
                    <span className="text-ink-muted text-[11px] font-semibold tracking-[0.06em] uppercase">
                      {formatDate(day)}
                    </span>
                    <Money
                      value={dayTotal}
                      tone={dayTotal >= 0 ? 'income' : 'expense'}
                      className="text-[11.5px]"
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    {dayRows.map((t) => (
                      <div
                        key={t.id}
                        data-testid="transaction-row-mobile"
                        onClick={() => openDetail(t)}
                        className="border-line bg-paper-raised cursor-pointer rounded-2xl border p-3.5"
                      >
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="truncate text-[15.5px] font-semibold tracking-[-0.01em]">
                            {t.payee || t.categoryName || 'Transaction'}
                          </span>
                          <Money
                            value={t.amount}
                            tone={t.type === 'INCOME' ? 'income' : 'expense'}
                            className="shrink-0 text-[15.5px]"
                          />
                        </div>
                        <div className="mt-2.5 flex items-center justify-between gap-2.5">
                          <span className="text-ink-muted min-w-0 truncate text-xs">
                            {t.accountName}
                          </span>
                          {t.categoryName ? (
                            <span
                              className="shrink-0 rounded-full px-2.75 py-1 text-xs font-medium"
                              style={{
                                background: `color-mix(in srgb, ${categoryColorVar(t.categoryName)} 20%, var(--paper-raised))`,
                                color: categoryColorVar(t.categoryName),
                              }}
                            >
                              {t.categoryName}
                            </span>
                          ) : (
                            <span className="border-line bg-paper text-ink-muted shrink-0 rounded-full border border-dashed px-2.75 py-1.5 text-xs font-medium">
                              Uncategorized
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })
          )}
          {renderLoadMore('mobile')}
        </div>
      </div>

      <Drawer
        key={`dialog-${dialogKey}`}
        open={open}
        onClose={() => setOpen(false)}
        title="Add transaction"
      >
        <TransactionForm
          accounts={accounts}
          categories={categories}
          onDone={() => setOpen(false)}
        />
      </Drawer>

      <Drawer
        key={`drawer-${drawerKey}`}
        open={!!detail}
        onClose={() => setDetail(null)}
        title="Transaction"
      >
        {detail && (
          <>
            <div className="font-display mt-4 text-[22px] font-semibold tracking-[-0.02em]">
              {detail.payee || detail.categoryName || 'Transaction'}
            </div>
            <div className="mt-4.5">
              <TransactionForm
                transaction={detail}
                accounts={accounts}
                categories={categories}
                onDone={() => {
                  setDetail(null);
                  // an edit to a row past page 1 may leave the SSR page 1
                  // unchanged, so don't rely on the refresh to notice it
                  setReloadNonce((n) => n + 1);
                }}
              />
            </div>
            {detail.importBatchFilename && detail.importBatchId && (
              <Link
                href={`/import/history/${detail.importBatchId}`}
                className="text-iris mt-3 block text-sm hover:underline"
              >
                Imported from {detail.importBatchFilename}
              </Link>
            )}
            <button
              type="button"
              onClick={() => setConfirmDeleteId(detail.id)}
              className="border-line text-rose mt-2 flex w-full items-center justify-center gap-1.5 rounded-full border py-3 text-[14px]"
            >
              <Trash2 size={15} />
              Delete
            </button>
          </>
        )}
      </Drawer>
      <ConfirmDialog
        open={confirmDeleteId !== null}
        title="Delete transaction"
        description="Delete this transaction? This can't be undone."
        pending={deletePending}
        onConfirm={() => confirmDeleteId && handleDelete(confirmDeleteId)}
        onCancel={() => setConfirmDeleteId(null)}
      />
      <TransactionFiltersDialog
        key={`filters-${filtersDialogKey}`}
        open={filtersDialogOpen}
        onClose={() => setFiltersDialogOpen(false)}
        filters={filters}
        onApply={handleApplyFilters}
        accounts={accounts}
        categories={categories}
      />
      <MatchTransfersDialog
        key={`match-${matchDialogKey}`}
        open={matchDialogOpen}
        onClose={() => setMatchDialogOpen(false)}
        onConfirm={handleMatchTransfers}
        pending={matchPending}
      />

      <div
        className="border-line bg-paper-raised fixed inset-x-0 z-20 flex gap-2.5 border-t px-4.5 py-2.5 lg:hidden"
        style={{ bottom: 'calc(60px + env(safe-area-inset-bottom))' }}
      >
        <Link
          href="/import"
          className="border-line text-ink flex flex-1 items-center justify-center rounded-full border py-3 text-[14px] font-medium"
        >
          Import CSV
        </Link>
        <Link
          href="?overlay=add"
          className="bg-iris text-paper-raised focus-visible:outline-paper-raised flex flex-[1.3] items-center justify-center gap-2 rounded-full py-3 text-[14.5px] font-semibold focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <Plus size={16} /> Log a spend
        </Link>
      </div>
    </div>
  );
};
