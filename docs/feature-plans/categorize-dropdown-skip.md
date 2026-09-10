# Categorize screen: dropdown + skip, no extra step

## Problem

`components/categorize/categorize-view.tsx` currently makes categorizing a matched
transaction take two clicks: a big button showing the suggested category name
must be clicked to accept it, and picking a _different_ category requires first
clicking "Change" to reveal the `<Select>`, then choosing a value. There's
already a "Skip" button, but it sits alongside the suggestion button and the
"Change" button — three actions competing for one row.

## Goal

Collapse this to two controls per row, always visible, no reveal step:

- **Category dropdown** — always rendered (not hidden behind "Change").
  Pre-selects the suggested category when one exists (`suggestedCategoryId`).
  Choosing any value in the dropdown immediately calls the existing `confirm`
  (PATCH `categoryId`) — no separate "accept" click.
- **Skip button** — always rendered next to the dropdown. Same behavior as
  today's Skip: in `reviewOne` mode, advance `index`; otherwise `removeRow`
  (client-side only, see open question below).

Net effect: a matched row goes from 1 click (accept) or 2 clicks (change) to
exactly 1 click in both cases — open the dropdown, pick a value.

## Acceptance criteria

- Each row renders a `<Select>` and a "Skip" button, no third button, no
  "Change" toggle state (`changing` state removed from the component).
- When `suggestedCategoryId` is present, the dropdown's initial value is that
  category (not a disabled placeholder).
- When there's no suggestion, the dropdown shows the existing "Choose
  category" placeholder as the first option.
- Selecting a category in the dropdown calls `confirm(row, categoryId)`
  exactly as today (PATCH, remove row, `router.refresh()`), for both the
  suggested-category case and the manual-pick case — one code path, not two.
- Skip does not call the PATCH endpoint — it only affects local queue/index
  state, matching current behavior.
- `acceptAll`, `reviewOne` toggle, and the toast/undo flow for `acceptAll` are
  unchanged.
- Keyboard/accessibility: dropdown remains a native `<select>` (existing
  `Select` component), each row's controls remain reachable via Tab.

## Non-goals

- No change to the rule-matching/suggestion algorithm (`lib/services/categorize.ts`).
- No change to `acceptAll` or the review-one-by-one flow itself.
- No schema change.

## Open question — does Skip need to persist?

Today "Skip" is purely client-side: `removeRow` filters the in-memory `queue`
state but never calls the API, and there's no "skipped" concept in the
`Transaction` model or `getCategorizeQueue` query (queue = all
`categoryId: null` transactions, full stop). So a skipped transaction:

- disappears from view for the rest of this client session, but
- reappears at the top of the queue on next page load / hard refresh
  (`router.refresh()` isn't even called after skip today, so it also
  reappears if the user navigates away and back within the same session).

This plan keeps that behavior as-is (client-side only, matching current
"Skip") since the user's request is about reducing the number of buttons per
row, not about persistence. **If persisted skip (e.g., a `skippedAt` column so
skipped transactions sort to the bottom instead of reappearing) is wanted,
that's a schema change and a separate, explicitly-scoped task** — flagging
per CLAUDE.md rather than assuming it's in scope here.

## Implementation checklist

- [ ] In `categorize-view.tsx`, remove the `changing` state and the
      conditional `changing === row.id ? <Select> : <>...suggestion/Change
button...</>` branch.
- [ ] Render the `<Select>` unconditionally per row:
  - `defaultValue={row.suggestedCategoryId ?? ''}`
  - placeholder `<option value="" disabled>Choose category</option>` only
    shown/selectable when there's no suggestion.
  - `onChange` → `if (e.target.value) void confirm(row, e.target.value)`.
- [ ] Keep the Skip button exactly as today (`reviewOne ? advance index :
removeRow`), just re-laid-out next to the dropdown instead of next to
      the old three-button group.
- [ ] Remove now-dead styling/markup for the old suggestion button and
      "Change" button.
- [ ] Manual check in dev: matched row → dropdown pre-filled with suggestion,
      picking it (or a different category) categorizes immediately; unmatched
      row → dropdown shows placeholder, Skip advances/removes without a
      network call.
- [ ] `npm run format:fix && npm run lint` and `npm run test`.
