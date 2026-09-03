// `toLocaleDateString()` depends on the runtime's locale/timezone, which can
// differ between the server (SSR) and the browser (hydration) and causes a
// hydration mismatch. Pin locale and timeZone explicitly so the output is
// identical everywhere. Transaction dates are stored as UTC midnight, so
// formatting in UTC shows the calendar date the user entered, not a day
// shifted by the viewer's local offset.
const DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  month: 'numeric',
  day: 'numeric',
  year: 'numeric',
});

export const formatDate = (date: string | Date): string =>
  DATE_FORMATTER.format(typeof date === 'string' ? new Date(date) : date);
