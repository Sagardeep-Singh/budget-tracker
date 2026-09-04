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

**Correction (found while building Stage 3):** `app/(protected)/categories`
is plain category CRUD (add/rename/delete a category name) — it is _not_
the design's Categorize triage queue (payee/amount/rule-reason, accept-all,
confirm-or-skip). The design has no screen for bare category-name
management at all. Decision: Stage 5 builds the triage queue at a new
`/categorize` route; `/categories` stays as-is (out of design scope, still
linked from wherever it's useful, e.g. Budgets' category picker). Until
Stage 5 lands, the sidebar's "Categorize" link and the Overview triage
card's "Open queue" link point at `/categories` as an interim stand-in.

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
- [x] **Stage 3 — Overview**: hero ring card, budgets card (4 category
      rings), "by day" bar chart + day panel, triage promo card, account
      cycle card. New `lib/services/overview.ts` computes everything from a
      calendar-month period (period picker overlay is Stage 10, so month is
      fixed to "this month" for now); day selection is a plain `?day=N`
      link, no client state. Pace/pace-note math (daily pace = total budget
      limit / days in month, "pacing under/over" compares spent-so-far to
      expected-by-now) is this implementation's own interpretation — the
      design shows the numbers but not the formula. Triage promo card only
      renders when there's a queue (design doesn't show an empty variant for
      it). Cycle card shows the first credit-card account with a
      `statementDay` set; progress bar is _time elapsed in the cycle_, not
      spend-vs-limit — accounts have no credit-limit field. Removed the
      now-unused `lib/services/dashboard.ts` (folded into `overview.ts`).
- [x] **Stage 4 — Transactions**: summary bar, day-grouped transaction cards
      with category chips (rose outline when uncategorized) and a running
      balance across the filtered set, restyled account/category filters
      and Add-transaction/Import-CSV actions. Kept the existing
      account/category `Select` dropdowns rather than the design's filter
      chips, and kept the existing `PeriodPicker` (month/statement toggle)
      as-is — both are functional deviations from the mockup, not just
      restyles, so reworking them into true chips/stepper is left for a
      later pass rather than folded into this stage silently. Detail
      drawer overlay is still Stage 10 — rows open the existing edit modal
      for now.
- [x] **Stage 5 — Categorize**: new `/categorize` route (real triage queue,
      distinct from `/categories` CRUD — see the correction above). Action
      bar ("N of M have a confident rule match", Accept all, Review one by
      one), queue rows with why-text, Confirm/Change/Skip. New
      `getCategorizeQueue` in `lib/services/categorize.ts`. Reuses the
      existing `PATCH /api/transactions/[id]` for confirm/change (no new
      endpoint needed). "Skip" and the per-row confirm are client-only
      state changes (no server-side "skipped" concept) — a skipped row
      just comes back next visit, which matches the design (nothing
      suggests skip should be sticky). Sidebar and the Overview triage
      card now point at `/categorize`; `/categorize` itself links out to
      `/categories` ("Manage categories") since that's no longer reachable
      from nav otherwise. Undo toast on Accept all is still Stage 10.
- [x] **Stage 6 — Budgets**: pill form row + 2-up ring cards (`Ring
      size="budget"`, matches the design's 96/40/9 geometry exactly), pace
      text per card. Removed the now-unused `components/budgets/budget-bar.tsx`
      (only consumer was the old dashboard page, gone since Stage 3).
- [x] **Stage 7 — Accounts**: 2-up account cards + dashed "Add an account"
      tile. This app has no live bank sync (accounts are manual + CSV
      import), so the design's status chip/"Sync now"/"Needs attention"/
      "Reconnect" concepts don't map to anything real — rather than fabricate
      a fake sync status, the status chip is a static "Active" and the card
      actions are the real ones (Edit/Delete). No error variant for the
      same reason; Stage 11's data states won't invent one either.
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
