'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Papa from 'papaparse';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label, Select } from '@/components/ui/field';
import { Money } from '@/components/ui/money';
import type { FrontendAccount } from '@/lib/services/accounts';
import type { FrontendCategory } from '@/lib/services/categories';

type CsvRow = Record<string, string>;

type PreviewRow = {
  accountId: string;
  date: string;
  amount: number;
  type: 'INCOME' | 'EXPENSE';
  payee?: string;
  note?: string;
  categoryId: string | null;
  categoryName: string | null;
  duplicate: boolean;
  include: boolean;
};

const NONE = '__none__';

export const ImportView = ({
  accounts,
  categories,
}: {
  accounts: FrontendAccount[];
  categories: FrontendCategory[];
}): React.ReactElement => {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<CsvRow[]>([]);
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');
  const [dateCol, setDateCol] = useState('');
  const [amountCol, setAmountCol] = useState('');
  const [payeeCol, setPayeeCol] = useState('');
  const [noteCol, setNoteCol] = useState('');
  const [preview, setPreview] = useState<PreviewRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [committed, setCommitted] = useState<{
    imported: number;
    skippedDuplicates: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFile = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    if (!file) return;
    setCommitted(null);
    setPreview(null);
    setError(null);

    Papa.parse<CsvRow>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        const cols = result.meta.fields ?? [];
        setHeaders(cols);
        setRawRows(result.data);
        const guess = (needle: string): string =>
          cols.find((c) => c.toLowerCase().includes(needle)) ?? '';
        setDateCol(guess('date'));
        setAmountCol(guess('amount'));
        setPayeeCol(guess('payee') || guess('description') || guess('merchant'));
        setNoteCol(guess('note') || guess('memo'));
      },
    });
  };

  const handlePreview = async (): Promise<void> => {
    if (!dateCol || !amountCol || !accountId) return;
    setLoading(true);
    setError(null);

    const rows = rawRows.map((row) => {
      const amount = Number(row[amountCol]);
      return {
        accountId,
        date: row[dateCol],
        amount: Math.abs(amount),
        type: (amount < 0 ? 'EXPENSE' : 'INCOME') as 'INCOME' | 'EXPENSE',
        payee: payeeCol ? row[payeeCol] : undefined,
        note: noteCol ? row[noteCol] : undefined,
      };
    });

    const res = await fetch('/api/import/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows }),
    });

    setLoading(false);
    if (!res.ok) {
      setError('Could not preview these rows. Check your column mapping.');
      return;
    }
    setPreview(await res.json());
  };

  const toggleInclude = (index: number): void => {
    if (!preview) return;
    const next = [...preview];
    next[index] = { ...next[index], include: !next[index].include };
    setPreview(next);
  };

  const overrideCategory = (index: number, categoryId: string | null): void => {
    if (!preview) return;
    const next = [...preview];
    next[index] = { ...next[index], categoryId };
    setPreview(next);
  };

  const handleCommit = async (): Promise<void> => {
    if (!preview || committing) return;
    setCommitting(true);
    setLoading(true);
    setError(null);
    const res = await fetch('/api/import/commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: preview }),
    });
    setLoading(false);
    if (!res.ok) {
      setCommitting(false);
      setError('Import failed.');
      return;
    }
    const data = await res.json();
    setCommitted(data);

    // Reset everything so this file can't be re-submitted: another click on
    // "Import" after a successful commit was silently re-importing the same
    // rows, since the preview (and its duplicate flags) went stale the
    // moment the first commit landed.
    setHeaders([]);
    setRawRows([]);
    setPreview(null);
    setDateCol('');
    setAmountCol('');
    setPayeeCol('');
    setNoteCol('');
    if (fileInputRef.current) fileInputRef.current.value = '';

    router.refresh();
  };

  return (
    <div className="mt-6 flex flex-col gap-6">
      <Card>
        <Label htmlFor="csvfile">CSV file</Label>
        <input
          ref={fileInputRef}
          id="csvfile"
          type="file"
          accept=".csv,text/csv"
          onChange={handleFile}
          className="text-ink-muted file:bg-iris-soft file:text-iris mt-1 block w-full text-sm file:mr-3 file:rounded-full file:border-0 file:px-3 file:py-1.5 file:text-sm file:font-medium"
        />

        {headers.length > 0 && (
          <div className="mt-5 grid grid-cols-3 gap-4">
            <div>
              <Label htmlFor="account">Account</Label>
              <Select id="account" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="dateCol">Date column</Label>
              <Select id="dateCol" value={dateCol} onChange={(e) => setDateCol(e.target.value)}>
                <option value="">Select…</option>
                {headers.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="amountCol">Amount column</Label>
              <Select
                id="amountCol"
                value={amountCol}
                onChange={(e) => setAmountCol(e.target.value)}
              >
                <option value="">Select…</option>
                {headers.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="payeeCol">Payee column (optional)</Label>
              <Select id="payeeCol" value={payeeCol} onChange={(e) => setPayeeCol(e.target.value)}>
                <option value="">None</option>
                {headers.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="noteCol">Note column (optional)</Label>
              <Select id="noteCol" value={noteCol} onChange={(e) => setNoteCol(e.target.value)}>
                <option value="">None</option>
                {headers.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex items-end">
              <Button type="button" onClick={handlePreview} disabled={loading}>
                {loading ? 'Loading…' : 'Preview'}
              </Button>
            </div>
          </div>
        )}
        <p className="text-ink-muted mt-2 text-xs">
          Negative amounts are treated as expenses, positive as income — flip the sign in your CSV
          if your bank exports it the other way.
        </p>
      </Card>

      {error && <p className="text-rose text-sm">{error}</p>}

      {preview && (
        <Card className="p-0">
          <div className="flex items-center justify-between px-6 py-4">
            <div className="text-ink-muted text-sm">
              {preview.length} row{preview.length === 1 ? '' : 's'} parsed ·{' '}
              {preview.filter((r) => r.duplicate).length} possible duplicate
              {preview.filter((r) => r.duplicate).length === 1 ? '' : 's'}
            </div>
            <Button onClick={handleCommit} disabled={loading || preview.every((r) => !r.include)}>
              {loading ? 'Importing…' : `Import ${preview.filter((r) => r.include).length} rows`}
            </Button>
          </div>
          {preview.map((row, i) => (
            <div
              key={i}
              className="ledger-row grid grid-cols-[auto_1fr_auto_1fr] items-center gap-4 px-6 py-3"
            >
              <input
                type="checkbox"
                checked={row.include}
                onChange={() => toggleInclude(i)}
                className="accent-iris h-4 w-4"
              />
              <div className="min-w-0">
                <div className="text-ink truncate text-sm">
                  {row.payee || row.note || 'Row ' + (i + 1)}
                </div>
                <div className="text-ink-muted text-xs">
                  {row.date} {row.duplicate && '· possible duplicate'}
                </div>
              </div>
              <Money value={row.amount} tone={row.type === 'INCOME' ? 'income' : 'expense'} />
              <Select
                value={row.categoryId ?? NONE}
                onChange={(e) =>
                  overrideCategory(i, e.target.value === NONE ? null : e.target.value)
                }
              >
                <option value={NONE}>Uncategorized</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>
          ))}
        </Card>
      )}

      {committed !== null && (
        <p className="bg-sky-soft text-sky rounded-lg px-4 py-3 text-sm">
          Imported {committed.imported} transaction{committed.imported === 1 ? '' : 's'}.
          {committed.skippedDuplicates > 0 &&
            ` Skipped ${committed.skippedDuplicates} duplicate${committed.skippedDuplicates === 1 ? '' : 's'}.`}
        </p>
      )}
    </div>
  );
};
