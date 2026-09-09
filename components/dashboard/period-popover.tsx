'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/cn';

const MONTH_LABEL = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  month: 'long',
  year: 'numeric',
});

const monthLabel = (month: number): string => {
  const date = new Date(Date.UTC(Math.floor(month / 100), (month % 100) - 1, 1));
  return MONTH_LABEL.format(date);
};

const currentMonth = (): number => {
  const now = new Date();
  return now.getUTCFullYear() * 100 + (now.getUTCMonth() + 1);
};

const shiftMonth = (month: number, delta: number): number => {
  const year = Math.floor(month / 100);
  const idx = (month % 100) - 1 + delta;
  const date = new Date(Date.UTC(year, idx, 1));
  return date.getUTCFullYear() * 100 + (date.getUTCMonth() + 1);
};

/**
 * Presets + a 12-month grid, mapped to the design's period popover. Custom
 * date-range picking isn't included — getOverviewData is calendar-month
 * only for now, and a real range picker needs the service to support
 * arbitrary spans, which is a larger change than this stage's scope.
 */
export const PeriodPopover = ({ month }: { month: number }): React.ReactElement => {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const now = currentMonth();
  const year = Math.floor((open ? month : now) / 100);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [open]);

  const goTo = (m: number): void => {
    setOpen(false);
    router.push(m === now ? '/dashboard' : `/dashboard?month=${m}`);
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="border-line bg-paper-raised text-ink flex items-center gap-2 rounded-full border px-3.5 py-2 text-[13px] font-medium"
      >
        {monthLabel(month)}
        <span className="text-ink-muted text-[9px]">▼</span>
      </button>
      {open && (
        <div className="border-line bg-paper-raised absolute top-full left-0 z-20 mt-3 w-[280px] rounded-2xl border p-5 shadow-[0_18px_48px_rgba(0,0,0,.18)]">
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => goTo(now)}
              className={cn(
                'rounded-full px-3.5 py-2 text-[13px] font-medium',
                month === now ? 'bg-iris text-paper-raised' : 'border-line text-ink border',
              )}
            >
              This month
            </button>
            <button
              type="button"
              onClick={() => goTo(shiftMonth(now, -1))}
              className={cn(
                'rounded-full px-3.5 py-2 text-[13px] font-medium',
                month === shiftMonth(now, -1)
                  ? 'bg-iris text-paper-raised'
                  : 'border-line text-ink border',
              )}
            >
              Last month
            </button>
          </div>
          <div className="mt-5 flex items-center justify-between">
            <span className="text-ink-muted text-[11px] font-semibold tracking-[0.1em] uppercase">
              Month
            </span>
            <span className="text-ink-muted font-mono text-xs">{year}</span>
          </div>
          <div className="mt-2.5 grid grid-cols-4 gap-1.5">
            {Array.from({ length: 12 }, (_, i) => year * 100 + i + 1).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => goTo(m)}
                className={cn(
                  'rounded-[10px] py-2.5 text-[13px] font-medium',
                  m === month ? 'bg-iris text-paper-raised' : 'text-ink hover:bg-paper',
                )}
              >
                {(m % 100).toString().padStart(2, '0')}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
