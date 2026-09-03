import { getServerAuthSession } from '@/lib/auth/session';
import { getDashboardSummary } from '@/lib/services/dashboard';
import { listBudgets } from '@/lib/services/budgets';
import { Card } from '@/components/ui/card';
import { Money } from '@/components/ui/money';
import { BudgetBar } from '@/components/budgets/budget-bar';
import { formatDate } from '@/lib/format';

const MONTH_LABEL = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  month: 'long',
  year: 'numeric',
});

const monthLabel = (month: number): string => {
  const date = new Date(Date.UTC(Math.floor(month / 100), (month % 100) - 1, 1));
  return MONTH_LABEL.format(date);
};

const DashboardPage = async (): Promise<React.ReactElement> => {
  const session = await getServerAuthSession();
  const userId = session!.user.id;
  const [summary, budgets] = await Promise.all([
    getDashboardSummary(userId),
    listBudgets(
      userId,
      (() => {
        const now = new Date();
        return now.getUTCFullYear() * 100 + (now.getUTCMonth() + 1);
      })(),
    ),
  ]);

  return (
    <div className="animate-[fade-up_0.3s_ease-out]">
      <h1 className="font-display text-ink text-2xl font-semibold">{monthLabel(summary.month)}</h1>
      <p className="text-ink-muted mt-1 text-sm">Here&apos;s where things stand this month.</p>

      <div className="mt-6 grid grid-cols-3 gap-4">
        <Card>
          <div className="text-ink-muted text-xs font-medium">Income</div>
          <Money value={summary.income} tone="income" className="mt-2 block text-2xl" />
        </Card>
        <Card>
          <div className="text-ink-muted text-xs font-medium">Expenses</div>
          <Money value={summary.expense} tone="expense" className="mt-2 block text-2xl" />
        </Card>
        <Card>
          <div className="text-ink-muted text-xs font-medium">Net</div>
          <Money
            value={summary.net}
            tone={Number(summary.net) >= 0 ? 'income' : 'expense'}
            className="mt-2 block text-2xl"
          />
        </Card>
      </div>

      <div className="mt-8 grid grid-cols-2 gap-6">
        <Card>
          <h2 className="font-display text-ink text-base font-semibold">Budgets</h2>
          {budgets.length === 0 ? (
            <p className="text-ink-muted mt-3 text-sm">
              No budgets set for this month yet. Set one from the Budgets page.
            </p>
          ) : (
            <div className="mt-4 flex flex-col gap-4">
              {budgets.map((b) => (
                <BudgetBar key={b.id} budget={b} />
              ))}
            </div>
          )}
        </Card>

        <Card className="p-0">
          <h2 className="font-display text-ink px-6 pt-6 text-base font-semibold">
            Recent transactions
          </h2>
          {summary.recent.length === 0 ? (
            <p className="text-ink-muted px-6 py-6 text-sm">Nothing logged yet.</p>
          ) : (
            <div className="mt-3">
              {summary.recent.map((t) => (
                <div key={t.id} className="ledger-row flex items-center justify-between px-6 py-3">
                  <div>
                    <div className="text-ink text-sm">
                      {t.payee || t.categoryName || 'Transaction'}
                    </div>
                    <div className="text-ink-muted text-xs">
                      {formatDate(t.date)} · {t.categoryName ?? 'Uncategorized'}
                    </div>
                  </div>
                  <Money value={t.amount} tone={t.type === 'INCOME' ? 'income' : 'expense'} />
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
};

export default DashboardPage;
