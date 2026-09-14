import { describe, expect, it } from 'vitest';
import { createCategoryRuleSchema, invalidRuleRegexError } from '@/lib/validators/category-rules';

describe('invalidRuleRegexError', () => {
  it('returns null for a plain literal matchText', () => {
    expect(invalidRuleRegexError('whole foods')).toBeNull();
  });

  it('returns null for a valid /pattern/flags regex', () => {
    expect(invalidRuleRegexError('/^(uber|lyft)/i')).toBeNull();
  });

  it('returns an error message for an invalid regex', () => {
    expect(invalidRuleRegexError('/[/')).toMatch(/Invalid regular expression/);
  });

  it('does not flag a plain string that merely contains slashes', () => {
    expect(invalidRuleRegexError('AND/OR')).toBeNull();
  });

  it('rejects a nested-quantifier pattern as a ReDoS risk', () => {
    expect(invalidRuleRegexError('/(a+)+$/')).toMatch(/nested quantifiers/);
  });

  it('does not treat a literal path-like string as regex flags', () => {
    // "/home/user" back-matches body "home", flags "user" under a loose
    // [a-z]* flag group; restricting to real JS flags avoids that.
    expect(invalidRuleRegexError('/home/user')).toBeNull();
  });
});

describe('createCategoryRuleSchema', () => {
  const base = { categoryId: 'cat-1', matchText: 'whole foods', priority: 0 };

  it('accepts a valid regex matchText', () => {
    const result = createCategoryRuleSchema.safeParse({ ...base, matchText: '/^AMZN/i' });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid regex matchText with a clear message', () => {
    const result = createCategoryRuleSchema.safeParse({ ...base, matchText: '/[/' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(/Invalid regular expression/);
    }
  });

  it('accepts a matchText up to 300 characters', () => {
    const result = createCategoryRuleSchema.safeParse({ ...base, matchText: 'a'.repeat(300) });
    expect(result.success).toBe(true);
  });

  it('rejects a matchText over 300 characters', () => {
    const result = createCategoryRuleSchema.safeParse({ ...base, matchText: 'a'.repeat(301) });
    expect(result.success).toBe(false);
  });
});
