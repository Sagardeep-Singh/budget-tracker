import { ScreenHeader } from '@/components/nav/screen-header';
import { ScreenLoading } from '@/components/ui/screen-loading';

const RulesLoading = (): React.ReactElement => (
  <div>
    <ScreenHeader
      title="Rules"
      description="When a payee or note contains the match text, the transaction is auto-assigned to that category. Lower priority number wins when more than one rule matches."
    />
    <ScreenLoading />
  </div>
);

export default RulesLoading;
