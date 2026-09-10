# Add transaction: sidebar instead of dialog

## Goal

"Add transaction" should open as a right-side sidebar (`Drawer`), matching the existing
transaction-detail/edit flow, instead of the current centered `Modal`. Two entry points exist
today and both need the change:

- `components/transactions/add-transaction-overlay.tsx` — global "+ Log a transaction" action,
  URL-driven via `?overlay=add`, mounted from the sidebar/layout so it works from any screen.
- `components/transactions/transactions-view.tsx` — the Transactions screen's own "Add" button
  (`openCreate`/`open`/`dialogKey` state), currently a separate local `Modal`.

## Acceptance criteria

- Clicking "+ Log a transaction" (global) or "Add" (Transactions screen) opens a right-side
  drawer, not a centered dialog — visually and behaviorally consistent with the existing
  transaction-detail/edit drawer (same width, slide-in edge, Escape-to-close, backdrop-free style).
- `TransactionForm` itself is unchanged — only the container swaps from `Modal` to `Drawer`.
- Closing (Cancel, save success, Escape, back button for the URL-driven overlay) behaves the same
  as it does today, just inside the new container.
- No regression to the existing edit-transaction drawer.

## Current state (confirmed by reading the code)

- `components/ui/modal.tsx`: native `<dialog>` centered via `max-w-md`, backdrop, `showModal()`.
- `components/ui/drawer.tsx`: fixed right-side panel (`fixed top-0 right-0 bottom-0 w-[420px]`),
  no `<dialog>` semantics, no backdrop, Escape handled manually via a `keydown` listener, no focus
  trap, no scroll-lock on `<body>`.
- `add-transaction-overlay.tsx` renders `<Modal ...><TransactionForm .../></Modal>`, gated by
  `searchParams.get('overlay') === 'add'`.
- `transactions-view.tsx` renders its own `<Modal key={dialogKey} ...><TransactionForm .../></Modal>`
  for `openCreate`, plus a separate `<Drawer key={drawerKey} ...>` for `detail`/edit that already
  wraps `TransactionForm` with `transaction={detail}`.

## Gaps to close before/while implementing

`Drawer` is currently thinner than `Modal`: no focus trap, no scroll lock, no `aria-modal`/role,
and the close "×" has no visible focus style. The edit flow already ships with these gaps today,
so swapping Add onto `Drawer` doesn't regress anything relative to Edit — but if the team wants to
tighten dialog accessibility as part of this change (focus trap, `role="dialog"` +
`aria-modal="true"`, scroll lock, returning focus to the trigger on close), that should be done to
`Drawer` once, benefiting both Add and Edit. Flagging as an open question rather than assuming
scope — default plan below does NOT include this hardening, only the container swap.

## Plan

1. In `add-transaction-overlay.tsx`, replace `Modal` with `Drawer` (same `open`/`onClose`/`title`
   props — `Drawer`'s API already matches `Modal`'s for this usage). Drop the modal-only
   `className="max-w-[520px]"` (not meaningful for a fixed-width drawer).
2. In `transactions-view.tsx`, replace the `openCreate` `Modal` block with a `Drawer` using the
   same `dialogKey`/`open`/`setOpen` state (remount-on-key pattern already used for the edit
   drawer, so form state resets between opens) — title `"Add transaction"`.
3. Visually confirm both drawers (global overlay + in-page) render identically to the existing
   edit drawer — same width, padding, header style — since `Drawer` is shared and unstyled per
   call site beyond `className`.
4. No service/validator/schema changes; no new tests needed (no new logic, pure container swap) —
   spot-check by hand: open via sidebar link, open via Transactions screen "Add" button, submit,
   cancel, Escape, browser back (URL-driven overlay only).

## Checklist

- [ ] Swap `Modal` → `Drawer` in `add-transaction-overlay.tsx`
- [ ] Swap `Modal` → `Drawer` in `transactions-view.tsx`'s create flow
- [ ] Manually verify both entry points open/close/submit/cancel correctly
- [ ] Manually verify no regression on the existing edit-transaction drawer
- [ ] `npm run format:fix && npm run lint`
- [ ] Decide (separate from this plan, or as a follow-up) whether to harden `Drawer`'s
      accessibility (focus trap, `aria-modal`, scroll lock) — not in scope here
