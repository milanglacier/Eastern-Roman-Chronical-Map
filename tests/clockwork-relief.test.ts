import { describe, expect, it } from 'vitest';
import { LAND_SLAB, clockworkY } from '../src/lib/clockworkRelief';
import { shapedMeters } from '../src/lib/heightShaping';

describe('clockwork relief', () => {
  it('raises every land height onto the slab above the sea plane', () => {
    expect(clockworkY(4)).toBeGreaterThanOrEqual(LAND_SLAB);
    expect(clockworkY(-12)).toBeLessThan(0);
  });

  it('leaves the sea floor on the map shaping', () => {
    expect(clockworkY(-2000)).toBeCloseTo(shapedMeters(-2000) / (111320 / 4), 12);
  });

  it('is monotone on land (terraces never invert)', () => {
    let prev = clockworkY(4);
    for (let m = 10; m <= 5000; m += 10) {
      const y = clockworkY(m);
      expect(y).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = y;
    }
  });

  it('with the coast distance field, the slab edge is smooth and monotone', () => {
    let prev = clockworkY(40, -4);
    expect(prev).toBeLessThan(0);
    for (let px = -4; px <= 4; px += 0.1) {
      const y = clockworkY(40, px);
      expect(y).toBeGreaterThanOrEqual(prev - 1e-9);
      expect(y - prev).toBeLessThan(0.02); // no cliff jump between samples
      prev = y;
    }
    expect(clockworkY(40, 4)).toBeGreaterThan(LAND_SLAB);
  });

  it('turns high ranges into towering sculpture', () => {
    expect(clockworkY(4500)).toBeGreaterThan(3);
    expect(clockworkY(200)).toBeLessThan(0.4);
  });
});
