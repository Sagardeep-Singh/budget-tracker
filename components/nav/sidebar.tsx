import Link from 'next/link';
import { LogOut, Plus } from 'lucide-react';
import { signOutAction } from '@/lib/auth/actions';
import { SidebarNav } from '@/components/nav/sidebar-nav';
import { LogoMark } from '@/components/ui/logo-mark';
import { buildSidebarItems } from '@/lib/nav/items';
import type { FrontendAccount } from '@/lib/services/accounts';
import type { NavCounts } from '@/lib/services/nav';

export const Sidebar = ({
  accounts,
  counts,
}: {
  accounts: FrontendAccount[];
  counts: NavCounts;
}): React.ReactElement => {
  const navItems = buildSidebarItems(counts);

  return (
    <nav
      aria-label="Primary"
      className="border-line bg-paper-raised sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r px-4 py-6.5 lg:flex"
    >
      <div className="font-display text-ink mb-5.5 flex items-center gap-2 px-2 text-lg font-semibold tracking-tight">
        <LogoMark size={22} />
        Ledger
      </div>
      <Link
        href="?overlay=add"
        className="bg-iris text-paper-raised mb-5 flex items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold"
      >
        <Plus size={16} /> Log a transaction
      </Link>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <SidebarNav items={navItems} />
      </div>

      <div className="border-line mt-auto shrink-0 border-t pt-6">
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
            <button
              type="submit"
              className="text-ink-muted hover:text-ink focus-visible:outline-iris inline-flex cursor-pointer items-center gap-1 rounded text-xs transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              <LogOut size={13} />
              Sign out
            </button>
          </form>
        </div>
      </div>
    </nav>
  );
};
