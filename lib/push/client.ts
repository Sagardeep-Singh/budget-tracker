import type { FrontendPushSubscription } from '@/lib/services/pushSubscriptions';

/**
 * Browser-only push helpers used by the Settings reminders card. Everything here
 * assumes a DOM; nothing in this module is safe to import from a server component.
 */

export type SubscribeResult =
  | { status: 'subscribed'; subscription: FrontendPushSubscription }
  /** the user (or a policy) said no — the caller shows the blocked notice */
  | { status: 'denied' }
  /** no service worker / PushManager, e.g. iOS Safari outside an installed PWA */
  | { status: 'unsupported' }
  | { status: 'error'; message: string };

/** VAPID keys ship base64url; `pushManager.subscribe` wants raw bytes. */
const urlBase64ToUint8Array = (base64: string): Uint8Array<ArrayBuffer> => {
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
  const normalized = padded.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(normalized);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) {
    bytes[i] = raw.charCodeAt(i);
  }
  return bytes;
};

export const isPushSupported = (): boolean =>
  typeof window !== 'undefined' &&
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  'Notification' in window;

export const getNotificationPermission = (): NotificationPermission | null =>
  isPushSupported() ? Notification.permission : null;

const getSubscription = async (): Promise<PushSubscription | null> => {
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
};

/** The endpoint *this* browser holds, if any. Null when it isn't subscribed. */
export const getLocalPushEndpoint = async (): Promise<string | null> => {
  if (!isPushSupported()) {
    return null;
  }
  try {
    const subscription = await getSubscription();
    return subscription?.endpoint ?? null;
  } catch {
    return null;
  }
};

/**
 * Prompts for permission, subscribes this browser, and registers the subscription
 * server-side. Safe to call when already subscribed: `getSubscription()` is reused
 * and the POST upserts on endpoint.
 */
export const subscribeToPush = async (): Promise<SubscribeResult> => {
  if (!isPushSupported()) {
    return { status: 'unsupported' };
  }

  const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!vapidKey) {
    return { status: 'unsupported' };
  }

  // The one place in the app that asks for notification permission. Registering
  // the service worker does not, which is what preserves opt-out-by-default.
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    return { status: 'denied' };
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    const existing = await registration.pushManager.getSubscription();
    const subscription =
      existing ??
      (await registration.pushManager.subscribe({
        // Required by Chrome: every push must surface a visible notification.
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      }));

    const response = await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(subscription.toJSON()),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      return {
        status: 'error',
        message:
          typeof body?.error === 'string'
            ? body.error
            : 'Could not register this device for reminders.',
      };
    }

    return { status: 'subscribed', subscription: await response.json() };
  } catch (error) {
    return {
      status: 'error',
      message:
        error instanceof Error ? error.message : 'Could not enable reminders on this device.',
    };
  }
};

/**
 * Forgets one endpoint server-side, and tears down the local browser subscription
 * too when the endpoint belongs to this device.
 */
export const unsubscribeFromPush = async (endpoint: string): Promise<boolean> => {
  const response = await fetch('/api/push/unsubscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint }),
  });

  if (isPushSupported()) {
    try {
      const local = await getSubscription();
      if (local && local.endpoint === endpoint) {
        await local.unsubscribe();
      }
    } catch {
      // A local teardown failure doesn't undo the server-side removal; the row is
      // gone either way and this device simply stops being pushed to.
    }
  }

  return response.ok;
};

/**
 * Reconciles a device whose browser permission was revoked outside the app.
 *
 * Drops only *this* device's endpoint. It deliberately never touches the
 * account-wide `enabled` flag: revoking notifications on a laptop must not
 * silently stop reminders on the same user's phone.
 *
 * Returns the endpoint it dropped, or null if there was nothing to reconcile.
 */
export const reconcileRevokedPermission = async (): Promise<string | null> => {
  if (!isPushSupported() || Notification.permission !== 'denied') {
    return null;
  }

  const endpoint = await getLocalPushEndpoint();
  if (!endpoint) {
    return null;
  }

  await unsubscribeFromPush(endpoint);
  return endpoint;
};
