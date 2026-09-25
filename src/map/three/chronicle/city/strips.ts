/**
 * Walls as folded paper strips: a chain of vertical quads along the wall's
 * true path, textured with a repeating drawing (masonry, brick bands,
 * crenellations cut out of the paper), with towers as small open paper
 * boxes. The same builder makes the arcades of the Aqueduct of Valens and
 * the colonnades round the forums.
 */
import { BufferAttribute, BufferGeometry, CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three';
import { resample, segmentLengths, pointAt, type XY } from '../../../../lib/polyline';
import { INK, arcade, crenellated, makePen, type Pen } from '../illumination';
import { BRICK, MARBLE } from './cardArt';

export type StripKind = 'land-wall' | 'sea-wall' | 'aqueduct' | 'colonnade' | 'tower';

/** Page units covered by one repeat of each strip drawing. */
export const TILE_LENGTH: Record<Exclude<StripKind, 'tower'>, number> = {
  'land-wall': 0.1,
  'sea-wall': 0.09,
  aqueduct: 0.13,
  colonnade: 0.05,
};

function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** Masonry with brick bands and a crenellated top, seamless left to right. */
function drawWall(pen: Pen, w: number, h: number, stone: string, bands: number): void {
  const { ctx } = pen;
  const top = h * 0.2;
  // Merlons first so the body overlaps their feet.
  const merlons = 8;
  const m = w / merlons;
  ctx.fillStyle = stone;
  for (let i = 0; i < merlons; i++) ctx.fillRect(i * m + m * 0.2, h * 0.04, m * 0.6, top);
  ctx.strokeStyle = INK;
  ctx.lineWidth = pen.u * (pen.flat ? 2.2 : 1.2);
  for (let i = 0; i < merlons; i++) ctx.strokeRect(i * m + m * 0.2, h * 0.04, m * 0.6, top);
  ctx.fillStyle = stone;
  ctx.fillRect(0, top, w, h - top);
  // Courses of ashlar.
  ctx.globalAlpha = pen.flat ? 0.6 : 0.3;
  ctx.lineWidth = pen.u * 0.7;
  for (let y = top + h * 0.07; y < h; y += h * 0.07) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  // Brick bands.
  ctx.fillStyle = BRICK;
  for (let i = 1; i <= bands; i++) {
    const y = top + ((h - top) * i) / (bands + 1);
    ctx.globalAlpha = pen.flat ? 1 : 0.7;
    ctx.fillRect(0, y - h * 0.025, w, h * 0.05);
  }
  ctx.globalAlpha = 1;
  // Wall walk and plinth.
  ctx.strokeStyle = INK;
  ctx.lineWidth = pen.u * (pen.flat ? 2.4 : 1.4);
  ctx.beginPath();
  ctx.moveTo(0, top);
  ctx.lineTo(w, top);
  ctx.moveTo(0, h - pen.u);
  ctx.lineTo(w, h - pen.u);
  ctx.stroke();
  ctx.fillStyle = '#000';
  ctx.globalAlpha = 0.12;
  ctx.fillRect(0, h * 0.86, w, h * 0.14);
  ctx.globalAlpha = 1;
}

function drawTower(pen: Pen, w: number, h: number, stone: string): void {
  const { ctx } = pen;
  const body = h * 0.14;
  ctx.fillStyle = stone;
  ctx.fillRect(0, body, w, h - body);
  const cren = crenellated(0, body, w, body + h * 0.02, w / 5, h * 0.1);
  ctx.beginPath();
  cren.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = pen.u * (pen.flat ? 2.4 : 1.3);
  ctx.stroke();
  ctx.fillStyle = BRICK;
  for (const f of [0.35, 0.58, 0.8]) {
    ctx.globalAlpha = pen.flat ? 1 : 0.7;
    ctx.fillRect(0, h * f, w, h * 0.035);
  }
  ctx.globalAlpha = 1;
  arcade(pen, w * 0.3, h * 0.22, w * 0.4, h * 0.1, 1, INK, 0.85);
  arcade(pen, w * 0.38, h * 0.45, w * 0.24, h * 0.08, 1, INK, 0.8);
  ctx.strokeRect(pen.u, body, w - pen.u * 2, h - body - pen.u);
  // Shade band for the paper edge.
  ctx.fillStyle = '#000';
  ctx.globalAlpha = 0.1;
  ctx.fillRect(w * 0.7, body, w * 0.3, h - body);
  ctx.globalAlpha = 1;
}

/** Two tiers of arches with the openings cut out. */
function drawAqueduct(pen: Pen, w: number, h: number): void {
  const { ctx } = pen;
  const stone = '#d9c29a';
  ctx.fillStyle = stone;
  ctx.fillRect(0, h * 0.06, w, h * 0.94);
  ctx.fillStyle = BRICK;
  ctx.globalAlpha = pen.flat ? 1 : 0.7;
  ctx.fillRect(0, h * 0.5, w, h * 0.04);
  ctx.fillRect(0, h * 0.1, w, h * 0.03);
  ctx.globalAlpha = 1;
  const cut = (x: number, top: number, aw: number, bottom: number) => {
    ctx.beginPath();
    ctx.moveTo(x, bottom);
    ctx.lineTo(x, top + aw / 2);
    ctx.arc(x + aw / 2, top + aw / 2, aw / 2, Math.PI, 0);
    ctx.lineTo(x + aw, bottom);
    ctx.closePath();
  };
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 2; i++) {
    cut(w * (0.09 + i * 0.5), h * 0.58, w * 0.32, h * 1.01);
    ctx.fill();
  }
  for (let i = 0; i < 4; i++) {
    cut(w * (0.05 + i * 0.25), h * 0.18, w * 0.15, h * 0.47);
    ctx.fill();
  }
  ctx.restore();
  ctx.strokeStyle = INK;
  ctx.lineWidth = pen.u * (pen.flat ? 2.2 : 1.1);
  for (let i = 0; i < 2; i++) {
    cut(w * (0.09 + i * 0.5), h * 0.58, w * 0.32, h * 1.01);
    ctx.stroke();
  }
  for (let i = 0; i < 4; i++) {
    cut(w * (0.05 + i * 0.25), h * 0.18, w * 0.15, h * 0.47);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(0, h * 0.06);
  ctx.lineTo(w, h * 0.06);
  ctx.stroke();
}

/** Columns under an architrave, open between the columns. */
function drawColonnade(pen: Pen, w: number, h: number): void {
  const { ctx } = pen;
  ctx.fillStyle = MARBLE;
  ctx.fillRect(0, h * 0.04, w, h * 0.2);
  ctx.fillRect(0, h * 0.9, w, h * 0.1);
  ctx.strokeStyle = INK;
  ctx.lineWidth = pen.u * (pen.flat ? 2.2 : 1.1);
  ctx.strokeRect(-2, h * 0.04, w + 4, h * 0.2);
  for (let i = 0; i < 3; i++) {
    const cx = w * (0.16 + i * 0.333);
    ctx.fillStyle = MARBLE;
    ctx.fillRect(cx - w * 0.04, h * 0.24, w * 0.08, h * 0.66);
    ctx.strokeRect(cx - w * 0.04, h * 0.24, w * 0.08, h * 0.66);
    ctx.fillRect(cx - w * 0.07, h * 0.22, w * 0.14, h * 0.05);
    ctx.strokeRect(cx - w * 0.07, h * 0.22, w * 0.14, h * 0.05);
  }
}

export interface StripTexture {
  texture: CanvasTexture;
  canvas: HTMLCanvasElement;
  gold: HTMLCanvasElement;
  size: [number, number];
}

export function drawStripTexture(kind: StripKind, flat: boolean): StripTexture {
  const [w, h] = kind === 'tower' ? [192, 320] : kind === 'colonnade' ? [256, 160] : kind === 'aqueduct' ? [512, 256] : [512, 256];
  const c = canvas(w, h);
  const gold = canvas(w, h);
  const pen = makePen(c.getContext('2d')!, kind.length * 31, Math.max(w, h) / 420, { flat });
  if (kind === 'land-wall') drawWall(pen, w, h, '#dcc49a', 3);
  else if (kind === 'sea-wall') drawWall(pen, w, h, '#d6c29e', 2);
  else if (kind === 'tower') drawTower(pen, w, h, '#d9c197');
  else if (kind === 'aqueduct') drawAqueduct(pen, w, h);
  else drawColonnade(pen, w, h);
  const texture = new CanvasTexture(c);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.anisotropy = 8;
  return { texture, canvas: c, gold, size: [w, h] };
}

/**
 * A vertical strip along `path` (page units), `height` tall, with the
 * drawing repeated every `tile` units. `skip(i)` leaves gaps (ruins).
 */
export function stripGeometry(path: XY[], height: number, tile: number, skip?: (segment: number) => boolean): BufferGeometry {
  const pts = resample(path, 0.02);
  const cum = segmentLengths(pts);
  const pos: number[] = [];
  const uv: number[] = [];
  const index: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    const [x, z] = pts[i];
    pos.push(x, 0, z, x, height, z);
    uv.push(cum[i] / tile, 0, cum[i] / tile, 1);
  }
  for (let i = 0; i < pts.length - 1; i++) {
    if (skip?.(i)) continue;
    const a = i * 2;
    index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  g.setIndex(index);
  return g;
}

/** Square paper towers at the given points, turned to follow the wall. */
export function towerGeometry(towers: Array<{ at: XY; angle: number }>, width: number, height: number): BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const index: number[] = [];
  const hw = width / 2;
  for (const { at, angle } of towers) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const corner = (dx: number, dz: number): XY => [at[0] + dx * c - dz * s, at[1] + dx * s + dz * c];
    const corners = [corner(-hw, -hw), corner(hw, -hw), corner(hw, hw), corner(-hw, hw)];
    for (let f = 0; f < 4; f++) {
      const a = corners[f];
      const b = corners[(f + 1) % 4];
      const v = pos.length / 3;
      pos.push(a[0], 0, a[1], b[0], 0, b[1], b[0], height, b[1], a[0], height, a[1]);
      uv.push(0, 0, 1, 0, 1, 1, 0, 1);
      index.push(v, v + 1, v + 2, v, v + 2, v + 3);
    }
    // Roof of the tower (the wall-walk stone).
    const v = pos.length / 3;
    const top = height * 0.86;
    for (const p of corners) {
      pos.push(p[0], top, p[1]);
      uv.push(0.5, 0.3);
    }
    index.push(v, v + 1, v + 2, v, v + 2, v + 3);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  g.setIndex(index);
  return g;
}

/** Tower positions every `spacing` along a path, starting at `phase`. */
export function towersAlong(path: XY[], spacing: number, phase = 0): Array<{ at: XY; angle: number }> {
  const cum = segmentLengths(path);
  const total = cum[cum.length - 1];
  const out: Array<{ at: XY; angle: number }> = [];
  for (let s = phase; s <= total + 1e-9; s += spacing) {
    const a = pointAt(path, cum, s - 0.005);
    const b = pointAt(path, cum, s + 0.005);
    out.push({ at: pointAt(path, cum, s), angle: Math.atan2(b[1] - a[1], b[0] - a[0]) });
  }
  return out;
}
