import { ScreenHeader } from '@/components/nav/screen-header';
import { ScreenLoading } from '@/components/ui/screen-loading';

const BudgetsLoading = (): React.ReactElement => (
  <div>
    <ScreenHeader title="Budgets" description="Set a monthly limit per category and track it." />
    <ScreenLoading />
  </div>
);

export default BudgetsLoading;
