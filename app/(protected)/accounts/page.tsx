import { getServerAuthSession } from '@/lib/auth/session';
import { listAccounts } from '@/lib/services/accounts';
import { AccountsView } from '@/components/accounts/accounts-view';

const AccountsPage = async (): Promise<React.ReactElement> => {
  const session = await getServerAuthSession();
  const accounts = await listAccounts(session!.user.id);

  return (
    <div className="animate-[fade-up_0.3s_ease-out]">
      <h1 className="font-display text-ink text-2xl font-semibold">Accounts</h1>
      <p className="text-ink-muted mt-1 text-sm">
        Balances are the sum of your starting balance and every transaction logged against them.
      </p>
      <AccountsView initialAccounts={accounts} />
    </div>
  );
};

export default AccountsPage;
