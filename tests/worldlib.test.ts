import { describe, expect, it } from 'vitest';
import {
  HEIGHT_OFFSET,
  HEIGHT_SCALE,
  SEA_LEVEL_VALUE,
  bytesToHeight,
  bytesToMeters,
  heightToBytes,
  metersToBytes,
  metersToUint16,
  uint16ToMeters,
} from '../src/lib/heightEncoding';
import { distanceTransform, signedDistanceField } from '../src/lib/distanceField';
import { hashStringSeed, mulberry32 } from '../src/lib/prng';
import {
  SEA_EXAGGERATION,
  LAND_EXAGGERATION_MIN,
  LAND_EXAGGERATION_MAX,
  LAND_RAMP_END_M,
  exaggerationAt,
  shapedMeters,
} from '../src/lib/heightShaping';

describe('heightEncoding', () => {
  it('encodes sea level at the documented value', () => {
    expect(metersToUint16(0)).toBe(SEA_LEVEL_VALUE);
    expect(uint16ToMeters(SEA_LEVEL_VALUE)).toBe(0);
  });

  it('round-trips meters within quantization error', () => {
    for (const m of [-6000, -430.5, -12, -0.2, 0, 2, 117.3, 1998.75, 5642]) {
      const v = metersToUint16(m);
      expect(Math.abs(uint16ToMeters(v) - m)).toBeLessThanOrEqual(HEIGHT_SCALE / 2);
    }
  });

  it('clamps out-of-range heights instead of wrapping', () => {
    expect(metersToUint16(HEIGHT_OFFSET - 1000)).toBe(0);
    expect(metersToUint16(100000)).toBe(65535);
  });

  it('round-trips every uint16 through the byte split exactly', () => {
    for (const v of [0, 1, 255, 256, 32767, 32768, 54321, 65535]) {
      const [hi, lo] = heightToBytes(v);
      expect(hi).toBeGreaterThanOrEqual(0);
      expect(hi).toBeLessThanOrEqual(255);
      expect(lo).toBeGreaterThanOrEqual(0);
      expect(lo).toBeLessThanOrEqual(255);
      expect(bytesToHeight(hi, lo)).toBe(v);
    }
  });

  it('round-trips meters through bytes', () => {
    const [hi, lo] = metersToBytes(-4321.25);
    expect(bytesToMeters(hi, lo)).toBeCloseTo(-4321.25, 6);
  });
});

describe('distanceField', () => {
  it('computes exact distances on a single seed point', () => {
    // 5x5 grid, seed at center (2,2).
    const d = distanceTransform(5, 5, (i) => i === 2 + 2 * 5);
    expect(d[2 + 2 * 5]).toBe(0);
    expect(d[3 + 2 * 5]).toBe(1);
    expect(d[4 + 4 * 5]).toBeCloseTo(Math.hypot(2, 2), 6);
    expect(d[0]).toBeCloseTo(Math.hypot(2, 2), 6);
  });

  it('is exact (not chamfer-approximate) for knight moves', () => {
    const d = distanceTransform(8, 8, (i) => i === 0);
    expect(d[2 + 1 * 8]).toBeCloseTo(Math.hypot(2, 1), 6);
    expect(d[7 + 3 * 8]).toBeCloseTo(Math.hypot(7, 3), 6);
  });

  it('signedDistanceField is positive inside, negative outside, ~0 at the boundary', () => {
    // 9-wide strip: mask on for x in [3, 5].
    const w = 9;
    const mask = new Uint8Array(w);
    for (let x = 3; x <= 5; x++) mask[x] = 1;
    const sdf = signedDistanceField(w, 1, mask);
    expect(sdf[4]).toBeGreaterThan(0.9); // center of the strip
    expect(sdf[0]).toBeLessThan(-2); // far outside
    // Boundary straddles cells 2|3: both should be within half a pixel of zero.
    expect(Math.abs(sdf[3])).toBeLessThanOrEqual(0.5);
    expect(Math.abs(sdf[2])).toBeLessThanOrEqual(0.5);
  });
});

describe('heightShaping', () => {
  it('keeps the base factor below sea level (bathymetry / depth tint unchanged)', () => {
    expect(exaggerationAt(0)).toBe(SEA_EXAGGERATION);
    expect(exaggerationAt(-3000)).toBe(SEA_EXAGGERATION);
  });

  it('ramps land from the min to the max factor', () => {
    expect(exaggerationAt(1)).toBeCloseTo(LAND_EXAGGERATION_MIN, 2);
    expect(exaggerationAt(LAND_RAMP_END_M)).toBe(LAND_EXAGGERATION_MAX);
    expect(exaggerationAt(5000)).toBe(LAND_EXAGGERATION_MAX);
  });

  it('shapedMeters is strictly monotonic (height ordering preserved)', () => {
    let prev = shapedMeters(-6000);
    for (let m = -5990; m <= 5000; m += 10) {
      const cur = shapedMeters(m);
      expect(cur).toBeGreaterThan(prev);
      prev = cur;
    }
  });

  it('preserves the sign of heights (straits stay under water)', () => {
    expect(shapedMeters(-25)).toBeLessThan(0);
    expect(shapedMeters(4)).toBeGreaterThan(0);
    expect(shapedMeters(0)).toBe(0);
  });
});

describe('prng', () => {
  it('is deterministic for the same seed', () => {
    const a = mulberry32(hashStringSeed('east-roman'));
    const b = mulberry32(hashStringSeed('east-roman'));
    for (let i = 0; i < 100; i++) expect(a()).toBe(b());
  });

  it('stays in [0, 1)', () => {
    const r = mulberry32(12345);
    for (let i = 0; i < 1000; i++) {
      const x = r();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
});
