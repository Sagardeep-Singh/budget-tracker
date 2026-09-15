import type { Metadata } from 'next';
import Link from 'next/link';
import { WifiOff } from 'lucide-react';

export const metadata: Metadata = { title: 'Offline — Ledger' };

/**
 * The service worker's navigation fallback. Lives outside `(protected)` on
 * purpose: it's precached and served with no network, so it must render without a
 * session — and it deliberately shows no data of any kind.
 */
const OfflinePage = (): React.ReactElement => (
  <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
    <WifiOff className="text-ink-muted size-8" aria-hidden />
    <h1 className="font-display text-xl font-semibold">You&rsquo;re offline</h1>
    <p className="text-ink-muted max-w-sm text-[13.5px]">
      Ledger needs a connection to show your accounts and transactions. Reconnect and try again —
      nothing you&rsquo;ve already saved is lost.
    </p>
    <Link
      href="/dashboard"
      className="border-line bg-paper-raised rounded-full border px-4 py-2 text-[13px] font-medium"
    >
      Try again
    </Link>
  </main>
);

export default OfflinePage;
