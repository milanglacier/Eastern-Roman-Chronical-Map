import { describe, expect, it } from 'vitest';
import {
  GROUND_H,
  GROUND_W,
  UNITS_PER_DEGREE,
  groundToLonLat,
  groundToUv,
  lonLatToGround,
} from '../src/map/three/geo';
import { angleDelta } from '../src/map/three/droneRig';
import { LON_MIN, LON_MAX, LAT_MIN, LAT_MAX } from '../src/lib/hex';

describe('ground mapping', () => {
  it('spans the world rect from the hex-era bbox', () => {
    expect(GROUND_W).toBe((LON_MAX - LON_MIN) * UNITS_PER_DEGREE);
    expect(GROUND_H).toBe((LAT_MAX - LAT_MIN) * UNITS_PER_DEGREE);
  });

  it('maps corners of the bbox to corners of the rect', () => {
    expect(lonLatToGround(LON_MIN, LAT_MAX)).toEqual({ x: 0, z: 0 }); // NW
    expect(lonLatToGround(LON_MAX, LAT_MIN)).toEqual({ x: GROUND_W, z: GROUND_H }); // SE
  });

  it('round-trips lon/lat through ground coordinates', () => {
    for (const [lon, lat] of [
      [25, 38.5],
      [-5.91, 36.28],
      [28.98, 41.01],
      [LON_MIN, LAT_MIN],
    ]) {
      const g = lonLatToGround(lon, lat);
      const back = groundToLonLat(g.x, g.z);
      expect(back.lon).toBeCloseTo(lon, 10);
      expect(back.lat).toBeCloseTo(lat, 10);
    }
  });

  it('UVs put north at V=0 (flipY=false convention)', () => {
    expect(groundToUv(0, 0)).toEqual({ u: 0, v: 0 });
    expect(groundToUv(GROUND_W, GROUND_H)).toEqual({ u: 1, v: 1 });
  });
});

describe('camera angles', () => {
  it('takes the short way round for heading changes', () => {
    expect(angleDelta(0.1, 2 * Math.PI - 0.1)).toBeCloseTo(-0.2, 10);
    expect(angleDelta(2 * Math.PI - 0.1, 0.1)).toBeCloseTo(0.2, 10);
  });
});
