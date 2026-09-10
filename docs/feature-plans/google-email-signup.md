# Google + email/password/name sign-up and login

**Status: implemented.** This doc originally posed open questions before implementation;
this revision records the decisions actually made and where the build deviated from the
original proposal, so it reflects current behavior rather than the initial plan.

## Decisions made (were open questions)

1. **Single-user → multi-user pivot: went with (A), multi-user.** Any visitor can sign up
   (Google or email/password/name) and gets their own isolated Ledger, free to use. Every
   service already scoped by `userId`, so isolation needed no new access-control layer.
2. **Google OAuth credentials:** user-provisioned externally (Google Cloud Console → APIs &
   Services → Credentials → OAuth 2.0 Client ID, redirect URI
   `<origin>/api/auth/callback/google`). The app reads `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET`
   from env and only renders the "Continue with Google" button when both are set
   (`lib/auth/config.ts`) — the app works correctly with them absent.
3. **Schema changes: authorized and made.** `User.name` (nullable), `User.passwordHash`
   (now nullable — OAuth-only users have none). See deviation below on the adapter tables.
4. **New sign-up accounts start with no prepopulated data.** The original plan called for
   provisioning default categories/rules/a starting account on sign-up (matching the dev
   seed script). That was reversed after implementation: `createUser` and
   `findOrCreateGoogleUser` (`lib/services/users.ts`) no longer call
   `provisionDefaultsForUser` — new users land on an empty dashboard and add their own
   accounts/categories. `provisionDefaultsForUser` (`lib/services/defaults.ts`) is now used
   only by `prisma/seed.ts` for the local dev fixture.
5. **Bootstrap scripts kept.** `prisma:bootstrap-admin` and `ADMIN_EMAIL`/`ADMIN_PASSWORD`
   remain as a local-dev/demo convenience, not the only account anymore.

## Deviation: no `@auth/prisma-adapter`, no `AuthAccount`/`AuthSession`/`VerificationToken` tables

The original plan called for wiring `PrismaAdapter` with renamed `AuthAccount`/`AuthSession`
models to avoid colliding with the existing domain `Account` model (bank/credit accounts).
**This didn't work:** the installed `@auth/prisma-adapter@2.11.3` hardcodes
`prisma.account`/`session`/`user`/`verificationToken` with no model-name override option, so
the rename couldn't actually avoid the collision.

**Implemented instead:** pure JWT sessions, no adapter. Google sign-in is handled entirely
in the `jwt` callback (`lib/auth/config.ts`) — on a Google sign-in, it calls
`findOrCreateGoogleUser(email, name)` to find-or-create the `User` row by email, no
adapter-managed tables involved. Tradeoff accepted: no NextAuth-managed database sessions,
no stored OAuth refresh tokens — not needed for a personal app that only uses Google for
identity, not for calling Google APIs on the user's behalf.

Net schema change ended up smaller than planned: just `User.name` + nullable
`User.passwordHash`, no new tables.

## What was built

### Schema (`prisma/schema.prisma`)

```prisma
model User {
  id           String   @id @default(cuid())
  email        String   @unique
  name         String?
  passwordHash String?  // nullable: OAuth-only users have no password
  createdAt    DateTime @default(now())

  accounts      Account[]
  categories    Category[]
  transactions  Transaction[]
  budgets       Budget[]
  categoryRules CategoryRule[]
}
```

Migration: `20260910003720_add_user_name_nullable_password`.

### `lib/auth/config.ts`

- `Google` provider registered only when `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET` are both set.
- `session: { strategy: 'jwt' }`, no adapter (see deviation above).
- `Credentials.authorize` returns `null` (rejects sign-in) when `user.passwordHash` is
  missing, instead of crashing on `bcrypt.compare(password, null)` — a Google-only account
  can't be logged into via the password form.
- `jwt` callback: on `account?.provider === 'google'`, calls `findOrCreateGoogleUser` and
  sets `token.userId` from the result; otherwise uses the credentials `authorize` result's
  `id` directly. Also carries `name`.

### Sign-up path

- `app/(auth)/signup/page.tsx` + `components/auth/signup-form.tsx` — name, email, password
  fields, mirrors the login page's two-pane layout.
- `lib/validators/signup.ts` — name/email/password shape.
- `lib/services/users.ts` — `createUser` (uniqueness check, bcrypt hash, **no defaults
  provisioning** — see decision 4 above), `findOrCreateGoogleUser`, and
  `userHasPassword(userId)` (added after initial implementation — see below).
- `lib/auth/actions.ts` — `signUpAction`, mirrors `signInAction`'s error-mapping pattern,
  signs the new user in immediately on success.
- Login page: "Continue with Google" button (env-gated) + "Sign up" link. Sign-up page links
  back to login.
- `app/(auth)/signup/page.tsx` is `export const dynamic = 'force-dynamic'` — the Google-env
  check must not be baked into a static build; otherwise adding the env vars later wouldn't
  show the button without a rebuild.

### Settings screen: password section hidden for Google-only accounts

Added after the initial implementation, not in the original plan: the Settings page always
rendered `ChangePasswordForm`, even for a Google-only account with no `passwordHash` — the
backend already rejected the request (`changePassword` throws `ServiceValidationError` when
`!user.passwordHash`), but the user only found out after submitting.

Fixed: `app/(protected)/settings/page.tsx` calls `userHasPassword(session.user.id)` and
passes it to `SettingsView`, which renders `ChangePasswordForm` only when `hasPassword` is
true, otherwise a note: "Your account signed in with Google — there's no password to
change."

## Out of scope (unchanged from original plan)

- No password-reset / forgot-password flow.
- No email verification for credential sign-ups.
- No account-linking UI for a user who signs up with email first and later wants to add
  Google to the same account (find-or-create by email means a Google sign-in with a matching
  existing email logs into that same account automatically — no explicit linking step, no
  `allowDangerousEmailAccountLinking` needed since there's no adapter).

## Checklist (as built)

- [x] Direction confirmed: multi-user, free to use
- [x] Google OAuth: env-gated, user provisions credentials themselves
- [x] Schema: `User.name`, nullable `passwordHash` — no adapter tables (deviation above)
- [x] `lib/auth/config.ts`: `GoogleProvider` (env-gated), null-safe `Credentials.authorize`,
      `jwt` callback find-or-create (no `PrismaAdapter`, no `events.createUser`)
- [x] `lib/validators/signup.ts`
- [x] `lib/services/users.ts`: `createUser`, `findOrCreateGoogleUser` — no defaults
      provisioning (decision 4)
- [x] `lib/auth/actions.ts`: `signUpAction`
- [x] `components/auth/signup-form.tsx`, `app/(auth)/signup/page.tsx`
- [x] Login page Google button + sign-up link; sign-up page links back
- [x] `prisma:bootstrap-admin` / `ADMIN_EMAIL`/`ADMIN_PASSWORD` kept as dev/demo convenience
- [x] Unit tests: `users.ts` (duplicate email, no-provisioning, `userHasPassword`),
      `signup` validator
- [x] E2e: sign-up → dashboard with **no** prepopulated data (empty-state visible), duplicate
      email rejected, Google button hidden when unconfigured
- [x] Settings: password section hidden for Google-only accounts
- [x] `npm run format:fix && npm run lint` + full test suite green
