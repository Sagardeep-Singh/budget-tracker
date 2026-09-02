'use server';

import { signIn, signOut } from '@/auth';
import { AuthError } from 'next-auth';

export const signOutAction = async (): Promise<void> => {
  await signOut({ redirectTo: '/login' });
};

export const signInAction = async (
  _prevState: string | undefined,
  formData: FormData,
): Promise<string | undefined> => {
  try {
    await signIn('credentials', {
      email: formData.get('email'),
      password: formData.get('password'),
      redirectTo: '/dashboard',
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return 'Incorrect email or password.';
    }
    throw error;
  }
};
