'use server';

import { signIn, signOut } from '@/auth';
import { AuthError } from 'next-auth';
import { createUser } from '@/lib/services/users';
import { signUpSchema } from '@/lib/validators/signup';
import { ServiceValidationError } from '@/lib/services/common';

export const signOutAction = async (): Promise<void> => {
  await signOut({ redirectTo: '/login' });
};

export const signOutAfterPasswordChange = async (): Promise<void> => {
  await signOut({ redirectTo: '/login?passwordChanged=1' });
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

export const signInWithGoogleAction = async (): Promise<void> => {
  await signIn('google', { redirectTo: '/dashboard' });
};

export const signUpAction = async (
  _prevState: string | undefined,
  formData: FormData,
): Promise<string | undefined> => {
  const parsed = signUpSchema.safeParse({
    name: formData.get('name'),
    email: formData.get('email'),
    password: formData.get('password'),
  });
  if (!parsed.success) {
    return parsed.error.issues[0]?.message ?? 'Check the form and try again.';
  }

  try {
    await createUser(parsed.data);
  } catch (error) {
    if (error instanceof ServiceValidationError) {
      return error.message;
    }
    throw error;
  }

  try {
    await signIn('credentials', {
      email: parsed.data.email,
      password: parsed.data.password,
      redirectTo: '/dashboard',
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return 'Account created — sign in from the login page.';
    }
    throw error;
  }
};
