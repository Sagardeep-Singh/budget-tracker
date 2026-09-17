import { test, expect, type Page } from '@playwright/test';

/**
 * Every test signs up its own user. The reminder preference is a single row per
 * user, so sharing the dev login across `fullyParallel: true` workers would have
 * these tests racing each other's toggle state.
 */
const signUpFreshUser = async (page: Page): Promise<void> => {
  const email = `reminders-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  await page.goto('/signup');
  await page.getByLabel('Name').fill('Reminder Person');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('a-long-enough-password');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
};

/**
 * Real push needs a live push service and a browser-granted permission, neither
 * of which exists in a headless run — so the Notification permission prompt and
 * the PushManager are stubbed at the page level. Everything below that (the
 * client module, the API routes, the services, the database) is the real thing.
 */
const stubPush = async (
  page: Page,
  { permission, endpoint }: { permission: NotificationPermission; endpoint: string },
): Promise<void> => {
  await page.addInitScript(
    ([perm, ep]) => {
      const state: { subscription: unknown } = { subscription: null };

      Object.defineProperty(Notification, 'permission', {
        configurable: true,
        get: () => perm,
      });
      Notification.requestPermission = async () => perm as NotificationPermission;

      const subscription = {
        endpoint: ep,
        toJSON: () => ({
          endpoint: ep,
          keys: { p256dh: 'BStubP256dhKey', auth: 'StubAuthSecret' },
        }),
        unsubscribe: async () => {
          state.subscription = null;
          return true;
        },
      };

      const registration = {
        pushManager: {
          getSubscription: async () => state.subscription,
          subscribe: async () => {
            state.subscription = subscription;
            return subscription;
          },
        },
      };

      Object.defineProperty(navigator.serviceWorker, 'ready', {
        configurable: true,
        get: () => Promise.resolve(registration),
      });
    },
    [permission, endpoint] as const,
  );
};

const uniqueEndpoint = (): string =>
  `https://fcm.googleapis.com/fcm/send/e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`;

test('the reminders card renders off by default, with the cadence pills disabled', async ({
  page,
}) => {
  await stubPush(page, { permission: 'granted', endpoint: uniqueEndpoint() });
  await signUpFreshUser(page);
  await page.goto('/settings');

  const toggle = page.getByRole('switch', { name: 'Remind me to log expenses' });
  await expect(toggle).toBeVisible();
  // Opt-out by default: nothing has prompted for push permission at this point.
  await expect(toggle).toHaveAttribute('aria-checked', 'false');

  for (const cadence of ['Daily', 'Weekly', 'Biweekly', 'Monthly']) {
    await expect(page.getByRole('button', { name: cadence, exact: true })).toBeDisabled();
  }
  await expect(page.getByText('We check once a day, so delivery time varies.')).toBeVisible();
});

test('turning reminders on enables the cadence pills and persists a choice across reload', async ({
  page,
}) => {
  await stubPush(page, { permission: 'granted', endpoint: uniqueEndpoint() });
  await signUpFreshUser(page);
  await page.goto('/settings');

  const toggle = page.getByRole('switch', { name: 'Remind me to log expenses' });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');

  const weekly = page.getByRole('button', { name: 'Weekly', exact: true });
  await expect(weekly).toBeEnabled();

  const saved = page.waitForResponse(
    (response) => response.url().includes('/api/settings/reminders') && response.ok(),
  );
  await weekly.click();
  await saved;

  await page.reload();
  await expect(page.getByRole('switch', { name: 'Remind me to log expenses' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(page.getByRole('button', { name: 'Weekly', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('button', { name: 'Daily' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
});

test('turning reminders on with notifications blocked shows the blocked notice and stays off', async ({
  page,
}) => {
  await stubPush(page, { permission: 'denied', endpoint: uniqueEndpoint() });
  await signUpFreshUser(page);
  await page.goto('/settings');

  const toggle = page.getByRole('switch', { name: 'Remind me to log expenses' });
  await toggle.click();

  // A silently no-op toggle would be worse than an error: the user would believe
  // reminders were on.
  // Scoped by text: Next.js's route announcer is also role="alert" and would
  // otherwise make this locator ambiguous.
  await expect(
    page.getByRole('alert').filter({ hasText: 'Notifications are blocked in your browser' }),
  ).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByRole('button', { name: 'Weekly', exact: true })).toBeDisabled();
});

test('a registered device is listed and can be removed on its own', async ({ page }) => {
  await stubPush(page, { permission: 'granted', endpoint: uniqueEndpoint() });
  await signUpFreshUser(page);
  await page.goto('/settings');

  await expect(page.getByRole('heading', { name: 'Devices' })).toHaveCount(0);

  await page.getByRole('switch', { name: 'Remind me to log expenses' }).click();
  await expect(page.getByRole('heading', { name: 'Devices' })).toBeVisible();

  const remove = page.getByRole('button', { name: 'Remove' });
  await expect(remove).toHaveCount(1);

  const removed = page.waitForResponse(
    (response) => response.url().includes('/api/push/unsubscribe') && response.ok(),
  );
  await remove.click();
  await removed;

  await expect(page.getByRole('heading', { name: 'Devices' })).toHaveCount(0);

  // Removing a device is per-endpoint and must not flip the account-wide toggle.
  await expect(page.getByRole('switch', { name: 'Remind me to log expenses' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
});
