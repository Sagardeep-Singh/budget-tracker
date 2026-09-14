'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Check, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/field';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import type { FrontendCategoryRule } from '@/lib/services/categoryRules';
import type { FrontendCategory } from '@/lib/services/categories';

export const RulesView = ({
  initialRules,
  categories,
}: {
  initialRules: FrontendCategoryRule[];
  categories: FrontendCategory[];
}): React.ReactElement => {
  const router = useRouter();
  const [matchText, setMatchText] = useState('');
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? '');
  const [priority, setPriority] = useState('0');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPriority, setEditPriority] = useState('0');
  const [editPending, setEditPending] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const query = search.trim().toLowerCase();
  const visibleRules = useMemo(
    () =>
      query
        ? initialRules.filter(
            (r) =>
              r.matchText.toLowerCase().includes(query) ||
              r.categoryName.toLowerCase().includes(query),
          )
        : initialRules,
    [initialRules, query],
  );

  const handleAdd = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setPending(true);
    setError(null);
    const res = await fetch('/api/rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matchText, categoryId, priority }),
    });
    setPending(false);
    if (!res.ok) {
      setError('Could not add that rule.');
      return;
    }
    setMatchText('');
    router.refresh();
  };

  const handleDelete = async (id: string): Promise<void> => {
    setDeletePending(true);
    await fetch(`/api/rules/${id}`, { method: 'DELETE' });
    setDeletePending(false);
    setConfirmDeleteId(null);
    router.refresh();
  };

  const startEditPriority = (rule: FrontendCategoryRule): void => {
    setEditingId(rule.id);
    setEditPriority(String(rule.priority));
    setEditError(null);
  };

  const cancelEditPriority = (): void => {
    setEditingId(null);
    setEditError(null);
  };

  const saveEditPriority = async (id: string): Promise<void> => {
    if (editPriority.trim() === '') {
      setEditError('Priority is required.');
      return;
    }
    if (Number(editPriority) < 0) {
      setEditError('Priority cannot be negative.');
      return;
    }
    setEditPending(true);
    setEditError(null);
    const res = await fetch(`/api/rules/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ priority: editPriority }),
    });
    setEditPending(false);
    if (!res.ok) {
      setEditError('Could not update priority.');
      return;
    }
    setEditingId(null);
    router.refresh();
  };

  return (
    <div className="mt-6.5">
      {categories.length === 0 ? (
        <div className="border-line bg-paper-raised flex flex-col items-center gap-3 rounded-2xl border border-dashed p-8 text-center">
          <p className="text-ink-muted text-sm">
            You don&apos;t have any categories yet. Add one to start writing rules.
          </p>
          <Link
            href="/categories"
            className="bg-iris text-paper-raised focus-visible:outline-iris inline-flex cursor-pointer items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors duration-150 hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            <Plus size={16} />
            Add categories
          </Link>
        </div>
      ) : (
        <form
          onSubmit={handleAdd}
          className="border-line bg-paper-raised flex items-end gap-2.5 rounded-2xl border p-4.5"
        >
          <div className="flex-1">
            <label className="text-ink-muted mb-1.5 block text-[11px] font-semibold tracking-[0.06em] uppercase">
              When the description contains
            </label>
            <Input
              className="rounded-[9px]"
              value={matchText}
              onChange={(e) => setMatchText(e.target.value)}
              placeholder="e.g. superstore"
              required
            />
          </div>
          <div className="w-[200px]">
            <label className="text-ink-muted mb-1.5 block text-[11px] font-semibold tracking-[0.06em] uppercase">
              Categorize as
            </label>
            <Select
              className="rounded-[9px]"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              required
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="w-20">
            <label className="text-ink-muted mb-1.5 block text-[11px] font-semibold tracking-[0.06em] uppercase">
              Priority
            </label>
            <Input
              className="rounded-[9px] font-mono"
              type="number"
              min="0"
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
            />
          </div>
          <Button type="submit" icon={Plus} loading={pending} className="px-4.5 py-2.5">
            Add rule
          </Button>
        </form>
      )}
      {error && <p className="text-rose mt-2 text-sm">{error}</p>}

      {initialRules.length === 0 ? (
        categories.length > 0 && (
          <p className="text-ink-muted mt-6 text-sm">
            No rules yet. Everything falls back to no category.
          </p>
        )
      ) : (
        <>
          {initialRules.length > 10 && (
            <div className="relative mt-4.5">
              <Search
                size={15}
                className="text-ink-muted pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2"
              />
              <Input
                className="bg-paper-raised rounded-full pl-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by match text or category"
              />
            </div>
          )}
          <div className="border-line bg-paper-raised mt-4.5 rounded-2xl border px-6">
            <div className="border-line text-ink-muted flex items-center gap-5 border-b py-3.5 text-[11px] font-semibold tracking-[0.08em] uppercase">
              <span className="flex-1">Match</span>
              <span className="w-[150px]">Category</span>
              <span className="w-[118px] text-right">Priority</span>
              <span className="w-[90px] text-right">Applied</span>
              <span className="w-[60px]" />
            </div>
            {visibleRules.length === 0 ? (
              <p className="text-ink-muted py-6 text-center text-sm">
                No rules match &ldquo;{search}&rdquo;.
              </p>
            ) : (
              visibleRules.map((rule) => (
                <div key={rule.id} className="ledger-row flex items-center gap-5 py-3.5">
                  <span className="min-w-0 flex-1 font-mono text-[13px]">
                    contains &ldquo;{rule.matchText}&rdquo;
                  </span>
                  <span className="w-[150px]">
                    <span className="border-line text-ink-muted rounded-full border px-2.5 py-1 text-[12.5px]">
                      {rule.categoryName}
                    </span>
                  </span>
                  <span className="relative w-[118px] text-right">
                    {editingId === rule.id ? (
                      <span className="flex items-center justify-end gap-1">
                        <Input
                          className="w-14 shrink-0 rounded-[9px] px-2 py-1 text-right font-mono text-[13px]"
                          type="number"
                          min="0"
                          autoFocus
                          value={editPriority}
                          onChange={(e) => setEditPriority(e.target.value)}
                        />
                        <button
                          type="button"
                          onClick={() => saveEditPriority(rule.id)}
                          disabled={editPending}
                          className="text-sky hover:text-ink inline-flex items-center p-1 disabled:opacity-50"
                          aria-label="Save priority"
                        >
                          <Check size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={cancelEditPriority}
                          disabled={editPending}
                          className="text-ink-muted hover:text-ink inline-flex items-center p-1 disabled:opacity-50"
                          aria-label="Cancel edit"
                        >
                          <X size={14} />
                        </button>
                        {editError && (
                          <span className="text-rose bg-paper-raised border-line absolute top-full right-0 z-10 mt-1 w-max max-w-[200px] rounded-md border px-2 py-1 text-xs whitespace-normal">
                            {editError}
                          </span>
                        )}
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => startEditPriority(rule)}
                        className="text-ink-muted hover:text-iris inline-flex items-center gap-1 font-mono text-[13px] tabular-nums"
                        title="Lower number wins when more than one rule matches"
                      >
                        {rule.priority}
                        <Pencil size={11} />
                      </button>
                    )}
                  </span>
                  <span className="text-ink-muted w-[90px] text-right font-mono text-[13px] tabular-nums">
                    {rule.appliedCount}
                  </span>
                  <span className="w-[60px] text-right">
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(rule.id)}
                      className="text-ink-muted hover:text-rose inline-flex items-center gap-1 text-[12.5px]"
                    >
                      <Trash2 size={13} />
                      Delete
                    </button>
                  </span>
                </div>
              ))
            )}
          </div>
        </>
      )}
      <ConfirmDialog
        open={confirmDeleteId !== null}
        title="Delete rule"
        description="Delete this categorization rule? Transactions won't be recategorized automatically anymore for this match."
        pending={deletePending}
        onConfirm={() => confirmDeleteId && handleDelete(confirmDeleteId)}
        onCancel={() => setConfirmDeleteId(null)}
      />
    </div>
  );
};
