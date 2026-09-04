# Ledger redesign (Desktop Refresh + Mobile 2a)

Source: Claude Design project `a6664e54-780b-43be-bdf6-2a8abbc85ac9`, files
`Ledger Desktop - Refresh.dc.html` and `Ledger Mobile.dc.html` (option 2a).
Full spec in that project's `README.md` (design tokens, ring geometry, screen
inventory, interactions, state shape) — treat it as source of truth for
values; this doc tracks implementation staging only.

Decoded design references (local, not committed):
`/tmp/claude-1000/-home-ssingh-Workspaces-Development-budget-tracker/23805e56-074f-4275-8706-8be35399fcc9/scratchpad/ledger-desktop.dc.html`
`/tmp/claude-1000/-home-ssingh-Workspaces-Development-budget-tracker/23805e56-074f-4275-8706-8be35399fcc9/scratchpad/ledger-mobile.dc.html`

Delivered as a stack of PRs, each branched off the previous. Desktop first
(existing screens all have a desktop route today), mobile-only screens
(day/picker/entry) and responsive reflow last.

Mapping design screen -> existing route:

- Overview -> `app/(protected)/dashboard`
- Transactions -> `app/(protected)/transactions`
- Categorize -> `app/(protected)/categories` (+ `app/api/categorize`)
- Budgets -> `app/(protected)/budgets`
- Accounts -> `app/(protected)/accounts`
- Rules -> `app/(protected)/rules`
- Settings -> **new**, no existing route/schema. Flagged below.
- Import CSV modal -> currently a full route `app/(protected)/import`, design
  makes it a modal overlay from any screen. Flagged below.

Open questions / flags (not decided by design, need product call before
those stages land):

- Settings screen: design shows Account/Preferences/Data groups with live
  controls (email, password, currency, "Delete account", CSV export). No
  backing schema/services exist. Will scope minimally (theme+palette prefs
  client-side, rest as read-only/disabled) unless told otherwise.
- Import-as-modal vs Import-as-route: keep the route for now, revisit when
  that stage comes up — bigger nav/UX change than a restyle.
- `dataState` (loading/empty/error) is explicit per screen in the design; in
  production it's derived from fetch/query state, not a passed prop.

## Stack

- [x] **Stage 0 — plan** (this doc)
- [ ] **Stage 1 — foundation**: palette tokens (Clay default, Cobalt, Iris) x
      light/dark via `data-pal`/`data-theme` in `app/globals.css`; Space
      Grotesk / Inter / IBM Plex Mono via `next/font/google`; `Ring` SVG
      component (`components/ui/ring.tsx`, covers all 7 size variants from
      the geometry table); base primitives (pill button, chip, card) if not
      already present in `components/ui`.
- [x] **Stage 2 — shell**: sidebar nav redesign (`components/nav/sidebar.tsx`,
      `components/nav/sidebar-nav.tsx`) with live badge counts
      (`lib/services/nav.ts`) + `components/nav/screen-header.tsx` shared
      header pattern, built but not yet adopted by any screen (lands with
      each screen's own stage). Protected layout content width matches the
      design's `1120px`/`960px` bounds. Sidebar's "+ Log a transaction"
      links to `/transactions` rather than opening a global modal — that's
      Stage 10 (Add transaction overlay) work. No `Settings` nav item yet —
      waiting on Stage 9.
- [ ] **Stage 3 — Overview**: hero ring card, budgets card (4 category
      rings), "by day" bar chart + day panel, triage promo card, account
      cycle card.
- [ ] **Stage 4 — Transactions**: filter chips + period stepper, summary bar,
      day-grouped transaction cards, detail drawer overlay.
- [ ] **Stage 5 — Categorize**: action bar (accept-all, review one-by-one),
      suggestion table/queue with rule explanation.
- [ ] **Stage 6 — Budgets**: form row + 2-up ring cards.
- [ ] **Stage 7 — Accounts**: 2-up account cards, connect tile, error/needs-
      attention variant.
- [ ] **Stage 8 — Rules**: new-rule form + rules table.
- [ ] **Stage 9 — Settings**: new screen, scoped per the flag above.
- [ ] **Stage 10 — Overlays**: period popover, add-transaction modal, import
      CSV modal, undo toast, sign-in screen redesign.
- [ ] **Stage 11 — Data states**: loading skeleton (`om-pulse`), empty,
      error banners across the above screens.
- [ ] **Stage 12 — Mobile**: responsive reflow (single column, bottom nav) + mobile-only screens (Day, Period sheet, Log-a-spend w/ keypad,
      mobile Categorize/Transactions/Budgets/Accounts/Settings variants).

Each stage: implement -> `npm run format:fix && npm run lint` -> test suite
-> commit -> PR against the previous stage's branch -> update this checklist.
