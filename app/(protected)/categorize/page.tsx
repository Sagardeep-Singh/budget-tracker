import Link from 'next/link';
import { getServerAuthSession } from '@/lib/auth/session';
import { getCategorizeProgress, getCategorizeQueue } from '@/lib/services/categorize';
import { listCategories } from '@/lib/services/categories';
import { getAiSettings } from '@/lib/services/aiSettings';
import { CategorizeView } from '@/components/categorize/categorize-view';
import { ScreenHeader } from '@/components/nav/screen-header';
import { DateRangePopover } from '@/components/dashboard/period-popover';
import { parseDateParam } from '@/lib/period-selection';

const CategorizePage = async ({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}): Promise<React.ReactElement> => {
  const { from, to } = await searchParams;
  const session = await getServerAuthSession();
  const userId = session!.user.id;
  const [queue, categories, progress, aiSettings] = await Promise.all([
    // No period in the URL means all time: it's a queue, so older rows must
    // stay reachable by default.
    getCategorizeQueue(userId, { from: parseDateParam(from), to: parseDateParam(to) }),
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
        periodSlot={<DateRangePopover />}
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
      {/* Keyed on the period: the view seeds its queue state from
          `initialQueue` once, so a new period must remount it. */}
      <CategorizeView
        key={`${from ?? ''}_${to ?? ''}`}
        initialQueue={queue}
        categories={categories}
        progress={progress}
        aiSettings={aiSettings}
      />
    </div>
  );
};

export default CategorizePage;
