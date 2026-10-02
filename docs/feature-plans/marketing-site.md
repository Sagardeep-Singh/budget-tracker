# Marketing site (separate repo)

## Status: planned

## Goal

A public, user-focused marketing site for Ledger: what it does, how it's
built, and what it costs. It lives in its **own repo** and deploys on its own,
separate from the app in this repo.

Design source: the "Ledger Marketing Site" canvas (claude.ai artifact
`RiEhFZy1vb82UHAQdirowc`). The chosen pages are **Home (Bento, dark first)**
and **Pricing**. The "Earlier directions" row on the canvas is reference only.

## Why a separate repo

- **Release cadence.** Copy, SEO and launch tweaks shouldn't run through the
  app's Prisma, auth and e2e pipeline, or trigger app deploys.
- **License.** This repo is AGPLv3. Marketing copy, pricing and brand assets
  shouldn't be copyleft or travel with every fork of the app.
- **Hosting.** The site is fully static. It can sit on the apex domain with the
  app on a subdomain.

What it costs: the design tokens are duplicated. That's handled by copying
them once and checking for drift (see "Design tokens").

## Decisions

| Area      | Decision                                                                                                                     |
| --------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Repo      | New repo, working name `ledger-site` under the same GitHub owner                                                             |
| License   | Code under MIT. Copy, logo and brand assets "all rights reserved" via a `NOTICE`/README section (open question 1)            |
| Framework | Next.js (App Router) with `output: 'export'`, TypeScript, Tailwind CSS v4. Same stack as the app, so no new tooling to learn |
| Hosting   | Vercel, static. Apex domain for the site, `app.` subdomain for the app (open question 2)                                     |
| Fonts     | Space Grotesk, Inter and IBM Plex Mono via `next/font/google`, same as the app                                               |
| Theme     | Dark by default, following the design. Respects `prefers-color-scheme: light`, with a toggle in the footer (open question 3) |
| Palette   | Clay only on the site. Cobalt and Iris stay as in-app preferences                                                            |
| Analytics | None at launch, or a cookie-free option like Vercel Web Analytics, so there's no cookie banner (open question 4)             |
| Tests     | Vitest for pure helpers (if any), Playwright for page smoke tests, link checks and axe accessibility checks                  |

## Pages and routes

| Route      | Source artboard    | Notes                                                              |
| ---------- | ------------------ | ------------------------------------------------------------------ |
| `/`        | `AltBento.dc.html` | Hero, app window mock, bento feature grid, pricing summary, footer |
| `/pricing` | `Pricing.dc.html`  | Free and Plus cards, comparison table, FAQ                         |
| `/privacy` | none yet           | Plain text page. Needs real policy content (open question 5)       |
| `/terms`   | none yet           | Same as above                                                      |
| `404`      | none yet           | Reuse the header and footer with a short message and a link home   |

External links (all set from env/config, not hardcoded):

- `APP_URL`: "Start free" goes to `${APP_URL}/signup` and "Sign in" goes to
  `${APP_URL}/login`. "Upgrade to Plus" goes to `${APP_URL}/settings`
  (or the billing route once it exists).
- `SOURCE_URL`: GitHub link for "View source", "GitHub" and the footer.

## Content rules

- Pricing copy is the single source of truth in one typed file
  (`content/plans.ts`): plan names, prices, limits and the comparison rows.
  Both the Home pricing summary and `/pricing` read from it, so they never
  disagree.
- Feature tags ("Plus", "Full history on Plus", "Reminders on Plus") come from
  the same file, keyed by feature id.
- **The site must not advertise limits the app doesn't enforce yet.** See
  "Dependencies on the app".
- The Sync plan stays out of the site until it's ready. Keep its data in
  `plans.ts` behind a `visible: false` flag so turning it on is a one-line change.

Current plan content (from the design):

| Feature                              | Free          | Plus ($3/mo) |
| ------------------------------------ | ------------- | ------------ |
| Accounts                             | 5             | 10           |
| Transactions and CSV imports         | Unlimited     | Unlimited    |
| Categorization rules                 | 25            | Unlimited    |
| Rule import and export               | No            | Yes          |
| Triage queue, budgets and overview   | Yes           | Yes          |
| Trends history                       | Last 3 months | Full history |
| Transfer matching and reimbursements | No            | Yes          |
| AI categorization (your own key)     | No            | Yes          |
| Push reminders                       | No            | Yes          |
| Credit card statement cycles         | No            | Yes          |
| Data export and account deletion     | Yes           | Yes          |

## Design tokens

- Copy the Clay light and dark tokens from this repo's `app/globals.css` into
  the site's `app/globals.css`, using the same names (`--paper`, `--ink`,
  `--iris`, etc.) so components read the same in both codebases.
- Add a small script in the site repo (`scripts/check-tokens.ts`) that fetches
  `app/globals.css` from this repo's default branch and diffs the Clay values.
  Run it in CI as a non-blocking warning.
- Shared visual pieces rebuilt in the site: logo mark, ring SVG, pill button,
  card, chip and Plus tag. Copy the logic from `components/ui/logo-mark.tsx`
  and `components/ui/ring.tsx` instead of importing it.
- If the two drift often, extract a tiny `@ledger/tokens` package later. Not
  needed for v1.

## Component breakdown (site repo)

```
app/
  layout.tsx            fonts, theme init, header, footer
  page.tsx              Home
  pricing/page.tsx
  privacy/page.tsx
  terms/page.tsx
  not-found.tsx
  globals.css           tokens + base styles
components/
  site-header.tsx       logo, nav, CTA; wraps at phone width
  site-footer.tsx       links, license line, theme toggle
  logo-mark.tsx
  ring.tsx
  button-link.tsx       primary / secondary pill links (anchors, not buttons)
  plus-tag.tsx
  app-window-mock.tsx   static Overview preview (sidebar, hero ring, day bars, budget bars)
  bento-grid.tsx        6-column grid, stacks below 900px
  feature-tile.tsx      title, body, optional tag, optional visual slot
  plan-card.tsx
  plan-compare-table.tsx  scrolls horizontally on small screens
  faq.tsx               native <details>/<summary>
content/
  plans.ts              plans, limits, comparison rows, feature tags
  features.ts           bento tile copy
  site.ts               APP_URL, SOURCE_URL, nav links
```

Every component is a server component except the theme toggle.

## Dependencies on the app (this repo)

The pricing page describes gating that **doesn't exist yet**. These need
their own plans in this repo before the site can go live with the
Free/Plus split. None of them is authorized by this plan:

- **Plan/entitlement model.** Add a plan field on `User` (or a
  `Subscription` table). This is a schema change and needs explicit sign-off.
- **Billing.** A payments provider (Stripe is the likely choice) with checkout,
  a customer portal and a webhook route that updates the user's plan.
- **Limit enforcement in services.** Account count in `lib/services/accounts`,
  rule count in the rules service, and the trends range limit. Plus-only
  features: transfer matching, reimbursements, AI categorization, reminders,
  statement cycles and rule import/export. Each should throw a typed error
  that the UI turns into an upgrade prompt.
- **Downgrade behavior** that matches the FAQ: extra accounts become read
  only and extra rules stop running. Nothing is deleted.
- **Self-hosting.** Decide whether limits apply when someone self-hosts.
  The suggested approach is to enforce limits only when a billing env var is
  set, so self-hosted instances stay unlimited.

Until those land, the site launches with one of these (open question 6):

- **A.** Pricing marked "Free during beta", with Plus shown as "coming soon", or
- **B.** Hold the launch until gating and billing ship.

## Checklist

- [ ] **Stage 0: decisions.** Answer the open questions below.
- [ ] **Stage 1: repo setup.** Create `ledger-site`, add the license and brand
      notice, Next.js static export, Tailwind v4, ESLint, Prettier, Vitest,
      Playwright, a `CLAUDE.md` mirroring this repo's conventions, and a CI
      workflow (format check, lint, build, Playwright).
- [ ] **Stage 2: foundation.** Tokens in `globals.css`, fonts, theme init
      with no flash on load, the token drift check script, logo mark, ring,
      button link, chip and Plus tag.
- [ ] **Stage 3: shell.** Header and footer, responsive nav, `not-found`,
      metadata defaults (title template, description, Open Graph image,
      favicon reused from the app's icon).
- [ ] **Stage 4: Home.** Hero, app window mock, bento grid from
      `content/features.ts`, pricing summary from `content/plans.ts`,
      open source tile, closing CTA.
- [ ] **Stage 5: Pricing.** Plan cards, comparison table, FAQ, all from
      `content/plans.ts`.
- [ ] **Stage 6: legal pages.** Privacy and Terms with real content.
- [ ] **Stage 7: SEO and quality.** Sitemap, `robots.txt`, canonical URLs,
      Open Graph images per page. Lighthouse scores of 95 or higher for
      performance, accessibility and SEO, and axe passing in Playwright.
- [ ] **Stage 8: deploy.** Vercel project, domain and `app.` subdomain DNS,
      env vars (`APP_URL`, `SOURCE_URL`), preview deploys on PRs.
- [ ] **Stage 9: app follow-ups** (this repo, separate plans). Update the
      app's README and in-app links to point at the site, then the
      entitlement, billing and gating work listed above.

## Test plan (site repo)

Playwright, run against `next build && npx serve out`:

- Home and Pricing render with no console errors at 1440px and 390px wide.
- At 390px: no horizontal page scroll, nav wraps, bento tiles stack, the
  comparison table scrolls inside its own box.
- Every internal link resolves (no 404s). External CTAs point at
  `APP_URL`/`SOURCE_URL`.
- The Home pricing summary and the `/pricing` cards show the same prices and
  limits (both read `plans.ts`, and the test asserts it).
- A plan with `visible: false` doesn't render anywhere.
- No axe violations on any page in either theme.
- The theme toggle switches and persists across reloads. With no stored
  choice, it follows `prefers-color-scheme` and falls back to dark.

Vitest: only if `plans.ts` gets helpers (for example, formatting limits).

## Open questions

1. **License for the site.** MIT for code with brand assets reserved, or
   all rights reserved for the whole repo?
2. **Domain.** Which domain, and should the app move to `app.` or stay where
   it is?
3. **Theme.** Always dark by default as designed, or follow the visitor's
   OS setting first?
4. **Analytics.** None, or cookie-free analytics?
5. **Legal copy.** Who writes the Privacy and Terms pages? They need to cover
   payments once Plus is live.
6. **Launch order.** Launch with "Free during beta" before gating ships, or
   wait for billing?
7. **Limit numbers.** Confirm 25 rules and 3 months of trends on Free.
8. **Product name.** "Ledger" is used throughout. Is it final, and has the
   domain or trademark been checked?

## Non-goals

- Blog, docs or changelog (can come later as MDX).
- Sync plan pages, or a waitlist backend.
- Sharing runtime code with the app (beyond copied tokens).
- Any change to this repo's schema or services as part of this plan.
