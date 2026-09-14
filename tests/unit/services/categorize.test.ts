import { describe, expect, it } from 'vitest';
import { compileRuleMatcher, matchCategoryRule } from '@/lib/services/categorize';

describe('matchCategoryRule', () => {
  it('matches case-insensitively against payee/note text', () => {
    const rules = [{ categoryId: 'cat-groceries', matchText: 'whole foods', priority: 0 }];
    expect(matchCategoryRule(rules, 'WHOLE FOODS #123')).toBe('cat-groceries');
  });

  it('returns null when nothing matches', () => {
    expect(matchCategoryRule([], 'Some payee')).toBeNull();
  });

  it('lets the lowest priority number win when multiple rules match', () => {
    const rules = [
      { categoryId: 'cat-other', matchText: 'coffee', priority: 5 },
      { categoryId: 'cat-dining', matchText: 'coffee', priority: 1 },
    ];
    expect(matchCategoryRule(rules, 'Blue Bottle Coffee')).toBe('cat-dining');
  });

  it('ignores rules whose matchText does not appear', () => {
    const rules = [{ categoryId: 'cat-rent', matchText: 'landlord llc', priority: 0 }];
    expect(matchCategoryRule(rules, 'Grocery Store')).toBeNull();
  });

  it('treats a /pattern/ matchText as a regex', () => {
    const rules = [{ categoryId: 'cat-ride', matchText: '/^(uber|lyft)/i', priority: 0 }];
    expect(matchCategoryRule(rules, 'UBER *TRIP 8pm')).toBe('cat-ride');
    expect(matchCategoryRule(rules, 'Lyft ride home')).toBe('cat-ride');
    expect(matchCategoryRule(rules, 'Grocery store uber-ish name')).toBeNull();
  });
});

describe('compileRuleMatcher', () => {
  it('matches a literal case-insensitively', () => {
    expect(compileRuleMatcher('whole foods').test('WHOLE FOODS #123')).toBe(true);
  });

  it('matches a /pattern/ regex with its own flags, not forced case-insensitive', () => {
    const matcher = compileRuleMatcher('/^AMZN/');
    expect(matcher.test('AMZN Mktp US')).toBe(true);
    expect(matcher.test('amzn mktp us')).toBe(false);
  });

  it('respects an explicit i flag on a regex', () => {
    expect(compileRuleMatcher('/^amzn/i').test('AMZN Mktp US')).toBe(true);
  });

  it('falls back to a literal match — including the slashes — for an invalid regex', () => {
    // "/[/" doesn't compile (unterminated character class); it must not throw,
    // and falls back to literal substring matching of the whole string.
    const matcher = compileRuleMatcher('/[/');
    expect(() => matcher.test('anything')).not.toThrow();
    expect(matcher.test('a /[/ literally in the text')).toBe(true);
    expect(matcher.test('nothing here')).toBe(false);
  });

  it('does not treat a bare slash-containing string as a regex', () => {
    // no trailing slash, so this is a literal match for the text "AND/OR"
    expect(compileRuleMatcher('AND/OR').test('terms AND/OR conditions')).toBe(true);
  });
});
