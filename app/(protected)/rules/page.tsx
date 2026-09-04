import { getServerAuthSession } from '@/lib/auth/session';
import { listCategoryRules } from '@/lib/services/categoryRules';
import { listCategories } from '@/lib/services/categories';
import { RulesView } from '@/components/rules/rules-view';
import { ScreenHeader } from '@/components/nav/screen-header';

const RulesPage = async (): Promise<React.ReactElement> => {
  const session = await getServerAuthSession();
  const userId = session!.user.id;
  const [rules, categories] = await Promise.all([
    listCategoryRules(userId),
    listCategories(userId),
  ]);

  return (
    <div className="animate-[fade-up_0.3s_ease-out]">
      <ScreenHeader
        title="Rules"
        description="When a payee or note contains the match text, the transaction is auto-assigned to that category. Lower priority number wins when more than one rule matches."
      />
      <RulesView initialRules={rules} categories={categories} />
    </div>
  );
};

export default RulesPage;
