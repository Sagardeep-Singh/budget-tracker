import { cn } from '@/lib/cn';
import type { SpendingTrendsData } from '@/lib/services/trends';

const money = (value: string): string =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value));

/**
 * A single current value + trend is a stat tile, not a one-bar chart
 * (dataviz skill's "is it even a chart?" table) — deliberately the one
 * piece of this screen that isn't a chart.
 */
export const SpendingHeadline = ({
  headline,
}: {
  headline: SpendingTrendsData['headline'];
}): React.ReactElement => (
  <div>
    <div className="text-ink-muted text-[11px] font-semibold tracking-[0.08em] uppercase">
      Spent, {headline.currentRangeLabel}
    </div>
    <div className="mt-2 font-mono text-[32px] leading-none font-medium tracking-[-0.03em]">
      {money(headline.currentTotal)}
    </div>
    {headline.pctChange !== null ? (
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span
          className={cn(
            'rounded-full px-3 py-1.5 text-[13px] font-semibold',
            headline.tone === 'rose' ? 'bg-rose-soft text-rose' : 'bg-sky-soft text-sky',
          )}
        >
          {Math.abs(Math.round(headline.pctChange))}% {headline.pctChange > 0 ? 'more' : 'less'}
        </span>
        <span className="text-ink-muted text-[13px]">than {headline.priorRangeLabel}</span>
      </div>
    ) : (
      <div className="text-ink-muted mt-3 text-[13px]">No spending in the prior period.</div>
    )}
    <p className="text-ink-muted mt-3 text-[11.5px] leading-relaxed">
      Transfers between your own accounts are excluded.
    </p>
  </div>
);
