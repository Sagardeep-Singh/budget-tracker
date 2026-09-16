'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, CheckCheck, SkipForward } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/field';
import { Toast } from '@/components/ui/toast';
import type { CategorizeProgress, CategorizeQueueRow } from '@/lib/services/categorize';
import type { FrontendCategory } from '@/lib/services/categories';

type PayeeGroup = {
  payee: string;
  rows: CategorizeQueueRow[];
  totalAmount: number;
  meta: string;
  suggestedCategoryId: string | null;
  suggestedCategoryName: string | null;
  why: string | null;
};

const patchCategory = (id: string, categoryId: string | null): Promise<Response> =>
  fetch(`/api/transactions/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ categoryId }),
  });

const skipTransaction = (id: string): Promise<Response> =>
  fetch(`/api/transactions/${id}/skip`, { method: 'POST' });

export const CategorizeView = ({
  initialQueue,
  categories,
  progress,
}: {
  initialQueue: CategorizeQueueRow[];
  categories: FrontendCategory[];
  progress: CategorizeProgress;
}): React.ReactElement => {
  const router = useRouter();
  const [queue, setQueue] = useState(initialQueue);
  const [reviewOne, setReviewOne] = useState(false);
  const [pending, setPending] = useState(false);
  const [toast, setToast] = useState<{ message: string; undo: () => void } | null>(null);
  const [groupChoice, setGroupChoice] = useState<Record<string, string>>({});
  const [groupMore, setGroupMore] = useState<Record<string, boolean>>({});
  // Renders in pages: a payee-per-card list has no natural cap, and a large
  // uncategorized backlog (many one-off, never-repeating payees) can mean
  // hundreds of groups — rendering them all at once is what made the page
  // unresponsive during testing.
  const GROUP_PAGE_SIZE = 60;
  const [visibleGroupCount, setVisibleGroupCount] = useState(GROUP_PAGE_SIZE);

  const matched = queue.filter((r) => r.suggestedCategoryId);

  // Grouped by payee for the batch-review default: rule-matched groups (a
  // one-tap win) sort first, then largest groups first within each bucket.
  const payeeGroups = useMemo<PayeeGroup[]>(() => {
    const map = new Map<string, CategorizeQueueRow[]>();
    for (const row of queue) {
      if (!map.has(row.payee)) map.set(row.payee, []);
      map.get(row.payee)!.push(row);
    }
    return Array.from(map.values())
      .map((rows) => ({
        payee: rows[0].payee,
        rows,
        totalAmount: rows.reduce((sum, r) => sum + Number(r.amount), 0),
        meta: rows[0].meta,
        suggestedCategoryId: rows[0].suggestedCategoryId,
        suggestedCategoryName: rows[0].suggestedCategoryName,
        why: rows[0].why,
      }))
      .sort((a, b) => {
        const aMatched = a.suggestedCategoryId ? 0 : 1;
        const bMatched = b.suggestedCategoryId ? 0 : 1;
        return aMatched !== bMatched ? aMatched - bMatched : b.rows.length - a.rows.length;
      });
  }, [queue]);

  const progressPct =
    progress.totalCount > 0
      ? Math.round((progress.categorizedCount / progress.totalCount) * 100)
      : 0;

  const removeRow = (id: string): void => {
    setQueue((q) => q.filter((r) => r.id !== id));
  };

  const confirm = async (row: CategorizeQueueRow, categoryId: string): Promise<void> => {
    setPending(true);
    await patchCategory(row.id, categoryId);
    setPending(false);
    removeRow(row.id);
    router.refresh();
  };

  const skip = async (row: CategorizeQueueRow): Promise<void> => {
    setPending(true);
    await skipTransaction(row.id);
    setPending(false);
    removeRow(row.id);
    router.refresh();
  };

  const acceptAll = async (): Promise<void> => {
    const accepted = matched;
    setPending(true);
    await Promise.all(accepted.map((r) => patchCategory(r.id, r.suggestedCategoryId!)));
    setPending(false);
    setQueue((q) => q.filter((r) => !r.suggestedCategoryId));
    router.refresh();
    setToast({
      message: `Categorized ${accepted.length} transaction${accepted.length === 1 ? '' : 's'}`,
      undo: () => {
        void Promise.all(accepted.map((r) => patchCategory(r.id, null))).then(() => {
          setQueue((q) => [...accepted, ...q]);
          router.refresh();
        });
        setToast(null);
      },
    });
  };

  const confirmGroup = async (group: PayeeGroup, categoryId: string): Promise<void> => {
    setPending(true);
    await Promise.all(group.rows.map((r) => patchCategory(r.id, categoryId)));
    setPending(false);
    const removedIds = new Set(group.rows.map((r) => r.id));
    setQueue((q) => q.filter((r) => !removedIds.has(r.id)));
    router.refresh();
    setToast({
      message: `Categorized ${group.rows.length} transaction${group.rows.length === 1 ? '' : 's'}`,
      undo: () => {
        void Promise.all(group.rows.map((r) => patchCategory(r.id, null))).then(() => {
          setQueue((q) => [...group.rows, ...q]);
          router.refresh();
        });
        setToast(null);
      },
    });
  };

  const reviewGroupIndividually = (): void => {
    setReviewOne(true);
  };

  const visibleRows = queue;

  if (queue.length === 0) {
    return (
      <div className="mt-6">
        <div className="border-line bg-paper-raised rounded-[18px] border p-10 text-center">
          <p className="text-ink-muted text-sm">Nothing left to categorize. Nice.</p>
        </div>
        {toast && (
          <Toast message={toast.message} onUndo={toast.undo} onDismiss={() => setToast(null)} />
        )}
      </div>
    );
  }

  return (
    <div className="mt-6">
      <div className="bg-paper-sunk flex gap-1 rounded-full p-1">
        <button
          type="button"
          onClick={() => setReviewOne(false)}
          className={cn(
            'flex-1 rounded-full py-2.5 text-[13.5px] font-semibold',
            !reviewOne ? 'bg-paper-raised text-ink shadow-sm' : 'text-ink-muted font-medium',
          )}
        >
          By payee · {payeeGroups.length}
        </button>
        <button
          type="button"
          onClick={() => setReviewOne(true)}
          className={cn(
            'flex-1 rounded-full py-2.5 text-[13.5px] font-semibold',
            reviewOne ? 'bg-paper-raised text-ink shadow-sm' : 'text-ink-muted font-medium',
          )}
        >
          One by one
        </button>
      </div>

      <div className="mt-4 flex items-baseline justify-between gap-2 text-xs">
        <span className="text-ink-muted">
          {progress.categorizedCount} of {progress.totalCount} categorized
        </span>
        <span className="font-mono">{progressPct}%</span>
      </div>
      <div className="bg-paper-sunk mt-1.5 h-1.5 overflow-hidden rounded-full">
        <div
          className="bg-iris h-full rounded-full transition-[width]"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      {reviewOne ? (
        matched.length > 0 && (
          <div className="mt-4 flex justify-end">
            <Button
              type="button"
              onClick={acceptAll}
              icon={CheckCheck}
              loading={pending}
              className="px-4 py-2 text-[13.5px]"
            >
              Accept all {matched.length} match{matched.length === 1 ? '' : 'es'}
            </Button>
          </div>
        )
      ) : (
        <div className="mt-5 flex flex-col gap-3">
          {payeeGroups.slice(0, visibleGroupCount).map((group) => {
            const showMore = groupMore[group.payee] ?? false;
            const chipCategories = showMore ? categories : categories.slice(0, 3);
            const chosenId = groupChoice[group.payee] ?? null;
            return (
              <div
                key={group.payee}
                data-testid="payee-group-card"
                className="border-line bg-paper-raised rounded-[18px] border p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-base font-semibold tracking-[-0.01em]">
                      {group.payee}
                    </div>
                    <div className="text-ink-muted mt-0.5 text-xs">
                      {group.rows.length} transaction{group.rows.length === 1 ? '' : 's'} ·{' '}
                      {group.meta}
                    </div>
                  </div>
                  <span className="text-rose font-mono text-sm tabular-nums">
                    -{group.totalAmount.toFixed(2)}
                  </span>
                </div>

                {group.suggestedCategoryId ? (
                  <>
                    <div className="bg-paper mt-3.5 flex items-center gap-2 rounded-xl px-3 py-2.5">
                      <span className="bg-sky-soft text-sky rounded-full px-2 py-1 text-[10px] font-semibold tracking-[0.05em] uppercase">
                        Rule match
                      </span>
                      <span className="text-[13.5px] font-medium">
                        {group.suggestedCategoryName}
                      </span>
                    </div>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => void confirmGroup(group, group.suggestedCategoryId!)}
                      className="bg-iris text-paper-raised mt-3 block w-full rounded-full py-2.75 text-[14.5px] font-semibold disabled:opacity-50"
                    >
                      Categorize all {group.rows.length} as {group.suggestedCategoryName}
                    </button>
                    <div className="mt-3.5 flex items-start gap-2.5">
                      <span className="bg-iris mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md">
                        <Check size={12} className="text-paper-raised" strokeWidth={2.5} />
                      </span>
                      <span className="text-ink-muted text-[12.5px] leading-snug">
                        Keeps matching future {group.payee} imports to {group.suggestedCategoryName}{' '}
                        automatically.
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => reviewGroupIndividually()}
                      className="text-iris mt-3 block w-full py-2 text-center text-[13px] font-medium"
                    >
                      Review these {group.rows.length} individually
                    </button>
                  </>
                ) : (
                  <>
                    <p className="text-ink-muted mt-2.5 text-[12.5px] leading-snug">
                      {group.why ?? 'No rule matches this payee. Pick a category for the batch.'}
                    </p>
                    <div className="mt-3.5 flex flex-wrap gap-2">
                      {chipCategories.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => setGroupChoice((g) => ({ ...g, [group.payee]: c.id }))}
                          className={cn(
                            'rounded-full border px-3.5 py-2 text-[13.5px]',
                            chosenId === c.id
                              ? 'border-iris bg-iris-soft text-iris font-medium'
                              : 'border-line text-ink',
                          )}
                        >
                          {c.name}
                        </button>
                      ))}
                      {!showMore && categories.length > 3 && (
                        <button
                          type="button"
                          onClick={() => setGroupMore((g) => ({ ...g, [group.payee]: true }))}
                          className="border-line text-ink-muted rounded-full border px-3.5 py-2 text-[13.5px]"
                        >
                          More…
                        </button>
                      )}
                    </div>
                    <div className="mt-3.5 flex gap-2.5">
                      <button
                        type="button"
                        onClick={() => reviewGroupIndividually()}
                        className="border-line text-ink flex-1 rounded-full border py-3 text-[13.5px] font-medium"
                      >
                        Split individually
                      </button>
                      <button
                        type="button"
                        disabled={!chosenId || pending}
                        onClick={() => chosenId && void confirmGroup(group, chosenId)}
                        className="bg-iris text-paper-raised flex-[1.2] rounded-full py-3 text-[13.5px] font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Categorize all {group.rows.length}
                      </button>
                    </div>
                  </>
                )}
              </div>
            );
          })}
          {visibleGroupCount < payeeGroups.length && (
            <button
              type="button"
              onClick={() => setVisibleGroupCount((n) => n + GROUP_PAGE_SIZE)}
              className="border-line text-ink rounded-full border py-3 text-[13.5px] font-medium"
            >
              Show {Math.min(GROUP_PAGE_SIZE, payeeGroups.length - visibleGroupCount)} more of{' '}
              {payeeGroups.length - visibleGroupCount} remaining
            </button>
          )}
        </div>
      )}

      {/* Desktop: table-style rows with a category dropdown — plenty of
          width for a fixed-column layout. Only rendered in "one by one" mode;
          the default "by payee" mode uses the grouped batch cards above. */}
      <div
        className={cn(
          'border-line bg-paper-raised mt-4 rounded-[18px] border px-6',
          reviewOne ? 'hidden lg:block' : 'hidden',
        )}
      >
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
              <Select
                disabled={pending}
                className="border-line bg-paper rounded-full px-3 py-2 text-sm"
                onChange={(e) => {
                  if (e.target.value) void confirm(row, e.target.value);
                }}
                defaultValue={row.suggestedCategoryId ?? ''}
              >
                {!row.suggestedCategoryId && (
                  <option value="" disabled>
                    Choose category
                  </option>
                )}
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
              <Button
                type="button"
                variant="secondary"
                onClick={() => void skip(row)}
                icon={SkipForward}
                loading={pending}
                className="px-3 py-2 text-[13px]"
              >
                Skip
              </Button>
            </div>
          </div>
        ))}
      </div>

      {/* Mobile: one card, category chips instead of a dropdown — tapping a
          chip confirms immediately (no separate confirm step), so
          reassigning is a single tap. The rule's suggestion (if any) sorts
          first and gets an accent ring so it's the easiest chip to reach. */}
      <div className={cn('mt-4 flex flex-col gap-3', reviewOne ? 'lg:hidden' : 'hidden')}>
        {visibleRows.map((row) => {
          const sortedCategories = row.suggestedCategoryId
            ? [
                ...categories.filter((c) => c.id === row.suggestedCategoryId),
                ...categories.filter((c) => c.id !== row.suggestedCategoryId),
              ]
            : categories;
          return (
            <div
              key={row.id}
              data-testid="categorize-card-mobile"
              className="border-line bg-paper-raised flex flex-col gap-4 rounded-[18px] border p-5"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-[15px] font-medium">{row.payee}</div>
                  <div className="text-ink-muted mt-0.5 text-xs">{row.meta}</div>
                </div>
                <span className="text-rose shrink-0 font-mono text-base tabular-nums">
                  -{row.amount}
                </span>
              </div>
              <p className="text-ink-muted text-[12.5px] leading-snug">
                {row.why ?? 'No rule matches this transaction.'}
              </p>
              <div className="flex flex-wrap gap-2">
                {sortedCategories.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    disabled={pending}
                    onClick={() => void confirm(row, c.id)}
                    className={cn(
                      'rounded-full border px-3.5 py-2 text-[13px] font-medium disabled:opacity-50',
                      c.id === row.suggestedCategoryId
                        ? 'border-iris bg-iris-soft text-iris'
                        : 'border-line text-ink',
                    )}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
              <Button
                type="button"
                variant="secondary"
                onClick={() => void skip(row)}
                icon={SkipForward}
                loading={pending}
                className="justify-center py-2.5 text-[13px]"
              >
                Skip
              </Button>
            </div>
          );
        })}
      </div>

      {toast && (
        <Toast message={toast.message} onUndo={toast.undo} onDismiss={() => setToast(null)} />
      )}
    </div>
  );
};
