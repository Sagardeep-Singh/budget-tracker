import { LoginForm } from '@/components/auth/login-form';
import { Ring } from '@/components/ui/ring';

const LoginPage = (): React.ReactElement => (
  <>
    <div className="bg-iris-soft flex flex-col justify-between p-14">
      <div className="font-display text-[19px] font-semibold">Ledger</div>
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
        <LoginForm />
      </div>
    </div>
  </>
);

export default LoginPage;
