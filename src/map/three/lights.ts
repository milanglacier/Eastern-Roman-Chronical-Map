/**
 * Sun + sky lighting, and a camera-following shadow frustum: one orthographic
 * cascade fitted each view change to the visible ground footprint and snapped
 * to the shadow-texel grid so shadows stay sharp at every zoom and never swim.
 */
import {
  Camera,
  DirectionalLight,
  Group,
  HemisphereLight,
  Vector3,
} from 'three';
import { SUN_COLOR, HEMI_SKY_COLOR, HEMI_GROUND_COLOR } from './palette';

const SHADOW_MAP_SIZE = 2048;

/**
 * Sun direction: from the WSW, same azimuth as the baked hillshade sun but
 * lower (34° vs 48°) — the baked pass is the soft painterly base while the
 * real-time sun rakes the exaggerated relief with long cast shadows.
 */
export const SUN_DIRECTION = (() => {
  const az = (247 * Math.PI) / 180; // clockwise from north; north = -Z, east = +X
  const alt = (34 * Math.PI) / 180;
  return new Vector3(
    Math.sin(az) * Math.cos(alt),
    Math.sin(alt),
    -Math.cos(az) * Math.cos(alt),
  ).normalize();
})();

export interface Lighting {
  group: Group;
  sun: DirectionalLight;
  updateShadowFrustum(camera: Camera, viewportW: number, viewportH: number): void;
  dispose(): void;
}

export function createLighting(): Lighting {
  const group = new Group();

  const sun = new DirectionalLight(SUN_COLOR, 2.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  group.add(sun);
  group.add(sun.target);

  const hemi = new HemisphereLight(HEMI_SKY_COLOR, HEMI_GROUND_COLOR, 0.85);
  group.add(hemi);

  // Scratch vectors (no per-frame allocation).
  const corner = new Vector3();
  const dir = new Vector3();
  const center = new Vector3();
  const lightRight = new Vector3().crossVectors(new Vector3(0, 1, 0), SUN_DIRECTION).normalize();
  const lightUp = new Vector3().crossVectors(SUN_DIRECTION, lightRight).normalize();

  const groundHits: Vector3[] = [new Vector3(), new Vector3(), new Vector3(), new Vector3()];

  function updateShadowFrustum(camera: Camera): void {
    // Unproject the 4 screen corners onto the Y=0 plane.
    const ndc: Array<[number, number]> = [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ];
    center.set(0, 0, 0);
    let maxT = 0;
    for (let i = 0; i < 4; i++) {
      corner.set(ndc[i][0], ndc[i][1], 0.5).unproject(camera);
      dir.copy(corner).sub(camera.position).normalize();
      // At 40–55° down pitch every corner ray hits the ground; clamp anyway
      // so a near-horizontal ray can't explode the frustum.
      const t = dir.y < -0.05 ? -camera.position.y / dir.y : 300;
      const tc = Math.min(t, 300);
      maxT = Math.max(maxT, tc);
      groundHits[i].copy(camera.position).addScaledVector(dir, tc);
      center.add(groundHits[i]);
    }
    center.multiplyScalar(0.25);

    let radius = 0;
    for (const hit of groundHits) radius = Math.max(radius, hit.distanceTo(center));
    // Quantize the radius so it changes rarely; within a step, texel
    // snapping below keeps the cascade rock-stable while panning.
    radius = 1.3 ** Math.ceil(Math.log(radius * 1.15) / Math.log(1.3));

    // Snap the frustum center to the shadow-texel grid in light space.
    const texel = (2 * radius) / SHADOW_MAP_SIZE;
    const cr = Math.round(center.dot(lightRight) / texel) * texel;
    const cu = Math.round(center.dot(lightUp) / texel) * texel;
    const cd = center.dot(SUN_DIRECTION);
    center
      .set(0, 0, 0)
      .addScaledVector(lightRight, cr)
      .addScaledVector(lightUp, cu)
      .addScaledVector(SUN_DIRECTION, cd);

    sun.position.copy(center).addScaledVector(SUN_DIRECTION, radius * 2);
    sun.target.position.copy(center);
    sun.target.updateMatrixWorld();
    const cam = sun.shadow.camera;
    cam.left = -radius;
    cam.right = radius;
    cam.top = radius;
    cam.bottom = -radius;
    cam.near = 0.1;
    cam.far = radius * 4;
    cam.updateProjectionMatrix();
  }

  return {
    group,
    sun,
    updateShadowFrustum,
    dispose() {
      sun.dispose();
      hemi.dispose();
    },
  };
}
