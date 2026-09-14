import {
  LayoutDashboard,
  Receipt,
  Tag,
  PiggyBank,
  TrendingUp,
  Wallet,
  ListFilter,
  Settings,
  Download,
} from 'lucide-react';
import type { SidebarNavItem } from '@/components/nav/sidebar-nav';
import type { NavCounts } from '@/lib/services/nav';

const navIconClassName = 'size-4 shrink-0';

/** The full nine-item primary nav, rendered in the desktop sidebar. */
export const buildSidebarItems = (counts: NavCounts): SidebarNavItem[] => [
  {
    href: '/dashboard',
    label: 'Overview',
    icon: <LayoutDashboard className={navIconClassName} />,
  },
  {
    href: '/trends',
    label: 'Trends',
    icon: <TrendingUp className={navIconClassName} />,
  },
  {
    href: '/transactions',
    label: 'Transactions',
    icon: <Receipt className={navIconClassName} />,
    badge: counts.transactions,
  },
  {
    href: '/categorize',
    label: 'Categorize',
    icon: <Tag className={navIconClassName} />,
    badge: counts.categorize,
    alert: true,
  },
  {
    href: '/budgets',
    label: 'Budgets',
    icon: <PiggyBank className={navIconClassName} />,
    badge: counts.budgets,
  },
  {
    href: '/accounts',
    label: 'Accounts',
    icon: <Wallet className={navIconClassName} />,
    badge: counts.accounts,
  },
  {
    href: '/rules',
    label: 'Rules',
    icon: <ListFilter className={navIconClassName} />,
    badge: counts.rules,
  },
  {
    href: '/import',
    label: 'Import',
    icon: <Download className={navIconClassName} />,
  },
  { href: '/settings', label: 'Settings', icon: <Settings className={navIconClassName} /> },
];

/**
 * The five items that don't get a slot in the mobile bottom nav — shown in its
 * "More" modal. Mirrors the sidebar entries above (same icons/hrefs/badges).
 */
export const buildMoreItems = (counts: NavCounts): SidebarNavItem[] => [
  {
    href: '/trends',
    label: 'Trends',
    icon: <TrendingUp className={navIconClassName} />,
  },
  {
    href: '/accounts',
    label: 'Accounts',
    icon: <Wallet className={navIconClassName} />,
    badge: counts.accounts,
  },
  {
    href: '/rules',
    label: 'Rules',
    icon: <ListFilter className={navIconClassName} />,
    badge: counts.rules,
  },
  {
    href: '/import',
    label: 'Import',
    icon: <Download className={navIconClassName} />,
  },
  { href: '/settings', label: 'Settings', icon: <Settings className={navIconClassName} /> },
];
