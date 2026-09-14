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
  rangeLabel,
}: {
  headline: SpendingTrendsData['headline'];
  rangeLabel: string;
}): React.ReactElement => (
  <div>
    <div className="text-ink-muted text-[11px] font-semibold tracking-[0.08em] uppercase">
      Total spend, {rangeLabel}
    </div>
    <div className="mt-2 font-mono text-[40px] leading-none font-medium tracking-[-0.03em]">
      {money(headline.currentTotal)}
    </div>
    {headline.pctChange !== null ? (
      <div
        className={cn(
          'mt-3 inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[13px] font-medium',
          headline.tone === 'rose' ? 'bg-rose-soft text-rose' : 'bg-sky-soft text-sky',
        )}
      >
        {headline.pctChange > 0 ? '▲' : '▼'} {Math.abs(Math.round(headline.pctChange))}% vs prior{' '}
        {rangeLabel}
      </div>
    ) : (
      <div className="text-ink-muted mt-3 text-[13px]">No spending in the prior period.</div>
    )}
  </div>
);
