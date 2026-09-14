'use client';

import { useState } from 'react';
import { Undo2 } from 'lucide-react';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/field';
import type { FrontendImportBatch } from '@/lib/services/importBatches';

// Same trim + case-insensitive semantics as the service's `normalizeFilename`,
// reimplemented inline rather than imported so a client component doesn't pull in
// `lib/services/*`. A byte-exact rule here would mean two competing definitions of
// "same filename" inside one feature.
const matchesFilename = (typed: string, filename: string): boolean =>
  typed.trim().toLowerCase() === filename.trim().toLowerCase();

export const UndoBatchModal = ({
  open,
  batch,
  transactionCount,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  batch: FrontendImportBatch;
  transactionCount: number;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}): React.ReactElement => {
  const [typedFilename, setTypedFilename] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canConfirm = matchesFilename(typedFilename, batch.filename);

  const handleConfirm = async (): Promise<void> => {
    if (!canConfirm || pending) return;
    setPending(true);
    setError(null);
    try {
      await onConfirm();
    } catch {
      // keep whatever the user typed — don't punish them for a failed request
      setError('Could not undo this import. Try again.');
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal open={open} onClose={onCancel} title="Undo import">
      <p className="text-ink-muted text-sm">
        This will permanently delete {transactionCount} transaction
        {transactionCount === 1 ? '' : 's'} imported from &ldquo;{batch.filename}&rdquo;.
      </p>
      <p className="text-ink-muted mt-2 text-sm">
        If any of these were recategorized, retyped as income or expense, or skipped since they were
        imported, those changes will be lost — they are not tracked separately from the import.
      </p>

      <div className="mt-4">
        <Label htmlFor="undo-confirm-filename">Type the filename to confirm</Label>
        <Input
          id="undo-confirm-filename"
          autoFocus
          value={typedFilename}
          onChange={(e) => setTypedFilename(e.target.value)}
          placeholder={batch.filename}
        />
      </div>
      {error && <p className="text-rose mt-2 text-sm">{error}</p>}

      <div className="mt-6 flex justify-end gap-2.5">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="danger"
          icon={Undo2}
          onClick={handleConfirm}
          disabled={!canConfirm}
          loading={pending}
        >
          Undo import
        </Button>
      </div>
    </Modal>
  );
};
