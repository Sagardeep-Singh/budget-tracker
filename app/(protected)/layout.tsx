import { redirect } from 'next/navigation';
import { getServerAuthSession } from '@/lib/auth/session';
import { Sidebar } from '@/components/nav/sidebar';

const ProtectedLayout = async ({
  children,
}: {
  children: React.ReactNode;
}): Promise<React.ReactElement> => {
  const session = await getServerAuthSession();
  if (!session?.user) {
    redirect('/login');
  }

  return (
    <div className="bg-paper flex min-h-screen">
      <Sidebar />
      <main className="min-w-0 flex-1 px-10 pt-8.5 pb-14">
        <div className="mx-auto max-w-[1120px] min-w-[960px]">{children}</div>
      </main>
    </div>
  );
};

export default ProtectedLayout;
