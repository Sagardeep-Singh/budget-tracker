# Enhanced transaction filters

## Problem

Today's Transactions filters are two single-select pill dropdowns (account, category) plus an
account-linked period picker (all time / by month / by statement), all filtering the already-loaded
`initialTransactions` array client-side in `transactions-view.tsx`. There's no way to search by
payee, filter by amount, filter by transaction type, filter to multiple accounts/categories at
once, or see how many filters are currently active without scanning the row.

## Scope

- A **search box** (payee "contains" text match, case-insensitive) stays always visible, outside
  any dialog — it's the one filter the user wants immediate, no-friction access to.
- Every other filter — date range, accounts, categories, transaction type, amount range, and flag
  toggles — moves into a **filter dialog**, opened from a "Filters" button. The button shows a
  numeric badge for how many filter _groups_ are currently active.
- Filter state syncs to the URL as query params, so a filtered view is shareable and survives a
  page refresh.

## Decisions

- **"Search" is the payee-contains field**, not a second, separate control. There's one text
  input for payee matching; it lives outside the dialog. The dialog does not duplicate it.
- **Filters sync to the URL** (`?accountIds=...&categoryIds=...&from=...&to=...&payee=...&type=...
&amountMin=...&amountMax=...&hideTransfers=...&hidePayments=...&uncategorizedOnly=...`), using
  the same `useSearchParams`/`useRouter` pattern already in
  `components/transactions/add-transaction-overlay.tsx`. Filtering itself stays **client-side**
  over the already-fetched transaction list — this is a UI/URL-sync change, not a move to
  server-side pagination; `GET /api/transactions`'s existing query schema
  (`accountId`/`categoryId`/`batchId`/`from`/`to`) is untouched since the Transactions page never
  calls it with filters today (`app/(protected)/transactions/page.tsx` loads everything
  unfiltered). Flagged as a scope boundary: if the transaction list grows large enough that
  client-side filtering becomes the bottleneck, that's a separate, larger change.
- **Accounts and categories become multi-select** (checkboxes in the dialog) instead of
  single-select dropdowns. Each selected id counts toward that filter group's "active" state.
- **Additional filters included**: transaction type (income/expense), amount range (min/max),
  and flag toggles (hide transfers, hide payments, uncategorized-only) — on top of the requested
  date range, accounts, and payment name.
- **The existing account-linked Period Picker (All time / By month / By statement) is left as-is**,
  not merged into the new date-range filter. It's a specialized view tied to statement cycles and
  only appears when exactly one account is selected. The new dialog's date-range filter is a
  separate, generic `from`/`to` filter that applies regardless of account selection; if both are
  active they intersect (AND). Flagged as an assumption — if the two should be unified into one
  date control, that's a follow-up design pass, not folded in here to avoid scope creep on the
  statement-cycle logic.
- **Active-filter count is per group, not per selected value.** Selecting 3 accounts counts as 1
  toward the badge (the "accounts" group is active), not 3. Groups: date range, accounts,
  categories, type, amount range, and each flag toggle independently (since each is a meaningful
  on/off the user would want to see reflected).

## Implementation

### Filter state shape (`components/transactions/transactions-view.tsx`)

```ts
type TransactionFilters = {
  from: string | null; // yyyy-mm-dd
  to: string | null;
  accountIds: string[];
  categoryIds: string[];
  payee: string; // contains match, case-insensitive; '' = no filter
  type: 'INCOME' | 'EXPENSE' | null;
  amountMin: string | null;
  amountMax: string | null;
  hideTransfers: boolean;
  hidePayments: boolean;
  uncategorizedOnly: boolean;
};
```

- Read from `useSearchParams()` on mount / on navigation; written via
  `router.replace(pathname + '?' + params, { scroll: false })` on every change, mirroring the
  existing overlay pattern. Empty/default values are omitted from the URL rather than written as
  empty params, keeping URLs clean.
- `activeFilterCount` derived from the same object: `+1` for `from || to` set, `+1` for
  `accountIds.length > 0`, `+1` for `categoryIds.length > 0`, `+1` for `type`, `+1` for
  `amountMin || amountMax`, `+1` each for `hideTransfers`/`hidePayments`/`uncategorizedOnly` when
  true. `payee` (the search box) is intentionally excluded from this count — it's not part of the
  dialog.

### `components/transactions/transaction-filters-dialog.tsx` (new)

- Built on the existing `components/ui/modal.tsx` (`Modal`), matching its title-bar/close-button
  convention rather than introducing a second dialog primitive.
- Sections: date range (two `Input type="date"`, from `components/ui/field.tsx`), accounts
  (checkbox list from the `accounts` prop), categories (checkbox list from the `categories` prop),
  type (two-way toggle or radio: Any / Income / Expense), amount range (two `Input type="number"`),
  flags (three checkboxes).
- "Apply" commits the dialog's local draft state to the URL/parent state in one navigation
  (avoids a URL write per keystroke); "Reset" clears every field in the dialog only, "Clear all"
  in the trigger row clears everything including the search box.
- Receives the current `TransactionFilters` and an `onApply(next: TransactionFilters)` callback;
  keeps its own draft copy internally so canceling (closing without Apply) discards edits.

### `components/transactions/transactions-view.tsx` (changed)

- Replace the two pill `<Select>` dropdowns (account, category) and their handlers with:
  - The payee search `<Input>` (always visible, filters as-you-type — no Apply needed for this one
    field, consistent with "the one filter the user wants immediate access to").
  - A "Filters" `<Button>` (a filter/sliders icon from `lucide-react`, matching the button style
    already used for "Match transfers") that opens `TransactionFiltersDialog`. When
    `activeFilterCount > 0`, render a small badge on the button — reuse the pill style already in
    `components/nav/sidebar-nav.tsx` (`rounded-full px-1.5 py-0.5 font-mono text-[11px]
tabular-nums`), colored with the existing `iris` accent to match "active" states elsewhere.
- `filtered` (the existing `.filter()` reduction) gains clauses for every new field: `payee`
  (case-insensitive `.includes()`), `accountIds`/`categoryIds` (membership check, empty array =
  no filter, replacing the old strict equality checks), `from`/`to` (in addition to the existing
  `period` check — both apply if both set), `type`, `amountMin`/`amountMax` (parsed as numbers,
  compared against `Number(t.amount)`), and the three flags.
- `handleAccountFilterChange`'s "reset period on account change" logic is preserved but adapted:
  the statement/month Period Picker only renders when `accountIds.length === 1` (was: a single
  non-empty string), and switching away from exactly one selected account resets `periodMode` to
  `'ALL'`, same as today.
- The summary bar's transaction count/credit/debit/net figures are unaffected — they already
  derive from `filtered`, so every new filter clause flows through automatically.

## Non-goals (this iteration)

- Server-side filtering/pagination of transactions — out of scope per the "client-side stays
  client-side" decision above.
- Saved filter presets ("My work expenses view") — not requested; the URL itself is the
  shareable/bookmarkable unit for now.
- Filtering the note field in the search box — "payment name" maps to `payee` specifically per the
  feature request's wording, not `note`.
- Merging the statement/month Period Picker into the new date-range filter.

## Checklist

- [ ] `components/transactions/transaction-filters-dialog.tsx` (new): dialog UI, draft state,
      Apply/Reset
- [ ] `components/transactions/transactions-view.tsx`: `TransactionFilters` state synced to URL
      query params, payee search input, Filters button + active-count badge, extended `filtered`
      clauses, adapted single-account Period Picker condition
- [ ] Verify `Input type="date"`/`type="number"` render consistently with existing form usage in
      `components/ui/field.tsx` (no changes expected there, just reuse)
- [ ] Unit tests: filter-count derivation, URL param round-trip (read on mount, write on change),
      `filtered` clause coverage (each new field alone and combined)
- [ ] e2e: open the dialog, apply a combination of filters, confirm the ledger and summary bar
      update, confirm the badge count, confirm a filtered URL reloads to the same state
- [ ] `npm run format:fix && npm run lint`, `npm run test`, `npm run test:e2e`,
      `npx tsc --noEmit`, `npm run build`
