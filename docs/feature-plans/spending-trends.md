# Spending Trends screen

## Status: planned — not implemented (this doc is the deliverable)

## Goal

A screen answering "how is my spending changing over time?" — distinct from
Overview (a single month's snapshot) and Budgets (current-month limits).
Multi-month by design.

## Where it lives

**New top-level nav item, `/trends`**, in the sidebar after Budgets (Overview
→ Transactions → Categorize → Budgets → **Trends** → Accounts → Rules →
Settings). Not folded into Overview — Overview is already dense (hero,
budget rings, spending-by-category pie, day bars, day detail, triage,
credit-card cycle card) and is explicitly single-month; cramming a
multi-month view in either overloads the page or forces a redundant second
period picker alongside Overview's own month picker. A distinct nav item
also matches how Budgets and Transactions are already separated from
Overview despite overlapping data.

Reuses `components/dashboard/period-popover.tsx` — it already takes a
`basePath` prop for exactly this (`/trends`), no changes needed there. Add a
range choice (3 / 6 / 12 months) alongside it, since a trends view is
range-shaped, not single-month-shaped; the existing popover picks one
month, so this is a **new, second control** next to it, not a repurposing.

## Recommended trends (in priority order)

Chosen using the dataviz skill's form-by-job table — the job picks the
form, color comes last. Four pieces, ordered by how much of the page they
earn:

### 1. Headline: this period vs. prior period (stat tile, not a chart)

Big number (`hero`-scale, matching Overview's existing 40px hero figure) —
total spend for the selected range — with a small delta: "▲12% vs prior
{range}" in rose (over/up) or sky (under/down), same tone convention
Overview already uses for pace. **A single current value + trend is a stat
tile, not a one-bar bar chart** (dataviz skill, "Is it even a chart?"
table) — this is the one piece of the screen that is deliberately not a
chart.

### 2. Income vs. expense over time — line chart, 2 series

The primary chart. One line per series (Income, Expense) across the
selected month range. Job: "tell distinct series apart" → categorical
color, 2 series is comfortable with direct labels/legend (dataviz skill's
series-count ladder: 1–3 series, color alone is fine, direct-label it).
Reuses `hero.income` / `hero.expense` math already computed monthly in
`getOverviewData` — this chart is that same pair, plotted across N months
instead of shown for one.

**Why a line, not two chart types**: both series share one measure (total
$ per month) and one job (trend), so one chart, not two — avoids the
skill's #1 anti-pattern (dual-axis / mismatched-measure charts).

### 3. Category breakdown over time — stacked bar, one bar per month

Job: "part-to-whole" → **stacked bar** (dataviz skill locks this — not a
stacked line, not multiple pies). One bar per month, segments = the same
top-6-plus-"Other" categories and categorical palette already built for
the Overview pie chart (`--chart-1`..`--chart-6` in `globals.css`,
validated via `validate_palette.js` — reuse those tokens and that cap
verbatim, don't re-derive). If the Overview pie-chart work
(`components/dashboard/expense-pie.tsx`, currently on an unmerged branch)
lands first, this is a direct reuse of its color assignment and "Other"
fold logic, applied per-month instead of once.

### 4. Notable movers — ranked list, not a chart

"Categories that moved most" this period vs. the prior one of the same
length: top 3–5 by absolute $ change, e.g. "Dining +$120 (+38%)",
"Groceries −$40 (−9%)", rose for increases in spend, sky for decreases —
same tone convention as everywhere else in the app. **Explicitly a list,
not a chart** — a handful of headline numbers is a KPI row / list per the
dataviz skill's table, not a bar chart of deltas (which would just be a
worse, harder-to-read version of the same 3–5 numbers).

## Non-goals (this pass)

- Budget-adherence-over-time (% of budget used per category per month) —
  real and useful, but a second, independent trends question; flagged as a
  natural follow-up, not bundled in to avoid scope creep on the first cut.
- Custom/arbitrary date ranges (only 3/6/12-month presets) — matches
  `getOverviewData`'s existing calendar-month-only scope; an arbitrary
  range picker needs service-layer changes out of scope here.
- Per-account trend breakdown (trends are cross-account, matching how
  Overview/Budgets already aggregate across accounts).
- Export/download of trend data.
- Any new schema — everything here is aggregation over existing
  `Transaction`/`Budget` rows already summed monthly elsewhere.

## Data / architecture sketch (for the architect phase, not locked)

New `lib/services/trends.ts`, `getSpendingTrends(userId, months: 3|6|12)`:

- For each of the last N months: reuse the same `EXPENSE`/`INCOME` +
  `!isPayment` + `!isTransfer` filters `getOverviewData` already applies,
  summed per month instead of once. Same category-breakdown-with-Other-fold
  logic as the Overview pie chart, applied per month.
- Returns per-month `{ month, income, expense }[]` for the line chart, a
  per-month category breakdown for the stacked bar (same category set
  across all months, so segments/colors stay stable month to month — a
  category with $0 that month is a zero-height segment, not omitted, so
  the legend doesn't reflow), and the prior-equal-length-period comparison
  for the headline + movers list.
- No new Prisma queries beyond what `getOverviewData` already runs per
  month — this is the same aggregation, looped, not a new query shape.

## Checklist

- [x] Plan written (this doc)
- [ ] product-manager: confirm scope/non-goals above, or amend
- [ ] software-architect: lock the service contract, `/trends` route,
      component file breakdown
- [ ] ui-designer: component tree for the 4 pieces above, interaction
      states (range picker, empty state for a brand-new user with < N
      months of data), accessibility
- [ ] tester: unit test plan for `getSpendingTrends`, e2e plan for
      `/trends`
- [ ] senior-developer: implementation
- [ ] tester: review
