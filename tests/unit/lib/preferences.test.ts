import { describe, expect, it } from 'vitest';
import { isAppearance, isPalette } from '@/lib/preferences';

describe('isPalette', () => {
  it('accepts known palette values', () => {
    expect(isPalette('clay')).toBe(true);
    expect(isPalette('cobalt')).toBe(true);
    expect(isPalette('iris')).toBe(true);
  });

  it('rejects unknown or missing values', () => {
    expect(isPalette('teal')).toBe(false);
    expect(isPalette(null)).toBe(false);
  });
});

describe('isAppearance', () => {
  it('accepts known appearance values', () => {
    expect(isAppearance('system')).toBe(true);
    expect(isAppearance('light')).toBe(true);
    expect(isAppearance('dark')).toBe(true);
  });

  it('rejects unknown or missing values', () => {
    expect(isAppearance('midnight')).toBe(false);
    expect(isAppearance(null)).toBe(false);
  });
});
