'use client';

import { useRouter } from 'next/navigation';
import { cn } from '@/lib/cn';
import type { TrendsRange } from '@/lib/services/trends';

const RANGES: TrendsRange[] = [3, 6, 12];

/**
 * A second, separate control next to PeriodPopover — that popover picks
 * one end month, this picks how many months back from it. A trends view
 * is range-shaped, not single-month-shaped, so this isn't a repurposing
 * of the existing popover.
 */
export const RangePopover = ({
  range,
  month,
}: {
  range: TrendsRange;
  month?: number;
}): React.ReactElement => {
  const router = useRouter();

  const goTo = (r: TrendsRange): void => {
    const params = new URLSearchParams();
    if (month) params.set('month', String(month));
    params.set('range', String(r));
    router.push(`/trends?${params.toString()}`);
  };

  return (
    <div className="border-line bg-paper-raised flex items-center gap-0.5 rounded-full border p-1">
      {RANGES.map((r) => (
        <button
          key={r}
          type="button"
          onClick={() => goTo(r)}
          className={cn(
            'rounded-full px-3 py-1.5 text-[13px] font-medium',
            r === range ? 'bg-iris text-paper-raised' : 'text-ink-muted',
          )}
        >
          {r}mo
        </button>
      ))}
    </div>
  );
};
