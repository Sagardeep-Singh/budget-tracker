import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db/prisma';
import { ServiceValidationError } from '@/lib/services/common';
import { provisionDefaultsForUser } from '@/lib/services/defaults';
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

  await provisionDefaultsForUser(user.id);

  return { id: user.id };
};

/**
 * Finds the user for a Google sign-in by email, provisioning a new
 * password-less account (plus starter data) on first sign-in.
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
  await provisionDefaultsForUser(user.id);
  return { id: user.id };
};
