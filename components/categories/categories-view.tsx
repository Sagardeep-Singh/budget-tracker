'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Pencil, Plus, Trash2, X } from 'lucide-react';
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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editPending, setEditPending] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const startEdit = (category: FrontendCategory): void => {
    setEditingId(category.id);
    setEditName(category.name);
    setEditError(null);
  };

  const cancelEdit = (): void => {
    setEditingId(null);
    setEditError(null);
  };

  const handleEditSave = async (id: string): Promise<void> => {
    setEditPending(true);
    setEditError(null);
    const res = await fetch(`/api/categories/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: editName }),
    });
    setEditPending(false);
    if (!res.ok) {
      setEditError('Could not rename that category.');
      return;
    }
    setEditingId(null);
    router.refresh();
  };

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
          className="bg-paper-raised"
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
        {initialCategories.map((category) =>
          editingId === category.id ? (
            <div
              key={category.id}
              className="ledger-row flex items-center justify-between gap-2 px-6 py-2.5"
            >
              <Input
                className="bg-paper-raised"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                autoFocus
                required
              />
              <button
                type="button"
                onClick={() => handleEditSave(category.id)}
                disabled={editPending}
                className="text-sky hover:text-ink inline-flex items-center p-1.5 disabled:opacity-50"
                aria-label="Save category name"
              >
                <Check size={16} />
              </button>
              <button
                type="button"
                onClick={cancelEdit}
                disabled={editPending}
                className="text-ink-muted hover:text-ink inline-flex items-center p-1.5 disabled:opacity-50"
                aria-label="Cancel edit"
              >
                <X size={16} />
              </button>
            </div>
          ) : (
            <div
              key={category.id}
              className="ledger-row flex items-center justify-between px-6 py-3"
            >
              <span className="text-ink text-sm">{category.name}</span>
              <span className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => startEdit(category)}
                  className="text-ink-muted hover:text-iris inline-flex items-center gap-1 text-xs"
                >
                  <Pencil size={14} />
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDeleteId(category.id)}
                  className="text-ink-muted hover:text-rose inline-flex items-center gap-1 text-xs"
                >
                  <Trash2 size={14} />
                  Delete
                </button>
              </span>
            </div>
          ),
        )}
      </Card>
      {editError && <p className="text-rose mt-3 text-sm">{editError}</p>}
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
