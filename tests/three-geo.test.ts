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
  PITCH_MAX,
  PITCH_MIN_FAR,
  PITCH_MIN_NEAR,
  angleDelta,
  clampDistance,
  clampPitch,
  clampTarget,
  flightPose,
  minPitchForDistance,
  pinchMidSpan,
  pinchZoomFactor,
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
  it('lets the camera tilt to the horizon up close but not far out', () => {
    expect(minPitchForDistance(DIST_MIN)).toBeCloseTo(PITCH_MIN_NEAR, 10);
    expect(minPitchForDistance(DIST_MAX)).toBeCloseTo(PITCH_MIN_FAR, 10);
    const mid = minPitchForDistance(50);
    expect(mid).toBeGreaterThan(PITCH_MIN_NEAR);
    expect(mid).toBeLessThan(PITCH_MIN_FAR);
  });

  it('clamps pitch between the distance floor and top-down', () => {
    expect(clampPitch(0, 10)).toBeCloseTo(minPitchForDistance(10), 10);
    expect(clampPitch(Math.PI, 10)).toBe(PITCH_MAX);
    expect(clampPitch(0.8, 10)).toBe(0.8);
  });

  it('takes the short way round for heading changes', () => {
    expect(angleDelta(0.1, 2 * Math.PI - 0.1)).toBeCloseTo(-0.2, 10);
    expect(angleDelta(2 * Math.PI - 0.1, 0.1)).toBeCloseTo(0.2, 10);
  });

  it('flies from pose to pose, rising over long hops', () => {
    const a = { x: 10, z: 10, distance: 20, heading: 0, pitch: 0.6 };
    const b = { x: 200, z: 90, distance: 20, heading: 6, pitch: 0.9 };
    const start = flightPose(a, b, 0);
    expect(start.x).toBe(a.x);
    expect(start.distance).toBeCloseTo(a.distance, 10);
    expect(start.heading).toBe(a.heading);
    const end = flightPose(a, b, 1);
    expect(end.x).toBeCloseTo(b.x, 10);
    expect(end.distance).toBeCloseTo(b.distance, 10);
    expect(Math.cos(end.heading)).toBeCloseTo(Math.cos(b.heading), 10);
    expect(flightPose(a, b, 0.5).distance).toBeGreaterThan(30);
    // A short hop barely rises.
    const c = { ...a, x: 11 };
    expect(flightPose(a, c, 0.5).distance).toBeLessThan(21);
  });

  it('clamps distance and target to world bounds', () => {
    expect(clampDistance(1)).toBe(DIST_MIN);
    expect(clampDistance(1e5)).toBe(DIST_MAX);
    expect(clampTarget(-10, -10)).toEqual({ x: 0, z: 0 });
    expect(clampTarget(1e4, 1e4)).toEqual({ x: GROUND_W, z: GROUND_H });
    expect(clampTarget(50, 50)).toEqual({ x: 50, z: 50 });
  });

  it('pinch spread zooms in, squeeze zooms out', () => {
    expect(pinchZoomFactor(100, 200)).toBe(0.5);
    expect(pinchZoomFactor(100, 50)).toBe(2);
  });

  it('degenerate pinch spans leave the distance unchanged', () => {
    expect(pinchZoomFactor(0, 100)).toBe(1);
    expect(pinchZoomFactor(100, 0)).toBe(1);
    expect(pinchZoomFactor(-5, 100)).toBe(1);
  });

  it('pinch zoom stays within distance bounds under extreme ratios', () => {
    expect(clampDistance(100 * pinchZoomFactor(1, 1e6))).toBeGreaterThanOrEqual(DIST_MIN);
    expect(clampDistance(100 * pinchZoomFactor(1e6, 1))).toBeLessThanOrEqual(DIST_MAX);
  });

  it('computes pinch midpoint and span symmetrically', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 6, y: 8 };
    const ab = pinchMidSpan(a, b);
    const ba = pinchMidSpan(b, a);
    expect(ab.mid).toEqual({ x: 3, y: 4 });
    expect(ab.span).toBe(10);
    expect(ba.mid).toEqual(ab.mid);
    expect(ba.span).toBe(ab.span);
  });
});

describe('cinematic framing', () => {
  it('aims straight at the target from high views, shallower near the horizon', async () => {
    const { aimPitchFor } = await import('../src/map/three/cameraRig');
    const deg = Math.PI / 180;
    expect(aimPitchFor(60 * deg)).toBeCloseTo(60 * deg, 10);
    expect(aimPitchFor(30 * deg)).toBeCloseTo(30 * deg, 10);
    expect(aimPitchFor(12 * deg)).toBeCloseTo(12 * deg * 0.25, 10);
    expect(aimPitchFor(20 * deg)).toBeLessThan(20 * deg);
  });
});

describe('guided paths', () => {
  it('starts and ends on the first and last waypoints and passes through the middle ones', async () => {
    const { pathPose } = await import('../src/map/three/cameraRig');
    const poses = [
      { x: 0, z: 0, distance: 80, heading: 0.2, pitch: 0.7 },
      { x: 10, z: 5, distance: 20, heading: 1.0, pitch: 0.3 },
      { x: 20, z: 6, distance: 12, heading: 6.0, pitch: 0.25 },
    ];
    const a = pathPose(poses, 0);
    expect(a.x).toBeCloseTo(0, 9);
    expect(a.distance).toBeCloseTo(80, 6);
    const b = pathPose(poses, 1);
    expect(b.x).toBeCloseTo(20, 9);
    expect(b.distance).toBeCloseTo(12, 6);
    expect(Math.cos(b.heading)).toBeCloseTo(Math.cos(6.0), 9);
    // Eased u = 0.5 maps exactly onto the middle waypoint for 3 poses.
    expect(pathPose(poses, 0.5).x).toBeCloseTo(10, 9);
  });

  it('moves continuously (no jumps) along the path', async () => {
    const { pathPose } = await import('../src/map/three/cameraRig');
    const poses = [
      { x: 0, z: 0, distance: 80, heading: 3.0, pitch: 0.7 },
      { x: 10, z: 5, distance: 20, heading: -3.0, pitch: 0.3 },
      { x: 20, z: 6, distance: 12, heading: -2.5, pitch: 0.25 },
      { x: 22, z: 9, distance: 10, heading: -1.5, pitch: 0.3 },
    ];
    let prev = pathPose(poses, 0);
    for (let u = 0.005; u <= 1; u += 0.005) {
      const p = pathPose(poses, u);
      expect(Math.abs(p.x - prev.x)).toBeLessThan(0.6);
      expect(Math.abs(p.heading - prev.heading)).toBeLessThan(0.2);
      prev = p;
    }
  });
});
