# Confirm dialogs: replace `window.confirm`/`alert`, guarantee confirmation before destructive actions

## Goals / acceptance criteria

- No code path uses the browser's native `confirm()`/`alert()`. All confirmations render as an in-app, centered dialog matching the app's visual language (Ledger's `Modal`/dialog styling, not the OS chrome).
- Every destructive, irreversible action (a delete with no undo) requires explicit user confirmation before the request fires — including the two spots below that currently have **none**.
- The confirm dialog is reusable: one component + one call pattern, not a bespoke implementation per screen.
- Cancelling (Escape, backdrop click, or explicit Cancel button) performs no action and closes cleanly.
- The destructive button in the dialog is visually marked as dangerous (reuse `Button variant="danger"`).

## Current state

`components/ui/modal.tsx` wraps a native `<dialog>` (`showModal()`), which the browser centers in the viewport automatically via the UA stylesheet — no extra centering work needed, just build the confirm UI as a small/fixed-width variant of it.

## Call sites to migrate (already have a `window.confirm`, just need the dialog swap)

| File | Line | Current message |
|---|---|---|
| `components/transactions/transactions-view.tsx` | 96 | "Delete this transaction?" |
| `components/categories/categories-view.tsx` | 39 | "Delete this category? Transactions using it become uncategorized." |
| `components/accounts/accounts-view.tsx` | 40 | "Delete this account and all its transactions?" |

Note: `categorize-view.tsx` has a local function literally named `confirm` (lines 143, 163) — this is **not** `window.confirm`, it's the categorization-accept handler. Not in scope; do not touch.

## Destructive actions with **zero** confirmation today (must gain one, not just migrate one)

| File | Line | Action |
|---|---|---|
| `components/rules/rules-view.tsx` | 42 (`handleDelete`) | `DELETE /api/rules/:id` fires immediately on click, no prompt at all |
| `components/budgets/budgets-view.tsx` | 67 (`handleDelete`) | `DELETE /api/budgets/:id` fires immediately on click, no prompt at all |

Both are one-click, undo-less deletes today — highest-priority gap, arguably a bug independent of this feature.

Out of scope: sign-out (`components/nav/sidebar.tsx` via `signOutAction`) is not a destructive data action — no confirmation needed. CSV import commit (`components/import/import-view.tsx`) is a create, not a delete — out of scope unless product wants an "are you sure" on large imports (flagging as an open question below, not building it).

## Design

### `ConfirmDialog` component (new, `components/ui/confirm-dialog.tsx`)

Thin wrapper around the existing `Modal`, fixed to a small width (e.g. `max-w-sm`) so it reads as a confirm prompt rather than a form dialog:

```ts
type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string; // default "Delete"
  cancelLabel?: string;  // default "Cancel"
  danger?: boolean;      // default true — styles confirm button with variant="danger"
  pending?: boolean;     // disables buttons + shows loading state on confirm button while the request is in flight
  onConfirm: () => void;
  onCancel: () => void;
};
```

Renders `<Modal open={open} onClose={onCancel} title={title} className="max-w-sm">` with the description text, a Cancel (`variant="secondary"`) and Confirm (`variant={danger ? 'danger' : 'primary'}`) button pair.

### Invocation pattern

Prefer a small local-state pattern per view over a global promise-based `confirm()` helper, to match the codebase's existing per-view `useState` style (see `categorize-view.tsx`'s local state, no context providers except the URL-driven overlay pattern). Each view that needs a confirm dialog holds:

```ts
const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
```

Delete button sets `pendingDeleteId`; `ConfirmDialog open={pendingDeleteId !== null} onConfirm={...} onCancel={() => setPendingDeleteId(null)}` performs the actual `fetch(... DELETE)` + `router.refresh()` + clears state. This keeps every call site's diff small and consistent, and avoids introducing a new global/context abstraction for a single dialog use case (per CLAUDE.md: extend existing patterns before adding abstractions).

If a 6th call site appears later and the duplication becomes real, revisit a shared `useConfirm()` hook — not needed for 5 call sites.

## Open questions (flagging, not deciding)

- Should the CSV import commit step (bulk-inserts many transactions, no undo) also get a confirmation? Leaving out of scope for this feature unless product says otherwise — it's a create, not a delete, and already has a preview step.
- Categorize screen's "skip" and per-row categorize actions are non-destructive (just sets/clears a category) — explicitly excluded from "destructive action" scope.

## Checklist

- [ ] Build `components/ui/confirm-dialog.tsx` per the design above, using `Modal` + `Button`
- [ ] Migrate `transactions-view.tsx` delete flow off `window.confirm` to `ConfirmDialog`
- [ ] Migrate `categories-view.tsx` delete flow off `window.confirm` to `ConfirmDialog` (keep the "transactions become uncategorized" copy in the description)
- [ ] Migrate `accounts-view.tsx` delete flow off `window.confirm` to `ConfirmDialog` (keep the "and all its transactions" copy)
- [ ] Add a `ConfirmDialog` to `rules-view.tsx`'s `handleDelete` (currently no confirmation at all)
- [ ] Add a `ConfirmDialog` to `budgets-view.tsx`'s `handleDelete` (currently no confirmation at all)
- [ ] Add `pending` state wiring so the confirm button shows a loading state and disables while the delete request is in flight
- [ ] Unit/e2e test plan from tester (per updated CLAUDE.md workflow) before implementation, covering: cancel leaves data untouched, confirm fires exactly one delete request, dialog is keyboard-dismissible (Escape)
- [ ] `npm run format:fix && npm run lint` and full test suite (`npm run test`, `npm run test:e2e`) green
