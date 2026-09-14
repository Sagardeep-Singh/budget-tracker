import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    categoryRule: { findMany: vi.fn(), createMany: vi.fn() },
    category: { findMany: vi.fn() },
    transaction: { findMany: vi.fn() },
  },
}));

vi.mock('@/lib/db/prisma', () => ({ prisma: prismaMock }));

const { listCategoryRules, exportCategoryRules, importCategoryRules } =
  await import('@/lib/services/categoryRules');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('listCategoryRules', () => {
  it('counts current transactions whose category and text both match the rule', async () => {
    prismaMock.categoryRule.findMany.mockResolvedValue([
      {
        id: 'r1',
        categoryId: 'cat-1',
        matchText: 'whole foods',
        priority: 0,
        category: { name: 'Groceries' },
      },
    ]);
    prismaMock.transaction.findMany.mockResolvedValue([
      { categoryId: 'cat-1', payee: 'Whole Foods #1', note: null },
      { categoryId: 'cat-1', payee: 'Whole Foods #2', note: null },
      // right category, but text doesn't match the rule — not counted
      { categoryId: 'cat-1', payee: 'Rent', note: null },
      // text matches, but a different category — not counted (user recategorized it)
      { categoryId: 'cat-2', payee: 'Whole Foods #3', note: null },
    ]);

    const result = await listCategoryRules('user-1');

    expect(result).toEqual([
      {
        id: 'r1',
        categoryId: 'cat-1',
        categoryName: 'Groceries',
        matchText: 'whole foods',
        priority: 0,
        appliedCount: 2,
      },
    ]);
  });

  it('applies a regex matchText, case-sensitively per its own flags', async () => {
    prismaMock.categoryRule.findMany.mockResolvedValue([
      {
        id: 'r1',
        categoryId: 'cat-1',
        matchText: '/^AMZN/',
        priority: 0,
        category: { name: 'Shopping' },
      },
    ]);
    prismaMock.transaction.findMany.mockResolvedValue([
      { categoryId: 'cat-1', payee: 'AMZN Mktp US', note: null },
      // lowercase — the pattern has no `i` flag, so this should NOT count
      { categoryId: 'cat-1', payee: 'amzn mktp us', note: null },
    ]);

    const result = await listCategoryRules('user-1');

    expect(result[0].appliedCount).toBe(1);
  });
});

describe('exportCategoryRules', () => {
  it('exports by category name, not id', async () => {
    prismaMock.categoryRule.findMany.mockResolvedValue([
      { matchText: 'whole foods', priority: 0, category: { name: 'Groceries' } },
      { matchText: '/^AMZN/i', priority: 1, category: { name: 'Shopping' } },
    ]);

    const result = await exportCategoryRules('user-1');

    expect(result).toEqual([
      { matchText: 'whole foods', categoryName: 'Groceries', priority: 0 },
      { matchText: '/^AMZN/i', categoryName: 'Shopping', priority: 1 },
    ]);
  });
});

describe('importCategoryRules', () => {
  beforeEach(() => {
    prismaMock.category.findMany.mockResolvedValue([
      { id: 'cat-1', name: 'Groceries' },
      { id: 'cat-2', name: 'Shopping' },
    ]);
    prismaMock.categoryRule.findMany.mockResolvedValue([]);
  });

  it('imports rows matched by category name, case-insensitively', async () => {
    const result = await importCategoryRules('user-1', [
      { matchText: 'whole foods', categoryName: 'groceries', priority: 0 },
    ]);

    expect(result).toEqual({ imported: 1, skipped: [] });
    expect(prismaMock.categoryRule.createMany).toHaveBeenCalledWith({
      data: [{ userId: 'user-1', categoryId: 'cat-1', matchText: 'whole foods', priority: 0 }],
    });
  });

  it('skips a row whose category does not exist for this user, with a reason', async () => {
    const result = await importCategoryRules('user-1', [
      { matchText: 'rent', categoryName: 'Nonexistent', priority: 0 },
    ]);

    expect(result.imported).toBe(0);
    expect(result.skipped).toEqual([
      { matchText: 'rent', reason: 'Category "Nonexistent" not found' },
    ]);
    expect(prismaMock.categoryRule.createMany).not.toHaveBeenCalled();
  });

  it('skips a row with an invalid regex, with a reason, instead of failing the batch', async () => {
    const result = await importCategoryRules('user-1', [
      { matchText: '/[/', categoryName: 'Groceries', priority: 0 },
      { matchText: 'valid one', categoryName: 'Groceries', priority: 0 },
    ]);

    expect(result.imported).toBe(1);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].matchText).toBe('/[/');
    expect(result.skipped[0].reason).toMatch(/Invalid regular expression/);
  });

  it('skips a row that already exists for this user (idempotent re-import)', async () => {
    prismaMock.categoryRule.findMany.mockResolvedValue([
      { categoryId: 'cat-1', matchText: 'whole foods' },
    ]);

    const result = await importCategoryRules('user-1', [
      { matchText: 'whole foods', categoryName: 'Groceries', priority: 0 },
    ]);

    expect(result).toEqual({
      imported: 0,
      skipped: [{ matchText: 'whole foods', reason: 'Already exists' }],
    });
    expect(prismaMock.categoryRule.createMany).not.toHaveBeenCalled();
  });

  it('deduplicates identical rows within the same file', async () => {
    const result = await importCategoryRules('user-1', [
      { matchText: 'rent', categoryName: 'Groceries', priority: 0 },
      { matchText: 'rent', categoryName: 'Groceries', priority: 0 },
    ]);

    expect(result.imported).toBe(1);
    expect(result.skipped).toEqual([{ matchText: 'rent', reason: 'Already exists' }]);
  });
});
