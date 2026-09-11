import { notFound } from 'next/navigation';
import { getServerAuthSession } from '@/lib/auth/session';
import { getImportBatch, type FrontendImportBatch } from '@/lib/services/importBatches';
import { listTransactions } from '@/lib/services/transactions';
import { ServiceValidationError } from '@/lib/services/common';
import { BatchDetail } from '@/components/import/batch-detail';
import { ScreenHeader } from '@/components/nav/screen-header';

type PageParams = { params: Promise<{ id: string }> };

const ImportBatchPage = async ({ params }: PageParams): Promise<React.ReactElement> => {
  const session = await getServerAuthSession();
  const userId = session!.user.id;
  const { id } = await params;

  // notFound() throws, so it must be called outside the try — a catch here would
  // swallow the 404 interrupt.
  let batch: FrontendImportBatch | null = null;
  try {
    batch = await getImportBatch(userId, id);
  } catch (error) {
    if (!(error instanceof ServiceValidationError)) throw error;
  }
  if (!batch) {
    notFound();
  }

  // An undone batch legitimately has no transactions left; that renders an
  // explicit removed-by-undo state, never a 404.
  const transactions = await listTransactions(userId, { batchId: id });

  return (
    <div className="animate-[fade-up_0.3s_ease-out]">
      <ScreenHeader
        title="Import"
        description="A single CSV commit and the transactions it created."
      />
      <BatchDetail batch={batch} transactions={transactions} />
    </div>
  );
};

export default ImportBatchPage;
