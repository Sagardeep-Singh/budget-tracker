import { getServerAuthSession } from '@/lib/auth/session';
import { listBudgets } from '@/lib/services/budgets';
import { listCategories } from '@/lib/services/categories';
import { getUncategorizedMonthSummary } from '@/lib/services/categorize';
import { BudgetsView } from '@/components/budgets/budgets-view';
import { ScreenHeader } from '@/components/nav/screen-header';
import { PeriodPopover } from '@/components/dashboard/period-popover';

const currentMonth = (): number => {
  const now = new Date();
  return now.getUTCFullYear() * 100 + (now.getUTCMonth() + 1);
};

const BudgetsPage = async ({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}): Promise<React.ReactElement> => {
  const { month: monthParam } = await searchParams;
  const session = await getServerAuthSession();
  const userId = session!.user.id;
  const month = monthParam ? Number(monthParam) : currentMonth();
  const [budgets, categories, uncategorized] = await Promise.all([
    listBudgets(userId, month),
    listCategories(userId),
    getUncategorizedMonthSummary(userId, month),
  ]);

  return (
    <div className="animate-[fade-up_0.3s_ease-out]">
      <ScreenHeader
        title="Budgets"
        description="A monthly limit per category. Status follows the limit, not the calendar."
        periodSlot={<PeriodPopover month={month} basePath="/budgets" />}
      />
      <BudgetsView
        initialBudgets={budgets}
        categories={categories}
        month={month}
        uncategorized={uncategorized}
      />
    </div>
  );
};

export default BudgetsPage;
