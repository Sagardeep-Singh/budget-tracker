import Link from 'next/link';
import { LoginForm } from '@/components/auth/login-form';
import { GoogleSignInButton } from '@/components/auth/google-sign-in-button';
import { LogoMark } from '@/components/ui/logo-mark';
import { Ring } from '@/components/ui/ring';
import { DEMO_EMAIL, DEMO_PASSWORD } from '@/prisma/demo-seed';
import { isDemoEnabled } from '@/lib/flags';

const googleConfigured = Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);

const LoginPage = async ({
  searchParams,
}: {
  searchParams: Promise<{ passwordChanged?: string }>;
}): Promise<React.ReactElement> => {
  const [{ passwordChanged }, demoEnabled] = await Promise.all([searchParams, isDemoEnabled()]);

  return (
    <>
      <div className="bg-iris-soft flex flex-col justify-between p-14">
        <div className="font-display flex items-center gap-2 text-[19px] font-semibold">
          <LogoMark size={24} variant="bare" />
          Ledger
        </div>
        <div>
          <Ring size="hero" fraction={0.56} />
          <h1 className="font-display mt-7 max-w-[400px] text-[34px] leading-[1.15] font-semibold tracking-[-0.025em]">
            Know what&rsquo;s left, not just what&rsquo;s gone.
          </h1>
          <p className="text-ink/75 mt-3.5 max-w-[420px] text-[15px] leading-snug">
            Import a statement, confirm a few categories, and Ledger keeps the rest of the month
            honest.
          </p>
        </div>
        <div className="text-ink/60 text-[12.5px]">
          Your data stays in your account. No bank credentials are stored.
        </div>
      </div>
      <div className="flex items-center justify-center p-14">
        <div className="w-full max-w-[360px] animate-[fade-up_0.3s_ease-out]">
          <h2 className="font-display text-2xl font-semibold tracking-[-0.02em]">Sign in</h2>
          <p className="text-ink-muted mt-2 mb-6.5 text-[13.5px]">Welcome back.</p>
          {passwordChanged === '1' && (
            <p className="bg-sky-soft text-sky mb-4 rounded-lg px-3 py-2 text-sm" role="status">
              Password changed. Sign in with your new password.
            </p>
          )}
          {demoEnabled && (
            <div className="bg-sky-soft text-sky mb-4 rounded-lg px-3 py-2.5 text-sm">
              <p className="font-medium">Just want to look around?</p>
              <p className="mt-0.5 text-[13px]">
                Sign in with the demo account — email{' '}
                <span className="font-mono">{DEMO_EMAIL}</span>, password{' '}
                <span className="font-mono">{DEMO_PASSWORD}</span>. Its data resets on a schedule,
                so don&rsquo;t keep anything you want to save.
              </p>
            </div>
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
    </>
  );
};

export default LoginPage;
