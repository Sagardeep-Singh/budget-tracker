'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/field';
import type { FrontendAccount } from '@/lib/services/accounts';

const ACCOUNT_TYPES = [
  { value: 'CHECKING', label: 'Checking' },
  { value: 'SAVINGS', label: 'Savings' },
  { value: 'CREDIT_CARD', label: 'Credit card' },
  { value: 'CASH', label: 'Cash' },
] as const;

export const AccountForm = ({
  account,
  onDone,
}: {
  account?: FrontendAccount;
  onDone: () => void;
}): React.ReactElement => {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setPending(true);
    setError(null);

    const form = new FormData(event.currentTarget);
    const body = {
      name: form.get('name'),
      type: form.get('type'),
      startingBalance: form.get('startingBalance'),
    };

    const res = await fetch(account ? `/api/accounts/${account.id}` : '/api/accounts', {
      method: account ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    setPending(false);
    if (!res.ok) {
      setError('Could not save this account. Check the fields and try again.');
      return;
    }

    router.refresh();
    onDone();
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div>
        <Label htmlFor="name">Name</Label>
        <Input id="name" name="name" defaultValue={account?.name} required autoFocus />
      </div>
      <div>
        <Label htmlFor="type">Type</Label>
        <Select id="type" name="type" defaultValue={account?.type ?? 'CHECKING'}>
          {ACCOUNT_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="startingBalance">Starting balance</Label>
        <Input
          id="startingBalance"
          name="startingBalance"
          type="number"
          step="0.01"
          defaultValue={account?.startingBalance ?? '0'}
        />
      </div>
      {error && (
        <p className="bg-brick-soft text-brick rounded-lg px-3 py-2 text-sm" role="alert">
          {error}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? 'Saving…' : account ? 'Save changes' : 'Add account'}
      </Button>
    </form>
  );
};
