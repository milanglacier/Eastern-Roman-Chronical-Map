import { describe, expect, it } from 'vitest';
import { generateHouseSites, houseStands, pointInRing, distanceToPath } from '../src/map/three/city/houses';

const ring = [
  { x: 0, z: 0 },
  { x: 1000, z: 0 },
  { x: 1000, z: 800 },
  { x: 0, z: 800 },
];
const opts = {
  seed: 'test-city',
  rings: [ring],
  heightAt: (x: number) => 10 + x * 0.001, // gentle slope, all land
  core: { x: 500, z: 400 },
  keepClear: [{ x: 500, z: 400, r: 80 }],
  corridors: [{ path: [{ x: 0, z: 700 }, { x: 1000, z: 700 }], halfWidth: 20 }],
};

describe('house sites', () => {
  it('are deterministic for a seed', () => {
    expect(generateHouseSites(opts)).toEqual(generateHouseSites(opts));
  });

  it('respect the ring, keep-clear circles and corridors', () => {
    const sites = generateHouseSites(opts);
    expect(sites.length).toBeGreaterThan(500);
    for (const s of sites) {
      expect(pointInRing(s, ring)).toBe(true);
      expect(Math.hypot(s.x - 500, s.z - 400)).toBeGreaterThanOrEqual(80);
      expect(distanceToPath(s, opts.corridors[0].path)).toBeGreaterThanOrEqual(20);
    }
  });

  it('grow monotonically with density (denser set is a superset)', () => {
    const sites = generateHouseSites(opts);
    const standing = (d: number) => new Set(sites.filter((s) => houseStands(s, d, 0)).map((s) => `${s.x},${s.z}`));
    const sparse = standing(0.2);
    const dense = standing(0.8);
    expect(dense.size).toBeGreaterThan(sparse.size);
    for (const k of sparse) expect(dense.has(k)).toBe(true);
  });

  it('only stand inside the active ring', () => {
    const sites = generateHouseSites({ ...opts, rings: [ring, [{ x: 0, z: 0 }, { x: 300, z: 0 }, { x: 300, z: 300 }, { x: 0, z: 300 }]] });
    const inSmall = sites.filter((s) => houseStands(s, 1, 1));
    for (const s of inSmall) expect(s.x <= 300 && s.z <= 300).toBe(true);
  });
});
