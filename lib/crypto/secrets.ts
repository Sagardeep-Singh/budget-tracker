import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM encryption for provider API keys at rest.
 *
 * Deliberately outside `lib/services/` (same rationale as `lib/push/`): the
 * business-logic layer depends on a small, pure, synchronous interface with no
 * Prisma and no I/O, which is what keeps `lib/services/aiSettings.ts`
 * unit-testable and keeps the crypto surface auditable in one short file.
 *
 * Packing: `v1:<iv-b64>:<tag-b64>:<ciphertext-b64>` in one column. The version
 * prefix is what makes the rotation runbook writable — a `v2:` key can be
 * introduced and old blobs still read by prefix during the migration.
 *
 * AAD is the `userId`: a ciphertext blob copied into another user's row fails
 * authentication instead of decrypting, so a DB-write primitive is not a key-
 * theft primitive.
 *
 * `node:crypto` is not edge-safe — every route that reaches this path declares
 * `export const runtime = 'nodejs'`.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;
const VERSION_PREFIX = 'v1';

/** The master key is missing or unusable — the feature is off, not broken. */
export class SecretEncryptionUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecretEncryptionUnavailableError';
  }
}

/**
 * A stored blob could not be decrypted: malformed packing, wrong version,
 * wrong AAD, or a failed auth tag. Typed so callers never see a raw
 * `TypeError`/`RangeError` from a bad `Buffer.from`. Carries no ciphertext,
 * no plaintext and no key material in its message.
 */
export class SecretDecryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecretDecryptionError';
  }
}

/**
 * Mirrors `isPushConfigured()` / the `AUTH_GOOGLE_ID` idiom: an unset OR
 * malformed env var makes the feature invisible rather than crashing partway
 * through a write. A presence-only check here (the shape used to be
 * `Boolean(process.env.SECRET_ENCRYPTION_KEY)`) let a wrong-length/bad-base64
 * key report `available: true` in Settings, so a save would probe, succeed,
 * then throw unguarded from `encryptSecret` — an opaque 500 instead of the
 * documented 503. Validating shape here closes that off at the one place
 * every caller already checks before touching the crypto surface.
 */
export const isSecretEncryptionConfigured = (): boolean => {
  try {
    masterKey();
    return true;
  } catch {
    return false;
  }
};

const masterKey = (): Buffer => {
  const raw = process.env.SECRET_ENCRYPTION_KEY;
  if (!raw) {
    throw new SecretEncryptionUnavailableError('SECRET_ENCRYPTION_KEY is not configured');
  }
  let key: Buffer;
  try {
    key = Buffer.from(raw, 'base64');
  } catch {
    // Never echo the value itself.
    throw new SecretEncryptionUnavailableError('SECRET_ENCRYPTION_KEY is not valid base64');
  }
  if (key.length !== KEY_BYTES) {
    throw new SecretEncryptionUnavailableError(
      `SECRET_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes`,
    );
  }
  return key;
};

export const encryptSecret = (plaintext: string, aad: string): string => {
  const key = masterKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION_PREFIX,
    iv.toString('base64'),
    tag.toString('base64'),
    ciphertext.toString('base64'),
  ].join(':');
};

export const decryptSecret = (packed: string, aad: string): string => {
  const key = masterKey();
  const parts = packed.split(':');
  if (parts.length !== 4) {
    throw new SecretDecryptionError('Stored secret is not in the expected format');
  }
  const [version, ivB64, tagB64, ctB64] = parts;
  if (version !== VERSION_PREFIX) {
    throw new SecretDecryptionError(`Unsupported stored secret version "${version}"`);
  }

  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const ciphertext = Buffer.from(ctB64, 'base64');

  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    // The underlying error can carry OpenSSL detail; swallow it so nothing
    // derived from the key or the blob ever reaches a log or a response.
    throw new SecretDecryptionError('Stored secret could not be decrypted');
  }
};

/**
 * Display-only masking. Never crashes on a short input (the validator's 20-char
 * minimum makes that unreachable through the real save path, but this helper
 * must not be the thing that throws if it ever is).
 */
export const maskLast4 = (plaintext: string): string => {
  const last4 = plaintext.slice(-4);
  return `${'•'.repeat(8)}${last4}`;
};
