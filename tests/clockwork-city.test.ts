import { describe, expect, it } from 'vitest';
import { easeOutBack, stage } from '../src/map/three/clockwork/constantinople';

describe('clockwork rise staging', () => {
  it('is 0 before its window and 1 after it', () => {
    expect(stage(0.1, 0.3, 0.6)).toBe(0);
    expect(stage(0.3, 0.3, 0.6)).toBe(0);
    expect(stage(0.6, 0.3, 0.6)).toBe(1);
    expect(stage(1, 0.3, 0.6)).toBe(1);
  });

  it('clunks into place: a small overshoot, never wild', () => {
    let max = 0;
    for (let x = 0; x <= 1; x += 0.01) max = Math.max(max, easeOutBack(x));
    expect(max).toBeGreaterThan(1);
    expect(max).toBeLessThan(1.12);
    expect(easeOutBack(0)).toBeCloseTo(0, 12);
    expect(easeOutBack(1)).toBeCloseTo(1, 12);
  });
});
