'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Select } from '@/components/ui/field';
import { cn } from '@/lib/cn';
import type { CategorizeQueueRow } from '@/lib/services/categorize';
import type { FrontendCategory } from '@/lib/services/categories';

const patchCategory = (id: string, categoryId: string): Promise<Response> =>
  fetch(`/api/transactions/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ categoryId }),
  });

export const CategorizeView = ({
  initialQueue,
  categories,
}: {
  initialQueue: CategorizeQueueRow[];
  categories: FrontendCategory[];
}): React.ReactElement => {
  const router = useRouter();
  const [queue, setQueue] = useState(initialQueue);
  const [reviewOne, setReviewOne] = useState(false);
  const [index, setIndex] = useState(0);
  const [changing, setChanging] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const matched = queue.filter((r) => r.suggestedCategoryId);

  const removeRow = (id: string): void => {
    setQueue((q) => q.filter((r) => r.id !== id));
    setIndex((i) => Math.min(i, Math.max(queue.length - 2, 0)));
  };

  const confirm = async (row: CategorizeQueueRow, categoryId: string): Promise<void> => {
    setPending(true);
    await patchCategory(row.id, categoryId);
    setPending(false);
    removeRow(row.id);
    router.refresh();
  };

  const acceptAll = async (): Promise<void> => {
    setPending(true);
    await Promise.all(matched.map((r) => patchCategory(r.id, r.suggestedCategoryId!)));
    setPending(false);
    setQueue((q) => q.filter((r) => !r.suggestedCategoryId));
    router.refresh();
  };

  const visibleRows = reviewOne ? queue.slice(index, index + 1) : queue;

  if (queue.length === 0) {
    return (
      <div className="border-line bg-paper-raised mt-6 rounded-[18px] border p-10 text-center">
        <p className="text-ink-muted text-sm">Nothing left to categorize. Nice.</p>
      </div>
    );
  }

  return (
    <div className="mt-6">
      <div className="border-line bg-paper-raised flex items-center justify-between gap-5 rounded-[14px] border px-6 py-3.5">
        <span className="text-ink-muted text-[12.5px] font-medium">
          {matched.length} of {queue.length} have a confident rule match
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              setReviewOne((v) => !v);
              setIndex(0);
            }}
            className="border-line text-ink rounded-full border px-4 py-2 text-[13.5px]"
          >
            {reviewOne ? 'Show all' : 'Review one by one'}
          </button>
          {matched.length > 0 && (
            <button
              type="button"
              onClick={acceptAll}
              disabled={pending}
              className="bg-iris text-paper-raised rounded-full px-4 py-2 text-[13.5px] font-semibold disabled:opacity-50"
            >
              Accept all {matched.length} match{matched.length === 1 ? '' : 'es'}
            </button>
          )}
        </div>
      </div>

      {reviewOne && (
        <p className="text-ink-muted mt-2 text-xs">
          {index + 1} of {queue.length}
        </p>
      )}

      <div className="border-line bg-paper-raised mt-4 rounded-[18px] border px-6">
        {visibleRows.map((row) => (
          <div key={row.id} className="ledger-row flex items-center gap-5 py-4.5">
            <div className="w-[230px] min-w-0 shrink-0">
              <div className="truncate text-sm font-medium">{row.payee}</div>
              <div className="text-ink-muted mt-0.5 text-xs">{row.meta}</div>
            </div>
            <span className="text-rose w-24 shrink-0 text-right font-mono text-sm tabular-nums">
              -{row.amount}
            </span>
            <div className="text-ink-muted w-[250px] shrink-0 text-[12.5px] leading-snug">
              {row.why ?? 'No rule matches this transaction.'}
            </div>
            <div className="ml-auto flex shrink-0 gap-1.5">
              {changing === row.id ? (
                <Select
                  autoFocus
                  className="border-line bg-paper rounded-full px-3 py-2 text-sm"
                  onChange={(e) => {
                    if (e.target.value) void confirm(row, e.target.value);
                    setChanging(null);
                  }}
                  defaultValue=""
                >
                  <option value="" disabled>
                    Choose category
                  </option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              ) : (
                <>
                  {row.suggestedCategoryId && (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => void confirm(row, row.suggestedCategoryId!)}
                      className="bg-iris text-paper-raised rounded-full px-3.5 py-2 text-[13px] font-semibold disabled:opacity-50"
                    >
                      {row.suggestedCategoryName}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setChanging(row.id)}
                    className="border-line text-ink-muted rounded-full border px-3.5 py-2 text-[13px]"
                  >
                    Change
                  </button>
                  <button
                    type="button"
                    onClick={() => (reviewOne ? setIndex((i) => i + 1) : removeRow(row.id))}
                    className={cn(
                      'border-line text-ink-muted rounded-full border px-3 py-2 text-[13px]',
                    )}
                  >
                    Skip
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
