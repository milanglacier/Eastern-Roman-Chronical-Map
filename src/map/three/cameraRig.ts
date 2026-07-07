/**
 * Strategy-game camera: fixed north-up heading, pitch easing 55° (far) → 40°
 * (near), drag-to-pan on the ground plane (the grabbed point sticks to the
 * cursor), wheel zoom toward the cursor's ground point, target clamped to the
 * world rect. Pure math (pitch/clamp) is exported for unit tests.
 */
import { PerspectiveCamera, Vector3 } from 'three';
import { GROUND_W, GROUND_H } from './geo';

export const DIST_MIN = 14;
export const DIST_MAX = 175;
export const PITCH_NEAR = (40 * Math.PI) / 180;
export const PITCH_FAR = (55 * Math.PI) / 180;
const ZOOM_EXP = 0.0014;

/** Pitch eases with zoom: 55° when far out, 40° when close in. */
export function pitchForDistance(distance: number): number {
  const t = Math.min(1, Math.max(0, (distance - DIST_MIN) / (DIST_MAX - DIST_MIN)));
  return PITCH_NEAR + (PITCH_FAR - PITCH_NEAR) * t;
}

export function clampDistance(distance: number): number {
  return Math.min(DIST_MAX, Math.max(DIST_MIN, distance));
}

/** Keep the look-at target inside the world rect. */
export function clampTarget(x: number, z: number): { x: number; z: number } {
  return {
    x: Math.min(GROUND_W, Math.max(0, x)),
    z: Math.min(GROUND_H, Math.max(0, z)),
  };
}

export interface CameraRig {
  camera: PerspectiveCamera;
  /** Current distance (for fog scaling). */
  readonly distance: number;
  centerOn(x: number, z: number, distance: number): void;
  resize(width: number, height: number): void;
  dispose(): void;
}

export function createCameraRig(
  domElement: HTMLElement,
  onChange: () => void,
): CameraRig {
  const camera = new PerspectiveCamera(42, 1, 0.5, 1500);
  const state = { x: GROUND_W / 2, z: GROUND_H / 2, distance: DIST_MAX };

  function apply(): void {
    const pitch = pitchForDistance(state.distance);
    camera.position.set(
      state.x,
      state.distance * Math.sin(pitch),
      state.z + state.distance * Math.cos(pitch),
    );
    camera.lookAt(state.x, 0, state.z);
    camera.updateMatrixWorld();
    onChange();
  }

  const origin = new Vector3();
  const dir = new Vector3();
  /** Ray through a client point → intersection with the Y=0 plane. */
  function groundAt(clientX: number, clientY: number): { x: number; z: number } | null {
    const rect = domElement.getBoundingClientRect();
    const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ny = -(((clientY - rect.top) / rect.height) * 2 - 1);
    origin.set(nx, ny, 0.5).unproject(camera);
    dir.copy(origin).sub(camera.position).normalize();
    if (dir.y >= -1e-4) return null; // near-horizontal ray; ignore
    const t = -camera.position.y / dir.y;
    return { x: camera.position.x + dir.x * t, z: camera.position.z + dir.z * t };
  }

  let dragging = false;
  let grabbed: { x: number; z: number } | null = null;

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    dragging = true;
    grabbed = groundAt(e.clientX, e.clientY);
    domElement.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent) => {
    if (!dragging || !grabbed) return;
    const now = groundAt(e.clientX, e.clientY);
    if (!now) return;
    const c = clampTarget(state.x + (grabbed.x - now.x), state.z + (grabbed.z - now.z));
    state.x = c.x;
    state.z = c.z;
    apply();
  };
  const endDrag = (e: PointerEvent) => {
    dragging = false;
    grabbed = null;
    if (domElement.hasPointerCapture(e.pointerId)) domElement.releasePointerCapture(e.pointerId);
  };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const before = groundAt(e.clientX, e.clientY);
    state.distance = clampDistance(state.distance * Math.exp(e.deltaY * ZOOM_EXP));
    apply();
    // Keep the ground point under the cursor fixed through the zoom.
    const after = groundAt(e.clientX, e.clientY);
    if (before && after) {
      const c = clampTarget(state.x + (before.x - after.x), state.z + (before.z - after.z));
      state.x = c.x;
      state.z = c.z;
      apply();
    }
  };

  domElement.addEventListener('pointerdown', onPointerDown);
  domElement.addEventListener('pointermove', onPointerMove);
  domElement.addEventListener('pointerup', endDrag);
  domElement.addEventListener('pointercancel', endDrag);
  domElement.addEventListener('wheel', onWheel, { passive: false });

  apply();

  return {
    camera,
    get distance() {
      return state.distance;
    },
    centerOn(x, z, distance) {
      const c = clampTarget(x, z);
      state.x = c.x;
      state.z = c.z;
      state.distance = clampDistance(distance);
      apply();
    },
    resize(width, height) {
      camera.aspect = width / Math.max(1, height);
      camera.updateProjectionMatrix();
      onChange();
    },
    dispose() {
      domElement.removeEventListener('pointerdown', onPointerDown);
      domElement.removeEventListener('pointermove', onPointerMove);
      domElement.removeEventListener('pointerup', endDrag);
      domElement.removeEventListener('pointercancel', endDrag);
      domElement.removeEventListener('wheel', onWheel);
    },
  };
}
