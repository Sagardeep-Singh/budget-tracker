import { cn } from '@/lib/cn';
import type { TrendsMover } from '@/lib/services/trends';

const money = (value: number): string =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Math.abs(value));

/**
 * Ranked list, not a chart — a handful of headline $ changes is a KPI
 * list per the dataviz skill, not a worse-to-read bar chart of deltas.
 */
export const SpendingMovers = ({ movers }: { movers: TrendsMover[] }): React.ReactElement => {
  if (movers.length === 0) {
    return <p className="text-ink-muted text-sm">No notable category changes in this range.</p>;
  }
  return (
    <ul className="flex flex-col gap-3">
      {movers.map((m) => (
        <li key={m.categoryName} className="flex items-center justify-between gap-3 text-sm">
          <span className="text-ink truncate">{m.categoryName}</span>
          <span
            className={cn(
              'shrink-0 font-mono text-[13.5px] tabular-nums',
              m.tone === 'rose' ? 'text-rose' : 'text-sky',
            )}
          >
            {m.amount >= 0 ? '+' : '−'}
            {money(m.amount)}
            {m.pctChange !== null && (
              <span className="text-ink-muted ml-1.5">
                ({m.pctChange >= 0 ? '+' : ''}
                {Math.round(m.pctChange)}%)
              </span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
};
