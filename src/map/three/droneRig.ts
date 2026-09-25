/**
 * Free-look "drone" camera: the camera is a position plus a free view
 * direction — look anywhere (360° around, from straight down to up at the
 * sky), fly toward what you look at, skim low among the mountains. This is
 * the opposite of an orbit-around-a-ground-target map camera.
 *
 * Input:
 *   mouse   drag look around · right/shift-drag move over the ground ·
 *           wheel fly toward the cursor (speed scales with altitude)
 *   touch   1 finger look · 2 fingers pinch = fly, drag = move
 *   keys    W/A/S/D move · Q/E descend/climb · arrows look · N face north
 *
 * The world bends convexly around the point under the camera
 * (curvature.ts), so there is always a true horizon. Guided flights
 * interpolate drone poses; any input hands control back to the user.
 * Implements the host-facing parts of CameraRig (camera, distance, pose,
 * flyTo, …) so markers, the compass and the post pipeline keep working.
 */
import { PerspectiveCamera, Vector3 } from 'three';
import { GROUND_W, GROUND_H } from './geo';
import { angleDelta, easeInOutCubic } from './cameraRig';
import { curvatureUniforms, rayHitBentGround } from './curvature';

const DEG = Math.PI / 180;
export const DRONE_PITCH_MIN = -85 * DEG;
export const DRONE_PITCH_MAX = 70 * DEG;
/** Clearance above the terrain (world units). */
export const DRONE_MIN_CLEAR = 0.1;
export const DRONE_MAX_Y = 260;
const FOV = 50;

export interface DronePose {
  x: number;
  y: number;
  z: number;
  /** Radians clockwise from north (direction of view). */
  yaw: number;
  /** Radians of view elevation: + looks up, − looks down. */
  pitch: number;
}

export function clampDronePitch(p: number): number {
  return Math.min(DRONE_PITCH_MAX, Math.max(DRONE_PITCH_MIN, p));
}

/** Unit view vector for yaw/pitch (north = −Z, east = +X, up = +Y). */
export function lookVector(yaw: number, pitch: number): [number, number, number] {
  const c = Math.cos(pitch);
  return [Math.sin(yaw) * c, Math.sin(pitch), -Math.cos(yaw) * c];
}

/** Planet radius for the horizon: tight when low (a close horizon), flat when high. */
export function droneCurveRadius(altitude: number): number {
  return Math.min(900, Math.max(150, 120 + altitude * 14));
}

/** Uniform Catmull-Rom through drone waypoints, eased in and out. */
export function dronePathPose(poses: readonly DronePose[], u: number): DronePose {
  if (poses.length === 1) return { ...poses[0] };
  const yaws = [poses[0].yaw];
  for (let i = 1; i < poses.length; i++) yaws.push(yaws[i - 1] + angleDelta(poses[i - 1].yaw, poses[i].yaw));
  const vec = (i: number) => {
    const k = Math.min(poses.length - 1, Math.max(0, i));
    const p = poses[k];
    return [p.x, p.y, p.z, yaws[k], p.pitch];
  };
  const e = easeInOutCubic(Math.min(1, Math.max(0, u)));
  const f = e * (poses.length - 1);
  const i = Math.min(poses.length - 2, Math.floor(f));
  const s = f - i;
  const p0 = vec(i - 1);
  const p1 = vec(i);
  const p2 = vec(i + 1);
  const p3 = vec(i + 2);
  const o = p1.map((_, c) => {
    const a = p0[c];
    const b = p1[c];
    const cc = p2[c];
    const d = p3[c];
    return 0.5 * (2 * b + (-a + cc) * s + (2 * a - 5 * b + 4 * cc - d) * s * s + (-a + 3 * b - 3 * cc + d) * s * s * s);
  });
  return { x: o[0], y: o[1], z: o[2], yaw: o[3], pitch: o[4] };
}

export interface DroneRig {
  camera: PerspectiveCamera;
  /** Distance to what the centre of view rests on (focus for tilt-shift). */
  readonly distance: number;
  /** Host-facing pose: heading = yaw; pitch = downward view angle (≥ 0). */
  readonly pose: { x: number; z: number; distance: number; heading: number; pitch: number };
  readonly drone: DronePose;
  readonly altitude: number;
  enabled: boolean;
  readonly flying: boolean;
  setDrone(pose: Partial<DronePose>): void;
  flyTo(pose: { heading?: number }, seconds?: number): Promise<boolean>;
  playDronePath(poses: readonly DronePose[], seconds: number, onProgress?: (u: number) => void): Promise<boolean>;
  update(deltaSeconds: number): void;
  resize(width: number, height: number): void;
  dispose(): void;
}

export function createDroneRig(
  domElement: HTMLElement,
  onChange: () => void,
  options: { groundY: (x: number, z: number) => number; onUserInput?: () => void },
): DroneRig {
  const camera = new PerspectiveCamera(FOV, 1, 0.02, 3000);
  const s: DronePose = { x: GROUND_W / 2, y: 40, z: GROUND_H / 2, yaw: 0, pitch: -35 * DEG };
  let enabled = true;
  let focus = 40;
  let altitude = 40;

  const dir = new Vector3();
  const tmp = new Vector3();

  function apply(): void {
    s.pitch = clampDronePitch(s.pitch);
    s.x = Math.min(GROUND_W + 30, Math.max(-30, s.x));
    s.z = Math.min(GROUND_H + 30, Math.max(-30, s.z));
    const ground = Math.max(0, options.groundY(s.x, s.z));
    s.y = Math.min(DRONE_MAX_Y, Math.max(ground + DRONE_MIN_CLEAR, s.y));
    altitude = s.y - ground;
    curvatureUniforms.uCurveCenter.value.set(s.x, s.z);
    curvatureUniforms.uCurveRadius.value = droneCurveRadius(altitude);

    const [dx, dy, dz] = lookVector(s.yaw, s.pitch);
    dir.set(dx, dy, dz);
    camera.position.set(s.x, s.y, s.z);
    camera.lookAt(tmp.copy(camera.position).add(dir));
    camera.near = Math.max(0.01, altitude * 0.01);
    camera.far = 3000;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();

    const t = rayHitBentGround(s.x, s.y, s.z, dx, dy, dz, s.x, s.z, curvatureUniforms.uCurveRadius.value, 0);
    focus = t === null ? altitude * 4 + 5 : Math.min(t, altitude * 12 + 5);
    onChange();
  }

  const origin = new Vector3();
  const ray = new Vector3();
  function rayAt(clientX: number, clientY: number): Vector3 {
    const rect = domElement.getBoundingClientRect();
    const nx = ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
    const ny = -(((clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1);
    origin.set(nx, ny, 0.5).unproject(camera);
    return ray.copy(origin).sub(camera.position).normalize();
  }
  function groundAt(clientX: number, clientY: number): { x: number; z: number } | null {
    const r = rayAt(clientX, clientY);
    const t = rayHitBentGround(s.x, s.y, s.z, r.x, r.y, r.z, s.x, s.z, curvatureUniforms.uCurveRadius.value, 0);
    if (t === null || t > 400) return null;
    return { x: s.x + r.x * t, z: s.z + r.z * t };
  }

  // ---- flights ----
  let flight: {
    from: DronePose;
    path?: readonly DronePose[];
    toYaw?: number;
    t: number;
    seconds: number;
    onProgress?: (u: number) => void;
    resolve: (done: boolean) => void;
  } | null = null;
  const cancelFlight = () => {
    if (!flight) return;
    const f = flight;
    flight = null;
    f.resolve(false);
  };
  const userInput = () => {
    cancelFlight();
    options.onUserInput?.();
  };

  // ---- pointers ----
  const pointers = new Map<number, { x: number; y: number }>();
  let mode: 'look' | 'move' | 'pinch' | null = null;
  let last = { x: 0, y: 0 };
  let grabbed: { x: number; z: number } | null = null;
  let pinchPrev = { span: 0, mid: { x: 0, y: 0 } };

  const twoPointers = () => {
    const [a, b] = [...pointers.values()];
    return { span: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  };

  function moveGrabbedTo(clientX: number, clientY: number): void {
    if (!grabbed) return;
    const now = groundAt(clientX, clientY);
    if (!now) return;
    s.x += grabbed.x - now.x;
    s.z += grabbed.z - now.z;
    apply();
  }

  /** Fly along the ray through a client point by a fraction of the way. */
  function dollyToward(clientX: number, clientY: number, amount: number): void {
    const r = rayAt(clientX, clientY);
    const t = rayHitBentGround(s.x, s.y, s.z, r.x, r.y, r.z, s.x, s.z, curvatureUniforms.uCurveRadius.value, 0);
    const reach = t === null ? altitude * 3 + 4 : t;
    // Never fly through the target: stop at 85% of the way per step.
    const step = Math.max(-reach * 2, Math.min(reach * 0.85, reach * amount));
    s.x += r.x * step;
    s.y += r.y * step;
    s.z += r.z * step;
    apply();
  }

  const onPointerDown = (e: PointerEvent) => {
    if (!enabled) return;
    userInput();
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    last = { x: e.clientX, y: e.clientY };
    if (pointers.size === 1) {
      const moveButton = e.pointerType === 'mouse' && (e.button === 2 || e.shiftKey || e.ctrlKey);
      if (moveButton) {
        mode = 'move';
        grabbed = groundAt(e.clientX, e.clientY);
      } else if (e.pointerType !== 'mouse' || e.button === 0) {
        mode = 'look';
      } else {
        pointers.delete(e.pointerId);
        return;
      }
    } else if (pointers.size === 2) {
      mode = 'pinch';
      pinchPrev = twoPointers();
      grabbed = groundAt(pinchPrev.mid.x, pinchPrev.mid.y);
    }
    domElement.setPointerCapture(e.pointerId); // last: may throw for synthetic pointers
  };
  const onPointerMove = (e: PointerEvent) => {
    if (!enabled || !pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (mode === 'look' && pointers.size === 1) {
      const k = (FOV * DEG) / Math.max(200, domElement.clientHeight || 600);
      s.yaw += (e.clientX - last.x) * k;
      s.pitch -= (e.clientY - last.y) * k;
      last = { x: e.clientX, y: e.clientY };
      apply();
    } else if (mode === 'move' && pointers.size === 1) {
      moveGrabbedTo(e.clientX, e.clientY);
    } else if (mode === 'pinch' && pointers.size === 2) {
      const now = twoPointers();
      if (pinchPrev.span > 0) dollyToward(now.mid.x, now.mid.y, 1 - pinchPrev.span / now.span);
      moveGrabbedTo(now.mid.x, now.mid.y);
      pinchPrev = now;
    }
  };
  const onPointerEnd = (e: PointerEvent) => {
    if (!pointers.delete(e.pointerId)) return;
    if (domElement.hasPointerCapture?.(e.pointerId)) domElement.releasePointerCapture(e.pointerId);
    if (pointers.size === 0) mode = null;
    else if (pointers.size === 1) {
      const [p] = [...pointers.values()];
      last = p;
      mode = 'look';
    }
  };
  const onWheel = (e: WheelEvent) => {
    if (!enabled) return;
    e.preventDefault();
    userInput();
    const k = e.ctrlKey ? 0.012 : 0.0016;
    dollyToward(e.clientX, e.clientY, 1 - Math.exp(e.deltaY * k));
  };
  const onContextMenu = (e: Event) => e.preventDefault();

  const held = new Set<string>();
  const MOVE_KEYS = new Set(['w', 'a', 's', 'd', 'q', 'e', 'arrowleft', 'arrowright', 'arrowup', 'arrowdown']);
  const typing = (el: EventTarget | null) => {
    const t = el as HTMLElement | null;
    return !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.getAttribute?.('role') === 'slider');
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (!enabled || e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return;
    const k = e.key.toLowerCase();
    if (k === 'n') {
      userInput();
      void rig.flyTo({ heading: 0 }, 0.9);
      return;
    }
    if (!MOVE_KEYS.has(k)) return;
    e.preventDefault();
    if (!held.has(k)) userInput();
    held.add(k);
  };
  const onKeyUp = (e: KeyboardEvent) => held.delete(e.key.toLowerCase());
  const onBlur = () => held.clear();

  domElement.addEventListener('pointerdown', onPointerDown);
  domElement.addEventListener('pointermove', onPointerMove);
  domElement.addEventListener('pointerup', onPointerEnd);
  domElement.addEventListener('pointercancel', onPointerEnd);
  domElement.addEventListener('wheel', onWheel, { passive: false });
  domElement.addEventListener('contextmenu', onContextMenu);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  apply();

  const rig: DroneRig = {
    camera,
    get distance() {
      return focus;
    },
    get pose() {
      return { x: s.x, z: s.z, distance: focus, heading: s.yaw, pitch: Math.max(0, -s.pitch) };
    },
    get drone() {
      return { ...s };
    },
    get altitude() {
      return altitude;
    },
    get enabled() {
      return enabled;
    },
    set enabled(v: boolean) {
      enabled = v;
      if (!v) {
        pointers.clear();
        held.clear();
        mode = null;
      }
    },
    get flying() {
      return flight !== null;
    },
    setDrone(pose) {
      cancelFlight();
      Object.assign(s, pose);
      apply();
    },
    flyTo(pose, seconds = 1) {
      cancelFlight();
      return new Promise<boolean>((resolve) => {
        flight = { from: { ...s }, toYaw: pose.heading, t: 0, seconds: Math.max(0.05, seconds), resolve };
      });
    },
    playDronePath(poses, seconds, onProgress) {
      cancelFlight();
      return new Promise<boolean>((resolve) => {
        flight = { from: { ...s }, path: poses, t: 0, seconds: Math.max(0.05, seconds), onProgress, resolve };
      });
    },
    update(dt) {
      if (flight) {
        flight.t = Math.min(1, flight.t + dt / flight.seconds);
        if (flight.path) Object.assign(s, dronePathPose(flight.path, flight.t));
        else if (flight.toYaw !== undefined) {
          s.yaw = flight.from.yaw + angleDelta(flight.from.yaw, flight.toYaw) * easeInOutCubic(flight.t);
        }
        apply();
        flight?.onProgress?.(flight.t);
        if (flight && flight.t >= 1) {
          const f = flight;
          flight = null;
          f.resolve(true);
        }
        return;
      }
      if (held.size) {
        const speed = (altitude + 0.8) * 1.1 * dt;
        const fx = Math.sin(s.yaw);
        const fz = -Math.cos(s.yaw);
        if (held.has('w')) { s.x += fx * speed; s.z += fz * speed; }
        if (held.has('s')) { s.x -= fx * speed; s.z -= fz * speed; }
        if (held.has('d')) { s.x -= fz * speed; s.z += fx * speed; }
        if (held.has('a')) { s.x += fz * speed; s.z -= fx * speed; }
        if (held.has('e')) s.y += speed * 0.8;
        if (held.has('q')) s.y -= speed * 0.8;
        const turn = 1.4 * dt;
        if (held.has('arrowleft')) s.yaw -= turn;
        if (held.has('arrowright')) s.yaw += turn;
        if (held.has('arrowup')) s.pitch += turn * 0.7;
        if (held.has('arrowdown')) s.pitch -= turn * 0.7;
        apply();
      }
    },
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
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    },
  };
  return rig;
}
