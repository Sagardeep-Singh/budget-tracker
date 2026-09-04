import Link from 'next/link';
import { getServerAuthSession } from '@/lib/auth/session';
import { getNavCounts } from '@/lib/services/nav';
import { listAccounts } from '@/lib/services/accounts';
import { signOutAction } from '@/lib/auth/actions';
import { SidebarNav, type SidebarNavItem } from '@/components/nav/sidebar-nav';

export const Sidebar = async (): Promise<React.ReactElement> => {
  const session = await getServerAuthSession();
  const userId = session!.user.id;
  const [counts, accounts] = await Promise.all([getNavCounts(userId), listAccounts(userId)]);

  const navItems: SidebarNavItem[] = [
    { href: '/dashboard', label: 'Overview' },
    { href: '/transactions', label: 'Transactions', badge: counts.transactions },
    { href: '/categorize', label: 'Categorize', badge: counts.categorize, alert: true },
    { href: '/budgets', label: 'Budgets', badge: counts.budgets },
    { href: '/accounts', label: 'Accounts', badge: counts.accounts },
    { href: '/rules', label: 'Rules', badge: counts.rules },
    { href: '/settings', label: 'Settings' },
  ];

  return (
    <nav className="border-line bg-paper-raised flex w-60 shrink-0 flex-col border-r px-4 py-6.5">
      <div className="font-display text-ink mb-5.5 px-2 text-lg font-semibold tracking-tight">
        Ledger
      </div>
      <Link
        href="?overlay=add"
        className="bg-iris text-paper-raised mb-5 flex items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold"
      >
        <span className="text-base leading-none">+</span> Log a transaction
      </Link>

      <SidebarNav items={navItems} />

      <div className="border-line mt-auto border-t pt-6">
        <div className="px-1">
          <div className="text-ink-muted text-[11px] font-semibold tracking-[0.08em] uppercase">
            Accounts
          </div>
          {accounts.slice(0, 3).map((account, i) => (
            <div
              key={account.id}
              className={
                i < Math.min(accounts.length, 3) - 1
                  ? 'border-line flex items-baseline justify-between gap-2 border-b py-2.5'
                  : 'flex items-baseline justify-between gap-2 py-2.5'
              }
            >
              <span className="text-ink truncate text-sm">{account.name}</span>
              <span className="text-ink-muted font-mono text-xs tabular-nums">
                {account.balance}
              </span>
            </div>
          ))}
          <form action={signOutAction} className="pt-3.5">
            <button type="submit" className="text-ink-muted text-xs">
              Sign out
            </button>
          </form>
        </div>
      </div>
    </nav>
  );
};
