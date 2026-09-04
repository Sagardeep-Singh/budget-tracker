'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';
import { signOutAction } from '@/lib/auth/actions';

const LINKS = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/transactions', label: 'Transactions' },
  { href: '/accounts', label: 'Accounts' },
  { href: '/categories', label: 'Categories' },
  { href: '/budgets', label: 'Budgets' },
  { href: '/rules', label: 'Rules' },
] as const;

export const Sidebar = (): React.ReactElement => {
  const pathname = usePathname();

  return (
    <nav className="border-line bg-paper-raised flex w-56 shrink-0 flex-col gap-1 border-r px-4 py-6">
      <div className="font-display text-ink mb-6 px-2 text-lg font-semibold tracking-tight">
        Ledger
      </div>
      {LINKS.map((link) => {
        const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <Link
            key={link.href}
            href={link.href}
            className={cn(
              'rounded-full px-3 py-2 text-sm font-medium transition-colors',
              active ? 'bg-iris text-paper-raised' : 'text-ink-muted hover:bg-paper',
            )}
          >
            {link.label}
          </Link>
        );
      })}
      <form action={signOutAction} className="mt-auto px-2 pt-6">
        <button type="submit" className="text-ink-muted hover:text-rose text-xs">
          Sign out
        </button>
      </form>
    </nav>
  );
};
