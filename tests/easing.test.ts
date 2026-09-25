import { describe, expect, it } from 'vitest';
import { easeInOutCubic, easeOutBack } from '../src/lib/easing';

describe('easing', () => {
  it('folds into place with a small overshoot, never wild', () => {
    let max = 0;
    for (let x = 0; x <= 1; x += 0.01) max = Math.max(max, easeOutBack(x));
    expect(max).toBeGreaterThan(1);
    expect(max).toBeLessThan(1.12);
    expect(easeOutBack(0)).toBeCloseTo(0, 12);
    expect(easeOutBack(1)).toBeCloseTo(1, 12);
  });

  it('eases in and out symmetrically', () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 12);
    expect(easeInOutCubic(0.25) + easeInOutCubic(0.75)).toBeCloseTo(1, 12);
  });
});
