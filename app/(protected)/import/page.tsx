import { getServerAuthSession } from '@/lib/auth/session';
import { listAccounts } from '@/lib/services/accounts';
import { listCategories } from '@/lib/services/categories';
import { ImportView } from '@/components/import/import-view';

const ImportPage = async (): Promise<React.ReactElement> => {
  const session = await getServerAuthSession();
  const userId = session!.user.id;
  const [accounts, categories] = await Promise.all([listAccounts(userId), listCategories(userId)]);

  return (
    <div className="animate-[fade-up_0.3s_ease-out]">
      <h1 className="font-display text-ink text-2xl font-semibold">Import from CSV</h1>
      <p className="text-ink-muted mt-1 text-sm">
        Upload a CSV, map its columns, review the auto-categorized preview, then commit.
      </p>
      <ImportView accounts={accounts} categories={categories} />
    </div>
  );
};

export default ImportPage;
