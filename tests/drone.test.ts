import { describe, expect, it } from 'vitest';
import {
  DRONE_PITCH_MAX,
  DRONE_PITCH_MIN,
  clampDronePitch,
  dronePathPose,
  droneCurveRadius,
  lookVector,
} from '../src/map/three/droneRig';

const DEG = Math.PI / 180;

describe('free-look drone camera', () => {
  it('can look from nearly straight down to well above the horizon', () => {
    expect(DRONE_PITCH_MIN).toBeLessThan(-80 * DEG);
    expect(DRONE_PITCH_MAX).toBeGreaterThan(60 * DEG);
    expect(clampDronePitch(-2)).toBe(DRONE_PITCH_MIN);
    expect(clampDronePitch(2)).toBe(DRONE_PITCH_MAX);
    expect(clampDronePitch(0.3)).toBe(0.3);
  });

  it('maps yaw/pitch onto the world axes (north −Z, east +X, up +Y)', () => {
    const north = lookVector(0, 0);
    expect(north[2]).toBeCloseTo(-1, 10);
    const east = lookVector(90 * DEG, 0);
    expect(east[0]).toBeCloseTo(1, 10);
    const up = lookVector(0, 60 * DEG);
    expect(up[1]).toBeCloseTo(Math.sin(60 * DEG), 10);
    const v = lookVector(1.2, -0.4);
    expect(Math.hypot(...v)).toBeCloseTo(1, 10);
  });

  it('bends the world tighter when flying low (a near horizon) and flatter when high', () => {
    expect(droneCurveRadius(1)).toBeLessThan(droneCurveRadius(30));
    expect(droneCurveRadius(0)).toBeGreaterThanOrEqual(150);
    expect(droneCurveRadius(500)).toBe(900);
  });

  it('flies guided paths through the waypoints with continuous motion', () => {
    const poses = [
      { x: 0, y: 30, z: 0, yaw: 0.2, pitch: -0.5 },
      { x: 10, y: 5, z: 5, yaw: 1.0, pitch: -0.1 },
      { x: 12, y: 2, z: 9, yaw: 6.0, pitch: 0.2 },
    ];
    expect(dronePathPose(poses, 0).y).toBeCloseTo(30, 9);
    expect(dronePathPose(poses, 1).x).toBeCloseTo(12, 9);
    expect(dronePathPose(poses, 0.5).x).toBeCloseTo(10, 9);
    let prev = dronePathPose(poses, 0);
    for (let u = 0.01; u <= 1; u += 0.01) {
      const p = dronePathPose(poses, u);
      expect(Math.abs(p.y - prev.y)).toBeLessThan(1.5);
      expect(Math.abs(p.yaw - prev.yaw)).toBeLessThan(0.2);
      prev = p;
    }
  });
});
