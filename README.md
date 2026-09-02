# Ledger

A small, honest personal budget tracker. Track accounts, log transactions (manually or via CSV
import), auto-categorize spend with your own rules, set monthly budgets per category, and see
where things stand.

Single-user by design — this is a personal tool, not a multi-tenant app.

## Stack

Next.js App Router, TypeScript, Prisma + Postgres, NextAuth (credentials), Tailwind CSS v4, Zod,
Vitest.

## Getting started

```bash
cp .env.example .env   # fill in DATABASE_URL, NEXTAUTH_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD
npm install
npm run db:setup       # prisma generate + migrate + seed (destructive, local dev only)
npm run dev
```

Sign in at `/login` with the `ADMIN_EMAIL` / `ADMIN_PASSWORD` you set. There's no self-signup —
this is the only account.

For a production deploy: run `npm run prisma:deploy` to apply migrations, then
`npm run prisma:bootstrap-admin` once (non-destructive) to create the account.

## Commands

See `CLAUDE.md` for the full command list and architecture notes.

## License

GPLv3 — see [LICENSE](./LICENSE).
