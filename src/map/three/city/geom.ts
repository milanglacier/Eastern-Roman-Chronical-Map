/**
 * Geometry helpers for the procedural city, in the city's local metre frame
 * (X east, Z south, Y up). Every helper returns indexed geometry with
 * position/normal/uv so pieces can be merged per material.
 */
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  Matrix4,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export type P2 = { x: number; z: number };
export type GroundY = (x: number, z: number) => number;

/** Bearing (deg clockwise from north) → rotation.y that maps local +X onto it. */
export function bearingToRotY(bearingDeg: number): number {
  return ((90 - bearingDeg) * Math.PI) / 180;
}

const m4 = new Matrix4();
const q = new Quaternion();
const up = new Vector3(0, 1, 0);

/** Apply translate/rotate-about-Y/scale to a geometry in place; returns it. */
export function xf(
  g: BufferGeometry,
  t: { x?: number; y?: number; z?: number; rotY?: number; sx?: number; sy?: number; sz?: number },
): BufferGeometry {
  q.setFromAxisAngle(up, t.rotY ?? 0);
  m4.compose(
    new Vector3(t.x ?? 0, t.y ?? 0, t.z ?? 0),
    q,
    new Vector3(t.sx ?? 1, t.sy ?? 1, t.sz ?? 1),
  );
  g.applyMatrix4(m4);
  return g;
}

/** Box with its base at y=0 (centred in x/z). */
export function box(w: number, h: number, d: number): BufferGeometry {
  return new BoxGeometry(w, h, d).translate(0, h / 2, 0);
}

export function cylinder(r: number, h: number, seg = 12): BufferGeometry {
  return new CylinderGeometry(r, r, h, seg).translate(0, h / 2, 0);
}

/** Hemispherical dome of radius r sitting on y=0. */
export function dome(r: number, seg = 20): BufferGeometry {
  return new SphereGeometry(r, seg, Math.max(6, seg / 2), 0, Math.PI * 2, 0, Math.PI / 2);
}

/** Quarter-sphere semi-dome, curved side toward +X (open face at x=0), on y=0. */
export function semiDome(r: number, seg = 16): BufferGeometry {
  // SphereGeometry puts x = -r·cos(phi)·sin(theta): phi in [π/2, 3π/2] is x ≥ 0.
  return new SphereGeometry(r, seg, Math.max(5, seg / 2), Math.PI / 2, Math.PI, 0, Math.PI / 2);
}

/** Half-cylinder apse (curved side toward +X), base on y=0. */
export function apse(r: number, h: number, seg = 12): BufferGeometry {
  return new CylinderGeometry(r, r, h, seg, 1, false, 0, Math.PI).translate(0, h / 2, 0);
}

/** Pitched roof: a triangular prism along X, eaves at y=0, ridge at y=h. */
export function gableRoof(len: number, width: number, h: number): BufferGeometry {
  const hw = width / 2;
  const hl = len / 2;
  // Two slopes + two gable ends, flat-shaded (duplicate vertices).
  const v = [
    // south slope (z+)
    -hl, 0, hw, hl, 0, hw, hl, h, 0, -hl, h, 0,
    // north slope (z-)
    hl, 0, -hw, -hl, 0, -hw, -hl, h, 0, hl, h, 0,
    // west gable
    -hl, 0, -hw, -hl, 0, hw, -hl, h, 0,
    // east gable
    hl, 0, hw, hl, 0, -hw, hl, h, 0,
  ];
  const uv = [0, 0, len / 4, 0, len / 4, hw / 4, 0, hw / 4, 0, 0, len / 4, 0, len / 4, hw / 4, 0, hw / 4, 0, 0, width / 4, 0, hw / 4, h / 4, 0, 0, width / 4, 0, hw / 4, h / 4];
  const idx = [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 8, 9, 10, 11, 12, 13];
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(v), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Four-sided hipped roof (pyramid) over a w×d footprint, eaves at y=0. */
export function hipRoof(w: number, h: number, d: number): BufferGeometry {
  const g = new ConeGeometry(Math.SQRT1_2, 1, 4, 1).rotateY(Math.PI / 4).translate(0, 0.5, 0);
  return g.scale(w, h, d);
}

/** Resample a polyline so consecutive points are ≤ `step` apart. */
export function resample(points: P2[], step: number): P2[] {
  const out: P2[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i];
    const b = points[i + 1];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.max(1, Math.ceil(len / step));
    for (let k = 0; k < n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n });
  }
  out.push(points[points.length - 1]);
  return out;
}

/** Unit left-normals (x,z) per vertex of a polyline (averaged at joints). */
export function pathNormals(points: P2[]): P2[] {
  return points.map((_, i) => {
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(points.length - 1, i + 1)];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    return { x: -dz / len, z: dx / len };
  });
}

/** Offset a polyline sideways by `d` metres along its normals. */
export function offsetPath(points: P2[], d: number): P2[] {
  const n = pathNormals(points);
  return points.map((p, i) => ({ x: p.x + n[i].x * d, z: p.z + n[i].z * d }));
}

/**
 * Terrain-following wall: a solid ribbon of `thickness` along `points`,
 * top at ground + height, footing sunk `sink` metres. UVs in metres / 10
 * (one masonry texture tile). Segments where `keep(i)` is false are gaps.
 */
export function wallRibbon(
  points: P2[],
  groundY: GroundY,
  height: number,
  thickness: number,
  opts: { sink?: number; keep?: (i: number) => boolean; heightAt?: (i: number) => number } = {},
): BufferGeometry {
  const sink = opts.sink ?? 4;
  const n = pathNormals(points);
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  let dist = 0;
  const quad = (a: number[], b: number[], c: number[], d: number[], u0: number, u1: number, v0: number, v1: number) => {
    const base = pos.length / 3;
    pos.push(...a, ...b, ...c, ...d);
    uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i];
    const b = points[i + 1];
    const segLen = Math.hypot(b.x - a.x, b.z - a.z);
    if (opts.keep && !opts.keep(i)) {
      dist += segLen;
      continue;
    }
    const ha = opts.heightAt ? opts.heightAt(i) : height;
    const hb = opts.heightAt ? opts.heightAt(i + 1) : height;
    const ga = groundY(a.x, a.z);
    const gb = groundY(b.x, b.z);
    const t = thickness / 2;
    const L = (p: P2, nn: P2, s: number) => [p.x + nn.x * t * s, 0, p.z + nn.z * t * s];
    const at = (arr: number[], y: number) => [arr[0], y, arr[2]];
    const aL = L(a, n[i], 1);
    const aR = L(a, n[i], -1);
    const bL = L(b, n[i + 1], 1);
    const bR = L(b, n[i + 1], -1);
    const u0 = dist / 10;
    const u1 = (dist + segLen) / 10;
    // Left face, right face, top.
    quad(at(aL, ga - sink), at(bL, gb - sink), at(bL, gb + hb), at(aL, ga + ha), u0, u1, -sink / 10, ha / 10);
    quad(at(bR, gb - sink), at(aR, ga - sink), at(aR, ga + ha), at(bR, gb + hb), u1, u0, -sink / 10, ha / 10);
    quad(at(aL, ga + ha), at(bL, gb + hb), at(bR, gb + hb), at(aR, ga + ha), u0, u1, 0, thickness / 10);
    dist += segLen;
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Flat strip draped on the terrain (roads, moats), `lift` metres above it. */
export function drapedStrip(points: P2[], groundY: GroundY, width: number, lift = 0.4): BufferGeometry {
  const n = pathNormals(points);
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  let dist = 0;
  points.forEach((p, i) => {
    if (i > 0) dist += Math.hypot(p.x - points[i - 1].x, p.z - points[i - 1].z);
    for (const s of [1, -1]) {
      const x = p.x + n[i].x * (width / 2) * s;
      const z = p.z + n[i].z * (width / 2) * s;
      pos.push(x, groundY(x, z) + lift, z);
      uv.push(dist / 8, s > 0 ? 0 : width / 8);
    }
    if (i > 0) {
      const b = (i - 1) * 2;
      idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
    }
  });
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Ground heights around a footprint: the min (for a podium) and the centre. */
export function footprintGround(
  groundY: GroundY,
  cx: number,
  cz: number,
  len: number,
  width: number,
  rotY: number,
): { min: number; max: number; center: number } {
  const c = Math.cos(rotY);
  const s = Math.sin(rotY);
  let min = Infinity;
  let max = -Infinity;
  for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0], [0, 1], [0, -1], [1, 0], [-1, 0]]) {
    const lx = (u * len) / 2;
    const lz = (v * width) / 2;
    // rotation about Y: x' = x cos + z sin, z' = -x sin + z cos
    const y = groundY(cx + lx * c + lz * s, cz - lx * s + lz * c);
    min = Math.min(min, y);
    max = Math.max(max, y);
  }
  return { min, max, center: groundY(cx, cz) };
}

/** Merge geometries that share a material; null for an empty list. */
export function merge(geoms: BufferGeometry[]): BufferGeometry | null {
  const list = geoms.filter((g) => g.getAttribute('position').count > 0);
  if (list.length === 0) return null;
  for (const g of list) {
    if (!g.index) g.setIndex([...Array(g.getAttribute('position').count).keys()]);
    if (!g.getAttribute('uv')) {
      g.setAttribute('uv', new BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
    }
    if (!g.getAttribute('normal')) g.computeVertexNormals();
  }
  const merged = mergeGeometries(list, false);
  for (const g of list) g.dispose();
  return merged;
}
