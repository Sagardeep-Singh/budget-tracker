import { getServerAuthSession } from '@/lib/auth/session';
import { listCategoryRules } from '@/lib/services/categoryRules';
import { listCategories } from '@/lib/services/categories';
import { RulesView } from '@/components/rules/rules-view';
import { ScreenHeader } from '@/components/nav/screen-header';

const RulesPage = async (): Promise<React.ReactElement> => {
  const session = await getServerAuthSession();
  const userId = session!.user.id;
  const [{ rules, appliedToTransactionCount }, categories] = await Promise.all([
    listCategoryRules(userId),
    listCategories(userId),
  ]);

  return (
    <div className="animate-[fade-up_0.3s_ease-out]">
      <ScreenHeader
        title="Rules"
        description={`${rules.length} rule${rules.length === 1 ? '' : 's'}, applied to ${appliedToTransactionCount} transaction${appliedToTransactionCount === 1 ? '' : 's'}. When a payee matches, the category is set automatically.`}
      />
      <RulesView initialRules={rules} categories={categories} />
    </div>
  );
};

export default RulesPage;
