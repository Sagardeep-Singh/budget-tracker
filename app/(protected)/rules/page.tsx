import { getServerAuthSession } from '@/lib/auth/session';
import { listCategoryRules } from '@/lib/services/categoryRules';
import { listCategories } from '@/lib/services/categories';
import { RulesView } from '@/components/rules/rules-view';

const RulesPage = async (): Promise<React.ReactElement> => {
  const session = await getServerAuthSession();
  const userId = session!.user.id;
  const [rules, categories] = await Promise.all([
    listCategoryRules(userId),
    listCategories(userId),
  ]);

  return (
    <div className="animate-[fade-up_0.3s_ease-out]">
      <h1 className="font-display text-ink text-2xl font-semibold">Categorization rules</h1>
      <p className="text-ink-muted mt-1 text-sm">
        When a payee or note contains the match text, the transaction is auto-assigned to that
        category. Lower priority number wins when more than one rule matches. Applies to new
        transactions and CSV imports; you can always override the suggestion.
      </p>
      <RulesView initialRules={rules} categories={categories} />
    </div>
  );
};

export default RulesPage;
