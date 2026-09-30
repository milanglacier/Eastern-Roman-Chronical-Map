import { describe, expect, it } from 'vitest';
import { territories } from '../src/data';
import { YEAR_MAX, YEAR_MIN } from '../src/data/schema';
import { createEmpireTour, createPoseFollower, territoryFraming } from '../src/map/three/aerialTour';
import { DRONE_MAX_Y } from '../src/map/three/droneRig';
import { GROUND_H, GROUND_W } from '../src/map/three/geo';
import { YEARS_PER_SECOND } from '../src/lib/timeline';

const tour = createEmpireTour();

describe('aerial tour', () => {
  it('frames a vast empire wider than a shrunken one', () => {
    const wide = territoryFraming(territories.get(330)!);
    const narrow = territoryFraming(territories.get(1400)!);
    expect(wide.radius).toBeGreaterThan(narrow.radius * 3);
    expect(tour.poseAt(YEAR_MIN).y).toBeGreaterThan(tour.poseAt(YEAR_MAX).y * 2);
  });

  it('flies within the world, above the ground, looking down', () => {
    for (let year = YEAR_MIN; year <= YEAR_MAX; year += 7) {
      const p = tour.poseAt(year);
      expect(p.x).toBeGreaterThan(-30);
      expect(p.x).toBeLessThan(GROUND_W + 30);
      expect(p.z).toBeGreaterThan(-30);
      expect(p.z).toBeLessThan(GROUND_H + 30);
      expect(p.y).toBeGreaterThan(3);
      expect(p.y).toBeLessThan(DRONE_MAX_Y);
      expect(p.pitch).toBeLessThan(-0.4);
    }
  });

  it('never jumps between frames, even across a frontier change', () => {
    const yearsPerFrame = YEARS_PER_SECOND / 60;
    for (let year = YEAR_MIN; year < YEAR_MAX; year += yearsPerFrame * 3) {
      const a = tour.poseAt(year);
      const b = tour.poseAt(year + yearsPerFrame);
      // Under 1.2 camera heights per second at 60 fps.
      expect(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) / a.y).toBeLessThan(0.02);
      expect(Math.abs(b.yaw - a.yaw)).toBeLessThan(0.01);
    }
  });

  it('is a pure function of the year', () => {
    expect(tour.poseAt(812.5)).toEqual(tour.poseAt(812.5));
  });
});

describe('pose follower', () => {
  const start = { x: 0, y: 10, z: 0, yaw: 0, pitch: -0.5 };
  const goal = { x: 20, y: 40, z: -10, yaw: 0.3, pitch: -0.8 };

  it('eases from rest onto the target without overshooting', () => {
    const f = createPoseFollower();
    f.reset(start);
    let prev = start.x;
    let firstStep = 0;
    for (let i = 0; i < 600; i++) {
      const p = f.step(goal, 1 / 60, 2.2);
      if (i === 0) firstStep = p.x - start.x;
      expect(p.x).toBeGreaterThanOrEqual(prev - 1e-9);
      expect(p.x).toBeLessThanOrEqual(goal.x + 1e-9);
      prev = p.x;
    }
    expect(firstStep).toBeLessThan(0.05);
    expect(f.pose.x).toBeCloseTo(goal.x, 2);
    expect(f.pose.pitch).toBeCloseTo(goal.pitch, 3);
  });

  it('turns the short way round', () => {
    const f = createPoseFollower();
    f.reset({ ...start, yaw: 3.0 });
    for (let i = 0; i < 600; i++) f.step({ ...goal, yaw: -3.0 }, 1 / 60, 2.2);
    expect(f.pose.yaw).toBeCloseTo(-3.0 + 2 * Math.PI, 2);
  });

  it('coasts to rest after the target is dropped', () => {
    const f = createPoseFollower();
    f.reset(start);
    for (let i = 0; i < 30; i++) f.step(goal, 1 / 60, 2.2);
    const before = f.pose.x;
    let frames = 0;
    while (f.coast(1 / 60) && frames < 600) frames++;
    expect(frames).toBeLessThan(600);
    expect(f.pose.x).toBeGreaterThan(before);
  });
});
