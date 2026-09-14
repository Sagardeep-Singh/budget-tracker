# Dashboard: spending-by-category pie chart

## Goal

Show a breakdown of every expense this month by category on the dashboard —
unlike the existing Budgets rings (limited to categories with a budget set),
this covers every category with expense activity, including uncategorized.

## Data

`getOverviewData` gains `expenseBreakdown: OverviewExpenseSlice[]`, computed
from the transactions already fetched for the month (no extra query):
grouped by `categoryId` (null → "Uncategorized"), sorted by amount desc,
capped at the top 6 categories with the remainder folded into a synthetic
"Other" slice.

## Color

New categorical chart tokens (`--chart-1`..`--chart-6`) in `globals.css`,
independent of the app's `[data-pal]` accent picker — these are chart-series
identity, not brand accent. Values are the dataviz skill's validated default
palette (first 6 of 8 fixed slots), reused as-is rather than hand-picked.

Validated with `validate_palette.js`:

- Light, surface `#ffffff` (all three `--paper-raised` values match): all
  checks pass; 3 slots WARN on contrast — mitigated by the legend, which
  shows every category name/amount as plain text (the "relief channel").
- Dark, surface `#1c1c26` (cobalt/iris) and `#241f1c` (clay, lighter — the
  more contrast-sensitive case): all checks pass.
- Wrap-around pair (a donut is a ring, so slice N touches slice 1, not just
  its list-adjacent neighbor) checked separately for both 2-slice and
  6-slice cases: normal-vision ΔE well clear of the 15 floor in both modes.

"Other" and any literal "Uncategorized" category are not counted against the
6-hue budget or validated as part of the categorical set — folded overflow
("Other") renders in a fixed neutral (`--ink-muted`), never a 7th hue.

## Checklist

- [x] `expenseBreakdown` computed in `getOverviewData`, no new Prisma query.
- [x] Unit test covering unbudgeted + uncategorized categories in the
      breakdown.
- [x] `ExpensePie` component: SVG donut (stroke-dasharray per slice, 3px
      gap) + text legend (name, color swatch, amount) — the legend doubles
      as the accessible/table view.
- [x] Categorical palette validated: light, both relevant dark surfaces,
      and the ring wrap-around pair.
- [x] Empty state ("No expenses logged yet this month") when there are no
      expense transactions but the rest of the dashboard still has data
      (income-only month, or a credit-card cycle card).

## Known gap

Not verified in an actual browser — only lint/typecheck/unit tests ran.
Whether a long category name collides with the legend's amount column, or
how the legend wraps at narrow widths, is unverified.
