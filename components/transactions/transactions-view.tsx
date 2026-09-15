'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeftRight, Plus, Search, Trash2, Upload } from 'lucide-react';
import { Drawer } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Money } from '@/components/ui/money';
import { Select } from '@/components/ui/field';
import { TransactionForm } from '@/components/transactions/transaction-form';
import { PeriodPicker, type PeriodMode } from '@/components/transactions/period-picker';
import { cn } from '@/lib/cn';
import {
  getCalendarMonthPeriod,
  getNextStatementPeriod,
  getPreviousStatementPeriod,
  getStatementPeriod,
  type Period,
} from '@/lib/statement';
import type { FrontendAccount } from '@/lib/services/accounts';
import type { FrontendCategory } from '@/lib/services/categories';
import type { FrontendTransaction } from '@/lib/services/transactions';
import { formatDate } from '@/lib/format';
import { categoryColorVar } from '@/lib/ui/category-color';

const pillSelect =
  'rounded-full border border-line bg-paper-raised px-3.5 py-2 text-[13px] font-medium text-ink outline-none focus:border-iris';

const toYyyymm = (date: Date): number => date.getUTCFullYear() * 100 + (date.getUTCMonth() + 1);

type QuickFilter = 'all' | 'uncategorized' | 'spending' | 'income';

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
  const [dialogKey, setDialogKey] = useState(0);
  const [open, setOpen] = useState(false);
  const [drawerKey, setDrawerKey] = useState(0);
  const [detail, setDetail] = useState<FrontendTransaction | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const [matchPending, setMatchPending] = useState(false);
  const [matchResult, setMatchResult] = useState<string | null>(null);
  const [accountFilter, setAccountFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [periodMode, setPeriodMode] = useState<PeriodMode>('ALL');
  const [periodAnchor, setPeriodAnchor] = useState(() => new Date());
  const [mobileSearch, setMobileSearch] = useState('');
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('all');

  const selectedAccount = accounts.find((a) => a.id === accountFilter);
  const canUseStatementView =
    selectedAccount?.type === 'CREDIT_CARD' && !!selectedAccount.statementDay;

  const handleAccountFilterChange = (value: string): void => {
    setAccountFilter(value);
    setPeriodMode('ALL');
    setPeriodAnchor(new Date());
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
    await fetch(`/api/transactions/${id}`, { method: 'DELETE' });
    setDeletePending(false);
    setConfirmDeleteId(null);
    setDetail(null);
    router.refresh();
  };

  const handleMatchTransfers = async (): Promise<void> => {
    setMatchPending(true);
    setMatchResult(null);
    const res = await fetch('/api/transactions/match-transfers', { method: 'POST' });
    setMatchPending(false);
    if (!res.ok) {
      setMatchResult('Could not match transfers. Try again.');
      return;
    }
    const data: { matched: number } = await res.json();
    setMatchResult(
      data.matched === 0
        ? 'No new transfer pairs found.'
        : `Matched ${data.matched} transfer pair${data.matched === 1 ? '' : 's'}.`,
    );
    router.refresh();
  };

  const filtered = initialTransactions.filter((t) => {
    if (accountFilter && t.accountId !== accountFilter) return false;
    if (categoryFilter && t.categoryId !== categoryFilter) return false;
    if (period) {
      const date = new Date(t.date);
      if (date < period.start || date >= period.end) return false;
    }
    return true;
  });

  // Payments toward a credit card's balance settle the *previous* statement,
  // and both legs of a transfer between the user's own accounts are money that
  // never left the ledger — so neither counts toward this period's
  // credit/debit/net; they're shown separately instead.
  const summary = filtered.reduce(
    (acc, t) => {
      const amount = Number(t.amount);
      // isPayment is checked first so a card payment keeps its existing
      // "Payments (excluded)" treatment once transfer matching also flags it
      if (t.isPayment) {
        acc.payments += amount;
      } else if (t.isTransfer) {
        acc.transfers += amount;
      } else if (t.type === 'INCOME') {
        acc.credit += amount;
      } else {
        acc.debit += amount;
      }
      return acc;
    },
    { credit: 0, debit: 0, payments: 0, transfers: 0 },
  );
  const net = summary.credit - summary.debit;

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

  const uncategorizedCount = filtered.filter((t) => !t.categoryId).length;
  const searchLower = mobileSearch.trim().toLowerCase();
  const mobileFiltered = filtered.filter((t) => {
    if (quickFilter === 'uncategorized' && t.categoryId) return false;
    if (quickFilter === 'spending' && t.type !== 'EXPENSE') return false;
    if (quickFilter === 'income' && t.type !== 'INCOME') return false;
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
        <Select
          className={cn(pillSelect, 'shrink-0')}
          value={accountFilter}
          onChange={(e) => handleAccountFilterChange(e.target.value)}
        >
          <option value="">All accounts</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
        <Select
          className={cn(pillSelect, 'shrink-0')}
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
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
          onClick={handleMatchTransfers}
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

      {accountFilter && (
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

      <div className="border-line bg-paper-raised mt-3.5 hidden items-start gap-3 rounded-[14px] border px-6 py-3.5 lg:flex lg:flex-row lg:items-center lg:justify-between lg:gap-6">
        <span className="text-ink-muted text-[12.5px] font-medium whitespace-nowrap">
          {filtered.length} transaction{filtered.length === 1 ? '' : 's'}
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
          {summary.payments > 0 && (
            <span className="border-line flex items-baseline gap-1.5 border-l-0 pl-0 lg:border-l lg:pl-6.5">
              <span className="text-ink-muted text-xs">Payments (excluded)</span>
              <Money value={summary.payments} tone="neutral" />
            </span>
          )}
          {summary.transfers > 0 && (
            <span className="border-line flex items-baseline gap-1.5 border-l-0 pl-0 lg:border-l lg:pl-6.5">
              <span className="text-ink-muted text-xs">Transfers (excluded)</span>
              <Money value={summary.transfers} tone="neutral" />
            </span>
          )}
        </div>
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
        <div className="border-line bg-paper-raised flex items-center gap-2.25 rounded-full border px-3.75 py-0">
          <Search size={15} className="text-ink-muted shrink-0" />
          <input
            type="text"
            value={mobileSearch}
            onChange={(e) => setMobileSearch(e.target.value)}
            placeholder="Search payee or amount"
            className="placeholder:text-ink-muted/70 min-h-[46px] flex-1 bg-transparent text-sm outline-none"
          />
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

        <p className="text-ink-muted mt-3.5 text-[12.5px]">
          {mobileFiltered.length} transaction{mobileFiltered.length === 1 ? '' : 's'} · transfers
          excluded
        </p>

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
