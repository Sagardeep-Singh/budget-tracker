'use client';

import { useCallback } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Drawer } from '@/components/ui/drawer';
import { TransactionForm } from '@/components/transactions/transaction-form';
import { LogASpendMobile } from '@/components/transactions/log-a-spend-mobile';
import type { FrontendAccount } from '@/lib/services/accounts';
import type { FrontendCategory } from '@/lib/services/categories';

/**
 * The sidebar's "+ Log a transaction" opens this from any screen via
 * ?overlay=add — URL-driven so no context provider is needed and the
 * back button closes it, consistent with Overview's ?day=N pattern.
 */
export const AddTransactionOverlay = ({
  accounts,
  categories,
}: {
  accounts: FrontendAccount[];
  categories: FrontendCategory[];
}): React.ReactElement => {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const open = searchParams.get('overlay') === 'add';

  // Memoized: LogASpendMobile's focus-trap/scroll-lock effect depends on
  // this identity — a new function on every render would tear down and
  // re-run that effect on any parent re-render (e.g. router.refresh()),
  // re-locking scroll and yanking focus back to the close button mid-entry.
  const close = useCallback((): void => {
    router.push(pathname);
  }, [router, pathname]);

  // Same ?overlay=add contract, two shells: the desktop drawer and the
  // mobile full-screen keypad screen. Both gate their contents on `open` so
  // the mobile shell's local state resets on every open.
  return (
    <>
      <div className="hidden lg:block">
        <Drawer open={open} onClose={close} title="Log a transaction">
          {open && <TransactionForm accounts={accounts} categories={categories} onDone={close} />}
        </Drawer>
      </div>
      <div className="lg:hidden">
        {open && <LogASpendMobile accounts={accounts} categories={categories} onDone={close} />}
      </div>
    </>
  );
};
