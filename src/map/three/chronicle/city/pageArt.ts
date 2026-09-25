/**
 * The city view's ground: a plan of the city and its waters, drawn on
 * canvases in one of two manners:
 *
 *  - mosaic: the cartoon for a floor mosaic after the Madaba map: cream
 *    limestone land, blue water with rows of zigzag waves, black outline
 *    rows, white marble roads, lettered in Greek capitals;
 *  - watercolour: the chronicle map's parchment, washes, sepia hachures and
 *    inked chart ripples, lettered in Latin capitals.
 *
 * The ground is drawn at two resolutions. The detail layer is the plan of
 * the city (roads, harbours, walls, lettering, the title plaque) and fades
 * out at its edges. The outer layer under it carries the land, sea, fields
 * and coast far out to the hazy horizon; past the baked land mask the
 * coasts run straight on. Patterns are anchored to page coordinates, so
 * the two layers agree where they overlap.
 *
 * The auxiliary canvas tells the mosaic shader what to set in tesserae (R)
 * and what in gold (G).
 */
import type { CityPlan } from '../../../../data/schema';
import type { CityFrame } from '../../../../lib/cityFrame';
import type { CityState } from '../../../../lib/cityTimeline';
import type { XY } from '../../../../lib/polyline';
import { INK, PALETTE, makePen, markGold, wash, ink, type Pen, type Pt } from '../illumination';
import { offsetOutward, pointInRing, ringCentroid, type Plate } from './geometry';

export type PageStyle = 'watercolour' | 'mosaic';

interface Palette {
  sea: string;
  seaDeep: string;
  ripple: string;
  land: string;
  landPool: string;
  hill: string;
  urban: string;
  road: string;
  roadEdge: string;
  plaza: string;
  coast: string;
  wall: string;
  cistern: string;
  burnt: string;
  waterLetter: string;
  placeLetter: string;
  fields: string[];
  rows: string;
}

const WATERCOLOUR: Palette = {
  sea: '#8fbcb8',
  seaDeep: '#6a9fa8',
  ripple: '#2f4f5e',
  land: '#ecdcb4',
  landPool: '#d6bd8c',
  hill: '#7a5a3a',
  urban: '#dcb48f',
  road: '#f4e8cc',
  roadEdge: '#6b5236',
  plaza: '#efe2c2',
  coast: INK,
  wall: '#5a4632',
  cistern: '#86b8b6',
  burnt: '#4a3222',
  waterLetter: '#2f4f5e',
  placeLetter: '#8c2f23',
  fields: ['#c7c38a', '#b3bb80', '#d6c28f', '#a6b37e'],
  rows: '#6f7a45',
};

const MOSAIC: Palette = {
  sea: '#7ea9b8',
  seaDeep: '#4b7d93',
  ripple: '#34647c',
  land: '#e8dcc2',
  landPool: '#d9c6a0',
  hill: '#c9ad82',
  urban: '#d9a98c',
  road: '#f6f1e6',
  roadEdge: '#5b4a3c',
  plaza: '#f1e9d8',
  coast: '#2d2a2a',
  wall: '#4a3f38',
  cistern: '#5f93a8',
  burnt: '#3e2a22',
  waterLetter: '#1f2d48',
  placeLetter: '#8a1f1f',
  fields: ['#c9c08a', '#b5b77c', '#d8c595', '#a9b27a'],
  rows: '#7d8a4e',
};

/** Wave rows and tooth width of the mosaic sea; field grid (page units). */
const WAVE_ROW = 0.055;
const WAVE_TOOTH = 0.022;
const FIELD_STEP = 0.075;
/** How far the detail layer fades out at its edges (page units). */
export const DETAIL_FEATHER = 0.3;

export interface PageWalls {
  id: string;
  kind: 'land-wall' | 'sea-wall';
  variant: string;
  path: XY[];
}

export interface GroundInput {
  plan: CityPlan;
  state: CityState;
  frame: CityFrame;
  plate: Plate | null;
  walls: PageWalls[];
  style: PageStyle;
}

/** A rectangle of the page (page units, top-left corner) drawn at `ppu` pixels per unit. */
export interface GroundRegion {
  x0: number;
  z0: number;
  width: number;
  depth: number;
  ppu: number;
}

export interface PageCanvases {
  canvas: HTMLCanvasElement;
  aux: HTMLCanvasElement;
}

function newCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export function regionSize(r: GroundRegion): [number, number] {
  return [Math.round(r.width * r.ppu), Math.round(r.depth * r.ppu)];
}

function hash01(i: number, j: number, salt: number): number {
  let h = Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(salt, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function drawGround(input: GroundInput, region: GroundRegion, layer: 'detail' | 'outer', target?: PageCanvases): PageCanvases {
  const { plan, state, frame, plate, walls, style } = input;
  const detail = layer === 'detail';
  const pal = style === 'mosaic' ? MOSAIC : WATERCOLOUR;
  const [W, H] = regionSize(region);
  const canvas = target?.canvas ?? newCanvas(W, H);
  const aux = target?.aux ?? newCanvas(W, H);
  const ctx = canvas.getContext('2d')!;
  const gold = newCanvas(W, H);
  const pen = makePen(ctx, 537, region.ppu / 420, { flat: style === 'mosaic', gold: gold.getContext('2d')! });

  const X = (x: number) => (x - region.x0) * region.ppu;
  const Z = (z: number) => (z - region.z0) * region.ppu;
  const P = ([x, z]: XY): Pt => [X(x), Z(z)];
  const L = ([lon, lat]: readonly [number, number]): Pt => {
    const p = frame.toPage(lon, lat);
    return [X(p.x), Z(p.z)];
  };
  const px = (units: number) => units * region.ppu;
  const inView = (x: number, z: number, margin = 0.1) =>
    x > region.x0 - margin && x < region.x0 + region.width + margin && z > region.z0 - margin && z < region.z0 + region.depth + margin;

  const path = (c: CanvasRenderingContext2D, pts: Pt[], closed = false) => {
    c.beginPath();
    pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
    if (closed) c.closePath();
  };

  // Land mask at this resolution; past the baked mask the edge rows and
  // columns are stretched outward, so coasts run straight on.
  const landMask = newCanvas(W, H);
  if (plate) {
    const m = landMask.getContext('2d')!;
    const img = plate.landImage;
    const [ow, os, oe, on] = plate.data.outerBbox;
    const [x0, y0] = L([ow, on]);
    const [x1, y1] = L([oe, os]);
    const iw = img.width;
    const ih = img.height;
    m.imageSmoothingEnabled = true;
    m.drawImage(img, x0, y0, x1 - x0, y1 - y0);
    if (!detail) {
      m.drawImage(img, 0, 0, 1, ih, 0, y0, x0, y1 - y0);
      m.drawImage(img, iw - 1, 0, 1, ih, x1, y0, W - x1, y1 - y0);
      m.drawImage(img, 0, 0, iw, 1, x0, 0, x1 - x0, y0);
      m.drawImage(img, 0, ih - 1, iw, 1, x0, y1, x1 - x0, H - y1);
      m.drawImage(img, 0, 0, 1, 1, 0, 0, x0, y0);
      m.drawImage(img, iw - 1, 0, 1, 1, x1, 0, W - x1, y0);
      m.drawImage(img, 0, ih - 1, 1, 1, 0, y1, x0, H - y1);
      m.drawImage(img, iw - 1, ih - 1, 1, 1, x1, y1, W - x1, H - y1);
    }
  }
  const onLand = (draw: (c: CanvasRenderingContext2D) => void) => {
    const layerCanvas = newCanvas(W, H);
    const c = layerCanvas.getContext('2d')!;
    draw(c);
    c.globalCompositeOperation = 'destination-in';
    c.drawImage(landMask, 0, 0);
    ctx.drawImage(layerCanvas, 0, 0);
  };

  ctx.save();
  ctx.clearRect(0, 0, W, H);

  /* ---- sea ---- */
  ctx.fillStyle = pal.sea;
  ctx.fillRect(0, 0, W, H);
  if (style === 'mosaic') {
    // Rows of zigzag waves, as on the Madaba map.
    ctx.strokeStyle = pal.seaDeep;
    ctx.lineWidth = px(0.0065);
    ctx.lineJoin = 'miter';
    const k0 = Math.floor(region.z0 / WAVE_ROW) - 1;
    const k1 = Math.ceil((region.z0 + region.depth) / WAVE_ROW) + 1;
    const j0 = Math.floor(region.x0 / WAVE_TOOTH) - 2;
    const j1 = Math.ceil((region.x0 + region.width) / WAVE_TOOTH) + 2;
    for (let k = k0; k <= k1; k++) {
      const z = (k + 0.5) * WAVE_ROW;
      ctx.beginPath();
      for (let j = j0; j <= j1; j++) {
        const x = (j + (k & 1)) * WAVE_TOOTH;
        const zz = z + (j & 1 ? -WAVE_TOOTH * 0.35 : WAVE_TOOTH * 0.35);
        if (j === j0) ctx.moveTo(X(x), Z(zz));
        else ctx.lineTo(X(x), Z(zz));
      }
      ctx.stroke();
    }
  } else {
    // Soft wet-in-wet blooms on a fixed lattice.
    const step = 0.4;
    for (let j = Math.floor(region.z0 / step) - 1; j * step < region.z0 + region.depth + step; j++) {
      for (let i = Math.floor(region.x0 / step) - 1; i * step < region.x0 + region.width + step; i++) {
        const x = (i + hash01(i, j, 11)) * step;
        const z = (j + hash01(i, j, 12)) * step;
        const r = px(0.08 + hash01(i, j, 13) * 0.25);
        const g = ctx.createRadialGradient(X(x), Z(z), 0, X(x), Z(z), r);
        g.addColorStop(0, 'rgba(60, 110, 125, 0.10)');
        g.addColorStop(1, 'rgba(60, 110, 125, 0)');
        ctx.fillStyle = g;
        ctx.fillRect(X(x) - r, Z(z) - r, r * 2, r * 2);
      }
    }
  }

  /* ---- ripples along the coast (drawn wide, the land covers the inner half) ---- */
  if (plate) {
    const coasts = plate.coast.map((line) => line.map(P));
    const rings = style === 'mosaic' ? [0.022, 0.044] : [0.018, 0.036, 0.058];
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (let i = rings.length - 1; i >= 0; i--) {
      const d = px(rings[i]) * 2;
      const lw = px(style === 'mosaic' ? 0.006 : 0.0025);
      for (const line of coasts) {
        ctx.globalAlpha = style === 'mosaic' ? 1 : 0.55 - i * 0.12;
        ctx.strokeStyle = pal.ripple;
        ctx.lineWidth = d + lw;
        path(ctx, line);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = pal.sea;
        ctx.lineWidth = d - lw;
        path(ctx, line);
        ctx.stroke();
      }
    }
  }

  /* ---- land ---- */
  if (plate) {
    onLand((c) => {
      c.fillStyle = pal.land;
      c.fillRect(0, 0, W, H);
      if (style === 'watercolour') {
        // Pigment granulation and pooled edges.
        const step = 0.3;
        for (let j = Math.floor(region.z0 / step) - 1; j * step < region.z0 + region.depth + step; j++) {
          for (let i = Math.floor(region.x0 / step) - 1; i * step < region.x0 + region.width + step; i++) {
            const x = (i + hash01(i, j, 21)) * step;
            const z = (j + hash01(i, j, 22)) * step;
            const r = px(0.05 + hash01(i, j, 23) * 0.18);
            const g = c.createRadialGradient(X(x), Z(z), 0, X(x), Z(z), r);
            g.addColorStop(0, 'rgba(170, 140, 90, 0.10)');
            g.addColorStop(1, 'rgba(170, 140, 90, 0)');
            c.fillStyle = g;
            c.fillRect(X(x) - r, Z(z) - r, r * 2, r * 2);
          }
        }
        c.strokeStyle = pal.landPool;
        c.lineWidth = px(0.02);
        c.globalAlpha = 0.7;
        for (const line of plate.coast) {
          path(c, line.map(P));
          c.stroke();
        }
        c.globalAlpha = 1;
      }
      if (!detail) return;
      /* hills */
      for (const { level, lines } of plate.data.contours) {
        c.strokeStyle = pal.hill;
        c.globalAlpha = style === 'mosaic' ? 0.55 + Math.min(0.4, level / 400) : 0.22;
        c.lineWidth = px(style === 'mosaic' ? 0.009 : 0.0022);
        for (const line of lines) {
          path(c, line.map(L));
          c.stroke();
        }
      }
      c.globalAlpha = 1;
      if (style === 'watercolour') {
        c.strokeStyle = INK;
        c.lineCap = 'round';
        for (const [lon0, lat0, lon1, lat1, steep] of plate.data.hachures) {
          c.globalAlpha = 0.18 + steep * 0.35;
          c.lineWidth = px(0.0018 + steep * 0.0018);
          const a = L([lon0, lat0]);
          const b = L([lon1, lat1]);
          c.beginPath();
          c.moveTo(a[0], a[1]);
          c.lineTo(b[0], b[1]);
          c.stroke();
        }
        c.globalAlpha = 1;
      }
    });
  } else {
    ctx.fillStyle = pal.land;
    ctx.fillRect(0, 0, W, H);
  }

  /* ---- fields, vineyards and orchards outside the built-up areas ---- */
  if (plate) {
    const urbanRings = state.urbanAreas.map((a) => a.ring.map(L));
    const inTown = (p: Pt) => urbanRings.some((r) => pointInRing(p, r));
    onLand((c) => {
      const i0 = Math.floor(region.x0 / FIELD_STEP) - 1;
      const i1 = Math.ceil((region.x0 + region.width) / FIELD_STEP) + 1;
      const j0 = Math.floor(region.z0 / FIELD_STEP) - 1;
      const j1 = Math.ceil((region.z0 + region.depth) / FIELD_STEP) + 1;
      const step = px(FIELD_STEP);
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const r = hash01(i, j, 31);
          if (r > 0.42) continue;
          const cx = X((i + 0.5 + (hash01(i, j, 32) - 0.5) * 0.6) * FIELD_STEP);
          const cy = Z((j + 0.5 + (hash01(i, j, 33) - 0.5) * 0.6) * FIELD_STEP);
          if (inTown([cx, cy])) continue;
          const a = hash01(i, j, 34) * Math.PI;
          const hw = step * (0.22 + hash01(i, j, 35) * 0.2);
          const hh = step * (0.14 + hash01(i, j, 36) * 0.14);
          const ca = Math.cos(a);
          const sa = Math.sin(a);
          const corner = (dx: number, dy: number): Pt => [cx + dx * ca - dy * sa, cy + dx * sa + dy * ca];
          const parcel = [corner(-hw, -hh), corner(hw, -hh), corner(hw, hh), corner(-hw, hh)];
          c.fillStyle = pal.fields[Math.floor(hash01(i, j, 37) * pal.fields.length)];
          c.globalAlpha = style === 'mosaic' ? 0.7 : 0.4;
          path(c, parcel, true);
          c.fill();
          if (r < 0.14) {
            // Vine or olive rows.
            c.strokeStyle = pal.rows;
            c.globalAlpha = style === 'mosaic' ? 0.9 : 0.45;
            c.lineWidth = px(style === 'mosaic' ? 0.005 : 0.0025);
            for (let k = -2; k <= 2; k++) {
              const o = (k / 2.5) * hh;
              const p0 = corner(-hw * 0.85, o);
              const p1 = corner(hw * 0.85, o);
              c.beginPath();
              c.moveTo(p0[0], p0[1]);
              c.lineTo(p1[0], p1[1]);
              c.stroke();
            }
          }
          c.globalAlpha = 1;
        }
      }
    });
  }

  /* ---- built-up areas and burnt districts ---- */
  if (plate) {
    onLand((c) => {
      const layerPen = { ...pen, ctx: c };
      for (const area of state.urbanAreas) {
        const ring = area.ring.map(L);
        if (style === 'mosaic') {
          c.fillStyle = pal.urban;
          c.globalAlpha = 0.55 + 0.4 * Math.min(1, area.weight * state.density);
          path(c, ring, true);
          c.fill();
          c.globalAlpha = 1;
        } else {
          wash(layerPen, ring, pal.urban, 0.35 + 0.35 * Math.min(1, area.weight * state.density));
        }
      }
      if (!detail) return;
      for (const f of state.features) {
        if (f.kind !== 'burnt' || !f.ring) continue;
        c.globalAlpha = 0.45;
        c.fillStyle = pal.burnt;
        path(c, f.ring.map(L), true);
        c.fill();
        c.globalAlpha = 1;
      }
    });
  }

  if (detail) drawCityDetail();

  /* ---- coast line ---- */
  if (plate) {
    ctx.strokeStyle = pal.coast;
    ctx.lineJoin = 'round';
    ctx.lineWidth = px(style === 'mosaic' ? 0.0075 : 0.0042);
    for (const line of plate.coast) {
      path(ctx, line.map(P));
      ctx.stroke();
    }
  }

  let plaque: Pt[] | null = null;
  if (detail) {
    drawLettering();
    plaque = drawPlaque(ctx, pen, L(plan.page.plaque), px(1.15), px(0.25), plan.inscription);
  }
  ctx.restore();

  if (detail) {
    // Fade the plan out at its edges into the outer ground beneath.
    const fade = newCanvas(W, H);
    const f = fade.getContext('2d')!;
    f.fillStyle = '#fff';
    f.fillRect(0, 0, W, H);
    f.globalCompositeOperation = 'destination-out';
    const d = px(DETAIL_FEATHER);
    const edge = (x0: number, y0: number, x1: number, y1: number, rx: number, ry: number, rw: number, rh: number) => {
      const g = f.createLinearGradient(x0, y0, x1, y1);
      g.addColorStop(0, 'rgba(0,0,0,1)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      f.fillStyle = g;
      f.fillRect(rx, ry, rw, rh);
    };
    edge(0, 0, d, 0, 0, 0, d, H);
    edge(W, 0, W - d, 0, W - d, 0, d, H);
    edge(0, 0, 0, d, 0, 0, W, d);
    edge(0, H, 0, H - d, 0, H - d, W, d);
    ctx.save();
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(fade, 0, 0);
    ctx.restore();
  }

  /* ---- auxiliary: R = tesserae, G = gold ---- */
  const a = aux.getContext('2d')!;
  a.save();
  a.fillStyle = '#000000';
  a.fillRect(0, 0, W, H);
  a.fillStyle = '#ff0000';
  if (style === 'mosaic') {
    a.fillRect(0, 0, W, H);
  } else if (plaque) {
    a.beginPath();
    plaque.forEach(([x, y], i) => (i ? a.lineTo(x, y) : a.moveTo(x, y)));
    a.closePath();
    a.fill();
  }
  a.restore();
  mergeGold(aux, gold);
  return { canvas, aux };

  /** Roads, open spaces, harbours, cisterns, wall footprints and the moat. */
  function drawCityDetail(): void {
    const shape = (pos: readonly [number, number], size: readonly [number, number], bearing: number, kind: 'rect' | 'ellipse', grow = 1): Pt[] => {
      const [cx, cy] = L(pos);
      const hw = px(frame.units(size[0] * grow)) / 2;
      const hh = px(frame.units(size[1] * grow)) / 2;
      const ang = (bearing * Math.PI) / 180;
      const rot = ([x, y]: Pt): Pt => [cx + x * Math.cos(ang) - y * Math.sin(ang), cy + x * Math.sin(ang) + y * Math.cos(ang)];
      if (kind === 'ellipse') {
        return Array.from({ length: 28 }, (_, i) => rot([Math.cos((i / 28) * Math.PI * 2) * hw, Math.sin((i / 28) * Math.PI * 2) * hh]));
      }
      return [rot([-hw, -hh]), rot([hw, -hh]), rot([hw, hh]), rot([-hw, hh])];
    };
    const featureShape = (f: (typeof state.features)[number], grow = 1): Pt[] | null => {
      if (f.ring) return f.ring.map(L);
      if (f.position && f.size) return shape(f.position, f.size, f.bearing ?? 0, f.shape ?? 'rect', grow);
      return null;
    };

    for (const f of state.features) {
      if (f.kind !== 'avenue' || !f.path) continue;
      const pts = f.path.map(L);
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.strokeStyle = pal.roadEdge;
      ctx.lineWidth = px(style === 'mosaic' ? 0.02 : 0.014);
      path(ctx, pts);
      ctx.stroke();
      ctx.strokeStyle = pal.road;
      ctx.lineWidth = px(style === 'mosaic' ? 0.011 : 0.009);
      path(ctx, pts);
      ctx.stroke();
    }
    for (const f of state.features) {
      if (f.kind !== 'plaza') continue;
      const s = featureShape(f, 2.2);
      if (!s) continue;
      if (style === 'mosaic') {
        ctx.fillStyle = pal.plaza;
        path(ctx, s, true);
        ctx.fill();
        ctx.strokeStyle = pal.roadEdge;
        ctx.lineWidth = px(0.006);
        ctx.stroke();
      } else {
        wash(pen, s, pal.plaza, 0.9);
        ink(pen, s, true, 0.7, false);
      }
    }
    for (const f of state.features) {
      if (f.kind !== 'harbour' && f.kind !== 'cistern') continue;
      const s = featureShape(f, f.kind === 'cistern' ? 1.8 : 1);
      if (!s) continue;
      ctx.fillStyle = f.kind === 'cistern' ? pal.cistern : pal.sea;
      path(ctx, s, true);
      ctx.fill();
      if (f.kind === 'cistern') {
        ctx.strokeStyle = style === 'mosaic' ? pal.roadEdge : '#b8a27c';
        ctx.lineWidth = px(0.007);
        ctx.stroke();
      }
      if (style === 'mosaic') {
        ctx.strokeStyle = pal.coast;
        ctx.lineWidth = px(0.0045);
        ctx.stroke();
      } else {
        ink(pen, s, true, 0.9, false);
      }
    }

    const cityRing = state.urbanAreas.find((ar) => ar.id.startsWith('city'))?.ring;
    const centre: XY = cityRing
      ? ringCentroid(
          cityRing.map(([lon, lat]) => {
            const p = frame.toPage(lon, lat);
            return [p.x, p.z] as XY;
          }),
        )
      : [0, 0];
    for (const wall of walls) {
      const pts = wall.path.map(P);
      if (wall.kind === 'land-wall' && (wall.variant === 'triple' || wall.variant === 'breached')) {
        const moat = offsetOutward(wall.path, 0.05, centre).map(P);
        ctx.strokeStyle = pal.coast;
        ctx.lineWidth = px(0.026);
        path(ctx, moat);
        ctx.stroke();
        ctx.strokeStyle = pal.sea;
        ctx.lineWidth = px(0.018);
        path(ctx, moat);
        ctx.stroke();
      }
      ctx.strokeStyle = pal.wall;
      ctx.globalAlpha = wall.variant === 'ruin' ? 0.4 : 0.85;
      ctx.lineWidth = px(wall.kind === 'land-wall' ? 0.014 : 0.01);
      path(ctx, pts);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  function drawLettering(): void {
    const letter = (text: string, at: Pt, angle: number, size: number, color: string, spacing = 0.25) => {
      ctx.save();
      ctx.translate(at[0], at[1]);
      ctx.rotate((-angle * Math.PI) / 180);
      ctx.font = `700 ${Math.round(size)}px Cinzel, "Noto Serif", Georgia, serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${spacing}em`;
      if (style === 'watercolour') {
        ctx.fillStyle = 'rgba(236, 220, 180, 0.55)';
        ctx.fillText(text, 1, 1);
      }
      if (style === 'mosaic') {
        // Letters set in stone need strokes at least two tesserae wide.
        ctx.strokeStyle = color;
        ctx.lineJoin = 'round';
        ctx.lineWidth = size * 0.1;
        ctx.strokeText(text, 0, 0);
      }
      ctx.fillStyle = color;
      ctx.fillText(text, 0, 0);
      ctx.restore();
    };
    for (const label of state.labels) {
      const p = frame.toPage(...label.position);
      if (!inView(p.x, p.z)) continue;
      const text = style === 'mosaic' ? label.inscription.greek : label.inscription.latin;
      const size = px(label.size === 'sea' ? 0.06 : label.size === 'strait' ? 0.04 : 0.034);
      const color = label.size === 'place' ? pal.placeLetter : pal.waterLetter;
      letter(text, L(label.position), label.angle, size, color, label.size === 'sea' ? 0.5 : 0.3);
    }
  }
}

/** Add a white gold mask to an aux canvas's green channel. */
export function mergeGold(aux: HTMLCanvasElement, gold: HTMLCanvasElement): void {
  const tint = newCanvas(aux.width, aux.height);
  const t = tint.getContext('2d')!;
  t.drawImage(gold, 0, 0, aux.width, aux.height);
  t.globalCompositeOperation = 'source-in';
  t.fillStyle = '#00ff00';
  t.fillRect(0, 0, aux.width, aux.height);
  const a = aux.getContext('2d')!;
  a.save();
  a.globalCompositeOperation = 'lighter';
  a.drawImage(tint, 0, 0);
  a.restore();
}

/* ------------------------------------------------------------------ */
/* Title plaque: a tabula ansata in gold with purple lettering          */

function drawPlaque(
  ctx: CanvasRenderingContext2D,
  pen: Pen,
  [cx, cy]: Pt,
  w: number,
  h: number,
  inscription: { greek: string; latin: string },
): Pt[] {
  const dark = '#2d2a2a';
  const hw = w / 2;
  const hh = h / 2;
  const ear = h * 0.55;
  const outline: Pt[] = [
    [cx - hw, cy - hh], [cx + hw, cy - hh],
    [cx + hw + ear, cy - hh * 0.75], [cx + hw + ear * 0.55, cy], [cx + hw + ear, cy + hh * 0.75],
    [cx + hw, cy + hh], [cx - hw, cy + hh],
    [cx - hw - ear, cy + hh * 0.75], [cx - hw - ear * 0.55, cy], [cx - hw - ear, cy - hh * 0.75],
  ];
  ctx.save();
  ctx.fillStyle = dark;
  ctx.beginPath();
  outline.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.fill();
  const inset = h * 0.07;
  const inner: Pt[] = [
    [cx - hw + inset, cy - hh + inset], [cx + hw - inset, cy - hh + inset],
    [cx + hw + ear - inset * 1.6, cy - hh * 0.75 + inset * 0.4], [cx + hw + ear * 0.55 - inset, cy],
    [cx + hw + ear - inset * 1.6, cy + hh * 0.75 - inset * 0.4],
    [cx + hw - inset, cy + hh - inset], [cx - hw + inset, cy + hh - inset],
    [cx - hw - ear + inset * 1.6, cy + hh * 0.75 - inset * 0.4], [cx - hw - ear * 0.55 + inset, cy],
    [cx - hw - ear + inset * 1.6, cy - hh * 0.75 + inset * 0.4],
  ];
  ctx.fillStyle = PALETTE.gold;
  ctx.beginPath();
  inner.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.fill();
  markGold(pen, inner);
  // Purple rule inside the gold.
  ctx.strokeStyle = PALETTE.imperial;
  ctx.lineWidth = h * 0.035;
  ctx.strokeRect(cx - hw + inset * 2.2, cy - hh + inset * 2.2, w - inset * 4.4, h - inset * 4.4);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = PALETTE.imperial;
  (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = '0.08em';
  ctx.font = `700 ${Math.round(h * 0.34)}px "Noto Serif", Georgia, serif`;
  ctx.fillText(inscription.greek, cx, cy - h * 0.09, w * 0.9);
  ctx.font = `600 ${Math.round(h * 0.15)}px Cinzel, Georgia, serif`;
  (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = '0.3em';
  ctx.fillText(`${inscription.latin} · NOVA ROMA`, cx, cy + h * 0.24, w * 0.85);
  ctx.restore();
  return outline;
}
