import { getServerAuthSession } from '@/lib/auth/session';
import { listAccounts } from '@/lib/services/accounts';
import { AccountsView } from '@/components/accounts/accounts-view';
import { ScreenHeader } from '@/components/nav/screen-header';

const AccountsPage = async (): Promise<React.ReactElement> => {
  const session = await getServerAuthSession();
  const accounts = await listAccounts(session!.user.id);

  return (
    <div className="animate-[fade-up_0.3s_ease-out]">
      <ScreenHeader
        title="Accounts"
        description="Balances are the sum of your starting balance and every transaction logged against them."
      />
      <AccountsView initialAccounts={accounts} />
    </div>
  );
};

export default AccountsPage;
