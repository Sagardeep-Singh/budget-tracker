'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Modal } from '@/components/ui/modal';
import { TransactionForm } from '@/components/transactions/transaction-form';
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

  const close = (): void => {
    router.push(pathname);
  };

  return (
    <Modal open={open} onClose={close} title="Log a transaction" className="max-w-[520px]">
      {open && <TransactionForm accounts={accounts} categories={categories} onDone={close} />}
    </Modal>
  );
};
