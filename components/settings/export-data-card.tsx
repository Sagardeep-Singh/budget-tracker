'use client';

import { useState } from 'react';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';

type ExportStatus = 'idle' | 'loading' | 'error';

const defaultFilename = (): string => `ledger-data-${new Date().toISOString().slice(0, 10)}.json`;

const filenameFromContentDisposition = (header: string | null): string | null => {
  if (!header) return null;
  const match = /filename="([^"]+)"/.exec(header);
  return match?.[1] ?? null;
};

export const ExportDataCard = (): React.ReactElement => {
  const [status, setStatus] = useState<ExportStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const handleExport = async (): Promise<void> => {
    setStatus('loading');
    setError(null);
    setSuccessMessage(null);

    let res: Response;
    try {
      res = await fetch('/api/settings/export');
    } catch {
      setStatus('error');
      setError('Could not reach the server. Check your connection and try again.');
      return;
    }

    if (!res.ok) {
      setStatus('error');
      setError('Could not export your data. Try again.');
      return;
    }

    const filename =
      filenameFromContentDisposition(res.headers.get('content-disposition')) ?? defaultFilename();
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);

    setStatus('idle');
    setSuccessMessage('Export downloaded.');
  };

  return (
    <div className="border-line bg-paper-raised rounded-2xl border p-5">
      <h2 className="font-display text-[15px] font-semibold">Export data</h2>
      <p className="text-ink-muted mt-1 text-[13.5px]">
        Download every account, transaction, category, budget, rule, import record, and
        reimbursement link as one JSON file.
      </p>
      <Button
        type="button"
        variant="secondary"
        icon={Download}
        loading={status === 'loading'}
        onClick={handleExport}
        className="mt-3.5"
      >
        Export my data
      </Button>
      {error && (
        <p className="bg-rose-soft text-rose mt-3 rounded-lg px-3 py-2 text-sm" role="alert">
          {error}
        </p>
      )}
      {/* Mounted unconditionally, empty until there's something to say: a
          `polite` live region that mounts for the first time already
          containing text is not reliably announced by assistive tech — it
          needs to already exist before its content changes. Visually hidden
          because the browser's own download UI is the sighted confirmation. */}
      <p className="sr-only" role="status" aria-live="polite">
        {successMessage}
      </p>
    </div>
  );
};
