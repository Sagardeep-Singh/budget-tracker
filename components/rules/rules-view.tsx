'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Input, Select } from '@/components/ui/field';
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
    await fetch(`/api/rules/${id}`, { method: 'DELETE' });
    router.refresh();
  };

  return (
    <div className="mt-6.5">
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
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
          />
        </div>
        <button
          type="submit"
          disabled={pending}
          className="bg-iris text-paper-raised rounded-full px-4.5 py-2.5 text-sm font-semibold disabled:opacity-50"
        >
          Add rule
        </button>
      </form>
      {error && <p className="text-rose mt-2 text-sm">{error}</p>}

      {initialRules.length === 0 ? (
        <p className="text-ink-muted mt-6 text-sm">
          No rules yet. Everything falls back to no category.
        </p>
      ) : (
        <div className="border-line bg-paper-raised mt-4.5 rounded-2xl border px-6">
          <div className="border-line text-ink-muted flex items-center gap-5 border-b py-3.5 text-[11px] font-semibold tracking-[0.08em] uppercase">
            <span className="flex-1">Match</span>
            <span className="w-[150px]">Category</span>
            <span className="w-[110px] text-right">Applied</span>
            <span className="w-[60px]" />
          </div>
          {initialRules.map((rule) => (
            <div key={rule.id} className="ledger-row flex items-center gap-5 py-3.5">
              <span className="min-w-0 flex-1 font-mono text-[13px]">
                contains &ldquo;{rule.matchText}&rdquo;
              </span>
              <span className="w-[150px]">
                <span className="border-line text-ink-muted rounded-full border px-2.5 py-1 text-[12.5px]">
                  {rule.categoryName}
                </span>
              </span>
              <span className="text-ink-muted w-[110px] text-right font-mono text-[13px] tabular-nums">
                {rule.appliedCount}
              </span>
              <span className="w-[60px] text-right">
                <button
                  type="button"
                  onClick={() => handleDelete(rule.id)}
                  className="text-ink-muted text-[12.5px]"
                >
                  Delete
                </button>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
