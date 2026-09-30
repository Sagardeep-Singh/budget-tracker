import { daysInMonth } from '@/lib/date';
import type { Period } from '@/lib/statement';

/**
 * What the shared period selector has picked. Month-only pages (Overview,
 * Budgets, Trends) only ever produce `month`; Transactions and Categorize
 * also allow `all` and `custom`, stored in the URL as `from`/`to`
 * (yyyy-mm-dd, both inclusive).
 */
export type PeriodSelection =
  | { kind: 'all' }
  | { kind: 'month'; month: number }
  | { kind: 'custom'; from: string | null; to: string | null };

export type DateRange = { from: string | null; to: string | null };

const pad2 = (n: number): string => String(n).padStart(2, '0');

const DATE_PARAM = /^\d{4}-\d{2}-\d{2}$/;

/** A `yyyy-mm-dd` string that is a real calendar date, else null — a
 * hand-edited URL must fall back to "no bound", never throw. */
export const parseDateParam = (value: string | null | undefined): string | null => {
  if (!value || !DATE_PARAM.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : value;
};

/** First and last day (inclusive) of a `YYYYMM` month as yyyy-mm-dd. */
export const monthToRange = (month: number): { from: string; to: string } => {
  const year = Math.floor(month / 100);
  const m = month % 100;
  return {
    from: `${year}-${pad2(m)}-01`,
    to: `${year}-${pad2(m)}-${pad2(daysInMonth(month))}`,
  };
};

/** A half-open `Period` (end exclusive) as an inclusive yyyy-mm-dd range. */
export const periodToRange = (period: Period): { from: string; to: string } => ({
  from: period.start.toISOString().slice(0, 10),
  to: new Date(period.end.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
});

/** Reads a `from`/`to` pair back as a selection: nothing set is all time, an
 * exact calendar month is that month, anything else is a custom range. */
export const selectionFromRange = ({ from, to }: DateRange): PeriodSelection => {
  if (!from && !to) return { kind: 'all' };
  if (from && to && from.endsWith('-01') && from.slice(0, 7) === to.slice(0, 7)) {
    const month = Number(from.slice(0, 4)) * 100 + Number(from.slice(5, 7));
    if (monthToRange(month).to === to) return { kind: 'month', month };
  }
  return { kind: 'custom', from, to };
};

export const rangeFromSelection = (selection: PeriodSelection): DateRange => {
  if (selection.kind === 'all') return { from: null, to: null };
  if (selection.kind === 'month') return monthToRange(selection.month);
  return { from: selection.from, to: selection.to };
};

/** Half-open UTC bounds for a Prisma `date` filter; a missing side is open. */
export const rangeToDates = ({ from, to }: DateRange): { gte?: Date; lt?: Date } => {
  const bounds: { gte?: Date; lt?: Date } = {};
  if (from) bounds.gte = new Date(`${from}T00:00:00Z`);
  if (to) bounds.lt = new Date(new Date(`${to}T00:00:00Z`).getTime() + 24 * 60 * 60 * 1000);
  return bounds;
};

const MONTH_LABEL = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  month: 'long',
  year: 'numeric',
});
const DAY_LABEL = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  month: 'short',
  day: 'numeric',
});
const DAY_YEAR_LABEL = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

export const monthLabel = (month: number): string =>
  MONTH_LABEL.format(new Date(Date.UTC(Math.floor(month / 100), (month % 100) - 1, 1)));

const toDate = (value: string): Date => new Date(`${value}T00:00:00Z`);

/** The selector pill's text: "September 2026", "All time", "Sep 3 – Sep 20, 2026". */
export const periodSelectionLabel = (selection: PeriodSelection): string => {
  if (selection.kind === 'all') return 'All time';
  if (selection.kind === 'month') return monthLabel(selection.month);
  const { from, to } = selection;
  if (from && to) {
    const sameYear = from.slice(0, 4) === to.slice(0, 4);
    const start = (sameYear ? DAY_LABEL : DAY_YEAR_LABEL).format(toDate(from));
    return `${start} – ${DAY_YEAR_LABEL.format(toDate(to))}`;
  }
  if (from) return `From ${DAY_YEAR_LABEL.format(toDate(from))}`;
  return `Until ${DAY_YEAR_LABEL.format(toDate(to!))}`;
};
