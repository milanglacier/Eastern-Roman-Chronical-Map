/**
 * Drawings for the city page's pop-up cards: landmarks, ships, and the
 * atlas of houses and trees. Each drawing is an elevation in ink and
 * watercolour (or the flat mosaic cartoon, when the pen is flat) on a
 * transparent canvas, standing on its bottom edge.
 *
 * Historical notes that shape the drawings:
 *  - Hagia Sophia is low and stepped, crowned by one great dome about two
 *    fifths of its length across. Its domes were covered in lead sheet
 *    (grey); only the crosses were gilded. Its first dome (537) was
 *    shallow; the rebuilt dome of 562 stands about 7 m higher. No minarets
 *    before 1453.
 *  - The Hippodrome's spina carried the Obelisk of Theodosius (pink
 *    granite), the bronze Serpent Column from Delphi and the Walled
 *    Obelisk; four gilded bronze horses stood over the starting gates
 *    until the crusaders took them to Venice in 1204.
 *  - The Column of Constantine: porphyry drums bound by bronze wreaths,
 *    with a gilded statue of Constantine as the sun god (fell in 1106).
 *  - The Golden Gate: a triple arch in white marble with gilded doors,
 *    flanked by two marble towers once built into the walls.
 */
import {
  INK,
  PALETTE,
  arcade,
  crenellated,
  domePts,
  gild,
  hatch,
  ink,
  markGold,
  rect,
  wash,
  type Pen,
  type Pt,
} from '../illumination';

export interface CardArt {
  /** Card size in page units. */
  width: number;
  height: number;
  draw(pen: Pen, w: number, h: number): void;
}

const LEAD = '#8f989c';
const LEAD_SHADE = '#6d777c';
const MARBLE = '#eee6d6';
const PLASTER = '#e4cda6';
const BRICK = '#c4886a';
const TILE = '#b8583a';
const WOOD = '#6a4a32';
const SAIL = '#efe3c4';
const CYPRESS = '#46603f';
const PINE = '#5d7648';

/* ------------------------------------------------------------------ */
/* Shared pieces                                                        */

function shadeRight(pen: Pen, x: number, y: number, w: number, h: number, frac = 0.35, alpha = 0.4): void {
  hatch(pen, rect(x + w * (1 - frac), y, w * frac, h), 4, -1, alpha);
}

function block(pen: Pen, x: number, y: number, w: number, h: number, tone: string, shade = true): void {
  const r = rect(x, y, w, h);
  wash(pen, r, tone);
  if (shade) shadeRight(pen, x, y, w, h);
  ink(pen, r, true, 0.9);
}

/** Brick bands across a masonry face (the Eastern Roman opus mixtum). */
function brickBands(pen: Pen, x: number, y: number, w: number, h: number, bands: number): void {
  const { ctx } = pen;
  ctx.save();
  ctx.fillStyle = BRICK;
  ctx.globalAlpha = pen.flat ? 1 : 0.55;
  for (let i = 1; i <= bands; i++) {
    const by = y + (h * i) / (bands + 1);
    ctx.fillRect(x, by - h * 0.025, w, h * 0.05);
  }
  ctx.restore();
}

function dome(pen: Pen, cx: number, base: number, rx: number, ry: number, tone = LEAD, ribs = 8): void {
  const d = domePts(cx, base, rx, ry, 32);
  wash(pen, d, tone, 1);
  // Shade the far (right) side of the dome.
  hatch(pen, [[cx + rx * 0.2, base], ...d.filter(([x]) => x >= cx + rx * 0.2)], 3.5, -0.8, 0.3);
  for (let i = 1; i < ribs; i++) {
    const a = Math.PI - (i / ribs) * Math.PI;
    ink(pen, [[cx + Math.cos(a) * rx, base - Math.sin(a) * ry * 0.15], [cx + Math.cos(a) * rx * 0.25, base - ry * 0.92]], false, 0.45, false);
  }
  ink(pen, d, true, 1);
}

function cross(pen: Pen, x: number, top: number, size: number): void {
  const t = size * 0.18;
  const pts: Pt[] = [
    [x - t, top], [x + t, top], [x + t, top + size * 0.28], [x + size * 0.4, top + size * 0.28], [x + size * 0.4, top + size * 0.28 + t * 2],
    [x + t, top + size * 0.28 + t * 2], [x + t, top + size], [x - t, top + size], [x - t, top + size * 0.28 + t * 2],
    [x - size * 0.4, top + size * 0.28 + t * 2], [x - size * 0.4, top + size * 0.28], [x - t, top + size * 0.28],
  ];
  gild(pen, pts, false);
  ink(pen, pts, true, 0.5, false);
}

function pitchedRoof(pen: Pen, x: number, eave: number, w: number, rise: number, tone = TILE): void {
  const roof: Pt[] = [[x - w * 0.02, eave], [x + w * 0.5, eave - rise], [x + w * 1.02, eave]];
  wash(pen, roof, tone);
  hatch(pen, [[x + w * 0.5, eave - rise], [x + w * 1.02, eave], [x + w * 0.5, eave]], 3.5, -0.6, 0.35);
  ink(pen, roof, true, 0.8, false);
}

/** Long roof seen from the side (a trapezoid band of tiles). */
function sideRoof(pen: Pen, x: number, eave: number, w: number, rise: number, tone = TILE): void {
  const roof: Pt[] = [[x - w * 0.01, eave], [x + w * 0.03, eave - rise], [x + w * 0.97, eave - rise], [x + w * 1.01, eave]];
  wash(pen, roof, tone);
  const { ctx } = pen;
  ctx.save();
  ctx.strokeStyle = INK;
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = pen.u * 0.6;
  for (let k = 1; k < 4; k++) {
    const y = eave - (rise * k) / 4;
    ctx.beginPath();
    ctx.moveTo(x + w * 0.02, y);
    ctx.lineTo(x + w * 0.98, y);
    ctx.stroke();
  }
  ctx.restore();
  ink(pen, roof, true, 0.8, false);
}

function cypress(pen: Pen, cx: number, base: number, w: number, h: number): void {
  const pts: Pt[] = [[cx, base - h], [cx + w * 0.42, base - h * 0.55], [cx + w * 0.5, base - h * 0.15], [cx + w * 0.12, base], [cx - w * 0.12, base], [cx - w * 0.5, base - h * 0.15], [cx - w * 0.42, base - h * 0.55]];
  wash(pen, pts, CYPRESS, 1);
  hatch(pen, pts, 3, -1.2, 0.3);
  ink(pen, pts, true, 0.7, false);
}

/* ------------------------------------------------------------------ */
/* Hagia Sophia                                                         */

/**
 * Hagia Sophia from the south: a low, stepped mass that climbs to one great
 * dome. The dome (31 m across, about two fifths of the building's length)
 * rests on four massive piers; between the piers the tympanum wall fills
 * the great arch with rows of windows; the half-domes step down to the
 * east and west, the exedrae lower still. Plastered brick, domes in lead.
 *
 * `rise` is the dome's height as a fraction of its radius: shallow in 537,
 * steeper after the rebuild of 562. `fallen` shows 558–562, the dome down
 * and the crossing under scaffolding.
 */
function hagiaSophia(opts: { rise: number; buttressed?: boolean; fallen?: boolean }) {
  return (pen: Pen, w: number, h: number) => {
    const base = h * 0.985;
    const cx = w * 0.5;
    const R = w * 0.2; // great dome radius
    const ringBase = h * 0.44; // foot of the window ring
    const domeBase = ringBase - h * 0.045;
    const spring = h * 0.64; // springing of the great arch = gallery roof
    const STONE = '#dcbb92';
    const STONE_SHADE = '#c9a57a';

    // West atrium: a low colonnaded court.
    const atrium = rect(w * 0.0, h * 0.8, w * 0.1, base - h * 0.8);
    wash(pen, atrium, MARBLE);
    arcade(pen, w * 0.006, h * 0.84, w * 0.09, h * 0.11, 4, INK, 0.65);
    ink(pen, atrium, true, 0.8);
    sideRoof(pen, w * 0.0, h * 0.8, w * 0.1, h * 0.022, LEAD);

    // Exedrae: small semi-domes low at both ends.
    for (const side of [-1, 1]) {
      const ex = cx + side * w * 0.33;
      const drum = rect(ex - w * 0.06, h * 0.6, w * 0.12, h * 0.05);
      wash(pen, drum, STONE);
      arcade(pen, ex - w * 0.05, h * 0.608, w * 0.1, h * 0.035, 5, INK, 0.6);
      ink(pen, drum, true, 0.8);
      dome(pen, ex, h * 0.6, w * 0.06, h * 0.06, LEAD, 5);
    }

    // The half-domes stepping down east and west from the great dome.
    for (const side of [-1, 1]) {
      const x0 = cx + side * R * 0.98;
      const rx = w * 0.15;
      const ry = h * 0.17;
      const y0 = ringBase + ry * 0.92;
      const pts: Pt[] = [[x0, y0]];
      for (let k = 0; k <= 16; k++) {
        const a = (k / 16) * (Math.PI / 2);
        pts.push([x0 + side * Math.sin(a) * rx, y0 - Math.cos(a) * ry]);
      }
      pts.push([x0 + side * rx, y0]);
      const hd = side < 0 ? pts : pts.slice().reverse();
      // A shallow band of windows at the foot of each half-dome.
      const band = rect(Math.min(x0, x0 + side * rx), y0, rx, h * 0.035);
      wash(pen, band, STONE);
      arcade(pen, Math.min(x0, x0 + side * rx) + rx * 0.08, y0 + h * 0.004, rx * 0.84, h * 0.026, 5, INK, 0.6);
      ink(pen, band, true, 0.8);
      wash(pen, hd, LEAD, 1);
      if (side > 0) hatch(pen, hd, 3.5, -0.8, 0.3);
      ink(pen, hd, true, 1);
    }

    // The main body: aisles and galleries under lean-to lead roofs; plain
    // plastered walls with few, grouped windows.
    const body = rect(w * 0.1, spring, w * 0.8, base - spring);
    wash(pen, body, STONE);
    hatch(pen, rect(w * 0.62, spring, w * 0.28, base - spring), 4.5, -1, 0.3);
    for (const gx of [0.17, 0.3, 0.64, 0.77]) {
      arcade(pen, w * gx, spring + h * 0.07, w * 0.07, h * 0.07, 3, INK, 0.65);
      arcade(pen, w * gx, spring + h * 0.21, w * 0.07, h * 0.08, 2, INK, 0.65);
    }
    ink(pen, body, true, 1);
    sideRoof(pen, w * 0.1, spring, w * 0.8, h * 0.025, LEAD);

    // The tympanum under the great arch, filled with rows of windows: a
    // lighter wall set back behind the arch, no frame of its own.
    const tymp = rect(cx - R * 0.96, ringBase, R * 1.92, spring - ringBase + h * 0.18);
    wash(pen, tymp, '#e6caa2');
    arcade(pen, cx - R * 0.74, ringBase + h * 0.05, R * 1.48, h * 0.045, 7, INK, 0.7);
    arcade(pen, cx - R * 0.56, ringBase + h * 0.11, R * 1.12, h * 0.04, 5, INK, 0.7);
    arcade(pen, cx - R * 0.78, spring + h * 0.03, R * 1.56, h * 0.11, 5, INK, 0.7);
    // The great arch: a heavy archivolt springing from the piers.
    const arch: Pt[] = [];
    for (let k = 0; k <= 32; k++) {
      const a = Math.PI - (k / 32) * Math.PI;
      arch.push([cx + Math.cos(a) * R * 0.94, ringBase + h * 0.028 + (1 - Math.sin(a)) * h * 0.2]);
    }
    const { ctx } = pen;
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.strokeStyle = STONE_SHADE;
    ctx.lineWidth = h * 0.035;
    ctx.beginPath();
    arch.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
    ctx.restore();
    ink(pen, arch.map(([x, y]) => [x, y + h * 0.018] as Pt), false, 1.1, false);
    ink(pen, arch.map(([x, y]) => [x, y - h * 0.018] as Pt), false, 1.1, false);

    // The four piers (two seen from the south), stepped at the top.
    for (const side of [-1, 1]) {
      const pw = w * 0.085;
      const px = side < 0 ? cx - R - pw * 0.6 : cx + R - pw * 0.4;
      const top = ringBase - h * 0.03;
      const pier: Pt[] = [
        [px, base], [px, top + h * 0.05], [px + pw * 0.12, top + h * 0.02], [px + pw * 0.3, top],
        [px + pw * 0.7, top], [px + pw * 0.88, top + h * 0.02], [px + pw, top + h * 0.05], [px + pw, base],
      ];
      wash(pen, pier, STONE_SHADE);
      hatch(pen, rect(px + pw * 0.5, top, pw * 0.5, base - top), 3.5, -1, 0.5);
      arcade(pen, px + pw * 0.3, top + h * 0.1, pw * 0.4, h * 0.05, 1, INK, 0.6);
      ink(pen, pier, true, 1.1);
    }

    if (opts.buttressed) {
      // Andronikos II's flying buttresses at both ends.
      for (const side of [-1, 1]) {
        const x = cx + side * w * 0.43;
        const flyer: Pt[] = side < 0
          ? [[x - w * 0.045, base], [x - w * 0.045, h * 0.74], [x, h * 0.62], [x + w * 0.03, h * 0.62], [x + w * 0.03, base]]
          : [[x - w * 0.03, base], [x - w * 0.03, h * 0.62], [x, h * 0.62], [x + w * 0.045, h * 0.74], [x + w * 0.045, base]];
        wash(pen, flyer, STONE_SHADE);
        hatch(pen, flyer, 4, -1, 0.35);
        ink(pen, flyer, true, 1);
      }
    }

    if (opts.fallen) {
      // 558–562: the crossing open to the sky under timber scaffolding.
      ctx.save();
      ctx.strokeStyle = WOOD;
      ctx.lineWidth = pen.u * 1.4;
      for (let k = 0; k <= 8; k++) {
        const x = cx - R + (k / 8) * 2 * R;
        ctx.beginPath();
        ctx.moveTo(x, ringBase);
        ctx.lineTo(x, ringBase - h * 0.14);
        ctx.stroke();
      }
      for (let k = 0; k < 4; k++) {
        const y = ringBase - (k / 3) * h * 0.14;
        ctx.beginPath();
        ctx.moveTo(cx - R, y);
        ctx.lineTo(cx + R, y);
        ctx.stroke();
      }
      ctx.restore();
      return;
    }

    // The ring of forty windows at the foot of the dome, with little buttresses.
    const ring = rect(cx - R, domeBase, 2 * R, ringBase - domeBase);
    wash(pen, ring, STONE);
    arcade(pen, cx - R * 0.97, domeBase + h * 0.008, R * 1.94, (ringBase - domeBase) * 0.75, 20, INK, 0.85);
    ink(pen, ring, true, 1);
    // The great dome in lead, with its ribs; a gilded cross at the crown.
    const rise = R * opts.rise;
    const d = domePts(cx, domeBase, R, rise, 48);
    wash(pen, d, LEAD, 1);
    hatch(pen, [[cx + R * 0.15, domeBase], ...d.filter(([x]) => x >= cx + R * 0.15)], 3.5, -0.7, 0.3);
    for (let k = 1; k < 20; k++) {
      const a = Math.PI - (k / 20) * Math.PI;
      const fx = Math.cos(a);
      ink(pen, [[cx + fx * R, domeBase - Math.sin(a) * rise * 0.05], [cx + fx * R * 0.18, domeBase - rise * 0.96]], false, 0.4, false);
    }
    ink(pen, d, true, 1.3);
    const top = domeBase - rise;
    ink(pen, [[cx, top], [cx, top - h * 0.03]], false, 1, false);
    cross(pen, cx, top - h * 0.085, h * 0.06);
  };
}

function basilicaRuin(pen: Pen, w: number, h: number): void {
  const base = h * 0.98;
  const shell: Pt[] = [[w * 0.08, base], [w * 0.08, h * 0.55], [w * 0.16, h * 0.5], [w * 0.2, h * 0.62], [w * 0.3, h * 0.52], [w * 0.42, h * 0.66], [w * 0.55, h * 0.5], [w * 0.66, h * 0.6], [w * 0.8, h * 0.48], [w * 0.92, h * 0.58], [w * 0.92, base]];
  wash(pen, shell, '#cdb48e');
  hatch(pen, shell, 3.5, -1, 0.5);
  arcade(pen, w * 0.1, h * 0.7, w * 0.8, h * 0.2, 12, INK, 0.8);
  ink(pen, shell, true, 1);
  const { ctx } = pen;
  ctx.save();
  ctx.fillStyle = '#2a1d14';
  ctx.globalAlpha = 0.35;
  for (let i = 0; i < 5; i++) {
    ctx.beginPath();
    ctx.ellipse(w * (0.2 + i * 0.15), h * 0.55, w * 0.06, h * 0.12, 0.3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* Churches                                                             */

function basilica(pen: Pen, w: number, h: number): void {
  const base = h * 0.97;
  // Aisles (low), nave with clerestory (high), apse to the east (right).
  block(pen, w * 0.1, h * 0.62, w * 0.72, base - h * 0.62, PLASTER);
  arcade(pen, w * 0.13, h * 0.72, w * 0.66, h * 0.14, 9, INK, 0.7);
  sideRoof(pen, w * 0.1, h * 0.62, w * 0.72, h * 0.07);
  block(pen, w * 0.16, h * 0.34, w * 0.6, h * 0.22, PLASTER);
  arcade(pen, w * 0.19, h * 0.38, w * 0.54, h * 0.12, 8, INK, 0.75);
  sideRoof(pen, w * 0.16, h * 0.34, w * 0.6, h * 0.12);
  const apse = rect(w * 0.82, h * 0.5, w * 0.1, base - h * 0.5);
  wash(pen, apse, PLASTER);
  shadeRight(pen, w * 0.82, h * 0.5, w * 0.1, base - h * 0.5, 0.5);
  ink(pen, apse, true, 0.9);
  const cone: Pt[] = [[w * 0.815, h * 0.5], [w * 0.87, h * 0.4], [w * 0.925, h * 0.5]];
  wash(pen, cone, TILE);
  ink(pen, cone, true, 0.8, false);
  // Narthex (west).
  block(pen, w * 0.02, h * 0.68, w * 0.09, base - h * 0.68, MARBLE);
  arcade(pen, w * 0.03, h * 0.75, w * 0.07, h * 0.15, 3, INK, 0.7);
  cross(pen, w * 0.46, h * 0.1, h * 0.12);
}

function domedChurch(pen: Pen, w: number, h: number): void {
  const base = h * 0.97;
  // Octagonal body (Sts Sergius and Bacchus): a wide lower storey, the drum, a melon dome.
  block(pen, w * 0.12, h * 0.55, w * 0.76, base - h * 0.55, PLASTER);
  arcade(pen, w * 0.16, h * 0.64, w * 0.68, h * 0.14, 7, INK, 0.7);
  brickBands(pen, w * 0.12, h * 0.55, w * 0.76, base - h * 0.55, 3);
  sideRoof(pen, w * 0.12, h * 0.55, w * 0.76, h * 0.05);
  block(pen, w * 0.26, h * 0.38, w * 0.48, h * 0.14, PLASTER);
  arcade(pen, w * 0.28, h * 0.405, w * 0.44, h * 0.08, 8, INK, 0.8);
  dome(pen, w * 0.5, h * 0.38, w * 0.24, h * 0.22, LEAD, 14);
  cross(pen, w * 0.5, h * 0.06, h * 0.1);
}

function crossDomed(pen: Pen, w: number, h: number): void {
  const base = h * 0.97;
  block(pen, w * 0.08, h * 0.58, w * 0.84, base - h * 0.58, PLASTER);
  brickBands(pen, w * 0.08, h * 0.58, w * 0.84, base - h * 0.58, 4);
  arcade(pen, w * 0.1, h * 0.7, w * 0.8, h * 0.16, 11, INK, 0.7);
  // Five domes: the arms and the taller crossing.
  for (const [x, rx, ry, drumH, b] of [[0.18, 0.08, 0.1, 0.07, 0.58], [0.82, 0.08, 0.1, 0.07, 0.58], [0.34, 0.09, 0.11, 0.08, 0.5], [0.66, 0.09, 0.11, 0.08, 0.5], [0.5, 0.12, 0.15, 0.11, 0.42]] as const) {
    const drumTop = h * (b - drumH);
    block(pen, w * (x - rx * 0.8), drumTop, w * rx * 1.6, h * drumH, PLASTER, false);
    arcade(pen, w * (x - rx * 0.7), drumTop + h * drumH * 0.2, w * rx * 1.4, h * drumH * 0.6, 5, INK, 0.75);
    dome(pen, w * x, drumTop, w * rx, h * ry, LEAD, 8);
  }
  cross(pen, w * 0.5, h * 0.06, h * 0.1);
}

/* ------------------------------------------------------------------ */
/* Hippodrome, palace, forum columns, gates                             */

function hippodrome(pen: Pen, w: number, h: number): void {
  const base = h * 0.98;
  const top = h * 0.55;
  // Sphendone: the curved south end (left), two storeys of arcades.
  const body: Pt[] = [[w * 0.04, base], [w * 0.04, top + h * 0.12], [w * 0.09, top], [w * 0.86, top], [w * 0.86, base]];
  wash(pen, body, '#e2cba2');
  brickBands(pen, w * 0.04, top, w * 0.82, base - top, 2);
  arcade(pen, w * 0.06, top + h * 0.06, w * 0.78, h * 0.13, 30, INK, 0.72);
  arcade(pen, w * 0.06, top + h * 0.24, w * 0.78, h * 0.15, 26, INK, 0.72);
  ink(pen, body, true, 1);
  // The spina monuments standing above the stands.
  const ob: Pt[] = [[w * 0.42, top], [w * 0.425, h * 0.12], [w * 0.432, h * 0.09], [w * 0.439, h * 0.12], [w * 0.444, top]];
  wash(pen, ob, '#bf8f82', 1);
  hatch(pen, ob, 3, -1.2, 0.35);
  ink(pen, ob, true, 0.9);
  const serpent: Pt[] = [[w * 0.5, top], [w * 0.498, h * 0.3], [w * 0.492, h * 0.27], [w * 0.5, h * 0.25], [w * 0.508, h * 0.27], [w * 0.502, h * 0.3], [w * 0.504, top]];
  wash(pen, serpent, '#6c6a4c', 1);
  ink(pen, serpent, true, 0.8);
  const walled: Pt[] = [[w * 0.58, top], [w * 0.585, h * 0.2], [w * 0.592, h * 0.17], [w * 0.6, h * 0.2], [w * 0.605, top]];
  wash(pen, walled, '#b9a585', 1);
  hatch(pen, walled, 2.5, -0.4, 0.5);
  ink(pen, walled, true, 0.9);
  // Kathisma, the imperial box, on the palace side.
  block(pen, w * 0.28, h * 0.42, w * 0.1, top - h * 0.42, MARBLE);
  arcade(pen, w * 0.29, h * 0.45, w * 0.08, h * 0.08, 3, INK, 0.7);
  pitchedRoof(pen, w * 0.28, h * 0.42, w * 0.1, h * 0.06, LEAD);
  // Carceres (starting gates) at the north end with the gilded quadriga.
  block(pen, w * 0.86, h * 0.45, w * 0.12, base - h * 0.45, MARBLE);
  arcade(pen, w * 0.87, h * 0.62, w * 0.1, h * 0.3, 4, INK, 0.75);
  for (let i = 0; i < 4; i++) {
    const hx = w * (0.872 + i * 0.026);
    const horse: Pt[] = [[hx, h * 0.45], [hx + w * 0.004, h * 0.37], [hx + w * 0.012, h * 0.33], [hx + w * 0.02, h * 0.34], [hx + w * 0.016, h * 0.38], [hx + w * 0.02, h * 0.45]];
    gild(pen, horse);
  }
}

function greatPalace(pen: Pen, w: number, h: number): void {
  const base = h * 0.98;
  // Terraces stepping down from the Hippodrome (left) to the sea (right).
  const terraces: Array<[number, number, number]> = [[0.02, 0.36, 0.36], [0.3, 0.5, 0.4], [0.62, 0.64, 0.36]];
  terraces.forEach(([x, top, tw], i) => {
    const tx = w * x;
    const ty = h * top;
    block(pen, tx, ty, w * tw, base - ty, i % 2 ? PLASTER : MARBLE);
    arcade(pen, tx + w * 0.01, ty + h * 0.05, w * (tw - 0.02), h * 0.1, Math.round(tw * 30), INK, 0.7);
    arcade(pen, tx + w * 0.01, ty + h * 0.2, w * (tw - 0.02), h * 0.12, Math.round(tw * 24), INK, 0.65);
    sideRoof(pen, tx, ty, w * tw, h * 0.04, LEAD);
  });
  // Chalke gate with its gilded bronze roof (left), halls with small domes.
  dome(pen, w * 0.12, h * 0.36, w * 0.05, h * 0.09, PALETTE.gold);
  markGold(pen, domePts(w * 0.12, h * 0.36, w * 0.05, h * 0.09));
  dome(pen, w * 0.42, h * 0.5, w * 0.045, h * 0.08);
  dome(pen, w * 0.5, h * 0.5, w * 0.03, h * 0.06);
  dome(pen, w * 0.76, h * 0.64, w * 0.04, h * 0.07);
  cross(pen, w * 0.42, h * 0.36, h * 0.06);
  // Gardens: cypresses between the terraces.
  for (const x of [0.285, 0.305, 0.6, 0.615, 0.97]) cypress(pen, w * x, base, w * 0.02, h * 0.34);
  // Sea front: the Boukoleon loggia.
  const loggia = rect(w * 0.8, h * 0.7, w * 0.17, base - h * 0.7);
  wash(pen, loggia, MARBLE);
  arcade(pen, w * 0.81, h * 0.73, w * 0.15, h * 0.12, 5, INK, 0.8);
  ink(pen, loggia, true, 0.9);
}

function column(shaft: string, top: 'helios' | 'statue' | 'horseman' | 'cross', bands: boolean) {
  return (pen: Pen, w: number, h: number) => {
    const base = h * 0.99;
    const cx = w * 0.5;
    const shaftW = w * 0.34;
    const topY = top === 'horseman' ? h * 0.2 : h * 0.14;
    // Stepped marble pedestal.
    const steps = [[0.9, 0.95], [0.75, 0.9], [0.6, 0.84]] as const;
    for (const [sw, sy] of steps) {
      const r = rect(cx - (w * sw) / 2, h * sy, w * sw, base - h * sy);
      wash(pen, r, MARBLE);
      ink(pen, r, true, 0.9);
    }
    const s = rect(cx - shaftW / 2, topY, shaftW, h * 0.84 - topY);
    wash(pen, s, shaft, 1);
    hatch(pen, rect(cx + shaftW * 0.1, topY, shaftW * 0.4, h * 0.84 - topY), 3, -1.1, 0.45);
    if (bands) {
      for (let i = 0; i < 8; i++) {
        const by = topY + (h * 0.84 - topY) * (0.06 + i * 0.12);
        gild(pen, rect(cx - shaftW * 0.58, by, shaftW * 1.16, h * 0.012), false);
      }
    } else {
      // A spiral frieze of reliefs winding up the shaft.
      for (let y = topY + h * 0.02; y < h * 0.82; y += h * 0.05) {
        ink(pen, [[cx - shaftW / 2, y + h * 0.02], [cx + shaftW / 2, y - h * 0.01]], false, 0.6, false);
      }
    }
    ink(pen, s, true, 1);
    // Capital.
    const cap = rect(cx - shaftW * 0.8, topY - h * 0.015, shaftW * 1.6, h * 0.02);
    wash(pen, cap, MARBLE);
    ink(pen, cap, true, 0.9);
    const y0 = topY - h * 0.015;
    if (top === 'helios' || top === 'statue') {
      const fig: Pt[] = [[cx - w * 0.14, y0], [cx - w * 0.1, y0 - h * 0.07], [cx - w * 0.06, y0 - h * 0.1], [cx, y0 - h * 0.115], [cx + w * 0.06, y0 - h * 0.1], [cx + w * 0.1, y0 - h * 0.07], [cx + w * 0.14, y0]];
      if (top === 'helios') {
        gild(pen, fig);
        for (let i = 0; i < 7; i++) {
          const a = Math.PI * (0.15 + i * 0.117);
          ink(pen, [[cx + Math.cos(a) * w * 0.07, y0 - h * 0.11 - Math.sin(a) * w * 0.07], [cx + Math.cos(a) * w * 0.16, y0 - h * 0.11 - Math.sin(a) * w * 0.16]], false, 0.8, false);
        }
        ink(pen, [[cx + w * 0.16, y0 - h * 0.02], [cx + w * 0.2, y0 - h * 0.13]], false, 0.9, false);
      } else {
        wash(pen, fig, '#8a7a5a', 1);
        ink(pen, fig, true, 0.8);
      }
    } else if (top === 'horseman') {
      const horse: Pt[] = [[cx - w * 0.3, y0], [cx - w * 0.28, y0 - h * 0.05], [cx - w * 0.1, y0 - h * 0.06], [cx + w * 0.2, y0 - h * 0.07], [cx + w * 0.34, y0 - h * 0.1], [cx + w * 0.36, y0 - h * 0.07], [cx + w * 0.22, y0 - h * 0.04], [cx + w * 0.26, y0]];
      gild(pen, horse);
      const rider: Pt[] = [[cx - w * 0.06, y0 - h * 0.06], [cx - w * 0.04, y0 - h * 0.12], [cx + w * 0.04, y0 - h * 0.12], [cx + w * 0.06, y0 - h * 0.06]];
      gild(pen, rider);
      gild(pen, domePts(cx - w * 0.14, y0 - h * 0.1, w * 0.04, h * 0.02));
    } else {
      cross(pen, cx, y0 - h * 0.1, h * 0.1);
    }
  };
}

function goldenGate(withTowers: boolean) {
  return (pen: Pen, w: number, h: number) => {
    const base = h * 0.98;
    if (withTowers) {
      for (const x of [0.02, 0.76]) {
        const tx = w * x;
        const tw = w * 0.22;
        block(pen, tx, h * 0.22, tw, base - h * 0.22, MARBLE);
        const cren = crenellated(tx - tw * 0.04, h * 0.22, tw * 1.08, h * 0.26, tw * 0.14, h * 0.04);
        wash(pen, cren, MARBLE);
        ink(pen, cren, true, 0.9);
        arcade(pen, tx + tw * 0.3, h * 0.36, tw * 0.4, h * 0.1, 2, INK, 0.8);
      }
    }
    // The triple arch.
    const gx = w * 0.24;
    const gw = w * 0.52;
    block(pen, gx, h * 0.34, gw, base - h * 0.34, MARBLE);
    const { ctx } = pen;
    const archAt = (x: number, aw: number, top: number) => {
      ctx.save();
      ctx.fillStyle = INK;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.moveTo(x, base);
      ctx.lineTo(x, top + aw / 2);
      ctx.arc(x + aw / 2, top + aw / 2, aw / 2, Math.PI, 0);
      ctx.lineTo(x + aw, base);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    };
    archAt(gx + gw * 0.08, gw * 0.16, h * 0.62);
    archAt(gx + gw * 0.76, gw * 0.16, h * 0.62);
    archAt(gx + gw * 0.33, gw * 0.34, h * 0.46);
    // Gilded doors in the central arch.
    gild(pen, rect(gx + gw * 0.36, h * 0.66, gw * 0.28, base - h * 0.66));
    ink(pen, [[gx + gw * 0.5, h * 0.66], [gx + gw * 0.5, base]], false, 0.8, false);
    // Attic with the victory group.
    const attic = rect(gx - gw * 0.02, h * 0.3, gw * 1.04, h * 0.05);
    wash(pen, attic, MARBLE);
    ink(pen, attic, true, 0.9);
    for (const x of [0.3, 0.5, 0.7]) {
      const f: Pt[] = [[gx + gw * (x - 0.04), h * 0.3], [gx + gw * x, h * 0.18], [gx + gw * (x + 0.04), h * 0.3]];
      gild(pen, f);
    }
  };
}

function landGate(breached: boolean) {
  return (pen: Pen, w: number, h: number) => {
    const base = h * 0.98;
    for (const x of [0.05, 0.63]) {
      const tx = w * x;
      const tw = w * 0.32;
      const top = breached && x > 0.5 ? h * 0.55 : h * 0.18;
      block(pen, tx, top, tw, base - top, '#dcc59c');
      brickBands(pen, tx, top, tw, base - top, 4);
      const cren = crenellated(tx - tw * 0.04, top, tw * 1.08, top + h * 0.04, tw * 0.16, h * 0.05);
      wash(pen, cren, '#dcc59c');
      ink(pen, cren, true, 0.9);
      ink(pen, rect(tx, top, tw, base - top), true, 1);
    }
    block(pen, w * 0.37, h * 0.42, w * 0.26, base - h * 0.42, '#d6bd92');
    arcade(pen, w * 0.42, h * 0.6, w * 0.16, base - h * 0.6, 1, INK, 0.9);
  };
}

function galataTower(pen: Pen, w: number, h: number): void {
  const base = h * 0.99;
  block(pen, w * 0.2, h * 0.2, w * 0.6, base - h * 0.2, '#d8c29c');
  for (let i = 0; i < 5; i++) arcade(pen, w * 0.35, h * (0.3 + i * 0.13), w * 0.3, h * 0.06, 2, INK, 0.7);
  const cap: Pt[] = [[w * 0.12, h * 0.2], [w * 0.5, h * 0.02], [w * 0.88, h * 0.2]];
  wash(pen, cap, TILE);
  ink(pen, cap, true, 1);
}

/* ------------------------------------------------------------------ */
/* Ships                                                                */

function ship(kind: 'dromon' | 'merchant') {
  return (pen: Pen, w: number, h: number) => {
    const water = h * 0.9;
    const hull: Pt[] = kind === 'dromon'
      ? [[w * 0.02, water - h * 0.1], [w * 0.14, water], [w * 0.84, water], [w * 0.98, water - h * 0.14], [w * 0.86, water - h * 0.1]]
      : [[w * 0.08, water - h * 0.2], [w * 0.2, water], [w * 0.8, water], [w * 0.92, water - h * 0.24], [w * 0.8, water - h * 0.16], [w * 0.2, water - h * 0.16]];
    // Mast and a lateen sail.
    const mx = w * (kind === 'dromon' ? 0.45 : 0.5);
    ink(pen, [[mx, water - h * 0.1], [mx, h * 0.08]], false, 1.1, false);
    const sail: Pt[] = [[mx - w * 0.3, water - h * 0.22], [mx + w * 0.26, h * 0.06], [mx + w * 0.02, water - h * 0.26]];
    wash(pen, sail, SAIL, 1);
    hatch(pen, sail, 5, -0.5, 0.2);
    ink(pen, sail, true, 0.9);
    wash(pen, hull, WOOD, 1);
    hatch(pen, hull, 3, 0, 0.4);
    ink(pen, hull, true, 1);
    if (kind === 'dromon') {
      for (let i = 0; i < 9; i++) {
        const ox = w * (0.2 + i * 0.07);
        ink(pen, [[ox, water - h * 0.04], [ox - w * 0.05, water + h * 0.08]], false, 0.6, false);
      }
    }
    // Water line.
    ink(pen, [[w * 0.0, water + h * 0.02], [w * 1.0, water + h * 0.02]], false, 0.5, false);
  };
}

/* ------------------------------------------------------------------ */
/* Registry                                                             */

const ART: Record<string, CardArt> = {
  'hagia-sophia:domed': { width: 0.4, height: 0.25, draw: hagiaSophia({ rise: 0.42 }) },
  'hagia-sophia:dome-fallen': { width: 0.4, height: 0.25, draw: hagiaSophia({ rise: 0, fallen: true }) },
  'hagia-sophia:high-domed': { width: 0.4, height: 0.26, draw: hagiaSophia({ rise: 0.55 }) },
  'hagia-sophia:buttressed': { width: 0.4, height: 0.26, draw: hagiaSophia({ rise: 0.55, buttressed: true }) },
  'hagia-sophia:basilica': { width: 0.3, height: 0.15, draw: basilica },
  'hagia-sophia:ruin': { width: 0.3, height: 0.13, draw: basilicaRuin },
  'church:basilica': { width: 0.15, height: 0.085, draw: basilica },
  'church:domed': { width: 0.11, height: 0.1, draw: domedChurch },
  'church:cross-domed': { width: 0.15, height: 0.11, draw: crossDomed },
  'church:ruin': { width: 0.12, height: 0.06, draw: basilicaRuin },
  'hippodrome:intact': { width: 0.44, height: 0.13, draw: hippodrome },
  'palace:intact': { width: 0.36, height: 0.16, draw: greatPalace },
  'column-of-constantine:statue': { width: 0.04, height: 0.22, draw: column('#7d3b50', 'helios', true) },
  'column-of-constantine:cross': { width: 0.04, height: 0.22, draw: column('#7d3b50', 'cross', true) },
  'column-of-justinian:horseman': { width: 0.05, height: 0.25, draw: column('#7a6a52', 'horseman', true) },
  'column:statue': { width: 0.035, height: 0.2, draw: column(MARBLE, 'statue', false) },
  'golden-gate:arch': { width: 0.1, height: 0.09, draw: goldenGate(false) },
  'golden-gate:gate': { width: 0.16, height: 0.11, draw: goldenGate(true) },
  'gate:gate': { width: 0.09, height: 0.085, draw: landGate(false) },
  'gate:breached': { width: 0.09, height: 0.085, draw: landGate(true) },
  'tower:tower': { width: 0.05, height: 0.2, draw: galataTower },
  'vessel:dromon': { width: 0.11, height: 0.08, draw: ship('dromon') },
  'vessel:merchant': { width: 0.08, height: 0.075, draw: ship('merchant') },
};

/** The drawing for a structure variant: by id, then by kind. */
export function cardArt(id: string, kind: string, variant: string): CardArt | null {
  return ART[`${id}:${variant}`] ?? ART[`${kind}:${variant}`] ?? null;
}

/* ------------------------------------------------------------------ */
/* Atlas of houses and trees (instanced cards)                          */

export const ATLAS_GRID: [number, number] = [8, 2];
export const ATLAS_HOUSES = 12;
/** Tile indices past the houses. */
export const ATLAS_CYPRESS = [12, 13];
export const ATLAS_PINE = 14;
export const ATLAS_CHAPEL = 15;

export function drawAtlas(pen: Pen, tile: number): void {
  const { ctx } = pen;
  const [cols] = ATLAS_GRID;
  for (let i = 0; i < ATLAS_GRID[0] * ATLAS_GRID[1]; i++) {
    const x0 = (i % cols) * tile;
    const y0 = Math.floor(i / cols) * tile;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y0, tile, tile);
    ctx.clip();
    ctx.translate(x0, y0);
    drawAtlasTile(pen, i, tile);
    ctx.restore();
  }
}

function drawAtlasTile(pen: Pen, i: number, s: number): void {
  const base = s * 0.97;
  const tones = [PLASTER, '#efe4cf', '#dcc190', '#e8cfa6', '#d9b98f', '#eadfca'];
  if (i < ATLAS_HOUSES) {
    const tone = tones[i % tones.length];
    const wide = i % 3 === 0;
    const tall = i % 4 === 1;
    const bw = s * (wide ? 0.84 : 0.62);
    const bh = s * (tall ? 0.55 : 0.36);
    const bx = (s - bw) / 2;
    const top = base - bh;
    block(pen, bx, top, bw, bh, tone);
    // Windows and a door.
    arcade(pen, bx + bw * 0.12, top + bh * 0.18, bw * 0.76, bh * 0.22, wide ? 4 : 3, INK, 0.75);
    if (tall) arcade(pen, bx + bw * 0.12, top + bh * 0.5, bw * 0.76, bh * 0.18, 3, INK, 0.7);
    pen.ctx.save();
    pen.ctx.fillStyle = INK;
    pen.ctx.globalAlpha = 0.8;
    pen.ctx.fillRect(bx + bw * 0.44, base - bh * 0.3, bw * 0.12, bh * 0.3);
    pen.ctx.restore();
    if (i % 5 === 2) {
      // Timber balcony (a maenianum) over the street.
      const bal = rect(bx - bw * 0.06, top + bh * 0.42, bw * 1.12, bh * 0.1);
      wash(pen, bal, WOOD, 1);
      ink(pen, bal, true, 0.6, false);
    }
    if (i % 4 === 3) {
      // Flat roof terrace with a parapet.
      const parapet = rect(bx, top - s * 0.04, bw, s * 0.04);
      wash(pen, parapet, tone);
      ink(pen, parapet, true, 0.7, false);
    } else {
      pitchedRoof(pen, bx, top, bw, s * (wide ? 0.16 : 0.2), i % 2 ? TILE : '#c46a45');
    }
    return;
  }
  if (ATLAS_CYPRESS.includes(i)) {
    cypress(pen, s * 0.5, base, s * (i === 12 ? 0.3 : 0.24), s * (i === 12 ? 0.92 : 0.75));
    return;
  }
  if (i === ATLAS_PINE) {
    // Umbrella pine: a leaning trunk under a flat, layered crown.
    const trunk: Pt[] = [[s * 0.47, base], [s * 0.45, s * 0.52], [s * 0.5, s * 0.5], [s * 0.54, base]];
    wash(pen, trunk, WOOD, 1);
    ink(pen, trunk, true, 0.8, false);
    for (const [cx, cy, rx, ry, tone] of [[0.36, 0.42, 0.24, 0.12, PINE], [0.62, 0.4, 0.26, 0.13, PINE], [0.5, 0.32, 0.3, 0.12, '#6f8a55']] as const) {
      const lobe: Pt[] = Array.from({ length: 18 }, (_, k) => {
        const a = (k / 18) * Math.PI * 2;
        return [s * (cx + Math.cos(a) * rx), s * (cy + Math.sin(a) * ry)] as Pt;
      });
      wash(pen, lobe, tone, 1);
      hatch(pen, lobe, 3, -0.3, 0.25);
      ink(pen, lobe, true, 0.7, false);
    }
    return;
  }
  // A small domed chapel.
  block(pen, s * 0.18, s * 0.55, s * 0.64, base - s * 0.55, PLASTER);
  arcade(pen, s * 0.24, s * 0.66, s * 0.52, s * 0.14, 3, INK, 0.7);
  block(pen, s * 0.34, s * 0.44, s * 0.32, s * 0.11, PLASTER, false);
  dome(pen, s * 0.5, s * 0.44, s * 0.17, s * 0.17, i % 2 ? LEAD : '#c46a45', 6);
  cross(pen, s * 0.5, s * 0.13, s * 0.12);
}

export { LEAD, LEAD_SHADE, MARBLE, PLASTER, BRICK, TILE };
