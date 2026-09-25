import { describe, expect, it } from 'vitest';
import {
  CURVE_RADIUS_MAX,
  CURVE_RADIUS_MIN,
  bendDrop,
  curveRadiusForDistance,
  occludedByHorizon,
  rayHitBentGround,
} from '../src/map/three/curvature';

describe('curved earth', () => {
  it('is flat at the centre and symmetric around it', () => {
    expect(bendDrop(10, 20, 10, 20, 300)).toBe(0);
    expect(bendDrop(15, 20, 10, 20, 300)).toBeCloseTo(bendDrop(5, 20, 10, 20, 300), 12);
    expect(bendDrop(10, 25, 10, 20, 300)).toBeCloseTo(bendDrop(15, 20, 10, 20, 300), 12);
  });

  it('drops quadratically: d²/2R', () => {
    expect(bendDrop(30, 0, 0, 0, 450)).toBeCloseTo(1, 12);
    expect(bendDrop(60, 0, 0, 0, 450)).toBeCloseTo(4, 12);
  });

  it('clamps the radius to the configured range', () => {
    expect(curveRadiusForDistance(1)).toBe(CURVE_RADIUS_MIN);
    expect(curveRadiusForDistance(1e5)).toBe(CURVE_RADIUS_MAX);
    expect(curveRadiusForDistance(50)).toBe(400);
  });

  it('ray-casts onto the bent surface exactly (round trip)', () => {
    const cx = 100;
    const cz = 60;
    const R = 300;
    const cam = { x: 100, y: 12, z: 90 };
    for (const target of [
      { x: 100, z: 60 },
      { x: 120, z: 50 },
      { x: 80, z: 30 },
    ]) {
      const ty = -bendDrop(target.x, target.z, cx, cz, R);
      const dx = target.x - cam.x;
      const dy = ty - cam.y;
      const dz = target.z - cam.z;
      const len = Math.hypot(dx, dy, dz);
      const t = rayHitBentGround(cam.x, cam.y, cam.z, dx / len, dy / len, dz / len, cx, cz, R);
      expect(t).not.toBeNull();
      expect(t!).toBeCloseTo(len, 6);
    }
  });

  it('misses when the ray passes above the horizon', () => {
    // Looking straight up / nearly level far above the curve.
    expect(rayHitBentGround(0, 10, 0, 0, 1, 0, 0, 0, 300)).toBeNull();
    expect(rayHitBentGround(0, 10, 0, 1, 0.01, 0, 0, 0, 300)).toBeNull();
  });

  it('hides points beyond the horizon and keeps near ones', () => {
    const R = 200;
    const cam = { x: 0, y: 2, z: 0 };
    const near = { x: 5, y: -bendDrop(5, 0, 0, 0, R), z: 0 };
    const far = { x: 120, y: -bendDrop(120, 0, 0, 0, R), z: 0 };
    expect(occludedByHorizon(cam, near, 0, 0, R)).toBe(false);
    expect(occludedByHorizon(cam, far, 0, 0, R)).toBe(true);
  });
});
