/**
 * Strategy-game camera: pitch easing 55° (far) → 40° (near), drag-to-pan on
 * the ground plane (the grabbed point sticks to the cursor), wheel zoom
 * toward the cursor's ground point, two-finger pinch zoom toward the pinch
 * midpoint, target clamped to a bounds rect. The world map keeps a fixed
 * north-up heading; a rig created with `rotatable` (the city view) also
 * orbits with right-drag / shift-drag. `flyTo` tweens target, distance and
 * heading for scripted transitions. Pure math (pitch/clamp/pinch) is
 * exported for unit tests.
 */
import { PerspectiveCamera, Vector3 } from 'three';
import { GROUND_W, GROUND_H } from './geo';

export const DIST_MIN = 14;
export const DIST_MAX = 220;
export const PITCH_NEAR = (40 * Math.PI) / 180;
export const PITCH_FAR = (55 * Math.PI) / 180;
const ZOOM_EXP = 0.0014;
const ORBIT_RAD_PER_PX = 0.006;

export interface RigLimits {
  distMin: number;
  distMax: number;
  pitchNear: number;
  pitchFar: number;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
}

export const WORLD_RIG_LIMITS: RigLimits = {
  distMin: DIST_MIN,
  distMax: DIST_MAX,
  pitchNear: PITCH_NEAR,
  pitchFar: PITCH_FAR,
  bounds: { minX: 0, maxX: GROUND_W, minZ: 0, maxZ: GROUND_H },
};

/** Pitch eases with zoom: `pitchFar` when far out, `pitchNear` when close in. */
export function pitchForDistance(distance: number, limits: RigLimits = WORLD_RIG_LIMITS): number {
  const { distMin, distMax, pitchNear, pitchFar } = limits;
  const t = Math.min(1, Math.max(0, (distance - distMin) / (distMax - distMin)));
  return pitchNear + (pitchFar - pitchNear) * t;
}

export function clampDistance(distance: number, limits: RigLimits = WORLD_RIG_LIMITS): number {
  return Math.min(limits.distMax, Math.max(limits.distMin, distance));
}

/** Keep the look-at target inside the bounds rect. */
export function clampTarget(
  x: number,
  z: number,
  limits: RigLimits = WORLD_RIG_LIMITS,
): { x: number; z: number } {
  const b = limits.bounds;
  return {
    x: Math.min(b.maxX, Math.max(b.minX, x)),
    z: Math.min(b.maxZ, Math.max(b.minZ, z)),
  };
}

/** Distance multiplier from a pinch span change: fingers spreading zooms in. */
export function pinchZoomFactor(prevSpan: number, span: number): number {
  if (prevSpan <= 0 || span <= 0) return 1;
  return prevSpan / span;
}

/** Midpoint and span of a two-finger gesture in client coordinates. */
export function pinchMidSpan(
  a: { x: number; y: number },
  b: { x: number; y: number },
): { mid: { x: number; y: number }; span: number } {
  return {
    mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    span: Math.hypot(a.x - b.x, a.y - b.y),
  };
}

export interface RigOptions {
  limits?: RigLimits;
  near?: number;
  far?: number;
  /** Allow orbiting the heading (right-drag / shift-drag). */
  rotatable?: boolean;
}

export interface FlyTarget {
  x: number;
  z: number;
  distance: number;
  /** Radians; 0 = looking north. Omitted = keep current. */
  heading?: number;
}

export interface CameraRig {
  camera: PerspectiveCamera;
  /** Current distance (for fog scaling). */
  readonly distance: number;
  /** Current look-at ground point. */
  readonly target: { x: number; z: number };
  readonly heading: number;
  /** Input handling on/off (several rigs may share one canvas). */
  enabled: boolean;
  centerOn(x: number, z: number, distance: number, heading?: number): void;
  /** Tween to a view over `durationMs` (ease in-out); resolves on arrival. */
  flyTo(target: FlyTarget, durationMs: number): Promise<void>;
  /** Advance any running tween; call once per frame. */
  update(timeMs: number): void;
  resize(width: number, height: number): void;
  dispose(): void;
}

export function createCameraRig(
  domElement: HTMLElement,
  onChange: () => void,
  options: RigOptions = {},
): CameraRig {
  const limits = options.limits ?? WORLD_RIG_LIMITS;
  const rotatable = options.rotatable ?? false;
  const camera = new PerspectiveCamera(42, 1, options.near ?? 0.5, options.far ?? 1500);
  const b = limits.bounds;
  const state = {
    x: (b.minX + b.maxX) / 2,
    z: (b.minZ + b.maxZ) / 2,
    distance: limits.distMax,
    heading: 0,
  };
  const clampD = (d: number) => clampDistance(d, limits);
  const clampT = (x: number, z: number) => clampTarget(x, z, limits);

  function apply(): void {
    const pitch = pitchForDistance(state.distance, limits);
    const horiz = state.distance * Math.cos(pitch);
    camera.position.set(
      state.x - Math.sin(state.heading) * horiz,
      state.distance * Math.sin(pitch),
      state.z + Math.cos(state.heading) * horiz,
    );
    camera.lookAt(state.x, 0, state.z);
    camera.updateMatrixWorld();
    onChange();
  }

  let tween: {
    from: { x: number; z: number; distance: number; heading: number };
    to: { x: number; z: number; distance: number; heading: number };
    start: number;
    duration: number;
    resolve: () => void;
  } | null = null;

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

  // One pointer drags the grabbed ground point; two pointers pinch-zoom around
  // the ground point under their midpoint (which also pans — one rule covers both).
  const pointers = new Map<number, { x: number; y: number }>();
  let grabbed: { x: number; z: number } | null = null;
  let pinchPrevSpan = 0;

  function twoPointers(): { mid: { x: number; y: number }; span: number } {
    const [a, b] = [...pointers.values()];
    return pinchMidSpan(a, b);
  }

  /** Re-anchor the gesture after any pointer count change. */
  function regrab(): void {
    if (pointers.size === 1) {
      const [p] = [...pointers.values()];
      grabbed = groundAt(p.x, p.y);
    } else if (pointers.size === 2) {
      const { mid, span } = twoPointers();
      grabbed = groundAt(mid.x, mid.y);
      pinchPrevSpan = span;
    } else {
      grabbed = null; // idle, or 3+ fingers: suspend until the count settles
    }
  }

  /** Shift the target so the grabbed ground point returns under the client point. */
  function panGrabbedTo(clientX: number, clientY: number): void {
    if (!grabbed) return;
    const now = groundAt(clientX, clientY);
    if (!now) return;
    const c = clampT(state.x + (grabbed.x - now.x), state.z + (grabbed.z - now.z));
    state.x = c.x;
    state.z = c.z;
    apply();
  }

  let orbit: { pointerId: number; lastX: number } | null = null;

  const onPointerDown = (e: PointerEvent) => {
    if (!rig.enabled) return;
    tween = null; // user input interrupts scripted motion
    const wantsOrbit = rotatable && e.pointerType === 'mouse' && (e.button === 2 || e.shiftKey);
    if (wantsOrbit) {
      orbit = { pointerId: e.pointerId, lastX: e.clientX };
      domElement.setPointerCapture(e.pointerId);
      return;
    }
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    regrab();
    // Last: capture can throw for pointers the browser no longer tracks.
    domElement.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent) => {
    if (orbit && orbit.pointerId === e.pointerId) {
      state.heading += (e.clientX - orbit.lastX) * ORBIT_RAD_PER_PX;
      orbit.lastX = e.clientX;
      apply();
      return;
    }
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      panGrabbedTo(e.clientX, e.clientY);
    } else if (pointers.size === 2) {
      const { mid, span } = twoPointers();
      state.distance = clampD(state.distance * pinchZoomFactor(pinchPrevSpan, span));
      pinchPrevSpan = span;
      apply();
      panGrabbedTo(mid.x, mid.y);
    }
  };
  const onPointerEnd = (e: PointerEvent) => {
    if (orbit && orbit.pointerId === e.pointerId) {
      orbit = null;
      if (domElement.hasPointerCapture(e.pointerId)) domElement.releasePointerCapture(e.pointerId);
      return;
    }
    if (!pointers.delete(e.pointerId)) return;
    if (domElement.hasPointerCapture(e.pointerId)) domElement.releasePointerCapture(e.pointerId);
    regrab();
  };
  const onContextMenu = (e: Event) => {
    if (rig.enabled && rotatable) e.preventDefault();
  };
  const onWheel = (e: WheelEvent) => {
    if (!rig.enabled) return;
    e.preventDefault();
    tween = null;
    const before = groundAt(e.clientX, e.clientY);
    state.distance = clampD(state.distance * Math.exp(e.deltaY * ZOOM_EXP));
    apply();
    // Keep the ground point under the cursor fixed through the zoom.
    const after = groundAt(e.clientX, e.clientY);
    if (before && after) {
      const c = clampT(state.x + (before.x - after.x), state.z + (before.z - after.z));
      state.x = c.x;
      state.z = c.z;
      apply();
    }
  };

  domElement.addEventListener('pointerdown', onPointerDown);
  domElement.addEventListener('pointermove', onPointerMove);
  domElement.addEventListener('pointerup', onPointerEnd);
  domElement.addEventListener('pointercancel', onPointerEnd);
  domElement.addEventListener('wheel', onWheel, { passive: false });
  domElement.addEventListener('contextmenu', onContextMenu);

  const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

  const rig: CameraRig = {
    camera,
    enabled: true,
    get distance() {
      return state.distance;
    },
    get target() {
      return { x: state.x, z: state.z };
    },
    get heading() {
      return state.heading;
    },
    centerOn(x, z, distance, heading) {
      tween = null;
      const c = clampT(x, z);
      state.x = c.x;
      state.z = c.z;
      state.distance = clampD(distance);
      if (heading !== undefined) state.heading = heading;
      apply();
    },
    flyTo(target, durationMs) {
      tween?.resolve();
      const c = clampT(target.x, target.z);
      return new Promise<void>((resolve) => {
        tween = {
          from: { x: state.x, z: state.z, distance: state.distance, heading: state.heading },
          to: {
            x: c.x,
            z: c.z,
            distance: clampD(target.distance),
            heading: target.heading ?? state.heading,
          },
          start: -1,
          duration: Math.max(1, durationMs),
          resolve,
        };
      });
    },
    update(timeMs) {
      if (!tween) return;
      if (tween.start < 0) tween.start = timeMs;
      const t = Math.min(1, (timeMs - tween.start) / tween.duration);
      const k = ease(t);
      const { from, to } = tween;
      state.x = from.x + (to.x - from.x) * k;
      state.z = from.z + (to.z - from.z) * k;
      // Zoom geometrically so the dive feels uniform across scales.
      state.distance = from.distance * (to.distance / from.distance) ** k;
      state.heading = from.heading + (to.heading - from.heading) * k;
      apply();
      if (t >= 1) {
        const done = tween.resolve;
        tween = null;
        done();
      }
    },
    resize(width, height) {
      camera.aspect = width / Math.max(1, height);
      camera.updateProjectionMatrix();
      onChange();
    },
    dispose() {
      domElement.removeEventListener('pointerdown', onPointerDown);
      domElement.removeEventListener('pointermove', onPointerMove);
      domElement.removeEventListener('pointerup', onPointerEnd);
      domElement.removeEventListener('pointercancel', onPointerEnd);
      domElement.removeEventListener('wheel', onWheel);
      domElement.removeEventListener('contextmenu', onContextMenu);
      tween?.resolve();
      tween = null;
    },
  };
  apply();
  return rig;
}
