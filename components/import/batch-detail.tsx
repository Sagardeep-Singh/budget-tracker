'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Money } from '@/components/ui/money';
import { UndoBatchModal } from '@/components/import/undo-batch-modal';
import { formatDate } from '@/lib/format';
import type { FrontendImportBatch } from '@/lib/services/importBatches';
import type { FrontendTransaction } from '@/lib/services/transactions';

export const BatchDetail = ({
  batch,
  transactions,
}: {
  batch: FrontendImportBatch;
  transactions: FrontendTransaction[];
}): React.ReactElement => {
  const router = useRouter();
  const [undoOpen, setUndoOpen] = useState(false);
  const [undoKey, setUndoKey] = useState(0);

  const handleUndo = async (): Promise<void> => {
    const res = await fetch(`/api/import/batches/${batch.id}/undo`, { method: 'POST' });
    if (!res.ok) {
      throw new Error('Undo failed');
    }
    setUndoOpen(false);
    router.refresh();
  };

  return (
    <div className="mt-6 flex flex-col gap-6">
      <Card>
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <h2 className="font-display truncate text-lg font-semibold">{batch.filename}</h2>
              {batch.status === 'UNDONE' && (
                <span className="border-line text-ink-muted shrink-0 rounded-full border px-2.5 py-1 text-[12.5px]">
                  Undone {batch.undoneAt ? formatDate(batch.undoneAt) : ''}
                </span>
              )}
            </div>
            <p className="text-ink-muted mt-2 text-sm">
              {batch.accountName} · <span className="font-mono tabular-nums">{batch.rowCount}</span>{' '}
              rows submitted · <span className="font-mono tabular-nums">{batch.importedCount}</span>{' '}
              imported · <span className="font-mono tabular-nums">{batch.skippedDuplicates}</span>{' '}
              skipped · {formatDate(batch.dateFrom)}–{formatDate(batch.dateTo)} · imported{' '}
              {formatDate(batch.createdAt)}
            </p>
          </div>
          {batch.status === 'ACTIVE' && (
            <Button
              type="button"
              variant="danger"
              icon={Trash2}
              onClick={() => {
                setUndoKey((k) => k + 1);
                setUndoOpen(true);
              }}
            >
              Undo this import
            </Button>
          )}
        </div>
      </Card>

      {batch.status === 'UNDONE' ? (
        <div className="border-line bg-paper-sunk text-ink-muted flex flex-col items-center gap-2 rounded-2xl border border-dashed p-8 text-center">
          <Trash2 size={18} />
          <p className="text-sm">
            These transactions were removed when this import was undone on{' '}
            {batch.undoneAt ? formatDate(batch.undoneAt) : 'an earlier date'}. If they were also
            recategorized, retyped, or skipped before the undo, those edits are gone too.
          </p>
        </div>
      ) : (
        <Card className="p-0">
          {transactions.map((t) => (
            <div key={t.id} className="ledger-row flex items-center gap-5 px-6 py-3.5">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">
                  {t.payee || t.categoryName || 'Transaction'}
                </div>
                <div className="text-ink-muted mt-0.5 text-xs">
                  {t.categoryName ?? 'Uncategorized'}
                </div>
              </div>
              <span className="text-ink-muted w-[110px] shrink-0 text-right font-mono text-xs tabular-nums">
                {formatDate(t.date)}
              </span>
              <span className="w-[120px] shrink-0 text-right">
                <Money value={t.amount} tone={t.type === 'INCOME' ? 'income' : 'expense'} />
              </span>
            </div>
          ))}
        </Card>
      )}

      {undoOpen && (
        <UndoBatchModal
          key={`undo-${undoKey}`}
          open={undoOpen}
          batch={batch}
          transactionCount={batch.importedCount}
          onConfirm={handleUndo}
          onCancel={() => setUndoOpen(false)}
        />
      )}
    </div>
  );
};
