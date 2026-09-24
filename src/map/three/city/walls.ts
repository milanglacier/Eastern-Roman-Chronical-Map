/**
 * Fortification builders: land walls (single, ruined, or the Theodosian
 * triple line of moat + outer wall + inner wall with towers) and sea walls,
 * all following the terrain along their data polylines.
 */
import type { Group } from 'three';
import type { CityStructure } from '../../../data/schema';
import { Batch } from './batch';
import { box, drapedStrip, offsetPath, pathNormals, resample, wallRibbon, xf, type GroundY, type P2 } from './geom';
import type { CityMaterials } from './palette';

export interface BuildContext {
  toLocal(lonlat: [number, number]): P2;
  groundY: GroundY;
  mats: CityMaterials;
  /** Vertical scale for built structures (matches the terrain exaggeration). */
  hs: number;
  /** A point inside the city, to tell a wall's outer face from its inner. */
  cityCenter: P2;
  /** Local points where a wall is breached (e.g. 1453 at St Romanus). */
  breaches: P2[];
  /** Deterministic per-structure hash in [0,1). */
  hash(key: string, i: number): number;
}

/** Sign of the left normal that points away from the city. */
function outwardSign(points: P2[], center: P2): 1 | -1 {
  const mid = points[Math.floor(points.length / 2)];
  const n = pathNormals(points)[Math.floor(points.length / 2)];
  const dPlus = Math.hypot(mid.x + n.x * 50 - center.x, mid.z + n.z * 50 - center.z);
  const dMinus = Math.hypot(mid.x - n.x * 50 - center.x, mid.z - n.z * 50 - center.z);
  return dPlus > dMinus ? 1 : -1;
}

/** Towers every `spacing` m along a line, sitting astride its outer face. */
function addTowers(
  batch: Batch,
  points: P2[],
  ctx: BuildContext,
  opts: { spacing: number; phase: number; size: number; height: number; offset: number; mat: 'masonry' | 'ruin'; keep?: (i: number) => boolean },
): void {
  const n = pathNormals(points);
  let next = opts.phase;
  let dist = 0;
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i];
    const b = points[i + 1];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    while (next <= dist + len) {
      const t = (next - dist) / (len || 1);
      const x = a.x + (b.x - a.x) * t + n[i].x * opts.offset;
      const z = a.z + (b.z - a.z) * t + n[i].z * opts.offset;
      const tower = Math.floor(next / opts.spacing);
      if (!opts.keep || opts.keep(tower)) {
        const rotY = -Math.atan2(b.z - a.z, b.x - a.x);
        const g = ctx.groundY(x, z);
        batch.add(opts.mat, xf(box(opts.size, opts.height + 4, opts.size), { x, y: g - 4, z, rotY }));
        // Parapet cap, slightly proud of the shaft.
        batch.add(opts.mat, xf(box(opts.size * 1.12, 1.4 * ctx.hs, opts.size * 1.12), { x, y: g + opts.height - 1.4 * ctx.hs, z, rotY }));
      }
      next += opts.spacing;
    }
    dist += len;
  }
}

function nearBreach(p: P2, ctx: BuildContext, radius: number): boolean {
  return ctx.breaches.some((b) => Math.hypot(p.x - b.x, p.z - b.z) < radius);
}

export function buildWall(s: CityStructure, variant: string | null, ctx: BuildContext): Group {
  const batch = new Batch();
  const pts = resample(s.path!.map((p) => ctx.toLocal(p)), 12);
  const out = outwardSign(pts, ctx.cityCenter);
  const [baseH, baseT] = s.size ?? [10, 4];
  const hs = ctx.hs;

  if (s.kind === 'sea-wall') {
    batch.add('masonry', wallRibbon(pts, ctx.groundY, baseH * hs, baseT));
    addTowers(batch, pts, ctx, { spacing: 70, phase: 30, size: 8, height: (baseH + 5) * hs, offset: out * 2, mat: 'masonry' });
    return batch.build(ctx.mats, s.id);
  }

  if (variant === 'ruin') {
    const keep = (i: number) => ctx.hash(s.id, i) > 0.4;
    batch.add('ruin', wallRibbon(pts, ctx.groundY, baseH * hs * 0.4, baseT, { keep, heightAt: (i) => baseH * hs * (0.25 + 0.3 * ctx.hash(s.id + 'h', i)) }));
    addTowers(batch, pts, ctx, { spacing: 60, phase: 20, size: 9, height: baseH * hs * 0.5, offset: out * 2, mat: 'ruin', keep: (i) => ctx.hash(s.id + 't', i) > 0.5 });
    return batch.build(ctx.mats, s.id);
  }

  const triple = variant === 'triple' || variant === 'breached';
  const breached = variant === 'breached';
  const keepSeg = (line: P2[]) => (i: number) => !breached || !nearBreach(line[i], ctx, 55);

  // Inner wall + great towers.
  batch.add('masonry', wallRibbon(pts, ctx.groundY, baseH * hs, baseT, { keep: keepSeg(pts) }));
  addTowers(batch, pts, ctx, {
    spacing: 55,
    phase: 20,
    size: 11,
    height: (baseH + 8) * hs,
    offset: out * 3,
    mat: 'masonry',
    keep: (i) => !breached || !nearBreach(pts[Math.min(pts.length - 1, Math.round((i * 55 + 20) / 12))], ctx, 55),
  });

  if (triple) {
    // Outer wall 18 m out, its towers staggered between the inner ones.
    const outer = offsetPath(pts, out * 18);
    batch.add('masonry', wallRibbon(outer, ctx.groundY, 8.5 * hs, 2.2, { keep: keepSeg(outer) }));
    addTowers(batch, outer, ctx, {
      spacing: 55,
      phase: 47,
      size: 7,
      height: 13 * hs,
      offset: out * 2,
      mat: 'masonry',
      keep: (i) => !breached || !nearBreach(outer[Math.min(outer.length - 1, Math.round((i * 55 + 47) / 12))], ctx, 55),
    });
    // Parateichion terrace, then the moat with its low scarp wall.
    batch.add('sand', drapedStrip(offsetPath(pts, out * 9), ctx.groundY, 14, 0.5));
    const moat = offsetPath(pts, out * 38);
    batch.add('moat', drapedStrip(moat, ctx.groundY, 18, 0.3));
    batch.add('masonry', wallRibbon(offsetPath(pts, out * 28), ctx.groundY, 2 * hs, 1.2));
  }

  if (breached) {
    // Rubble heaps where the wall came down.
    for (const b of ctx.breaches) {
      for (let k = 0; k < 14; k++) {
        const x = b.x + (ctx.hash(s.id + 'rx', k) - 0.5) * 70;
        const z = b.z + (ctx.hash(s.id + 'rz', k) - 0.5) * 70;
        const sz = 4 + ctx.hash(s.id + 'rs', k) * 7;
        batch.add('ruin', xf(box(sz, sz * 0.5, sz * 0.8), { x, y: ctx.groundY(x, z) - 1, z, rotY: k }));
      }
    }
  }
  return batch.build(ctx.mats, s.id);
}
