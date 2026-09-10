# Ledger

A small, honest personal budget tracker. Track accounts, log transactions (manually or via CSV
import), auto-categorize spend with your own rules, set monthly budgets per category, and see
where things stand.

Free to use — anyone can sign up with Google or an email/password/name and gets their own
isolated Ledger. Every service scopes its data by user, so accounts stay fully separate.

## Stack

Next.js App Router, TypeScript, Prisma + Postgres, NextAuth (credentials + Google), Tailwind
CSS v4, Zod, Vitest.

## Getting started

```bash
cp .env.example .env   # fill in DATABASE_URL, NEXTAUTH_SECRET
npm install
npm run db:setup       # prisma generate + migrate + seed (destructive, local dev only)
npm run dev
```

Create an account at `/signup` (name, email, password) or sign in at `/login`. "Continue with
Google" appears once `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` are set — see `.env.example` for how
to obtain them. A new sign-up starts with an empty dashboard — no starter categories, rules, or
accounts — you add your own.

For local development, `npm run db:setup` also seeds a known dev account from `ADMIN_EMAIL` /
`ADMIN_PASSWORD` in `.env`, prepopulated with sample categories/rules/an account for convenience
when testing — this isn't required for real usage, anyone can sign up from `/signup`.

For a production deploy: run `npm run prisma:deploy` to apply migrations. `npm run
prisma:bootstrap-admin` is optional — it seeds/updates one known account by email, useful for an
admin or demo login.

## Commands

See `CLAUDE.md` for the full command list and architecture notes.

## License

GPLv3 — see [LICENSE](./LICENSE).
