import Link from 'next/link';
import { getServerAuthSession } from '@/lib/auth/session';
import { getCategorizeProgress, getCategorizeQueue } from '@/lib/services/categorize';
import { listCategories } from '@/lib/services/categories';
import { getAiSettings } from '@/lib/services/aiSettings';
import { CategorizeView } from '@/components/categorize/categorize-view';
import { ScreenHeader } from '@/components/nav/screen-header';

const CategorizePage = async (): Promise<React.ReactElement> => {
  const session = await getServerAuthSession();
  const userId = session!.user.id;
  const [queue, categories, progress, aiSettings] = await Promise.all([
    getCategorizeQueue(userId),
    listCategories(userId),
    getCategorizeProgress(userId),
    // Read on the server so a deployment without SECRET_ENCRYPTION_KEY renders
    // without the Suggest affordance in the first HTML, not after a client check.
    getAiSettings(userId),
  ]);

  return (
    <div className="animate-[fade-up_0.3s_ease-out]">
      <ScreenHeader
        title="Categorize"
        description={`${queue.length} left. Grouped by payee so you can clear them in batches.`}
        actions={
          <Link
            href="/categories"
            className="border-line text-ink rounded-full border px-4 py-2 text-sm"
          >
            Manage categories
          </Link>
        }
      />
      <CategorizeView
        initialQueue={queue}
        categories={categories}
        progress={progress}
        aiSettings={aiSettings}
      />
    </div>
  );
};

export default CategorizePage;
