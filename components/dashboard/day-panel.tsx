import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { Ring, type RingSize } from '@/components/ui/ring';
import { Money } from '@/components/ui/money';
import { cn } from '@/lib/cn';
import type { OverviewData } from '@/lib/services/overview';

const money = (value: string): string =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value));

/**
 * Overview's selected-day panel. Rendered as a side card at lg+ and as the
 * whole Day screen below lg (same `?day=N` URL contract, no new route) —
 * `ringSize` and `backHref` are the only differences between the two.
 */
export const DayPanel = ({
  selectedDay,
  daysInMonth,
  dayHref,
  ringSize = 'budget',
  backHref,
}: {
  selectedDay: OverviewData['selectedDay'];
  daysInMonth: number;
  dayHref: (day: number) => string;
  ringSize?: RingSize;
  backHref?: string;
}): React.ReactElement => (
  <div className="border-line bg-paper-raised rounded-[18px] border p-5.5">
    {backHref && (
      <Link
        href={backHref}
        className="text-ink-muted mb-3.5 inline-flex items-center gap-1 text-[13px] font-medium lg:hidden"
      >
        <ChevronLeft size={14} /> Back to Overview
      </Link>
    )}
    <div className="flex items-start justify-between gap-3">
      <div>
        <div className="font-display text-[19px] font-semibold tracking-[-0.02em]">
          {selectedDay.weekday}
        </div>
        <div className="text-ink-muted mt-0.5 text-[12.5px]">{selectedDay.dateLabel}</div>
      </div>
      <div className="flex shrink-0 gap-1">
        <Link
          href={dayHref(Math.max(selectedDay.day - 1, 1))}
          aria-label="Previous day"
          className="border-line text-ink-muted flex size-7.5 items-center justify-center rounded-full border text-sm"
        >
          ‹
        </Link>
        <Link
          href={dayHref(Math.min(selectedDay.day + 1, daysInMonth))}
          aria-label="Next day"
          className="border-line text-ink-muted flex size-7.5 items-center justify-center rounded-full border text-sm"
        >
          ›
        </Link>
      </div>
    </div>

    <div className="mt-4.5 flex items-center gap-5">
      <Ring size={ringSize} fraction={selectedDay.fraction} alertAt={1}>
        <span className="font-mono text-sm">
          {Math.round(Math.min(selectedDay.fraction, 1) * 100)}%
        </span>
        <span className="text-ink-muted text-[9px] tracking-[0.08em] uppercase">of pace</span>
      </Ring>
      <div className="min-w-0">
        <div className="text-ink-muted text-[10.5px] font-semibold tracking-[0.08em] uppercase">
          Spent
        </div>
        {/* Not <Money>: iris/rose here means under/over pace, which doesn't
            map onto Money's income/expense/neutral tones. */}
        <div
          className={cn(
            'mt-1.5 font-mono text-[26px] font-medium tracking-[-0.03em]',
            selectedDay.over ? 'text-rose' : 'text-iris',
          )}
        >
          {money(selectedDay.spent)}
        </div>
        <div className="text-ink-muted mt-1.5 text-xs leading-snug">{selectedDay.note}</div>
      </div>
    </div>

    {selectedDay.rows.length > 0 ? (
      <div className="border-line mt-4 border-t">
        {selectedDay.rows.map((row) => (
          <div
            key={row.id}
            className="ledger-row flex items-center gap-3.5 py-3 text-sm last:border-b-0"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13.5px] font-medium">{row.payee}</div>
              <div className="text-ink-muted mt-0.5 text-xs">{row.categoryName}</div>
            </div>
            <Money
              value={row.amount}
              tone={row.tone}
              className="shrink-0 text-[13.5px] tabular-nums"
            />
          </div>
        ))}
      </div>
    ) : (
      <div className="border-line text-ink-muted mt-4 border-t pt-4.5 text-center text-[13px]">
        Nothing logged this day.
      </div>
    )}
  </div>
);
