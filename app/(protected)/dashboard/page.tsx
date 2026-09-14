import Link from 'next/link';
import { Plus } from 'lucide-react';
import { getServerAuthSession } from '@/lib/auth/session';
import { getOverviewData, type OverviewDayBar } from '@/lib/services/overview';
import { ScreenHeader } from '@/components/nav/screen-header';
import { Ring } from '@/components/ui/ring';
import { PeriodPopover } from '@/components/dashboard/period-popover';
import { ExpensePie } from '@/components/dashboard/expense-pie';
import { DayPanel } from '@/components/dashboard/day-panel';
import { getByDayBars } from '@/lib/dashboard/day-bars';
import { cn } from '@/lib/cn';

const money = (value: string): string =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value));

const DashboardPage = async ({
  searchParams,
}: {
  searchParams: Promise<{ day?: string; month?: string }>;
}): Promise<React.ReactElement> => {
  const { day, month } = await searchParams;
  const session = await getServerAuthSession();
  const userId = session!.user.id;
  const data = await getOverviewData(userId, {
    day: day ? Number(day) : undefined,
    month: month ? Number(month) : undefined,
  });
  const {
    hero,
    budgetRings,
    expenseBreakdown,
    dayBars,
    selectedDay,
    triage,
    cycleCard,
    dailyPace,
  } = data;

  const dayHref = (d: number): string =>
    month ? `/dashboard?month=${month}&day=${d}` : `/dashboard?day=${d}`;

  const maxBar = Math.max(1, ...dayBars.flatMap((d) => [d.income, d.expense]));
  const barScale = (amount: number): number => Math.round((amount / maxBar) * 100);

  // Written once, rendered at two sizes: the desktop hero ring and its smaller
  // mobile twin (both stay in the DOM, visibility is CSS-only — there is no
  // reliable server-side viewport check).
  const heroRingLabel = (sizeClass: string): React.ReactElement => (
    <>
      <span className={cn('font-mono tabular-nums', sizeClass)}>
        {Math.round(Math.min(hero.usedFraction, 1) * 100)}%
      </span>
      <span className="text-ink-muted mt-0.5 text-[10px] tracking-[0.09em] uppercase">used</span>
    </>
  );

  const byDayBars = (
    bars: OverviewDayBar[],
    className: string,
    mode: 'week' | 'month',
  ): React.ReactElement => (
    <div className={className}>
      <div className="flex h-[120px] items-end gap-1">
        {bars.map((d) => {
          const isSelected = d.day === selectedDay.day;
          const isOverPace = Number(dailyPace) > 0 && d.expense > Number(dailyPace);
          return (
            <Link
              key={d.day}
              href={dayHref(d.day)}
              title={`Sep ${d.day} · in ${money(d.income.toFixed(2))} · out ${money(d.expense.toFixed(2))}`}
              className="flex h-full flex-1 flex-col justify-end gap-[3px]"
            >
              <span
                className="bg-sky block rounded-[3px]"
                style={{ height: `${barScale(d.income)}px` }}
              />
              <span
                className={cn(
                  'block rounded-[3px]',
                  isSelected ? 'bg-iris' : isOverPace ? 'bg-rose' : 'bg-line',
                )}
                style={{ height: `${barScale(d.expense)}px` }}
              />
            </Link>
          );
        })}
      </div>
      <div className="bg-line mt-2 h-px" />
      <div className="text-ink-muted mt-2 flex justify-between font-mono text-[11px]">
        {mode === 'month' ? (
          <>
            <span>Day 1</span>
            <span>Day {Math.round(data.daysInMonth / 2)}</span>
            <span>Day {data.daysInMonth}</span>
          </>
        ) : (
          <>
            <span>Day {bars[0]?.day ?? 1}</span>
            <span>Day {bars[bars.length - 1]?.day ?? 1}</span>
          </>
        )}
      </div>
    </div>
  );

  const isEmpty =
    budgetRings.length === 0 &&
    Number(hero.income) === 0 &&
    Number(hero.expense) === 0 &&
    !cycleCard;

  // With ?day= present, below lg the Day panel *is* the screen (per the plan's
  // "no new route" decision). The swap lives on new wrapper divs rather than
  // appended classes: `cn` is a plain join, so a `hidden` tacked onto an
  // existing className can lose to whatever display utility is already there.
  const dayFocus = day !== undefined;

  return (
    <div className="animate-[fade-up_0.3s_ease-out] pb-20 lg:pb-0">
      <div className={dayFocus ? 'hidden lg:block' : undefined}>
        <ScreenHeader
          title="Overview"
          description="Here's where things stand this month."
          periodSlot={<PeriodPopover month={data.month} />}
          actions={
            <>
              <Link
                href="/import"
                className="border-line text-ink rounded-full border px-4 py-2 text-sm"
              >
                Import CSV
              </Link>
              <Link
                href="?overlay=add"
                className="bg-iris text-paper-raised rounded-full px-4 py-2 text-sm font-semibold"
              >
                Add transaction
              </Link>
            </>
          }
        />

        {isEmpty ? (
          <div className="border-line bg-paper-raised mt-6.5 rounded-[20px] border border-dashed p-18 text-center">
            <div className="border-paper-sunk mx-auto h-24 w-24 rounded-full border-[10px]" />
            <h2 className="font-display mt-6.5 text-xl font-semibold">Nothing to chart yet</h2>
            <p className="text-ink-muted mx-auto mt-2 max-w-[420px] text-sm leading-relaxed text-pretty">
              Import a statement or add your first transaction. Ledger builds budgets from the
              categories it finds, so the rings fill in as soon as there is data.
            </p>
            <div className="mt-6 flex justify-center gap-2.5">
              <Link
                href="/import"
                className="bg-iris text-paper-raised rounded-full px-5 py-2.5 text-sm font-semibold"
              >
                Import CSV
              </Link>
              <Link
                href="?overlay=add"
                className="border-line text-ink rounded-full border px-5 py-2.5 text-sm"
              >
                Add manually
              </Link>
            </div>
          </div>
        ) : (
          <div className="mt-6.5 grid grid-cols-1 items-start gap-5 lg:grid-cols-[1.5fr_1fr]">
            <div className="flex min-w-0 flex-col gap-5">
              <div className="border-line bg-paper-raised rounded-[18px] border p-6.5">
                {/* Ring beside the figures at lg+; stacked below it, where a 132px
                  ring plus the 40px amount can't share one row at 402px. */}
                <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:gap-7.5">
                  {/* Visibility lives on a wrapper, not on Ring's className: `cn` is a
                    plain join (no tailwind-merge), so `hidden` passed into Ring would
                    lose to its own base `inline-flex`. */}
                  <div className="hidden shrink-0 lg:block">
                    <Ring size="hero" fraction={hero.usedFraction}>
                      {heroRingLabel('text-[21px]')}
                    </Ring>
                  </div>
                  <div className="shrink-0 lg:hidden">
                    <Ring size="hero-mobile" fraction={hero.usedFraction}>
                      {heroRingLabel('text-lg')}
                    </Ring>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-ink-muted text-[11px] font-semibold tracking-[0.08em] uppercase">
                      {hero.leftLabel}
                    </div>
                    <div className="mt-2 font-mono text-[40px] leading-none font-medium tracking-[-0.03em]">
                      {hero.hasBudget ? money(hero.leftAmount) : '—'}
                    </div>
                    <div className="text-ink-muted mt-2 text-[13.5px]">
                      {hero.hasBudget ? (
                        <>
                          {hero.metaLine} ·{' '}
                          <span className="text-ink font-mono">{money(hero.paceAmount)}</span>{' '}
                          {hero.paceTail}
                        </>
                      ) : (
                        <>
                          {hero.metaLine} · {hero.paceTail}
                        </>
                      )}
                    </div>
                    <div className="border-line mt-4.5 flex flex-wrap gap-x-6.5 gap-y-3 border-t pt-4 lg:flex-nowrap">
                      <div>
                        <div className="text-ink-muted text-[10.5px] font-semibold tracking-[0.08em] uppercase">
                          In
                        </div>
                        <div className="text-sky mt-1.5 font-mono text-lg tabular-nums">
                          {money(hero.income)}
                        </div>
                      </div>
                      <div>
                        <div className="text-ink-muted text-[10.5px] font-semibold tracking-[0.08em] uppercase">
                          Out
                        </div>
                        <div className="text-rose mt-1.5 font-mono text-lg tabular-nums">
                          {money(hero.expense)}
                        </div>
                      </div>
                      <div>
                        <div className="text-ink-muted text-[10.5px] font-semibold tracking-[0.08em] uppercase">
                          Net
                        </div>
                        <div className="mt-1.5 font-mono text-lg tabular-nums">
                          {money(hero.net)}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                <div
                  className={cn(
                    'mt-5 rounded-xl px-4 py-2.5 text-[13px] leading-snug',
                    hero.paceTone === 'rose'
                      ? 'bg-rose-soft text-rose'
                      : hero.paceTone === 'sky'
                        ? 'bg-sky-soft text-sky'
                        : 'bg-paper-sunk text-ink-muted',
                  )}
                >
                  {hero.paceNote}
                </div>
              </div>

              <div className="border-line bg-paper-raised rounded-[18px] border p-5.5">
                <div className="mb-4.5 flex items-baseline justify-between">
                  <h2 className="font-display text-base font-semibold">Budgets</h2>
                  <span className="text-ink-muted text-xs">share of each limit used</span>
                </div>
                {budgetRings.length === 0 ? (
                  <p className="text-ink-muted text-sm">
                    No budgets set for this month yet.{' '}
                    <Link href="/budgets" className="text-iris font-medium">
                      Set one
                    </Link>
                    .
                  </p>
                ) : (
                  <>
                    <div className="hidden grid-cols-4 gap-2.5 lg:grid">
                      {budgetRings.map((r) => (
                        <div key={r.id} className="flex flex-col items-center gap-2.5">
                          <Ring size="category" fraction={r.fraction}>
                            <span className="font-mono text-sm">{r.pctLabel}</span>
                          </Ring>
                          <div className="text-center text-[12.5px] leading-tight">
                            {r.categoryName}
                            <br />
                            <span
                              className={cn(
                                'font-mono text-xs',
                                r.over ? 'text-rose' : 'text-ink-muted',
                              )}
                            >
                              {money(r.left.replace('Over by ', ''))}
                              {r.over && ' over'}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                    {/* Mobile twin: smaller ring, and min-w-0/break-words so a long
                      category name or amount can't widen the 4-up grid track. */}
                    <div className="grid grid-cols-4 gap-2.5 lg:hidden">
                      {budgetRings.map((r) => (
                        <div key={r.id} className="flex min-w-0 flex-col items-center gap-2.5">
                          <Ring size="category-mobile" fraction={r.fraction}>
                            <span className="font-mono text-sm">{r.pctLabel}</span>
                          </Ring>
                          <div className="text-center text-[12.5px] leading-tight break-words">
                            {r.categoryName}
                            <br />
                            <span
                              className={cn(
                                'font-mono text-xs',
                                r.over ? 'text-rose' : 'text-ink-muted',
                              )}
                            >
                              {money(r.left.replace('Over by ', ''))}
                              {r.over && ' over'}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>

              <div className="border-line bg-paper-raised rounded-[18px] border p-5.5">
                <div className="mb-4.5 flex items-baseline justify-between">
                  <h2 className="font-display text-base font-semibold">Spending by category</h2>
                  <span className="text-ink-muted text-xs">all expenses this month</span>
                </div>
                <ExpensePie slices={expenseBreakdown} total={hero.expense} />
              </div>

              <div className="border-line bg-paper-raised rounded-[18px] border p-5.5">
                <div className="mb-4 flex items-baseline justify-between">
                  <h2 className="font-display text-base font-semibold">By day</h2>
                  <span className="text-ink-muted font-mono text-xs">
                    click a day to inspect it
                  </span>
                </div>
                {byDayBars(
                  getByDayBars(dayBars, 'month', selectedDay.day, data.daysInMonth),
                  'hidden lg:block',
                  'month',
                )}
                {byDayBars(
                  getByDayBars(dayBars, 'week', selectedDay.day, data.daysInMonth),
                  'block lg:hidden',
                  'week',
                )}
              </div>
            </div>

            <div className="flex min-w-0 flex-col gap-5">
              <div data-testid="day-panel-desktop">
                <DayPanel
                  selectedDay={selectedDay}
                  daysInMonth={data.daysInMonth}
                  dayHref={dayHref}
                />
              </div>

              {triage.total > 0 && (
                <div className="border-iris bg-iris-soft rounded-[18px] border p-5.5">
                  <div className="flex items-baseline justify-between">
                    <h2 className="font-display text-base font-semibold">
                      {triage.total} need{triage.total === 1 ? 's' : ''} a category
                    </h2>
                    <Link href="/categorize" className="text-iris text-[13px] font-semibold">
                      Open queue →
                    </Link>
                  </div>
                  <p className="text-ink/80 mt-2 text-[13px] leading-snug">
                    Rules matched {triage.matched} of them. Confirm in a batch, and Ledger will
                    write the rule for next time.
                  </p>
                  {/* One segment per item to triage: at mobile width the inter-segment
                    gaps alone can exceed the card, so they tighten and clip. */}
                  <div className="mt-4 flex gap-0.5 overflow-hidden lg:gap-1">
                    {Array.from({ length: triage.total }).map((_, i) => (
                      <span
                        key={i}
                        className={cn(
                          'h-1.5 flex-1 rounded-full',
                          i < triage.matched ? 'bg-iris' : 'bg-paper-raised',
                        )}
                      />
                    ))}
                  </div>
                </div>
              )}

              {cycleCard && (
                <div className="border-line bg-paper-raised rounded-[18px] border p-5.5">
                  <div className="flex items-baseline justify-between">
                    <h2 className="font-display text-base font-semibold">
                      {cycleCard.accountName}
                    </h2>
                    <span className="text-ink-muted text-xs">
                      closes in {cycleCard.closesInDays} days
                    </span>
                  </div>
                  <div className="mt-2.5 font-mono text-2xl tracking-[-0.02em]">
                    {money(cycleCard.balance)}
                  </div>
                  <div className="text-ink-muted mt-1 text-[12.5px]">
                    Cycle {cycleCard.cycleLabel} ·{' '}
                    <span className="text-ink font-mono">{money(cycleCard.cycleSpend)}</span> this
                    cycle
                  </div>
                  <div className="bg-paper-sunk mt-3.5 h-1.5 overflow-hidden rounded-full">
                    <div
                      className="bg-iris h-full rounded-full"
                      style={{ width: `${Math.round(cycleCard.progress * 100)}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {dayFocus && (
        <div className="lg:hidden" data-testid="day-panel-mobile">
          <DayPanel
            selectedDay={selectedDay}
            daysInMonth={data.daysInMonth}
            dayHref={dayHref}
            ringSize="day"
            backHref={month ? `/dashboard?month=${month}` : '/dashboard'}
          />
        </div>
      )}

      <Link
        href="?overlay=add"
        className="border-line bg-iris text-paper-raised focus-visible:outline-paper-raised fixed inset-x-5 z-20 flex items-center justify-center gap-2 rounded-full py-3.5 text-sm font-semibold shadow-[0_8px_24px_rgba(0,0,0,.18)] focus-visible:outline-2 focus-visible:outline-offset-2 lg:hidden"
        style={{ bottom: 'calc(60px + env(safe-area-inset-bottom) + 12px)' }}
      >
        <Plus size={16} /> Log a spend
      </Link>
    </div>
  );
};

export default DashboardPage;
