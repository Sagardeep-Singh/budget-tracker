'use client';

import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeftRight,
  HandCoins,
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
import { TransactionTotals } from '@/components/transactions/transaction-totals';
import { TransactionForm } from '@/components/transactions/transaction-form';
import { TransactionFiltersDialog } from '@/components/transactions/transaction-filters-dialog';
import { MatchTransfersDialog } from '@/components/transactions/match-transfers-dialog';
import { StatementPicker } from '@/components/transactions/period-picker';
import { cn } from '@/lib/cn';
import {
  countActiveFilterGroups,
  matchesTransactionFilters,
  parseTransactionFilters,
  transactionFiltersToSearchParams,
  type TransactionFilters,
} from '@/lib/transactions/transaction-filters';
import { summarizeTransactions } from '@/lib/transactions/transaction-summary';
import type { FrontendAccount } from '@/lib/services/accounts';
import type { FrontendCategory } from '@/lib/services/categories';
import type { FrontendTransaction } from '@/lib/services/transactions';
import { formatDate } from '@/lib/format';
import { categoryColorVar } from '@/lib/ui/category-color';

type QuickFilter = 'all' | 'uncategorized' | 'spending' | 'income';

/** The quick pills are shortcuts into the same `type` / `uncategorizedOnly`
 * filters the dialog edits, so the two can never disagree. A combination the
 * pills can't express (set from the dialog) leaves no pill highlighted. */
const QUICK_FILTERS: Record<QuickFilter, Pick<TransactionFilters, 'type' | 'uncategorizedOnly'>> = {
  all: { type: null, uncategorizedOnly: false },
  uncategorized: { type: null, uncategorizedOnly: true },
  spending: { type: 'EXPENSE', uncategorizedOnly: false },
  income: { type: 'INCOME', uncategorizedOnly: false },
};

const activeQuickFilter = (filters: TransactionFilters): QuickFilter | null =>
  (Object.keys(QUICK_FILTERS) as QuickFilter[]).find(
    (key) =>
      QUICK_FILTERS[key].type === filters.type &&
      QUICK_FILTERS[key].uncategorizedOnly === filters.uncategorizedOnly,
  ) ?? null;

const groupByDay = (list: FrontendTransaction[]): [string, FrontendTransaction[]][] => {
  const sorted = [...list].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const groups = new Map<string, FrontendTransaction[]>();
  for (const t of sorted) {
    const key = formatDate(t.date);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(t);
  }
  return Array.from(groups.entries()).reverse();
};

export const TransactionsView = ({
  initialTransactions,
  accounts,
  categories,
}: {
  initialTransactions: FrontendTransaction[];
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
  const [mobileSearch, setMobileSearch] = useState('');
  const [filtersDialogOpen, setFiltersDialogOpen] = useState(false);
  const [filtersDialogKey, setFiltersDialogKey] = useState(0);
  const [matchDialogOpen, setMatchDialogOpen] = useState(false);
  const [matchDialogKey, setMatchDialogKey] = useState(0);

  // The URL is the source of truth for every filter except the payee search
  // box (below) — re-derived on every searchParams change rather than
  // mirrored into separate component state, so there's one place filter
  // state can drift from the URL: nowhere.
  const filters = useMemo(() => parseTransactionFilters(searchParams), [searchParams]);
  const activeFilterCount = countActiveFilterGroups(filters);

  // Local, undebounced-to-the-list-but-debounced-to-the-URL: the list must
  // filter on every keystroke ("no Apply needed" per the feature's search
  // box), but writing to the URL on every keystroke would spam the router
  // and fight the user's own typing. `payeeDraft` drives filtering
  // immediately; the effect below only pushes it to the URL once typing
  // pauses.
  const [payeeDraft, setPayeeDraft] = useState(filters.payee);
  // Re-seeds `payeeDraft` when `filters.payee` changes from outside this
  // input (the filters dialog's "Reset", browser back/forward, a pasted
  // URL) — adjusted during render, React's documented pattern for syncing
  // state to a prop change, rather than in an effect (which would commit
  // the stale draft for one extra frame first).
  const [payeeSyncedFrom, setPayeeSyncedFrom] = useState(filters.payee);
  // The value we last pushed to the URL ourselves — when the URL's payee
  // catches up to exactly this, it's the echo of our own debounced push
  // completing, not an external change, and must not stomp on whatever the
  // user has kept typing in the meantime (this used to happen: the URL
  // round-trip for one keystroke could land after the user had already typed
  // several more, snapping the input back to the older value mid-word).
  const [lastPushedPayee, setLastPushedPayee] = useState(filters.payee);
  if (filters.payee !== payeeSyncedFrom) {
    setPayeeSyncedFrom(filters.payee);
    if (filters.payee !== lastPushedPayee) {
      setPayeeDraft(filters.payee);
    }
  }

  // The native History API, not `router.replace`: every filter here runs on
  // the client against `initialTransactions`, so a server round trip per
  // change only re-sent the whole ledger. With router.replace each debounced
  // search keystroke refetched the page, and the re-render when it landed
  // froze the search box mid-typing on a slow connection. Next keeps
  // `useSearchParams` in sync with replaceState.
  const pushFilters = useCallback(
    (next: TransactionFilters): void => {
      const query = transactionFiltersToSearchParams(next).toString();
      window.history.replaceState(null, '', query ? `${pathname}?${query}` : pathname);
    },
    [pathname],
  );

  useEffect(() => {
    if (payeeDraft === filters.payee) return;
    const timeout = setTimeout(() => {
      setLastPushedPayee(payeeDraft);
      pushFilters({ ...filters, payee: payeeDraft });
    }, 300);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run on payeeDraft changes; `filters`/`pushFilters` reacting here would restart the debounce on every unrelated filter change
  }, [payeeDraft]);

  const effectiveFilters = useMemo<TransactionFilters>(
    () => ({ ...filters, payee: payeeDraft }),
    [filters, payeeDraft],
  );
  // The inputs render from the live values; the (possibly long) list filters
  // on deferred copies, so a keystroke never waits on re-rendering every row.
  const listFilters = useDeferredValue(effectiveFilters);
  const deferredMobileSearch = useDeferredValue(mobileSearch);

  const selectedAccountId = filters.accountIds.length === 1 ? filters.accountIds[0] : null;
  const selectedAccount = accounts.find((a) => a.id === selectedAccountId);
  const isCreditCard = selectedAccount?.type === 'CREDIT_CARD';
  const quickFilter = activeQuickFilter(filters);

  const openFiltersDialog = (): void => {
    setFiltersDialogKey((k) => k + 1);
    setFiltersDialogOpen(true);
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
    await fetch(`/api/transactions/${id}`, { method: 'DELETE' });
    setDeletePending(false);
    setConfirmDeleteId(null);
    setDetail(null);
    router.refresh();
  };

  const openMatchDialog = (): void => {
    setMatchDialogKey((k) => k + 1);
    setMatchDialogOpen(true);
  };

  const handleMatchTransfers = async (range: { from: Date; to: Date }): Promise<void> => {
    setMatchPending(true);
    setMatchResult(null);
    const res = await fetch('/api/transactions/match-transfers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(range),
    });
    setMatchPending(false);
    if (!res.ok) {
      setMatchResult('Could not match transfers. Try again.');
      return;
    }
    setMatchDialogOpen(false);
    const data: { matched: number } = await res.json();
    setMatchResult(
      data.matched === 0
        ? 'No new transfer pairs found.'
        : `Matched ${data.matched} transfer pair${data.matched === 1 ? '' : 's'}.`,
    );
    router.refresh();
  };

  const filtered = initialTransactions.filter((t) => matchesTransactionFilters(t, listFilters));

  const summary = summarizeTransactions(filtered);

  // Sorted oldest-first so a running balance across the filtered set reads
  // naturally top-to-bottom; the day groups below reverse this for display
  // (newest day first, per the design), but each day's own rows stay in
  // the ascending order the balance was computed in.
  const sortedAsc = [...filtered].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );
  const runningBalance = new Map<string, number>();
  let balance = 0;
  for (const t of sortedAsc) {
    balance += t.type === 'INCOME' ? Number(t.amount) : -Number(t.amount);
    runningBalance.set(t.id, balance);
  }

  const days = groupByDay(filtered);

  // Counted without the pill-controlled filters, so the badge doesn't drop
  // to its own subset (or to zero) when Spending/Income is selected.
  const uncategorizedCount = initialTransactions.filter(
    (t) => !t.categoryId && matchesTransactionFilters(t, { ...listFilters, ...QUICK_FILTERS.all }),
  ).length;
  const searchLower = deferredMobileSearch.trim().toLowerCase();
  const mobileFiltered = filtered.filter((t) => {
    if (!searchLower) return true;
    return (
      (t.payee ?? '').toLowerCase().includes(searchLower) ||
      Number(t.amount).toFixed(2).includes(searchLower)
    );
  });
  const mobileDays = groupByDay(mobileFiltered);

  return (
    <div className="mt-6.5 pb-20 lg:pb-0">
      {/* Desktop-only filter row; the mobile screen gets its own search +
          quick-filter pills below, matching the mockup. */}
      <div
        data-testid="transaction-filters-desktop"
        className="hidden items-center gap-2 lg:flex lg:flex-wrap"
      >
        <div className="border-line bg-paper-raised flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-2">
          <Search size={15} className="text-ink-muted shrink-0" />
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

      {isCreditCard && (
        <div className="mt-3">
          {selectedAccount.statementDay ? (
            <StatementPicker
              statementDay={selectedAccount.statementDay}
              range={{ from: filters.from, to: filters.to }}
              onSelect={(range) => pushFilters({ ...filters, ...range })}
            />
          ) : (
            <p className="text-ink-muted text-xs">
              Set a statement day on this account to view by statement.
            </p>
          )}
        </div>
      )}

      <div className="mt-3.5 hidden lg:block">
        <TransactionTotals summary={summary} />
      </div>

      <div className="hidden lg:block">
        {filtered.length === 0 ? (
          <p className="text-ink-muted mt-6 text-sm">
            No transactions match. Log one to get started.
          </p>
        ) : (
          days.map(([dateLabel, rows]) => {
            const dayTotal = rows.reduce(
              (sum, t) => sum + (t.type === 'INCOME' ? Number(t.amount) : -Number(t.amount)),
              0,
            );
            return (
              <div key={dateLabel} className="mt-5.5">
                <div className="flex items-baseline gap-3 px-0.5 pb-2">
                  <span className="text-ink-muted font-mono text-xs tracking-[0.06em]">
                    {dateLabel}
                  </span>
                  <span className="bg-line h-px flex-1" />
                  <span
                    className={cn('font-mono text-xs', dayTotal >= 0 ? 'text-sky' : 'text-rose')}
                  >
                    {dayTotal >= 0 ? '+' : '−'}
                    {Math.abs(dayTotal).toFixed(2)}
                  </span>
                </div>
                <div className="border-line bg-paper-raised rounded-[14px] border px-6">
                  {[...rows].reverse().map((t) => (
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
                      <span className="text-ink-muted hidden w-[86px] shrink-0 text-right font-mono text-xs tabular-nums lg:block">
                        {(runningBalance.get(t.id) ?? 0).toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="lg:hidden">
        <div className="flex items-center gap-2">
          <div className="border-line bg-paper-raised flex flex-1 items-center gap-2.25 rounded-full border px-3.75 py-0">
            <Search size={15} className="text-ink-muted shrink-0" />
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
              onClick={() => pushFilters({ ...filters, ...QUICK_FILTERS[key] })}
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

        <TransactionTotals summary={summarizeTransactions(mobileFiltered)} className="mt-3.5" />

        {mobileFiltered.length === 0 ? (
          <p className="text-ink-muted mt-6 text-sm">
            No transactions match. Log one to get started.
          </p>
        ) : (
          mobileDays.map(([dateLabel, rows]) => {
            const dayTotal = rows.reduce(
              (sum, t) => sum + (t.type === 'INCOME' ? Number(t.amount) : -Number(t.amount)),
              0,
            );
            return (
              <div key={dateLabel} className="mt-5">
                <div className="flex items-baseline justify-between gap-2.5 px-0.5 pb-2">
                  <span className="text-ink-muted text-[11px] font-semibold tracking-[0.06em] uppercase">
                    {dateLabel}
                  </span>
                  <Money
                    value={dayTotal}
                    tone={dayTotal >= 0 ? 'income' : 'expense'}
                    className="text-[11.5px]"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  {[...rows].reverse().map((t) => (
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
                onDone={() => setDetail(null)}
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
        onApply={pushFilters}
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
