'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/field';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { postJSON } from '@/lib/api-client';
import { MAX_IMPORT_BYTES } from '@/lib/validators/user-data';

type ImportStatus = 'idle' | 'uploading' | 'error';

const MAX_IMPORT_MB = MAX_IMPORT_BYTES / (1024 * 1024);

type ImportCounts = {
  accounts: number;
  transactions: number;
  categories: number;
  budgets: number;
  categoryRules: number;
  importBatches: number;
  reimbursementLinks: number;
};

const summarize = (counts: ImportCounts): string =>
  `Import complete — replaced your data with ${counts.accounts} accounts, ${counts.transactions} transactions, ${counts.categories} categories, ${counts.budgets} budgets, ${counts.categoryRules} rules, ${counts.importBatches} import batches, ${counts.reimbursementLinks} reimbursement links.`;

export const ImportDataCard = (): React.ReactElement => {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [status, setStatus] = useState<ImportStatus>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const selected = event.target.files?.[0] ?? null;
    setMessage(null);
    setIsSuccess(false);
    setStatus('idle');

    if (selected && selected.size > MAX_IMPORT_BYTES) {
      // Fast client-side precheck only — the route re-checks the real byte
      // length regardless. This file can never be valid, so the selection
      // is cleared rather than kept for a retry.
      if (inputRef.current) inputRef.current.value = '';
      setFile(null);
      setStatus('error');
      setMessage(`This file is larger than ${MAX_IMPORT_MB} MB and can't be imported.`);
      return;
    }

    setFile(selected);
  };

  const handleConfirm = async (): Promise<void> => {
    if (!file) return;
    setStatus('uploading');

    // The file's text is already JSON — posted through untouched rather than
    // re-serialized.
    const text = await file.text();
    const res = await postJSON<{ counts: ImportCounts }>('/api/settings/import', text);

    setConfirmOpen(false);

    if (!res.ok) {
      setStatus('error');
      setIsSuccess(false);
      if (res.networkError) {
        setMessage('Could not reach the server. Check your connection and try again.');
      } else if (res.status === 413) {
        setMessage(`That file is larger than the ${MAX_IMPORT_MB} MB import limit.`);
      } else if (res.status === 400) {
        setMessage(
          res.error ??
            "That file couldn't be imported. Check that it's an unedited Ledger export and try again.",
        );
      } else {
        setMessage('Something went wrong on our end. Try again.');
      }
      return;
    }

    setStatus('idle');
    setIsSuccess(true);
    setMessage(summarize(res.data.counts));
    if (inputRef.current) inputRef.current.value = '';
    setFile(null);
    // Full-replace invalidates every other server-rendered surface
    // (dashboard, accounts, transactions, budgets, ...) — not optional.
    router.refresh();
  };

  return (
    <div className="border-line bg-paper-raised rounded-2xl border p-5">
      <h2 className="font-display text-[15px] font-semibold">Import data</h2>
      <p className="text-ink-muted mt-1 text-[13.5px]">
        Replace everything in your account with the contents of a Ledger export file.
      </p>

      <div className="mt-3.5">
        <Label htmlFor="import-file">Ledger export file</Label>
        <input
          ref={inputRef}
          id="import-file"
          type="file"
          accept=".json,application/json"
          onChange={handleFileChange}
          className="text-ink-muted file:border-line file:bg-paper file:text-ink w-full text-sm file:mr-3 file:rounded-full file:border file:px-3.5 file:py-1.5 file:text-[13px] file:font-medium"
        />
        {file && <p className="text-ink-muted mt-1.5 truncate text-[12.5px]">{file.name}</p>}
      </div>

      {file && (
        <Button
          type="button"
          variant="danger"
          icon={Upload}
          disabled={status === 'uploading'}
          onClick={() => setConfirmOpen(true)}
          className="mt-3.5"
        >
          Import
        </Button>
      )}

      {!isSuccess && message && (
        <p className="bg-rose-soft text-rose mt-3 rounded-lg px-3 py-2 text-sm" role="alert">
          {message}
        </p>
      )}
      {/* Always mounted so its `polite` announcement fires reliably — a
          region that mounts for the first time already containing text is
          not reliably announced by assistive tech. Visible only on success;
          `sr-only` the rest of the time rather than unmounted. */}
      <p
        role="status"
        aria-live="polite"
        className={
          isSuccess && message
            ? 'bg-sky-soft text-sky mt-3 rounded-lg px-4 py-3 text-sm'
            : 'sr-only'
        }
      >
        {isSuccess ? message : ''}
      </p>

      <ConfirmDialog
        open={confirmOpen}
        title="Replace all your data?"
        description={`Importing will permanently delete all your current accounts, transactions, categories, budgets, rules, import history, and reimbursement links, then replace them with the contents of "${file?.name ?? ''}". This cannot be undone.`}
        confirmLabel="Replace data"
        danger
        pending={status === 'uploading'}
        onConfirm={handleConfirm}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
};
