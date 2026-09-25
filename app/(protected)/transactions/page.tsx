import { getServerAuthSession } from '@/lib/auth/session';
import { getTransactionsPage } from '@/lib/services/transactionsPage';
import { listAccounts } from '@/lib/services/accounts';
import { listCategories } from '@/lib/services/categories';
import { parseTransactionFilters } from '@/lib/transactions/transaction-filters';
import type { TransactionScope } from '@/lib/transactions/transaction-scope';
import {
  TRANSACTIONS_PAGE_SIZE,
  transactionsPageSearchParams,
} from '@/lib/transactions/transactions-page-query';
import { TransactionsView } from '@/components/transactions/transactions-view';
import { ScreenHeader } from '@/components/nav/screen-header';

/** App Router hands over plain values; the filter parser reads a URLSearchParams (first value wins). */
const toUrlSearchParams = (raw: Record<string, string | string[] | undefined>): URLSearchParams => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (first !== undefined) params.set(key, first);
  }
  return params;
};

const TransactionsPage = async ({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.ReactElement> => {
  const session = await getServerAuthSession();
  const userId = session!.user.id;
  // Page 1 of the URL's filters; period and mobile params are local view state,
  // so a fresh load always starts at their defaults.
  const scope: TransactionScope = {
    filters: parseTransactionFilters(toUrlSearchParams(await searchParams)),
    period: null,
    mobileSearch: '',
    quickFilter: 'all',
  };
  const [initialPage, accounts, categories] = await Promise.all([
    getTransactionsPage(userId, { ...scope, limit: TRANSACTIONS_PAGE_SIZE }),
    listAccounts(userId),
    listCategories(userId),
  ]);

  return (
    <div className="animate-[fade-up_0.3s_ease-out]">
      <ScreenHeader title="Transactions" description="Every dollar in and out, in one ledger." />
      <TransactionsView
        initialPage={initialPage}
        initialRequestKey={transactionsPageSearchParams(scope).toString()}
        accounts={accounts}
        categories={categories}
      />
    </div>
  );
};

export default TransactionsPage;
