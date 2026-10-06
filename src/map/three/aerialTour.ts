/**
 * The aerial tour: while the timeline plays on the continental map, the
 * drone flies like a camera helicopter over the Empire — each era is framed
 * around its territory (high and wide while the Empire is vast, low and
 * close as it shrinks), and between eras the camera banks and drifts across
 * to the next shot instead of cutting.
 *
 * The shot is a pure function of the (fractional) year: step framings per
 * snapshot, Gaussian-smoothed in playback seconds (the year mapped through
 * the playback clock) so every frontier change becomes a glide of the same
 * length, whether its era spans four years or seventy. A critically damped
 * follower carries the drone onto that path from wherever it is and lets it
 * coast to rest when playback stops.
 */
import { snapshots, territories } from '../../data';
import { ERA_SECONDS_MIN, playbackClock } from '../../lib/playback';
import type { Territory } from '../../data/schema';
import { angleDelta, type DronePose } from './droneRig';
import { UNITS_PER_DEGREE, lonLatToGround } from './geo';

const DEG = Math.PI / 180;

/** Where a shot looks and how much ground it must hold (world units). */
export interface Framing {
  x: number;
  z: number;
  radius: number;
}

/** Constantinople stays in view: framings lean this far toward the capital. */
const CAPITAL_PULL = 0.25;
const CAPITAL_LONLAT: [number, number] = [28.955, 41.018];
const RADIUS_MIN = 9;
const RADIUS_MAX = 75;
/**
 * Playback seconds of smoothing either side of a frontier change (Gaussian σ),
 * scaled from the shortest era so even it gets its own shot: a glide takes
 * about 4σ, a little longer than the shortest era.
 */
const SMOOTH_SECONDS = 0.375 * ERA_SECONDS_MIN;

/**
 * Area centroid and RMS radius of a MultiPolygon (outer rings, lon/lat),
 * pulled a little toward the capital, in ground units.
 */
export function territoryFraming(geometry: Territory, capital: [number, number] = CAPITAL_LONLAT): Framing {
  let area = 0;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let syy = 0;
  for (const polygon of geometry.coordinates) {
    const ring = polygon[0];
    let a = 0;
    let x = 0;
    let y = 0;
    let xx = 0;
    let yy = 0;
    for (let i = 0; i < ring.length; i++) {
      const [x0, y0] = ring[i];
      const [x1, y1] = ring[(i + 1) % ring.length];
      const c = x0 * y1 - x1 * y0;
      a += c;
      x += (x0 + x1) * c;
      y += (y0 + y1) * c;
      xx += (x0 * x0 + x0 * x1 + x1 * x1) * c;
      yy += (y0 * y0 + y0 * y1 + y1 * y1) * c;
    }
    // Ring orientation varies; make every outer ring count positively.
    const sign = a < 0 ? -1 : 1;
    area += (sign * a) / 2;
    sx += (sign * x) / 6;
    sy += (sign * y) / 6;
    sxx += (sign * xx) / 12;
    syy += (sign * yy) / 12;
  }
  if (area <= 1e-9) {
    const g = lonLatToGround(...capital);
    return { x: g.x, z: g.z, radius: RADIUS_MIN };
  }
  const lon = sx / area;
  const lat = sy / area;
  // RMS distance from the centroid (degrees), via the second moments.
  const rms = Math.sqrt(Math.max(0, sxx / area - lon * lon + syy / area - lat * lat));
  const c = lonLatToGround(
    lon + (capital[0] - lon) * CAPITAL_PULL,
    lat + (capital[1] - lat) * CAPITAL_PULL,
  );
  const radius = Math.min(RADIUS_MAX, Math.max(RADIUS_MIN, rms * UNITS_PER_DEGREE * 1.5));
  return { x: c.x, z: c.z, radius };
}

/** Standard normal CDF (Abramowitz–Stegun 7.1.26 erf, |error| < 1.5e-7). */
function normalCdf(t: number): number {
  const x = Math.abs(t) / Math.SQRT2;
  const k = 1 / (1 + 0.3275911 * x);
  const erf = 1 - ((((1.061405429 * k - 1.453152027) * k + 1.421413741) * k - 0.284496736) * k + 0.254829592) * k * Math.exp(-x * x);
  return t >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

export interface AerialTour {
  /** The smoothed shot for a (fractional) year. */
  framingAt(year: number): Framing;
  /** The drone pose flying that shot. */
  poseAt(year: number): DronePose;
}

/**
 * `framings` sorted by year ascending; each holds from its year to the next.
 * `timeAt` maps a year to playback seconds, the axis the tour is paced on.
 */
export function createAerialTour(
  framings: readonly { year: number; framing: Framing }[],
  timeAt: (year: number) => number,
): AerialTour {
  // Gaussian over the step function, in closed form: each frontier change
  // becomes an error-function ramp. Zoom blends in log space so a widening
  // and a narrowing shot feel equally paced.
  const first = framings[0].framing;
  const t0 = timeAt(framings[0].year);
  const ramps = framings.slice(1).map((k, i) => {
    const prev = framings[i].framing;
    return {
      t: timeAt(k.year),
      dx: k.framing.x - prev.x,
      dz: k.framing.z - prev.z,
      dr: Math.log(k.framing.radius) - Math.log(prev.radius),
    };
  });
  const framingAtTime = (t: number): Framing => {
    let x = first.x;
    let z = first.z;
    let r = Math.log(first.radius);
    for (const k of ramps) {
      const w = normalCdf((t - k.t) / SMOOTH_SECONDS);
      x += k.dx * w;
      z += k.dz * w;
      r += k.dr * w;
    }
    return { x, z, radius: Math.exp(r) };
  };
  return {
    framingAt: (year) => framingAtTime(timeAt(year)),
    poseAt(year) {
      const t = timeAt(year);
      const f = framingAtTime(t);
      // A slow banking drift around the shot, like a helicopter circling,
      // on playback seconds so it keeps turning through the short eras.
      const phase = (t - t0) * 2 * Math.PI;
      const yaw = 0.2 * Math.sin(phase / 19.3) + 0.07 * Math.sin(phase / 6.5 + 1.3);
      const reach = f.radius * 1.5 * (1 + 0.05 * Math.sin(phase / 11.3 + 0.6));
      // Steeper from high up, shallower as the shot comes down.
      const height = (f.radius - RADIUS_MIN) / (RADIUS_MAX - RADIUS_MIN);
      const down = (34 + 16 * height) * DEG;
      const back = reach * Math.cos(down);
      return {
        x: f.x - Math.sin(yaw) * back,
        y: reach * Math.sin(down),
        z: f.z + Math.cos(yaw) * back,
        yaw,
        pitch: -down,
      };
    },
  };
}

/** The tour over the Empire's own frontiers, one shot per territory snapshot. */
export function createEmpireTour(): AerialTour {
  return createAerialTour(
    snapshots
      .filter((s) => territories.has(s.year))
      .map((s) => ({ year: s.year, framing: territoryFraming(territories.get(s.year)!) })),
    playbackClock.timeAt,
  );
}

/**
 * Critically damped follower over drone poses (yaw unwrapped toward the
 * target): eases out of rest, never overshoots, stable for any frame time.
 */
export interface PoseFollower {
  readonly pose: DronePose;
  reset(pose: DronePose): void;
  /** Chase `target` with stiffness `omega` (1/s). */
  step(target: DronePose, dt: number, omega: number): DronePose;
  /** No target: glide on and slow to rest. Returns false once at rest. */
  coast(dt: number): boolean;
}

const KEYS = ['x', 'y', 'z', 'yaw', 'pitch'] as const;

export function createPoseFollower(): PoseFollower {
  const pose: DronePose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
  const vel: DronePose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
  return {
    get pose() {
      return { ...pose };
    },
    reset(p) {
      Object.assign(pose, p);
      for (const k of KEYS) vel[k] = 0;
    },
    step(target, dt, omega) {
      const goal = { ...target, yaw: pose.yaw + angleDelta(pose.yaw, target.yaw) };
      // Closed-form critically damped spring step (as in Unity's SmoothDamp).
      const x = omega * dt;
      const e = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
      for (const k of KEYS) {
        const change = pose[k] - goal[k];
        const temp = (vel[k] + omega * change) * dt;
        vel[k] = (vel[k] - omega * temp) * e;
        pose[k] = goal[k] + (change + temp) * e;
      }
      return { ...pose };
    },
    coast(dt) {
      const decay = Math.exp(-3.2 * dt);
      let moving = false;
      for (const k of KEYS) {
        // Integral of v·e^(−λt) over the frame, then decay the velocity.
        pose[k] += (vel[k] * (1 - decay)) / 3.2;
        vel[k] *= decay;
        if (Math.abs(vel[k]) > (k === 'yaw' || k === 'pitch' ? 1e-3 : 5e-3)) moving = true;
      }
      return moving;
    },
  };
}
