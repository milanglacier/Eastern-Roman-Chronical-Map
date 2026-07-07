import { describe, expect, it } from 'vitest';
import {
  TERRITORY_TEX_H,
  TERRITORY_TEX_W,
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
