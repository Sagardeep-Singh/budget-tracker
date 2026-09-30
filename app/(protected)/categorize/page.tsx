import Link from 'next/link';
import { getServerAuthSession } from '@/lib/auth/session';
import { getCategorizeProgress, getCategorizeQueue } from '@/lib/services/categorize';
import { listCategories } from '@/lib/services/categories';
import { getAiSettings } from '@/lib/services/aiSettings';
import { CategorizeView } from '@/components/categorize/categorize-view';
import { ScreenHeader } from '@/components/nav/screen-header';
import { DateRangePopover } from '@/components/dashboard/period-popover';
import { parseDateParam, rangeFromSelection } from '@/lib/period-selection';
import { getStoredPeriod } from '@/lib/period-cookie';

const CategorizePage = async ({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}): Promise<React.ReactElement> => {
  const params = await searchParams;
  const urlRange = { from: parseDateParam(params.from), to: parseDateParam(params.to) };
  // No range in the URL: use the period last picked on any screen, else all
  // time (it's a queue, so older rows stay reachable by default).
  const storedPeriod = await getStoredPeriod();
  const range =
    urlRange.from || urlRange.to
      ? urlRange
      : storedPeriod
        ? rangeFromSelection(storedPeriod)
        : { from: null, to: null };
  const session = await getServerAuthSession();
  const userId = session!.user.id;
  const [queue, categories, progress, aiSettings] = await Promise.all([
    getCategorizeQueue(userId, range),
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
        periodSlot={<DateRangePopover fallback={range} />}
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
        key={`${range.from ?? ''}_${range.to ?? ''}`}
        initialQueue={queue}
        categories={categories}
        progress={progress}
        aiSettings={aiSettings}
      />
    </div>
  );
};

export default CategorizePage;
