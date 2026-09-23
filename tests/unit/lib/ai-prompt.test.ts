import { describe, expect, it } from 'vitest';

import {
  AI_SYSTEM_PROMPT,
  buildCategoryChoiceSchema,
  buildCategoryChoiceValues,
  buildSuggestionPayload,
} from '@/lib/ai/prompt';
import type { AiSuggestionRequest } from '@/lib/ai/types';

const CATEGORIES = [
  { id: 'cat-zzz', name: 'Zebra care' },
  { id: 'cat-aaa', name: 'Apples' },
];

const base = (overrides: Partial<AiSuggestionRequest> = {}): AiSuggestionRequest => ({
  payee: 'Blue Bottle Coffee',
  type: 'EXPENSE',
  categories: CATEGORIES,
  ...overrides,
});

describe('buildSuggestionPayload', () => {
  it('renders the payee, the type and one id<TAB>name line per category', () => {
    const { user } = buildSuggestionPayload(base());
    expect(user).toContain('Blue Bottle Coffee');
    expect(user).toContain('EXPENSE');
    expect(user).toContain('cat-zzz\tZebra care');
    expect(user).toContain('cat-aaa\tApples');
  });

  it('omits the note entirely when the caller did not opt in', () => {
    const { user, system } = buildSuggestionPayload(base());
    expect(user).not.toContain('unique-note-token');
    expect(user).not.toContain('Note:');
    expect(`${system}\n${user}`.toLowerCase()).not.toContain('"note"');
  });

  it('includes the note verbatim when the caller opted in', () => {
    const { user } = buildSuggestionPayload(base({ note: 'unique-note-token' }));
    expect(user).toContain('unique-note-token');
  });

  it('omits the amount unless present on the request', () => {
    expect(buildSuggestionPayload(base()).user).not.toContain('123.45');
    expect(buildSuggestionPayload(base({ amount: '123.45' })).user).toContain('123.45');
  });

  it('never renders a date, an account, a balance, or a queue flag', () => {
    const { system, user } = buildSuggestionPayload(
      base({ note: 'lunch with sam', amount: '42.00' }),
    );
    const everything = `${system}\n${user}`;
    for (const forbidden of [
      'isTransfer',
      'isPayment',
      'skippedAt',
      'accountId',
      'balance',
      'Account',
      '2026-',
    ]) {
      expect(everything).not.toContain(forbidden);
    }
  });

  it('returns categoryIds in input order, without the "none" sentinel', () => {
    expect(buildSuggestionPayload(base()).categoryIds).toEqual(['cat-zzz', 'cat-aaa']);
    expect(buildSuggestionPayload(base()).categoryIds).not.toContain('none');
  });

  it('handles a user with zero categories without throwing', () => {
    const { user, categoryIds } = buildSuggestionPayload(base({ categories: [] }));
    expect(categoryIds).toEqual([]);
    expect(user).toContain('the user has no categories');
  });

  it('keeps the caller-supplied category order — it never re-sorts', () => {
    const { user } = buildSuggestionPayload(base());
    expect(user.indexOf('cat-zzz')).toBeLessThan(user.indexOf('cat-aaa'));
  });
});

describe('AI_SYSTEM_PROMPT', () => {
  it('is a non-empty constant, identical across differing requests', () => {
    expect(AI_SYSTEM_PROMPT.length).toBeGreaterThan(0);
    const a = buildSuggestionPayload(base({ payee: 'A' }));
    const b = buildSuggestionPayload(base({ payee: 'B', note: 'x', amount: '1.00' }));
    expect(a.system).toBe(AI_SYSTEM_PROMPT);
    expect(a.system).toBe(b.system);
  });
});

describe('buildCategoryChoiceValues / buildCategoryChoiceSchema', () => {
  it('appends the "none" sentinel one layer above the prompt builder', () => {
    expect(buildCategoryChoiceValues(['a', 'b'])).toEqual(['a', 'b', 'none']);
    expect(buildCategoryChoiceValues([])).toEqual(['none']);
  });

  it('accepts the user ids and the sentinel, and rejects anything else', () => {
    const schema = buildCategoryChoiceSchema(['cat-aaa']);
    expect(schema.safeParse({ categoryId: 'cat-aaa' }).success).toBe(true);
    expect(schema.safeParse({ categoryId: 'none' }).success).toBe(true);
    expect(schema.safeParse({ categoryId: 'cat-somebody-else' }).success).toBe(false);
    expect(schema.safeParse({ categoryId: 42 }).success).toBe(false);
    expect(schema.safeParse('Food, probably').success).toBe(false);
  });
});
