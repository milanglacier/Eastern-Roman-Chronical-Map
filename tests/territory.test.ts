import { describe, expect, it } from 'vitest';
import {
  TERRITORY_TEX_H,
  TERRITORY_TEX_W,
  buildLandMask,
  clipMaskToLand,
  multiPolygonToPixelRings,
} from '../src/map/three/territory';
import { territories } from '../src/data';
import { LON_MIN, LON_MAX, LAT_MIN, LAT_MAX } from '../src/lib/hex';

describe('territory rasterization (pure part)', () => {
  it('maps the bbox corners to texture corners', () => {
    const rings = multiPolygonToPixelRings({
      type: 'MultiPolygon',
      coordinates: [
        [
          [
            [LON_MIN, LAT_MAX],
            [LON_MAX, LAT_MAX],
            [LON_MAX, LAT_MIN],
            [LON_MIN, LAT_MIN],
          ],
        ],
      ],
    });
    expect(rings).toEqual([
      [
        [0, 0],
        [TERRITORY_TEX_W, 0],
        [TERRITORY_TEX_W, TERRITORY_TEX_H],
        [0, TERRITORY_TEX_H],
      ],
    ]);
  });

  it('keeps holes as separate rings (even-odd fill semantics)', () => {
    const rings = multiPolygonToPixelRings({
      type: 'MultiPolygon',
      coordinates: [
        [
          [
            [0, 40],
            [10, 40],
            [10, 30],
            [0, 30],
          ],
          [
            [2, 38],
            [8, 38],
            [8, 32],
            [2, 32],
          ],
        ],
      ],
    });
    expect(rings).toHaveLength(2);
  });

  it('every committed snapshot territory stays inside the texture rect', () => {
    expect(territories.size).toBeGreaterThan(0);
    for (const [year, geometry] of territories) {
      for (const ring of multiPolygonToPixelRings(geometry)) {
        for (const [x, y] of ring) {
          expect(x, `year ${year}`).toBeGreaterThanOrEqual(0);
          expect(x, `year ${year}`).toBeLessThanOrEqual(TERRITORY_TEX_W);
          expect(y, `year ${year}`).toBeGreaterThanOrEqual(0);
          expect(y, `year ${year}`).toBeLessThanOrEqual(TERRITORY_TEX_H);
        }
      }
    }
  });
});

describe('territory land clipping (pure part)', () => {
  it('supersamples the land predicate with an antialiased boundary', () => {
    // Land west of 3/8 of the lon range: texel 0 fully in, texel 1 split
    // down the middle (2 of 4 subsamples), texels 2-3 fully out.
    const cut = LON_MIN + 0.375 * (LON_MAX - LON_MIN);
    const mask = buildLandMask(4, 2, (lon) => lon < cut);
    expect(Array.from(mask)).toEqual([255, 128, 0, 0, 255, 128, 0, 0]);
  });

  it('is all zeros for an all-sea predicate (controller then skips the clip)', () => {
    const mask = buildLandMask(3, 2, () => false);
    expect(mask.every((v) => v === 0)).toBe(true);
  });

  it('clips the polygon mask against land coverage', () => {
    const mask = new Uint8Array([255, 200, 255, 0]);
    clipMaskToLand(mask, new Uint8Array([255, 255, 0, 128]));
    expect(Array.from(mask)).toEqual([255, 200, 0, 0]);
  });

  it('keeps antialiased coast values proportional', () => {
    const mask = new Uint8Array([255, 128]);
    clipMaskToLand(mask, new Uint8Array([128, 128]));
    expect(Array.from(mask)).toEqual([128, 64]);
  });

  it('leaves the mask untouched when there is no land mask', () => {
    const mask = new Uint8Array([255, 128, 0]);
    const out = clipMaskToLand(mask, null);
    expect(out).toBe(mask);
    expect(Array.from(mask)).toEqual([255, 128, 0]);
  });
});
