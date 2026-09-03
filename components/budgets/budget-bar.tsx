import { Money } from '@/components/ui/money';
import { cn } from '@/lib/cn';
import type { FrontendBudget } from '@/lib/services/budgets';

export const BudgetBar = ({ budget }: { budget: FrontendBudget }): React.ReactElement => {
  const limit = Number(budget.limitAmount);
  const spent = Number(budget.spent);
  const pct = limit > 0 ? Math.min((spent / limit) * 100, 100) : 0;
  const over = spent > limit;

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-sm">
        <span className="text-ink font-medium">{budget.categoryName}</span>
        <span className="text-ink-muted">
          <Money value={budget.spent} tone="neutral" /> of{' '}
          <Money value={budget.limitAmount} tone="neutral" />
        </span>
      </div>
      <div className="bg-paper h-2 w-full overflow-hidden rounded-full">
        <div
          className={cn(
            'h-full origin-left [animation:grow-bar_0.6s_ease-out] rounded-full',
            over ? 'bg-brick' : 'bg-teal',
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      {over && <div className="text-brick mt-1 text-xs">Over budget</div>}
    </div>
  );
};
