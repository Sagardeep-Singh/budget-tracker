'use client';

import { useState } from 'react';
import { Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/field';
import { ReimbursementPanel } from '@/components/transactions/reimbursement-panel';
import { useTransactionForm } from '@/lib/transactions/use-transaction-form';
import { cn } from '@/lib/cn';
import type { FrontendAccount } from '@/lib/services/accounts';
import type { FrontendCategory } from '@/lib/services/categories';
import type { FrontendTransaction } from '@/lib/services/transactions';

const todayIso = (): string => new Date().toISOString().slice(0, 10);

export const TransactionForm = ({
  transaction,
  accounts,
  categories,
  onDone,
}: {
  transaction?: FrontendTransaction;
  accounts: FrontendAccount[];
  categories: FrontendCategory[];
  onDone: () => void;
}): React.ReactElement => {
  const {
    categoryId,
    setCategoryId,
    suggested,
    setSuggested,
    type,
    setType,
    accountId,
    setAccountId,
    isPayment,
    setIsPayment,
    isTransfer,
    setIsTransfer,
    canBePayment,
    isReimbursable,
    setIsReimbursable,
    reimbursementExpectedAmount,
    setReimbursementExpectedAmount,
    canBeReimbursable,
    pending,
    error,
    suggestFor,
    submit,
  } = useTransactionForm({ transaction, accounts });

  const [amountValue, setAmountValue] = useState(transaction?.amount ?? '');
  const [expectedAmountError, setExpectedAmountError] = useState<string | null>(null);
  const hasReimbursementLinks = Number(transaction?.reimbursementLinkedTotal ?? 0) > 0;

  // Thin FormData → values adapter; all the logic lives in the shared hook so
  // the mobile keypad screen can't drift from it.
  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setExpectedAmountError(null);
    const form = new FormData(event.currentTarget);
    const amount = String(form.get('amount') ?? '');

    if (canBeReimbursable && isReimbursable) {
      const expected = Number(reimbursementExpectedAmount);
      if (!reimbursementExpectedAmount || Number.isNaN(expected) || expected <= 0) {
        setExpectedAmountError('Expected amount is required');
        return;
      }
      if (expected > Number(amount)) {
        setExpectedAmountError('Cannot exceed the expense amount');
        return;
      }
    }

    const ok = await submit({
      accountId: String(form.get('accountId') ?? ''),
      amount,
      date: String(form.get('date') ?? ''),
      payee: String(form.get('payee') ?? '') || undefined,
      note: String(form.get('note') ?? '') || undefined,
    });
    if (ok) onDone();
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="border-line flex items-baseline gap-2 border-b pb-3.5">
        <span className="text-ink-muted font-mono text-[26px]">$</span>
        <Input
          id="amount"
          name="amount"
          type="number"
          step="0.01"
          min="0.01"
          placeholder="0.00"
          defaultValue={transaction?.amount}
          onChange={(e) => setAmountValue(e.target.value)}
          required
          className="placeholder:text-ink-muted/50 border-0 bg-transparent p-0 font-mono text-[30px] tracking-[-0.03em] tabular-nums shadow-none outline-none focus:border-0"
        />
        <div className="flex shrink-0 gap-1.5">
          <button
            type="button"
            onClick={() => setType('EXPENSE')}
            className={cn(
              'rounded-full px-3 py-1.5 text-[12.5px] font-semibold',
              type === 'EXPENSE'
                ? 'bg-iris text-paper-raised'
                : 'border-line text-ink-muted border',
            )}
          >
            Spend
          </button>
          <button
            type="button"
            onClick={() => setType('INCOME')}
            className={cn(
              'rounded-full px-3 py-1.5 text-[12.5px] font-semibold',
              type === 'INCOME' ? 'bg-iris text-paper-raised' : 'border-line text-ink-muted border',
            )}
          >
            Income
          </button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="date">Date</Label>
          <Input
            id="date"
            name="date"
            type="date"
            defaultValue={transaction?.date?.slice(0, 10) ?? todayIso()}
            required
          />
        </div>
        <div>
          <Label htmlFor="accountId">Account</Label>
          <Select
            id="accountId"
            name="accountId"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            required
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </div>
      </div>
      {canBePayment && (
        <label className="text-ink flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={isPayment}
            onChange={(e) => setIsPayment(e.target.checked)}
            className="accent-iris h-4 w-4"
          />
          This is a payment toward the card&apos;s balance
          <span className="text-ink-muted text-xs">(excluded from the statement total)</span>
        </label>
      )}
      <label className="text-ink flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={isTransfer}
          onChange={(e) => setIsTransfer(e.target.checked)}
          className="accent-iris h-4 w-4"
        />
        This is a transfer between my own accounts
        <span className="text-ink-muted text-xs">(excluded from income and spending)</span>
      </label>
      {canBeReimbursable && (
        <div>
          <label className="text-ink flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isReimbursable}
              disabled={hasReimbursementLinks}
              onChange={(e) => setIsReimbursable(e.target.checked)}
              className="accent-iris h-4 w-4"
            />
            This expense will be paid back to me
            <span className="text-ink-muted text-xs">(excluded income when repaid)</span>
          </label>
          {hasReimbursementLinks && (
            <p className="text-ink-muted mt-1 pl-6 text-xs">
              Remove all links below to unmark this expense as reimbursable.
            </p>
          )}
          {isReimbursable && (
            <div className="mt-2 pl-6">
              <Label htmlFor="reimbursementExpectedAmount">Expected reimbursement</Label>
              <Input
                id="reimbursementExpectedAmount"
                name="reimbursementExpectedAmount"
                type="number"
                step="0.01"
                min="0.01"
                max={amountValue || undefined}
                value={reimbursementExpectedAmount}
                onChange={(e) => setReimbursementExpectedAmount(e.target.value)}
                required
              />
              {expectedAmountError && (
                <p className="text-rose mt-1 text-xs" role="alert">
                  {expectedAmountError}
                </p>
              )}
            </div>
          )}
          {transaction && isReimbursable && (
            <div className="mt-3">
              <ReimbursementPanel transaction={transaction} />
            </div>
          )}
        </div>
      )}
      <div>
        <Label htmlFor="payee">Payee</Label>
        <Input
          id="payee"
          name="payee"
          defaultValue={transaction?.payee ?? ''}
          onChange={(e) => suggestFor(e.target.value, '')}
        />
      </div>
      <div>
        <Label htmlFor="note">Note</Label>
        <Input
          id="note"
          name="note"
          defaultValue={transaction?.note ?? ''}
          onChange={(e) => suggestFor('', e.target.value)}
        />
      </div>
      <div>
        <Label htmlFor="categoryId">
          Category{suggested && <span className="text-iris ml-1">(suggested)</span>}
        </Label>
        <div id="categoryId" className="flex flex-wrap gap-1.5">
          {categories.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                setCategoryId(c.id === categoryId ? '' : c.id);
                setSuggested(false);
              }}
              className={cn(
                'rounded-full px-3.5 py-2 text-[13px] font-medium',
                c.id === categoryId
                  ? 'bg-iris text-paper-raised'
                  : 'border-line text-ink-muted border',
              )}
            >
              {c.name}
            </button>
          ))}
        </div>
      </div>
      {error && (
        <p className="bg-rose-soft text-rose rounded-lg px-3 py-2 text-sm" role="alert">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" icon={Check} loading={pending} className="flex-1 py-3 text-[15px]">
          {transaction ? 'Save changes' : 'Save transaction'}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={onDone}
          icon={X}
          className="px-4.5 py-3 text-[15px]"
        >
          Cancel
        </Button>
      </div>
    </form>
  );
};
