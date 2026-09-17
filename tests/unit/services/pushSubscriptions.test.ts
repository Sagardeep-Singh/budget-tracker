import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    pushSubscription: {
      upsert: vi.fn(),
      deleteMany: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('@/lib/db/prisma', () => ({ prisma: prismaMock }));

const {
  deviceLabelFromUserAgent,
  savePushSubscription,
  deletePushSubscription,
  listPushSubscriptions,
  listPushTargets,
  markPushSubscriptionExpired,
  touchPushSubscription,
} = await import('@/lib/services/pushSubscriptions');

const dbSubscription = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'sub-1',
  userId: 'user-1',
  endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
  p256dh: 'BPublicKey',
  auth: 'AuthSecret',
  userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/120.0.0.0 Mobile Safari/537.36',
  createdAt: new Date('2026-03-01T10:00:00.000Z'),
  lastUsedAt: null,
  disabledAt: null,
  ...overrides,
});

const input = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
  keys: { p256dh: 'BPublicKey', auth: 'AuthSecret' },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('deviceLabelFromUserAgent', () => {
  it('maps representative user agents to a browser-on-platform label', () => {
    expect(
      deviceLabelFromUserAgent(
        'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36',
      ),
    ).toBe('Chrome on Android');
    expect(
      deviceLabelFromUserAgent(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1',
      ),
    ).toBe('Safari on iOS');
    expect(
      deviceLabelFromUserAgent(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      ),
    ).toBe('Chrome on macOS');
    expect(
      deviceLabelFromUserAgent('Mozilla/5.0 (X11; Linux x86_64) Gecko/20100101 Firefox/121.0'),
    ).toBe('Firefox on Linux');
  });

  it('prefers the specific brand for UAs that also claim Chrome or Safari', () => {
    // Edge and Opera both carry "Chrome" in their UA, and Chrome carries
    // "Safari" — the ordering in the mapper is what keeps these honest.
    expect(
      deviceLabelFromUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
      ),
    ).toBe('Edge on Windows');
    expect(
      deviceLabelFromUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36 OPR/106.0.0.0',
      ),
    ).toBe('Opera on Windows');
  });

  it('degrades rather than throwing on a null, empty or unrecognised user agent', () => {
    expect(deviceLabelFromUserAgent(null)).toBe('Unknown device');
    expect(deviceLabelFromUserAgent('')).toBe('Unknown device');
    expect(deviceLabelFromUserAgent('curl/8.4.0')).toBe('Unknown device');
  });

  it('falls back to whichever half it can identify', () => {
    expect(deviceLabelFromUserAgent('Firefox/121.0')).toBe('Firefox');
    expect(deviceLabelFromUserAgent('SomeBot (Windows NT 10.0)')).toBe('Windows');
  });
});

describe('savePushSubscription', () => {
  it('upserts on endpoint, reassigning userId and clearing disabledAt', () => {
    prismaMock.pushSubscription.upsert.mockResolvedValue(dbSubscription());

    return savePushSubscription('user-2', input, 'Mozilla/5.0 Firefox/121.0').then(() => {
      const args = prismaMock.pushSubscription.upsert.mock.calls[0][0];
      // endpoint, not (userId, endpoint): the same browser re-subscribing under a
      // second account must take the row over, not collide on the unique index.
      expect(args.where).toEqual({ endpoint: input.endpoint });
      expect(args.update).toEqual({
        userId: 'user-2',
        p256dh: 'BPublicKey',
        auth: 'AuthSecret',
        userAgent: 'Mozilla/5.0 Firefox/121.0',
        disabledAt: null,
      });
      expect(args.create).toEqual({
        userId: 'user-2',
        endpoint: input.endpoint,
        p256dh: 'BPublicKey',
        auth: 'AuthSecret',
        userAgent: 'Mozilla/5.0 Firefox/121.0',
      });
    });
  });

  it('returns a frontend shape that never carries the push keys', async () => {
    prismaMock.pushSubscription.upsert.mockResolvedValue(dbSubscription());

    const result = await savePushSubscription('user-1', input, null);

    expect(result).toEqual({
      id: 'sub-1',
      endpoint: input.endpoint,
      label: 'Chrome on Android',
      createdAt: new Date('2026-03-01T10:00:00.000Z').toISOString(),
      lastUsedAt: null,
      expired: false,
    });
    expect('p256dh' in result).toBe(false);
    expect('auth' in result).toBe(false);
  });

  it('stores a null userAgent when the request carried none', async () => {
    prismaMock.pushSubscription.upsert.mockResolvedValue(dbSubscription({ userAgent: null }));

    const result = await savePushSubscription('user-1', input, null);

    expect(prismaMock.pushSubscription.upsert.mock.calls[0][0].create.userAgent).toBeNull();
    expect(result.label).toBe('Unknown device');
  });
});

describe('deletePushSubscription', () => {
  it('scopes the delete to the caller, so one user cannot unsubscribe another’s device', async () => {
    prismaMock.pushSubscription.deleteMany.mockResolvedValue({ count: 1 });

    const result = await deletePushSubscription('user-1', input.endpoint);

    expect(prismaMock.pushSubscription.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', endpoint: input.endpoint },
    });
    expect(result).toEqual({ removed: 1 });
  });

  it('no-ops on an unknown endpoint instead of throwing', async () => {
    prismaMock.pushSubscription.deleteMany.mockResolvedValue({ count: 0 });

    await expect(deletePushSubscription('user-1', 'https://example.com/unknown')).resolves.toEqual({
      removed: 0,
    });
  });

  it('no-ops on a repeat unsubscribe of the same endpoint', async () => {
    prismaMock.pushSubscription.deleteMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    await deletePushSubscription('user-1', input.endpoint);
    await expect(deletePushSubscription('user-1', input.endpoint)).resolves.toEqual({ removed: 0 });
  });
});

describe('listPushSubscriptions', () => {
  it('lists the caller’s devices newest first, flagging expired ones', async () => {
    prismaMock.pushSubscription.findMany.mockResolvedValue([
      dbSubscription({ id: 'sub-1', lastUsedAt: new Date('2026-03-05T08:00:00.000Z') }),
      dbSubscription({
        id: 'sub-2',
        endpoint: 'https://fcm.googleapis.com/fcm/send/def456',
        disabledAt: new Date('2026-03-04T08:00:00.000Z'),
        userAgent: null,
      }),
    ]);

    const result = await listPushSubscriptions('user-1');

    expect(prismaMock.pushSubscription.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      orderBy: { createdAt: 'desc' },
    });
    expect(result[0].expired).toBe(false);
    expect(result[0].lastUsedAt).toBe(new Date('2026-03-05T08:00:00.000Z').toISOString());
    // Expired devices stay listed so the user can see and remove them.
    expect(result[1].expired).toBe(true);
    expect(result[1].label).toBe('Unknown device');
  });

  it('returns an empty list rather than null when nothing is registered', async () => {
    prismaMock.pushSubscription.findMany.mockResolvedValue([]);
    await expect(listPushSubscriptions('user-1')).resolves.toEqual([]);
  });
});

describe('listPushTargets', () => {
  it('returns only non-expired devices, with the raw keys the send path needs', async () => {
    prismaMock.pushSubscription.findMany.mockResolvedValue([
      { id: 'sub-1', endpoint: input.endpoint, p256dh: 'BPublicKey', auth: 'AuthSecret' },
    ]);

    const result = await listPushTargets('user-1');

    expect(prismaMock.pushSubscription.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', disabledAt: null },
      select: { id: true, endpoint: true, p256dh: true, auth: true },
    });
    expect(result[0].auth).toBe('AuthSecret');
  });
});

describe('markPushSubscriptionExpired / touchPushSubscription', () => {
  it('soft-flags an expired endpoint rather than deleting the row', async () => {
    prismaMock.pushSubscription.update.mockResolvedValue(dbSubscription());

    await markPushSubscriptionExpired('sub-1');

    expect(prismaMock.pushSubscription.update).toHaveBeenCalledWith({
      where: { id: 'sub-1' },
      data: { disabledAt: expect.any(Date) },
    });
  });

  it('records lastUsedAt at the tick instant, not at an arbitrary wall clock', async () => {
    prismaMock.pushSubscription.update.mockResolvedValue(dbSubscription());
    const now = new Date('2026-03-10T13:00:00.000Z');

    await touchPushSubscription('sub-1', now);

    expect(prismaMock.pushSubscription.update).toHaveBeenCalledWith({
      where: { id: 'sub-1' },
      data: { lastUsedAt: now },
    });
  });
});
