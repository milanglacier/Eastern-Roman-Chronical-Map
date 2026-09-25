import { describe, expect, it } from 'vitest';
import { COAST_SLAB, reliefY } from '../src/lib/relief';
import { shapedMeters } from '../src/lib/heightShaping';

describe('chronicle relief', () => {
  it('raises every land height onto the coast edge above the sea plane', () => {
    expect(reliefY(4)).toBeGreaterThanOrEqual(COAST_SLAB);
    expect(reliefY(-12)).toBeLessThan(0);
  });

  it('leaves the sea floor on the map shaping', () => {
    expect(reliefY(-2000)).toBeCloseTo(shapedMeters(-2000) / (111320 / 4), 12);
  });

  it('is monotone on land', () => {
    let prev = reliefY(4);
    for (let m = 10; m <= 5000; m += 10) {
      const y = reliefY(m);
      expect(y).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = y;
    }
  });

  it('with the coast distance field, the coast edge is smooth and monotone', () => {
    let prev = reliefY(40, -4);
    expect(prev).toBeLessThan(0);
    for (let px = -4; px <= 4; px += 0.1) {
      const y = reliefY(40, px);
      expect(y).toBeGreaterThanOrEqual(prev - 1e-9);
      expect(y - prev).toBeLessThan(0.02); // no cliff jump between samples
      prev = y;
    }
    expect(reliefY(40, 4)).toBeGreaterThan(COAST_SLAB);
  });
});
