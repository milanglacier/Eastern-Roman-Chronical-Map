/**
 * 2D polyline helpers for the city page: walls follow paths and coasts,
 * set back, smoothed and resampled. Points are [x, y] in any planar frame.
 */
import type { XY } from './isolines';

export type { XY };

export function segmentLengths(pts: readonly XY[]): number[] {
  const out = [0];
  for (let i = 1; i < pts.length; i++) out.push(out[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return out;
}

/** Point at arc length `s` along the polyline (clamped). */
export function pointAt(pts: readonly XY[], cumulative: readonly number[], s: number): XY {
  const total = cumulative[cumulative.length - 1];
  const t = Math.min(total, Math.max(0, s));
  let i = 1;
  while (i < pts.length - 1 && cumulative[i] < t) i++;
  const seg = cumulative[i] - cumulative[i - 1] || 1;
  const k = (t - cumulative[i - 1]) / seg;
  return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * k, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * k];
}

/** Evenly spaced points at most `step` apart, keeping both ends. */
export function resample(pts: readonly XY[], step: number): XY[] {
  const cum = segmentLengths(pts);
  const total = cum[cum.length - 1];
  const n = Math.max(1, Math.ceil(total / step));
  return Array.from({ length: n + 1 }, (_, i) => pointAt(pts, cum, (total * i) / n));
}

/** Chaikin corner cutting; keeps the end points of an open line. */
export function smooth(pts: readonly XY[], iterations = 1): XY[] {
  let cur = pts.slice();
  for (let it = 0; it < iterations; it++) {
    if (cur.length < 3) return cur;
    const next: XY[] = [cur[0]];
    for (let i = 0; i < cur.length - 1; i++) {
      const [ax, ay] = cur[i];
      const [bx, by] = cur[i + 1];
      next.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25], [ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]);
    }
    next.push(cur[cur.length - 1]);
    cur = next;
  }
  return cur;
}

/**
 * Offset every vertex along the averaged normal by `d` (positive = left of
 * the direction of travel, with +y pointing down the page as on a canvas:
 * left of travelling east is north).
 */
export function offset(pts: readonly XY[], d: number): XY[] {
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    // Left normal in a y-down frame.
    return [p[0] + (dy / len) * d, p[1] - (dx / len) * d];
  });
}

/** Index of the vertex nearest to `q`, and its distance. */
export function nearestVertex(pts: readonly XY[], q: XY): { index: number; distance: number } {
  let index = 0;
  let distance = Infinity;
  pts.forEach((p, i) => {
    const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
    if (d < distance) {
      distance = d;
      index = i;
    }
  });
  return { index, distance };
}

/**
 * The stretch of the nearest line between the vertices nearest to `start`
 * and `end`, in the direction start → end. Null when no line passes near
 * both points.
 */
export function sliceBetween(lines: readonly XY[][], start: XY, end: XY, maxDistance: number): XY[] | null {
  let best: XY[] | null = null;
  let bestScore = Infinity;
  for (const line of lines) {
    const a = nearestVertex(line, start);
    const b = nearestVertex(line, end);
    if (a.distance > maxDistance || b.distance > maxDistance) continue;
    const score = a.distance + b.distance;
    if (score >= bestScore) continue;
    bestScore = score;
    best = a.index <= b.index ? line.slice(a.index, b.index + 1) : line.slice(b.index, a.index + 1).reverse();
  }
  return best;
}

/** Distance from `q` to the nearest segment of a polyline. */
export function distanceToPolyline(pts: readonly XY[], q: XY): number {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1];
    const [bx, by] = pts[i];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((q[0] - ax) * dx + (q[1] - ay) * dy) / len2));
    best = Math.min(best, Math.hypot(q[0] - (ax + dx * t), q[1] - (ay + dy * t)));
  }
  return best;
}

/** Distance from `q` to the segment a→b (the same arithmetic as distanceToPolyline). */
function segmentDistance(ax: number, ay: number, bx: number, by: number, q: XY): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((q[0] - ax) * dx + (q[1] - ay) * dy) / len2));
  return Math.hypot(q[0] - (ax + dx * t), q[1] - (ay + dy * t));
}

/**
 * Many polylines bucketed on a uniform grid, for "is `q` within `margin` of
 * any of them?" asked of many points. Exact: `near(q, m)` equals
 * `lines.some((l) => distanceToPolyline(l, q) <= m)` for any `m <= reach`;
 * each query only visits the segments that pass near its grid cell.
 */
export function createSegmentIndex(lines: readonly (readonly XY[])[], reach: number, cellSize = Math.max(reach, 1e-6) * 2) {
  const buckets = new Map<string, number[]>();
  const segs: number[] = [];
  for (const line of lines) {
    for (let i = 1; i < line.length; i++) {
      const [ax, ay] = line[i - 1];
      const [bx, by] = line[i];
      const id = segs.length / 4;
      segs.push(ax, ay, bx, by);
      const i0 = Math.floor((Math.min(ax, bx) - reach) / cellSize);
      const i1 = Math.floor((Math.max(ax, bx) + reach) / cellSize);
      const j0 = Math.floor((Math.min(ay, by) - reach) / cellSize);
      const j1 = Math.floor((Math.max(ay, by) + reach) / cellSize);
      for (let j = j0; j <= j1; j++) {
        for (let k = i0; k <= i1; k++) {
          const key = `${k},${j}`;
          const bucket = buckets.get(key);
          if (bucket) bucket.push(id);
          else buckets.set(key, [id]);
        }
      }
    }
  }
  return {
    near(q: XY, margin: number): boolean {
      const bucket = buckets.get(`${Math.floor(q[0] / cellSize)},${Math.floor(q[1] / cellSize)}`);
      if (!bucket) return false;
      for (const id of bucket) {
        const o = id * 4;
        if (segmentDistance(segs[o], segs[o + 1], segs[o + 2], segs[o + 3], q) <= margin) return true;
      }
      return false;
    },
  };
}

/**
 * `pointInRing` with a bounding-box reject in front, for rings tested against
 * many points. Exact: outside the y range no edge is crossed, and left or
 * right of the x range the ray crosses a closed ring an even number of times.
 */
export function createRingTest(ring: readonly XY[]): (q: XY) => boolean {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of ring) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const pad = 1e-9 * (1 + Math.max(Math.abs(minX), Math.abs(maxX)));
  return (q) => q[1] >= minY && q[1] <= maxY && q[0] >= minX - pad && q[0] <= maxX + pad && pointInRing(q, ring);
}

export function pointInRing(q: XY, ring: readonly XY[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > q[1] !== yj > q[1] && q[0] < ((xj - xi) * (q[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
