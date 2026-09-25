'use client';

import { useState } from 'react';
import { Lock } from 'lucide-react';
import { signOutAfterPasswordChange } from '@/lib/auth/actions';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/field';
import { postJSON } from '@/lib/api-client';
import { MIN_PASSWORD_LENGTH } from '@/lib/validators/password';

export const ChangePasswordForm = (): React.ReactElement => {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setError(null);

    const form = new FormData(event.currentTarget);
    const currentPassword = String(form.get('currentPassword') ?? '');
    const newPassword = String(form.get('newPassword') ?? '');
    const confirmNewPassword = String(form.get('confirmNewPassword') ?? '');

    if (newPassword !== confirmNewPassword) {
      setError('New password and confirmation do not match.');
      return;
    }

    setPending(true);
    const res = await postJSON('/api/settings/password', { currentPassword, newPassword });

    if (!res.ok) {
      setPending(false);
      setError(
        res.networkError
          ? 'Could not reach the server. Check your connection and try again.'
          : (res.error ?? 'Could not change your password. Try again.'),
      );
      return;
    }

    // Redirect-throwing server action: must stay outside any try/catch, or the
    // thrown redirect gets swallowed and the user is stranded on this page.
    await signOutAfterPasswordChange();
  };

  return (
    <form onSubmit={handleSubmit} className="mt-3 flex flex-col gap-4">
      <div>
        <Label htmlFor="currentPassword">Current password</Label>
        <Input
          id="currentPassword"
          name="currentPassword"
          type="password"
          required
          autoComplete="current-password"
        />
      </div>
      <div>
        <Label htmlFor="newPassword">New password</Label>
        <Input
          id="newPassword"
          name="newPassword"
          type="password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          autoComplete="new-password"
        />
        <p className="text-ink-muted mt-1 text-xs">
          At least {MIN_PASSWORD_LENGTH} characters. You&rsquo;ll be signed out and asked to sign in
          again.
        </p>
      </div>
      <div>
        <Label htmlFor="confirmNewPassword">Confirm new password</Label>
        <Input
          id="confirmNewPassword"
          name="confirmNewPassword"
          type="password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          autoComplete="new-password"
        />
      </div>
      {error && (
        <p className="bg-rose-soft text-rose rounded-lg px-3 py-2 text-sm" role="alert">
          {error}
        </p>
      )}
      <Button type="submit" icon={Lock} loading={pending} className="self-start">
        Change password
      </Button>
    </form>
  );
};
