import { beforeEach, describe, expect, it, vi } from 'vitest';

const { signInMock, headersMock, createUserMock, checkRateLimitMock } = vi.hoisted(() => ({
  signInMock: vi.fn(),
  headersMock: vi.fn(),
  createUserMock: vi.fn(),
  checkRateLimitMock: vi.fn(),
}));

vi.mock('@/auth', () => ({ signIn: signInMock, signOut: vi.fn() }));
vi.mock('next-auth', () => ({
  AuthError: class AuthError extends Error {},
  CredentialsSignin: class CredentialsSignin extends Error {},
}));
vi.mock('next/headers', () => ({ headers: headersMock }));
vi.mock('@/lib/services/users', () => ({ createUser: createUserMock }));
vi.mock('@/lib/services/rateLimit', async () => {
  const actual = await vi.importActual<typeof import('@/lib/services/rateLimit')>(
    '@/lib/services/rateLimit',
  );
  return { ...actual, checkRateLimit: checkRateLimitMock };
});

const { signUpAction } = await import('@/lib/auth/actions');
const { RateLimitedError } = await import('@/lib/services/rateLimit');

const formData = (fields: Record<string, string>): FormData => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    data.set(key, value);
  }
  return data;
};

beforeEach(() => {
  vi.clearAllMocks();
  headersMock.mockResolvedValue(new Headers({ 'x-forwarded-for': '1.2.3.4' }));
});

describe('signUpAction', () => {
  const validFields = { name: 'A User', email: 'a@example.com', password: 'password123456' };

  it('checks the signup:ip rate limit before creating the user', async () => {
    checkRateLimitMock.mockResolvedValue(undefined);
    createUserMock.mockResolvedValue({ id: 'user-1' });
    signInMock.mockResolvedValue(undefined);

    await signUpAction(undefined, formData(validFields));

    expect(checkRateLimitMock).toHaveBeenCalledWith('signup:ip', '1.2.3.4', 5, 60 * 60 * 1000);
    const rateLimitCallOrder = checkRateLimitMock.mock.invocationCallOrder[0];
    const createUserCallOrder = createUserMock.mock.invocationCallOrder[0];
    expect(rateLimitCallOrder).toBeLessThan(createUserCallOrder);
  });

  it('returns a friendly message and never creates a user when the IP is rate limited', async () => {
    checkRateLimitMock.mockRejectedValue(new RateLimitedError(60_000));

    const result = await signUpAction(undefined, formData(validFields));

    expect(result).toBe('Too many attempts. Try again in a few minutes.');
    expect(createUserMock).not.toHaveBeenCalled();
  });
});
