import type { TrendsCategory, TrendsCategoryMonth, TrendsMonth } from '@/lib/services/trends';
import { currentMonthNumber, daysElapsedInMonth } from '@/lib/format';
import { cn } from '@/lib/cn';

const money = (value: number): string =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);

/**
 * Category breakdown, one stacked bar per month — part-to-whole is a
 * stacked bar per the dataviz skill, never a stacked line or multiple
 * pies. Segment order/colors are fixed across months (a category with $0
 * that month is a zero-height segment, not omitted) so the legend never
 * reflows as the range changes.
 */
export const CategoryBreakdownBar = ({
  months,
  categories,
  breakdown,
  uncategorizedCount,
}: {
  months: TrendsMonth[];
  categories: TrendsCategory[];
  breakdown: TrendsCategoryMonth[];
  uncategorizedCount: number;
}): React.ReactElement => {
  const totalByMonth = new Map(
    breakdown.map((b) => [b.month, b.segments.reduce((sum, s) => sum + s.amount, 0)]),
  );
  const maxTotal = Math.max(1, ...totalByMonth.values());
  const isEmpty = categories.length === 0;

  return (
    <div>
      {uncategorizedCount > 0 && (
        <div className="bg-paper mb-4 flex items-start gap-2.5 rounded-xl px-3.5 py-2.5">
          <span className="text-ink-muted mt-1 size-2.5 shrink-0 rounded-[3px] bg-current" />
          <p className="text-ink-muted text-[12.5px] leading-snug">
            Uncategorized is grey because it isn&rsquo;t a spending pattern — it&rsquo;s{' '}
            {uncategorizedCount} row{uncategorizedCount === 1 ? '' : 's'} waiting on you.
          </p>
        </div>
      )}
      {categories.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-x-4 gap-y-1.5">
          {categories.map((c) => (
            <span
              key={c.categoryId}
              className="text-ink-muted flex items-center gap-1.5 text-[12.5px]"
            >
              <span
                className="inline-block size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: c.color }}
              />
              {c.categoryName}
            </span>
          ))}
        </div>
      )}
      {isEmpty ? (
        <p className="text-ink-muted py-10 text-center text-sm">No expenses in this range.</p>
      ) : (
        <div className="flex h-[160px] items-end gap-3">
          {breakdown.map((monthBreakdown) => {
            const monthLabel = months.find((m) => m.month === monthBreakdown.month)?.label ?? '';
            const total = totalByMonth.get(monthBreakdown.month) ?? 0;
            const barHeight = Math.round((total / maxTotal) * 100);
            const isInProgress = monthBreakdown.month === currentMonthNumber();
            const elapsedDays = isInProgress ? daysElapsedInMonth(monthBreakdown.month) : null;
            return (
              <div key={monthBreakdown.month} className="flex h-full flex-1 flex-col justify-end">
                <div
                  className={cn(
                    'flex flex-col justify-end gap-[2px] overflow-hidden rounded-t-[4px]',
                    isInProgress && 'opacity-55',
                  )}
                  style={{ height: `${barHeight}%`, minHeight: total > 0 ? 2 : 0 }}
                  title={`${monthLabel}${isInProgress ? ' (in progress)' : ''}: ${money(total)}`}
                >
                  {monthBreakdown.segments
                    .filter((s) => s.amount > 0)
                    .map((s) => {
                      const category = categories.find((c) => c.categoryId === s.categoryId);
                      const segmentHeight = total > 0 ? (s.amount / total) * 100 : 0;
                      return (
                        <div
                          key={s.categoryId}
                          title={`${monthLabel} · ${category?.categoryName ?? 'Uncategorized'}: ${money(s.amount)}`}
                          style={{
                            height: `${segmentHeight}%`,
                            backgroundColor: category?.color,
                          }}
                        />
                      );
                    })}
                </div>
                <div className="text-ink-muted mt-2 truncate text-center font-mono text-[11px] whitespace-nowrap">
                  {isInProgress ? `${monthLabel} · ${elapsedDays} days` : monthLabel}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
