'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Input, Label, Select } from '@/components/ui/field';
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
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [categoryId, setCategoryId] = useState(transaction?.categoryId ?? '');
  const [suggested, setSuggested] = useState(false);
  const [type, setType] = useState(transaction?.type ?? 'EXPENSE');
  const [accountId, setAccountId] = useState(transaction?.accountId ?? accounts[0]?.id ?? '');
  const [isPayment, setIsPayment] = useState(transaction?.isPayment ?? false);

  const selectedAccount = accounts.find((a) => a.id === accountId);
  const canBePayment = type === 'INCOME' && selectedAccount?.type === 'CREDIT_CARD';
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const suggestFor = (payee: string, note: string): void => {
    if (transaction || categoryId) return; // don't override an explicit choice or existing edit
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const text = `${payee} ${note}`.trim();
      if (!text) return;
      const res = await fetch('/api/categorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data.categoryId) {
        setCategoryId(data.categoryId);
        setSuggested(true);
      }
    }, 400);
  };

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setPending(true);
    setError(null);

    const form = new FormData(event.currentTarget);
    const body = {
      accountId: form.get('accountId'),
      categoryId: categoryId || null,
      amount: form.get('amount'),
      type: form.get('type'),
      date: form.get('date'),
      payee: form.get('payee') || undefined,
      note: form.get('note') || undefined,
      isPayment: canBePayment && isPayment,
    };

    const res = await fetch(
      transaction ? `/api/transactions/${transaction.id}` : '/api/transactions',
      {
        method: transaction ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );

    setPending(false);
    if (!res.ok) {
      setError('Could not save this transaction. Check the fields and try again.');
      return;
    }

    router.refresh();
    onDone();
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <input type="hidden" name="type" value={type} />
      <div className="border-line flex items-baseline gap-2 border-b pb-3.5">
        <span className="text-ink-muted font-mono text-[26px]">$</span>
        <Input
          id="amount"
          name="amount"
          type="number"
          step="0.01"
          min="0.01"
          defaultValue={transaction?.amount}
          required
          className="border-0 bg-transparent p-0 font-mono text-[30px] tracking-[-0.03em] tabular-nums shadow-none outline-none focus:border-0"
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
        <button
          type="submit"
          disabled={pending}
          className="bg-iris text-paper-raised flex-1 rounded-full py-3 text-[15px] font-semibold disabled:opacity-50"
        >
          {pending ? 'Saving…' : transaction ? 'Save changes' : 'Save transaction'}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="border-line text-ink-muted rounded-full border px-4.5 py-3 text-[15px]"
        >
          Cancel
        </button>
      </div>
    </form>
  );
};
