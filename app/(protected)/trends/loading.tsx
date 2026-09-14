import { ScreenHeader } from '@/components/nav/screen-header';
import { ScreenLoading } from '@/components/ui/screen-loading';

const TrendsLoading = (): React.ReactElement => (
  <div>
    <ScreenHeader title="Trends" description="How your spending is changing over time." />
    <ScreenLoading />
  </div>
);

export default TrendsLoading;
