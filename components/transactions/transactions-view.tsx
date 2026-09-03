'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { Money } from '@/components/ui/money';
import { Select } from '@/components/ui/field';
import { TransactionForm } from '@/components/transactions/transaction-form';
import { PeriodPicker, type PeriodMode } from '@/components/transactions/period-picker';
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

  return (
    <div className="mt-6">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex gap-2">
          <Select value={accountFilter} onChange={(e) => handleAccountFilterChange(e.target.value)}>
            <option value="">All accounts</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
          <Select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex gap-2">
          <Link href="/import">
            <Button variant="secondary">Import CSV</Button>
          </Link>
          <Button onClick={openCreate}>Add transaction</Button>
        </div>
      </div>

      {accountFilter && (
        <div className="mb-3">
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

      <Card className="p-0">
        {filtered.length === 0 ? (
          <p className="text-ink-muted p-6 text-sm">
            No transactions match. Log one to get started.
          </p>
        ) : (
          filtered.map((t) => (
            <div key={t.id} className="ledger-row flex items-center justify-between px-6 py-3">
              <div className="min-w-0">
                <div className="text-ink truncate text-sm font-medium">
                  {t.payee || t.categoryName || 'Transaction'}
                </div>
                <div className="text-ink-muted text-xs">
                  {new Date(t.date).toLocaleDateString()} · {t.accountName} ·{' '}
                  {t.categoryName ?? 'Uncategorized'}
                </div>
              </div>
              <div className="flex items-center gap-4">
                <Money value={t.amount} tone={t.type === 'INCOME' ? 'income' : 'expense'} />
                <button
                  type="button"
                  onClick={() => openEdit(t)}
                  className="text-ink-muted hover:text-teal text-xs"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(t.id)}
                  className="text-ink-muted hover:text-brick text-xs"
                >
                  Delete
                </button>
              </div>
            </div>
          ))
        )}
      </Card>

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
