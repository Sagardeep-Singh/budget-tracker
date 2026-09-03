import { LoginForm } from '@/components/auth/login-form';
import { Card } from '@/components/ui/card';

const LoginPage = (): React.ReactElement => (
  <div className="w-full max-w-sm animate-[fade-up_0.3s_ease-out]">
    <div className="mb-8 text-center">
      <div className="font-display text-ink text-2xl font-semibold tracking-tight">Ledger</div>
      <p className="text-ink-muted mt-1 text-sm">Know where it went.</p>
    </div>
    <Card>
      <LoginForm />
    </Card>
  </div>
);

export default LoginPage;
