'use client';

import { useActionState } from 'react';
import { signInAction } from '@/lib/auth/actions';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/field';

export const LoginForm = (): React.ReactElement => {
  const [error, formAction, pending] = useActionState(signInAction, undefined);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div>
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" required autoFocus autoComplete="email" />
      </div>
      <div>
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
        />
      </div>
      {error && (
        <p className="bg-rose-soft text-rose rounded-lg px-3 py-2 text-sm" role="alert">
          {error}
        </p>
      )}
      <Button type="submit" disabled={pending} className="mt-2 w-full">
        {pending ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  );
};
