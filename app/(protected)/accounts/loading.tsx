import { ScreenHeader } from '@/components/nav/screen-header';
import { ScreenLoading } from '@/components/ui/screen-loading';

const AccountsLoading = (): React.ReactElement => (
  <div>
    <ScreenHeader
      title="Accounts"
      description="Balances are the sum of your starting balance and every transaction logged against them."
    />
    <ScreenLoading rows={2} />
  </div>
);

export default AccountsLoading;
