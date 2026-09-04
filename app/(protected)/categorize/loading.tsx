import { ScreenHeader } from '@/components/nav/screen-header';
import { ScreenLoading } from '@/components/ui/screen-loading';

const CategorizeLoading = (): React.ReactElement => (
  <div>
    <ScreenHeader
      title="Categorize"
      description="Confirm a category for anything the rules engine couldn't place."
    />
    <ScreenLoading />
  </div>
);

export default CategorizeLoading;
