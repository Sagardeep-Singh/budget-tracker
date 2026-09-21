# Runbook — rotating `SECRET_ENCRYPTION_KEY`

`SECRET_ENCRYPTION_KEY` is the AES-256-GCM master key that `lib/crypto/secrets.ts`
uses to encrypt each user's BYOK provider API key at rest
(`UserAiSettings.encryptedApiKey`). It protects nothing else in the app.

**If you change it without migrating, every stored provider key becomes
unreadable.** Nothing else breaks — no financial data is affected — but every
user who had a key saved will see "Your saved API key could not be read. Save it
again in Settings." the next time they tap Suggest with AI.

Rotate when: the value leaked (shared logs, a committed `.env`, a compromised
host), or on whatever schedule your deploy policy sets.

---

## Option A — the simple one, and the one to reach for first

**Rotation = every user re-enters their key.**

The feature is opt-in, the blast radius is one settings panel, and no financial
data is involved. For a hobby deploy this is almost always the right trade.

1. Generate a new key: `openssl rand -base64 32`
2. Clear the stored ciphertexts so nobody is left holding an unreadable blob:

   ```sql
   DELETE FROM "UserAiSettings";
   ```

   This also clears each user's `disclosureAcceptedAt` and toggles, so they will
   re-review the data disclosure on their next save. That is correct, not a
   regression.

3. Set the new `SECRET_ENCRYPTION_KEY` in the deployment environment and
   redeploy (a Next.js server reads `process.env` at request time, but a running
   instance will not pick up a changed env var — a redeploy is required).
4. Tell users to re-save their key in Settings.

Do **not** skip step 2. Leaving old `v1:` blobs behind under a new master key
means every decrypt throws, which is a worse experience than an empty form.

---

## Option B — re-encrypt in place, no user action

Use this when you cannot ask users to re-enter keys. It relies on the `v1:`
version prefix in the packed format
(`v1:<iv-b64>:<tag-b64>:<ciphertext-b64>`), which exists precisely so two keys
can coexist during a migration.

1. Generate the new key: `openssl rand -base64 32`.
2. Set it as `SECRET_ENCRYPTION_KEY_NEXT` alongside the existing
   `SECRET_ENCRYPTION_KEY`, and redeploy (or run the script below on a host that
   has both, with production `DATABASE_URL`).
3. Add a `v2` branch to `lib/crypto/secrets.ts`: `decryptSecret` dispatches on
   the prefix (`v1` → `SECRET_ENCRYPTION_KEY`, `v2` → `SECRET_ENCRYPTION_KEY_NEXT`),
   and `encryptSecret` writes `v2:` using the new key. Ship that first — after
   this deploy, both old and new blobs read correctly.
4. Run a one-off migration script with `npx tsx`:

   ```ts
   // scripts/rotate-secret-key.ts — delete after the rotation completes
   import { prisma } from '@/lib/db/prisma';
   import { decryptSecret, encryptSecret } from '@/lib/crypto/secrets';

   const rows = await prisma.userAiSettings.findMany({
     select: { userId: true, encryptedApiKey: true },
   });

   for (const row of rows) {
     if (row.encryptedApiKey.startsWith('v2:')) continue; // already migrated
     let plaintext: string;
     try {
       plaintext = decryptSecret(row.encryptedApiKey, row.userId);
     } catch {
       // Log the userId only. Never the blob, never the plaintext.
       console.error(`skip: could not decrypt for ${row.userId}`);
       continue;
     }
     await prisma.userAiSettings.update({
       where: { userId: row.userId },
       // AAD is still the userId — it does not change across a rotation.
       data: { encryptedApiKey: encryptSecret(plaintext, row.userId) },
     });
   }
   ```

   Run it against a database snapshot first. Never log, print or write the
   decrypted value anywhere.

5. Verify: `SELECT count(*) FROM "UserAiSettings" WHERE "encryptedApiKey" NOT LIKE 'v2:%';`
   must be 0 (or equal to the number of rows you deliberately skipped).
6. Promote: set `SECRET_ENCRYPTION_KEY` to the new value, unset
   `SECRET_ENCRYPTION_KEY_NEXT`, revert the `v2` dispatch in
   `lib/crypto/secrets.ts` so `v2` is read with the (now-primary) key, redeploy.
7. Destroy the old key material.

---

## Notes

- The AAD is the `userId` and does not change during rotation. A blob is still
  bound to its row, so a rotation cannot be used to move a key between users.
- `verifiedAt` is deliberately left alone. A rotated key is still the same
  provider key; re-probing every user's key on rotation would burn quota for no
  benefit.
- There is no automated test for this procedure — it is an operational task a
  human runs, deliberately out of scope for the feature's test plan.
