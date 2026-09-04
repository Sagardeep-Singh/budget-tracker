import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { getServerAuthSession } from '@/lib/auth/session';
import { Sidebar } from '@/components/nav/sidebar';
import { AddTransactionOverlay } from '@/components/transactions/add-transaction-overlay';
import { listAccounts } from '@/lib/services/accounts';
import { listCategories } from '@/lib/services/categories';

const ProtectedLayout = async ({
  children,
}: {
  children: React.ReactNode;
}): Promise<React.ReactElement> => {
  const session = await getServerAuthSession();
  if (!session?.user) {
    redirect('/login');
  }

  const [accounts, categories] = await Promise.all([
    listAccounts(session.user.id),
    listCategories(session.user.id),
  ]);

  return (
    <div className="bg-paper flex min-h-screen">
      <Sidebar />
      <main className="min-w-0 flex-1 px-10 pt-8.5 pb-14">
        <div className="mx-auto max-w-[1120px] min-w-[960px]">{children}</div>
      </main>
      <Suspense fallback={null}>
        <AddTransactionOverlay accounts={accounts} categories={categories} />
      </Suspense>
    </div>
  );
};

export default ProtectedLayout;
