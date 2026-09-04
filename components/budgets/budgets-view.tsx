'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Input, Select } from '@/components/ui/field';
import { Ring } from '@/components/ui/ring';
import { cn } from '@/lib/cn';
import type { FrontendBudget } from '@/lib/services/budgets';
import type { FrontendCategory } from '@/lib/services/categories';

const daysInMonth = (month: number): number => {
  const year = Math.floor(month / 100);
  const monthIndex = (month % 100) - 1;
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
};

const paceText = (limit: number, spent: number, month: number): string => {
  const now = new Date();
  const isCurrentMonth = month === now.getUTCFullYear() * 100 + (now.getUTCMonth() + 1);
  const total = daysInMonth(month);
  const elapsed = isCurrentMonth ? now.getUTCDate() : total;
  const remaining = Math.max(total - elapsed, 0);
  if (remaining === 0) return spent > limit ? 'Over for the month' : 'On track for the month';
  const perDay = Math.max(limit - spent, 0) / remaining;
  return spent > limit
    ? `${remaining} ${remaining === 1 ? 'day' : 'days'} left, already over`
    : `$${perDay.toFixed(2)}/day left to stay on track`;
};

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
    <div className="mt-6.5">
      {available.length > 0 && (
        <form
          onSubmit={handleAdd}
          className="border-line bg-paper-raised flex items-end gap-2.5 rounded-2xl border p-5"
        >
          <div className="flex-1">
            <label className="text-ink-muted mb-1.5 block text-[11px] font-semibold tracking-[0.06em] uppercase">
              Category
            </label>
            <Select
              className="rounded-[9px]"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              required
            >
              {available.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="w-[150px]">
            <label className="text-ink-muted mb-1.5 block text-[11px] font-semibold tracking-[0.06em] uppercase">
              Monthly limit
            </label>
            <Input
              className="rounded-[9px] font-mono"
              type="number"
              step="0.01"
              placeholder="0.00"
              value={limitAmount}
              onChange={(e) => setLimitAmount(e.target.value)}
              required
            />
          </div>
          <button
            type="submit"
            disabled={pending}
            className="bg-iris text-paper-raised rounded-full px-4.5 py-2.5 text-sm font-semibold disabled:opacity-50"
          >
            Set budget
          </button>
        </form>
      )}
      {error && <p className="text-rose mt-2 text-sm">{error}</p>}

      {initialBudgets.length === 0 ? (
        <p className="text-ink-muted mt-6 text-sm">No budgets set for this month yet.</p>
      ) : (
        <div className="mt-4.5 grid grid-cols-2 gap-4">
          {initialBudgets.map((budget) => {
            const limit = Number(budget.limitAmount);
            const spent = Number(budget.spent);
            const fraction = limit > 0 ? spent / limit : 0;
            const over = spent > limit;
            return (
              <div
                key={budget.id}
                className="border-line bg-paper-raised flex items-center gap-5.5 rounded-2xl border p-5.5"
              >
                <Ring size="budget" fraction={fraction}>
                  <span className="font-mono text-[15px]">
                    {Math.round(Math.min(fraction, 1) * 100)}%
                  </span>
                </Ring>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2.5">
                    <span className="font-display text-base font-semibold">
                      {budget.categoryName}
                    </span>
                    <span
                      className={cn('font-mono text-[12.5px]', over ? 'text-rose' : 'text-sky')}
                    >
                      {over
                        ? `Over by $${(spent - limit).toFixed(2)}`
                        : `$${(limit - spent).toFixed(2)} left`}
                    </span>
                  </div>
                  <div className="mt-2.5 font-mono text-[19px] tracking-[-0.02em] whitespace-nowrap">
                    ${spent.toFixed(2)} of ${limit.toFixed(2)}
                  </div>
                  <div className="mt-2.5 flex items-baseline justify-between">
                    <span className="text-ink-muted text-xs">{paceText(limit, spent, month)}</span>
                    <button
                      type="button"
                      onClick={() => handleDelete(budget.id)}
                      className="text-ink-muted text-xs"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
