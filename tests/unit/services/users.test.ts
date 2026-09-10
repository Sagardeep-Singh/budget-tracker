import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    category: {
      createMany: vi.fn(),
      findMany: vi.fn(),
    },
    categoryRule: {
      createMany: vi.fn(),
    },
    account: {
      create: vi.fn(),
    },
  },
}));

vi.mock('@/lib/db/prisma', () => ({ prisma: prismaMock }));

const { createUser, findOrCreateGoogleUser, userHasPassword } =
  await import('@/lib/services/users');
const { ServiceValidationError } = await import('@/lib/services/common');
const { DEFAULT_CATEGORIES } = await import('@/lib/services/defaults');

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.category.findMany.mockResolvedValue(
    DEFAULT_CATEGORIES.map((name, i) => ({ id: `cat-${i}`, name })),
  );
});

describe('createUser', () => {
  it('rejects a duplicate email', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'existing' });

    await expect(
      createUser({ name: 'Jane', email: 'jane@example.com', password: 'a-long-enough-password' }),
    ).rejects.toThrow(ServiceValidationError);
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it('hashes the password and creates the user with no prepopulated data', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.user.create.mockResolvedValue({ id: 'user-1' });

    const result = await createUser({
      name: 'Jane',
      email: 'jane@example.com',
      password: 'a-long-enough-password',
    });

    expect(result).toEqual({ id: 'user-1' });

    const [createArg] = prismaMock.user.create.mock.calls[0];
    expect(createArg.data.email).toBe('jane@example.com');
    expect(createArg.data.name).toBe('Jane');
    expect(createArg.data.passwordHash).not.toBe('a-long-enough-password');

    expect(prismaMock.category.createMany).not.toHaveBeenCalled();
    expect(prismaMock.categoryRule.createMany).not.toHaveBeenCalled();
    expect(prismaMock.account.create).not.toHaveBeenCalled();
  });
});

describe('findOrCreateGoogleUser', () => {
  it('returns the existing user', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'user-1' });

    const result = await findOrCreateGoogleUser('jane@example.com', 'Jane');

    expect(result).toEqual({ id: 'user-1' });
    expect(prismaMock.user.create).not.toHaveBeenCalled();
    expect(prismaMock.account.create).not.toHaveBeenCalled();
  });

  it('creates a password-less user on first sign-in with no prepopulated data', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.user.create.mockResolvedValue({ id: 'user-2' });

    const result = await findOrCreateGoogleUser('new@example.com', 'New Person');

    expect(result).toEqual({ id: 'user-2' });
    expect(prismaMock.user.create).toHaveBeenCalledWith({
      data: { email: 'new@example.com', name: 'New Person' },
    });
    expect(prismaMock.category.createMany).not.toHaveBeenCalled();
    expect(prismaMock.categoryRule.createMany).not.toHaveBeenCalled();
    expect(prismaMock.account.create).not.toHaveBeenCalled();
  });
});

describe('userHasPassword', () => {
  it('returns true when the user has a passwordHash', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ passwordHash: 'hashed' });

    await expect(userHasPassword('user-1')).resolves.toBe(true);
  });

  it('returns false for a Google-only user with no passwordHash', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ passwordHash: null });

    await expect(userHasPassword('user-1')).resolves.toBe(false);
  });

  it('returns false when the user does not exist', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);

    await expect(userHasPassword('missing')).resolves.toBe(false);
  });
});
