/**
 * Collects procedural geometry per material key and bakes it into one
 * merged mesh per material — a whole landmark (or all walls) becomes a
 * handful of draw calls.
 */
import { BufferGeometry, Group, Mesh } from 'three';
import type { CityMaterials } from './palette';
import { merge } from './geom';

export type MatKey = Exclude<keyof CityMaterials, 'dispose'>;

export class Batch {
  private parts = new Map<MatKey, BufferGeometry[]>();

  add(mat: MatKey, geom: BufferGeometry): void {
    const list = this.parts.get(mat);
    if (list) list.push(geom);
    else this.parts.set(mat, [geom]);
  }

  /** One mesh per material, all casting/receiving shadows. */
  build(mats: CityMaterials, name: string): Group {
    const group = new Group();
    group.name = name;
    for (const [key, geoms] of this.parts) {
      const merged = merge(geoms);
      if (!merged) continue;
      const mesh = new Mesh(merged, mats[key]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    this.parts.clear();
    return group;
  }
}

/** Dispose every geometry under a group (materials are shared; not disposed). */
export function disposeGroup(group: Group): void {
  group.traverse((o) => {
    if (o instanceof Mesh) o.geometry.dispose();
  });
}
