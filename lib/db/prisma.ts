import { PrismaClient } from '@prisma/client';

declare global {
  var __prisma: PrismaClient | undefined;
}

// On serverless hosts every warm instance opens its own connection pool, so a
// direct Postgres URL runs out of connections under load. Prefer the pooled
// URL when one is set (the Vercel Prisma Postgres integration injects
// PRISMA_DATABASE_URL as a prisma+postgres:// Accelerate URL). DATABASE_URL
// stays the direct URL that the Prisma CLI uses for migrations.
const datasourceUrl = process.env.PRISMA_DATABASE_URL || process.env.DATABASE_URL;

// Cached on globalThis in every environment, not just dev: Next.js can load
// this module more than once per process (separate route bundles, dev HMR),
// and each load would otherwise open another pool.
export const prisma: PrismaClient = global.__prisma ?? new PrismaClient({ datasourceUrl });

global.__prisma = prisma;
