'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';

export type SidebarNavItem = {
  href: string;
  label: string;
  badge?: number;
  /** Categorize is treated as an alert queue: its badge tints rose when inactive. */
  alert?: boolean;
};

export const SidebarNav = ({ items }: { items: SidebarNavItem[] }): React.ReactElement => {
  const pathname = usePathname();

  return (
    <div className="flex flex-col gap-0.5">
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'flex items-center justify-between gap-2 rounded-full px-3 py-2.5 text-sm font-medium transition-colors',
              active ? 'bg-iris text-paper-raised' : 'text-ink hover:bg-paper',
            )}
          >
            <span>{item.label}</span>
            {item.badge !== undefined && (
              <span
                className={cn(
                  'rounded-full px-1.5 py-0.5 font-mono text-[11px] tabular-nums',
                  active
                    ? 'bg-paper-raised/20 text-paper-raised'
                    : item.alert
                      ? 'bg-rose-soft text-rose'
                      : 'bg-paper-sunk text-ink-muted',
                )}
              >
                {item.badge}
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
};
