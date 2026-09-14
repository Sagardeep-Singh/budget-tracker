# Mobile-Friendly UI

## Status: Phase 1 and Phase 2 implemented

## Source

Design handoff from the Claude Design project "Mobile budget tracking app"
(`Ledger Mobile.dc.html`, option **2a**), read via its
`design_handoff_ledger_redesign/README.md` and `github.md` screen-map. That
README is treated as the source of truth for tokens, geometry, copy, and
screen contents — this doc does not restate it, only the parts relevant to
translating it into this codebase (Next.js App Router, Tailwind, existing
`components/ui/*`).

## Current state (verified, not assumed)

- **Zero responsive breakpoints anywhere in the repo** (`grep -rE '\b(sm|md|lg|xl):' app components` → 0 hits). The app is fixed-width desktop only.
- `app/(protected)/layout.tsx`: `Sidebar` (fixed `w-60 shrink-0`, always rendered) + `main` with a hardcoded `px-10` gutter and `max-w-[1120px]` content. On a phone the sidebar alone exceeds the viewport.
- `components/nav/sidebar.tsx` is an **async server component** — it does its own `getNavCounts(userId)` + `listAccounts(userId)` fetch. A bottom nav needs the same counts; this fetch must be shared, not duplicated.
- `components/ui/ring.tsx` already implements the README's ring spec (track + value circle, rose past `alertAt`, pace marker) via a `RingSize` enum with **baked desktop pixel values**:

  | size     | box | r   | stroke |
  | -------- | --- | --- | ------ |
  | hero     | 152 | 64  | 14     |
  | budget   | 96  | 40  | 9      |
  | category | 88  | 36  | 9      |
  | day      | 108 | 46  | 10     |
  | row      | 76  | 31  | 8      |

  Comparing against the README's mobile geometry table: **`day` (108/46/10) and `row`/budget-row (76/31/8) are already numerically identical to mobile** — direct reuse, no change. **`hero` (mobile: 132/56/12) and `category` (mobile: 66/27/7) differ from desktop** and need new sizes added to the `SIZE` map (e.g. `hero-mobile`, `category-mobile`), not a new component.

- `AddTransactionOverlay` is URL-driven (`?overlay=add` on any route) rendering a right-side `Drawer` → `TransactionForm`. The mobile "Log a spend" screen (README) is full-screen with a 3×4 keypad editing a 56px mono amount live — a different interaction, not a narrower drawer.
- Period selection today is `components/transactions/period-picker.tsx` (a popover). The README's mobile "Period sheet" is a bottom sheet with the same preset/month-grid/custom-range content.
- `components/trends/spending-line-chart.tsx` and `category-breakdown-bar.tsx` already scale (`viewBox` + `w-full`) — worth a real-device check at 402px width for label/hit-target legibility, not a rewrite.
- Design tokens (`app/globals.css` `[data-pal]` blocks) already match the README's Clay/Cobalt/Iris tables exactly, light and dark. **No token changes needed.**

## The load-bearing decision: which screens adapt in place vs. get a distinct mobile component

The README lists nine mobile screens. Five are the existing desktop screen rendered responsively; four need a genuinely different component because the interaction itself differs, not just the layout width.

| README mobile screen | Treatment                                                                                                                | Why                                                                                                                                                                                                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Overview             | **Adapt existing** `app/(protected)/dashboard/page.tsx`                                                                  | Single-column collapse of the same data (hero ring, budget rings, by-day chart, recent list) — README explicitly frames this as the "collapse two-column to one" case.                                                                                                              |
| Transactions         | **Adapt existing** `transactions-view.tsx`                                                                               | Same day-grouped list; chip filters become horizontally scrollable.                                                                                                                                                                                                                 |
| Budgets              | **Adapt existing** `budgets-view.tsx`                                                                                    | Same four-row ring list, just narrower cards.                                                                                                                                                                                                                                       |
| Accounts             | **Adapt existing** `accounts-view.tsx`                                                                                   | Same card list, one column at any width already close to this.                                                                                                                                                                                                                      |
| Settings             | **Adapt existing** `settings-view.tsx`                                                                                   | Already single-column-friendly (three grouped lists).                                                                                                                                                                                                                               |
| **Day**              | **Extract existing content, new mobile presentation** — the content isn't new, only its layout as a standalone screen is | Desktop already has this: `app/(protected)/dashboard/page.tsx:255-335` is a permanently-visible right-column panel driven by the existing `?day=N` search param (`dayHref`, line 36). Mobile needs the identical block full-screen instead of side-by-side — cheaper than it looks. |
| **Log a spend**      | **New mobile-only component**, replaces `AddTransactionOverlay`'s drawer at mobile width                                 | Full-screen + numeric keypad is a different UI, not `TransactionForm` in a narrower box.                                                                                                                                                                                            |
| **Categorize**       | **New mobile-only component**                                                                                            | Desktop is a table; mobile is one-card-at-a-time with a 12-segment progress bar — different interaction pattern, not a responsive table.                                                                                                                                            |
| **Period sheet**     | **New mobile-only component**, replaces `period-picker.tsx`'s popover at mobile width                                    | Bottom sheet vs. anchored popover; same underlying preset/month-grid/range content, different chrome.                                                                                                                                                                               |

Rule of thumb this table encodes: **if the desktop version is a panel, table, popover, or drawer whose entire premise is "space to spare," it needs a mobile-native replacement; if it's already a list/card/ring layout, it collapses.**

## Per-screen detail

Every screen below is graded against its current file so "adapt in place" means something concrete, not "make it responsive."

### 1. Overview — `app/(protected)/dashboard/page.tsx`

- **Line 96**: `grid grid-cols-[1.5fr_1fr] items-start gap-5` is the two-column split (left: hero/budgets/pie/by-day; right: day panel/triage/statement-cycle cards, lines 255+). Becomes `grid grid-cols-1 lg:grid-cols-[1.5fr_1fr]`. Below `lg`, source order puts the day panel _after_ the by-day chart — matches README's explicit "move the day panel under the chart" fallback, and needs no JSX reordering since the day panel is already the second grid child.
- **Line 182**: the 4-up budget-rings row (`grid grid-cols-4 gap-2.5`, using `Ring size="category"`) — README's mobile Overview also shows category rings at the `category` mobile size (66/27/7, not the `hero-mobile`/desktop 88/36/9). At narrow width 4 columns of a 66px ring is tight but plausible (see the Ring section below); if it doesn't fit cleanly, fall back to horizontal scroll rather than wrapping to 2×2 (wrapping changes the "4 categories at a glance" scan pattern the design relies on) — verify against a real 402px render before deciding.
- **Line 220**: `flex h-[120px] items-end gap-1` by-day bars — desktop renders all `daysInMonth` bars (~30). README's mobile Overview is a **7-bar week strip**, not the full month compressed. This is a real data/prop difference, not just fewer pixels per bar: the component needs a `days` slice (current week) on mobile vs. the full month array on desktop, or two render paths. Flag this explicitly for the architect — it's the one place in "adapt in place" that isn't purely CSS.
- Lines 255-335 (day panel): only its grid position changes per the `grid-cols-1` collapse above; content is unchanged except that entry-row amounts moved to `<Money>` during extraction (same sky/rose + sign visual output as the inline code it replaced — verified equivalent, not a regression). This block is also the literal source for the mobile Day screen (see below) — extract it into its own component (e.g. `components/dashboard/day-panel.tsx`) so Overview and the mobile Day screen both render it instead of copy-pasting.
- Recent list / triage / statement-cycle cards (lines 337+, not fully quoted above): already single-card-per-row, no structural change expected — confirm at implementation time.

### 2. Transactions — `components/transactions/transactions-view.tsx`

- **Line 186**: filter chips already `flex flex-wrap` — README wants horizontally-scrollable chips on mobile, which is a _different_ choice than wrapping (wrapping grows vertical space per active filter set; scrolling keeps the header height constant). Change to `flex flex-nowrap overflow-x-auto lg:flex-wrap` below `lg`.
- **Line 261**: the summary bar (Credit / Debit / Net, plus up to two more `border-l pl-6.5` stat groups) is a fixed-gap `flex` row — at 402px width with 5 stat groups this will overflow. Needs either horizontal scroll (`overflow-x-auto`) or a 2-row wrap (`flex-wrap`) below `lg`; the README doesn't specify which, so this is a UI-design call to make at implementation, not resolved here.
- Day-grouped list (line 313+): already stacks as divider + card rows, no structural change expected.
- Sticky bottom "+ Log a spend" CTA applies here too per the README (Overview / Day / Transactions).

### 3. Budgets — `components/budgets/budgets-view.tsx`

- **Line 156**: the add-budget form row (`flex items-end gap-2.5`, category `Select` fixed `w-[150px]` at line 175) will overflow at mobile width alongside the amount input and submit button. Needs `flex-col lg:flex-row` with full-width inputs below `lg`.
- **Line 202**: `grid grid-cols-2 gap-4` → `grid grid-cols-1 lg:grid-cols-2`. This is the only change the card grid itself needs — each card (line 211+) is already a self-contained row with a `row`-size ring, which the geometry table above confirms is already correct at mobile size (76/31/8, no `Ring` change needed for this screen).

### 4. Accounts — `components/accounts/accounts-view.tsx`

- **Line 58**: `grid grid-cols-2 gap-4` → `grid grid-cols-1 lg:grid-cols-2`. Same one-line fix as Budgets.
- Dashed "Connect an account" tile (line 104, `min-h-[190px]`) needs no change — already full-width-friendly within a grid cell.
- Matches README's mobile Accounts screen content (net-worth line, two account cards, connect tile) with no other structural gap identified.

### 5. Settings — `components/settings/settings-view.tsx`

- Already `flex flex-col gap-4` (line 52), three grouped `ledger-row` lists. No grid to collapse. Verify each row's right-aligned control (e.g. line 55+) doesn't clip at 402px — likely fine given the existing `min-w-0 flex-1` on the label side, but this is the one screen in Phase 1 that may need literally zero JSX changes, only confirmation.

### 6. Day (new mobile presentation of existing content)

- Source: `app/(protected)/dashboard/page.tsx:255-335`, extracted into `components/dashboard/day-panel.tsx` (see Overview above) — same props (`selectedDay`, `dayHref`), same `?day=N` URL contract, no new data fetching.
- Mobile-only wrapper renders this component as the _entire_ screen content below `lg` when reached from a by-day bar tap, with the existing back-to-period link, prev/next (`dayHref(day±1)`, already built), weekday title, ring, spent figure, entries list, and the `"Nothing logged this day."` empty state (line ~332) all carried over verbatim.
- Because `?day=N` already works standalone (it's just a search param on the dashboard route), the simplest implementation is: **no new route.** Below `lg`, when `?day=` is present, the dashboard page renders _only_ the day panel (full screen, with its own back link to clear the param); above `lg`, `?day=` continues to just update the side panel as today. This avoids the open question in the original draft of this plan about a separate `/day` route — the existing param already gives linkability and back-button support for free.

### 7. Log a spend — branches off `AddTransactionOverlay` / `TransactionForm`

- `components/transactions/add-transaction-overlay.tsx` (35 lines) is the exact branch point: it currently always renders `<Drawer><TransactionForm .../></Drawer>` when `?overlay=add`. Below `lg`, render a new `components/transactions/log-a-spend-mobile.tsx` full-screen shell instead of `Drawer`.
- `TransactionForm` (`components/transactions/transaction-form.tsx`) already owns all the business logic this needs: `accountId`/`categoryId`/`type`/`isPayment`/`isTransfer` state, the `suggestFor` category-match debounce, and `handleSubmit`. **Don't duplicate this logic in the mobile component.** Two viable approaches, left to the architect: (a) extract the state/submit logic into a shared hook (`useTransactionForm`) that both the desktop form and the mobile keypad screen call, or (b) keep `TransactionForm` as-is and have the mobile shell be a genuinely separate component that still POSTs to the same `/api/transactions` endpoint independently. (a) avoids drift between the two; (b) is less work if the mobile amount-entry UX ends up different enough that little else is shared. Given the field list (payee/date/account/memo/category chips) is otherwise identical between the two per the README, (a) is the better default unless implementation finds otherwise.
- The one genuinely new piece of UI: a 3×4 numeric keypad (digits, `.`, `⌫`) driving a 56px mono amount display live, replacing `TransactionForm`'s current plain `Input type="number"` for amount. This has no existing counterpart in the codebase — build it as a small standalone `components/ui/numeric-keypad.tsx` (controlled string value + onChange), not fused into the form component, so it's testable in isolation.

### 8. Categorize — `components/categorize/categorize-view.tsx`

- **Closer to done than it looks.** The component already has a `reviewOne`/`index` one-at-a-time mode (lines 109-119, "Review one by one" toggle) — this is exactly the README's mobile interaction _pattern_, just not its mobile _presentation_. Even in `reviewOne` mode today, the single visible row still renders via the same wide flex layout (`w-[230px]` payee column, `w-[250px]` reason column, line 143/150) built for a table, not a card.
- Mobile treatment: below `lg`, when a row is shown, render it as a card (payee/meta stacked, amount, rule-explanation text, category chips instead of the `Select` dropdown at line 154, "Skip" / "Confirm {category}" actions) plus a 12-segment progress bar reflecting `index`/`queue.length`. This can reuse the existing `reviewOne`/`index`/`confirm`/`visibleRows` state — only the JSX for one row's presentation needs a mobile branch, not new state.
- Category chips here should reuse whatever chip component the categorize-dropdown-skip e2e flow already exercises (`tests/e2e/categorize-dropdown-skip.spec.ts`) if one exists as a shared component, rather than inventing new chip markup — check before building.

### 9. Period sheet — branches off `period-popover.tsx`

- Located: `components/dashboard/period-popover.tsx` (126 lines) is the actual month-grid/custom-range surface the README describes — `components/transactions/period-picker.tsx` (73 lines, checked above) is a different, simpler component (ALL/MONTH/STATEMENT toggle + prev/next only, no calendar) used on the Transactions screen. **These are two separate period-selection UIs in the current app** — the mobile "Period sheet" in the README corresponds to `period-popover.tsx`'s content (preset pills, month grid, custom-range calendar with the two-tap start/end rule), not `period-picker.tsx`. Confirm which screens each currently serves before scoping which one(s) need a mobile bottom-sheet equivalent — likely just Overview's popover, but verify `period-picker.tsx`'s Transactions-screen usage doesn't also need one.
- `components/ui/drawer.tsx` is **not reusable as-is for a bottom sheet**: confirmed hard-coded `fixed top-0 right-0 bottom-0 w-[420px]` (right-side slide-in only, no bottom variant, no width flexibility via props). Build a new `components/ui/bottom-sheet.tsx` (fixed to viewport bottom, full-width, slide-up) rather than trying to parameterize `Drawer` — the positioning is different enough that forcing one component to do both would need conditional-everything on every style line, not a clean prop.
- Once the sheet shell exists, it reuses `period-popover.tsx`'s internal state/logic (preset selection, month grid, two-tap range picking, `goTo`) — only the outer chrome (anchored floating box → bottom sheet) changes, matching the pattern used for Log a spend and Categorize above.

## Breakpoint

Single breakpoint: Tailwind's default `lg` (1024px), applied at the shell level in `app/(protected)/layout.tsx`. The README's own target is "desktop ≥1040px content width, 960px minimum, fallback below that" — `lg` (1024px) is close enough to avoid adding a custom breakpoint token for a ~16px difference, and using a stock Tailwind breakpoint keeps the convention obvious to the next person touching this file. This becomes the only breakpoint in the codebase; don't introduce `sm:`/`md:` variants inside individual screens unless a specific one needs an intermediate tablet state (none identified yet).

Below `lg`: sidebar disappears, bottom nav appears, main content gutter drops from `px-10` to the README's mobile `20px` gutter, content width goes fluid (no `max-w-[1120px]`).

## Shell changes

`app/(protected)/layout.tsx` + `components/nav/sidebar.tsx`:

1. Extract the `getNavCounts` + `listAccounts` fetch out of `Sidebar` into the layout (or a shared server function both `Sidebar` and a new `BottomNav` call once), so a bottom nav doesn't double the query. `Sidebar` and `BottomNav` become pure presentational components taking counts/accounts as props.
2. `Sidebar` gets `hidden lg:flex` (currently unconditionally rendered).
3. New `components/nav/bottom-nav.tsx`: `lg:hidden`, fixed bottom bar, README's condensed nav set (not all nine sidebar items fit a bottom bar — needs its own icon/label subset, likely Overview/Transactions/Categorize/Budgets/More or similar; exact set is a UI-design decision deferred to implementation, not fixed here).
4. `main`'s `px-10` / `max-w-[1120px]` becomes `px-5 lg:px-10` / no max-width below `lg`.
5. The floating "+ Log a transaction" pill (currently inside `Sidebar`) becomes the README's sticky bottom CTA on mobile Overview/Day/Transactions specifically (not global) — this is a per-screen placement, not a shell-level element like the bottom nav.

## URL-state pattern — keep it, branch the renderer

Both `?overlay=add` (add-transaction) and the period picker already use URL/search-param-driven state (`AddTransactionOverlay` per its own comment: "URL-driven so no context provider is needed and the back button closes it"). Keep this pattern for mobile — don't introduce a new state mechanism. At the point each overlay renders, branch on viewport (CSS-only: render both, show/hide via `lg:hidden`/`hidden lg:block`, since this is a Server Component tree and there's no reliable server-side viewport detection) between the existing `Drawer`/`Modal` content and the new mobile-native component (full-screen keypad entry, bottom sheet). Same `open`/`close` URL contract, different visual shell.

## Phasing

Phase 1 must be shippable alone — it's the actual "mobile-friendly" milestone; Phase 2 is polish/parity with the design's mobile-specific flows.

**Phase 1 — responsive shell + adapt-in-place screens** (per-screen detail above)

- [x] Shell: nav-counts + accounts fetched once in `app/(protected)/layout.tsx` and passed down (`Sidebar` is now a sync presentational component, and its duplicate `listAccounts` call is gone), new `components/nav/bottom-nav.tsx` (4 links + "More" `Modal`), `Sidebar` is `hidden lg:flex`, `main` gutters `px-5 lg:px-10` with bottom-nav clearance. Nav item list extracted to `lib/nav/items.tsx` (`buildSidebarItems` / `buildMoreItems`; `.tsx` because it holds JSX icons). `SidebarNav` gained `onNavigate` so the "More" modal closes on tap.
- [x] Overview (§1): `grid-cols-1 lg:grid-cols-[1.5fr_1fr]`; hero ring rendered at both sizes (CSS-visibility split) with a shared label helper; 4-up category rings duplicated at `category-mobile` with `min-w-0`/`break-words`; by-day bars split via the new pure `getByDayBars` (`lib/dashboard/day-bars.ts`, unit-tested) — full month at `lg+`, clamped 7-day window below. Day-panel extraction deferred to Phase 2 (§6), which is where it's needed.
- [x] Transactions (§2): filter chips → `flex-nowrap overflow-x-auto lg:flex-wrap` (chips `shrink-0`); summary bar **wraps** (scrolling would hide Net with no affordance), divider borders drop below `lg`; running-balance column is `hidden lg:block` (it squeezed the payee cell to zero width at 402px).
- [x] Budgets (§3): add-budget form → `flex-col lg:flex-row` with full-width inputs/submit; card grid → `grid-cols-1 lg:grid-cols-2`.
- [x] Accounts (§4): card grid → `grid-cols-1 lg:grid-cols-2`.
- [x] Settings (§5): no structural change needed; `pillGroup` now `flex-wrap justify-end` as a defensive tweak.
- [x] `Ring`: `hero-mobile` (132/56/12) and `category-mobile` (66/27/7) added to the size map (now exported as `RING_SIZES` for the regression test); pace-marker radius fix for `hero-mobile`. Rejected the `mobile?: boolean` option — it would permit combinations (`mobile` + `budget`) the design doesn't have.
- [x] `Drawer`: `inset-0 w-full` below `lg`, unchanged `w-[420px]` right-side panel at `lg+` — required in Phase 1 because the sticky CTA reuses it.
- [x] Trends: no chart changes needed at 402px, but its two-column grid and the shared `ScreenHeader` title row both overflowed — `grid-cols-1 lg:grid-cols-[1.5fr_1fr]` and a `flex-wrap` title row fix it. Dashboard loading skeleton made responsive to match the page it stands in for.
- [x] Sticky bottom "+ Log a spend" CTA on Overview/Transactions (reuses existing `?overlay=add`); the Day screen half lands with Phase 2 (§6).

**Phase 2 — mobile-native flows** (per-screen detail above)

- [x] Day (§6): `components/dashboard/day-panel.tsx` extracted and used by both the Overview side card (`ringSize` default `budget`) and, below `lg` when `?day=` is present, as the whole screen (`ringSize="day"` — the 108/46/10 size that existed unused, plus a `lg:hidden` "Back to Overview" link). No new route. Entry-row amounts now use `Money`; the big "Spent" figure deliberately does not — its iris/rose means under/over pace, which doesn't map onto `Money`'s income/expense tones. The collapse uses new wrapper divs, never an appended `hidden`, since `cn` has no tailwind-merge.
- [x] Log a spend (§7): state/submit logic extracted to `lib/transactions/use-transaction-form.ts` (option (a)) with the payload shaping split out as the pure, unit-tested `lib/transactions/transaction-payload.ts` — `isPayment` is forced false whenever the account/type combination is ineligible, even if the (conditionally rendered) checkbox state is stale. `TransactionForm`'s `handleSubmit` is now a FormData→values adapter and its desktop inputs stay uncontrolled. New `components/ui/numeric-keypad.tsx` over the pure `lib/ui/numeric-keypad.ts` (`applyKeypadInput` / `isValidKeypadAmount`, which rejects the keypad-only `'1.'` state), and `components/transactions/log-a-spend-mobile.tsx` — a full-screen `role="dialog"` with `Drawer`'s focus-trap/Escape/scroll-lock pattern copied in, `mobile-`prefixed field ids (both shells are in the DOM at once), and an `aria-live` amount announcement. `add-transaction-overlay.tsx` branches between the two; the Transactions header's second "Add transaction" entry point is now desktop-only (the sticky CTA covers mobile).
- [x] Categorize (§8, pulled forward into Phase 1): mobile card branch for the existing `reviewOne`/`index` row (desktop table unchanged, `hidden lg:block` / `lg:hidden` split same as other screens). Category dropdown replaced with one-tap chips — tapping confirms immediately, no separate confirm step, matching the desktop dropdown's existing behavior. The rule's suggestion (if any) sorts first with an accent ring. Progress shown as a proportional bar rather than 12 fixed segments (the README's mockup fixture happened to have exactly 12 rows; a real queue's length varies, so a fraction-based bar is the correct generalization, not a literal segment count). Pulled forward from Phase 2 because the _existing_ desktop table was actually broken at mobile width before this fix — its fixed-width columns pushed the category select and Skip button off-screen entirely below `lg`, not just cramped.
- [x] Period sheet (§9): scope confirmed as `period-popover.tsx` only (used by Dashboard, Budgets and Trends via `basePath`, so one fix covers all three). Its preset pills + 12-month grid are now a shared internal `PeriodPickerBody` rendered by both the `lg:block` anchored box and a new `components/ui/bottom-sheet.tsx` below `lg`. The sheet is rendered **inside** the component's existing outside-click `ref`, otherwise every tap in it registers as an outside click. `period-picker.tsx` (Transactions' ALL/MONTH/STATEMENT toggle) needed no sheet — it has no drill-down content, just `flex-wrap`.

**Cross-cutting note from Phase 2**: the CSS-visibility split (`lg:hidden` / `hidden lg:block`) hides components but does **not** unmount them, so a mobile-only overlay's effects still run at desktop width. Both new overlays guard their body-scroll lock and focus trap on `isDesktopViewport()` (`lib/ui/viewport.ts`), and release the lock with `removeProperty` rather than restoring a snapshot — two overlays mounted at once would otherwise hand the lock back and forth and leave the page unscrollable.

## Non-Goals

- No new design tokens, palette, or typography — already match the README exactly in `app/globals.css`.
- No tablet-specific (`md:`) intermediate layout unless a specific screen is found to need one during implementation.
- No native app / PWA wrapper — this is responsive web only, per the README's own framing ("recreate in the target codebase's own environment... React... Next.js").
- No changes to desktop layout/behavior above `lg` — Phase 1 and 2 are additive.

## Open questions for whoever implements this

- Exact bottom-nav item set (5 slots max is typical; README lists 9 sidebar items — needs a "More" overflow decision).
- Whether `Ring`'s mobile-size extension is a new enum member or a `mobile` boolean prop — small API decision, not a design decision, left to implementation.

_(The `period-picker.tsx` scope and the `TransactionForm` state-sharing approach were listed here until Phase 2 — both are resolved below.)_

## Resolved during implementation (Phase 2)

- **`period-picker.tsx` scope**: no mobile sheet needed. It has no drill-down content — a pill row plus prev/next — so it only needed `flex-wrap`. The bottom sheet belongs to `period-popover.tsx`, which all three of Dashboard/Budgets/Trends use via `basePath`.
- **`TransactionForm` state-sharing**: option (a), the extracted `useTransactionForm` hook, with payload shaping split into a pure `buildTransactionPayload` so the stale-`isPayment` rule is unit-testable. The desktop form keeps its uncontrolled inputs and only its `handleSubmit` changed.
- **CSS-visibility split has a real cost, not just a styling detail**: Phase 1's pattern (both desktop and mobile trees mounted, one hidden via `lg:` classes) means a hidden overlay's effects still run. Found and fixed for `BottomSheet`/`LogASpendMobile` (`lib/ui/viewport.ts`'s `isDesktopViewport()` guard — without it, opening the desktop period popover or add-transaction drawer also ran the hidden mobile version's scroll-lock and focus-trap effects, fighting the visible one for focus). **Acknowledged limitation**: the guard is read once per open/close, not on resize — a window manually resized across `lg` while an overlay is open won't re-evaluate. Accepted as out of scope; not a real path for an actual phone.

## Resolved during detail pass (were open questions in the first draft)

- **Day screen routing**: no new route needed. `?day=N` already works standalone as a dashboard search param (`dayHref`, `page.tsx:36`) — below `lg`, the dashboard renders only the day panel when `?day=` is present; above `lg`, unchanged. Linkability and back-button support come free from the existing param.
