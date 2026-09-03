'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/field';
import { BudgetBar } from '@/components/budgets/budget-bar';
import type { FrontendBudget } from '@/lib/services/budgets';
import type { FrontendCategory } from '@/lib/services/categories';

export const BudgetsView = ({
  initialBudgets,
  categories,
  month,
}: {
  initialBudgets: FrontendBudget[];
  categories: FrontendCategory[];
  month: number;
}): React.ReactElement => {
  const router = useRouter();
  const budgetedCategoryIds = new Set(initialBudgets.map((b) => b.categoryId));
  const available = categories.filter((c) => !budgetedCategoryIds.has(c.id));

  const [categoryId, setCategoryId] = useState(available[0]?.id ?? '');
  const [limitAmount, setLimitAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const handleAdd = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setPending(true);
    setError(null);
    const res = await fetch('/api/budgets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ categoryId, limitAmount, month }),
    });
    setPending(false);
    if (!res.ok) {
      setError('Could not set that budget. It may already exist for this month.');
      return;
    }
    setLimitAmount('');
    router.refresh();
  };

  const handleDelete = async (id: string): Promise<void> => {
    await fetch(`/api/budgets/${id}`, { method: 'DELETE' });
    router.refresh();
  };

  return (
    <div className="mt-6">
      {available.length > 0 && (
        <Card className="mb-4">
          <form onSubmit={handleAdd} className="grid grid-cols-[1fr_auto_auto] items-end gap-2">
            <div>
              <label className="text-ink-muted mb-1 block text-xs font-medium">Category</label>
              <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} required>
                {available.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="w-32">
              <label className="text-ink-muted mb-1 block text-xs font-medium">Monthly limit</label>
              <Input
                type="number"
                step="0.01"
                value={limitAmount}
                onChange={(e) => setLimitAmount(e.target.value)}
                required
              />
            </div>
            <Button type="submit" disabled={pending}>
              Set budget
            </Button>
          </form>
          {error && <p className="text-brick mt-2 text-sm">{error}</p>}
        </Card>
      )}

      {initialBudgets.length === 0 ? (
        <Card>
          <p className="text-ink-muted text-sm">No budgets set for this month yet.</p>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {initialBudgets.map((budget) => (
            <Card key={budget.id}>
              <BudgetBar budget={budget} />
              <button
                type="button"
                onClick={() => handleDelete(budget.id)}
                className="text-ink-muted hover:text-brick mt-3 text-xs"
              >
                Remove budget
              </button>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};
