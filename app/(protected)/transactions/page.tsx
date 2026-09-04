import { getServerAuthSession } from '@/lib/auth/session';
import { listTransactions } from '@/lib/services/transactions';
import { listAccounts } from '@/lib/services/accounts';
import { listCategories } from '@/lib/services/categories';
import { TransactionsView } from '@/components/transactions/transactions-view';
import { ScreenHeader } from '@/components/nav/screen-header';

const TransactionsPage = async (): Promise<React.ReactElement> => {
  const session = await getServerAuthSession();
  const userId = session!.user.id;
  const [transactions, accounts, categories] = await Promise.all([
    listTransactions(userId, {}),
    listAccounts(userId),
    listCategories(userId),
  ]);

  return (
    <div className="animate-[fade-up_0.3s_ease-out]">
      <ScreenHeader title="Transactions" description="Every dollar in and out, in one ledger." />
      <TransactionsView
        initialTransactions={transactions}
        accounts={accounts}
        categories={categories}
      />
    </div>
  );
};

export default TransactionsPage;
