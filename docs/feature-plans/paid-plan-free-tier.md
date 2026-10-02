# Paid plan with a free tier (Canada)

## Status

Scoped, decisions locked (see below). Next: software-architect, ui-designer and
tester test plans. Nothing here is implemented.

## Goal

Keep Ledger free for everyday budgeting and add one paid plan that covers
hosting costs. The app is for Canadian users only, priced in CAD, with
payments through Stripe directly (no merchant of record).

## Decisions

Locked by the product owner:

1. **Price:** C$4/month or C$40/year.
2. **No existing users** to migrate or grandfather.
3. **Trial:** every new account gets 1 month of paid features for free.
4. **History:** unlimited for every plan. No history window.
5. **Trends:** free tier gets the 3-month view only. 6 and 12 months are paid.
6. **Canada only:** non-Canadian users are blocked at signup and at checkout.
7. **Payments:** Stripe.

## Pricing

| Plan    | Price | Net after Stripe (about 2.9% + C$0.30) |
| ------- | ----- | -------------------------------------- |
| Free    | C$0   | -                                      |
| Monthly | C$4   | about C$3.58                           |
| Yearly  | C$40  | about C$38.54 (2 months free)          |

The yearly plan is the one to push. Fees drop from about 10% to about 4%.

### Running costs and break-even

| Item                                 | Monthly (CAD, rough)   |
| ------------------------------------ | ---------------------- |
| Vercel Pro (Hobby is non-commercial) | about C$28             |
| Postgres (Supabase, Neon, Prisma)    | C$0 to C$28            |
| Brevo email (free tier, 300/day)     | C$0                    |
| Domain                               | about C$2              |
| **Total**                            | **about C$35 to C$60** |

Break-even is about 10 to 17 paying users. At a typical 2 to 5% free-to-paid
conversion that means roughly 200 to 850 active free users. Marginal cost
per user is close to zero because AI categorization uses the user's own key.

## Free vs paid

| Feature                                                                | Free          | Paid (and trial) |
| ---------------------------------------------------------------------- | ------------- | ---------------- |
| Manual transactions, CSV import, import undo                           | Yes           | Yes              |
| Bank CSV presets (RBC, TD, Scotia, BMO, CIBC, Tangerine, Wealthsimple) | Yes           | Yes              |
| Categories, rules, Categorize queue                                    | Yes           | Yes              |
| Monthly budgets, Overview, drilldowns                                  | Yes           | Yes              |
| Transfer matching                                                      | Yes           | Yes              |
| AI suggestions (BYOK)                                                  | Yes           | Yes              |
| Full transaction history                                               | Yes           | Yes              |
| Data export, account deletion                                          | Yes, always   | Yes              |
| Accounts                                                               | 2             | Unlimited        |
| Spending trends                                                        | 3-month range | 3, 6, 12 months  |
| Reimbursable expenses                                                  | No            | Yes              |
| Credit card statement cycles                                           | No            | Yes              |
| Push reminders                                                         | No            | Yes              |

Principles:

- Never gate export or deletion. It's a trust signal, and AGPLv3 lets anyone
  self-host anyway. We sell hosting and convenience.
- Never delete or hide data when a trial or subscription ends. Anything made
  while paid stays visible. Over-limit accounts stay usable; only creating new
  ones is blocked. Existing reimbursement links and statement days stay
  readable, but new ones can't be added.
- Self-hosted installs get everything. Billing is off when `STRIPE_SECRET_KEY`
  is unset, the same way AI categorization disappears without
  `SECRET_ENCRYPTION_KEY`. The country check is off when
  `ALLOWED_SIGNUP_COUNTRIES` is unset.

## Trial

- App-side trial with no card required. Trial end is `User.createdAt + 30 days`,
  so no schema field is needed for it.
- During the trial the user has every paid feature.
- Upgrading during the trial creates the Stripe subscription with
  `subscription_data.trial_end` set to the app trial end, so the user isn't
  charged until their free month is over.
- Email reminder 5 days before the trial ends, sent by the existing daily cron
  via Brevo. One reminder only.
- When the trial ends without a subscription, the user drops to free with all
  data kept.

## Canada-only enforcement

No check is perfect (VPNs, travellers). The aim is to stop casual non-Canadian
signups and make sure every payment comes from a Canadian card.

- **Signup:** read the `x-vercel-ip-country` header (set by Vercel on every
  request) in a new `lib/http/clientCountry.ts`, alongside
  `lib/http/clientIp.ts`. Refuse new accounts when the country isn't in
  `ALLOWED_SIGNUP_COUNTRIES` (`CA`). Applies to both
  `signUpAction` (credentials) and `findOrCreateGoogleUser` (only when the
  Google user is new). Show a clear "Ledger is only available in Canada"
  message.
- **Login:** not geo-checked. Existing users travelling abroad can still sign
  in.
- **Checkout:** require a billing address in Stripe Checkout and add a Stripe
  Radar rule `Block if :card_country: != 'CA'`. Custom Radar rules may need
  Radar for Fraud Teams (extra per-transaction fee), so confirm in the Stripe
  dashboard. As a backstop, the webhook handler cancels and refunds any
  subscription whose card country isn't `CA`.
- **Local dev and e2e:** the header is missing outside Vercel. Treat a missing
  header as allowed when `ALLOWED_SIGNUP_COUNTRIES` is unset, and let e2e set
  it explicitly.

## User stories

1. As a new Canadian user, I can sign up with no card and get every paid
   feature for my first month.
2. As a visitor outside Canada, I see that Ledger is only available in Canada
   and can't create an account.
3. As a trial user, I get an email 5 days before my trial ends, and I can
   subscribe without losing the rest of my free month.
4. As a free user, when I hit a paid feature or a limit, I see what the paid
   plan adds and a clear upgrade button, not an error.
5. As a free user, I can upgrade from Settings and pay with Stripe Checkout,
   monthly or yearly.
6. As a paid user, I can change plan, update my card, see invoices and cancel
   from the Stripe Customer Portal.
7. As a paid user who cancels, I keep paid features until the period ends,
   then drop to free with my data intact.
8. As a paid user whose payment fails, I see a banner asking me to update my
   card and keep access during Stripe's retry window.

## Acceptance criteria

- [ ] New users have paid features for 30 days from signup with no card.
- [ ] Signup (credentials and new Google users) is refused when the request
      country isn't Canada and the check is enabled. Login is never
      geo-checked.
- [ ] Free users can't create a 3rd account. The API returns a typed plan
      error and the UI shows an upgrade prompt.
- [ ] Free users get Trends for the 3-month range. Asking for 6 or 12 months
      returns a plan error at the service layer, and the UI shows the longer
      ranges as locked.
- [ ] Reimbursement linking, statement-day settings and push reminder setup
      are blocked for free users at the service layer, not just hidden in the
      UI.
- [ ] Data created while paid or on trial stays readable after dropping to
      free.
- [ ] Transaction history and CSV export are complete for every plan.
- [ ] The reminders cron skips push reminders for free users and sends the
      trial-ending email once per user.
- [ ] Upgrading during the trial doesn't charge until the trial ends.
- [ ] Plan status updates only from verified Stripe webhooks, and each event is
      processed once (idempotent).
- [ ] A subscription paid with a non-Canadian card is cancelled and refunded.
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
- `User.trialReminderSentAt` (nullable) so the trial email goes out once.

### Services

- `lib/services/entitlements.ts`
  - `getPlan(userId): Promise<'free' | 'trial' | 'paid'>`. Paid when the
    subscription status is active, trialing or past_due (grace). Trial when
    within 30 days of `createdAt`. Paid for everyone when billing is disabled.
  - `assertFeature(userId, feature)` for reimbursements, statement cycles,
    push reminders and long Trends ranges.
  - `assertAccountLimit(userId)` for the 2-account cap.
  - `PlanRequiredError extends ServiceValidationError` in
    `lib/services/common.ts`. Routes map it to 402 with the feature name.
- `lib/services/billing.ts`
  - `createCheckoutSession(userId, interval)`: CAD price, billing address
    required, `trial_end` carried over from the app trial.
  - `createPortalSession(userId)`
  - `handleStripeEvent(event)` covering `checkout.session.completed`,
    `customer.subscription.created/updated/deleted`,
    `invoice.payment_failed`, plus the card-country backstop.
- `lib/http/clientCountry.ts` and a `isSignupCountryAllowed` check used by
  `lib/auth/actions.ts` and `lib/services/users.ts`.
- Gate calls added to existing services: `accounts.ts` (create, statementDay),
  `reimbursements.ts` (link), `trends.ts` (range > 3),
  `pushSubscriptions.ts` and `reminders.ts`.

### Routes

- `POST /api/billing/checkout` -> returns Checkout URL
- `POST /api/billing/portal` -> returns Portal URL
- `POST /api/billing/webhook` -> raw body, signature check with
  `STRIPE_WEBHOOK_SECRET`, delegates to `handleStripeEvent`. Excluded from the
  auth proxy.

### Env vars

`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_MONTHLY`,
`STRIPE_PRICE_YEARLY`, `ALLOWED_SIGNUP_COUNTRIES`. Add to `.env.example` with
comments.

### UI

- Settings: new "Plan" section (free, trial with days left, or paid with
  renewal date; upgrade or manage buttons).
- Shared upgrade prompt component used at each gate.
- Trends range picker shows 6 and 12 months as locked for free users.
- Trial countdown in the sidebar during the last 7 days.
- Public pricing page linked from login/signup.
- "Only available in Canada" state on the signup page.
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

## Tests

- Unit (`tests/unit/services/`):
  - `entitlements.test.ts`: free, trial (day 0, day 29, day 31) and paid per
    subscription status, billing disabled, account limit, Trends range gate,
    each feature gate.
  - `billing.test.ts`: each webhook event maps to the right subscription state,
    duplicate events are no-ops, unknown events are ignored, non-Canadian card
    is cancelled and refunded, checkout carries the trial end.
  - Country check: allowed, blocked, header missing, check disabled; new vs
    existing Google user.
  - Gate tests added to the existing service tests for accounts,
    reimbursements, trends and reminders, plus the one-time trial email.
- E2E (`tests/e2e/`):
  - New user sees trial status and can use paid features.
  - Signup from a non-Canadian country is refused.
  - Free user hits the account limit and sees the upgrade prompt.
  - Free user sees 6 and 12 month Trends locked.
  - Paid user (seeded) can use every gated feature.
  - Billing disabled shows no plan UI.

## Rollout checklist

- [x] Resolve open questions
- [ ] software-architect: confirm schema and gate placement
- [ ] ui-designer: Plan section, upgrade prompt, locked Trends ranges, trial
      countdown, pricing page, Canada-only signup state, banner
- [ ] tester: unit and e2e test plans
- [ ] Schema migration for `Subscription`, `StripeEvent` and
      `User.trialReminderSentAt`
- [ ] `entitlements.ts` + `PlanRequiredError` with tests
- [ ] Signup country check with tests
- [ ] Gates in existing services with tests
- [ ] `billing.ts` + checkout, portal and webhook routes with tests
- [ ] Trial-ending email in the daily cron
- [ ] Settings Plan section, upgrade prompts and trial countdown
- [ ] Pricing page
- [ ] Payment failed banner
- [ ] Reminders cron skips free users
- [ ] Privacy policy, terms and refund policy pages
- [ ] Move database to a Canadian region
- [ ] Upgrade Vercel to Pro
- [ ] Stripe products and prices in CAD, Radar card-country rule, webhook
      endpoint in live mode
