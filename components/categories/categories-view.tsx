'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
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
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletePending, setDeletePending] = useState(false);

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
    setDeletePending(true);
    await fetch(`/api/categories/${id}`, { method: 'DELETE' });
    setDeletePending(false);
    setConfirmDeleteId(null);
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
        <Button type="submit" icon={Plus} loading={pending}>
          Add
        </Button>
      </form>
      {error && <p className="text-rose mb-4 text-sm">{error}</p>}

      <Card className="p-0">
        {initialCategories.map((category) => (
          <div key={category.id} className="ledger-row flex items-center justify-between px-6 py-3">
            <span className="text-ink text-sm">{category.name}</span>
            <button
              type="button"
              onClick={() => setConfirmDeleteId(category.id)}
              className="text-ink-muted hover:text-rose inline-flex items-center gap-1 text-xs"
            >
              <Trash2 size={14} />
              Delete
            </button>
          </div>
        ))}
      </Card>
      <ConfirmDialog
        open={confirmDeleteId !== null}
        title="Delete category"
        description="Delete this category? Transactions using it become uncategorized."
        pending={deletePending}
        onConfirm={() => confirmDeleteId && handleDelete(confirmDeleteId)}
        onCancel={() => setConfirmDeleteId(null)}
      />
    </div>
  );
};
