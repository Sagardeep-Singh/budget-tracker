import webpush from 'web-push';

/**
 * Transport for Web Push, deliberately kept out of `lib/services/` so the
 * `web-push` crypto dependency stays out of the business-logic layer — the
 * reminder service depends on this module's small interface and nothing else,
 * which is what makes `sendDueReminders` unit-testable with a single mock.
 */

export type PushTarget = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

export type PushPayload = {
  title: string;
  body: string;
  url: string;
};

export type PushSendResult =
  | { outcome: 'sent' }
  /** the push service says this endpoint is gone (404/410): stop sending to it */
  | { outcome: 'expired' }
  /** anything else — network blip, 5xx, rate limit: worth retrying next tick */
  | { outcome: 'failed'; error: string };

/**
 * Whether the VAPID trio is configured. Mirrors the existing `AUTH_GOOGLE_ID`
 * optional-feature idiom: unset means the reminders UI hides itself and the cron
 * no-ops, rather than the app crashing at import time.
 */
export const isPushConfigured = (): boolean =>
  Boolean(
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY &&
    process.env.VAPID_PRIVATE_KEY &&
    process.env.VAPID_SUBJECT,
  );

/**
 * Applied lazily per send rather than once at module load: the env vars are read
 * at call time, so importing this module in a deployment without keys is safe.
 */
const applyVapidDetails = (): void => {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT as string,
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY as string,
    process.env.VAPID_PRIVATE_KEY as string,
  );
};

const statusCodeOf = (error: unknown): number | null => {
  if (typeof error === 'object' && error !== null && 'statusCode' in error) {
    const code = (error as { statusCode: unknown }).statusCode;
    return typeof code === 'number' ? code : null;
  }
  return null;
};

/**
 * Sends one notification. Never throws: the caller fans out over many
 * subscriptions and one dead endpoint must not abort the whole run, so failures
 * come back as a result variant instead.
 */
export const sendPush = async (
  target: PushTarget,
  payload: PushPayload,
): Promise<PushSendResult> => {
  if (!isPushConfigured()) {
    return { outcome: 'failed', error: 'Push is not configured on this deployment' };
  }

  try {
    applyVapidDetails();
    await webpush.sendNotification(
      { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
      JSON.stringify(payload),
    );
    return { outcome: 'sent' };
  } catch (error) {
    const status = statusCodeOf(error);
    if (status === 404 || status === 410) {
      return { outcome: 'expired' };
    }
    return { outcome: 'failed', error: error instanceof Error ? error.message : String(error) };
  }
};
