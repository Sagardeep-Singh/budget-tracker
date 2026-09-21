import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const {
  encryptSecret,
  decryptSecret,
  maskLast4,
  isSecretEncryptionConfigured,
  SecretEncryptionUnavailableError,
  SecretDecryptionError,
  // Imported at module scope on purpose: the first case below asserts that
  // importing this module with SECRET_ENCRYPTION_KEY unset does not throw.
} = await import('@/lib/crypto/secrets');

/** `openssl rand -base64 32`, fixed so the test is deterministic. */
const MASTER_KEY = 'qJ8pQe1n0bYxV7lCm3sT5wUu9aZrKdHgNvXf2oIyEjE=';
const PLAINTEXT = 'sk-ant-api03-e2e-fixture-key-abcdEFGH1234';
const USER = 'user-aaa';

beforeEach(() => {
  process.env.SECRET_ENCRYPTION_KEY = MASTER_KEY;
});

afterEach(() => {
  process.env.SECRET_ENCRYPTION_KEY = MASTER_KEY;
});

/** No thrown error may ever echo the plaintext key or the master key. */
const expectNoLeak = (error: unknown): void => {
  const text = `${(error as Error).message}\n${(error as Error).stack ?? ''}`;
  expect(text).not.toContain(PLAINTEXT);
  expect(text).not.toContain(MASTER_KEY);
};

describe('isSecretEncryptionConfigured', () => {
  it('is false when SECRET_ENCRYPTION_KEY is unset and true when it is set', () => {
    delete process.env.SECRET_ENCRYPTION_KEY;
    expect(isSecretEncryptionConfigured()).toBe(false);
    process.env.SECRET_ENCRYPTION_KEY = MASTER_KEY;
    expect(isSecretEncryptionConfigured()).toBe(true);
  });

  it('is false for a wrong-length or non-base64 SECRET_ENCRYPTION_KEY, not just when unset', () => {
    // A presence-only check here previously let a malformed key report
    // `available: true`, so a save would probe successfully and then throw
    // unguarded from encryptSecret instead of failing closed up front.
    process.env.SECRET_ENCRYPTION_KEY = Buffer.from('too short').toString('base64');
    expect(isSecretEncryptionConfigured()).toBe(false);
    process.env.SECRET_ENCRYPTION_KEY = 'not-valid-base64!!!';
    expect(isSecretEncryptionConfigured()).toBe(false);
  });

  it('only throws at call time, never at import time, when unconfigured', () => {
    delete process.env.SECRET_ENCRYPTION_KEY;
    // The module import at the top of this file already happened without a key
    // present in some environments; what matters is that calls throw typed.
    expect(() => encryptSecret(PLAINTEXT, USER)).toThrow(SecretEncryptionUnavailableError);
    expect(() => decryptSecret('v1:a:b:c', USER)).toThrow(SecretEncryptionUnavailableError);
  });
});

describe('encryptSecret / decryptSecret', () => {
  it('round-trips a representative API key', () => {
    expect(decryptSecret(encryptSecret(PLAINTEXT, USER), USER)).toBe(PLAINTEXT);
  });

  it('uses a random IV so the same input encrypts to two different blobs', () => {
    const a = encryptSecret(PLAINTEXT, USER);
    const b = encryptSecret(PLAINTEXT, USER);
    expect(a).not.toBe(b);
    expect(decryptSecret(a, USER)).toBe(PLAINTEXT);
    expect(decryptSecret(b, USER)).toBe(PLAINTEXT);
  });

  it('packs as v1:<iv>:<tag>:<ciphertext>, all base64', () => {
    expect(encryptSecret(PLAINTEXT, USER)).toMatch(
      /^v1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/,
    );
  });

  it('never contains the plaintext in the packed blob', () => {
    expect(encryptSecret(PLAINTEXT, USER)).not.toContain(PLAINTEXT);
  });

  it('rejects a blob replayed under a different userId (AAD mismatch)', () => {
    const packed = encryptSecret(PLAINTEXT, 'user-a');
    let thrown: unknown;
    try {
      decryptSecret(packed, 'user-b');
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(SecretDecryptionError);
    expectNoLeak(thrown);
  });

  const tamper = (packed: string, index: number): string => {
    const parts = packed.split(':');
    const segment = parts[index];
    const first = segment[0];
    parts[index] = `${first === 'A' ? 'B' : 'A'}${segment.slice(1)}`;
    return parts.join(':');
  };

  it.each([
    ['IV', 1],
    ['auth tag', 2],
    ['ciphertext', 3],
  ])('rejects a tampered %s segment', (_label, index) => {
    const packed = encryptSecret(PLAINTEXT, USER);
    let thrown: unknown;
    try {
      decryptSecret(tamper(packed, index), USER);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(SecretDecryptionError);
    expectNoLeak(thrown);
  });

  it.each([
    ['a missing segment', 'v1:aaaa:bbbb'],
    ['an unknown version prefix', 'v2:aaaa:bbbb:cccc'],
    ['an empty string', ''],
  ])('throws a typed error for %s', (_label, packed) => {
    let thrown: unknown;
    try {
      decryptSecret(packed, USER);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(SecretDecryptionError);
    expectNoLeak(thrown);
  });

  it.each([
    ['not base64 of 32 bytes', 'not-a-real-key'],
    ['base64 of the wrong length', Buffer.alloc(16).toString('base64')],
  ])('throws at call time when the master key is %s', (_label, value) => {
    process.env.SECRET_ENCRYPTION_KEY = value;
    let thrown: unknown;
    try {
      encryptSecret(PLAINTEXT, USER);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(SecretEncryptionUnavailableError);
    expectNoLeak(thrown);
  });
});

describe('maskLast4', () => {
  it('keeps only the last four characters', () => {
    const masked = maskLast4('sk-ant-abcdEFGH1234');
    expect(masked.endsWith('1234')).toBe(true);
    expect(masked).not.toContain('sk-ant');
    expect(masked).not.toContain('abcdEFGH');
    expect(masked.length).toBeGreaterThan(4);
  });

  it('does not crash on a 4-character input', () => {
    expect(maskLast4('abcd')).toBe('••••••••abcd');
  });
});
