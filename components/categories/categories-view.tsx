'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import type { FrontendCategory } from '@/lib/services/categories';

export const CategoriesView = ({
  initialCategories,
}: {
  initialCategories: FrontendCategory[];
}): React.ReactElement => {
  const router = useRouter();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const handleAdd = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setPending(true);
    setError(null);
    const res = await fetch('/api/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    setPending(false);
    if (!res.ok) {
      setError('Could not add that category.');
      return;
    }
    setName('');
    router.refresh();
  };

  const handleDelete = async (id: string): Promise<void> => {
    if (!confirm('Delete this category? Transactions using it become uncategorized.')) return;
    await fetch(`/api/categories/${id}`, { method: 'DELETE' });
    router.refresh();
  };

  return (
    <div className="mt-6">
      <form onSubmit={handleAdd} className="mb-4 flex gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New category name"
          required
        />
        <Button type="submit" disabled={pending}>
          Add
        </Button>
      </form>
      {error && <p className="text-brick mb-4 text-sm">{error}</p>}

      <Card className="p-0">
        {initialCategories.map((category) => (
          <div key={category.id} className="ledger-row flex items-center justify-between px-6 py-3">
            <span className="text-ink text-sm">{category.name}</span>
            <button
              type="button"
              onClick={() => handleDelete(category.id)}
              className="text-ink-muted hover:text-brick text-xs"
            >
              Delete
            </button>
          </div>
        ))}
      </Card>
    </div>
  );
};
