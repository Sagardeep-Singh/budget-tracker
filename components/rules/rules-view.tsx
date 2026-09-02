'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
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
    <div className="mt-6">
      <Card className="mb-4">
        <form onSubmit={handleAdd} className="grid grid-cols-[1fr_1fr_auto_auto] items-end gap-2">
          <div>
            <label className="text-ink-muted mb-1 block text-xs font-medium">Contains</label>
            <Input
              value={matchText}
              onChange={(e) => setMatchText(e.target.value)}
              placeholder="e.g. STARBUCKS"
              required
            />
          </div>
          <div>
            <label className="text-ink-muted mb-1 block text-xs font-medium">Category</label>
            <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} required>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="w-20">
            <label className="text-ink-muted mb-1 block text-xs font-medium">Priority</label>
            <Input type="number" value={priority} onChange={(e) => setPriority(e.target.value)} />
          </div>
          <Button type="submit" disabled={pending}>
            Add rule
          </Button>
        </form>
        {error && <p className="text-brick mt-2 text-sm">{error}</p>}
      </Card>

      <Card className="p-0">
        {initialRules.length === 0 ? (
          <p className="text-ink-muted p-6 text-sm">
            No rules yet. Everything falls back to no category.
          </p>
        ) : (
          initialRules.map((rule) => (
            <div key={rule.id} className="ledger-row flex items-center justify-between px-6 py-3">
              <div className="text-ink text-sm">
                <span className="font-money text-ink-muted">#{rule.priority}</span>{' '}
                <span className="font-medium">&ldquo;{rule.matchText}&rdquo;</span> →{' '}
                {rule.categoryName}
              </div>
              <button
                type="button"
                onClick={() => handleDelete(rule.id)}
                className="text-ink-muted hover:text-brick text-xs"
              >
                Delete
              </button>
            </div>
          ))
        )}
      </Card>
    </div>
  );
};
