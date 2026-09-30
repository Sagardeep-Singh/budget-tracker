'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  getNextStatementPeriod,
  getPreviousStatementPeriod,
  getStatementPeriod,
  isStatementPeriod,
  type Period,
} from '@/lib/statement';
import { periodToRange, type DateRange } from '@/lib/period-selection';

const DATE_LABEL = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  month: 'short',
  day: 'numeric',
});

const formatPeriod = (period: Period): string => {
  const inclusiveEnd = new Date(period.end.getTime() - 24 * 60 * 60 * 1000);
  return `${DATE_LABEL.format(period.start)} – ${DATE_LABEL.format(inclusiveEnd)}`;
};

const rangeToPeriod = ({ from, to }: DateRange): Period | null =>
  from && to
    ? {
        start: new Date(`${from}T00:00:00Z`),
        end: new Date(new Date(`${to}T00:00:00Z`).getTime() + 24 * 60 * 60 * 1000),
      }
    : null;

/**
 * Credit card statement helper for a single selected card. It doesn't own a
 * period of its own: it writes the statement's dates into the same
 * `from`/`to` the page's period selector uses, so the two can never disagree.
 * While the active range is exactly a statement, ‹ › step between statements.
 */
export const StatementPicker = ({
  statementDay,
  range,
  onSelect,
}: {
  statementDay: number;
  range: DateRange;
  onSelect: (range: { from: string; to: string }) => void;
}): React.ReactElement => {
  const current = rangeToPeriod(range);
  const active = current && isStatementPeriod(statementDay, current) ? current : null;

  if (!active) {
    return (
      <button
        type="button"
        onClick={() => onSelect(periodToRange(getStatementPeriod(statementDay, new Date())))}
        className="border-line bg-paper-raised text-ink rounded-full border px-3.5 py-1.5 text-xs font-medium"
      >
        View by statement
      </button>
    );
  }

  return (
    <div className="text-ink-muted flex items-center gap-1 text-sm">
      <span className="text-xs">Statement</span>
      <button
        type="button"
        onClick={() => onSelect(periodToRange(getPreviousStatementPeriod(statementDay, active)))}
        aria-label="Previous statement"
        className="hover:bg-paper-raised hover:text-ink rounded-full px-2 py-1"
      >
        <ChevronLeft size={16} />
      </button>
      <span className="font-money tabular-nums">{formatPeriod(active)}</span>
      <button
        type="button"
        onClick={() => onSelect(periodToRange(getNextStatementPeriod(statementDay, active)))}
        aria-label="Next statement"
        className="hover:bg-paper-raised hover:text-ink rounded-full px-2 py-1"
      >
        <ChevronRight size={16} />
      </button>
    </div>
  );
};
