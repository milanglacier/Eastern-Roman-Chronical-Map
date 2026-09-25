/**
 * Key light (sun by day, moon by night) + hemisphere fill, both driven by
 * the era mood, and a camera-following shadow frustum: one orthographic
 * cascade fitted each view change to the visible ground footprint around
 * the camera target (clamped, so near-horizon views don't blow it up) and
 * snapped to the shadow-texel grid so shadows never swim.
 */
import { Camera, DirectionalLight, Group, HemisphereLight, Vector3 } from 'three';
import type { Mood } from '../../lib/mood';
import { rayHitBentGround } from './curvature';

export interface Lighting {
  group: Group;
  key: DirectionalLight;
  hemi: HemisphereLight;
  /** Unit vector toward the key light (shared with water/sky uniforms). */
  readonly keyDir: Vector3;
  setMood(mood: Mood): void;
  /** Pin the key direction (the hall's astrolabe); null = follow the mood. */
  setDirectionOverride(dir: Vector3 | null): void;
  updateShadowFrustum(
    camera: Camera,
    target: { x: number; y: number; z: number },
    curve: { cx: number; cz: number; radius: number },
    distance: number,
  ): void;
  setShadowMapSize(size: number): void;
  dispose(): void;
}

/**
 * three.js lights are physical: diffuse = albedo · E / π. Mood intensities
 * are authored so ~1 means "the painted albedo at face value", so they are
 * scaled here (flat ground under a mid-height sun + sky fill ≈ albedo).
 */
const KEY_SCALE = Math.PI * 0.45;
const FILL_SCALE = Math.PI * 0.9;

export function createLighting(shadowMapSize = 2048, style: 'painted' | 'hall' | 'paper' = 'painted'): Lighting {
  // A dark hall: the key (astrolabe) dominates, the room fill is faint.
  // Paper: parchment is already bright — gentle light, so washes keep colour.
  const keyScale = KEY_SCALE * (style === 'hall' ? 1.3 : style === 'paper' ? 0.6 : 1);
  const fillScale = FILL_SCALE * (style === 'hall' ? 0.32 : style === 'paper' ? 0.58 : 1);
  const group = new Group();

  const key = new DirectionalLight(0xffffff, 2.4);
  key.castShadow = true;
  key.shadow.mapSize.set(shadowMapSize, shadowMapSize);
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.025;
  group.add(key);
  group.add(key.target);

  const hemi = new HemisphereLight(0x91b0d0, 0x54483a, 0.85);
  group.add(hemi);

  const keyDir = new Vector3(0, 1, 0);
  const lightRight = new Vector3();
  const lightUp = new Vector3();
  const corner = new Vector3();
  const dir = new Vector3();
  const center = new Vector3();
  let lastFit = { cx: 0, cz: 0, radius: 0, distance: 0, target: new Vector3(), camera: null as Camera | null };
  let override: Vector3 | null = null;
  const refit = () => {
    if (lastFit.camera) {
      updateShadowFrustum(lastFit.camera, lastFit.target, { cx: lastFit.cx, cz: lastFit.cz, radius: lastFit.radius }, lastFit.distance);
    }
  };

  function rebasis(): void {
    lightRight.crossVectors(new Vector3(0, 1, 0), keyDir);
    if (lightRight.lengthSq() < 1e-8) lightRight.set(1, 0, 0);
    lightRight.normalize();
    lightUp.crossVectors(keyDir, lightRight).normalize();
  }
  rebasis();

  function updateShadowFrustum(
    camera: Camera,
    target: { x: number; y: number; z: number },
    curve: { cx: number; cz: number; radius: number },
    distance: number,
  ): void {
    lastFit = { ...curve, distance, target: new Vector3(target.x, target.y, target.z), camera };
    // Farthest visible ground from the target along the four screen
    // corners, clamped: grazing views would otherwise demand a huge
    // cascade; the far field is hazed anyway.
    const reach = distance * 3;
    let radius = distance * 0.35;
    const ndc: Array<[number, number]> = [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ];
    for (const [nx, ny] of ndc) {
      corner.set(nx, ny, 0.5).unproject(camera);
      dir.copy(corner).sub(camera.position).normalize();
      const t = rayHitBentGround(
        camera.position.x, camera.position.y, camera.position.z,
        dir.x, dir.y, dir.z,
        curve.cx, curve.cz, curve.radius,
        target.y,
      );
      let hx: number;
      let hz: number;
      if (t === null) {
        hx = camera.position.x + dir.x * reach;
        hz = camera.position.z + dir.z * reach;
      } else {
        hx = camera.position.x + dir.x * t;
        hz = camera.position.z + dir.z * t;
      }
      radius = Math.max(radius, Math.min(reach, Math.hypot(hx - target.x, hz - target.z)));
    }
    center.set(target.x, target.y, target.z);
    // Quantize the radius so it changes rarely; within a step, texel
    // snapping below keeps the cascade rock-stable while panning.
    radius = 1.3 ** Math.ceil(Math.log(radius * 1.1) / Math.log(1.3));

    const size = key.shadow.mapSize.x;
    const texel = (2 * radius) / size;
    const cr = Math.round(center.dot(lightRight) / texel) * texel;
    const cu = Math.round(center.dot(lightUp) / texel) * texel;
    const cd = center.dot(keyDir);
    center.set(0, 0, 0).addScaledVector(lightRight, cr).addScaledVector(lightUp, cu).addScaledVector(keyDir, cd);

    key.position.copy(center).addScaledVector(keyDir, radius * 2);
    key.target.position.copy(center);
    key.target.updateMatrixWorld();
    const cam = key.shadow.camera;
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
    key,
    hemi,
    keyDir,
    setDirectionOverride(dir) {
      override = dir ? dir.clone().normalize() : null;
      if (override && override.distanceToSquared(keyDir) > 1e-10) {
        keyDir.copy(override);
        rebasis();
        refit();
      }
    },
    setMood(mood) {
      const prev = keyDir.clone();
      if (override) keyDir.copy(override);
      else keyDir.set(...mood.keyDir).normalize();
      key.color.setRGB(...mood.keyColor);
      key.intensity = mood.keyIntensity * keyScale;
      hemi.color.setRGB(...mood.ambientSky);
      hemi.groundColor.setRGB(...mood.ambientGround);
      hemi.intensity = mood.ambientIntensity * fillScale;
      if (prev.distanceToSquared(keyDir) > 1e-10) {
        rebasis();
        refit();
      }
    },
    updateShadowFrustum,
    setShadowMapSize(size) {
      if (key.shadow.mapSize.x === size) return;
      key.shadow.mapSize.set(size, size);
      key.shadow.map?.dispose();
      key.shadow.map = null as never;
    },
    dispose() {
      key.dispose();
      hemi.dispose();
    },
  };
}
