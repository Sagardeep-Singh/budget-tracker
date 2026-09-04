import Link from 'next/link';
import { getServerAuthSession } from '@/lib/auth/session';
import { getCategorizeQueue } from '@/lib/services/categorize';
import { listCategories } from '@/lib/services/categories';
import { CategorizeView } from '@/components/categorize/categorize-view';
import { ScreenHeader } from '@/components/nav/screen-header';

const CategorizePage = async (): Promise<React.ReactElement> => {
  const session = await getServerAuthSession();
  const userId = session!.user.id;
  const [queue, categories] = await Promise.all([
    getCategorizeQueue(userId),
    listCategories(userId),
  ]);

  return (
    <div className="animate-[fade-up_0.3s_ease-out]">
      <ScreenHeader
        title="Categorize"
        description="Confirm a category for anything the rules engine couldn't place."
        actions={
          <Link
            href="/categories"
            className="border-line text-ink rounded-full border px-4 py-2 text-sm"
          >
            Manage categories
          </Link>
        }
      />
      <CategorizeView initialQueue={queue} categories={categories} />
    </div>
  );
};

export default CategorizePage;
