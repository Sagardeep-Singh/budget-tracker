'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/field';
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
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="type">Type</Label>
          <Select id="type" name="type" defaultValue={transaction?.type ?? 'EXPENSE'}>
            <option value="EXPENSE">Expense</option>
            <option value="INCOME">Income</option>
          </Select>
        </div>
        <div>
          <Label htmlFor="amount">Amount</Label>
          <Input
            id="amount"
            name="amount"
            type="number"
            step="0.01"
            min="0.01"
            defaultValue={transaction?.amount}
            required
          />
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
          <Select id="accountId" name="accountId" defaultValue={transaction?.accountId} required>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </div>
      </div>
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
          Category{suggested && <span className="text-teal ml-1">(suggested)</span>}
        </Label>
        <Select
          id="categoryId"
          value={categoryId}
          onChange={(e) => {
            setCategoryId(e.target.value);
            setSuggested(false);
          }}
        >
          <option value="">Uncategorized</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </div>
      {error && (
        <p className="bg-brick-soft text-brick rounded-lg px-3 py-2 text-sm" role="alert">
          {error}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? 'Saving…' : transaction ? 'Save changes' : 'Add transaction'}
      </Button>
    </form>
  );
};
