'use client';

import { useState } from 'react';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/field';
import type { FrontendAccount } from '@/lib/services/accounts';
import type { FrontendCategory } from '@/lib/services/categories';
import {
  DEFAULT_TRANSACTION_FILTERS,
  type TransactionFilters,
} from '@/lib/transactions/transaction-filters';

const checkboxRow = 'text-ink flex items-center gap-2 text-sm';
const checkboxInput = 'accent-iris h-4 w-4 shrink-0';

const toggleId = (ids: string[], id: string): string[] =>
  ids.includes(id) ? ids.filter((existing) => existing !== id) : [...ids, id];

export const TransactionFiltersDialog = ({
  open,
  onClose,
  filters,
  onApply,
  accounts,
  categories,
}: {
  open: boolean;
  onClose: () => void;
  filters: TransactionFilters;
  onApply: (next: TransactionFilters) => void;
  accounts: FrontendAccount[];
  categories: FrontendCategory[];
}): React.ReactElement => {
  // A local draft, not the parent's filters directly: closing without
  // "Apply" (Escape, backdrop, the X button) must discard edits, and the
  // parent's filters shouldn't flicker on every keystroke inside the dialog.
  // Seeded once from `filters` — the caller must remount this component
  // (e.g. `key={filtersDialogKey}`, incremented on every open) so a second
  // open re-seeds from whatever is actually active rather than a stale or
  // cancelled draft, mirroring this file's existing `dialogKey`/`drawerKey`
  // convention in `transactions-view.tsx` instead of an effect.
  const [draft, setDraft] = useState<TransactionFilters>(filters);

  const handleClose = (): void => {
    setDraft(filters);
    onClose();
  };

  const handleApply = (): void => {
    onApply(draft);
    onClose();
  };

  const handleReset = (): void => {
    setDraft(DEFAULT_TRANSACTION_FILTERS);
  };

  return (
    <Modal open={open} onClose={handleClose} title="Filters" className="max-w-lg">
      <div className="flex flex-col gap-5">
        <div>
          <Label htmlFor="filter-from">Date range</Label>
          <div className="flex items-center gap-2">
            <Input
              id="filter-from"
              type="date"
              value={draft.from ?? ''}
              onChange={(e) => setDraft({ ...draft, from: e.target.value || null })}
            />
            <span className="text-ink-muted text-xs">to</span>
            <Input
              id="filter-to"
              type="date"
              value={draft.to ?? ''}
              onChange={(e) => setDraft({ ...draft, to: e.target.value || null })}
            />
          </div>
        </div>

        {accounts.length > 0 && (
          <div>
            <Label htmlFor="filter-accounts">Accounts</Label>
            <div id="filter-accounts" className="flex flex-col gap-1.5">
              {accounts.map((account) => (
                <label key={account.id} className={checkboxRow}>
                  <input
                    type="checkbox"
                    className={checkboxInput}
                    checked={draft.accountIds.includes(account.id)}
                    onChange={() =>
                      setDraft({ ...draft, accountIds: toggleId(draft.accountIds, account.id) })
                    }
                  />
                  {account.name}
                </label>
              ))}
            </div>
          </div>
        )}

        {categories.length > 0 && (
          <div>
            <Label htmlFor="filter-categories">Categories</Label>
            <div id="filter-categories" className="flex max-h-40 flex-col gap-1.5 overflow-y-auto">
              {categories.map((category) => (
                <label key={category.id} className={checkboxRow}>
                  <input
                    type="checkbox"
                    className={checkboxInput}
                    checked={draft.categoryIds.includes(category.id)}
                    onChange={() =>
                      setDraft({
                        ...draft,
                        categoryIds: toggleId(draft.categoryIds, category.id),
                      })
                    }
                  />
                  {category.name}
                </label>
              ))}
            </div>
          </div>
        )}

        <div>
          <Label htmlFor="filter-type">Type</Label>
          <div id="filter-type" className="flex gap-2">
            {(
              [
                [null, 'Any'],
                ['INCOME', 'Income'],
                ['EXPENSE', 'Expense'],
              ] as [TransactionFilters['type'], string][]
            ).map(([value, label]) => (
              <button
                key={label}
                type="button"
                onClick={() => setDraft({ ...draft, type: value })}
                className={`rounded-full border px-3.5 py-1.5 text-[13px] font-medium ${
                  draft.type === value
                    ? 'bg-ink text-paper-raised border-ink'
                    : 'border-line text-ink bg-paper-raised'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <Label htmlFor="filter-amount-min">Amount range</Label>
          <div className="flex items-center gap-2">
            <Input
              id="filter-amount-min"
              type="number"
              min={0}
              step="0.01"
              placeholder="Min"
              value={draft.amountMin ?? ''}
              onChange={(e) => setDraft({ ...draft, amountMin: e.target.value || null })}
            />
            <span className="text-ink-muted text-xs">to</span>
            <Input
              id="filter-amount-max"
              type="number"
              min={0}
              step="0.01"
              placeholder="Max"
              value={draft.amountMax ?? ''}
              onChange={(e) => setDraft({ ...draft, amountMax: e.target.value || null })}
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className={checkboxRow}>
            <input
              type="checkbox"
              className={checkboxInput}
              checked={draft.hideTransfers}
              onChange={(e) => setDraft({ ...draft, hideTransfers: e.target.checked })}
            />
            Hide transfers
          </label>
          <label className={checkboxRow}>
            <input
              type="checkbox"
              className={checkboxInput}
              checked={draft.hidePayments}
              onChange={(e) => setDraft({ ...draft, hidePayments: e.target.checked })}
            />
            Hide card payments
          </label>
          <label className={checkboxRow}>
            <input
              type="checkbox"
              className={checkboxInput}
              checked={draft.uncategorizedOnly}
              onChange={(e) => setDraft({ ...draft, uncategorizedOnly: e.target.checked })}
            />
            Uncategorized only
          </label>
        </div>

        <div className="mt-1 flex items-center justify-between gap-3">
          <Button type="button" variant="ghost" onClick={handleReset}>
            Reset
          </Button>
          <Button type="button" onClick={handleApply}>
            Apply
          </Button>
        </div>
      </div>
    </Modal>
  );
};
