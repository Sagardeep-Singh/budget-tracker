# Signup email enumeration fix

**Problem:** submitting `/signup` with an email that already has an account showed
"An account with this email already exists.", while a new email signed in and landed on
`/dashboard`. Anyone could use the form to check whether an email is registered.

## Decisions

1. **Same response for new and existing emails.** `signUpAction` never signs the user in
   and always redirects to `/login?signup=...`. The login page shows a neutral banner.
   This drops the old auto sign-in after signup, since a new email landing on
   `/dashboard` vs. an existing one staying put is itself the leak.
2. **Out-of-band notice for existing emails.** When email (Brevo) is configured:
   - new email: account is created and the verification link is sent (as before);
   - existing email: nothing is created, and the owner gets an "account already exists"
     email pointing them to sign in (or Google, for Google-only accounts, without saying
     which kind of account it is).
     The notice is rate limited per address (`signup-exists:email`, 3/hour) so the form
     can't be used to spam a known inbox. Over the limit it's silently skipped.
3. **No email configured** (local dev): banner reads "If this email is new, your account
   is ready. Sign in to continue." Same text for both cases.
4. **Timing:** the existing-email path still runs a bcrypt hash so response time doesn't
   give it away. A concurrent create that loses the unique-email race is treated as
   "exists".

## Banners (`/login?signup=`)

- `check-email`: "Thanks for signing up. Check your inbox for next steps, then sign in below."
- `done`: "If this email is new, your account is ready. Sign in to continue."

## Checklist

- [x] `createUser` returns `{ id, created }` instead of throwing on duplicates; hashes on both paths; handles P2002
- [x] Shared email layout (`lib/email/layout.ts`), verification email moved onto it unchanged
- [x] `buildAccountExistsEmail` template
- [x] `sendAccountExistsEmail` service with per-address rate limit
- [x] `signUpAction` always redirects to `/login?signup=check-email|done`
- [x] Login page banners
- [x] Unit tests: users, emailVerification (notice), auth actions, account-exists template
- [x] E2E: signup specs + helpers sign in after signup; duplicate-email test asserts identical outcome
