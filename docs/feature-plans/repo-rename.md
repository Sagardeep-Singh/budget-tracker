# Rename the repo and Vercel project to track-a-loonie

## Status: deferred (planned for later)

## Goal

Finish the Track a Loonie rename by moving the GitHub repo from
`Sagardeep-Singh/budget-tracker` to `Sagardeep-Singh/track-a-loonie`, and the npm
package name from `budget-tracker` to `track-a-loonie`. The user-facing rename
has already shipped. This is the plumbing that's left.

Deferred so it doesn't land on top of open PRs or a deploy. Pick a quiet
window with no open PRs, or as few as possible.

## What GitHub handles for us

- Renaming a repo keeps issues, PRs, stars and history.
- The old URL redirects (web, `git clone`, `git fetch`, `git push`) **as long
  as no new repo is ever created at the old name**. Treat the redirect as a
  safety net, not the plan: update every reference anyway.
- Open PRs keep working. Their branches move with the repo.

## What we have to change

| Where                                | Current                                        | After                                                                                                 |
| ------------------------------------ | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| GitHub repo name                     | `budget-tracker`                               | `track-a-loonie`                                                                                      |
| `lib/http/sourceUrl.ts`              | `UPSTREAM_SOURCE_URL` points at budget-tracker | points at `.../track-a-loonie`                                                                        |
| `tests/unit/lib/sourceUrl.test.ts`   | expects the budget-tracker URL                 | expects the track-a-loonie URL                                                                        |
| `package.json` / `package-lock.json` | `"name": "budget-tracker"`                     | `"name": "track-a-loonie"` (regenerate lock with `npm install`, never by hand)                        |
| `SOURCE_CODE_URL` in Vercel          | set? (check)                                   | update if it's set to the old URL                                                                     |
| Vercel project                       | Git connection to budget-tracker               | rename the project to `track-a-loonie`; confirm the Git link follows the repo rename (re-link if not) |
| Marketing site (separate repo)       | `SOURCE_URL` env var                           | the new repo URL                                                                                      |
| Local clones                         | `origin` → budget-tracker                      | `git remote set-url origin https://github.com/Sagardeep-Singh/track-a-loonie.git`                     |

Out of scope (leave as is):

- The local database name `budget` in `.env.example`. It's a local dev
  detail, and renaming it forces everyone to recreate their database.
- Old feature plans that mention `budget-tracker` in historical paths
  (`ledger-redesign.md`, `credit-card-statement-cycle.md`).
- Any Prisma schema or migration change. None is needed.

## Checklist

- [ ] **Prep.** Merge or close open PRs where possible. Note any that will
      stay open across the rename.
- [ ] **Check external hooks.** List everything connected to the repo:
      Vercel project, GitHub Actions secrets (they carry over), webhooks,
      the Claude GitHub App install, any badges or links in other places.
- [ ] **Code PR (before the rename, merged right after).** Update
      `UPSTREAM_SOURCE_URL`, its unit test, and `package.json` name, then run
      `npm install` to regenerate `package-lock.json`. Run
      `npm run format:fix && npm run lint` and `npm run test`.
- [ ] **Rename on GitHub.** Settings → General → Repository name →
      `track-a-loonie`.
- [ ] **Merge the code PR** so the in-app "Source code" link points at the new
      URL directly instead of relying on the redirect.
- [ ] **Vercel.** Rename the project to `track-a-loonie` (Project
      Settings → General). Then check:
  - the Git connection still deploys from `main` (re-link if not)
  - the production custom domain is still attached
  - if the app relies on the `*.vercel.app` URL anywhere (`NEXTAUTH_URL`,
    Google OAuth redirect URIs, email links via
    `VERCEL_PROJECT_PRODUCTION_URL`), that the new URL is added everywhere
    before the old one stops resolving
  - env vars are unchanged, and `SOURCE_CODE_URL` is updated if it's set
- [ ] **Local clones.** Run `git remote set-url origin ...` on every machine,
      then `git fetch` to confirm.
- [ ] **Marketing site.** Point `SOURCE_URL` at the new repo, if the site
      exists by then.
- [ ] **Verify.** The in-app "Source code" link opens the new URL, CI runs on
      a fresh PR, and a production deploy succeeds.

## Risks

- **Someone creates a repo at the old name** (for example, a fork renamed
  back). That breaks the redirect. Updating all references first avoids
  depending on it.
- **Vercel URL changes with the project name.** Anything pointing at the old
  `*.vercel.app` address (OAuth callbacks, verification emails, bookmarks)
  can break. A custom domain avoids this; check before renaming.
- **Vercel loses the Git link.** Production keeps serving the last deploy, but
  new pushes won't deploy until it's re-linked. Check right after the rename.
- **Forks.** They keep their own names and aren't affected. AGPL forks set
  their own `SOURCE_CODE_URL`.

## Decisions

- Repo, npm package and Vercel project are all named `track-a-loonie`.
