import { redirect } from 'next/navigation';
import { getServerAuthSession } from '@/lib/auth/session';

const RootPage = async (): Promise<never> => {
  const session = await getServerAuthSession();
  redirect(session?.user ? '/dashboard' : '/login');
};

export default RootPage;
