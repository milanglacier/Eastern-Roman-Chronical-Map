/**
 * The city's houses: thousands of instanced plaster boxes with terracotta
 * hipped roofs. Candidate sites are generated once (jittered grid inside
 * the largest urban ring, on buildable land, clear of monuments and walls);
 * each gets a fixed random threshold, and a house stands in a given year
 * when `threshold < density(year) × weight(site)` inside the ring valid
 * then. Because thresholds never change, a denser year's houses are a
 * superset of a sparser year's — scrubbing the timeline grows and thins the
 * city in place instead of reshuffling it.
 */
import {
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  InstancedMesh,
  Matrix4,
  Quaternion,
  Vector3,
} from 'three';
import { hashStringSeed, mulberry32 } from '../../../lib/prng';
import { box, hipRoof, type GroundY, type P2 } from './geom';
import type { CityMaterials } from './palette';

export interface HouseSite {
  x: number;
  z: number;
  rotY: number;
  w: number;
  d: number;
  h: number;
  /** Fixed draw in [0,1): stands when below density × weight. */
  threshold: number;
  /** Local desirability in (0,1]: dense core, thinner toward the walls. */
  weight: number;
  /** Bit i set = inside urban ring i. */
  rings: number;
  /** Index into the plaster palette. */
  tone: number;
}

export function pointInRing(p: P2, ring: P2[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

/** Distance from a point to a polyline (metres). */
export function distanceToPath(p: P2, path: P2[]): number {
  let best = Infinity;
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i];
    const b = path[i + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2));
    best = Math.min(best, Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t)));
  }
  return best;
}

export interface HouseSiteOptions {
  seed: string;
  /** Urban rings (local metres); sites are generated inside their union. */
  rings: P2[][];
  /** Raw (unexaggerated) ground metres at a local point. */
  heightAt: (x: number, z: number) => number;
  /** Core of the city (densest point). */
  core: P2;
  /** Circles to keep clear (monument footprints). */
  keepClear: Array<{ x: number; z: number; r: number }>;
  /** Corridors to keep clear (walls, avenues): polylines with half-widths. */
  corridors: Array<{ path: P2[]; halfWidth: number }>;
  spacing?: number;
}

export function generateHouseSites(o: HouseSiteOptions): HouseSite[] {
  const spacing = o.spacing ?? 21;
  const rand = mulberry32(hashStringSeed(o.seed));
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const ring of o.rings) {
    for (const p of ring) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }
  }
  const sites: HouseSite[] = [];
  for (let z = minZ; z <= maxZ; z += spacing) {
    for (let x = minX; x <= maxX; x += spacing) {
      // Draw every random number up front so a rejected site never shifts
      // the sequence for its neighbours' shapes.
      const r = Array.from({ length: 8 }, rand);
      const p = { x: x + (r[0] - 0.5) * spacing * 0.7, z: z + (r[1] - 0.5) * spacing * 0.7 };
      let rings = 0;
      o.rings.forEach((ring, i) => {
        if (pointInRing(p, ring)) rings |= 1 << i;
      });
      if (!rings) continue;
      const h0 = o.heightAt(p.x, p.z);
      if (h0 < 2.5) continue; // sea, beach
      const slope = Math.abs(o.heightAt(p.x + 8, p.z) - o.heightAt(p.x - 8, p.z)) + Math.abs(o.heightAt(p.x, p.z + 8) - o.heightAt(p.x, p.z - 8));
      if (slope > 7) continue;
      if (o.keepClear.some((c) => Math.hypot(p.x - c.x, p.z - c.z) < c.r)) continue;
      if (o.corridors.some((c) => distanceToPath(p, c.path) < c.halfWidth)) continue;
      const dCore = Math.hypot(p.x - o.core.x, p.z - o.core.z);
      const weight = Math.max(0.28, Math.min(1, 1.12 - dCore / 5200));
      // Street-grid orientation drifts slowly across districts.
      const district = Math.sin(p.x / 900) * 0.6 + Math.cos(p.z / 700) * 0.5;
      sites.push({
        x: p.x,
        z: p.z,
        rotY: district + (r[2] - 0.5) * 0.25,
        // One or two storeys; wide footprints so blocks read as contiguous.
        w: 11 + r[3] * 9,
        d: 9 + r[4] * 7,
        h: r[5] < 0.22 ? 7.5 + r[6] * 3 : 4 + r[6] * 2.5,
        threshold: r[7],
        weight,
        rings,
        tone: Math.floor(r[2] * 997) % 7,
      });
    }
  }
  return sites;
}

/** Whether a site stands for the given density and active ring index. */
export function houseStands(site: HouseSite, density: number, ringIndex: number): boolean {
  return (site.rings & (1 << ringIndex)) !== 0 && site.threshold < density * site.weight;
}

const PLASTER = [0xe9dfca, 0xdccaa7, 0xeee6d6, 0xd9bb97, 0xcaa98b, 0xe3d5bb, 0xd6c7ae];
const ROOF = [0xffffff, 0xf0d8cc, 0xe6c4b3, 0xfff0e6, 0xd9b3a0, 0xf5e0d6, 0xe8cfc2];

export interface HouseLayer {
  meshes: InstancedMesh[];
  /** Target the set standing at this density within ring `ringIndex`. */
  setTarget(density: number, ringIndex: number): void;
  /** Animate growth toward the target; returns true while still moving. */
  update(deltaSec: number): boolean;
  count: number;
  dispose(): void;
}

export function createHouseLayer(
  sites: HouseSite[],
  groundY: GroundY,
  hs: number,
  mats: CityMaterials,
): HouseLayer {
  const n = sites.length;
  const wallGeo: BufferGeometry = box(1, 1, 1);
  const roofGeo: BufferGeometry = hipRoof(1, 1, 1);
  const walls = new InstancedMesh(wallGeo, mats.houseWall, Math.max(1, n));
  const roofs = new InstancedMesh(roofGeo, mats.houseRoof, Math.max(1, n));
  for (const m of [walls, roofs]) {
    m.instanceMatrix.setUsage(DynamicDrawUsage);
    m.castShadow = true;
    m.receiveShadow = true;
    m.frustumCulled = false; // instances span the whole city
  }
  const color = new Color();
  sites.forEach((s, i) => {
    walls.setColorAt(i, color.set(PLASTER[s.tone]));
    roofs.setColorAt(i, color.set(ROOF[s.tone]));
  });
  const baseY = sites.map((s) => groundY(s.x, s.z));
  const growth = new Float32Array(n); // 0..1 current
  const target = new Uint8Array(n);
  const m4 = new Matrix4();
  const q = new Quaternion();
  const up = new Vector3(0, 1, 0);
  const pos = new Vector3();
  const scl = new Vector3();

  const write = (i: number) => {
    const s = sites[i];
    const g = growth[i];
    q.setFromAxisAngle(up, s.rotY);
    if (g <= 0.001) {
      m4.makeScale(0, 0, 0);
      walls.setMatrixAt(i, m4);
      roofs.setMatrixAt(i, m4);
      return;
    }
    const wallH = s.h * hs * g;
    // Footing sunk 3 m so slopes never show a gap under the house.
    pos.set(s.x, baseY[i] - 3, s.z);
    scl.set(s.w, wallH + 3, s.d);
    walls.setMatrixAt(i, m4.compose(pos, q, scl));
    pos.set(s.x, baseY[i] + wallH, s.z);
    scl.set(s.w + 1.2, 3.2 * hs * g, s.d + 1.2);
    roofs.setMatrixAt(i, m4.compose(pos, q, scl));
  };
  for (let i = 0; i < n; i++) write(i);

  let moving = false;
  return {
    meshes: [walls, roofs],
    count: n,
    setTarget(density, ringIndex) {
      for (let i = 0; i < n; i++) target[i] = houseStands(sites[i], density, ringIndex) ? 1 : 0;
      moving = true;
    },
    update(deltaSec) {
      if (!moving) return false;
      const step = deltaSec / 0.6; // full rise in 0.6 s
      let still = false;
      for (let i = 0; i < n; i++) {
        const t = target[i];
        const g = growth[i];
        if (g === t) continue;
        growth[i] = t > g ? Math.min(1, g + step) : Math.max(0, g - step);
        if (growth[i] !== t) still = true;
        write(i);
      }
      walls.instanceMatrix.needsUpdate = true;
      roofs.instanceMatrix.needsUpdate = true;
      moving = still;
      return still;
    },
    dispose() {
      wallGeo.dispose();
      roofGeo.dispose();
      walls.dispose();
      roofs.dispose();
    },
  };
}
