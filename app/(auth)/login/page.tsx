import Link from 'next/link';
import { LoginForm } from '@/components/auth/login-form';
import { GoogleSignInButton } from '@/components/auth/google-sign-in-button';
import { LogoMark } from '@/components/ui/logo-mark';
import { Ring } from '@/components/ui/ring';

const googleConfigured = Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);

const VERIFY_MESSAGES: Record<string, { text: string; tone: 'success' | 'error' }> = {
  verified: { text: 'Email verified. Thanks!', tone: 'success' },
  invalid: { text: "That verification link isn't valid.", tone: 'error' },
  expired: {
    text: 'That verification link expired — request a new one from Settings.',
    tone: 'error',
  },
};

const LoginPage = async ({
  searchParams,
}: {
  searchParams: Promise<{ passwordChanged?: string; verify?: string }>;
}): Promise<React.ReactElement> => {
  const { passwordChanged, verify } = await searchParams;
  const verifyMessage = verify ? VERIFY_MESSAGES[verify] : undefined;

  return (
    <>
      <div className="bg-iris-soft mx-5 mt-5 flex flex-col justify-between rounded-3xl p-6 lg:mx-0 lg:mt-0 lg:rounded-none lg:p-14">
        <div className="font-display flex items-center gap-2.5 text-[20px] font-semibold">
          <LogoMark size={30} variant="spiral" />
          Ledger
        </div>
        <div>
          <div className="hidden lg:block">
            <Ring size="hero" fraction={0.56} />
          </div>
          <h1 className="font-display mt-[18px] max-w-[400px] text-[26px] leading-[1.15] font-semibold tracking-[-0.02em] lg:mt-7 lg:text-[34px]">
            Know what&rsquo;s left, not just what&rsquo;s gone.
          </h1>
          <p className="text-ink/75 mt-2.5 max-w-[420px] text-[13.5px] leading-snug lg:mt-3.5 lg:text-[15px]">
            Import a statement, confirm a few categories, and Ledger keeps the rest of the month
            honest.
          </p>
        </div>
        <div className="text-ink/60 mt-6 hidden text-[12.5px] lg:block">
          Your data stays in your account. No bank credentials are stored.
        </div>
      </div>
      <div className="flex flex-col px-6 py-8 lg:items-center lg:justify-center lg:p-14">
        <div className="w-full lg:max-w-[360px] lg:animate-[fade-up_0.3s_ease-out]">
          <h2 className="font-display text-2xl font-semibold tracking-[-0.02em]">Sign in</h2>
          <p className="text-ink-muted mt-2 mb-6.5 text-[13.5px]">Welcome back.</p>
          {passwordChanged === '1' && (
            <p className="bg-sky-soft text-sky mb-4 rounded-lg px-3 py-2 text-sm" role="status">
              Password changed. Sign in with your new password.
            </p>
          )}
          {verifyMessage && (
            <p
              className={`mb-4 rounded-lg px-3 py-2 text-sm ${
                verifyMessage.tone === 'success' ? 'bg-sky-soft text-sky' : 'bg-rose-soft text-rose'
              }`}
              role="status"
            >
              {verifyMessage.text}
            </p>
          )}
          <LoginForm />
          {googleConfigured && (
            <>
              <div className="text-ink-muted my-5 flex items-center gap-3 text-xs">
                <span className="bg-line h-px flex-1" />
                or
                <span className="bg-line h-px flex-1" />
              </div>
              <GoogleSignInButton label="Continue with Google" />
            </>
          )}
          <p className="text-ink-muted mt-6 text-center text-[13.5px]">
            New here?{' '}
            <Link href="/signup" className="text-iris font-medium">
              Create an account
            </Link>
          </p>
        </div>
      </div>
      <p className="text-ink-muted px-6 pb-8 text-center text-[12.5px] lg:hidden">
        Your data stays in your account. No bank credentials are stored.
      </p>
    </>
  );
};

export default LoginPage;
