# Google + email/password/name sign-up and login

## Open questions / decisions needed (read first)

1. **Single-user → multi-user pivot.** CLAUDE.md states this is a "single-user MVP" — the entire codebase assumes exactly one hardcoded `User` row (seeded via `prisma/seed.ts` / created via `prisma:bootstrap-admin`), and every service already scopes every query by `userId` (so the data-access layer is _already_ multi-tenant-safe). A real "sign up" flow implies **anyone can create an account**, which is a product pivot, not just an auth mechanism swap. Two ways to satisfy the ask:
   - **(A) Go multi-user.** Any visitor can sign up (Google or email/password/name) and gets their own isolated Ledger. This plan assumes (A) below, since "sign up" doesn't make sense for a single fixed user.
   - **(B) Stay single-user, add alternate login methods only.** No public sign-up; the one seeded user can _also_ log in via Google (linked to their existing email) instead of only credentials. "Sign up with name" wouldn't apply here.
   - **This needs an explicit answer before implementation starts.** Everything below is written for (A) but the schema/auth changes are the same either way — (B) just skips building a public `/signup` page and instead links Google to the existing seeded account.

2. **Google OAuth credentials are external and can't be provisioned by Claude.** Whoever implements this needs to create an OAuth 2.0 Client ID in Google Cloud Console (APIs & Services → Credentials), set the authorized redirect URI to `<origin>/api/auth/callback/google`, and provide `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` as env vars. Implementation can be built and tested with email/password sign-up while this is pending, but Google sign-in can't be verified end-to-end without it.

3. **Schema changes required** (flag per CLAUDE.md — not authorized by this task alone, needs explicit go-ahead): `User.name`, `User.passwordHash` becoming nullable (OAuth-only users have no password), and new `Account`/`Session`/`VerificationToken` tables for `@auth/prisma-adapter` (already a dependency, currently unused — the app runs pure JWT sessions with no adapter wired in). This is an additive migration, not destructive to existing data, but it is a schema change.

4. **Existing `Account` model name collision.** The app already has a domain model called `Account` (bank/credit accounts, `prisma/schema.prisma`). NextAuth's Prisma adapter also wants a model literally named `Account` for OAuth provider links. These must not collide. Recommend naming the adapter's model `AuthAccount` (and `AuthSession` for symmetry) and passing model-name overrides to `@auth/prisma-adapter`'s config. Needs verification against the installed `@auth/prisma-adapter` version's API before committing to this.

5. **Bootstrap scripts become dead/optional.** `prisma:bootstrap-admin` and the `ADMIN_EMAIL`/`ADMIN_PASSWORD` seed path exist only because there was no sign-up flow. If (A) is chosen, decide whether to keep them (useful for seeding a known dev account) or retire them.

---

## Assumed direction: (A) multi-user, Google + email/password/name sign-up

### Schema changes (`prisma/schema.prisma`)

```prisma
model User {
  id           String   @id @default(cuid())
  email        String   @unique
  name         String?
  passwordHash String?  // nullable: OAuth-only users have no password
  createdAt    DateTime @default(now())

  accounts      Account[]        // existing domain accounts (unchanged)
  categories    Category[]
  transactions  Transaction[]
  budgets       Budget[]
  categoryRules CategoryRule[]
  authAccounts  AuthAccount[]    // new: OAuth provider links
  authSessions  AuthSession[]    // new: only needed if session strategy becomes "database"; if JWT stays, adapter still requires the model to exist but it stays empty
}

model AuthAccount {
  id                String  @id @default(cuid())
  userId            String
  type              String
  provider          String
  providerAccountId String
  refresh_token     String? @db.Text
  access_token      String? @db.Text
  expires_at        Int?
  token_type        String?
  scope             String?
  id_token          String? @db.Text
  session_state     String?

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([provider, providerAccountId])
}

model AuthSession {
  id           String   @id @default(cuid())
  sessionToken String   @unique
  userId       String
  expires      DateTime

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model VerificationToken {
  identifier String
  token      String   @unique
  expires    DateTime

  @@unique([identifier, token])
}
```

Run `npm run prisma:migrate -- --name add-auth-provider-tables` once schema is approved, then `npm run prisma:generate`.

Existing domain model `Account` (checking/savings/credit card) is untouched — only the new `AuthAccount`/`AuthSession` names avoid the collision (point 4 above). Double check `@auth/prisma-adapter`'s expected field casing (it defaults to camelCase matching NextAuth's internal shape — verify against the installed version's TypeScript types before finalizing field names, e.g. whether it wants `PrismaAdapter(prisma, { ... })` model-name overrides or expects exact default names).

### `lib/auth/config.ts`

- Add `GoogleProvider` from `next-auth/providers/google`, reading `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` from env.
- Wire `PrismaAdapter(prisma)` from `@auth/prisma-adapter`, with model-name overrides for the `AuthAccount`/`AuthSession` rename if the adapter API requires it.
- Keep `session: { strategy: 'jwt' }` — an adapter can coexist with JWT sessions (only OAuth account linking needs the adapter; session storage itself doesn't have to move to "database" strategy). Confirm this combination is supported by the installed NextAuth v5 beta before committing to it; if not, plan B is `strategy: 'database'`, which is a bigger behavioral change (session lookups hit Postgres instead of decoding a JWT) and should be flagged back if hit.
- Existing `Credentials` provider's `authorize` needs a null-check update since `passwordHash` is now nullable (an OAuth-created user has no password — reject credential login attempts for that email with a clear "sign in with Google instead" error rather than crashing on `bcrypt.compare(password, null)`).
- `jwt`/`session` callbacks unchanged in shape (`token.userId`), but should now also carry `name` if present.

### New sign-up path

- **New route:** `app/(auth)/signup/page.tsx`, mirroring `app/(auth)/login/page.tsx`'s two-pane layout.
- **New component:** `components/auth/signup-form.tsx`, mirroring `components/auth/login-form.tsx` — fields: name, email, password (reuse `MIN_PASSWORD_LENGTH`/`MAX_PASSWORD_BYTES` constraints from `lib/validators/password.ts`), submit via a new server action.
- **New validator:** `lib/validators/signup.ts` — `{ name: string (min 1), email: string.email(), password: <same rules as changePasswordSchema.newPassword> }`.
- **New service method:** `lib/services/users.ts` (new file) — `createUser({ name, email, password })`: checks email uniqueness, hashes password (bcrypt, cost 12 to match existing `password.ts`/`seed.ts` convention), creates the `User` row plus its default `Category` set and default `CategoryRule`s (reuse the `DEFAULT_CATEGORIES`/`DEFAULT_RULES` data currently inlined in `prisma/seed.ts` — extract to a shared module, e.g. `lib/services/defaults.ts`, so both the seed script and real sign-up create the same starter categories) and a starting "Checking" account, matching what `prisma/seed.ts` does today for the one seeded user. Throws `ServiceValidationError` on duplicate email.
- **New server action:** in `lib/auth/actions.ts`, `signUpAction(prevState, formData)` — validates via the new validator, calls the service, then calls `signIn('credentials', { email, password, redirectTo: '/dashboard' })` to log the new user in immediately (mirrors `signInAction`'s error-mapping pattern).
- **New API surface for OAuth entry points:** none needed beyond NextAuth's built-in `/api/auth/signin/google` and `/api/auth/callback/google` handled by the existing catch-all `app/api/auth/[...nextauth]/route.ts` — no new route handler required, just the provider config.
- Add a "Continue with Google" button + "Sign up" link on the login page, and a "Sign in" link on the new sign-up page (both pages cross-link, standard pattern).
- Google sign-in for a brand-new email should also provision the default categories/account — the adapter's `createUser` event or a `signIn`/`linkAccount` callback needs to call the same defaults-provisioning logic as `createUser` in the credentials path, to avoid a Google-created user landing on an empty dashboard. Needs an `events.createUser` hook in `authConfig` calling the shared defaults helper.

### `app/(protected)/layout.tsx` / session checks

Unaffected in shape — already reads session via `lib/auth/session.ts`; just needs `userId` to keep resolving correctly, which it will regardless of provider.

### Out of scope / explicitly not doing here

- No password-reset / forgot-password flow (separate feature).
- No email verification for credential sign-ups (flag as a security follow-up if this becomes a public-facing multi-user product rather than a personal tool).
- No account-linking UI for a user who signs up with email first and later wants to add Google to the same account (NextAuth/adapter will auto-link by matching email by default in recent versions — verify this behavior and whether it needs `allowDangerousEmailAccountLinking: true` or similar, and whether that's desirable here).

## Checklist

- [ ] Confirm direction (A) vs (B) with user; confirm schema-change authorization
- [ ] User provisions Google OAuth client, adds `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET` to `.env`/`.env.example`
- [ ] Extract `DEFAULT_CATEGORIES`/`DEFAULT_RULES` out of `prisma/seed.ts` into a shared `lib/services/defaults.ts`
- [ ] Schema: add `name`, nullable `passwordHash` to `User`; add `AuthAccount`, `AuthSession`, `VerificationToken`; migrate
- [ ] `lib/auth/config.ts`: add `GoogleProvider`, wire `PrismaAdapter`, null-safe `Credentials.authorize`, `events.createUser` defaults provisioning
- [ ] `lib/validators/signup.ts`
- [ ] `lib/services/users.ts`: `createUser` (uniqueness check, hash, defaults provisioning)
- [ ] `lib/auth/actions.ts`: `signUpAction`
- [ ] `components/auth/signup-form.tsx`
- [ ] `app/(auth)/signup/page.tsx`
- [ ] Login page: "Continue with Google" button + link to sign-up; sign-up page links back to login
- [ ] Decide fate of `prisma:bootstrap-admin` / `ADMIN_EMAIL`/`ADMIN_PASSWORD` seed path
- [ ] Unit tests: `users.ts` service (duplicate email, defaults provisioning), `signup` validator
- [ ] E2e test: sign up with email/password/name → lands on dashboard with default categories/account present; duplicate-email sign-up shows error
- [ ] `npm run format:fix && npm run lint` + full test suite
