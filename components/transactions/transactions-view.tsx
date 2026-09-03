'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { Money } from '@/components/ui/money';
import { Select } from '@/components/ui/field';
import { TransactionForm } from '@/components/transactions/transaction-form';
import type { FrontendAccount } from '@/lib/services/accounts';
import type { FrontendCategory } from '@/lib/services/categories';
import type { FrontendTransaction } from '@/lib/services/transactions';

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

  const filtered = initialTransactions.filter(
    (t) =>
      (!accountFilter || t.accountId === accountFilter) &&
      (!categoryFilter || t.categoryId === categoryFilter),
  );

  return (
    <div className="mt-6">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex gap-2">
          <Select value={accountFilter} onChange={(e) => setAccountFilter(e.target.value)}>
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
