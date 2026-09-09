# Button icons and loading states

## Goal

Every button in the app gets a contextual icon and a real loading state (spinner + disabled), replacing the current "swap the label text" pattern. Consolidate on the shared `Button` component so this logic lives in one place instead of being re-implemented per screen.

## Acceptance criteria

- `Button` (`components/ui/button.tsx`) accepts an `icon` and a `loading` prop; existing `variant`/`className`/native button props keep working unchanged (no breaking callers).
- When `loading` is true: the icon slot shows a spinning `Loader2`, the button is disabled (even if `disabled` wasn't passed), and the label stays in place (no layout shift from text swapping — keep the "Saving…" style text if a caller wants it, but it's no longer required to prevent double-submits).
- Every button enumerated below gets an icon assigned appropriate to its action, and every button that performs an async action (form submit, fetch call) uses `loading` instead of ad-hoc `disabled={pending}` + text swap.
- Icon-only buttons (close/dismiss, pagination arrows) get `aria-label` (several already do — keep them).
- No visual regression to existing spacing/sizing; icons use a single consistent size (16px) via the icon library's `size` prop, not manual `<svg>` sizing.

## Non-goals

- Not touching the categorize screen's dropdown/skip flow (separate branch: `categorize-dropdown-skip`).
- Not touching confirmation dialogs (separate branch: dialogs work) — delete buttons get a loading spinner here, but the confirm-before-delete behavior is that branch's job. Land order doesn't matter; they touch the same lines in a few files (`accounts-view.tsx`, `categories-view.tsx`, `transactions-view.tsx`) so whichever merges second should rebase.
- Not restyling button colors/variants — `variantClasses` in `button.tsx` stays as-is.

## Icon library

**No icon system exists in the repo today** (checked `package.json` and `components/ui/` — only hand-drawn SVGs are `logo-mark.tsx` and `ring.tsx`, both bespoke brand marks, not a general icon set).

Proposed: **`lucide-react`**.
- Tree-shakeable named imports (`import { Trash2 } from 'lucide-react'`) — only used icons ship in the bundle.
- Pure SVG components, no extra CSS/font loading, no runtime CSS-in-JS — fits the existing Tailwind-only styling approach.
- Already the de-facto default for shadcn/Tailwind stacks, wide icon coverage, MIT licensed, actively maintained.
- Add as a normal dependency: `npm install lucide-react`.

## `Button` component changes

```tsx
type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  icon?: LucideIcon;       // e.g. Plus, Trash2 — rendered at 16px, leading edge
  loading?: boolean;       // shows Loader2 (animate-spin) in place of `icon`, forces disabled
};
```

- Icon renders before `children` with a fixed gap (existing `gap-2` on the button already handles spacing).
- `loading` short-circuits the icon slot to `<Loader2 size={16} className="animate-spin" />` regardless of whether `icon` was passed, and ORs into the native `disabled` attribute: `disabled={props.disabled || loading}`.
- Icon-only usage (no children, just `aria-label`) must keep working — icon renders, no gap applied when there's no label (conditionally apply `gap-2` only when `children` is present, or accept the small unused gap as fine since padding still centers a single icon — architect's call at implementation time, flag if it looks off).

## Buttons to update, file by file

### Already use `<Button>` — migrate to `icon`/`loading` props

| File | Line | Current | New icon | Loading source |
|---|---|---|---|---|
| `components/accounts/account-form.tsx` | 106 | `disabled={pending}` + text swap | `Check` (save) / `Plus` (create) — pick by `account ? 'Save changes' : 'Add account'` branch | `loading={pending}` |
| `components/categories/categories-view.tsx` | 53 | `disabled={pending}` + text swap | `Plus` | `loading={pending}` |
| `components/settings/change-password-form.tsx` | 98 | `disabled={pending}` + text swap | `Lock` | `loading={pending}` |
| `components/import/import-view.tsx` | 233 | `disabled={loading}` + text swap ("Preview") | `Eye` | `loading={loading}` |
| `components/import/import-view.tsx` | 255 | `disabled={loading}` + text swap ("Import N rows") | `Upload` | `loading={loading}` |

### Raw `<button className="bg-iris ...">` duplicating primary style — migrate to `<Button>` itself, then apply icon/loading

| File | Line | Action | New icon |
|---|---|---|---|
| `components/budgets/budgets-view.tsx` | 109 | primary submit (set budget) | `Check` |
| `components/categorize/categorize-view.tsx` | 106 | "Accept all" | `CheckCheck` |
| `components/categorize/categorize-view.tsx` | 160 | per-row confirm (dropdown-driven) | `Check` — note: this button is likely removed/reshaped by the `categorize-dropdown-skip` branch; coordinate or skip if that branch lands first |
| `components/rules/rules-view.tsx` | 92 | primary submit (add rule) | `Plus` |
| `components/transactions/transaction-form.tsx` | 229 | primary submit (save transaction) | `Check` |
| `components/auth/login-form.tsx` | 41 | sign in | `LogIn` |

### Destructive/delete buttons — need icon AND a loading state added (currently no pending state at all, just an immediate `fetch` after `confirm()`)

| File | Line | Action | New icon |
|---|---|---|---|
| `components/accounts/accounts-view.tsx` | 76, 83 | delete account row actions | `Trash2` (delete), `Pencil` (edit, if 76/83 is edit+delete pair — verify at implementation) |
| `components/categories/categories-view.tsx` | 63 | delete category | `Trash2` |
| `components/transactions/transactions-view.tsx` | 184, 345 | delete transaction / row action | `Trash2` |
| `components/rules/rules-view.tsx` | 128 | delete rule | `Trash2` |

These currently call `fetch` with no `pending` state — add local `useState` pending per-row (or reuse existing row-level state if present) so the spinner has something to bind to. This is new state, not just a prop rename — call it out in the PR since it's slightly more than a mechanical `Button` swap.

### Secondary/utility buttons — icon only, no loading needed (synchronous actions)

| File | Line | Action | New icon |
|---|---|---|---|
| `components/nav/sidebar.tsx` | 60 | sign out | `LogOut` |
| `components/dashboard/period-popover.tsx` | 59, 70, 80, 101 | period nav (prev/next/open/select) | `ChevronLeft` / `ChevronRight` / `Calendar` (verify per-button role at implementation) |
| `components/transactions/period-picker.tsx` | 37, 52, 61 | period nav | `ChevronLeft` / `ChevronRight` |
| `components/settings/settings-view.tsx` | 69, 89 | settings actions (verify role at implementation) | TBD — read file at implementation time |
| `components/transactions/transaction-form.tsx` | 116, 128, 204, 236 | cancel / secondary actions | `X` (cancel/close), others TBD — read file at implementation time |
| `components/ui/modal.tsx`, `components/ui/drawer.tsx` | close (×) | already icon-only (uses a literal `×` character) | `X` — replace the literal glyph with the icon component for visual consistency |
| `components/ui/toast.tsx` | dismiss | check current glyph, likely same `×` treatment | `X` |

## Checklist

- [ ] `npm install lucide-react`
- [ ] Extend `Button` props (`icon`, `loading`) and rendering in `components/ui/button.tsx`
- [ ] Migrate the 5 existing `<Button>` callers to `icon`/`loading`
- [ ] Migrate the 6 raw primary `<button>` callers to `<Button>` + `icon`/`loading`
- [ ] Add pending state + `Trash2` icon to the 4 delete-action files (new state, not just a prop swap)
- [ ] Swap `×` glyphs in `modal.tsx`, `drawer.tsx`, `toast.tsx` for the `X` icon
- [ ] Icon-ify remaining secondary/nav buttons (sidebar sign-out, period pickers, transaction-form secondary actions, settings-view — confirm exact roles when editing each file)
- [ ] Verify icon-only buttons keep their `aria-label` and don't pick up an unwanted `gap-2` with no label text
- [ ] `npm run format:fix && npm run lint` and `npm run test` pass
- [ ] Manual pass in the browser: trigger each loading state (slow network via devtools throttling) and confirm spinner shows, button disables, no layout jump
