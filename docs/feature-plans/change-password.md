# Change password

Allow the single user to change their password from Settings, replacing the one seeded via `ADMIN_PASSWORD`.

## Scope

- Settings gains a "Change password" form: current password, new password, confirm new password (confirm is client-only, never sent to server).
- Server validates: current password matches (bcrypt.compare), new password 12–72 bytes, new != current, then rehashes + updates `User.passwordHash`.
- On success: force sign-out on this device, redirect to `/login?passwordChanged=1` with a visible confirmation banner.
- Distinct inline error message per failure mode, reusing the existing single-banner form idiom (`role="alert"`, `bg-rose-soft text-rose`).
- No schema changes. No migration.

## Non-goals

- Invalidating sessions on other devices — JWT strategy, no DB session table. Forced sign-out only affects the current device's cookie.
- Forgot-password / reset-by-email flow (needs reset-token+expiry schema fields).
- "Password last changed" timestamp (no `updatedAt` field on `User`).
- Rate limiting / lockout on repeated wrong-current-password attempts.
- Changing email.
- Fixing `prisma/bootstrap-admin.ts`'s upsert-overwrite behavior — **known caveat**: re-running `npm run prisma:bootstrap-admin` with `ADMIN_PASSWORD` set will silently revert a user-changed password. Documented only, not remediated.

## Files

**New**

- `lib/validators/password.ts` — `changePasswordSchema`, `MIN_PASSWORD_LENGTH` (12), `MAX_PASSWORD_BYTES` (72), `ChangePasswordInput`.
- `lib/services/password.ts` — `changePassword(userId, input): Promise<{ ok: true }>`.
- `app/api/settings/password/route.ts` — `POST` only.
- `components/settings/change-password-form.tsx` — client form.
- `tests/unit/services/password.test.ts`.
- Validator unit tests (co-located per repo convention, check existing accounts validator test location).

**Modified**

- `lib/auth/actions.ts` — add `signOutAfterPasswordChange` (do not touch `signOutAction`, it's bound as a form action elsewhere).
- `components/settings/settings-view.tsx` — add third card rendering `<ChangePasswordForm />`.
- `app/(auth)/login/page.tsx` — read `searchParams.passwordChanged`, render `role="status"` confirmation banner.

**Not touched:** `prisma/schema.prisma`, `prisma/bootstrap-admin.ts`, `lib/auth/config.ts`, `lib/services/common.ts`, `app/(protected)/settings/page.tsx`.

## Validator (`lib/validators/password.ts`)

```ts
export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_BYTES = 72;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password.'),
  newPassword: z
    .string()
    .min(12, 'New password must be at least 12 characters.')
    .refine((value) => new TextEncoder().encode(value).length <= 72, {
      message:
        'New password is too long (72 bytes max — accented or emoji characters count for more than one).',
    }),
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
```

`confirmNewPassword` is never part of the schema — client-only check. 72-byte cap justified: bcryptjs silently truncates input beyond 72 UTF-8 bytes rather than throwing (verified against installed `bcryptjs@3.0.3`), so the cap prevents two different long passwords resolving to the same hash.

## Service (`lib/services/password.ts`)

Ordered steps (order is load-bearing — wrong-current must short-circuit before same-as-current check):

1. `prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } })` → null: throw `ServiceValidationError('Your session is no longer valid. Sign in again.')`.
2. `bcrypt.compare(currentPassword, user.passwordHash)` false → throw `ServiceValidationError('Current password is incorrect.')`.
3. `bcrypt.compare(newPassword, user.passwordHash)` true → throw `ServiceValidationError('New password must be different from your current password.')`.
4. `bcrypt.hash(newPassword, 12)`.
5. `prisma.user.update({ where: { id: userId }, data: { passwordHash } })`.
6. Return `{ ok: true }` — never a raw Prisma model.

`userId` always from `session.user.id`, never request body.

## Route (`app/api/settings/password/route.ts`)

```
POST /api/settings/password
Request:  { currentPassword: string, newPassword: string }
200: { ok: true }
400: { error: string }   // user-facing message rendered verbatim
401: { error: 'Unauthorized' }
```

1. No session → 401.
2. `changePasswordSchema.safeParse(body)` fail → 400 `{ error: issues[0].message }` (a string, not `flatten()` — divergence from accounts route is deliberate since the client renders it directly).
3. `changePassword(session.user.id, parsed.data)` in try/catch; `ServiceValidationError` → 400 `{ error: e.message }`; else rethrow.
4. Success → 200 `{ ok: true }`.

## Auth action (`lib/auth/actions.ts`)

```ts
export const signOutAfterPasswordChange = async (): Promise<void> => {
  await signOut({ redirectTo: '/login?passwordChanged=1' });
};
```

## Client form (`components/settings/change-password-form.tsx`)

- `'use client'`, uncontrolled inputs via `FormData`, matching `account-form.tsx` idiom.
- `autoComplete`: `current-password` / `new-password` / `new-password`.
- Submit: prevent default → if confirm !== new, inline error, no request → POST → on !ok, set error from `body.error` or generic fallback → on success, call `signOutAfterPasswordChange()` **outside any try/catch** (it's a redirect-throwing server action; catching it strands the user).
- Single banner: `<p className="bg-rose-soft text-rose rounded-lg px-3 py-2 text-sm" role="alert">`.
- Button: `{pending ? 'Changing…' : 'Change password'}`.

## Login confirmation (`app/(auth)/login/page.tsx`)

`searchParams: Promise<{ passwordChanged?: string }>`; when `'1'`, render above `<LoginForm />`:

```tsx
<p className="bg-sky-soft text-sky mb-4 rounded-lg px-3 py-2 text-sm" role="status">
  Password changed. Sign in with your new password.
</p>
```

(No green/success token exists in `app/globals.css` — reuse `sky`, don't invent one.)

## Known limitations (record so they aren't filed as bugs)

- JWT sessions on other devices are not invalidated.
- `bootstrap-admin` overwrite caveat (see Non-goals).
- No rate limiting on wrong-current-password attempts.

## Checklist

- [x] `lib/validators/password.ts`
- [x] `lib/services/password.ts`
- [x] `app/api/settings/password/route.ts`
- [x] `signOutAfterPasswordChange` in `lib/auth/actions.ts`
- [x] `components/settings/change-password-form.tsx`
- [x] Wire into `components/settings/settings-view.tsx`
- [x] `app/(auth)/login/page.tsx` confirmation banner
- [x] `tests/unit/services/password.test.ts` (wrong current / same-as-current / user-not-found / happy path with scoped update + differing hash) — plus an ordering-guard case (wrong current _and_ new-password-equals-stored) that fails if the two `bcrypt.compare` steps are swapped
- [x] Validator tests (11/12/72/73 byte boundaries, multibyte over-72-bytes case, blank current password) — at `tests/unit/validators/password.test.ts`; no sibling validator-test convention existed
- [ ] Manual check: change → redirect with banner → old password rejected, new one works — **not run** (requires a live dev server + database)
- [x] Fixed: unhandled fetch rejection in `change-password-form.tsx` left form stuck on "Changing…" on network failure — wrapped fetch call in try/catch, `signOutAfterPasswordChange()` remains outside any try/catch
- [x] `npm run format:fix && npm run lint && npm run test`
