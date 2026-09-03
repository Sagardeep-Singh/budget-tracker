/**
 * Statement period convention: a statement closes on `statementDay` of each
 * month. The period covering a given close date runs from the day after the
 * previous close date through `statementDay` of the closing month,
 * inclusive. E.g. statementDay=15: the statement closing 2026-03-15 covers
 * 2026-02-16 through 2026-03-15 (end is exclusive as returned here, i.e.
 * 2026-03-16T00:00:00Z, so callers can use `date >= start && date < end`).
 */
export type Period = { start: Date; end: Date };

const atUtcMidnight = (year: number, month: number, day: number): Date =>
  new Date(Date.UTC(year, month, day));

/**
 * The statement period whose close date falls in the same month as
 * `referenceDate` (or the next one, if `referenceDate` is past this month's
 * close day).
 */
export const getStatementPeriod = (statementDay: number, referenceDate: Date): Period => {
  const year = referenceDate.getUTCFullYear();
  const month = referenceDate.getUTCMonth();
  const day = referenceDate.getUTCDate();

  const closeMonth = day > statementDay ? month + 1 : month;
  const end = atUtcMidnight(year, closeMonth, statementDay + 1);
  const start = atUtcMidnight(year, closeMonth - 1, statementDay + 1);

  return { start, end };
};

export const getPreviousStatementPeriod = (statementDay: number, period: Period): Period => {
  // one day before `period.start` always falls in the previous period
  const reference = new Date(period.start.getTime() - 24 * 60 * 60 * 1000);
  return getStatementPeriod(statementDay, reference);
};

export const getNextStatementPeriod = (statementDay: number, period: Period): Period => {
  // `period.end` (the day after close) always falls in the next period
  return getStatementPeriod(statementDay, period.end);
};

/** `month` as YYYYMM, e.g. 202603 for March 2026. */
export const getCalendarMonthPeriod = (month: number): Period => {
  const year = Math.floor(month / 100);
  const monthIndex = (month % 100) - 1;
  return {
    start: atUtcMidnight(year, monthIndex, 1),
    end: atUtcMidnight(year, monthIndex + 1, 1),
  };
};
