/**
 * Constantinople as a pop-up illumination: three hand-drawn cards standing
 * in depth like the layers of a pop-up book — the Theodosian land walls
 * with the Golden Gate in front, the city quarter with the Hippodrome and
 * the Aqueduct of Valens in the middle, and Hagia Sophia, the Column of
 * Constantine and the Great Palace crowning the back under a name scroll —
 * over a gilded roundel lying on the map.
 *
 * The card stack turns about its vertical axis to face the viewer (so the
 * drawing always reads, and moving the camera gives real parallax between
 * the layers). `setRise(t)` folds the cards up from flat, back to front,
 * as a pure function of t.
 */
import {
  CanvasTexture,
  CircleGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  type Camera,
} from 'three';
import { applyCurvature } from '../curvature';
import { easeOutBack } from '../clockwork/constantinople';
import {
  INK,
  PALETTE,
  arcade,
  crenellated,
  domePts,
  gild,
  hatch,
  ink,
  makePen,
  rect,
  wash,
  type Pen,
  type Pt,
} from './illumination';

function canvas(w: number, h: number): { c: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  return { c, ctx };
}

/* ------------------------------------------------------------------ */
/* Card drawings                                                        */

function tower(pen: Pen, x: number, w: number, top: number, base: number, round = false): void {
  const body: Pt[] = round
    ? [[x, base], [x, top + w * 0.1], [x + w * 0.15, top], [x + w * 0.85, top], [x + w, top + w * 0.1], [x + w, base]]
    : rect(x, top, w, base - top);
  wash(pen, body, PALETTE.stone);
  hatch(pen, rect(x + w * 0.62, top, w * 0.38, base - top), 4.5, -1.0, 0.45);
  const cren = crenellated(x - w * 0.06, top, w * 1.12, top + w * 0.2, w * 0.16, w * 0.14);
  wash(pen, cren, PALETTE.stoneShade);
  ink(pen, cren, true, 0.9);
  ink(pen, body, true, 1.1);
  // Slit windows.
  const { ctx } = pen;
  ctx.save();
  ctx.fillStyle = INK;
  ctx.globalAlpha = 0.8;
  for (let k = 0; k < 2; k++) {
    const wy = top + (base - top) * (0.3 + k * 0.28);
    ctx.fillRect(x + w * 0.44, wy, w * 0.12, (base - top) * 0.1);
  }
  ctx.restore();
}

function drawWallsCard(w: number, h: number): HTMLCanvasElement {
  const { c, ctx } = canvas(w, h);
  const pen = makePen(ctx, 413, w / 900);
  const base = h * 0.9;
  // Moat with inked ripples.
  wash(pen, [[w * 0.02, base], [w * 0.98, base], [w * 0.97, h * 0.99], [w * 0.03, h * 0.99]], PALETTE.water, 0.7);
  for (let i = 0; i < 3; i++) {
    const y = base + (h * 0.09) * (0.3 + i * 0.25);
    ink(pen, [[w * 0.06, y], [w * 0.94, y]], false, 0.45, false);
  }
  // Inner wall (tall) behind, outer wall (low) in front.
  const inner = crenellated(w * 0.03, h * 0.46, w * 0.94, base, w * 0.014, h * 0.025);
  wash(pen, inner, PALETTE.stoneShade);
  ink(pen, inner, true, 1);
  const towers = 9;
  for (let i = 0; i < towers; i++) {
    if (i === 4) continue; // the Golden Gate stands in the middle
    const tx = w * (0.05 + (i / (towers - 1)) * 0.86);
    const tw = w * 0.055;
    tower(pen, tx - tw / 2, tw, h * (0.22 + ((i * 37) % 7) * 0.012), base, i % 2 === 1);
  }
  // The Golden Gate: twin marble towers and a gilded triple arch.
  const gx = w * 0.5;
  const gw = w * 0.2;
  tower(pen, gx - gw / 2 - w * 0.02, w * 0.07, h * 0.18, base);
  tower(pen, gx + gw / 2 - w * 0.05, w * 0.07, h * 0.18, base);
  const gate = rect(gx - gw * 0.3, h * 0.36, gw * 0.6, base - h * 0.36);
  wash(pen, gate, PALETTE.stone);
  ink(pen, gate, true, 1.1);
  gild(pen, rect(gx - gw * 0.32, h * 0.32, gw * 0.64, h * 0.05));
  arcade(pen, gx - gw * 0.26, h * 0.52, gw * 0.52, base - h * 0.52, 3, INK, 0.85);
  // Outer wall with small towers.
  const outer = crenellated(w * 0.02, h * 0.7, w * 0.96, base, w * 0.012, h * 0.02);
  wash(pen, outer, PALETTE.stone);
  ink(pen, outer, true, 0.9);
  for (let i = 0; i < 14; i++) {
    const tx = w * (0.04 + i * 0.07);
    if (Math.abs(tx - gx) < gw * 0.4) continue;
    const r: Pt[] = rect(tx, h * 0.62, w * 0.03, base - h * 0.62);
    wash(pen, r, PALETTE.stone);
    hatch(pen, rect(tx + w * 0.019, h * 0.62, w * 0.011, base - h * 0.62), 4, -1, 0.4);
    ink(pen, r, true, 0.8);
  }
  return c;
}

function house(pen: Pen, x: number, base: number, w: number, hgt: number, roofH: number, tone: string): void {
  const body = rect(x, base - hgt, w, hgt);
  wash(pen, body, tone);
  hatch(pen, rect(x + w * 0.65, base - hgt, w * 0.35, hgt), 4, -1, 0.35);
  ink(pen, body, true, 0.75, false);
  const roof: Pt[] = [[x - w * 0.06, base - hgt], [x + w / 2, base - hgt - roofH], [x + w * 1.06, base - hgt]];
  wash(pen, roof, PALETTE.roof);
  hatch(pen, [[x + w / 2, base - hgt - roofH], [x + w * 1.06, base - hgt], [x + w / 2, base - hgt]], 3.5, -0.6, 0.35);
  ink(pen, roof, true, 0.75, false);
  const { ctx } = pen;
  ctx.save();
  ctx.fillStyle = INK;
  ctx.globalAlpha = 0.75;
  ctx.fillRect(x + w * 0.2, base - hgt * 0.62, w * 0.14, hgt * 0.22);
  ctx.fillRect(x + w * 0.55, base - hgt * 0.62, w * 0.14, hgt * 0.22);
  ctx.restore();
}

function drawCityCard(w: number, h: number): HTMLCanvasElement {
  const { c, ctx } = canvas(w, h);
  const pen = makePen(ctx, 537, w / 900);
  const base = h * 0.95;
  // Aqueduct of Valens (far left, two tiers of arches).
  const aq = rect(w * 0.02, h * 0.42, w * 0.26, h * 0.3);
  wash(pen, aq, PALETTE.stoneShade);
  arcade(pen, w * 0.025, h * 0.49, w * 0.25, h * 0.1, 9, INK, 0.7);
  arcade(pen, w * 0.025, h * 0.6, w * 0.25, h * 0.12, 9, INK, 0.7);
  ink(pen, aq, true, 0.9);
  // Hippodrome: long two-tier arcade with the obelisk above.
  const hip = rect(w * 0.3, h * 0.46, w * 0.34, h * 0.3);
  wash(pen, hip, PALETTE.stone);
  arcade(pen, w * 0.305, h * 0.5, w * 0.33, h * 0.1, 14, INK, 0.65);
  arcade(pen, w * 0.305, h * 0.62, w * 0.33, h * 0.12, 14, INK, 0.65);
  ink(pen, hip, true, 1);
  const ob: Pt[] = [[w * 0.45, h * 0.46], [w * 0.456, h * 0.24], [w * 0.462, h * 0.46]];
  wash(pen, ob, PALETTE.porphyry);
  ink(pen, ob, true, 0.8);
  // Churches with small domes rising from the roofs.
  for (const [cx, sz, gold] of [[0.72, 1, true], [0.86, 0.8, false], [0.2, 0.7, false]] as Array<[number, number, boolean]>) {
    const bw = w * 0.07 * sz;
    const bx = w * cx - bw / 2;
    const body = rect(bx, h * 0.5, bw, base - h * 0.5);
    wash(pen, body, PALETTE.stone);
    hatch(pen, rect(bx + bw * 0.6, h * 0.5, bw * 0.4, base - h * 0.5), 4, -1, 0.4);
    ink(pen, body, true, 0.9);
    const dome = domePts(w * cx, h * 0.5, bw * 0.42, bw * 0.4);
    if (gold) gild(pen, dome);
    else {
      wash(pen, dome, PALETTE.roof);
      ink(pen, dome, true, 0.9);
    }
    ink(pen, [[w * cx, h * 0.5 - bw * 0.4], [w * cx, h * 0.5 - bw * 0.62]], false, 0.8, false);
    ink(pen, [[w * cx - bw * 0.08, h * 0.5 - bw * 0.54], [w * cx + bw * 0.08, h * 0.5 - bw * 0.54]], false, 0.8, false);
  }
  // Three staggered rows of houses, drawn back to front.
  const tones = [PALETTE.stone, '#ead7b0', '#dcc190', '#e8cfa6'];
  for (let row = 2; row >= 0; row--) {
    const rb = base - row * h * 0.05;
    let x = w * (0.01 + row * 0.012);
    let k = row * 7;
    while (x < w * 0.98) {
      const hw = w * (0.035 + ((k * 13) % 5) * 0.005);
      const hh = h * (0.12 + ((k * 7) % 6) * 0.018) * (1 - row * 0.12);
      house(pen, x, rb, hw, hh, hw * 0.55, tones[k % tones.length]);
      x += hw * (0.92 + ((k * 3) % 4) * 0.05);
      k++;
    }
  }
  return c;
}

function drawCrownCard(w: number, h: number, withName: boolean): HTMLCanvasElement {
  const { c, ctx } = canvas(w, h);
  const pen = makePen(ctx, 330, w / 900);
  const base = h * 0.97;
  // Distant hills and domes in a pale wash (depth).
  wash(pen, [[0, base], [w * 0.1, h * 0.6], [w * 0.3, h * 0.66], [w * 0.5, h * 0.58], [w * 0.75, h * 0.64], [w, h * 0.57], [w, base]], '#cfd6c4', 0.5);
  // Great Palace (right): terraces with arcades and small domes.
  for (let i = 0; i < 3; i++) {
    const tx = w * (0.7 + i * 0.03);
    const ty = h * (0.62 + i * 0.1);
    const t = rect(tx, ty, w * (0.27 - i * 0.03), base - ty);
    wash(pen, t, i % 2 ? PALETTE.stone : '#e7d3aa');
    arcade(pen, tx + w * 0.01, ty + h * 0.03, w * (0.25 - i * 0.03), h * 0.06, 8, INK, 0.6);
    ink(pen, t, true, 0.9);
  }
  gild(pen, domePts(w * 0.8, h * 0.62, w * 0.035, h * 0.05));
  // Column of Constantine (left): porphyry shaft, gold bands, gilded statue.
  const colX = w * 0.2;
  const colTop = h * 0.14;
  const shaft = rect(colX - w * 0.012, colTop, w * 0.024, base - colTop - h * 0.06);
  wash(pen, shaft, PALETTE.porphyry, 1);
  hatch(pen, rect(colX + w * 0.002, colTop, w * 0.01, base - colTop), 3, -1.1, 0.5);
  ink(pen, shaft, true, 1);
  for (let i = 0; i < 7; i++) {
    const by = colTop + (base - colTop) * (0.08 + i * 0.12);
    gild(pen, rect(colX - w * 0.015, by, w * 0.03, h * 0.012), false);
  }
  const plinth = rect(colX - w * 0.03, base - h * 0.06, w * 0.06, h * 0.06);
  wash(pen, plinth, PALETTE.stone);
  ink(pen, plinth, true, 1);
  // Statue: a gilded figure with a spear and the rayed crown.
  gild(pen, [[colX - w * 0.012, colTop], [colX - w * 0.008, colTop - h * 0.06], [colX, colTop - h * 0.075], [colX + w * 0.008, colTop - h * 0.06], [colX + w * 0.012, colTop]]);
  ink(pen, [[colX + w * 0.016, colTop + h * 0.01], [colX + w * 0.022, colTop - h * 0.1]], false, 0.8, false);
  // Hagia Sophia (centre): body, stepped buttresses, half domes, the great
  // gilded dome on its ring of windows, the cross.
  const sx = w * 0.5;
  const bodyW = w * 0.34;
  const body = rect(sx - bodyW / 2, h * 0.52, bodyW, base - h * 0.52);
  wash(pen, body, PALETTE.stone);
  hatch(pen, rect(sx + bodyW * 0.18, h * 0.52, bodyW * 0.32, base - h * 0.52), 4.5, -1, 0.42);
  arcade(pen, sx - bodyW * 0.45, h * 0.62, bodyW * 0.9, h * 0.08, 11, INK, 0.7);
  arcade(pen, sx - bodyW * 0.45, h * 0.76, bodyW * 0.9, h * 0.1, 9, INK, 0.7);
  ink(pen, body, true, 1.2);
  for (const side of [-1, 1]) {
    const bx = sx + side * bodyW * 0.5;
    const but: Pt[] = side < 0
      ? [[bx, base], [bx - w * 0.05, base], [bx - w * 0.05, h * 0.62], [bx - w * 0.025, h * 0.5], [bx, h * 0.5]]
      : [[bx, base], [bx + w * 0.05, base], [bx + w * 0.05, h * 0.62], [bx + w * 0.025, h * 0.5], [bx, h * 0.5]];
    wash(pen, but, PALETTE.stoneShade);
    ink(pen, but, true, 1);
    const half = domePts(sx + side * bodyW * 0.26, h * 0.52, bodyW * 0.18, h * 0.08);
    wash(pen, half, '#9aa2a4');
    hatch(pen, half, 4, -0.7, 0.35);
    ink(pen, half, true, 1);
  }
  const drum = rect(sx - bodyW * 0.3, h * 0.43, bodyW * 0.6, h * 0.09);
  wash(pen, drum, PALETTE.stone);
  arcade(pen, sx - bodyW * 0.28, h * 0.445, bodyW * 0.56, h * 0.06, 16, INK, 0.8);
  ink(pen, drum, true, 1.1);
  const dome = domePts(sx, h * 0.43, bodyW * 0.31, h * 0.17, 32);
  gild(pen, dome);
  // Ribs on the dome.
  for (let i = 1; i < 8; i++) {
    const a = Math.PI - (i / 8) * Math.PI;
    ink(pen, [[sx + Math.cos(a) * bodyW * 0.31, h * 0.43 - Math.sin(a) * h * 0.02], [sx + Math.cos(a) * bodyW * 0.08, h * 0.43 - h * 0.16]], false, 0.5, false);
  }
  ink(pen, [[sx, h * 0.26], [sx, h * 0.19]], false, 1.2, false);
  ink(pen, [[sx - w * 0.012, h * 0.215], [sx + w * 0.012, h * 0.215]], false, 1.2, false);
  // The name scroll.
  if (withName) {
    const sy = h * 0.035;
    const scroll: Pt[] = [
      [w * 0.29, sy + h * 0.02], [w * 0.31, sy], [w * 0.69, sy], [w * 0.71, sy + h * 0.02],
      [w * 0.69, sy + h * 0.1], [w * 0.31, sy + h * 0.1],
    ];
    wash(pen, scroll, PALETTE.paper, 1);
    wash(pen, [[w * 0.27, sy + h * 0.03], [w * 0.31, sy + h * 0.01], [w * 0.31, sy + h * 0.1], [w * 0.27, sy + h * 0.11], [w * 0.285, sy + h * 0.07]], PALETTE.imperial, 1);
    wash(pen, [[w * 0.73, sy + h * 0.03], [w * 0.69, sy + h * 0.01], [w * 0.69, sy + h * 0.1], [w * 0.73, sy + h * 0.11], [w * 0.715, sy + h * 0.07]], PALETTE.imperial, 1);
    ink(pen, scroll, true, 1);
    ctx.save();
    ctx.fillStyle = INK;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `600 ${Math.round(h * 0.055)}px Cinzel, Georgia, serif`;
    ctx.fillText('CONSTANTINOPOLIS', w * 0.5, sy + h * 0.052);
    // Gilt shadow under the lettering.
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = PALETTE.gold;
    ctx.fillText('CONSTANTINOPOLIS', w * 0.5 + h * 0.003, sy + h * 0.055);
    ctx.restore();
  }
  return c;
}

function drawRoundel(size: number): HTMLCanvasElement {
  const { c, ctx } = canvas(size, size);
  const pen = makePen(ctx, 1453, size / 700);
  const r = size / 2;
  const ring = (rad: number, n = 72): Pt[] => Array.from({ length: n }, (_, i) => [r + Math.cos((i / n) * Math.PI * 2) * rad, r + Math.sin((i / n) * Math.PI * 2) * rad] as Pt);
  wash(pen, ring(r * 0.96), PALETTE.paper, 0.9);
  gild(pen, ring(r * 0.96));
  wash(pen, ring(r * 0.82), PALETTE.paper, 1);
  ink(pen, ring(r * 0.82), true, 1);
  // Compass rose in ink.
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const long = i % 2 === 0;
    const len = r * (long ? 0.74 : 0.5);
    const tip: Pt = [r + Math.cos(a) * len, r + Math.sin(a) * len];
    const s1: Pt = [r + Math.cos(a + 0.12) * r * 0.1, r + Math.sin(a + 0.12) * r * 0.1];
    const s2: Pt = [r + Math.cos(a - 0.12) * r * 0.1, r + Math.sin(a - 0.12) * r * 0.1];
    const petal: Pt[] = [[r, r], s1, tip, s2];
    if (long) gild(pen, petal);
    else {
      wash(pen, petal, PALETTE.imperial, 0.8);
      ink(pen, petal, true, 0.7, false);
    }
  }
  ctx.save();
  ctx.fillStyle = INK;
  ctx.font = `600 ${Math.round(size * 0.042)}px Cinzel, Georgia, serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const text = 'NOVA ROMA · CONSTANTINOPOLIS · ';
  const chars = [...text];
  const rr = r * 0.89;
  chars.forEach((ch, i) => {
    const a = (i / chars.length) * Math.PI * 2 - Math.PI / 2;
    ctx.save();
    ctx.translate(r + Math.cos(a) * rr, r + Math.sin(a) * rr);
    ctx.rotate(a + Math.PI / 2);
    ctx.fillText(ch, 0, 0);
    ctx.restore();
  });
  ctx.restore();
  return c;
}

/* ------------------------------------------------------------------ */
/* Assembly                                                             */

export interface PopupCity {
  group: Group;
  readonly rise: number;
  setRise(t: number): void;
  /** Dim the unlit cards with the era's night (0..1). */
  setNight(night: number): void;
  /** Face the camera (cylindrical billboard); call per frame. */
  update(camera: Camera): void;
  dispose(): void;
}

/** Progress of a card fold with a pop-up overshoot. */
function fold(t: number, a: number, b: number): number {
  if (t <= a) return 0;
  if (t >= b) return 1;
  return easeOutBack((t - a) / (b - a));
}

export function buildPopupConstantinople(scale = 1): PopupCity {
  const group = new Group();
  const stack = new Group(); // the billboarded card stack
  group.add(stack);
  const disposables: Array<{ dispose(): void }> = [];

  const cardMats: MeshBasicMaterial[] = [];
  const makeCard = (draw: () => HTMLCanvasElement, width: number, height: number, depth: number) => {
    const tex = new CanvasTexture(draw());
    tex.colorSpace = SRGBColorSpace;
    tex.anisotropy = 8;
    const mat = applyCurvature(
      new MeshBasicMaterial({ map: tex, transparent: false, alphaTest: 0.5, alphaToCoverage: true, side: DoubleSide }),
      'chronicle-card',
    );
    cardMats.push(mat);
    const geo = new PlaneGeometry(width, height);
    geo.translate(0, height / 2, 0); // hinge at the bottom edge
    const mesh = new Mesh(geo, mat);
    mesh.frustumCulled = false;
    const hinge = new Group();
    hinge.position.z = depth;
    hinge.add(mesh);
    stack.add(hinge);
    disposables.push(tex, mat, geo);
    return { hinge, tex, draw };
  };

  const W = 3.2 * scale;
  const cards = [
    { ...makeCard(() => drawCrownCard(1800, 1100, true), W * 0.95, W * 0.58, -0.5 * scale), a: 0.0, b: 0.5 },
    { ...makeCard(() => drawCityCard(1800, 820), W, W * 0.43, 0), a: 0.2, b: 0.68 },
    { ...makeCard(() => drawWallsCard(1800, 700), W * 1.05, W * 0.38, 0.5 * scale), a: 0.38, b: 0.9 },
  ];

  // Gilded roundel on the ground.
  const rTex = new CanvasTexture(drawRoundel(1024));
  rTex.colorSpace = SRGBColorSpace;
  const rMat = applyCurvature(
    new MeshBasicMaterial({ map: rTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }),
    'chronicle-roundel',
  );
  const rGeo = new CircleGeometry(2.1 * scale, 64);
  rGeo.rotateX(-Math.PI / 2);
  const roundel = new Mesh(rGeo, rMat);
  roundel.position.y = 0.01;
  roundel.frustumCulled = false;
  roundel.renderOrder = 5;
  group.add(roundel);
  disposables.push(rTex, rMat, rGeo);

  // Redraw with the display font once it has loaded (lettering).
  if (typeof document !== 'undefined' && document.fonts?.load) {
    void document.fonts.load('600 48px Cinzel').then(() => {
      for (const card of cards) {
        card.tex.image = card.draw();
        card.tex.needsUpdate = true;
      }
      rTex.image = drawRoundel(1024);
      rTex.needsUpdate = true;
    });
  }

  let rise = -1;
  const city: PopupCity = {
    group,
    get rise() {
      return rise;
    },
    setRise(t) {
      const next = Math.min(1, Math.max(0, t));
      if (next === rise) return;
      rise = next;
      for (const card of cards) {
        const k = fold(rise, card.a, card.b);
        card.hinge.rotation.x = -(Math.PI / 2) * (1 - k);
        card.hinge.visible = rise > card.a;
      }
      const r = fold(rise, 0, 0.3);
      roundel.scale.setScalar(Math.max(0.001, r));
      roundel.rotation.y = (1 - r) * 1.2;
      roundel.visible = rise > 0;
    },
    setNight(night) {
      const k = 1 - 0.55 * night;
      for (const m of cardMats) m.color.setRGB(k, k, k * 1.08);
      rMat.color.setRGB(k, k, k * 1.08);
    },
    update(camera) {
      const dx = camera.position.x - group.position.x;
      const dz = camera.position.z - group.position.z;
      stack.rotation.y = Math.atan2(dx, dz);
    },
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
  city.setRise(0);
  return city;
}
