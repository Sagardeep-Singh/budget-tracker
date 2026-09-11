'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronRight, Trash2, Upload } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { UndoBatchModal } from '@/components/import/undo-batch-modal';
import { formatDate } from '@/lib/format';
import type { FrontendImportBatch } from '@/lib/services/importBatches';

const PAGE_SIZE = 25;

export const ImportHistory = ({
  initialBatches,
  initialNextCursor,
}: {
  initialBatches: FrontendImportBatch[];
  initialNextCursor: string | null;
}): React.ReactElement => {
  const router = useRouter();
  const [batches, setBatches] = useState(initialBatches);
  const [nextCursor, setNextCursor] = useState(initialNextCursor);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [undoBatch, setUndoBatch] = useState<FrontendImportBatch | null>(null);
  const [undoKey, setUndoKey] = useState(0);
  const linkRefs = useRef<Record<string, HTMLAnchorElement | null>>({});

  const handleLoadMore = async (): Promise<void> => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setLoadError(null);
    const res = await fetch(`/api/import/batches?cursor=${nextCursor}&limit=${PAGE_SIZE}`);
    setLoadingMore(false);
    if (!res.ok) {
      // retry in place: the button stays mounted and clickable
      setLoadError('Could not load more imports. Try again.');
      return;
    }
    const data: { batches: FrontendImportBatch[]; nextCursor: string | null } = await res.json();
    setBatches((current) => [...current, ...data.batches]);
    setNextCursor(data.nextCursor);
    // the "Load more" button unmounts on the last page, which would drop focus;
    // move it to the first newly-appended row instead
    const firstNew = data.batches[0];
    if (firstNew) {
      requestAnimationFrame(() => linkRefs.current[firstNew.id]?.focus());
    }
  };

  const openUndo = (batch: FrontendImportBatch): void => {
    setUndoKey((k) => k + 1);
    setUndoBatch(batch);
  };

  const handleUndo = async (batchId: string): Promise<void> => {
    const res = await fetch(`/api/import/batches/${batchId}/undo`, { method: 'POST' });
    if (!res.ok) {
      throw new Error('Undo failed');
    }
    setUndoBatch(null);
    router.refresh();
  };

  if (batches.length === 0) {
    return (
      <div className="border-line bg-paper-raised mt-6 flex flex-col items-center gap-3 rounded-2xl border border-dashed p-8 text-center">
        <p className="text-ink-muted text-sm">No imports yet.</p>
        <Link
          href="/import"
          className="bg-iris text-paper-raised focus-visible:outline-iris inline-flex cursor-pointer items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors duration-150 hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <Upload size={16} />
          Import a CSV
        </Link>
      </div>
    );
  }

  return (
    <div className="mt-6">
      <Card className="p-0">
        <div className="border-line text-ink-muted flex items-center gap-5 border-b px-6 py-3.5 text-[11px] font-semibold tracking-[0.08em] uppercase">
          <span className="flex-1">Filename</span>
          <span className="w-[150px]">Account</span>
          <span className="w-[120px] text-right">Imported</span>
          <span className="w-[110px] text-right">Date</span>
          <span className="w-[90px]" />
        </div>
        {batches.map((batch) => (
          <div key={batch.id} className="ledger-row flex items-center gap-5 px-6 py-3.5">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <Link
                ref={(node) => {
                  linkRefs.current[batch.id] = node;
                }}
                href={`/import/history/${batch.id}`}
                className="text-ink hover:text-iris truncate text-sm font-medium"
              >
                {batch.filename}
              </Link>
              <ChevronRight size={14} className="text-ink-muted shrink-0" aria-hidden="true" />
              {batch.status === 'UNDONE' && (
                <span className="border-line text-ink-muted shrink-0 rounded-full border px-2.5 py-1 text-[12.5px]">
                  Undone {batch.undoneAt ? formatDate(batch.undoneAt) : ''}
                </span>
              )}
            </div>
            <span className="text-ink-muted w-[150px] truncate text-sm">{batch.accountName}</span>
            <span className="w-[120px] text-right font-mono text-[13px] tabular-nums">
              <span className="text-ink block">{batch.importedCount} imported</span>
              {batch.skippedDuplicates > 0 && (
                <span className="text-ink-muted block">{batch.skippedDuplicates} skipped</span>
              )}
            </span>
            <span className="text-ink-muted w-[110px] text-right font-mono text-xs tabular-nums">
              {formatDate(batch.createdAt)}
            </span>
            <span className="w-[90px] text-right">
              {batch.status === 'ACTIVE' && (
                <Button
                  type="button"
                  variant="ghost"
                  icon={Trash2}
                  className="px-0 py-0 text-[12.5px]"
                  onClick={() => openUndo(batch)}
                >
                  Undo
                </Button>
              )}
            </span>
          </div>
        ))}
      </Card>

      {nextCursor && (
        <div className="mt-5 flex flex-col items-center gap-2">
          <Button type="button" variant="secondary" loading={loadingMore} onClick={handleLoadMore}>
            Load more
          </Button>
          {loadError && <p className="text-rose text-sm">{loadError}</p>}
        </div>
      )}

      {undoBatch && (
        <UndoBatchModal
          key={`undo-${undoKey}`}
          open={undoBatch !== null}
          batch={undoBatch}
          transactionCount={undoBatch.importedCount}
          onConfirm={() => handleUndo(undoBatch.id)}
          onCancel={() => setUndoBatch(null)}
        />
      )}
    </div>
  );
};
