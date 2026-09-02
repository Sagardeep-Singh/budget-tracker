'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { Money } from '@/components/ui/money';
import { AccountForm } from '@/components/accounts/account-form';
import type { FrontendAccount } from '@/lib/services/accounts';

const TYPE_LABELS: Record<string, string> = {
  CHECKING: 'Checking',
  SAVINGS: 'Savings',
  CREDIT_CARD: 'Credit card',
  CASH: 'Cash',
};

export const AccountsView = ({
  initialAccounts,
}: {
  initialAccounts: FrontendAccount[];
}): React.ReactElement => {
  const router = useRouter();
  const [dialogKey, setDialogKey] = useState(0);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<FrontendAccount | undefined>(undefined);

  const openCreate = (): void => {
    setEditing(undefined);
    setDialogKey((k) => k + 1);
    setOpen(true);
  };

  const openEdit = (account: FrontendAccount): void => {
    setEditing(account);
    setDialogKey((k) => k + 1);
    setOpen(true);
  };

  const handleDelete = async (id: string): Promise<void> => {
    if (!confirm('Delete this account and all its transactions?')) return;
    await fetch(`/api/accounts/${id}`, { method: 'DELETE' });
    router.refresh();
  };

  return (
    <div className="mt-6">
      <div className="mb-3 flex justify-end">
        <Button onClick={openCreate}>Add account</Button>
      </div>
      <Card className="p-0">
        {initialAccounts.length === 0 ? (
          <p className="text-ink-muted p-6 text-sm">
            No accounts yet. Add one to start logging transactions.
          </p>
        ) : (
          initialAccounts.map((account) => (
            <div
              key={account.id}
              className="ledger-row flex items-center justify-between px-6 py-4"
            >
              <div>
                <div className="text-ink font-medium">{account.name}</div>
                <div className="text-ink-muted text-xs">{TYPE_LABELS[account.type]}</div>
              </div>
              <div className="flex items-center gap-4">
                <Money value={account.balance} tone="neutral" className="text-base" />
                <button
                  type="button"
                  onClick={() => openEdit(account)}
                  className="text-ink-muted hover:text-teal text-xs"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(account.id)}
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
        title={editing ? 'Edit account' : 'Add account'}
      >
        <AccountForm account={editing} onDone={() => setOpen(false)} />
      </Modal>
    </div>
  );
};
