# Recurring budgets, month navigation, and empty-category states

## Goals / acceptance criteria

- Budgets screen: can navigate to any month (not just the current one).
- A budget set for a category repeats into future months at the same limit
  until a new value is set for a later month; past months keep whatever
  value was in effect at the time.
- Budgets and Rules screens: when the user has no categories at all, show a
  message + CTA to add categories instead of a form that can't be used, and
  don't also show a misleading "no budgets/rules yet" message underneath it.
- Categories screen: empty state is a real message, not an empty white card.
- Budget cards and category rows support inline editing (limit / name).

## Data model

No schema change. `Budget` rows are treated as versioned overrides, keyed by
`(categoryId, month)`. "Effective" budget for a given month = the row with
the largest `month <= requested month` for that category. Creating a new row
for a later month forks a new value going forward; editing the exact-month
row in place doesn't touch history.

## Checklist

- [x] `listBudgets` resolves the effective (possibly carried-forward) budget
      per category instead of an exact-month match.
- [x] Budgets page accepts `?month=` and renders a month picker
      (`PeriodPopover`, generalized with a `basePath` prop).
- [x] Editing a budget forks a new row when the displayed budget's origin
      month differs from the month being viewed; patches in place otherwise.
- [x] Remove-budget confirmation copy states it clears the value from its
      origin month onward (including past months already showing that row),
      not just "this month" — deleting a carried-forward row does affect
      earlier months since there's nothing before it in this model.
- [x] `paceText` treats a fully future month as 0 days elapsed instead of
      "the month is over."
- [x] Add-category-id `<select>` in the add-budget form derives its value
      from current `available` categories instead of trusting stale
      component state across month navigation.
- [x] Budgets/Rules: no-categories empty state + CTA; suppress the
      "no budgets/rules yet" message when it's actually "no categories yet."
- [x] Categories: empty state message instead of an empty `Card`.
- [x] Unit test covering carry-forward in `listBudgets`.

## Known trade-off

Removing a carried-forward budget deletes its origin row, which clears the
budget for all months from that origin forward — there's no "stop from this
month, keep history before it" without a new concept (e.g. an explicit
zero/override row). Out of scope here; flagged in the confirm-dialog copy so
it isn't silently destructive.
