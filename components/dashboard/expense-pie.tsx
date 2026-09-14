import type { OverviewExpenseSlice } from '@/lib/services/overview';

// Validated categorical palette (dataviz skill default, first 6 of 8 fixed
// slots) — assigned in this fixed order, never cycled or re-sorted by value.
const SLICE_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
  'var(--chart-6)',
];
const OTHER_COLOR = 'var(--ink-muted)';

const money = (value: string): string =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value));

const BOX = 152;
const RADIUS = 64;
const STROKE = 20;
const CENTER = BOX / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const GAP = 3;

export const ExpensePie = ({
  slices,
  total,
}: {
  slices: OverviewExpenseSlice[];
  total: string;
}): React.ReactElement => {
  if (slices.length === 0) {
    return <p className="text-ink-muted text-sm">No expenses logged yet this month.</p>;
  }

  const arcs = slices.reduce<
    Array<OverviewExpenseSlice & { length: number; offset: number; color: string }>
  >((acc, slice, i) => {
    const cumulative = acc.reduce((sum, a) => sum + CIRCUMFERENCE * a.fraction, 0);
    const rawLength = CIRCUMFERENCE * slice.fraction;
    const length = Math.max(rawLength - GAP, 0);
    const color =
      slice.categoryName === 'Other' ? OTHER_COLOR : SLICE_COLORS[i % SLICE_COLORS.length];
    return [...acc, { ...slice, length, offset: -cumulative, color }];
  }, []);

  return (
    <div className="flex items-center gap-6.5">
      <svg
        width={BOX}
        height={BOX}
        viewBox={`0 0 ${BOX} ${BOX}`}
        role="img"
        aria-label={`Expense breakdown by category, total ${money(total)}`}
        className="shrink-0"
      >
        {arcs.map((a) => (
          <circle
            key={a.categoryId ?? a.categoryName}
            cx={CENTER}
            cy={CENTER}
            r={RADIUS}
            fill="none"
            stroke={a.color}
            strokeWidth={STROKE}
            strokeDasharray={`${a.length} ${CIRCUMFERENCE - a.length}`}
            strokeDashoffset={a.offset}
            transform={`rotate(-90 ${CENTER} ${CENTER})`}
          >
            <title>{`${a.categoryName}: ${money(a.amount)} (${Math.round(a.fraction * 100)}%)`}</title>
          </circle>
        ))}
      </svg>
      {/* Doubles as the accessible table view: every slice's name, share, and
          amount is plain text, never color-only. */}
      <ul className="min-w-0 flex-1 space-y-2">
        {arcs.map((a) => (
          <li
            key={a.categoryId ?? a.categoryName}
            className="flex items-center justify-between gap-3 text-[13px]"
          >
            <span className="flex min-w-0 items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: a.color }} />
              <span className="text-ink truncate">{a.categoryName}</span>
            </span>
            <span className="text-ink-muted shrink-0 font-mono tabular-nums">
              {money(a.amount)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
};
