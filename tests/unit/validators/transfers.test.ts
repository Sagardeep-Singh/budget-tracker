import { describe, expect, it } from 'vitest';
import { matchTransfersRequestSchema } from '@/lib/validators/transfers';

describe('matchTransfersRequestSchema', () => {
  it('accepts an empty body (unbounded scan)', () => {
    expect(matchTransfersRequestSchema.safeParse({}).success).toBe(true);
  });

  it('accepts a valid from/to range', () => {
    const result = matchTransfersRequestSchema.safeParse({
      from: '2026-03-01',
      to: '2026-03-31',
    });
    expect(result.success).toBe(true);
  });

  it('rejects from without to', () => {
    expect(matchTransfersRequestSchema.safeParse({ from: '2026-03-01' }).success).toBe(false);
  });

  it('rejects to without from', () => {
    expect(matchTransfersRequestSchema.safeParse({ to: '2026-03-31' }).success).toBe(false);
  });

  it('rejects from after to', () => {
    const result = matchTransfersRequestSchema.safeParse({
      from: '2026-03-31',
      to: '2026-03-01',
    });
    expect(result.success).toBe(false);
  });

  it('accepts from equal to to', () => {
    const result = matchTransfersRequestSchema.safeParse({
      from: '2026-03-01',
      to: '2026-03-01',
    });
    expect(result.success).toBe(true);
  });
});
