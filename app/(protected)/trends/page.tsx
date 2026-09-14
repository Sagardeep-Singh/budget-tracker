import { getServerAuthSession } from '@/lib/auth/session';
import { getSpendingTrends, type TrendsRange } from '@/lib/services/trends';
import { ScreenHeader } from '@/components/nav/screen-header';
import { PeriodPopover } from '@/components/dashboard/period-popover';
import { RangePopover } from '@/components/trends/range-popover';
import { SpendingHeadline } from '@/components/trends/spending-headline';
import { SpendingLineChart } from '@/components/trends/spending-line-chart';
import { CategoryBreakdownBar } from '@/components/trends/category-breakdown-bar';
import { SpendingMovers } from '@/components/trends/spending-movers';

const VALID_RANGES: TrendsRange[] = [3, 6, 12];

const parseRange = (value?: string): TrendsRange => {
  const n = Number(value);
  return VALID_RANGES.includes(n as TrendsRange) ? (n as TrendsRange) : 3;
};

const currentMonth = (): number => {
  const now = new Date();
  return now.getUTCFullYear() * 100 + (now.getUTCMonth() + 1);
};

const TrendsPage = async ({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; range?: string }>;
}): Promise<React.ReactElement> => {
  const { month: monthParam, range: rangeParam } = await searchParams;
  const session = await getServerAuthSession();
  const userId = session!.user.id;
  const month = monthParam ? Number(monthParam) : currentMonth();
  const range = parseRange(rangeParam);
  const data = await getSpendingTrends(userId, { month, range });
  const rangeLabel = `${range} months`;

  const isEmpty = data.months.every((m) => m.income === 0 && m.expense === 0);

  return (
    <div className="animate-[fade-up_0.3s_ease-out]">
      <ScreenHeader
        title="Trends"
        description="How your spending is changing over time."
        periodSlot={
          <div className="flex items-center gap-2">
            <PeriodPopover month={month} basePath="/trends" />
            <RangePopover range={range} month={month} />
          </div>
        }
      />

      {isEmpty ? (
        <div className="border-line bg-paper-raised mt-6.5 rounded-[20px] border border-dashed p-18 text-center">
          <div className="border-paper-sunk mx-auto h-24 w-24 rounded-full border-[10px]" />
          <h2 className="font-display mt-6.5 text-xl font-semibold">Not enough history yet</h2>
          <p className="text-ink-muted mx-auto mt-2 max-w-[420px] text-sm leading-relaxed text-pretty">
            Trends need a few months of transactions to chart. Come back once you&apos;ve logged
            some spending, or try a wider range.
          </p>
        </div>
      ) : (
        <div className="mt-6.5 grid grid-cols-1 items-start gap-5 lg:grid-cols-[1.5fr_1fr]">
          <div className="flex min-w-0 flex-col gap-5">
            <div className="border-line bg-paper-raised rounded-[18px] border p-5.5">
              <div className="mb-4.5 flex items-baseline justify-between">
                <h2 className="font-display text-base font-semibold">Income vs. expense</h2>
              </div>
              <SpendingLineChart months={data.months} />
            </div>

            <div className="border-line bg-paper-raised rounded-[18px] border p-5.5">
              <div className="mb-4.5 flex items-baseline justify-between">
                <h2 className="font-display text-base font-semibold">By category</h2>
              </div>
              <CategoryBreakdownBar
                months={data.months}
                categories={data.categories}
                breakdown={data.categoryBreakdown}
              />
            </div>
          </div>

          <div className="flex min-w-0 flex-col gap-5">
            <div className="border-line bg-paper-raised rounded-[18px] border p-5.5">
              <SpendingHeadline headline={data.headline} rangeLabel={rangeLabel} />
            </div>

            <div className="border-line bg-paper-raised rounded-[18px] border p-5.5">
              <div className="mb-4 flex items-baseline justify-between">
                <h2 className="font-display text-base font-semibold">Notable movers</h2>
                <span className="text-ink-muted text-xs">vs prior {rangeLabel}</span>
              </div>
              <SpendingMovers movers={data.movers} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TrendsPage;
