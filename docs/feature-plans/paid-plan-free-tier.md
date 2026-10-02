# Paid plan with a free tier (Canada)

## Status

Draft. Scoped and outlined, waiting on the open questions below before
architect/UI/test-plan work starts. Nothing here is implemented.

## Goal

Keep Ledger free for everyday budgeting and add one paid plan that covers
hosting costs. Users are in Canada only, so pricing is in CAD and billing goes
through Stripe directly (no merchant of record).

## Pricing

| Plan    | Price | Net after Stripe (about 2.9% + C$0.30) |
| ------- | ----- | -------------------------------------- |
| Free    | C$0   | -                                      |
| Monthly | C$3   | about C$2.61                           |
| Yearly  | C$30  | about C$28.83 (2 months free)          |

The yearly plan is the one to push. Fees drop from about 13% to about 4%.

### Running costs and break-even

| Item                                 | Monthly (CAD, rough)   |
| ------------------------------------ | ---------------------- |
| Vercel Pro (Hobby is non-commercial) | about C$28             |
| Postgres (Supabase, Neon, Prisma)    | C$0 to C$28            |
| Brevo email (free tier, 300/day)     | C$0                    |
| Domain                               | about C$2              |
| **Total**                            | **about C$35 to C$60** |

Break-even is about 15 to 25 paying users. At a typical 2 to 5% free-to-paid
conversion that means roughly 400 to 1,000 active free users. Marginal cost
per user is close to zero because AI categorization uses the user's own key.

## Free vs paid

| Feature                                                                | Free           | Paid      |
| ---------------------------------------------------------------------- | -------------- | --------- |
| Manual transactions, CSV import, import undo                           | Yes            | Yes       |
| Bank CSV presets (RBC, TD, Scotia, BMO, CIBC, Tangerine, Wealthsimple) | Yes            | Yes       |
| Categories, rules, Categorize queue                                    | Yes            | Yes       |
| Monthly budgets, Overview, drilldowns                                  | Yes            | Yes       |
| Transfer matching                                                      | Yes            | Yes       |
| AI suggestions (BYOK)                                                  | Yes            | Yes       |
| Data export, account deletion                                          | Yes, always    | Yes       |
| Accounts                                                               | 2              | Unlimited |
| Visible history                                                        | Last 12 months | All       |
| Reimbursable expenses                                                  | No             | Yes       |
| Credit card statement cycles                                           | No             | Yes       |
| Spending trends                                                        | No             | Yes       |
| Push reminders                                                         | No             | Yes       |

Principles:

- Never gate export or deletion. It's a trust signal, and AGPLv3 lets anyone
  self-host anyway. We sell hosting and convenience.
- Never delete or hide data on downgrade beyond the history window. Over-limit
  accounts stay visible and editable; only creating new ones is blocked.
- Self-hosted installs get everything. Billing is off when `STRIPE_SECRET_KEY`
  is unset, the same way AI categorization disappears without
  `SECRET_ENCRYPTION_KEY`.

## User stories

1. As a new user, I can sign up and use the core app with no card.
2. As a free user, when I hit a paid feature or a limit, I see what the paid
   plan adds and a clear upgrade button, not an error.
3. As a free user, I can upgrade from Settings and pay with Stripe Checkout,
   monthly or yearly.
4. As a paid user, I can change plan, update my card, see invoices and cancel
   from the Stripe Customer Portal.
5. As a paid user who cancels, I keep paid features until the period ends,
   then drop to free with my data intact.
6. As a paid user whose payment fails, I see a banner asking me to update my
   card and keep access during Stripe's retry window.

## Acceptance criteria

- [ ] Free users can't create a 3rd account. The API returns a typed plan
      error and the UI shows an upgrade prompt.
- [ ] Free users' transaction lists, Overview and budgets show only the last 12
      months. Older rows stay in the database and come back on upgrade.
- [ ] CSV export returns full history for every plan.
- [ ] Reimbursement linking, statement-day settings, Trends and push reminder
      setup are blocked for free users at the service layer, not just hidden in
      the UI.
- [ ] Existing reimbursement links and statement settings stay readable after
      a downgrade.
- [ ] The reminders cron skips users without an active paid plan.
- [ ] Plan status updates only from verified Stripe webhooks, and each event is
      processed once (idempotent).
- [ ] With Stripe env vars unset, every user is treated as paid and no billing
      UI renders.

## Technical outline

Follows the existing flow: route handler -> Zod validator -> service -> Prisma.

### Schema (needs explicit approval)

- `Subscription`: `userId` (unique), `stripeCustomerId`, `stripeSubscriptionId`,
  `status` (mirrors Stripe: active, trialing, past_due, canceled, ...),
  `interval` (month/year), `currentPeriodEnd`, `cancelAtPeriodEnd`,
  timestamps.
- `StripeEvent`: `id` (Stripe event id, primary key), `type`, `processedAt`.
  Used to make webhook handling idempotent.

### Services

- `lib/services/entitlements.ts`
  - `getPlan(userId): Promise<'free' | 'paid'>`. Paid when status is active,
    trialing or past_due (grace), or when billing is disabled.
  - `assertFeature(userId, feature)` and `assertAccountLimit(userId)`.
  - `historyFloor(userId): Promise<Date | null>` for the 12-month window.
  - `PlanRequiredError extends ServiceValidationError` in
    `lib/services/common.ts`. Routes map it to 402 with the feature name.
- `lib/services/billing.ts`
  - `createCheckoutSession(userId, interval)`
  - `createPortalSession(userId)`
  - `handleStripeEvent(event)` covering `checkout.session.completed`,
    `customer.subscription.created/updated/deleted`,
    `invoice.payment_failed`.
- Gate calls added to existing services: `accounts.ts` (create),
  `reimbursements.ts` (link), `accounts.ts` (statementDay),
  `trends.ts`, `pushSubscriptions.ts` and `reminders.ts`, plus the history
  floor in `transactionsPage.ts`, `overview.ts` and `budgets.ts`.

### Routes

- `POST /api/billing/checkout` -> returns Checkout URL
- `POST /api/billing/portal` -> returns Portal URL
- `POST /api/billing/webhook` -> raw body, signature check with
  `STRIPE_WEBHOOK_SECRET`, delegates to `handleStripeEvent`. Excluded from the
  auth proxy.

### Env vars

`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_MONTHLY`,
`STRIPE_PRICE_YEARLY`. Add to `.env.example` with comments.

### UI

- Settings: new "Plan" section (current plan, renewal date, upgrade or
  manage buttons).
- Shared upgrade prompt component used at each gate.
- Public pricing page linked from login/signup.
- Payment failed banner in the protected layout.

## Canada specifics

Not legal or tax advice. Confirm with an accountant before launch.

- **GST/HST:** small supplier until taxable sales pass C$30,000 over four
  consecutive quarters. Start with Stripe Tax off and turn it on when
  registered.
- **Provincial tax:** BC, Saskatchewan, Manitoba and Quebec (QST) have their
  own rules for software and digital services. Check before scaling.
- **Privacy:** PIPEDA applies, plus Alberta and BC PIPA. Quebec Law 25 needs a
  named privacy officer and a privacy impact assessment before personal data
  leaves Quebec.
- **Hosting:** move Postgres to a Canadian region (for example ca-central-1)
  before launch. Separate runbook in `docs/runbooks/`.
- **Card country:** signup stays open. Optionally add a Stripe Radar rule to
  block non-Canadian cards.

## Tests

- Unit (`tests/unit/services/`):
  - `entitlements.test.ts`: plan resolution per status, billing disabled,
    account limit, history floor, each feature gate.
  - `billing.test.ts`: each webhook event maps to the right subscription state,
    duplicate events are no-ops, unknown events are ignored.
  - Gate tests added to the existing service tests for accounts,
    reimbursements, trends and reminders.
- E2E (`tests/e2e/`):
  - Free user hits the account limit and sees the upgrade prompt.
  - Free user opens Trends and sees the upgrade prompt.
  - Paid user (seeded) can use every gated feature.
  - Billing disabled shows no plan UI.

## Rollout checklist

- [ ] Resolve open questions below
- [ ] software-architect: confirm schema and gate placement
- [ ] ui-designer: Plan section, upgrade prompt, pricing page, banner
- [ ] tester: unit and e2e test plans
- [ ] Schema migration for `Subscription` and `StripeEvent`
- [ ] `entitlements.ts` + `PlanRequiredError` with tests
- [ ] Gates in existing services with tests
- [ ] `billing.ts` + checkout, portal and webhook routes with tests
- [ ] Settings Plan section and upgrade prompts
- [ ] Pricing page
- [ ] Payment failed banner
- [ ] Reminders cron skips free users
- [ ] Privacy policy, terms and refund policy pages
- [ ] Move database to a Canadian region
- [ ] Upgrade Vercel to Pro
- [ ] Stripe products and prices in CAD, webhook endpoint in live mode
- [ ] Announce to existing users with the grandfathering offer

## Open questions

1. **Price:** C$3/C$30, or C$4/C$36? Both are well under YNAB and Monarch
   (about C$20/month).
2. **Existing users:** today everyone has every feature. Options: lifetime
   paid for current users, 6 months free, or straight to the free tier.
3. **Free trial of paid:** offer 14 or 30 days of paid features on signup, or
   none?
4. **History window:** is 12 months right, and should old data imported by a
   free user be stored but hidden (proposed) or rejected at import?
5. **Gate list:** is Trends worth gating, or should it stay free to show off
   the app?
6. **Card country:** block non-Canadian cards, or just price in CAD and let
   anyone pay?
