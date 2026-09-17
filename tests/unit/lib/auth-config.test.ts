import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock, findOrCreateGoogleUserMock } = vi.hoisted(() => ({
  prismaMock: { user: { findUnique: vi.fn() } },
  findOrCreateGoogleUserMock: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/services/users', () => ({ findOrCreateGoogleUser: findOrCreateGoogleUserMock }));

const { authConfig } = await import('@/lib/auth/config');

beforeEach(() => {
  vi.clearAllMocks();
});

const jwt = authConfig.callbacks!.jwt!;
const session = authConfig.callbacks!.session!;

describe('jwt callback', () => {
  it('sets reauthenticatedAt on a fresh Google sign-in', async () => {
    findOrCreateGoogleUserMock.mockResolvedValue({ id: 'user-1' });
    const before = Date.now();

    const token = await jwt({
      token: {},
      user: { email: 'a@example.com', name: 'A' },
      account: { provider: 'google' },
    } as never);

    expect(token).not.toBeNull();
    expect((token as { userId: string }).userId).toBe('user-1');
    expect((token as { reauthenticatedAt: number }).reauthenticatedAt).toBeGreaterThanOrEqual(
      before,
    );
    // A fresh sign-in already loaded the user via findOrCreateGoogleUser —
    // the stale-user existence check must not fire a redundant lookup.
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });

  it('does not set reauthenticatedAt for a credentials sign-in', async () => {
    const token = await jwt({
      token: {},
      user: { id: 'user-2', email: 'b@example.com', name: 'B' },
      account: { provider: 'credentials' },
    } as never);

    expect((token as { userId: string }).userId).toBe('user-2');
    expect((token as { reauthenticatedAt?: number }).reauthenticatedAt).toBeUndefined();
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });

  it('leaves an existing reauthenticatedAt untouched on a subsequent, non-sign-in call', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'user-1' });

    const token = await jwt({
      token: { userId: 'user-1', reauthenticatedAt: 12345 },
      user: undefined,
      account: null,
    } as never);

    expect((token as { reauthenticatedAt: number }).reauthenticatedAt).toBe(12345);
    // No `user` on this call: it's a token refresh, not a sign-in, so the
    // stale-existence check is the one that must run.
    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      select: { id: true },
    });
  });

  it('returns null for a token whose user no longer exists', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);

    const token = await jwt({
      token: { userId: 'deleted-user' },
      user: undefined,
      account: null,
    } as never);

    expect(token).toBeNull();
  });
});

describe('session callback', () => {
  it('exposes reauthenticatedAt from the token', async () => {
    const result = (await session({
      session: { user: { id: '', email: null, name: null }, expires: '' },
      token: { userId: 'user-1', reauthenticatedAt: 999 },
    } as never)) as { user: { reauthenticatedAt: number | null } };

    expect(result.user.reauthenticatedAt).toBe(999);
  });

  it('exposes null when the token has no reauthenticatedAt (credentials session)', async () => {
    const result = (await session({
      session: { user: { id: '', email: null, name: null }, expires: '' },
      token: { userId: 'user-2' },
    } as never)) as { user: { reauthenticatedAt: number | null } };

    expect(result.user.reauthenticatedAt).toBeNull();
  });
});
