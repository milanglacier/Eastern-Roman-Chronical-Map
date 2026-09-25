/**
 * Free 3D orbit camera over the curved world.
 *
 * State is a look-at target on the ground plus distance / heading / pitch.
 * The camera can tilt from straight down to near the horizon (the curved-earth
 * bend in curvature.ts makes the world fall away beneath the horizon, so
 * the map's rectangular edge is never seen), rotate freely, and fly
 * cinematically between poses.
 *
 * Input:
 *   mouse   left-drag pan · right/ctrl/shift-drag orbit + tilt · wheel zoom to cursor
 *   touch   1 finger pan · 2 fingers pinch-zoom + twist-rotate (+ parallel
 *           vertical drag = tilt) · 3 fingers tilt
 *   keys    Q/E rotate · R/F tilt · W/A/S/D pan · N north-up
 *
 * Pure helpers (clamps, pinch math, pose easing) are exported for tests.
 */
import { PerspectiveCamera, Vector3 } from 'three';
import { GROUND_W, GROUND_H } from './geo';
import { bendDrop, curvatureUniforms, curveRadiusForDistance, rayHitBentGround } from './curvature';

export const DIST_MIN = 3;
export const DIST_MAX = 220;
const DEG = Math.PI / 180;
/** Lowest allowed pitch up close (near-horizon) and when zoomed far out. */
export const PITCH_MIN_NEAR = 7 * DEG;
export const PITCH_MIN_FAR = 32 * DEG;
export const PITCH_MAX = 88 * DEG;
const ZOOM_EXP = 0.0014;
const FOV = 40;

export interface CameraPose {
  x: number;
  z: number;
  distance: number;
  /** Radians, clockwise from north: the direction the camera looks. */
  heading: number;
  /** Radians above the horizontal of the view ray (90° = straight down). */
  pitch: number;
}

const smooth01 = (t: number) => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

/** Minimum pitch at a distance: near-horizon up close, oblique far out. */
export function minPitchForDistance(distance: number): number {
  const t = smooth01((Math.log(distance) - Math.log(12)) / (Math.log(DIST_MAX) - Math.log(12)));
  return PITCH_MIN_NEAR + (PITCH_MIN_FAR - PITCH_MIN_NEAR) * t;
}

/**
 * Cinematic framing: the camera orbits the target at `pitch`, but near the
 * horizon it AIMS shallower (down to 25% of the orbit pitch) so the
 * horizon rises to about the upper third and the sky enters the frame.
 * Above ~30° it looks straight at the target.
 */
export function aimPitchFor(pitch: number): number {
  const t = smooth01((30 * DEG - pitch) / (18 * DEG));
  return pitch * (1 - 0.75 * t);
}

export function clampDistance(distance: number): number {
  return Math.min(DIST_MAX, Math.max(DIST_MIN, distance));
}

export function clampPitch(pitch: number, distance: number): number {
  return Math.min(PITCH_MAX, Math.max(minPitchForDistance(distance), pitch));
}

/** Keep the look-at target inside the world rect. */
export function clampTarget(x: number, z: number): { x: number; z: number } {
  return {
    x: Math.min(GROUND_W, Math.max(0, x)),
    z: Math.min(GROUND_H, Math.max(0, z)),
  };
}

/** Distance multiplier from a pinch span change: fingers spreading zooms in. */
export function pinchZoomFactor(prevSpan: number, span: number): number {
  if (prevSpan <= 0 || span <= 0) return 1;
  return prevSpan / span;
}

/** Midpoint, span and angle of a two-finger gesture in client coordinates. */
export function pinchMidSpan(
  a: { x: number; y: number },
  b: { x: number; y: number },
): { mid: { x: number; y: number }; span: number; angle: number } {
  return {
    mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    span: Math.hypot(a.x - b.x, a.y - b.y),
    angle: Math.atan2(b.y - a.y, b.x - a.x),
  };
}

/** Signed shortest angular difference b - a, in (-π, π]. */
export function angleDelta(a: number, b: number): number {
  let d = (b - a) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d <= -Math.PI) d += 2 * Math.PI;
  return d;
}

export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/**
 * Pose along a cinematic flight at eased progress `e` ∈ [0, 1]: target and
 * angles interpolate directly (heading on the short arc); distance
 * interpolates in log space with a zoom-out bump proportional to how far
 * the target travels, so long flights rise over the map and settle in.
 */
export function flightPose(from: CameraPose, to: CameraPose, e: number): CameraPose {
  const travel = Math.hypot(to.x - from.x, to.z - from.z);
  const arc = Math.min(1.6, travel / Math.max(from.distance, to.distance, 1) * 0.6);
  const logD = Math.log(from.distance) + (Math.log(to.distance) - Math.log(from.distance)) * e;
  return {
    x: from.x + (to.x - from.x) * e,
    z: from.z + (to.z - from.z) * e,
    distance: Math.exp(logD) * (1 + arc * Math.sin(Math.PI * e)),
    heading: from.heading + angleDelta(from.heading, to.heading) * e,
    pitch: from.pitch + (to.pitch - from.pitch) * e,
  };
}

/**
 * Pose along a guided path at progress u ∈ [0, 1]: uniform Catmull-Rom
 * through the waypoints on (x, z, ln distance, unwrapped heading, pitch),
 * with an ease-in-out on u so the flight starts and settles gently.
 */
export function pathPose(poses: readonly CameraPose[], u: number): CameraPose {
  if (poses.length === 1) return { ...poses[0] };
  // Unwrap headings so each hop takes the short way round.
  const heads = [poses[0].heading];
  for (let i = 1; i < poses.length; i++) heads.push(heads[i - 1] + angleDelta(poses[i - 1].heading, poses[i].heading));
  const vec = (i: number): number[] => {
    const k = Math.min(poses.length - 1, Math.max(0, i));
    const p = poses[k];
    return [p.x, p.z, Math.log(p.distance), heads[k], p.pitch];
  };
  const e = easeInOutCubic(Math.min(1, Math.max(0, u)));
  const f = e * (poses.length - 1);
  const i = Math.min(poses.length - 2, Math.floor(f));
  const s = f - i;
  const p0 = vec(i - 1);
  const p1 = vec(i);
  const p2 = vec(i + 1);
  const p3 = vec(i + 2);
  const out = p1.map((_, c) => {
    const a = p0[c];
    const b = p1[c];
    const cc = p2[c];
    const d = p3[c];
    return 0.5 * (2 * b + (-a + cc) * s + (2 * a - 5 * b + 4 * cc - d) * s * s + (-a + 3 * b - 3 * cc + d) * s * s * s);
  });
  return { x: out[0], z: out[1], distance: Math.exp(out[2]), heading: out[3], pitch: out[4] };
}

export interface CameraRig {
  camera: PerspectiveCamera;
  readonly distance: number;
  readonly pose: CameraPose;
  /** False detaches input handling (another rig owns the canvas). */
  enabled: boolean;
  centerOn(x: number, z: number, distance: number, heading?: number, pitch?: number): void;
  setPose(pose: Partial<CameraPose>): void;
  /** Animated flight; resolves true on arrival, false if user input cancelled it. */
  flyTo(pose: Partial<CameraPose>, seconds?: number): Promise<boolean>;
  /** Guided flight through waypoints; resolves false if the user takes over. */
  playPath(poses: readonly CameraPose[], seconds: number, onProgress?: (u: number) => void): Promise<boolean>;
  readonly flying: boolean;
  /** Advance flights; call every frame. */
  update(deltaSeconds: number): void;
  /** Ray from a client point onto the bent sea-level ground, or null past the horizon. */
  groundAt(clientX: number, clientY: number): { x: number; z: number } | null;
  resize(width: number, height: number): void;
  dispose(): void;
}

export interface CameraRigOptions {
  /** World-unit terrain Y at a ground point (≥ 0), for target height + collision. */
  groundY?: (x: number, z: number) => number;
  /** Called on any direct user camera input (pan/zoom/orbit/keys). */
  onUserInput?: () => void;
}

export function createCameraRig(
  domElement: HTMLElement,
  onChange: () => void,
  options: CameraRigOptions = {},
): CameraRig {
  const groundY = options.groundY ?? (() => 0);
  const camera = new PerspectiveCamera(FOV, 1, 0.05, 2000);
  const state: CameraPose = {
    x: GROUND_W / 2,
    z: GROUND_H / 2,
    distance: DIST_MAX,
    heading: 0,
    pitch: 50 * DEG,
  };
  let targetY = 0;
  let enabled = true;

  /** Terrain height near the target, averaged so orbiting a peak doesn't jitter. */
  function sampleTargetY(): number {
    const r = state.distance * 0.04;
    const s =
      groundY(state.x, state.z) * 2 +
      groundY(state.x + r, state.z) +
      groundY(state.x - r, state.z) +
      groundY(state.x, state.z + r) +
      groundY(state.x, state.z - r);
    return Math.max(0, s / 6);
  }

  function apply(): void {
    state.distance = clampDistance(state.distance);
    state.pitch = clampPitch(state.pitch, state.distance);
    const c = clampTarget(state.x, state.z);
    state.x = c.x;
    state.z = c.z;
    targetY = sampleTargetY();

    const radius = curveRadiusForDistance(state.distance);
    curvatureUniforms.uCurveCenter.value.set(state.x, state.z);
    curvatureUniforms.uCurveRadius.value = radius;

    const horiz = state.distance * Math.cos(state.pitch);
    const px = state.x - Math.sin(state.heading) * horiz;
    const pz = state.z + Math.cos(state.heading) * horiz;
    let py = targetY + state.distance * Math.sin(state.pitch);
    // Never sink into a mountainside: stay above the bent terrain below.
    const floor = groundY(px, pz) - bendDrop(px, pz, state.x, state.z, radius) + 0.15 + state.distance * 0.02;
    if (py < floor) py = floor;
    camera.position.set(px, py, pz);
    const aim = aimPitchFor(state.pitch);
    const cosAim = Math.cos(aim);
    camera.lookAt(
      px + Math.sin(state.heading) * cosAim,
      py - Math.sin(aim),
      pz - Math.cos(state.heading) * cosAim,
    );
    camera.near = Math.max(0.02, state.distance * 0.004);
    camera.far = Math.max(1500, state.distance * 12);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    onChange();
  }

  const origin = new Vector3();
  const dir = new Vector3();
  function groundAt(clientX: number, clientY: number): { x: number; z: number } | null {
    const rect = domElement.getBoundingClientRect();
    const nx = ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
    const ny = -(((clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1);
    origin.set(nx, ny, 0.5).unproject(camera);
    dir.copy(origin).sub(camera.position).normalize();
    const t = rayHitBentGround(
      camera.position.x, camera.position.y, camera.position.z,
      dir.x, dir.y, dir.z,
      state.x, state.z, curvatureUniforms.uCurveRadius.value,
      targetY,
    );
    if (t === null || t > state.distance * 8) return null;
    return { x: camera.position.x + dir.x * t, z: camera.position.z + dir.z * t };
  }

  // ---- flights ------------------------------------------------------------
  let flight: {
    from: CameraPose;
    to: CameraPose;
    path?: readonly CameraPose[];
    onProgress?: (u: number) => void;
    t: number;
    seconds: number;
    resolve: (done: boolean) => void;
  } | null = null;

  function cancelFlight(): void {
    if (!flight) return;
    const f = flight;
    flight = null;
    f.resolve(false);
  }

  function userInput(): void {
    cancelFlight();
    options.onUserInput?.();
  }

  // ---- pointer gestures -----------------------------------------------------
  const pointers = new Map<number, { x: number; y: number }>();
  let mode: 'pan' | 'orbit' | 'pinch' | 'tilt' | null = null;
  let grabbed: { x: number; z: number } | null = null;
  let last = { x: 0, y: 0 };
  let pinchPrev = { span: 0, angle: 0, midY: 0 };
  let pinchStart: { a: { x: number; y: number }; b: { x: number; y: number } } | null = null;

  function twoPointers() {
    const [a, b] = [...pointers.values()];
    return pinchMidSpan(a, b);
  }

  function regrab(): void {
    if (pointers.size === 1 && mode !== 'orbit') {
      const [p] = [...pointers.values()];
      grabbed = groundAt(p.x, p.y);
      mode = 'pan';
    } else if (pointers.size === 2) {
      const g = twoPointers();
      grabbed = groundAt(g.mid.x, g.mid.y);
      pinchPrev = { span: g.span, angle: g.angle, midY: g.mid.y };
      const [a, b] = [...pointers.values()];
      pinchStart = { a: { ...a }, b: { ...b } };
      mode = 'pinch';
    } else if (pointers.size >= 3) {
      const ys = [...pointers.values()].map((p) => p.y);
      last = { x: 0, y: ys.reduce((s, v) => s + v, 0) / ys.length };
      mode = 'tilt';
      grabbed = null;
    } else if (pointers.size === 0) {
      mode = null;
      grabbed = null;
    }
  }

  function panGrabbedTo(clientX: number, clientY: number): void {
    if (!grabbed) return;
    const now = groundAt(clientX, clientY);
    if (!now) return;
    state.x += grabbed.x - now.x;
    state.z += grabbed.z - now.z;
    apply();
  }

  function orbitBy(dx: number, dy: number): void {
    state.heading -= dx * 0.005;
    state.pitch += dy * 0.004;
    apply();
  }

  const onPointerDown = (e: PointerEvent) => {
    if (!enabled) return;
    userInput();
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    last = { x: e.clientX, y: e.clientY };
    const orbitButton = e.pointerType === 'mouse' && (e.button === 2 || e.ctrlKey || e.shiftKey || e.altKey);
    if (pointers.size === 1 && orbitButton) {
      mode = 'orbit';
      grabbed = null;
    } else {
      if (e.pointerType === 'mouse' && e.button !== 0) {
        pointers.delete(e.pointerId);
        return;
      }
      if (mode === 'orbit') mode = null;
      regrab();
    }
    // Last: capture can throw for pointers the browser no longer tracks
    // (and for synthetic test events) — all state work is already done.
    domElement.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!enabled || !pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (mode === 'orbit') {
      orbitBy(e.clientX - last.x, e.clientY - last.y);
      last = { x: e.clientX, y: e.clientY };
    } else if (mode === 'pan' && pointers.size === 1) {
      panGrabbedTo(e.clientX, e.clientY);
    } else if (mode === 'tilt') {
      const ys = [...pointers.values()].map((p) => p.y);
      const y = ys.reduce((s, v) => s + v, 0) / ys.length;
      state.pitch += (y - last.y) * 0.005;
      last.y = y;
      apply();
    } else if (mode === 'pinch' && pointers.size === 2) {
      const g = twoPointers();
      // Two fingers sliding together vertically (span and angle steady)
      // switch the gesture to tilt, like mobile map apps.
      if (pinchStart) {
        const [a, b] = [...pointers.values()];
        const dya = a.y - pinchStart.a.y;
        const dyb = b.y - pinchStart.b.y;
        const spanChange = Math.abs(g.span - Math.hypot(pinchStart.a.x - pinchStart.b.x, pinchStart.a.y - pinchStart.b.y));
        if (Math.abs(dya) > 14 && Math.abs(dyb) > 14 && Math.sign(dya) === Math.sign(dyb) && spanChange < 24) {
          mode = 'tilt';
          last = { x: 0, y: g.mid.y };
          pinchStart = null;
          return;
        }
        if (spanChange > 24 || Math.abs(angleDelta(pinchPrev.angle, g.angle)) > 0.12) pinchStart = null;
      }
      state.distance = clampDistance(state.distance * pinchZoomFactor(pinchPrev.span, g.span));
      state.heading -= angleDelta(pinchPrev.angle, g.angle);
      pinchPrev = { span: g.span, angle: g.angle, midY: g.mid.y };
      apply();
      panGrabbedTo(g.mid.x, g.mid.y);
    }
  };

  const onPointerEnd = (e: PointerEvent) => {
    if (!pointers.delete(e.pointerId)) return;
    if (domElement.hasPointerCapture?.(e.pointerId)) domElement.releasePointerCapture(e.pointerId);
    if (mode === 'orbit' && pointers.size === 0) mode = null;
    if (mode !== 'orbit') regrab();
  };

  const onWheel = (e: WheelEvent) => {
    if (!enabled) return;
    e.preventDefault();
    userInput();
    const before = groundAt(e.clientX, e.clientY);
    // Trackpad pinches arrive as ctrl+wheel with small deltas: amplify.
    const k = e.ctrlKey ? ZOOM_EXP * 6 : ZOOM_EXP;
    state.distance = clampDistance(state.distance * Math.exp(e.deltaY * k));
    apply();
    const after = groundAt(e.clientX, e.clientY);
    if (before && after) {
      state.x += before.x - after.x;
      state.z += before.z - after.z;
      apply();
    }
  };

  const onContextMenu = (e: Event) => e.preventDefault();

  const onKeyDown = (e: KeyboardEvent) => {
    if (!enabled || e.ctrlKey || e.metaKey || e.altKey) return;
    const el = e.target as HTMLElement | null;
    if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
    const k = e.key.toLowerCase();
    const panStep = state.distance * 0.08;
    const fwd = { x: Math.sin(state.heading), z: -Math.cos(state.heading) };
    const right = { x: Math.cos(state.heading), z: Math.sin(state.heading) };
    let handled = true;
    if (k === 'q') state.heading -= 7.5 * DEG;
    else if (k === 'e') state.heading += 7.5 * DEG;
    else if (k === 'r') state.pitch -= 5 * DEG;
    else if (k === 'f') state.pitch += 5 * DEG;
    else if (k === 'w') { state.x += fwd.x * panStep; state.z += fwd.z * panStep; }
    else if (k === 's') { state.x -= fwd.x * panStep; state.z -= fwd.z * panStep; }
    else if (k === 'a') { state.x -= right.x * panStep; state.z -= right.z * panStep; }
    else if (k === 'd') { state.x += right.x * panStep; state.z += right.z * panStep; }
    else if (k === 'n') {
      userInput();
      void rig.flyTo({ heading: 0 }, 0.8);
      return;
    } else handled = false;
    if (!handled) return;
    userInput();
    apply();
  };

  domElement.addEventListener('pointerdown', onPointerDown);
  domElement.addEventListener('pointermove', onPointerMove);
  domElement.addEventListener('pointerup', onPointerEnd);
  domElement.addEventListener('pointercancel', onPointerEnd);
  domElement.addEventListener('wheel', onWheel, { passive: false });
  domElement.addEventListener('contextmenu', onContextMenu);
  window.addEventListener('keydown', onKeyDown);

  apply();

  const rig: CameraRig = {
    camera,
    get distance() {
      return state.distance;
    },
    get pose() {
      return { ...state };
    },
    get enabled() {
      return enabled;
    },
    set enabled(v: boolean) {
      enabled = v;
      if (!v) {
        pointers.clear();
        mode = null;
        grabbed = null;
      }
    },
    get flying() {
      return flight !== null;
    },
    centerOn(x, z, distance, heading, pitch) {
      cancelFlight();
      state.x = x;
      state.z = z;
      state.distance = distance;
      if (heading !== undefined) state.heading = heading;
      if (pitch !== undefined) state.pitch = pitch;
      apply();
    },
    setPose(pose) {
      cancelFlight();
      Object.assign(state, pose);
      apply();
    },
    flyTo(pose, seconds = 2.2) {
      cancelFlight();
      const to: CameraPose = { ...state, ...pose };
      to.distance = clampDistance(to.distance);
      to.pitch = clampPitch(to.pitch, to.distance);
      return new Promise<boolean>((resolve) => {
        flight = { from: { ...state }, to, t: 0, seconds: Math.max(0.05, seconds), resolve };
      });
    },
    playPath(poses, seconds, onProgress) {
      cancelFlight();
      return new Promise<boolean>((resolve) => {
        flight = { from: { ...state }, to: poses[poses.length - 1], path: poses, onProgress, t: 0, seconds: Math.max(0.05, seconds), resolve };
      });
    },
    update(deltaSeconds) {
      if (!flight) return;
      flight.t = Math.min(1, flight.t + deltaSeconds / flight.seconds);
      const p = flight.path ? pathPose(flight.path, flight.t) : flightPose(flight.from, flight.to, easeInOutCubic(flight.t));
      Object.assign(state, p);
      apply();
      flight?.onProgress?.(flight.t);
      if (flight.t >= 1) {
        const f = flight;
        flight = null;
        f.resolve(true);
      }
    },
    groundAt,
    resize(width, height) {
      camera.aspect = width / Math.max(1, height);
      camera.updateProjectionMatrix();
      onChange();
    },
    dispose() {
      cancelFlight();
      domElement.removeEventListener('pointerdown', onPointerDown);
      domElement.removeEventListener('pointermove', onPointerMove);
      domElement.removeEventListener('pointerup', onPointerEnd);
      domElement.removeEventListener('pointercancel', onPointerEnd);
      domElement.removeEventListener('wheel', onWheel);
      domElement.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('keydown', onKeyDown);
    },
  };
  return rig;
}
