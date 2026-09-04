'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/ui/modal';
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

const pillSelect =
  'rounded-full border border-line bg-paper-raised px-3.5 py-2 text-[13px] font-medium text-ink outline-none focus:border-iris';

const toYyyymm = (date: Date): number => date.getUTCFullYear() * 100 + (date.getUTCMonth() + 1);

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
  const [editing, setEditing] = useState<FrontendTransaction | undefined>(undefined);
  const [accountFilter, setAccountFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [periodMode, setPeriodMode] = useState<PeriodMode>('ALL');
  const [periodAnchor, setPeriodAnchor] = useState(() => new Date());

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
    setEditing(undefined);
    setDialogKey((k) => k + 1);
    setOpen(true);
  };

  const openEdit = (tx: FrontendTransaction): void => {
    setEditing(tx);
    setDialogKey((k) => k + 1);
    setOpen(true);
  };

  const handleDelete = async (id: string): Promise<void> => {
    if (!confirm('Delete this transaction?')) return;
    await fetch(`/api/transactions/${id}`, { method: 'DELETE' });
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
  // so they're excluded from this period's credit/debit/net and shown
  // separately instead.
  const summary = filtered.reduce(
    (acc, t) => {
      const amount = Number(t.amount);
      if (t.isPayment) {
        acc.payments += amount;
      } else if (t.type === 'INCOME') {
        acc.credit += amount;
      } else {
        acc.debit += amount;
      }
      return acc;
    },
    { credit: 0, debit: 0, payments: 0 },
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

  const dayGroups = new Map<string, FrontendTransaction[]>();
  for (const t of sortedAsc) {
    const key = formatDate(t.date);
    if (!dayGroups.has(key)) dayGroups.set(key, []);
    dayGroups.get(key)!.push(t);
  }
  const days = Array.from(dayGroups.entries()).reverse();

  return (
    <div className="mt-6.5">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          className={pillSelect}
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
          className={pillSelect}
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
        <div className="flex-1" />
        <Link href="/import" className="border-line text-ink rounded-full border px-4 py-2 text-sm">
          Import CSV
        </Link>
        <button
          type="button"
          onClick={openCreate}
          className="bg-iris text-paper-raised rounded-full px-4 py-2 text-sm font-semibold"
        >
          Add transaction
        </button>
      </div>

      {accountFilter && (
        <div className="mt-3">
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

      <div className="border-line bg-paper-raised mt-3.5 flex items-center justify-between gap-6 rounded-[14px] border px-6 py-3.5">
        <span className="text-ink-muted text-[12.5px] font-medium whitespace-nowrap">
          {filtered.length} transaction{filtered.length === 1 ? '' : 's'}
          {period ? ' in this period' : ''}
        </span>
        <div className="flex items-center gap-6.5 text-[13.5px]">
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
          <span className="border-line flex items-baseline gap-1.5 border-l pl-6.5">
            <span className="text-ink-muted text-xs">Net</span>
            <span className={cn('font-mono tabular-nums', net >= 0 ? 'text-sky' : 'text-rose')}>
              {net >= 0 ? '+' : '−'}
              {Math.abs(net).toFixed(2)}
            </span>
          </span>
          {summary.payments > 0 && (
            <span className="border-line flex items-baseline gap-1.5 border-l pl-6.5">
              <span className="text-ink-muted text-xs">Payments (excluded)</span>
              <Money value={summary.payments} tone="neutral" />
            </span>
          )}
        </div>
      </div>

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
                <span className={cn('font-mono text-xs', dayTotal >= 0 ? 'text-sky' : 'text-rose')}>
                  {dayTotal >= 0 ? '+' : '−'}
                  {Math.abs(dayTotal).toFixed(2)}
                </span>
              </div>
              <div className="border-line bg-paper-raised rounded-[14px] border px-6">
                {[...rows].reverse().map((t) => (
                  <div
                    key={t.id}
                    onClick={() => openEdit(t)}
                    className="ledger-row flex cursor-pointer items-center gap-5 py-3.5"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">
                        {t.payee || t.categoryName || 'Transaction'}
                      </div>
                      <div className="text-ink-muted mt-0.5 text-xs">{t.accountName}</div>
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
                        'w-[100px] shrink-0 text-right font-mono text-sm tabular-nums',
                        t.type === 'INCOME' ? 'text-sky' : 'text-rose',
                      )}
                    >
                      {t.type === 'INCOME' ? '+' : '−'}
                      {Number(t.amount).toFixed(2)}
                    </span>
                    <span className="text-ink-muted w-[86px] shrink-0 text-right font-mono text-xs tabular-nums">
                      {(runningBalance.get(t.id) ?? 0).toFixed(2)}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(t.id);
                      }}
                      className="text-ink-muted hover:text-rose shrink-0 text-xs"
                    >
                      Delete
                    </button>
                  </div>
                ))}
              </div>
            </div>
          );
        })
      )}

      <Modal
        key={dialogKey}
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? 'Edit transaction' : 'Add transaction'}
      >
        <TransactionForm
          transaction={editing}
          accounts={accounts}
          categories={categories}
          onDone={() => setOpen(false)}
        />
      </Modal>
    </div>
  );
};
