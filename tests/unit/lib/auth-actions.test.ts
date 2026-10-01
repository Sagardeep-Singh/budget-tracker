import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  signInMock,
  headersMock,
  redirectMock,
  createUserMock,
  checkRateLimitMock,
  issueAndSendVerificationEmailMock,
  sendAccountExistsEmailMock,
  isEmailVerificationConfiguredMock,
} = vi.hoisted(() => ({
  signInMock: vi.fn(),
  headersMock: vi.fn(),
  redirectMock: vi.fn(),
  createUserMock: vi.fn(),
  checkRateLimitMock: vi.fn(),
  issueAndSendVerificationEmailMock: vi.fn(),
  sendAccountExistsEmailMock: vi.fn(),
  isEmailVerificationConfiguredMock: vi.fn(),
}));

vi.mock('@/auth', () => ({ signIn: signInMock, signOut: vi.fn() }));
vi.mock('next-auth', () => ({
  AuthError: class AuthError extends Error {},
  CredentialsSignin: class CredentialsSignin extends Error {},
}));
vi.mock('next/headers', () => ({ headers: headersMock }));
vi.mock('next/navigation', () => ({ redirect: redirectMock }));
vi.mock('@/lib/services/emailVerification', () => ({
  issueAndSendVerificationEmail: issueAndSendVerificationEmailMock,
  sendAccountExistsEmail: sendAccountExistsEmailMock,
  isEmailVerificationConfigured: isEmailVerificationConfiguredMock,
}));
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
  // The real redirect() throws NEXT_REDIRECT; mirror that so nothing after it runs.
  redirectMock.mockImplementation((url: string) => {
    throw new RedirectSignal(url);
  });
  isEmailVerificationConfiguredMock.mockReturnValue(true);
  checkRateLimitMock.mockResolvedValue(undefined);
});

class RedirectSignal extends Error {
  constructor(public readonly url: string) {
    super(`redirect ${url}`);
  }
}

const submit = async (fields: Record<string, string>): Promise<string> => {
  try {
    const result = await signUpAction(undefined, formData(fields));
    throw new Error(`expected a redirect, got ${String(result)}`);
  } catch (error) {
    if (error instanceof RedirectSignal) return error.url;
    throw error;
  }
};

describe('signUpAction', () => {
  const validFields = { name: 'A User', email: 'a@example.com', password: 'password123456' };

  it('checks the signup:ip rate limit before creating the user', async () => {
    createUserMock.mockResolvedValue({ id: 'user-1', created: true });

    await submit(validFields);

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

  it('sends a verification email for a new account and redirects to the neutral login banner', async () => {
    createUserMock.mockResolvedValue({ id: 'user-1', created: true });

    const url = await submit(validFields);

    expect(url).toBe('/login?signup=check-email');
    expect(issueAndSendVerificationEmailMock).toHaveBeenCalledWith('user-1', 'a@example.com');
    expect(sendAccountExistsEmailMock).not.toHaveBeenCalled();
    expect(signInMock).not.toHaveBeenCalled();
  });

  it('sends an account-exists notice for a taken email and gives the exact same response', async () => {
    createUserMock.mockResolvedValue({ id: 'existing', created: false });

    const url = await submit(validFields);

    expect(url).toBe('/login?signup=check-email');
    expect(sendAccountExistsEmailMock).toHaveBeenCalledWith('a@example.com');
    expect(issueAndSendVerificationEmailMock).not.toHaveBeenCalled();
    expect(signInMock).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    'still redirects the same way when the email send fails (created: %s)',
    async (created) => {
      createUserMock.mockResolvedValue({ id: 'u', created });
      issueAndSendVerificationEmailMock.mockRejectedValue(new Error('brevo down'));
      sendAccountExistsEmailMock.mockRejectedValue(new Error('brevo down'));

      expect(await submit(validFields)).toBe('/login?signup=check-email');
    },
  );

  it.each([true, false])(
    'uses the no-email banner when email is not configured (created: %s)',
    async (created) => {
      isEmailVerificationConfiguredMock.mockReturnValue(false);
      createUserMock.mockResolvedValue({ id: 'u', created });

      expect(await submit(validFields)).toBe('/login?signup=done');
    },
  );
});
