/**
 * Clockwork Constantinople: the city as a mechanical model that rises out
 * of the world on a bronze pedestal ringed with turning brass gears, in
 * the manner of the Game-of-Thrones titles. Stylized, not surveyed: the
 * peninsula is a carved stone slab with the Theodosian land walls and
 * Golden Gate, sea walls, a dense quarter of houses, Hagia Sophia (whose
 * gilt dome unfolds from petals), the Hippodrome, the Great Palace, the
 * porphyry Column of Constantine, the Aqueduct of Valens, Blachernae,
 * Galata across the Golden Horn with the harbour chain, and galleys.
 *
 * Local frame: +X east, +Z south, +Y up, pedestal radius ≈ 1.3; the host
 * scales and places the group. `setRise(t)` is a pure function of t ∈
 * [0, 1] (parts rise in stages, gears turn with t), so scrubbing time or
 * re-entering always shows the same state.
 */
import {
  BoxGeometry,
  BufferGeometry,
  CapsuleGeometry,
  ConeGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  Object3D,
  Quaternion,
  Shape,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
  type Material,
} from 'three';
import { mulberry32 } from '../../../lib/prng';
import type { ClockworkMaterials } from './materials';

/* ------------------------------------------------------------------ */
/* Rise staging (pure — unit tested)                                    */

/** Ease-out with a small mechanical overshoot ("clunk" into place). */
export function easeOutBack(x: number): number {
  const c1 = 1.25;
  const c3 = c1 + 1;
  const u = x - 1;
  return 1 + c3 * u * u * u + c1 * u * u;
}

/** Progress of a part whose rise window is [a, b] at global rise t. */
export function stage(t: number, a: number, b: number): number {
  if (t <= a) return 0;
  if (t >= b) return 1;
  return easeOutBack((t - a) / (b - a));
}

/* ------------------------------------------------------------------ */
/* Geometry helpers                                                     */

type P2 = [number, number];

const PENINSULA: P2[] = [
  [-0.92, -0.5], [-0.55, -0.52], [-0.2, -0.48], [0.15, -0.36], [0.45, -0.28], [0.72, -0.2],
  [0.9, -0.1], [0.96, 0.02], [0.85, 0.14], [0.62, 0.24], [0.3, 0.3], [0.0, 0.36],
  [-0.35, 0.42], [-0.7, 0.47], [-0.98, 0.5], [-1.02, 0.1], [-1.0, -0.2],
];
/** The Theodosian land walls: last four peninsula vertices, south → north. */
const LAND_WALL: P2[] = [[-0.98, 0.5], [-1.02, 0.1], [-1.0, -0.2], [-0.92, -0.5]];
const GALATA: P2[] = [[-0.05, -0.66], [0.3, -0.6], [0.62, -0.56], [0.82, -0.68], [0.7, -0.9], [0.3, -0.95], [0.0, -0.85]];

function slab(points: P2[], depth: number): ExtrudeGeometry {
  // Shape lives in XY; after rotateX(-90°) shape y becomes -z, so feed -z.
  const shape = new Shape(points.map(([x, z]) => new Vector2(x, -z)));
  const g = new ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 2 });
  g.rotateX(-Math.PI / 2);
  return g;
}

function insidePolygon(x: number, z: number, poly: P2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function distToPolyline(x: number, z: number, poly: P2[], closed: boolean): number {
  let best = Infinity;
  const n = closed ? poly.length : poly.length - 1;
  for (let i = 0; i < n; i++) {
    const [ax, az] = poly[i];
    const [bx, bz] = poly[(i + 1) % poly.length];
    const dx = bx - ax;
    const dz = bz - az;
    const l2 = dx * dx + dz * dz;
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
    best = Math.min(best, Math.hypot(x - (ax + t * dx), z - (az + t * dz)));
  }
  return best;
}

/** Points every `step` along a polyline (with the local tangent angle). */
function alongPolyline(poly: P2[], step: number, closed = false): Array<{ x: number; z: number; angle: number }> {
  const out: Array<{ x: number; z: number; angle: number }> = [];
  const n = closed ? poly.length : poly.length - 1;
  let carry = 0;
  for (let i = 0; i < n; i++) {
    const [ax, az] = poly[i];
    const [bx, bz] = poly[(i + 1) % poly.length];
    const len = Math.hypot(bx - ax, bz - az);
    const angle = Math.atan2(bz - az, bx - ax);
    for (let s = carry; s < len; s += step) {
      const t = s / len;
      out.push({ x: ax + (bx - ax) * t, z: az + (bz - az) * t, angle });
    }
    carry = (carry - len) % step;
    if (carry < 0) carry += step;
  }
  return out;
}

/** Gear outline: `teeth` trapezoid teeth between radii rIn..rOut, optional hole. */
function gearGeometry(rOut: number, rIn: number, teeth: number, depth: number, hole = 0): ExtrudeGeometry {
  const shape = new Shape();
  const step = (Math.PI * 2) / teeth;
  for (let i = 0; i < teeth; i++) {
    const a = i * step;
    const pts: Array<[number, number]> = [
      [rIn, a],
      [rOut, a + step * 0.18],
      [rOut, a + step * 0.48],
      [rIn, a + step * 0.66],
    ];
    for (const [k, [r, ang]] of pts.entries()) {
      const x = Math.cos(ang) * r;
      const y = Math.sin(ang) * r;
      if (i === 0 && k === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    }
  }
  shape.closePath();
  if (hole > 0) {
    const h = new Shape();
    h.absarc(0, 0, hole, 0, Math.PI * 2, true);
    shape.holes.push(h);
  }
  const g = new ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 6 });
  g.rotateX(-Math.PI / 2);
  return g;
}

/** A gabled house: unit box (base at y=0) + prism roof, as two geometries. */
function houseGeometries(): { walls: BoxGeometry; roof: BufferGeometry } {
  const walls = new BoxGeometry(1, 1, 1);
  walls.translate(0, 0.5, 0);
  const roof = new BufferGeometry();
  // Prism over the unit footprint, ridge along X, height 0.55.
  const h = 0.55;
  const v = [
    // two sloped faces
    -0.5, 1, -0.5, 0.5, 1, -0.5, 0.5, 1 + h, 0, -0.5, 1, -0.5, 0.5, 1 + h, 0, -0.5, 1 + h, 0,
    -0.5, 1, 0.5, -0.5, 1 + h, 0, 0.5, 1 + h, 0, -0.5, 1, 0.5, 0.5, 1 + h, 0, 0.5, 1, 0.5,
    // gable ends
    -0.5, 1, -0.5, -0.5, 1 + h, 0, -0.5, 1, 0.5, 0.5, 1, 0.5, 0.5, 1 + h, 0, 0.5, 1, -0.5,
  ];
  roof.setAttribute('position', new Float32BufferAttribute(v, 3));
  roof.computeVertexNormals();
  return { walls, roof };
}

/* ------------------------------------------------------------------ */
/* Rising parts                                                         */

interface RisingPart {
  object: Object3D;
  baseY: number;
  depth: number;
  a: number;
  b: number;
}

interface InstanceSpec {
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  rotY: number;
  a: number;
  b: number;
  depth: number;
}

/** InstancedMesh whose instances rise individually (staggered waves). */
class RisingInstances {
  readonly mesh: InstancedMesh;
  private readonly specs: InstanceSpec[];
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly p = new Vector3();
  private readonly s = new Vector3();
  private readonly up = new Vector3(0, 1, 0);
  constructor(geometry: BufferGeometry, material: Material, specs: InstanceSpec[]) {
    this.specs = specs;
    this.mesh = new InstancedMesh(geometry, material, Math.max(1, specs.length));
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
  }
  setRise(t: number): void {
    let visible = 0;
    for (let i = 0; i < this.specs.length; i++) {
      const sp = this.specs[i];
      const k = stage(t, sp.a, sp.b);
      if (k <= 0.001) {
        this.m.makeScale(0, 0, 0);
      } else {
        visible++;
        this.q.setFromAxisAngle(this.up, sp.rotY);
        this.p.set(sp.x, sp.y - sp.depth * (1 - k), sp.z);
        this.s.set(sp.sx, sp.sy, sp.sz);
        this.m.compose(this.p, this.q, this.s);
      }
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.visible = visible > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

export interface ClockworkCity {
  group: Group;
  /** 0 = sunk into the map, 1 = fully risen. */
  setRise(t: number): void;
  readonly rise: number;
  /** Idle mechanics (gears, galleys), seconds. */
  update(timeSeconds: number): void;
  dispose(): void;
}

export function buildConstantinople(mats: ClockworkMaterials, seed = 330): ClockworkCity {
  const group = new Group();
  const parts: RisingPart[] = [];
  const instanced: RisingInstances[] = [];
  const geometries: BufferGeometry[] = [];
  const gears: Array<{ object: Object3D; speed: number; axis: 'y' | 'z' }> = [];
  const ships: Array<{ object: Object3D; phase: number; baseY: number }> = [];
  const rand = mulberry32(seed);
  const track = <G extends BufferGeometry>(g: G) => (geometries.push(g), g);

  const add = (object: Object3D, a: number, b: number, depth: number) => {
    object.traverse((o) => {
      if ((o as Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        o.frustumCulled = false;
      }
    });
    group.add(object);
    parts.push({ object, baseY: object.position.y, depth, a, b });
    return object;
  };
  const mesh = (g: BufferGeometry, m: Material) => new Mesh(track(g), m);

  /* ---- pedestal, gear rim, sea inset ---- */
  const pedestalG = track(new CylinderGeometry(1.3, 1.36, 0.7, 6, 1));
  pedestalG.translate(0, -0.35, 0);
  pedestalG.rotateY(Math.PI / 6);
  const pedestal = new Mesh(pedestalG, mats.bronze);
  const trimG = track(new CylinderGeometry(1.33, 1.33, 0.035, 6, 1, true));
  trimG.rotateY(Math.PI / 6);
  const trim = new Mesh(trimG, mats.brass);
  trim.position.y = -0.03;
  pedestal.add(trim);
  const seaG = track(new CylinderGeometry(1.24, 1.24, 0.01, 6));
  seaG.rotateY(Math.PI / 6);
  const sea = new Mesh(seaG, mats.lacquer);
  sea.position.y = 0.004;
  pedestal.add(sea);
  add(pedestal, 0, 0.2, 0.75);

  const rimGear = new Mesh(track(gearGeometry(1.5, 1.4, 96, 0.05, 1.3)), mats.brass);
  rimGear.position.y = -0.1;
  add(rimGear, 0.02, 0.22, 0.75);
  gears.push({ object: rimGear, speed: 0.12, axis: 'y' });

  // Exposed flat gears around the pedestal, meshing in alternating spin.
  const flatGears: Array<[number, number, number, number, number]> = [
    // angle°, distance, radius, y, speed
    [205, 1.72, 0.3, -0.16, -0.5],
    [245, 1.78, 0.2, -0.08, 0.75],
    [330, 1.7, 0.36, -0.2, 0.42],
    [60, 1.74, 0.26, -0.12, -0.58],
    [120, 1.66, 0.18, -0.06, 0.9],
  ];
  for (const [deg, dist, r, y, speed] of flatGears) {
    const g = new Mesh(track(gearGeometry(r, r * 0.84, Math.round(r * 60), 0.045, r * 0.25)), rand() > 0.5 ? mats.brass : mats.bronze);
    const a = (deg * Math.PI) / 180;
    g.position.set(Math.cos(a) * dist, y, Math.sin(a) * dist);
    const hub = mesh(new CylinderGeometry(r * 0.22, r * 0.22, 0.08, 16), mats.iron);
    hub.position.y = 0.03;
    g.add(hub);
    add(g, 0.0, 0.25, 0.6);
    gears.push({ object: g, speed, axis: 'y' });
  }
  // Two upright gears half-sunk beside the pedestal (visible edge-on teeth).
  for (const [deg, r, speed] of [
    [160, 0.42, 0.3],
    [15, 0.34, -0.36],
  ] as Array<[number, number, number]>) {
    const pivot = new Group();
    const g = new Mesh(track(gearGeometry(r, r * 0.86, Math.round(r * 50), 0.05, r * 0.3)), mats.brass);
    g.rotation.x = Math.PI / 2; // stand the gear up
    const spinner = new Group();
    spinner.add(g);
    const a = (deg * Math.PI) / 180;
    pivot.position.set(Math.cos(a) * 1.42, -0.05, Math.sin(a) * 1.42);
    pivot.rotation.y = -a + Math.PI / 2;
    pivot.add(spinner);
    add(pivot, 0.05, 0.3, 0.9);
    gears.push({ object: spinner, speed, axis: 'z' });
  }

  /* ---- the land: peninsula + Galata ---- */
  const land = mesh(slab(PENINSULA, 0.06), mats.stone);
  land.position.y = 0.0;
  add(land, 0.14, 0.36, 0.35);
  const galata = mesh(slab(GALATA, 0.05), mats.stoneWarm);
  add(galata, 0.18, 0.4, 0.35);
  const topY = 0.068; // slab top (incl. bevel)

  /* ---- walls ---- */
  const unitBox = track(new BoxGeometry(1, 1, 1));
  unitBox.translate(0, 0.5, 0);
  const wallSpecs: InstanceSpec[] = [];
  const towerSpecs: InstanceSpec[] = [];
  const merlonSpecs: InstanceSpec[] = [];
  const wallRun = (poly: P2[], closed: boolean, h: number, thick: number, a: number, b: number, towerEvery: number, towerH: number, offset = 0) => {
    const n = closed ? poly.length : poly.length - 1;
    for (let i = 0; i < n; i++) {
      const [ax, az] = poly[i];
      const [bx, bz] = poly[(i + 1) % poly.length];
      const len = Math.hypot(bx - ax, bz - az);
      const ang = Math.atan2(bz - az, bx - ax);
      const nx = -Math.sin(ang) * offset;
      const nz = Math.cos(ang) * offset;
      const delay = (i / n) * 0.35;
      wallSpecs.push({
        x: (ax + bx) / 2 + nx, y: topY, z: (az + bz) / 2 + nz,
        sx: len + thick, sy: h, sz: thick, rotY: -ang,
        a: a + delay * (b - a), b: b, depth: h + 0.05,
      });
    }
    for (const [k, p] of alongPolyline(poly, towerEvery, closed).entries()) {
      const nx = -Math.sin(p.angle) * offset;
      const nz = Math.cos(p.angle) * offset;
      const d = (k * 0.013) % 0.35;
      towerSpecs.push({
        x: p.x + nx, y: topY, z: p.z + nz, sx: thick * 2.1, sy: towerH, sz: thick * 2.1, rotY: -p.angle,
        a: a + d * (b - a), b: Math.min(1, b + 0.05), depth: towerH + 0.05,
      });
    }
    for (const p of alongPolyline(poly, 0.022, closed)) {
      const nx = -Math.sin(p.angle) * offset;
      const nz = Math.cos(p.angle) * offset;
      merlonSpecs.push({
        x: p.x + nx, y: topY + h, z: p.z + nz, sx: 0.011, sy: 0.012, sz: thick * 1.05, rotY: -p.angle,
        a: b - 0.02, b: Math.min(1, b + 0.06), depth: h,
      });
    }
  };
  // Theodosian land walls: inner + outer wall, great towers.
  wallRun(LAND_WALL, false, 0.1, 0.022, 0.3, 0.6, 0.085, 0.15);
  wallRun(LAND_WALL, false, 0.06, 0.016, 0.34, 0.62, 0.085, 0.085, 0.05);
  // Sea walls along the rest of the shore (lower, sparser towers).
  const seaShore = PENINSULA.slice(0, PENINSULA.length - 3);
  wallRun(seaShore, false, 0.05, 0.014, 0.36, 0.66, 0.15, 0.08, -0.012);
  wallRun(GALATA, true, 0.04, 0.012, 0.42, 0.7, 0.16, 0.07, -0.01);
  const walls = new RisingInstances(unitBox, mats.stone, wallSpecs);
  const towers = new RisingInstances(unitBox, mats.stoneWarm, towerSpecs);
  const merlons = new RisingInstances(unitBox, mats.stone, merlonSpecs);
  for (const r of [walls, towers, merlons]) {
    group.add(r.mesh);
    instanced.push(r);
  }

  // Golden Gate: triumphal gate at the south end of the land walls.
  const golden = new Group();
  golden.position.set(-0.95, topY, 0.43);
  golden.rotation.y = 0.1;
  const gateBody = mesh(new BoxGeometry(0.1, 0.13, 0.07), mats.stone);
  gateBody.position.y = 0.065;
  golden.add(gateBody);
  for (const dz of [-0.055, 0.055]) {
    const t = mesh(new BoxGeometry(0.06, 0.17, 0.06), mats.stoneWarm);
    t.position.set(0, 0.085, dz);
    golden.add(t);
  }
  const gild = mesh(new BoxGeometry(0.105, 0.012, 0.075), mats.gold);
  gild.position.y = 0.136;
  golden.add(gild);
  add(golden, 0.5, 0.72, 0.25);

  /* ---- the city quarter ---- */
  const avoid: Array<[number, number, number]> = [
    [0.64, -0.03, 0.14], // Hagia Sophia
    [0.32, 0.17, 0.2], // Hippodrome
    [0.56, 0.2, 0.12], // Great Palace
    [0.12, 0.05, 0.05], // Column of Constantine
    [-0.72, -0.44, 0.1], // Blachernae
  ];
  const { walls: houseWallsG, roof: houseRoofG } = houseGeometries();
  track(houseWallsG);
  track(houseRoofG);
  const houseSpecs: InstanceSpec[] = [];
  for (let tries = 0; tries < 6000 && houseSpecs.length < 360; tries++) {
    const x = -1.0 + rand() * 2.0;
    const z = -0.55 + rand() * 1.1;
    if (!insidePolygon(x, z, PENINSULA)) continue;
    if (distToPolyline(x, z, PENINSULA, true) < 0.045) continue;
    if (avoid.some(([ax, az, r]) => Math.hypot(x - ax, z - az) < r)) continue;
    const s = 0.022 + rand() * 0.02;
    const radial = Math.hypot(x - 0.2, z);
    const a = 0.42 + Math.min(0.35, radial * 0.25) + rand() * 0.04;
    houseSpecs.push({
      x, y: topY, z, sx: s * (1 + rand() * 0.6), sy: 0.018 + rand() * 0.028, sz: s,
      rotY: 0.35 + (rand() - 0.5) * 0.3, a, b: Math.min(1, a + 0.14), depth: 0.12,
    });
  }
  // Galata / Pera across the Horn: a smaller merchant quarter.
  for (let tries = 0; tries < 1500 && houseSpecs.length < 430; tries++) {
    const x = -0.1 + rand() * 1.0;
    const z = -0.97 + rand() * 0.45;
    if (!insidePolygon(x, z, GALATA)) continue;
    if (distToPolyline(x, z, GALATA, true) < 0.04 || Math.hypot(x - 0.42, z + 0.76) < 0.06) continue;
    const s = 0.02 + rand() * 0.016;
    const a = 0.5 + rand() * 0.2;
    houseSpecs.push({
      x, y: 0.058, z, sx: s * (1 + rand() * 0.5), sy: 0.016 + rand() * 0.02, sz: s,
      rotY: -0.2 + (rand() - 0.5) * 0.3, a, b: Math.min(1, a + 0.14), depth: 0.12,
    });
  }
  const houseWalls = new RisingInstances(houseWallsG, mats.stoneWarm, houseSpecs);
  const houseRoofs = new RisingInstances(houseRoofG, mats.roof, houseSpecs);
  for (const r of [houseWalls, houseRoofs]) {
    group.add(r.mesh);
    instanced.push(r);
  }

  /* ---- Hagia Sophia: gilt dome unfolding from petals ---- */
  const sophia = new Group();
  sophia.position.set(0.64, topY, -0.03);
  sophia.rotation.y = 0.12;
  const naos = mesh(new BoxGeometry(0.2, 0.075, 0.17), mats.stone);
  naos.position.y = 0.0375;
  sophia.add(naos);
  for (const [bx, bz] of [[-0.1, -0.085], [0.1, -0.085], [-0.1, 0.085], [0.1, 0.085]] as P2[]) {
    const b = mesh(new BoxGeometry(0.035, 0.11, 0.035), mats.stoneWarm);
    b.position.set(bx, 0.055, bz);
    sophia.add(b);
  }
  const drum = mesh(new CylinderGeometry(0.068, 0.07, 0.03, 32), mats.stoneWarm);
  drum.position.y = 0.09;
  sophia.add(drum);
  for (const sx of [-1, 1]) {
    const half = mesh(new SphereGeometry(0.052, 24, 10, 0, Math.PI, 0, Math.PI / 2), mats.bronze);
    half.rotation.y = sx > 0 ? -Math.PI / 2 : Math.PI / 2;
    half.position.set(sx * 0.07, 0.075, 0);
    sophia.add(half);
  }
  const petals: Group[] = [];
  const PETALS = 8;
  const domeR = 0.066;
  for (let i = 0; i < PETALS; i++) {
    const phi = (i / PETALS) * Math.PI * 2;
    const len = (Math.PI * 2) / PETALS;
    const g = track(new SphereGeometry(domeR, 6, 10, phi, len, 0, Math.PI / 2));
    const mid = phi + len / 2;
    const mx = -Math.cos(mid) * domeR;
    const mz = Math.sin(mid) * domeR;
    g.translate(-mx, 0, -mz);
    const petal = new Mesh(g, mats.gold);
    const pivot = new Group();
    pivot.position.set(mx, 0.105, mz);
    pivot.userData.tangent = new Vector3(Math.sin(mid), 0, Math.cos(mid));
    pivot.add(petal);
    sophia.add(pivot);
    petals.push(pivot);
  }
  const cross = mesh(new BoxGeometry(0.004, 0.03, 0.004), mats.gold);
  cross.position.y = 0.105 + domeR + 0.012;
  sophia.add(cross);
  add(sophia, 0.55, 0.78, 0.3);

  /* ---- Hippodrome ---- */
  const hippo = new Group();
  hippo.position.set(0.32, topY, 0.17);
  hippo.rotation.y = 0.45;
  for (const dz of [-0.055, 0.055]) {
    const stand = mesh(new BoxGeometry(0.34, 0.035, 0.028), mats.stoneWarm);
    stand.position.set(0, 0.0175, dz);
    hippo.add(stand);
  }
  const sphendone = mesh(new TorusGeometry(0.055, 0.014, 6, 20, Math.PI), mats.stoneWarm);
  sphendone.rotation.x = -Math.PI / 2;
  sphendone.rotation.z = Math.PI / 2;
  sphendone.position.set(0.17, 0.014, 0);
  hippo.add(sphendone);
  const spina = mesh(new BoxGeometry(0.22, 0.008, 0.012), mats.stone);
  spina.position.y = 0.004;
  hippo.add(spina);
  const obelisk = mesh(new ConeGeometry(0.008, 0.08, 4), mats.porphyry);
  obelisk.position.set(-0.04, 0.048, 0);
  hippo.add(obelisk);
  const serpent = mesh(new CylinderGeometry(0.004, 0.005, 0.05, 8), mats.bronze);
  serpent.position.set(0.03, 0.033, 0);
  hippo.add(serpent);
  add(hippo, 0.5, 0.76, 0.2);

  /* ---- Great Palace terraces ---- */
  const palace = new Group();
  palace.position.set(0.56, topY, 0.2);
  palace.rotation.y = 0.3;
  for (const [i, [w, h, d]] of ([[0.16, 0.02, 0.1], [0.12, 0.04, 0.07], [0.07, 0.06, 0.05]] as Array<[number, number, number]>).entries()) {
    const t = mesh(new BoxGeometry(w, h, d), i === 2 ? mats.stoneWarm : mats.stone);
    t.position.set(-i * 0.015, h / 2, -i * 0.012);
    palace.add(t);
  }
  const pDome = mesh(new SphereGeometry(0.02, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), mats.gold);
  pDome.position.set(-0.03, 0.06, -0.024);
  palace.add(pDome);
  add(palace, 0.52, 0.8, 0.2);

  /* ---- Column of Constantine (porphyry + gilt statue) ---- */
  const column = new Group();
  column.position.set(0.12, topY, 0.05);
  const plinth = mesh(new BoxGeometry(0.035, 0.02, 0.035), mats.stone);
  plinth.position.y = 0.01;
  column.add(plinth);
  const shaft = mesh(new CylinderGeometry(0.011, 0.013, 0.26, 16), mats.porphyry);
  shaft.position.y = 0.15;
  column.add(shaft);
  for (let i = 0; i < 6; i++) {
    const band = mesh(new TorusGeometry(0.0125, 0.0018, 6, 18), mats.gold);
    band.rotation.x = Math.PI / 2;
    band.position.y = 0.04 + i * 0.042;
    column.add(band);
  }
  const statue = mesh(new ConeGeometry(0.009, 0.03, 10), mats.gold);
  statue.position.y = 0.295;
  column.add(statue);
  const head = mesh(new SphereGeometry(0.005, 10, 8), mats.gold);
  head.position.y = 0.314;
  column.add(head);
  add(column, 0.8, 0.98, 0.45);

  /* ---- Aqueduct of Valens ---- */
  const aqueduct = new Group();
  const aqA: P2 = [-0.38, -0.04];
  const aqB: P2 = [0.02, -0.18];
  const aqLen = Math.hypot(aqB[0] - aqA[0], aqB[1] - aqA[1]);
  const aqAng = Math.atan2(aqB[1] - aqA[1], aqB[0] - aqA[0]);
  aqueduct.position.set((aqA[0] + aqB[0]) / 2, topY, (aqA[1] + aqB[1]) / 2);
  aqueduct.rotation.y = -aqAng;
  const beam = mesh(new BoxGeometry(aqLen, 0.012, 0.014), mats.stoneWarm);
  beam.position.y = 0.055;
  aqueduct.add(beam);
  const piers = Math.round(aqLen / 0.03);
  for (let i = 0; i <= piers; i++) {
    const pier = mesh(new BoxGeometry(0.008, 0.05, 0.014), mats.stoneWarm);
    pier.position.set(-aqLen / 2 + (i / piers) * aqLen, 0.025, 0);
    aqueduct.add(pier);
  }
  add(aqueduct, 0.6, 0.84, 0.15);

  /* ---- Blachernae palace ---- */
  const blach = new Group();
  blach.position.set(-0.74, topY, -0.43);
  const bBody = mesh(new BoxGeometry(0.09, 0.05, 0.06), mats.stone);
  bBody.position.y = 0.025;
  blach.add(bBody);
  for (const dx of [-0.05, 0.05]) {
    const t = mesh(new CylinderGeometry(0.014, 0.016, 0.09, 12), mats.stoneWarm);
    t.position.set(dx, 0.045, -0.03);
    blach.add(t);
    const roof = mesh(new ConeGeometry(0.018, 0.03, 12), mats.copper);
    roof.position.set(dx, 0.105, -0.03);
    blach.add(roof);
  }
  add(blach, 0.55, 0.8, 0.2);

  /* ---- Galata tower ---- */
  const gTower = new Group();
  gTower.position.set(0.42, 0.058, -0.76);
  const gBody = mesh(new CylinderGeometry(0.022, 0.026, 0.13, 16), mats.stoneWarm);
  gBody.position.y = 0.065;
  gTower.add(gBody);
  const gRoof = mesh(new ConeGeometry(0.028, 0.05, 16), mats.copper);
  gRoof.position.y = 0.155;
  gTower.add(gRoof);
  add(gTower, 0.62, 0.86, 0.25);

  /* ---- The chain across the Golden Horn ---- */
  const chainA = new Vector3(0.66, 0.03, -0.24);
  const chainB = new Vector3(0.6, 0.03, -0.6);
  const links = 26;
  const linkG = track(new TorusGeometry(0.006, 0.0018, 5, 10));
  const chain = new InstancedMesh(linkG, mats.iron, links);
  const lm = new Matrix4();
  const lq = new Quaternion();
  const dir = chainB.clone().sub(chainA).normalize();
  for (let i = 0; i < links; i++) {
    const t = i / (links - 1);
    const p = chainA.clone().lerp(chainB, t);
    p.y -= Math.sin(Math.PI * t) * 0.025; // sag
    lq.setFromUnitVectors(new Vector3(1, 0, 0), dir);
    if (i % 2) lq.multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2));
    lm.compose(p, lq, new Vector3(1, 1, 1));
    chain.setMatrixAt(i, lm);
  }
  const chainGroup = new Group();
  chainGroup.add(chain);
  add(chainGroup, 0.86, 1.0, 0.1);

  /* ---- Galleys on the model's sea ---- */
  const hullG = track(new CapsuleGeometry(0.011, 0.06, 4, 10));
  hullG.rotateZ(Math.PI / 2);
  hullG.scale(1, 0.55, 1);
  const mastG = track(new CylinderGeometry(0.0015, 0.0015, 0.05, 6));
  const sailG = track(new BufferGeometry());
  sailG.setAttribute('position', new Float32BufferAttribute([-0.03, 0.012, 0, 0.022, 0.012, 0, -0.012, 0.06, 0], 3));
  sailG.computeVertexNormals();
  for (const [x, z, rot] of [
    [0.25, 0.46, 0.3],
    [0.6, 0.4, -0.2],
    [0.95, -0.35, 1.2],
    [-0.3, 0.6, 0.1],
    [0.2, -0.56, -0.1],
  ] as Array<[number, number, number]>) {
    const ship = new Group();
    ship.position.set(x, 0.012, z);
    ship.rotation.y = rot;
    ship.add(new Mesh(hullG, mats.wood));
    const mast = new Mesh(mastG, mats.wood);
    mast.position.y = 0.03;
    ship.add(mast);
    const sail = new Mesh(sailG, mats.linen);
    ship.add(sail);
    add(ship, 0.82, 1.0, 0.08);
    ships.push({ object: ship, phase: rand() * 6.28, baseY: ship.position.y });
  }

  /* ---- rise + mechanics ---- */
  let rise = 0;
  let time = 0;
  const tmpQ = new Quaternion();

  function applyRise(): void {
    for (const p of parts) {
      const k = stage(rise, p.a, p.b);
      p.object.position.y = p.baseY - p.depth * (1 - k);
      p.object.visible = k > 0.001;
    }
    for (const r of instanced) r.setRise(rise);
    // Dome petals: flat and open → closed dome.
    const k = stage(rise, 0.72, 0.96);
    const open = (1 - Math.min(1, k)) * (Math.PI / 2) * 0.98;
    for (const pivot of petals) {
      pivot.quaternion.copy(tmpQ.setFromAxisAngle(pivot.userData.tangent as Vector3, -open));
    }
    applyMechanics();
  }

  function applyMechanics(): void {
    // Gears turn with the clock AND with the rise (scrubbing turns them).
    const spin = time * 0.35 + rise * 9;
    for (const g of gears) {
      if (g.axis === 'y') g.object.rotation.y = spin * g.speed;
      else g.object.rotation.z = spin * g.speed;
    }
    for (const s of ships) {
      s.object.position.y = s.baseY + Math.sin(time * 1.3 + s.phase) * 0.002;
      s.object.rotation.z = Math.sin(time * 0.9 + s.phase) * 0.04;
    }
  }

  applyRise();

  return {
    group,
    get rise() {
      return rise;
    },
    setRise(t) {
      const next = Math.min(1, Math.max(0, t));
      if (next === rise) return;
      rise = next;
      applyRise();
    },
    update(t) {
      time = t;
      applyMechanics();
    },
    dispose() {
      for (const g of geometries) g.dispose();
      for (const r of instanced) r.mesh.dispose();
      chain.dispose();
    },
  };
}
