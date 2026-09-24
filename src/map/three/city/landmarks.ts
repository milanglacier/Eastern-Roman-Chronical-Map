/**
 * Parametric landmark builders. Each works in the landmark's own frame
 * (+X = long axis toward `bearing`, e.g. a church's apse end; +Z = right
 * of it), then is placed on a terrain podium. Dimensions are metres from
 * the data's `size`; heights are scaled by ctx.hs to match the terrain's
 * vertical exaggeration.
 */
import { ConeGeometry, CylinderGeometry, Group, type BufferGeometry } from 'three';
import type { CityStructure } from '../../../data/schema';
import { Batch, type MatKey } from './batch';
import {
  apse,
  bearingToRotY,
  box,
  cylinder,
  dome,
  drapedStrip,
  footprintGround,
  gableRoof,
  hipRoof,
  offsetPath,
  resample,
  semiDome,
  wallRibbon,
  xf,
  type P2,
} from './geom';
import type { BuildContext } from './walls';

/** A landmark's placement: local frame → world, sitting on a podium. */
interface Site {
  x: number;
  z: number;
  rotY: number;
  /** Top of the podium (scene Y) — the building's ground floor. */
  base: number;
  /** Add geometry given in the landmark frame (x along the long axis). */
  add(mat: MatKey, g: BufferGeometry, t?: { x?: number; y?: number; z?: number; rotY?: number }): void;
  /** Terrain height (relative to `base`) under a landmark-frame point. */
  groundAt(x: number, z: number): number;
}

function makeSite(
  s: CityStructure,
  ctx: BuildContext,
  batch: Batch,
  len: number,
  width: number,
  podium: MatKey | null = 'masonry',
): Site {
  const c = ctx.toLocal(s.position!);
  const rotY = bearingToRotY(s.bearing ?? 90);
  const g = footprintGround(ctx.groundY, c.x, c.z, len, width, rotY);
  // Build on a level platform at the centre height; a podium fills the
  // slope below it so nothing floats on a hillside.
  const base = g.center;
  if (podium) batch.add(podium, xf(box(len + 4, base - g.min + 6, width + 4), { x: c.x, y: g.min - 6, z: c.z, rotY }));
  const cos = Math.cos(rotY);
  const sin = Math.sin(rotY);
  return {
    x: c.x,
    z: c.z,
    rotY,
    base,
    groundAt(lx, lz) {
      return ctx.groundY(c.x + lx * cos + lz * sin, c.z - lx * sin + lz * cos) - base;
    },
    add(mat, geom, t = {}) {
      const lx = t.x ?? 0;
      const lz = t.z ?? 0;
      batch.add(
        mat,
        xf(geom, {
          x: c.x + lx * cos + lz * sin,
          y: base + (t.y ?? 0),
          z: c.z - lx * sin + lz * cos,
          rotY: rotY + (t.rotY ?? 0),
        }),
      );
    },
  };
}

/* ---------------------------------------------------------------- */
/* Churches                                                          */

function basilica(site: Site, len: number, width: number, h: number, walls: MatKey, withAtrium: boolean): void {
  const naveW = width * 0.42;
  const aisleW = (width - naveW) / 2;
  site.add(walls, box(len, h, naveW));
  site.add('roof', gableRoof(len + 1, naveW + 2, naveW * 0.32), { y: h });
  for (const side of [-1, 1]) {
    site.add(walls, box(len, h * 0.6, aisleW), { z: side * (naveW / 2 + aisleW / 2) });
    site.add('roof', box(len + 1, 0.8, aisleW + 1), { y: h * 0.6, z: side * (naveW / 2 + aisleW / 2) });
  }
  site.add(walls, apse(naveW * 0.45, h * 0.8), { x: len / 2 });
  site.add('roof', dome(naveW * 0.45, 12).scale(1, 0.5, 1).rotateY(0), { x: len / 2, y: h * 0.8 });
  if (withAtrium) atrium(site, -len / 2 - width * 0.55, width * 1.1, width);
}

function atrium(site: Site, cx: number, len: number, width: number): void {
  const t = 2.5;
  const h = 7;
  site.add('marble', box(len, h, t), { x: cx, z: width / 2 });
  site.add('marble', box(len, h, t), { x: cx, z: -width / 2 });
  site.add('marble', box(t, h, width), { x: cx - len / 2 });
  site.add('paving', box(len, 0.4, width), { x: cx });
}

/** Justinian's Hagia Sophia: square core, great dome on pendentives, semi-domes E/W. */
function greatChurchDomed(site: Site, len: number, width: number, hs: number): void {
  const coreH = 26 * hs;
  site.add('ochre', box(len * 0.86, coreH, width));
  // Buttress piers north and south.
  for (const zs of [-1, 1]) for (const xs of [-1, 1]) site.add('ochre', box(12, 36 * hs, 12), { x: xs * 15, z: zs * (width / 2 - 4) });
  // Central tower carrying the dome.
  site.add('ochre', box(34, 40 * hs, 34));
  site.add('ochre', cylinder(16.5, 3 * hs, 40), { y: 40 * hs });
  site.add('lead', dome(16, 40).scale(1, 0.75 * hs, 1), { y: 43 * hs });
  // East and west semi-domes, then the exedrae beyond them.
  site.add('lead', semiDome(16, 24).scale(1, 0.7 * hs, 1), { x: 17, y: 30 * hs });
  site.add('lead', semiDome(16, 24).scale(1, 0.7 * hs, 1), { x: -17, y: 30 * hs, rotY: Math.PI });
  for (const zs of [-1, 1]) {
    site.add('lead', semiDome(7, 12).scale(1, 0.7 * hs, 1), { x: 30, z: zs * 9, y: 24 * hs });
    site.add('lead', semiDome(7, 12).scale(1, 0.7 * hs, 1), { x: -30, z: zs * 9, y: 24 * hs, rotY: Math.PI });
  }
  site.add('ochre', apse(7, 22 * hs), { x: len * 0.43 });
  site.add('lead', dome(7, 14).scale(1, 0.5 * hs, 1), { x: len * 0.43, y: 22 * hs });
  // Narthexes and the atrium west of them.
  site.add('ochre', box(12, 20 * hs, width * 0.9), { x: -len * 0.43 - 6 });
  site.add('roof', box(13, 0.8, width * 0.92), { x: -len * 0.43 - 6, y: 20 * hs });
  atrium(site, -len * 0.5 - 45, 70, width * 0.9);
}

function crossDomed(site: Site, len: number, width: number, h: number, fiveDomes: boolean): void {
  site.add('ochre', box(len * 0.9, h * 0.45, width * 0.9));
  // Raised cross arms with gabled roofs.
  site.add('ochre', box(len, h * 0.62, width * 0.34));
  site.add('roof', gableRoof(len + 1, width * 0.36, width * 0.12), { y: h * 0.62 });
  site.add('ochre', box(len * 0.34, h * 0.62, width));
  site.add('roof', gableRoof(width + 1, len * 0.36, len * 0.12), { y: h * 0.62, rotY: Math.PI / 2 });
  const r = Math.min(len, width) * 0.15;
  const drumH = h * 0.22;
  const domeAt = (x: number, z: number, scale: number) => {
    site.add('ochre', cylinder(r * scale * 1.05, drumH * scale, 16), { x, z, y: h * 0.62 });
    site.add('lead', dome(r * scale, 16).scale(1, 0.9, 1), { x, z, y: h * 0.62 + drumH * scale });
  };
  domeAt(0, 0, 1);
  if (fiveDomes) {
    domeAt(len * 0.36, 0, 0.8);
    domeAt(-len * 0.36, 0, 0.8);
    domeAt(0, width * 0.36, 0.8);
    domeAt(0, -width * 0.36, 0.8);
  }
  site.add('ochre', apse(width * 0.12, h * 0.5), { x: len * 0.45 });
}

function churchRuin(site: Site, len: number, width: number, h: number): void {
  const t = 2;
  site.add('ruin', box(len, h * 0.35, t), { z: width / 2 });
  site.add('ruin', box(len * 0.6, h * 0.22, t), { z: -width / 2, x: -len * 0.2 });
  site.add('ruin', box(t, h * 0.3, width), { x: -len / 2 });
  site.add('ruin', apse(width * 0.2, h * 0.3), { x: len / 2 });
  site.add('darkStone', box(len * 0.8, 0.5, width * 0.8));
}

/* ---------------------------------------------------------------- */
/* Builders by kind                                                  */

export function buildLandmark(s: CityStructure, variant: string | null, ctx: BuildContext): Group | null {
  const batch = new Batch();
  const hs = ctx.hs;
  const [a = 40, b = 30, c = 20] = s.size ?? [];

  switch (s.kind) {
    case 'great-church': {
      const site = makeSite(s, ctx, batch, a + 20, b);
      if (variant === 'domed') greatChurchDomed(site, a, b, hs);
      else if (variant === 'ruin') churchRuin(site, a * 1.2, b * 0.7, 18 * hs);
      else basilica(site, a * 1.2, b * 0.7, 18 * hs, 'plaster', true);
      break;
    }
    case 'church': {
      const site = makeSite(s, ctx, batch, a, b);
      const h = c * hs;
      if (variant === 'basilica') basilica(site, a, b, h * 0.6, 'plaster', a > 60);
      else if (variant === 'domed') {
        site.add('ochre', box(a, h * 0.5, b));
        site.add('ochre', cylinder(b * 0.3, h * 0.2, 20), { y: h * 0.5 });
        site.add('lead', dome(b * 0.28, 20).scale(1, 0.8, 1), { y: h * 0.7 });
        site.add('ochre', apse(b * 0.18, h * 0.4), { x: a / 2 });
      } else crossDomed(site, a, b, h, a >= 80);
      break;
    }
    case 'hippodrome':
      hippodrome(s, variant, ctx, batch, a, b);
      break;
    case 'palace':
      palace(s, variant, ctx, batch, a, b);
      break;
    case 'column': {
      const c0 = ctx.toLocal(s.position!);
      const g = ctx.groundY(c0.x, c0.z);
      const r = a / 2;
      const h = b * hs;
      const shaft: MatKey = s.id === 'column-of-constantine' ? 'porphyry' : s.id === 'column-of-justinian' ? 'gold' : 'marble';
      batch.add('marble', xf(box(r * 5, 7 * hs + 3, r * 5), { x: c0.x, y: g - 3, z: c0.z }));
      batch.add(shaft, xf(cylinder(r, h, 16), { x: c0.x, y: g + 7 * hs, z: c0.z }));
      batch.add('marble', xf(box(r * 2.8, 2 * hs, r * 2.8), { x: c0.x, y: g + 7 * hs + h, z: c0.z }));
      batch.add('gold', xf(cylinder(r * 0.6, 4 * hs, 8), { x: c0.x, y: g + 9 * hs + h, z: c0.z }));
      break;
    }
    case 'forum':
      forum(s, ctx, batch, a, b);
      break;
    case 'gate': {
      const site = makeSite(s, ctx, batch, a, b);
      const towerW = a * 0.26;
      const mat: MatKey = s.id === 'golden-gate' ? 'marble' : 'masonry';
      for (const xs of [-1, 1]) site.add(mat, box(towerW, c * hs, b), { x: xs * (a / 2 - towerW / 2) });
      site.add(mat, box(a - towerW * 2, c * 0.72 * hs, b * 0.7));
      if (s.id === 'golden-gate') site.add('gold', box(a * 0.3, 2 * hs, 2), { y: c * 0.72 * hs, z: b * 0.36 });
      break;
    }
    case 'tower': {
      const c0 = ctx.toLocal(s.position!);
      const g = ctx.groundY(c0.x, c0.z);
      const r = a / 2;
      batch.add('masonry', xf(cylinder(r, b * 0.8 * hs, 20), { x: c0.x, y: g - 3, z: c0.z }));
      batch.add('masonry', xf(cylinder(r * 1.12, 2 * hs, 20), { x: c0.x, y: g - 3 + b * 0.72 * hs, z: c0.z }));
      batch.add('roof', xf(new ConeGeometry(r * 1.1, b * 0.25 * hs, 20).translate(0, (b * 0.25 * hs) / 2, 0), { x: c0.x, y: g - 3 + b * 0.8 * hs, z: c0.z }));
      break;
    }
    case 'aqueduct':
      aqueduct(s, ctx, batch, a, b);
      break;
    case 'harbor':
      harbor(s, ctx, batch, a, b);
      break;
    case 'chain': {
      const pts = resample(s.path!.map((p) => ctx.toLocal(p)), 5);
      const flat = () => 0.3;
      batch.add('chain', wallRibbon(pts, flat, 0.6, 0.5, { sink: 0.2 }));
      pts.forEach((p, i) => {
        if (i % 3 === 0) batch.add('timber', xf(box(2.2, 1.2, 2.2), { x: p.x, y: 0, z: p.z, rotY: i }));
      });
      break;
    }
    case 'avenue':
      avenue(s, ctx, batch, a);
      break;
    default:
      return null;
  }
  return batch.build(ctx.mats, s.id);
}

function hippodrome(s: CityStructure, variant: string | null, ctx: BuildContext, batch: Batch, len: number, width: number): void {
  const hs = ctx.hs;
  const site = makeSite(s, ctx, batch, len, width);
  const ruin = variant === 'ruin';
  const standMat: MatKey = ruin ? 'ruin' : 'masonry';
  const standH = (ruin ? 6 : 15) * hs;
  const standW = 24;
  const straight = len - width / 2;
  const sx = (width / 2 - len / 2 + straight / 2) + 0; // straight section centre (sphendone at -X)
  // Arena floor.
  site.add('sand', box(len - 10, 0.6, width - standW * 2 + 4), { x: 0 });
  // Straight stands (east and west) with a stepped top.
  for (const zs of [-1, 1]) {
    site.add(standMat, box(straight, standH, standW), { x: sx, z: zs * (width / 2 - standW / 2) });
    if (!ruin) site.add('marble', box(straight, standH * 0.3, standW * 0.5), { x: sx, z: zs * (width / 2 - standW * 0.25), y: standH });
  }
  // Sphendone: the curved south end, on tall substructures.
  const cx = -len / 2 + width / 2;
  const segs = 14;
  const rr = width / 2 - standW / 2;
  for (let k = 0; k <= segs; k++) {
    const ang = Math.PI / 2 + (k / segs) * Math.PI; // sweep the -X half
    const x = cx + Math.cos(ang) * rr;
    const z = Math.sin(ang) * rr;
    site.add(standMat, box((Math.PI * rr) / segs + 2, standH, standW), { x, z, rotY: -ang + Math.PI / 2 });
  }
  // Carceres (starting gates) at the north end.
  site.add(standMat, box(14, standH * 0.8, width - 10), { x: len / 2 - 7 });
  // Spina with its monuments.
  site.add('marble', box(len * 0.55, 2 * hs, 7), { x: 10, y: 0.6 });
  site.add('marble', box(2.6, 22 * hs, 2.6), { x: 55, y: 2 * hs });
  site.add('marble', new ConeGeometry(1.9, 3 * hs, 4).rotateY(Math.PI / 4).translate(0, 1.5 * hs, 0), { x: 55, y: 24 * hs });
  site.add('masonry', box(3.2, 32 * hs, 3.2), { x: -40, y: 2 * hs });
  site.add('gold', cylinder(0.9, 8 * hs, 10), { x: 10, y: 2 * hs });
  // Kathisma: the imperial box on the east side, linked to the palace.
  if (!ruin) {
    site.add('marble', box(40, standH + 6 * hs, 26), { x: 20, z: width / 2 + 8 });
    site.add('roof', gableRoof(42, 28, 6 * hs), { x: 20, z: width / 2 + 8, y: standH + 6 * hs });
  }
}

function palace(s: CityStructure, variant: string | null, ctx: BuildContext, batch: Batch, len: number, width: number): void {
  const hs = ctx.hs;
  // No shared podium: each hall sits on its own ground, so the complex
  // steps down its hillside toward the sea as the real one did.
  const site = makeSite(s, ctx, batch, len, width, null);
  const ruin = variant === 'ruin';
  const n = 16;
  for (let k = 0; k < n; k++) {
    const r = (i: number) => ctx.hash(`${s.id}-${i}`, k);
    if (ruin && r(0) < 0.55) continue;
    const bl = 24 + r(1) * 50;
    const bw = 16 + r(2) * 28;
    const bh = (ruin ? 4 + r(3) * 5 : 10 + r(3) * 14) * hs;
    // Terraces step down toward the far (+X) end, like the Great Palace
    // falling from the Hippodrome to the Marmara shore.
    const x = (r(4) - 0.5) * (len - bl);
    const z = (r(5) - 0.5) * (width - bw);
    const step = site.groundAt(x, z);
    const rot = r(6) < 0.5 ? 0 : Math.PI / 2;
    site.add(ruin ? 'ruin' : k % 3 === 0 ? 'marble' : 'plaster', box(bl, bh + 12, bw), { x, z, y: step - 12, rotY: rot });
    if (!ruin) {
      if (r(7) < 0.25) site.add('lead', dome(Math.min(bl, bw) * 0.28, 16).scale(1, 0.8, 1), { x, z, y: step + bh, rotY: rot });
      else site.add('roof', hipRoof(bl + 1, 5 * hs, bw + 1), { x, z, y: step + bh, rotY: rot });
    }
  }
  if (!ruin) {
    // Colonnaded court down the long axis.
    for (let i = -6; i <= 6; i++) {
      for (const zs of [-1, 1]) {
        site.add('marble', cylinder(0.8, 7 * hs + 3, 8), { x: i * 14, z: zs * 16, y: site.groundAt(i * 14, zs * 16) - 3 });
      }
    }
  }
}

function forum(s: CityStructure, ctx: BuildContext, batch: Batch, len: number, width: number): void {
  const hs = ctx.hs;
  const round = Math.abs(len - width) < 1;
  const site = makeSite(s, ctx, batch, len, width, 'paving');
  if (round) {
    const r = len / 2;
    site.add('paving', new CylinderGeometry(r, r, 0.8, 48).translate(0, 0.4, 0));
    const n = Math.round((Math.PI * 2 * r) / 7);
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2;
      site.add('marble', cylinder(0.7, 9 * hs, 8), { x: Math.cos(ang) * (r - 3), z: Math.sin(ang) * (r - 3) });
      site.add('marble', box((Math.PI * 2 * r) / n + 0.4, 1.4 * hs, 2), { x: Math.cos(ang) * (r - 3), z: Math.sin(ang) * (r - 3), y: 9 * hs, rotY: -ang + Math.PI / 2 });
    }
    for (const xs of [-1, 1]) site.add('marble', box(8, 14 * hs, 16), { x: xs * r });
  } else {
    site.add('paving', box(len, 0.8, width));
    const perim: Array<[number, number, number]> = [];
    for (let x = -len / 2; x <= len / 2; x += 7) perim.push([x, -width / 2 + 3, 0], [x, width / 2 - 3, 0]);
    for (let z = -width / 2 + 7; z < width / 2; z += 7) perim.push([-len / 2 + 3, z, 0], [len / 2 - 3, z, 0]);
    for (const [x, z] of perim) site.add('marble', cylinder(0.7, 9 * hs, 8), { x, z });
    // Triumphal arch at the west entry.
    site.add('marble', box(10, 16 * hs, 24), { x: -len / 2 - 5 });
  }
}

function aqueduct(s: CityStructure, ctx: BuildContext, batch: Batch, height: number, width: number): void {
  const hs = ctx.hs;
  const pts = resample(s.path!.map((p) => ctx.toLocal(p)), 13);
  // The channel runs level: at the high ground's height plus a parapet.
  const top = Math.max(...pts.map((p) => ctx.groundY(p.x, p.z))) + 6 * hs;
  const channelH = 6 * hs;
  batch.add('masonry', wallRibbon(pts, () => top - channelH, channelH, width, { sink: 0 }));
  pts.forEach((p, i) => {
    const g = ctx.groundY(p.x, p.z);
    const h = top - channelH - g + 4;
    if (h <= 4) return;
    const q = pts[Math.min(pts.length - 1, i + 1)];
    const o = pts[Math.max(0, i - 1)];
    const rotY = -Math.atan2(q.z - o.z, q.x - o.x); // pier's X along the channel
    batch.add('masonry', xf(box(4.5, h, width), { x: p.x, y: g - 4, z: p.z, rotY }));
    // A second tier's impost band where the arcade is tall.
    if (h > 20 * hs) batch.add('masonry', xf(box(13, 2.5 * hs, width), { x: p.x, y: g - 4 + h * 0.5, z: p.z, rotY }));
  });
  void height;
}

function harbor(s: CityStructure, ctx: BuildContext, batch: Batch, len: number, width: number): void {
  const hs = ctx.hs;
  // A harbour cut into the land gets a quay platform and a basin whose
  // water sits at its top; one built out into open water (the Neorion) is
  // just its moles and quays around the real sea.
  const c0 = ctx.toLocal(s.position!);
  const onLand = ctx.groundY(c0.x, c0.z) > 1;
  const site = makeSite(s, ctx, batch, len, width, onLand ? 'masonry' : null);
  if (onLand) site.add('basin', box(len - 8, 0.5, width - 8), { y: -0.3 });
  // The mouth faces the sea side: the lowest of the four edge midpoints.
  const edges: Array<{ x: number; z: number; alongX: boolean }> = [
    { x: 0, z: width / 2, alongX: true },
    { x: 0, z: -width / 2, alongX: true },
    { x: len / 2, z: 0, alongX: false },
    { x: -len / 2, z: 0, alongX: false },
  ];
  const cos = Math.cos(site.rotY);
  const sin = Math.sin(site.rotY);
  const worldOf = (e: { x: number; z: number }) => ({ x: site.x + e.x * cos + e.z * sin, z: site.z - e.x * sin + e.z * cos });
  let mouth = 0;
  let lowest = Infinity;
  edges.forEach((e, i) => {
    const w = worldOf({ x: e.x * 1.4, z: e.z * 1.4 });
    const y = ctx.groundY(w.x, w.z);
    if (y < lowest) {
      lowest = y;
      mouth = i;
    }
  });
  edges.forEach((e, i) => {
    const span = e.alongX ? len : width;
    const rot = e.alongX ? 0 : Math.PI / 2;
    if (i === mouth) {
      // Two moles with towers, leaving a 40 m entrance.
      const seg = (span - 40) / 2;
      for (const sgn of [-1, 1]) {
        const off = sgn * (20 + seg / 2);
        site.add('masonry', box(e.alongX ? seg : 5, 3 * hs, e.alongX ? 5 : seg), { x: e.x + (e.alongX ? off : 0), z: e.z + (e.alongX ? 0 : off) });
        site.add('masonry', box(8, 12 * hs, 8), { x: e.x + (e.alongX ? sgn * 22 : 0), z: e.z + (e.alongX ? 0 : sgn * 22) });
      }
    } else {
      site.add('masonry', box(span, 3 * hs, 5), { x: e.x, z: e.z, rotY: rot });
    }
  });
}

function avenue(s: CityStructure, ctx: BuildContext, batch: Batch, width: number): void {
  const hs = ctx.hs;
  const pts = resample(s.path!.map((p) => ctx.toLocal(p)), 10);
  batch.add('paving', drapedStrip(pts, ctx.groundY, width, 0.6));
  // Porticoes both sides: columns every 8 m under a tiled lean-to roof.
  for (const side of [-1, 1]) {
    const line = offsetPath(pts, side * (width / 2 + 3));
    batch.add('roof', drapedStrip(line, ctx.groundY, 7, 7 * hs));
    const colLine = resample(offsetPath(pts, side * (width / 2 + 0.5)), 8);
    colLine.forEach((p: P2, i: number) => {
      if (i % 1 === 0) batch.add('marble', xf(cylinder(0.5, 7 * hs, 6), { x: p.x, y: ctx.groundY(p.x, p.z), z: p.z }));
    });
  }
}
