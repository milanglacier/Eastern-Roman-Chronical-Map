import { describe, expect, it } from 'vitest';
import {
  GROUND_H,
  GROUND_W,
  UNITS_PER_DEGREE,
  groundToLonLat,
  groundToUv,
  lonLatToGround,
} from '../src/map/three/geo';
import {
  DIST_MAX,
  DIST_MIN,
  PITCH_FAR,
  PITCH_NEAR,
  clampDistance,
  clampTarget,
  pitchForDistance,
} from '../src/map/three/cameraRig';
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

describe('camera rig math', () => {
  it('pitch eases from 55° far to 40° near', () => {
    expect(pitchForDistance(DIST_MAX)).toBeCloseTo(PITCH_FAR, 10);
    expect(pitchForDistance(DIST_MIN)).toBeCloseTo(PITCH_NEAR, 10);
    const mid = pitchForDistance((DIST_MIN + DIST_MAX) / 2);
    expect(mid).toBeGreaterThan(PITCH_NEAR);
    expect(mid).toBeLessThan(PITCH_FAR);
  });

  it('pitch clamps outside the distance range', () => {
    expect(pitchForDistance(0)).toBeCloseTo(PITCH_NEAR, 10);
    expect(pitchForDistance(1e6)).toBeCloseTo(PITCH_FAR, 10);
  });

  it('clamps distance and target to world bounds', () => {
    expect(clampDistance(1)).toBe(DIST_MIN);
    expect(clampDistance(1e5)).toBe(DIST_MAX);
    expect(clampTarget(-10, -10)).toEqual({ x: 0, z: 0 });
    expect(clampTarget(1e4, 1e4)).toEqual({ x: GROUND_W, z: GROUND_H });
    expect(clampTarget(50, 50)).toEqual({ x: 50, z: 50 });
  });
});
