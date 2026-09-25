/**
 * Procedural manuscript illumination on a 2D canvas: pen-and-ink linework
 * with a slight hand wobble, watercolour washes (a thin fill, a second
 * offset fill for granulation, pigment pooled at the edge), hatching for
 * shade, and gold leaf with bright burnished strokes. Used to draw the
 * pop-up city cards and roundels of the chronicle map — no image assets.
 */
import { mulberry32 } from '../../../lib/prng';

export const INK = '#3a2a1e';
export const PALETTE = {
  stone: '#e4cb9e',
  stoneShade: '#c8a676',
  stoneDeep: '#a98a5f',
  roof: '#b8583a',
  roofShade: '#8c3e27',
  gold: '#d5aa43',
  goldHi: '#f7e09a',
  porphyry: '#7d3b50',
  water: '#7fb3b1',
  vermilion: '#5e2590', // imperial purple: name ribbons, roundel petals
  paper: '#efe3c8',
  green: '#8a9a5c',
  sky: '#b8c9cf',
};

export type Pt = [number, number];

export interface Pen {
  ctx: CanvasRenderingContext2D;
  rand: () => number;
  /** Stroke width unit (px) — scales all linework with the canvas. */
  u: number;
}

export function makePen(ctx: CanvasRenderingContext2D, seed: number, unit: number): Pen {
  return { ctx, rand: mulberry32(seed), u: unit };
}

/** Wobbly polyline path (hand-drawn): subdivide and jitter perpendicular. */
function tracePath(pen: Pen, pts: Pt[], closed: boolean, wobble = 0.6): void {
  const { ctx, rand, u } = pen;
  ctx.beginPath();
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[(i + 1) % pts.length];
    const len = Math.hypot(bx - ax, by - ay);
    const steps = Math.max(1, Math.round(len / (u * 6)));
    const nx = -(by - ay) / (len || 1);
    const ny = (bx - ax) / (len || 1);
    for (let k = 0; k <= steps; k++) {
      if (k === 0 && i > 0) continue;
      const t = k / steps;
      const j = (rand() - 0.5) * wobble * u * (k === 0 || k === steps ? 0.3 : 1);
      const x = ax + (bx - ax) * t + nx * j;
      const y = ay + (by - ay) * t + ny * j;
      if (i === 0 && k === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
  }
  if (closed) ctx.closePath();
}

/** Ink outline; `double` adds a lighter second pass (a pen retracing). */
export function ink(pen: Pen, pts: Pt[], closed = true, width = 1, double = true): void {
  const { ctx, u } = pen;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = INK;
  ctx.lineWidth = width * u;
  tracePath(pen, pts, closed);
  ctx.stroke();
  if (double) {
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = width * u * 0.6;
    tracePath(pen, pts, closed, 1.1);
    ctx.stroke();
  }
  ctx.restore();
}

/** Watercolour wash: thin fill, granulating second fill, pooled edge. */
export function wash(pen: Pen, pts: Pt[], color: string, strength = 0.85): void {
  const { ctx, rand, u } = pen;
  ctx.save();
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.75 * strength;
  tracePath(pen, pts, true, 1.4);
  ctx.fill();
  ctx.globalAlpha = 0.25 * strength;
  ctx.translate((rand() - 0.5) * u * 1.5, (rand() - 0.5) * u * 1.5);
  tracePath(pen, pts, true, 2.2);
  ctx.fill();
  ctx.globalAlpha = 0.35 * strength;
  ctx.strokeStyle = color;
  ctx.lineWidth = u * 1.6;
  tracePath(pen, pts, true, 1.4);
  ctx.stroke();
  ctx.restore();
}

/** Parallel hatching clipped to a polygon (shade side of a building). */
export function hatch(pen: Pen, pts: Pt[], spacing = 5, angle = -0.9, alpha = 0.55): void {
  const { ctx, u } = pen;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  ctx.save();
  tracePath(pen, pts, true, 0);
  ctx.clip();
  ctx.strokeStyle = INK;
  ctx.globalAlpha = alpha;
  ctx.lineWidth = u * 0.55;
  const d = Math.hypot(x1 - x0, y1 - y0);
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  const step = spacing * u;
  for (let s = -d; s <= d; s += step) {
    const px = cx - sa * s;
    const py = cy + ca * s;
    ctx.beginPath();
    ctx.moveTo(px - ca * d, py - sa * d);
    ctx.lineTo(px + ca * d, py + sa * d);
    ctx.stroke();
  }
  ctx.restore();
}

/** Gold leaf: flat gold wash, burnished highlight strokes, ink outline. */
export function gild(pen: Pen, pts: Pt[], outline = true): void {
  const { ctx, rand, u } = pen;
  wash(pen, pts, PALETTE.gold, 1);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  ctx.save();
  tracePath(pen, pts, true, 0);
  ctx.clip();
  ctx.strokeStyle = PALETTE.goldHi;
  ctx.lineCap = 'round';
  for (let i = 0; i < 7; i++) {
    ctx.globalAlpha = 0.5 + rand() * 0.4;
    ctx.lineWidth = u * (0.8 + rand() * 1.4);
    const y = y0 + (y1 - y0) * (0.2 + rand() * 0.5);
    ctx.beginPath();
    ctx.moveTo(x0 + (x1 - x0) * (0.15 + rand() * 0.2), y);
    ctx.quadraticCurveTo(x0 + (x1 - x0) * 0.5, y - (y1 - y0) * 0.15, x0 + (x1 - x0) * (0.55 + rand() * 0.3), y + (rand() - 0.5) * u * 4);
    ctx.stroke();
  }
  ctx.restore();
  if (outline) ink(pen, pts, true, 0.9, false);
}

export const rect = (x: number, y: number, w: number, h: number): Pt[] => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h],
];

/** Crenellated top edge as a polygon (merlons of width m). */
export function crenellated(x: number, top: number, w: number, bottom: number, m: number, mh: number): Pt[] {
  const pts: Pt[] = [[x, bottom]];
  let cx = x;
  let up = true;
  pts.push([x, top - mh]);
  while (cx < x + w - 1e-6) {
    const nx = Math.min(x + w, cx + m);
    pts.push([nx, up ? top - mh : top]);
    if (nx < x + w - 1e-6) pts.push([nx, up ? top : top - mh]);
    up = !up;
    cx = nx;
  }
  pts.push([x + w, bottom]);
  return pts;
}

/** Dome silhouette (half ellipse) sitting on y = base. */
export function domePts(cx: number, base: number, rx: number, ry: number, n = 24): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const a = Math.PI - (i / n) * Math.PI;
    pts.push([cx + Math.cos(a) * rx, base - Math.sin(a) * ry]);
  }
  return pts;
}

/** Row of small arches (windows/arcades) as dark fills. */
export function arcade(pen: Pen, x: number, y: number, w: number, h: number, count: number, fill = INK, alpha = 0.75): void {
  const { ctx } = pen;
  const gap = w / count;
  ctx.save();
  ctx.fillStyle = fill;
  ctx.globalAlpha = alpha;
  for (let i = 0; i < count; i++) {
    const ax = x + gap * (i + 0.2);
    const aw = gap * 0.6;
    ctx.beginPath();
    ctx.moveTo(ax, y + h);
    ctx.lineTo(ax, y + aw / 2);
    ctx.arc(ax + aw / 2, y + aw / 2, aw / 2, Math.PI, 0);
    ctx.lineTo(ax + aw, y + h);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}
