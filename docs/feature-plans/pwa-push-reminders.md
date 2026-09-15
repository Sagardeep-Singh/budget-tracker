# PWA install + configurable push reminders

## Goals / acceptance criteria

**Installable PWA**

- App exposes a valid web manifest (name, icons, `start_url`, `display: standalone`)
  and a registered service worker; passes Chrome/Edge "Install app" and iOS
  "Add to Home Screen" checks.
- Launching the installed app opens straight into the app shell (dashboard if
  signed in, login otherwise) with no browser chrome.
- Offline/flaky-network navigation shows a static "you're offline" fallback
  instead of a broken blank page. No offline data access or mutation queue —
  out of scope (see Non-goals).
- Service worker never caches authenticated HTML or `/api/*` responses — this
  is a shared-device-safe multi-user app; caching another user's data on a
  shared browser profile would be a real leak, not a hypothetical.

**Configurable reminders**

- User can turn reminders on/off from Settings. Turning on triggers the
  browser's native push-permission prompt.
- User picks a cadence: daily, weekly, biweekly, or monthly.
- Reminder is **activity-gated**: it only sends if the user hasn't logged a
  transaction or committed a CSV import since the last reminder window
  opened. A diligent user gets skipped, not nagged.
- Multiple devices/browsers can each hold their own push subscription; all
  active ones for a user receive the reminder.
- Existing and new users are opted **out** by default — nothing prompts for
  push permission until the user explicitly visits Settings and enables it.
- Clicking the notification opens/focuses the app on the add-transaction
  overlay (`/dashboard?overlay=add`).
- A push subscription that the push service reports as gone (404/410) is
  marked expired and stops being sent to, without erroring the whole run.

## Non-goals

- Offline read/write of transaction data (full offline-first sync).
- In-app notification history/center.
- Any reminder type beyond "you haven't logged anything" (no budget-overspend
  alerts, no bill reminders).
- Per-account/per-category reminder rules.
- Email/SMS reminders — push only.
- Snooze/dismiss action buttons on the notification itself — plain
  click-to-open only.
- **Exact time-of-day delivery.** See "Cron constraint" below — this app is
  on Vercel Hobby, which limits cron to one run per day, so a per-user
  preferred-hour/timezone control is not honorable and is deferred.

## Cron constraint (Vercel Hobby)

Hourly cron (needed to honor a per-user preferred local hour) requires Vercel
Pro. This app is on Hobby, which runs a cron job **once a day**, firing
sometime within the hour of its scheduled UTC time. Design accordingly:

- One daily cron tick evaluates every enabled user, regardless of cadence.
- No `preferredHour`/`timezone` fields — there's nothing to honor them
  against with a single daily run, and showing an hour picker the app can't
  respect would be misleading.
- Cadence (`daily`/`weekly`/`biweekly`/`monthly`) is enforced as an elapsed-
  time floor since `lastSentAt`, not a calendar/local-time boundary.
- **Documented upgrade path:** if the deployment moves to Pro later, add
  back `preferredHour`/`timezone` fields and an hourly cron schedule; the
  service layer's `isDueNow` is already isolated as a pure function, so this
  is additive, not a rewrite.

## Data model

Requires a schema change (new models + two relations on `User`) — flagging
per CLAUDE.md's "never change schema unless the task explicitly requires
it": this feature cannot be built without persisting subscriptions and
preferences, so the change is in scope, but call it out explicitly before
running the migration.

```prisma
enum ReminderCadence {
  DAILY
  WEEKLY
  BIWEEKLY
  MONTHLY
}

/// per-user reminder settings. A row exists only once the user opts in from
/// Settings — absence of a row means reminders are off, which is the default
/// for every existing and new user, so no backfill migration is needed.
model NotificationPreference {
  id              String          @id @default(cuid())
  userId          String          @unique
  enabled         Boolean         @default(false)
  cadence         ReminderCadence @default(DAILY)
  /// UTC instant a reminder was last actually pushed; opens the window the
  /// next tick's activity gate compares Transaction/ImportBatch activity
  /// against, and enforces the cadence floor so a user isn't nagged twice
  /// in one period
  lastSentAt      DateTime?
  /// UTC instant of the last daily tick that evaluated this row, sent or
  /// not; bookkeeping only, makes a stalled cron visible without digging
  /// through logs
  lastEvaluatedAt DateTime?
  createdAt       DateTime        @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([enabled])
}

/// one browser/device push registration. A user may hold several (phone,
/// laptop, work browser) and every non-expired one receives each reminder.
model PushSubscription {
  id         String    @id @default(cuid())
  userId     String
  /// push service endpoint URL; globally unique per browser registration,
  /// so re-subscribing the same browser under a different account reassigns
  /// the row instead of erroring
  endpoint   String    @unique
  /// client public key (p256dh) from the browser subscription, base64url
  p256dh     String
  /// client auth secret from the browser subscription, base64url
  auth       String
  /// user-agent at subscribe time, so Settings can label the device
  userAgent  String?
  createdAt  DateTime  @default(now())
  lastUsedAt DateTime?
  /// set when the push service returned 404/410 for this endpoint; kept
  /// rather than deleted so Settings can show the device as expired
  disabledAt DateTime?

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, disabledAt])
}
```

`User` gains two relation fields only:

```prisma
  pushSubscriptions      PushSubscription[]
  notificationPreference NotificationPreference?
```

Reasoning: a separate `NotificationPreference` model (not fields on `User`)
keeps the cron's hot query (`findMany({ where: { enabled: true } })`) scoped
to opted-in users instead of scanning every account row on every tick, and
row-absence encodes "off" for free — matching the opt-out-by-default
requirement with zero migration backfill. `endpoint` is globally unique
(not `@@unique([userId, endpoint])`) because a push endpoint identifies a
browser registration, not a user-browser pair; `disabledAt` is a soft flag,
matching the existing `Transaction.skippedAt` / `ImportBatch.undoneAt`
pattern instead of deleting rows outright.

## Service layer

**`lib/services/pushSubscriptions.ts`** (new)

- `savePushSubscription(userId, input)` — upsert on `endpoint`; reassigns
  the row's `userId` and clears `disabledAt` so a revived/reused browser
  profile works without a separate "reactivate" path.
- `deletePushSubscription(userId, endpoint)` — scoped `deleteMany` so
  unsubscribing twice, or an unknown endpoint, is a no-op rather than an
  error.
- `listPushSubscriptions(userId)` — frontend-safe list (label, timestamps,
  expired flag) for the Settings device list.
- `listPushTargets(userId)` — the only function returning the raw keys
  (`endpoint`/`p256dh`/`auth`); used exclusively by the send path, never
  returned to the client.
- `markPushSubscriptionExpired(id)` / `touchPushSubscription(id)`.

**`lib/services/reminders.ts`** (new)

- `getReminderPreference(userId)` — returns defaults
  (`{ enabled: false, cadence: 'DAILY', lastSentAt: null }`) when no row
  exists, so the Settings component always renders one shape.
- `updateReminderPreference(userId, input)` — upsert; flipping
  `enabled` false→true resets `lastSentAt` to `null` so the first reminder
  isn't blocked by a stale timestamp from a previous opt-in period.
- `isDueNow(pref, lastActivityAt, now)` — pure, no I/O, unit-tested in
  isolation:
  1. **Cadence floor** — not due if `now - (lastSentAt ?? pref.createdAt) <
cadenceDays * 24h` (minus a small slack to avoid a daily reminder
     creeping later each day due to sub-second jitter in when the cron
     actually fires).
  2. **Activity gate** — `windowStart = lastSentAt ?? createdAt`; not due
     if `lastActivityAt !== null && lastActivityAt >= windowStart` — the
     user has used the app since the last nudge, so stay quiet.
- `sendDueReminders(now)` — orchestration for the cron route:
  1. Load all `enabled` preferences.
  2. Filter by the cadence floor (pure, no query).
  3. Batch-resolve `lastActivityAt` per surviving user via
     `Transaction.groupBy`/`ImportBatch.groupBy` (`createdAt`, not the
     transaction's real-world `date`, since the gate asks "did you open
     the app" — `date` is routinely backdated). `ImportBatch` filtered to
     `status: 'ACTIVE'` so an undone import doesn't count as engagement.
  4. For each due user, load `listPushTargets`; skip (record
     `lastEvaluatedAt` only) if the user has no active devices.
  5. Send with a bounded concurrency cap over `Promise.allSettled` — not a
     serial loop, not unbounded fan-out.
  6. On any success for a user, set `lastSentAt = now`. On an all-failed
     transient case, leave `lastSentAt` alone so the next daily tick
     re-evaluates. On a 404/410, mark that subscription expired.
  7. Return a summary (`evaluated`, `due`, `usersNotified`, `pushesSent`,
     `pushesFailed`, `subscriptionsExpired`) for the cron log.

**`lib/push/webPush.ts`** (new, transport — deliberately outside
`lib/services/` so `web-push`, a third-party crypto dependency, stays out
of the business-logic layer and is the one thing `reminders.test.ts`
mocks). Wraps the `web-push` npm package; `isPushConfigured()` gates on the
VAPID env vars being present, mirroring the existing `AUTH_GOOGLE_ID`
optional-feature pattern.

## Validators

- `lib/validators/push.ts` — `savePushSubscriptionSchema` (mirrors the
  browser's native `PushSubscription.toJSON()` shape:
  `{ endpoint, keys: { p256dh, auth } }`), `unsubscribePushSchema`.
- `lib/validators/reminders.ts` — `reminderCadenceSchema` (enum) and
  `updateReminderPreferenceSchema` (`{ enabled, cadence }`, full-object
  PATCH so a client can't toggle `enabled` without the server having
  something sane to fall back to).

## API routes

| Path                                  | Verb  | Notes                                                                                                                                                                |
| ------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/api/push/subscribe/route.ts`     | POST  | session → validate → `savePushSubscription` → 201                                                                                                                    |
| `app/api/push/unsubscribe/route.ts`   | POST  | session → validate → `deletePushSubscription`. POST (not DELETE) since the endpoint URL belongs in a body — matches existing precedent like `transactions/[id]/skip` |
| `app/api/settings/reminders/route.ts` | PATCH | session → validate → `updateReminderPreference`, matching this repo's PATCH convention (`accounts/[id]`, `rules/[id]`)                                               |
| `app/api/cron/reminders/route.ts`     | GET   | no session; Vercel Cron calls it directly — see auth below                                                                                                           |

**Cron auth:** Vercel sends `Authorization: Bearer $CRON_SECRET` on
cron-triggered requests when `CRON_SECRET` is set. The handler: 500 if the
env var is unset (fail closed, never open), `crypto.timingSafeEqual` for
the comparison (401 on mismatch without a length-revealing shortcut), then
calls `sendDueReminders(new Date())` and returns the summary as JSON. All
business logic stays in `sendDueReminders`; the route is secret-check +
call + response.

## PWA shell

- **`app/manifest.ts`** — typed Next manifest (auto-linked, no
  `app/layout.tsx` metadata edit needed), colocated with the existing
  `app/icon.svg` / `app/apple-icon.tsx`. `start_url: '/dashboard'`,
  `display: 'standalone'`, brand colors matching the existing theme.
  Needs 192px/512px + a maskable 512px PNG checked into `public/icons/`.
- **`public/sw.js`** — plain JS at origin root (required for scope `/`):
  - `install`/`activate`: precache only the static `/offline` fallback
    page and an icon; clean up stale cache versions.
  - `fetch`: intercepts **only** `GET` navigation requests, network-first
    with a fallback to the cached `/offline` page on failure. Everything
    else — especially `/api/*` and any authenticated HTML — passes through
    untouched. This restraint matters: caching authenticated data in a
    service worker on a shared/multi-user device would leak one user's
    balances to the next signed-in user.
  - `push`: shows the notification from the payload (with a hardcoded
    fallback if the payload is empty, since some push services deliver
    empty wake-up pushes).
  - `notificationclick`: focuses an existing tab if one is open, otherwise
    opens `/dashboard?overlay=add`.
  - Not handled in v1 (documented follow-up): `pushsubscriptionchange` —
    if a browser silently rotates its endpoint, that device stops getting
    reminders until the user revisits Settings and it re-upserts.
- **`components/pwa/service-worker-register.tsx`** — client component,
  renders nothing, registers `/sw.js` in a `useEffect`. Mounted in
  `app/layout.tsx` next to the existing `<ThemeInit />`. Registering the
  service worker never itself prompts for notification permission — only
  the Settings toggle does, preserving opt-out-by-default.
- **`app/offline/page.tsx`** — static, outside `(protected)` so it needs no
  session.
- **`lib/push/client.ts`** — browser-only helpers: subscribe (requests
  permission, calls `pushManager.subscribe`, POSTs to `/api/push/subscribe`)
  and unsubscribe. Also handles **permission drift**: if Settings finds
  `Notification.permission === 'denied'` on a device that thinks it's
  subscribed, it unsubscribes _that device's endpoint only_ — it must not
  flip the account-wide `enabled` flag, or revoking permission on a laptop
  would silently kill reminders on the user's phone too.
- `next.config.ts` gets a `headers()` entry sending `Cache-Control:
no-cache` for `/sw.js` so a deployed update is picked up promptly instead
  of being pinned by HTTP caching.

## Vercel Cron

`vercel.json` (new):

```json
{ "crons": [{ "path": "/api/cron/reminders", "schedule": "0 13 * * *" }] }
```

Once daily (Hobby-plan limit); `13:00 UTC` is a placeholder landing in
US/EU morning-to-midday — adjust to taste, it's not user-configurable in
v1 per the cron constraint above.

## New env vars (`.env.example`)

| Var                            | Purpose                                                                                                                  |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Used both client-side (`pushManager.subscribe`) and server-side (`web-push`) — one var, not two, so the pair can't drift |
| `VAPID_PRIVATE_KEY`            | Server-only                                                                                                              |
| `VAPID_SUBJECT`                | `mailto:`/`https:` contact URL required by the Web Push spec                                                             |
| `CRON_SECRET`                  | Vercel-injected bearer token for the cron route; also usable for manual testing                                          |

Generate with `npx web-push generate-vapid-keys`. Leaving these unset hides
the reminders UI and no-ops the cron, same optional-feature idiom as the
existing `AUTH_GOOGLE_ID` block. New deps: `web-push` (prod),
`@types/web-push` (dev).

## UI (Settings page)

New fourth card in `components/settings/settings-view.tsx`, styled like the
existing "Preferences" card (same `pillGroup`/`pillOption` helpers already
used for palette/appearance):

- **Reminders** card:
  - Row: "Remind me to log expenses" toggle. Off by default. Turning on
    triggers the browser permission prompt; if denied, show an inline note
    ("Notifications are blocked in your browser — enable them in your
    browser's site settings to turn this on") instead of a silently
    no-op toggle.
  - Row: cadence pills — Daily / Weekly / Biweekly / Monthly — same visual
    pattern as the palette pills, disabled while the toggle is off.
  - Small caption under the card: "We check once a day, so delivery time
    varies." (sets expectations given the cron constraint).
  - Device list (only shown once at least one subscription exists): each
    row shows a derived label ("Chrome on Android"), last-used date, and a
    "Remove" action calling unsubscribe for that one endpoint — lets a
    user manage devices without an all-or-nothing switch.
  - If `NEXT_PUBLIC_VAPID_PUBLIC_KEY` isn't configured (self-hosted preview
    without keys), render "Reminders aren't available on this deployment"
    instead of a broken toggle.
- `app/(protected)/settings/page.tsx` fetches `getReminderPreference` +
  `listPushSubscriptions` server-side (same pattern as the existing
  `userHasPassword` fetch) and passes them into `SettingsView`.

## Test plan (unit + e2e, written before implementation per this repo's workflow)

**Unit (`tests/unit/services/`)**

- `reminders.test.ts`: `isDueNow` — not due before cadence floor elapses;
  due exactly at the floor; not due when activity occurred after
  `windowStart`; due when activity predates `windowStart`; first-ever
  reminder measures from `createdAt`, not `lastSentAt`. `sendDueReminders`
  (prisma + `webPush` mocked): skips disabled prefs; skips users with no
  active devices; marks `lastSentAt` only on at-least-one success; leaves
  `lastSentAt` untouched on all-transient-failures; expires a subscription
  on a 404/410 response; idempotent under a duplicate same-tick invocation.
- `pushSubscriptions.test.ts`: upsert-on-endpoint reassigns `userId` and
  clears `disabledAt`; delete is scoped to `userId` (can't unsubscribe
  another user's device) and no-ops on an unknown endpoint;
  `deviceLabelFromUserAgent` mapping for a few representative user agents.
- `validators/reminders.test.ts` and `validators/push.test.ts`: cadence
  enum rejects unknown values; subscribe schema rejects a malformed
  endpoint/missing keys.

**E2E (`tests/e2e/`)**

- `reminders-settings.spec.ts`: Reminders card renders off by default;
  toggling on with permission granted shows the cadence pills enabled and
  persists a choice across reload; toggling on with permission denied
  shows the blocked-notice copy instead of silently succeeding; removing a
  listed device removes it from the list.
- Manual-only (not automatable in Playwright): actual push delivery,
  install-prompt behavior, and offline-fallback navigation — call out in
  the PR description as manually verified rather than covered by e2e.

## Checklist

- [x] Confirm schema-change authorization (adds `ReminderCadence`,
      `NotificationPreference`, `PushSubscription`, two `User` relations)
      before running the migration, per CLAUDE.md.
- [x] `npm run prisma:migrate -- --name push_reminders` + `npm run prisma:generate`
      (`prisma/migrations/20260915062353_push_reminders`)
- [x] Install `web-push` + `@types/web-push`; generate VAPID keys; add the
      four new vars to `.env.example` and local `.env`
- [x] `lib/validators/push.ts`, `lib/validators/reminders.ts`
- [x] `lib/push/webPush.ts` (`isPushConfigured`, `sendPush`, 404/410 handling)
- [x] `lib/services/pushSubscriptions.ts` + unit tests
- [x] `lib/services/reminders.ts` (`isDueNow` first, then `sendDueReminders`) + unit tests
- [x] Routes: `push/subscribe`, `push/unsubscribe`, `settings/reminders` (PATCH), `cron/reminders` (GET + secret)
- [x] `vercel.json` daily cron entry
- [x] `app/manifest.ts` + `public/icons/*.png` (including maskable variant)
- [x] `public/sw.js`, `next.config.ts` no-cache header for `/sw.js`, `app/offline/page.tsx`
- [x] `components/pwa/service-worker-register.tsx`, mounted in `app/layout.tsx`
- [x] `lib/push/client.ts` + `components/settings/reminders-section.tsx` (per UI section above), wired through `app/(protected)/settings/page.tsx` and `components/settings/settings-view.tsx`
- [x] Unit tests per test plan above (66 new cases across
      `reminders`, `pushSubscriptions`, and both validators)
- [x] E2E: `reminders-settings.spec.ts` written; **not executed** — the
      sandbox can't download a Playwright browser, so it still needs a run
      on a machine with Chromium before merge.
- [~] Manual verification: cron route verified by hand (401 with no/wrong
  bearer, 200 + sane summary with the right one; an all-failed send
  leaves `lastSentAt` null and only advances `lastEvaluatedAt`).
  **Still outstanding:** install prompt on desktop Chrome + Android,
  airplane-mode navigation hitting `/offline`, and a real push
  delivered to a real device — none are reachable from the sandbox.
- [x] `npm run format:fix && npm run lint` (clean), `npm run test`
      (259 passing), `npm run build` (clean); `npm run test:e2e` blocked as
      noted above.

## Known trade-offs

- **No exact time-of-day.** Deferred until/unless the deployment moves to
  Vercel Pro (see "Cron constraint"); the service layer is structured so
  adding `preferredHour`/`timezone` later is additive.
- **`pushsubscriptionchange` isn't handled.** A silently-rotated push
  endpoint stops receiving reminders until the user revisits Settings.
  Acceptable for v1; flagged as a follow-up.
- **Cadence is a rolling elapsed-time window, not a calendar boundary** —
  "monthly" means 30 days since the last send, not "the 1st of next
  month." Simpler and avoids Feb/31st edge cases; carries no meaningful
  product cost for a nag reminder.
