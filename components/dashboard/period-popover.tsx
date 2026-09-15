'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Calendar, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { BottomSheet } from '@/components/ui/bottom-sheet';
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

const MONTH_SHORT = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short' });
const monthShort = (monthIndex: number): string =>
  MONTH_SHORT.format(new Date(Date.UTC(2000, monthIndex, 1)));

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

/** The preset pills + 12-month grid, shared by the popover and the sheet. */
const PeriodPickerBody = ({
  month,
  now,
  viewYear,
  onPrevYear,
  onNextYear,
  goTo,
}: {
  month: number;
  now: number;
  viewYear: number;
  onPrevYear: () => void;
  onNextYear: () => void;
  goTo: (m: number) => void;
}): React.ReactElement => (
  <>
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
      <button
        type="button"
        onClick={onPrevYear}
        aria-label="Previous year"
        className="text-ink-muted hover:text-ink -ml-2 flex size-9 items-center justify-center"
      >
        <ChevronLeft size={16} />
      </button>
      <span className="font-mono text-[13px] font-medium">{viewYear}</span>
      <button
        type="button"
        onClick={onNextYear}
        aria-label="Next year"
        className="text-ink-muted hover:text-ink -mr-2 flex size-9 items-center justify-center"
      >
        <ChevronRight size={16} />
      </button>
    </div>
    <div className="mt-2.5 grid grid-cols-4 gap-1.5">
      {Array.from({ length: 12 }, (_, i) => viewYear * 100 + i + 1).map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => goTo(m)}
          className={cn(
            'rounded-[10px] py-2.5 text-[13px] font-medium',
            m === month ? 'bg-iris text-paper-raised' : 'text-ink hover:bg-paper',
          )}
        >
          {monthShort((m % 100) - 1)}
        </button>
      ))}
    </div>
  </>
);

/**
 * Presets + a 12-month grid, mapped to the design's period popover. Custom
 * date-range picking isn't included — getOverviewData is calendar-month
 * only for now, and a real range picker needs the service to support
 * arbitrary spans, which is a larger change than this stage's scope.
 *
 * Below lg the same body renders in a `BottomSheet` instead of the anchored
 * box. The sheet is rendered *inside* the ref-wrapped div on purpose: the
 * outside-click effect below closes on any mousedown outside that ref, so a
 * sibling/portal sheet would close itself on its own first tap. `fixed`
 * positioning is unaffected by the nesting.
 */
export const PeriodPopover = ({
  month,
  basePath = '/dashboard',
}: {
  month: number;
  basePath?: string;
}): React.ReactElement => {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const now = currentMonth();
  const year = Math.floor(month / 100);
  // Independent of the selected month's year, so ‹ › can browse years that
  // have no selection in them yet without changing what's actually applied.
  const [viewYear, setViewYear] = useState(year);

  const openPicker = (): void => {
    setViewYear(year);
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [open]);

  const close = useCallback((): void => setOpen(false), []);

  const goTo = (m: number): void => {
    setOpen(false);
    router.push(m === now ? basePath : `${basePath}?month=${m}`);
  };

  const body = (
    <PeriodPickerBody
      month={month}
      now={now}
      viewYear={viewYear}
      onPrevYear={() => setViewYear((y) => y - 1)}
      onNextYear={() => setViewYear((y) => y + 1)}
      goTo={goTo}
    />
  );

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => (open ? setOpen(false) : openPicker())}
        className="border-line bg-paper-raised text-ink flex items-center gap-2 rounded-full border px-3.5 py-2 text-[13px] font-medium"
      >
        <Calendar size={14} />
        {monthLabel(month)}
        <ChevronDown size={13} className="text-ink-muted" />
      </button>
      {open && (
        <div className="hidden lg:block">
          <div className="border-line bg-paper-raised absolute top-full left-0 z-20 mt-3 w-[280px] rounded-2xl border p-5 shadow-[0_18px_48px_rgba(0,0,0,.18)]">
            {body}
          </div>
        </div>
      )}
      <div className="lg:hidden">
        <BottomSheet open={open} onClose={close} title="Pick a period">
          {body}
        </BottomSheet>
      </div>
    </div>
  );
};
