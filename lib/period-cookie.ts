import { cookies } from 'next/headers';
import { decodePeriodCookie, PERIOD_COOKIE, type PeriodSelection } from '@/lib/period-selection';

/** Server-side read of the shared period selection (see `PERIOD_COOKIE`). */
export const getStoredPeriod = async (): Promise<PeriodSelection | null> => {
  const store = await cookies();
  return decodePeriodCookie(store.get(PERIOD_COOKIE)?.value);
};
