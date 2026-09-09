import { ScreenHeader } from '@/components/nav/screen-header';
import { ScreenLoading } from '@/components/ui/screen-loading';

const TransactionsLoading = (): React.ReactElement => (
  <div>
    <ScreenHeader title="Transactions" description="Every dollar in and out, in one ledger." />
    <ScreenLoading />
  </div>
);

export default TransactionsLoading;
