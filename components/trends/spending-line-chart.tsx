import type { TrendsMonth } from '@/lib/services/trends';

const money = (value: number): string =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);

const WIDTH = 600;
const HEIGHT = 160;
const PAD_X = 8;
const PAD_TOP = 10;
const PAD_BOTTOM = 22;
const USABLE_WIDTH = WIDTH - PAD_X * 2;
const USABLE_HEIGHT = HEIGHT - PAD_TOP - PAD_BOTTOM;

const xAt = (i: number, count: number): number =>
  count > 1 ? PAD_X + (i / (count - 1)) * USABLE_WIDTH : WIDTH / 2;

const yAt = (value: number, max: number): number =>
  PAD_TOP + USABLE_HEIGHT - (max > 0 ? (value / max) * USABLE_HEIGHT : 0);

const points = (values: number[], max: number): string =>
  values.map((v, i) => `${xAt(i, values.length)},${yAt(v, max)}`).join(' ');

/**
 * Income vs. expense across the selected range — one chart, two series
 * sharing a single $ measure, per the dataviz skill's "same job -> one
 * chart" rule. Two series is comfortable with color alone plus direct
 * end-labels, so this reuses the app's existing sky/rose semantic tokens
 * rather than the categorical chart-N palette, matching the In/Out
 * convention already used on Overview.
 */
export const SpendingLineChart = ({ months }: { months: TrendsMonth[] }): React.ReactElement => {
  const max = Math.max(1, ...months.flatMap((m) => [m.income, m.expense]));
  const income = months.map((m) => m.income);
  const expense = months.map((m) => m.expense);
  const lastX = xAt(months.length - 1, months.length);
  const isEmpty = months.every((m) => m.income === 0 && m.expense === 0);

  return (
    <div>
      <div className="mb-3.5 flex items-center gap-4">
        <span className="text-ink-muted flex items-center gap-1.5 text-[12.5px]">
          <span className="bg-sky inline-block size-2.5 rounded-full" /> Income
        </span>
        <span className="text-ink-muted flex items-center gap-1.5 text-[12.5px]">
          <span className="bg-rose inline-block size-2.5 rounded-full" /> Expense
        </span>
      </div>
      {isEmpty ? (
        <p className="text-ink-muted py-10 text-center text-sm">No transactions in this range.</p>
      ) : (
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="w-full"
          role="img"
          aria-label="Income and expense by month"
        >
          <line
            x1={PAD_X}
            y1={HEIGHT - PAD_BOTTOM}
            x2={WIDTH - PAD_X}
            y2={HEIGHT - PAD_BOTTOM}
            stroke="var(--line)"
            strokeWidth={1}
          />
          <polyline
            points={points(income, max)}
            fill="none"
            stroke="var(--sky)"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <polyline
            points={points(expense, max)}
            fill="none"
            stroke="var(--rose)"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {months.map((m, i) => (
            <text
              key={m.month}
              x={xAt(i, months.length)}
              y={HEIGHT - 4}
              textAnchor="middle"
              fill="var(--ink-muted)"
              className="font-mono text-[9px]"
            >
              {m.label}
            </text>
          ))}
          <circle
            cx={lastX}
            cy={yAt(income[income.length - 1], max)}
            r={4}
            fill="var(--sky)"
            stroke="var(--paper-raised)"
            strokeWidth={2}
          />
          <circle
            cx={lastX}
            cy={yAt(expense[expense.length - 1], max)}
            r={4}
            fill="var(--rose)"
            stroke="var(--paper-raised)"
            strokeWidth={2}
          />
          <title>
            {months
              .map((m) => `${m.label}: in ${money(m.income)}, out ${money(m.expense)}`)
              .join(' · ')}
          </title>
        </svg>
      )}
    </div>
  );
};
