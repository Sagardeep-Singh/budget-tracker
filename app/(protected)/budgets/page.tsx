import { getServerAuthSession } from '@/lib/auth/session';
import { listBudgets } from '@/lib/services/budgets';
import { listCategories } from '@/lib/services/categories';
import { BudgetsView } from '@/components/budgets/budgets-view';

const currentMonth = (): number => {
  const now = new Date();
  return now.getUTCFullYear() * 100 + (now.getUTCMonth() + 1);
};

const BudgetsPage = async (): Promise<React.ReactElement> => {
  const session = await getServerAuthSession();
  const userId = session!.user.id;
  const month = currentMonth();
  const [budgets, categories] = await Promise.all([
    listBudgets(userId, month),
    listCategories(userId),
  ]);

  return (
    <div className="animate-[fade-up_0.3s_ease-out]">
      <h1 className="font-display text-ink text-2xl font-semibold">Budgets</h1>
      <p className="text-ink-muted mt-1 text-sm">Set a monthly limit per category and track it.</p>
      <BudgetsView initialBudgets={budgets} categories={categories} month={month} />
    </div>
  );
};

export default BudgetsPage;
