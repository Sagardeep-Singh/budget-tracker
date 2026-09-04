import Link from 'next/link';
import { getServerAuthSession } from '@/lib/auth/session';
import { getOverviewData } from '@/lib/services/overview';
import { ScreenHeader } from '@/components/nav/screen-header';
import { Ring } from '@/components/ui/ring';
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

const money = (value: string): string =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value));

const DashboardPage = async ({
  searchParams,
}: {
  searchParams: Promise<{ day?: string }>;
}): Promise<React.ReactElement> => {
  const { day } = await searchParams;
  const session = await getServerAuthSession();
  const userId = session!.user.id;
  const data = await getOverviewData(userId, { day: day ? Number(day) : undefined });
  const { hero, budgetRings, dayBars, selectedDay, triage, cycleCard, dailyPace } = data;

  const maxBar = Math.max(1, ...dayBars.flatMap((d) => [d.income, d.expense]));
  const barScale = (amount: number): number => Math.round((amount / maxBar) * 100);

  return (
    <div className="animate-[fade-up_0.3s_ease-out]">
      <ScreenHeader
        title="Overview"
        description="Here's where things stand this month."
        periodSlot={
          <span className="border-line bg-paper-raised text-ink flex items-center gap-2 rounded-full border px-3.5 py-2 text-[13px] font-medium">
            {monthLabel(data.month)}
            <span className="text-ink-muted text-[9px]">▼</span>
          </span>
        }
        actions={
          <>
            <Link
              href="/import"
              className="border-line text-ink rounded-full border px-4 py-2 text-sm"
            >
              Import CSV
            </Link>
            <Link
              href="/transactions"
              className="bg-iris text-paper-raised rounded-full px-4 py-2 text-sm font-semibold"
            >
              Add transaction
            </Link>
          </>
        }
      />

      <div className="mt-6.5 grid grid-cols-[1.5fr_1fr] items-start gap-5">
        <div className="flex flex-col gap-5">
          <div className="border-line bg-paper-raised rounded-[18px] border p-6.5">
            <div className="flex items-center gap-7.5">
              <Ring size="hero" fraction={hero.usedFraction}>
                <span className="font-mono text-[21px] tabular-nums">
                  {Math.round(Math.min(hero.usedFraction, 1) * 100)}%
                </span>
                <span className="text-ink-muted mt-0.5 text-[10px] tracking-[0.09em] uppercase">
                  used
                </span>
              </Ring>
              <div className="min-w-0 flex-1">
                <div className="text-ink-muted text-[11px] font-semibold tracking-[0.08em] uppercase">
                  {hero.leftLabel}
                </div>
                <div className="mt-2 font-mono text-[40px] leading-none font-medium tracking-[-0.03em]">
                  {money(hero.leftAmount)}
                </div>
                <div className="text-ink-muted mt-2 text-[13.5px]">
                  {hero.metaLine} ·{' '}
                  <span className="text-ink font-mono">{money(hero.paceAmount)}</span>{' '}
                  {hero.paceTail}
                </div>
                <div className="border-line mt-4.5 flex gap-6.5 border-t pt-4">
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
                    <div className="mt-1.5 font-mono text-lg tabular-nums">{money(hero.net)}</div>
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
              <div className="grid grid-cols-4 gap-2.5">
                {budgetRings.map((r) => (
                  <div key={r.id} className="flex flex-col items-center gap-2.5">
                    <Ring size="category" fraction={r.fraction}>
                      <span className="font-mono text-sm">{r.pctLabel}</span>
                    </Ring>
                    <div className="text-center text-[12.5px] leading-tight">
                      {r.categoryName}
                      <br />
                      <span
                        className={cn('font-mono text-xs', r.over ? 'text-rose' : 'text-ink-muted')}
                      >
                        {money(r.left.replace('Over by ', ''))}
                        {r.over && ' over'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="border-line bg-paper-raised rounded-[18px] border p-5.5">
            <div className="mb-4 flex items-baseline justify-between">
              <h2 className="font-display text-base font-semibold">By day</h2>
              <span className="text-ink-muted font-mono text-xs">click a day to inspect it</span>
            </div>
            <div className="flex h-[120px] items-end gap-1">
              {dayBars.map((d) => {
                const isSelected = d.day === selectedDay.day;
                const isOverPace = Number(dailyPace) > 0 && d.expense > Number(dailyPace);
                return (
                  <Link
                    key={d.day}
                    href={`/dashboard?day=${d.day}`}
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
              <span>Day 1</span>
              <span>Day {Math.round(data.daysInMonth / 2)}</span>
              <span>Day {data.daysInMonth}</span>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-5">
          <div className="border-line bg-paper-raised rounded-[18px] border p-5.5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-display text-[19px] font-semibold tracking-[-0.02em]">
                  {selectedDay.weekday}
                </div>
                <div className="text-ink-muted mt-0.5 text-[12.5px]">{selectedDay.dateLabel}</div>
              </div>
              <div className="flex shrink-0 gap-1">
                <Link
                  href={`/dashboard?day=${Math.max(selectedDay.day - 1, 1)}`}
                  className="border-line text-ink-muted flex size-7.5 items-center justify-center rounded-full border text-sm"
                >
                  ‹
                </Link>
                <Link
                  href={`/dashboard?day=${Math.min(selectedDay.day + 1, data.daysInMonth)}`}
                  className="border-line text-ink-muted flex size-7.5 items-center justify-center rounded-full border text-sm"
                >
                  ›
                </Link>
              </div>
            </div>

            <div className="mt-4.5 flex items-center gap-5">
              <Ring size="budget" fraction={selectedDay.fraction} alertAt={1}>
                <span className="font-mono text-sm">
                  {Math.round(Math.min(selectedDay.fraction, 1) * 100)}%
                </span>
                <span className="text-ink-muted text-[9px] tracking-[0.08em] uppercase">
                  of pace
                </span>
              </Ring>
              <div className="min-w-0">
                <div className="text-ink-muted text-[10.5px] font-semibold tracking-[0.08em] uppercase">
                  Spent
                </div>
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
                    <span
                      className={cn(
                        'shrink-0 font-mono text-[13.5px] tabular-nums',
                        row.tone === 'income' ? 'text-sky' : 'text-rose',
                      )}
                    >
                      {row.tone === 'income' ? '+' : '-'}
                      {money(row.amount)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="border-line text-ink-muted mt-4 border-t pt-4.5 text-center text-[13px]">
                Nothing logged this day.
              </div>
            )}
          </div>

          {triage.total > 0 && (
            <div className="border-iris bg-iris-soft rounded-[18px] border p-5.5">
              <div className="flex items-baseline justify-between">
                <h2 className="font-display text-base font-semibold">
                  {triage.total} need{triage.total === 1 ? 's' : ''} a category
                </h2>
                <Link href="/categories" className="text-iris text-[13px] font-semibold">
                  Open queue →
                </Link>
              </div>
              <p className="text-ink/80 mt-2 text-[13px] leading-snug">
                Rules matched {triage.matched} of them. Confirm in a batch, and Ledger will write
                the rule for next time.
              </p>
              <div className="mt-4 flex gap-1">
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
                <h2 className="font-display text-base font-semibold">{cycleCard.accountName}</h2>
                <span className="text-ink-muted text-xs">
                  closes in {cycleCard.closesInDays} days
                </span>
              </div>
              <div className="mt-2.5 font-mono text-2xl tracking-[-0.02em]">
                {money(cycleCard.balance)}
              </div>
              <div className="text-ink-muted mt-1 text-[12.5px]">
                Cycle {cycleCard.cycleLabel} ·{' '}
                <span className="text-ink font-mono">{money(cycleCard.cycleSpend)}</span> this cycle
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
    </div>
  );
};

export default DashboardPage;
