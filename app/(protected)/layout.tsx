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
      <main className="flex-1 px-8 py-8">
        <div className="mx-auto max-w-4xl">{children}</div>
      </main>
    </div>
  );
};

export default ProtectedLayout;
