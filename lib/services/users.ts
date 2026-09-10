import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db/prisma';
import { ServiceValidationError } from '@/lib/services/common';
import type { SignUpInput } from '@/lib/validators/signup';

const BCRYPT_ROUNDS = 12;

export const createUser = async (input: SignUpInput): Promise<{ id: string }> => {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) {
    throw new ServiceValidationError('An account with this email already exists.');
  }

  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
  const user = await prisma.user.create({
    data: { email: input.email, name: input.name, passwordHash },
  });

  return { id: user.id };
};

export const userHasPassword = async (userId: string): Promise<boolean> => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true },
  });
  return !!user?.passwordHash;
};

/**
 * Finds the user for a Google sign-in by email, provisioning a new
 * password-less account on first sign-in.
 */
export const findOrCreateGoogleUser = async (
  email: string,
  name: string | null,
): Promise<{ id: string }> => {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return { id: existing.id };
  }

  const user = await prisma.user.create({ data: { email, name } });
  return { id: user.id };
};
