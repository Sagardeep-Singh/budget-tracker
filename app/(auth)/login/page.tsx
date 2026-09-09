import { LoginForm } from '@/components/auth/login-form';
import { Card } from '@/components/ui/card';

const LoginPage = async ({
  searchParams,
}: {
  searchParams: Promise<{ passwordChanged?: string }>;
}): Promise<React.ReactElement> => {
  const { passwordChanged } = await searchParams;

  return (
    <div className="w-full max-w-sm animate-[fade-up_0.3s_ease-out]">
      <div className="mb-8 text-center">
        <div className="font-display text-ink text-2xl font-semibold tracking-tight">Ledger</div>
        <p className="text-ink-muted mt-1 text-sm">Know where it went.</p>
      </div>
      <Card>
        {passwordChanged === '1' && (
          <p className="bg-sky-soft text-sky mb-4 rounded-lg px-3 py-2 text-sm" role="status">
            Password changed. Sign in with your new password.
          </p>
        )}
        <LoginForm />
      </Card>
    </div>
  );
};

export default LoginPage;
