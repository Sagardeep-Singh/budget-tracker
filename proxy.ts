import { NextResponse, type NextRequest } from 'next/server';
import { decodePeriodCookie, PERIOD_COOKIE, rangeFromSelection } from '@/lib/period-selection';
import { getCurrentMonthRange } from '@/lib/transactions/transaction-filters';

/**
 * A bare /transactions (the nav link) opens on the period last picked on any
 * screen, else the current month; a stored "All time" stays bare.
 *
 * Done here, before rendering, rather than in the page or a client effect:
 * the page renders inside `loading.tsx`'s Suspense boundary, so a `redirect()`
 * there lands after the shell has streamed and becomes a late client-side
 * navigation, and a post-hydration effect could rewrite the URL while a
 * nav-link click was already navigating away, cancelling it. Either way a
 * second navigation raced the user's.
 */
export const proxy = (request: NextRequest): NextResponse => {
  const url = request.nextUrl;
  if (url.search !== '') return NextResponse.next();

  const stored = decodePeriodCookie(request.cookies.get(PERIOD_COOKIE)?.value);
  if (stored?.kind === 'all') return NextResponse.next();

  const { from, to } = stored ? rangeFromSelection(stored) : getCurrentMonthRange();
  const target = url.clone();
  if (from) target.searchParams.set('from', from);
  if (to) target.searchParams.set('to', to);
  return NextResponse.redirect(target);
};

export const config = {
  matcher: '/transactions',
};
