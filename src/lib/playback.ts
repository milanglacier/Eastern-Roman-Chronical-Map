import { snapshots } from '../data';
import { YEAR_MAX } from '../data/schema';

/**
 * The playback clock: how history unrolls in real time while the timeline
 * plays. Every era gets a floor plus a share of its length, so a four-year
 * era is still readable and a seventy-year era still feels longer; the year
 * follows a monotone cubic through the era boundaries, so the pace eases
 * from one era into the next instead of stepping.
 */

/**
 * Every era plays for at least this long (seconds)… This is the base beat of
 * playback: the camera glides and the caption fades are scaled from it.
 */
export const ERA_SECONDS_MIN = 2.5;
/** …plus this much per year it spans. */
export const SECONDS_PER_YEAR = 1 / 20;

export interface PlaybackClock {
  /** Seconds from the first snapshot to the end of history. */
  readonly duration: number;
  /** The (fractional) year at playback time `t` seconds, clamped. */
  yearAt(t: number): number;
  /** Playback time at which `year` is reached (the inverse of yearAt). */
  timeAt(year: number): number;
  /** Seconds the era starting at this snapshot year plays for (0 if none). */
  eraSeconds(snapshotYear: number): number;
}

/** `snapshotYears` ascending; each era runs to the next one, the last to `yearMax`. */
export function createPlaybackClock(snapshotYears: readonly number[], yearMax: number): PlaybackClock {
  const starts = snapshotYears.filter((y) => y < yearMax);
  const ys = [...starts, yearMax];
  const ts = [0];
  const budgets = new Map<number, number>();
  for (let i = 0; i < starts.length; i++) {
    const seconds = ERA_SECONDS_MIN + (ys[i + 1] - ys[i]) * SECONDS_PER_YEAR;
    budgets.set(starts[i], seconds);
    ts.push(ts[i] + seconds);
  }
  const n = ys.length;
  const duration = ts[n - 1];

  // Fritsch–Carlson slopes (as SciPy's PCHIP): weighted harmonic means of the
  // neighbouring secants inside, a shape-preserving three-point end formula.
  const h = ts.slice(1).map((t, i) => t - ts[i]);
  const d = h.map((hi, i) => (ys[i + 1] - ys[i]) / hi);
  const m = new Array<number>(n).fill(d[0] ?? 0);
  for (let k = 1; k < n - 1; k++) {
    const w1 = 2 * h[k] + h[k - 1];
    const w2 = h[k] + 2 * h[k - 1];
    m[k] = (w1 + w2) / (w1 / d[k - 1] + w2 / d[k]);
  }
  const endSlope = (h0: number, h1: number, d0: number, d1: number) => {
    const s = ((2 * h0 + h1) * d0 - h0 * d1) / (h0 + h1);
    if (s <= 0) return 0;
    return d0 > 0 && d1 > 0 && s > 3 * d0 ? 3 * d0 : s;
  };
  if (n > 2) {
    m[0] = endSlope(h[0], h[1], d[0], d[1]);
    m[n - 1] = endSlope(h[n - 2], h[n - 3], d[n - 2], d[n - 3]);
  }

  const yearAt = (t: number): number => {
    if (n < 2 || t <= 0) return ys[0];
    if (t >= duration) return ys[n - 1];
    let k = 0;
    while (k < n - 2 && t >= ts[k + 1]) k++;
    const s = (t - ts[k]) / h[k];
    const s2 = s * s;
    const s3 = s2 * s;
    return (
      (2 * s3 - 3 * s2 + 1) * ys[k] +
      (s3 - 2 * s2 + s) * h[k] * m[k] +
      (-2 * s3 + 3 * s2) * ys[k + 1] +
      (s3 - s2) * h[k] * m[k + 1]
    );
  };

  const timeAt = (year: number): number => {
    if (n < 2 || year <= ys[0]) return 0;
    if (year >= ys[n - 1]) return duration;
    let k = 0;
    while (k < n - 2 && year >= ys[k + 1]) k++;
    // yearAt is monotone, so bisect within the segment.
    let lo = ts[k];
    let hi = ts[k + 1];
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (yearAt(mid) < year) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };

  return {
    duration,
    yearAt,
    timeAt,
    eraSeconds: (snapshotYear) => budgets.get(snapshotYear) ?? 0,
  };
}

/** The clock over the Empire's own eras. */
export const playbackClock = createPlaybackClock(
  snapshots.map((s) => s.year),
  YEAR_MAX,
);
