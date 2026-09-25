/**
 * Iso-lines on a regular grid (marching squares) and polyline
 * simplification (Douglas-Peucker). Used by the city-page bake
 * (scripts/build-city-plate.mjs) for coasts and contours.
 *
 * Grid values are sampled at integer points (x, y), row-major, `w` × `h`.
 * Output points are in the same grid coordinates.
 */

export type XY = [number, number];

/**
 * Trace every iso-line of `field` at `level` and join the cell segments
 * into polylines. A closed line repeats its first point at the end. Lines
 * that reach the grid border stay open.
 */
export function isolines(field: ArrayLike<number>, w: number, h: number, level: number): XY[][] {
  const v = (x: number, y: number) => field[y * w + x] - level;
  // Edge ids: horizontal edge (x,y)-(x+1,y) = 2*(y*w+x); vertical (x,y)-(x,y+1) = 2*(y*w+x)+1.
  const point = new Map<number, XY>();
  const edgePoint = (id: number): XY => {
    let p = point.get(id);
    if (p) return p;
    const cell = id >> 1;
    const x = cell % w;
    const y = (cell - x) / w;
    const a = v(x, y);
    if ((id & 1) === 0) {
      const b = v(x + 1, y);
      p = [x + a / (a - b), y];
    } else {
      const b = v(x, y + 1);
      p = [x, y + a / (a - b)];
    }
    point.set(id, p);
    return p;
  };
  const segments: Array<[number, number]> = [];
  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const a = v(x, y) > 0 ? 1 : 0; // top-left
      const b = v(x + 1, y) > 0 ? 1 : 0; // top-right
      const c = v(x + 1, y + 1) > 0 ? 1 : 0; // bottom-right
      const d = v(x, y + 1) > 0 ? 1 : 0; // bottom-left
      const code = (a << 3) | (b << 2) | (c << 1) | d;
      if (code === 0 || code === 15) continue;
      const top = 2 * (y * w + x);
      const bottom = 2 * ((y + 1) * w + x);
      const left = 2 * (y * w + x) + 1;
      const right = 2 * (y * w + x + 1) + 1;
      switch (code) {
        case 1: case 14: segments.push([left, bottom]); break;
        case 2: case 13: segments.push([bottom, right]); break;
        case 3: case 12: segments.push([left, right]); break;
        case 4: case 11: segments.push([top, right]); break;
        case 6: case 9: segments.push([top, bottom]); break;
        case 7: case 8: segments.push([left, top]); break;
        case 5: case 10: {
          // Saddle: resolve with the cell centre.
          const centre = (v(x, y) + v(x + 1, y) + v(x + 1, y + 1) + v(x, y + 1)) / 4 > 0;
          if ((code === 5) === centre) {
            segments.push([left, top], [bottom, right]);
          } else {
            segments.push([left, bottom], [top, right]);
          }
          break;
        }
      }
    }
  }
  // Join: every edge point belongs to one or two segments.
  const byEdge = new Map<number, number[]>();
  segments.forEach(([p, q], i) => {
    for (const e of [p, q]) {
      const list = byEdge.get(e);
      if (list) list.push(i);
      else byEdge.set(e, [i]);
    }
  });
  const used = new Uint8Array(segments.length);
  const walk = (startSeg: number, fromEdge: number): number[] => {
    const edges = [fromEdge];
    let seg = startSeg;
    let edge = fromEdge;
    while (seg >= 0 && !used[seg]) {
      used[seg] = 1;
      const [p, q] = segments[seg];
      edge = p === edge ? q : p;
      edges.push(edge);
      const next = (byEdge.get(edge) ?? []).find((s) => !used[s]);
      seg = next ?? -1;
    }
    return edges;
  };
  const lines: XY[][] = [];
  // Open lines first (start at an edge used by one segment), then loops.
  for (const [edge, list] of byEdge) {
    if (list.length !== 1 || used[list[0]]) continue;
    lines.push(walk(list[0], edge).map(edgePoint));
  }
  for (let i = 0; i < segments.length; i++) {
    if (used[i]) continue;
    lines.push(walk(i, segments[i][0]).map(edgePoint));
  }
  return lines;
}

function perpendicularDistance(p: XY, a: XY, b: XY): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Douglas-Peucker simplification; keeps both end points. */
export function simplifyPolyline(pts: XY[], tolerance: number): XY[] {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, pts.length - 1]];
  while (stack.length) {
    const [i0, i1] = stack.pop()!;
    let worst = -1;
    let worstD = tolerance;
    for (let i = i0 + 1; i < i1; i++) {
      const d = perpendicularDistance(pts[i], pts[i0], pts[i1]);
      if (d > worstD) {
        worstD = d;
        worst = i;
      }
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push([i0, worst], [worst, i1]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Length of a polyline. */
export function polylineLength(pts: readonly XY[]): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return len;
}
