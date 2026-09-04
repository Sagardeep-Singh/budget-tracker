'use client';

import { useActionState } from 'react';
import { signInAction } from '@/lib/auth/actions';
import { Input, Label } from '@/components/ui/field';

export const LoginForm = (): React.ReactElement => {
  const [error, formAction, pending] = useActionState(signInAction, undefined);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div>
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          required
          autoFocus
          autoComplete="email"
          className="rounded-[10px]"
          placeholder="you@example.com"
        />
      </div>
      <div>
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className="rounded-[10px]"
        />
      </div>
      {error && (
        <p className="bg-rose-soft text-rose rounded-lg px-3 py-2 text-sm" role="alert">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="bg-iris text-paper-raised mt-2 w-full rounded-full py-3.5 text-[15px] font-semibold disabled:opacity-50"
      >
        {pending ? 'Signing in…' : 'Continue'}
      </button>
    </form>
  );
};
