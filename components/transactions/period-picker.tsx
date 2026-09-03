'use client';

import { cn } from '@/lib/cn';
import type { Period } from '@/lib/statement';

const DATE_LABEL = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });

const formatPeriod = (period: Period): string => {
  const inclusiveEnd = new Date(period.end.getTime() - 24 * 60 * 60 * 1000);
  return `${DATE_LABEL.format(period.start)} – ${DATE_LABEL.format(inclusiveEnd)}`;
};

export type PeriodMode = 'ALL' | 'MONTH' | 'STATEMENT';

export const PeriodPicker = ({
  mode,
  onModeChange,
  period,
  onPrev,
  onNext,
  allowStatement,
}: {
  mode: PeriodMode;
  onModeChange: (mode: PeriodMode) => void;
  period: Period | null;
  onPrev: () => void;
  onNext: () => void;
  allowStatement: boolean;
}): React.ReactElement => (
  <div className="flex items-center gap-2">
    <div className="border-line bg-paper-raised flex rounded-full border p-0.5 text-xs">
      {(['ALL', 'MONTH', ...(allowStatement ? (['STATEMENT'] as const) : [])] as const).map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => onModeChange(m)}
          className={cn(
            'rounded-full px-3 py-1 font-medium transition-colors',
            mode === m ? 'bg-teal text-paper-raised' : 'text-ink-muted hover:text-ink',
          )}
        >
          {m === 'ALL' ? 'All time' : m === 'MONTH' ? 'By month' : 'By statement'}
        </button>
      ))}
    </div>
    {period && mode !== 'ALL' && (
      <div className="text-ink-muted flex items-center gap-1 text-sm">
        <button
          type="button"
          onClick={onPrev}
          aria-label="Previous period"
          className="hover:bg-paper-raised hover:text-ink rounded-full px-2 py-1"
        >
          ‹
        </button>
        <span className="font-money tabular-nums">{formatPeriod(period)}</span>
        <button
          type="button"
          onClick={onNext}
          aria-label="Next period"
          className="hover:bg-paper-raised hover:text-ink rounded-full px-2 py-1"
        >
          ›
        </button>
      </div>
    )}
  </div>
);
