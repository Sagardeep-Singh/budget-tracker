import type { NextAuthConfig } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import Google from 'next-auth/providers/google';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db/prisma';
import { findOrCreateGoogleUser } from '@/lib/services/users';

const googleClientId = process.env.AUTH_GOOGLE_ID;
const googleClientSecret = process.env.AUTH_GOOGLE_SECRET;

export const authConfig: NextAuthConfig = {
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
  providers: [
    ...(googleClientId && googleClientSecret
      ? [Google({ clientId: googleClientId, clientSecret: googleClientSecret })]
      : []),
    Credentials({
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      authorize: async (credentials) => {
        const email = credentials?.email;
        const password = credentials?.password;
        if (typeof email !== 'string' || typeof password !== 'string') {
          return null;
        }

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user || !user.passwordHash) {
          return null;
        }

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) {
          return null;
        }

        return { id: user.id, email: user.email, name: user.name };
      },
    }),
  ],
  callbacks: {
    jwt: async ({ token, user, account }) => {
      if (user) {
        if (account?.provider === 'google') {
          if (!user.email) return token;
          const dbUser = await findOrCreateGoogleUser(user.email, user.name ?? null);
          token.userId = dbUser.id;
          // Marks this token as having just completed a live, interactive
          // Google sign-in — including a re-sign-in triggered by
          // `reauthenticateWithGoogleAction`'s `prompt: 'login'`, which is
          // exactly the same code path. Read by account deletion for a
          // Google-only user as its live-credential proof, in place of
          // `currentPassword` (see lib/services/accountDeletion.ts).
          token.reauthenticatedAt = Date.now();
        } else {
          token.userId = user.id;
        }
        token.name = user.name ?? token.name;
      }
      // Deleting an account must take effect everywhere immediately, not
      // just for the tab that did the deleting — this is the one callback
      // upstream of every route's own `if (!session?.user)` guard and the
      // protected layout's redirect, so a `null` here fires all of them
      // with zero changes to ~20 existing route handlers. No `checkedAt`
      // throttle: caching this for even a minute would let a deleted user's
      // other devices keep working past the atomic delete they're supposed
      // to be locked out of immediately.
      //
      // Skipped when `user` was just set above: sign-in/sign-up already
      // loaded or created that row in this same request, so re-checking its
      // existence a line later would be a pointless second lookup — only
      // subsequent reads (no `user` on this call) need it.
      if (!user && token.userId) {
        const exists = await prisma.user.findUnique({
          where: { id: token.userId as string },
          select: { id: true },
        });
        if (!exists) return null;
      }
      return token;
    },
    session: ({ session, token }) => {
      if (session.user) {
        session.user.id = token.userId as string;
        session.user.name = (token.name as string | null) ?? session.user.name;
        session.user.reauthenticatedAt = (token.reauthenticatedAt as number | undefined) ?? null;
      }
      return session;
    },
  },
};
