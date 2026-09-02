import { describe, expect, it } from 'vitest';
import { matchCategoryRule } from '@/lib/services/categorize';

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
});
