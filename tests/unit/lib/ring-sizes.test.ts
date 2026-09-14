import { describe, expect, it } from 'vitest';
import { RING_SIZES } from '@/components/ui/ring';

describe('RING_SIZES', () => {
  it('adds the mobile hero geometry from the design spec', () => {
    expect(RING_SIZES['hero-mobile']).toEqual({ box: 132, radius: 56, stroke: 12 });
  });

  it('adds the mobile category geometry from the design spec', () => {
    expect(RING_SIZES['category-mobile']).toEqual({ box: 66, radius: 27, stroke: 7 });
  });

  it('leaves the existing desktop sizes untouched', () => {
    expect(RING_SIZES.hero).toEqual({ box: 152, radius: 64, stroke: 14 });
    expect(RING_SIZES.budget).toEqual({ box: 96, radius: 40, stroke: 9 });
    expect(RING_SIZES.category).toEqual({ box: 88, radius: 36, stroke: 9 });
    // day and row already match the mobile spec, so they must not drift.
    expect(RING_SIZES.day).toEqual({ box: 108, radius: 46, stroke: 10 });
    expect(RING_SIZES.row).toEqual({ box: 76, radius: 31, stroke: 8 });
  });
});
