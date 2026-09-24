/**
 * Ships: procedural lateen-rigged hulls (the rig of Roman dromons and
 * merchantmen), instanced in three parts (hull, mast, sail) and bobbing
 * gently at their moorings. Each ship belongs to a mooring group whose
 * visibility the city model switches by year (harbours silt up, trade
 * rises and falls).
 */
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  InstancedMesh,
  Matrix4,
  Quaternion,
  Vector3,
} from 'three';
import { cylinder } from './geom';
import type { CityMaterials } from './palette';

export interface ShipSpot {
  x: number;
  z: number;
  rotY: number;
  /** Hull length in metres. */
  length: number;
  group: string;
  /** Fixed draw in [0,1): shown when below the group's current share. */
  threshold: number;
  phase: number;
}

function hullGeometry(): BufferGeometry {
  // Unit hull along X: pointed bow and stern, rounded-ish bottom.
  const g = new BoxGeometry(1, 0.3, 0.26, 8, 1, 2);
  const p = g.getAttribute('position') as BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const e = Math.abs(x * 2);
    p.setZ(i, p.getZ(i) * (1 - e ** 2.2 * 0.9));
    if (p.getY(i) < 0) p.setY(i, p.getY(i) * (1 - e * 0.6));
    else p.setY(i, p.getY(i) + e ** 3 * 0.12); // raised ends
  }
  g.translate(0, 0.08, 0);
  g.computeVertexNormals();
  return g;
}

function sailGeometry(): BufferGeometry {
  // Lateen triangle hung from a long yard: tall peak aft, clew low forward.
  const v = new Float32Array([0.42, 0.18, 0, -0.38, 0.95, 0, -0.1, 0.18, 0]);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(v, 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0, 1, 1, 0.5, 0]), 2));
  g.setIndex([0, 1, 2]);
  g.computeVertexNormals();
  return g;
}

export interface Fleet {
  meshes: InstancedMesh[];
  /** Share (0..1) of each group's spots that are occupied. */
  setShares(shares: Record<string, number>): void;
  update(timeSec: number): void;
  dispose(): void;
}

export function createFleet(spots: ShipSpot[], mats: CityMaterials): Fleet {
  const n = Math.max(1, spots.length);
  const hullGeo = hullGeometry();
  const mastGeo = cylinder(0.012, 0.9, 5);
  const sailGeo = sailGeometry();
  const hulls = new InstancedMesh(hullGeo, mats.hull, n);
  const masts = new InstancedMesh(mastGeo, mats.timber, n);
  const sails = new InstancedMesh(sailGeo, mats.sail, n);
  const meshes = [hulls, masts, sails];
  for (const m of meshes) {
    m.instanceMatrix.setUsage(DynamicDrawUsage);
    m.castShadow = true;
    m.frustumCulled = false;
  }
  const shown = new Uint8Array(spots.length);
  const m4 = new Matrix4();
  const q = new Quaternion();
  const tilt = new Quaternion();
  const up = new Vector3(0, 1, 0);
  const fwd = new Vector3(1, 0, 0);
  const pos = new Vector3();
  const scl = new Vector3();
  const zero = new Matrix4().makeScale(0, 0, 0);

  const write = (i: number, t: number) => {
    const s = spots[i];
    if (!shown[i]) {
      for (const m of meshes) m.setMatrixAt(i, zero);
      return;
    }
    const bob = Math.sin(t * 0.9 + s.phase) * 0.25;
    q.setFromAxisAngle(up, s.rotY);
    tilt.setFromAxisAngle(fwd, Math.sin(t * 0.7 + s.phase * 1.7) * 0.03);
    q.multiply(tilt);
    pos.set(s.x, bob, s.z);
    const L = s.length;
    scl.set(L, L, L);
    m4.compose(pos, q, scl);
    hulls.setMatrixAt(i, m4);
    masts.setMatrixAt(i, m4);
    sails.setMatrixAt(i, m4);
  };

  return {
    meshes,
    setShares(shares) {
      spots.forEach((s, i) => {
        shown[i] = s.threshold < (shares[s.group] ?? 0) ? 1 : 0;
      });
    },
    update(timeSec) {
      for (let i = 0; i < spots.length; i++) write(i, timeSec);
      for (const m of meshes) m.instanceMatrix.needsUpdate = true;
    },
    dispose() {
      hullGeo.dispose();
      mastGeo.dispose();
      sailGeo.dispose();
      for (const m of meshes) m.dispose();
    },
  };
}
