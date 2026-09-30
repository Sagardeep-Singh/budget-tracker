import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { TrendsMover } from '@/lib/services/trends';
import { transactionsHref } from '@/lib/transactions/transaction-filters';

const money = (value: number): string =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Math.abs(value));

/**
 * Ranked list, not a chart — a handful of headline $ changes is a KPI
 * list per the dataviz skill, not a worse-to-read bar chart of deltas.
 * Each row shows prior → current spend so the delta has context, and opens
 * that category's spending for the selected range (not the prior one it's
 * compared against), filtered the same way trends counts it.
 */
export const SpendingMovers = ({
  movers,
  from,
  to,
}: {
  movers: TrendsMover[];
  from: string;
  to: string;
}): React.ReactElement => {
  if (movers.length === 0) {
    return <p className="text-ink-muted text-sm">No notable category changes in this range.</p>;
  }
  return (
    <ul className="-mx-2 flex flex-col gap-1">
      {movers.map((m) => (
        <li key={m.categoryId}>
          <Link
            href={transactionsHref({
              from,
              to,
              categoryIds: [m.categoryId],
              type: 'EXPENSE',
              hideTransfers: true,
            })}
            className="hover:bg-paper flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-sm"
          >
            <span className="flex min-w-0 flex-col">
              <span className="text-ink truncate">{m.categoryName}</span>
              <span className="text-ink-muted font-mono text-xs tabular-nums">
                {money(m.prior)} → {money(m.current)}
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
              <span className="flex flex-col items-end">
                <span
                  className={cn(
                    'font-mono text-[13.5px] tabular-nums',
                    m.tone === 'rose' ? 'text-rose' : 'text-sky',
                  )}
                >
                  {m.amount >= 0 ? '+' : '−'}
                  {money(m.amount)}
                </span>
                <span className="text-ink-muted font-mono text-xs tabular-nums">
                  {m.pctChange === null
                    ? 'new'
                    : `${m.pctChange >= 0 ? '+' : '−'}${Math.abs(Math.round(m.pctChange))}%`}
                </span>
              </span>
              <ChevronRight size={14} className="text-ink-muted" />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
};
