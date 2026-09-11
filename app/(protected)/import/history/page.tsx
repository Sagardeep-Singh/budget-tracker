import { getServerAuthSession } from '@/lib/auth/session';
import { listImportBatches } from '@/lib/services/importBatches';
import { ImportHistory } from '@/components/import/import-history';
import { ScreenHeader } from '@/components/nav/screen-header';

const ImportHistoryPage = async (): Promise<React.ReactElement> => {
  const session = await getServerAuthSession();
  const userId = session!.user.id;
  const { batches, nextCursor } = await listImportBatches(userId, { limit: 25 });

  return (
    <div className="animate-[fade-up_0.3s_ease-out]">
      <ScreenHeader
        title="Import history"
        description="Every CSV commit, most recent first. Undoing an import deletes the transactions it created; the entry stays here, marked undone."
      />
      <ImportHistory initialBatches={batches} initialNextCursor={nextCursor} />
    </div>
  );
};

export default ImportHistoryPage;
