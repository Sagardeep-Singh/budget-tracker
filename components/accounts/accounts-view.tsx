'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/ui/modal';
import { AccountForm } from '@/components/accounts/account-form';
import { formatDate } from '@/lib/format';
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
    <div className="mt-6.5">
      {initialAccounts.length === 0 && (
        <p className="text-ink-muted mb-4 text-sm">
          No accounts yet. Add one to start logging transactions.
        </p>
      )}
      <div className="grid grid-cols-2 gap-4">
        {initialAccounts.map((account) => (
          <div key={account.id} className="border-line bg-paper-raised rounded-2xl border p-5.5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-display text-[17px] font-semibold">{account.name}</div>
                <div className="text-ink-muted mt-0.5 text-[12.5px]">
                  {TYPE_LABELS[account.type]}
                  {account.type === 'CREDIT_CARD' &&
                    account.statementDay &&
                    ` · statement day ${account.statementDay}`}
                </div>
              </div>
              <span className="bg-sky-soft text-sky rounded-full px-2.5 py-1 text-[11.5px] font-semibold">
                Active
              </span>
            </div>
            <div className="mt-4 font-mono text-[28px] tracking-[-0.03em] tabular-nums">
              ${Number(account.balance).toFixed(2)}
            </div>
            <div className="text-ink-muted mt-1 text-[12.5px]">
              Added {formatDate(account.createdAt)}
            </div>
            <div className="border-line mt-4.5 flex gap-2 border-t pt-4">
              <button
                type="button"
                onClick={() => openEdit(account)}
                className="border-line text-ink rounded-full border px-3.5 py-2 text-[13px]"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => handleDelete(account.id)}
                className="text-ink-muted px-1 py-2 text-[13px]"
              >
                Delete
              </button>
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={openCreate}
          className="border-line flex min-h-[190px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed"
        >
          <span className="text-ink-muted text-[26px] leading-none">+</span>
          <span className="text-ink-muted text-sm font-medium">Add an account</span>
        </button>
      </div>

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
