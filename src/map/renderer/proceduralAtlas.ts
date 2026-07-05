/**
 * Runtime-generated placeholder terrain atlas.
 *
 * Paints every frame with pixi Graphics (gradients, speckle, lit/shadow
 * faces) into a single RenderTexture, and returns it behind the same
 * TerrainAtlas interface the real PNG atlas uses — so shipped art is a
 * drop-in replacement (see docs/terrain-art-spec.md).
 */
import { Container, FillGradient, Graphics, RenderTexture, type Renderer } from 'pixi.js';
import type { TerrainCode } from '../../data/schema';
import {
  TERRAIN_COLORS,
  MOUNTAIN_SNOW,
  MOUNTAIN_SHADE,
  HILL_SHADE,
  SEA_RIPPLE,
} from '../colors';
import {
  ANCHORS,
  CANVAS_SIZES,
  FOOTPRINT_W,
  FOOTPRINT_H,
  SKIRT_PX,
  artHexCorners,
  baseKindFor,
  computeAtlasLayout,
  type AtlasEntry,
  type FrameKind,
} from './atlasLayout';
import { createTerrainAtlas, type TerrainAtlas, type TerrainAtlasManifest } from './atlas';

const BASE_VARIANTS: Record<TerrainCode, number> = { D: 2, s: 2, g: 3, p: 3, h: 3, m: 3, d: 3 };
const FEATURE_VARIANTS = { m: 2, h: 2, tree: 2 } as const;

interface FrameSpec {
  name: string;
  kind: FrameKind;
  paint: (g: Graphics, rng: () => number) => void;
}

/* ------------------------------------------------------------------ */
/* small deterministic helpers                                         */

function makeRng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = Math.imul(s ^ (s >>> 15), 2246822519);
    s = Math.imul(s ^ (s >>> 13), 3266489917);
    s ^= s >>> 16;
    return (s >>> 0) / 4294967296;
  };
}

function seedOf(name: string): number {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619);
  return h >>> 0;
}

function mix(c1: number, c2: number, t: number): number {
  const r1 = (c1 >> 16) & 255, g1 = (c1 >> 8) & 255, b1 = c1 & 255;
  const r2 = (c2 >> 16) & 255, g2 = (c2 >> 8) & 255, b2 = c2 & 255;
  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const b = Math.round(b1 + (b2 - b1) * t);
  return (r << 16) | (g << 8) | b;
}

const lighten = (c: number, t: number) => mix(c, 0xffffff, t);
const darken = (c: number, t: number) => mix(c, 0x000000, t);

function verticalGradient(top: number, bottom: number): FillGradient {
  return new FillGradient({
    start: { x: 0.5, y: 0 },
    end: { x: 0.5, y: 1 },
    colorStops: [
      { offset: 0, color: top },
      { offset: 1, color: bottom },
    ],
    textureSpace: 'local',
  });
}

/** Soft irregular hex outline: each edge subdivided and jittered. */
function irregularHexPoints(rng: () => number, grow: number): number[] {
  const corners = artHexCorners(grow);
  const pts: number[] = [];
  for (let i = 0; i < 6; i++) {
    const [ax, ay] = corners[i];
    const [bx, by] = corners[(i + 1) % 6];
    pts.push(ax, ay);
    for (const t of [0.33, 0.66]) {
      const jx = (rng() - 0.5) * 10;
      const jy = (rng() - 0.5) * 8;
      pts.push(ax + (bx - ax) * t + jx, ay + (by - ay) * t + jy);
    }
  }
  return pts;
}

/** Random point roughly inside the hex footprint. */
function insideFootprint(rng: () => number, shrink = 0.92): [number, number] {
  for (let i = 0; i < 8; i++) {
    const x = (rng() * 2 - 1) * (FOOTPRINT_W / 2) * shrink;
    const y = (rng() * 2 - 1) * (FOOTPRINT_H / 2) * shrink;
    const nx = x / ((FOOTPRINT_W / 2) * shrink);
    const ny = y / ((FOOTPRINT_H / 2) * shrink);
    if (nx * nx + ny * ny <= 1) return [x, y];
  }
  return [0, 0];
}

/* ------------------------------------------------------------------ */
/* base tiles                                                          */

function paintSpeckle(g: Graphics, rng: () => number, base: number, count: number): void {
  for (let i = 0; i < count; i++) {
    const [x, y] = insideFootprint(rng);
    const r = 3 + rng() * 7;
    const dark = rng() < 0.5;
    g.ellipse(x, y, r, r * 0.62).fill({
      color: dark ? darken(base, 0.08 + rng() * 0.1) : lighten(base, 0.06 + rng() * 0.1),
      alpha: 0.05 + rng() * 0.08,
    });
  }
}

/** Skirt connecting the lower footprint corners down to ground level. */
function paintSkirt(g: Graphics, skirt: number, shade: number, grow: number): void {
  const c = artHexCorners(grow);
  g.poly([
    c[1][0], c[1][1],
    c[2][0], c[2][1],
    c[3][0], c[3][1],
    c[3][0], c[3][1] + skirt,
    c[2][0], c[2][1] + skirt,
    c[1][0], c[1][1] + skirt,
  ]).fill(verticalGradient(shade, darken(shade, 0.35)));
}

function paintBaseTile(g: Graphics, code: TerrainCode, rng: () => number): void {
  const base = TERRAIN_COLORS[code];
  const grow = 8 + rng() * 6;

  if (code === 'm') paintSkirt(g, SKIRT_PX.m, MOUNTAIN_SHADE, grow * 0.75);
  if (code === 'h') paintSkirt(g, SKIRT_PX.h, HILL_SHADE, grow * 0.75);

  g.poly(irregularHexPoints(rng, grow)).fill(
    verticalGradient(lighten(base, 0.1), darken(base, 0.14)),
  );
  paintSpeckle(g, rng, base, code === 'D' || code === 's' ? 24 : 46);

  if (code === 'D') {
    // Faint deep-water patches.
    for (let i = 0; i < 4; i++) {
      const [x, y] = insideFootprint(rng, 0.7);
      g.ellipse(x, y, 30 + rng() * 40, 16 + rng() * 20).fill({
        color: darken(base, 0.22),
        alpha: 0.12,
      });
    }
  } else if (code === 's') {
    // Foam rim just inside the tile edge plus a few ripples.
    g.poly(irregularHexPoints(rng, -10)).stroke({
      width: 7,
      color: lighten(SEA_RIPPLE, 0.3),
      alpha: 0.16,
    });
    for (let i = 0; i < 4; i++) {
      const [x, y] = insideFootprint(rng, 0.65);
      const w = 24 + rng() * 22;
      g.beginPath();
      g.moveTo(x - w, y).quadraticCurveTo(x, y - 10 - rng() * 8, x + w, y).stroke({
        width: 3,
        color: lighten(SEA_RIPPLE, 0.35),
        alpha: 0.35,
      });
      g.beginPath();
    }
  } else if (code === 'd') {
    // Dune crescents: dark windward stroke with a lit crest above.
    for (let i = 0; i < 6; i++) {
      const [x, y] = insideFootprint(rng, 0.72);
      const w = 26 + rng() * 26;
      const lift = 8 + rng() * 8;
      g.beginPath();
      g.moveTo(x - w, y).quadraticCurveTo(x, y - lift, x + w, y).stroke({
        width: 4,
        color: darken(base, 0.2),
        alpha: 0.4,
      });
      g.beginPath();
      g.moveTo(x - w, y - 3).quadraticCurveTo(x, y - lift - 3, x + w, y - 3).stroke({
        width: 2.5,
        color: lighten(base, 0.22),
        alpha: 0.5,
      });
      g.beginPath();
    }
  } else if (code === 'g') {
    // Meadow blotches.
    for (let i = 0; i < 5; i++) {
      const [x, y] = insideFootprint(rng, 0.75);
      g.ellipse(x, y, 22 + rng() * 26, 12 + rng() * 14).fill({
        color: rng() < 0.5 ? darken(base, 0.14) : lighten(base, 0.12),
        alpha: 0.14,
      });
    }
  } else if (code === 'p') {
    // Dry-grass streaks.
    for (let i = 0; i < 8; i++) {
      const [x, y] = insideFootprint(rng, 0.78);
      const w = 20 + rng() * 30;
      g.beginPath();
      g.moveTo(x - w, y).lineTo(x + w, y + (rng() - 0.5) * 6).stroke({
        width: 2.5,
        color: rng() < 0.6 ? darken(base, 0.16) : lighten(base, 0.14),
        alpha: 0.22,
      });
      g.beginPath();
    }
  } else if (code === 'm') {
    // Rock cracks on the top face.
    for (let i = 0; i < 7; i++) {
      const [x, y] = insideFootprint(rng, 0.7);
      const dx = (rng() - 0.5) * 44;
      const dy = (rng() - 0.5) * 26;
      g.beginPath();
      g.moveTo(x, y).lineTo(x + dx, y + dy).stroke({
        width: 2.5,
        color: darken(base, 0.3),
        alpha: 0.3,
      });
      g.beginPath();
    }
  } else if (code === 'h') {
    // Subtle mound shading on the base; the mound art itself is a feature.
    for (let i = 0; i < 3; i++) {
      const [x, y] = insideFootprint(rng, 0.6);
      g.ellipse(x, y, 34 + rng() * 22, 16 + rng() * 10).fill({
        color: darken(base, 0.12),
        alpha: 0.16,
      });
    }
  }
}

/* ------------------------------------------------------------------ */
/* feature overlays (drawn above the base tile, NW light)              */

function paintMountainFeature(g: Graphics, rng: () => number): void {
  const rock = TERRAIN_COLORS.m;
  const peaks = 2 + Math.floor(rng() * 2);
  for (let i = 0; i < peaks; i++) {
    const back = i < peaks - 1; // last peak painted frontmost
    const cx = (rng() - 0.5) * (back ? 130 : 60);
    const baseY = back ? 20 + rng() * 16 : 42 + rng() * 14;
    const h = (back ? 130 : 185) + rng() * 55;
    const w = (back ? 62 : 88) + rng() * 26;
    const apexX = cx + (rng() - 0.5) * 14;
    const apexY = baseY - h;
    const midX = cx + w * 0.08;

    // Lit (NW) face, then shadow (SE) face.
    g.poly([apexX, apexY, cx - w, baseY, midX, baseY]).fill(lighten(rock, back ? 0.06 : 0.16));
    g.poly([apexX, apexY, midX, baseY, cx + w, baseY]).fill(
      darken(MOUNTAIN_SHADE, back ? 0.18 : 0.08),
    );
    // Snow cap hugging the apex.
    const snowT = 0.24 + rng() * 0.08;
    g.poly([
      apexX, apexY,
      apexX - w * snowT, apexY + h * snowT,
      apexX - w * snowT * 0.3, apexY + h * snowT * 1.12,
      apexX + w * snowT * 0.9, apexY + h * snowT * 0.92,
    ]).fill(back ? mix(MOUNTAIN_SNOW, rock, 0.25) : MOUNTAIN_SNOW);
  }
}

function paintHillFeature(g: Graphics, rng: () => number): void {
  const hill = TERRAIN_COLORS.h;
  const mounds = 2 + Math.floor(rng() * 2);
  for (let i = 0; i < mounds; i++) {
    const cx = (rng() - 0.5) * 120;
    const cy = -6 - rng() * 22;
    const rx = 48 + rng() * 30;
    const ry = 24 + rng() * 12;
    g.ellipse(cx + 3, cy + 4, rx, ry).fill({ color: HILL_SHADE, alpha: 0.8 });
    g.ellipse(cx, cy, rx, ry).fill(
      verticalGradient(lighten(hill, 0.2), darken(hill, 0.06)),
    );
  }
}

function paintTreeFeature(g: Graphics, rng: () => number): void {
  const trees = 4 + Math.floor(rng() * 2);
  for (let i = 0; i < trees; i++) {
    const x = (rng() - 0.5) * 150;
    const y = -8 - rng() * 55;
    const r = 15 + rng() * 8;
    g.rect(x - 2.5, y - 4, 5, r + 10).fill(0x5a4630);
    g.circle(x, y - r * 0.55, r).fill(0x3f6b33);
    g.circle(x - r * 0.3, y - r * 0.75, r * 0.62).fill(0x4d7a3a);
  }
}

/* ------------------------------------------------------------------ */
/* assembly                                                            */

function buildFrameSpecs(): FrameSpec[] {
  const specs: FrameSpec[] = [];
  for (const code of Object.keys(BASE_VARIANTS) as TerrainCode[]) {
    for (let v = 0; v < BASE_VARIANTS[code]; v++) {
      specs.push({
        name: `base/${code}_${v}`,
        kind: baseKindFor(code),
        paint: (g, rng) => paintBaseTile(g, code, rng),
      });
    }
  }
  const featurePainters = {
    m: paintMountainFeature,
    h: paintHillFeature,
    tree: paintTreeFeature,
  } as const;
  for (const key of Object.keys(FEATURE_VARIANTS) as (keyof typeof FEATURE_VARIANTS)[]) {
    for (let v = 0; v < FEATURE_VARIANTS[key]; v++) {
      specs.push({ name: `feature/${key}_${v}`, kind: 'feature', paint: featurePainters[key] });
    }
  }
  // Tall frames first keeps shelf packing tight.
  const order: Record<FrameKind, number> = { mountain: 0, feature: 1, hill: 2, flat: 3 };
  return specs.sort((a, b) => order[a.kind] - order[b.kind] || a.name.localeCompare(b.name));
}

export function generateProceduralAtlas(renderer: Renderer): TerrainAtlas {
  const specs = buildFrameSpecs();
  const entries: AtlasEntry[] = specs.map((s) => ({
    name: s.name,
    w: CANVAS_SIZES[s.kind].w,
    h: CANVAS_SIZES[s.kind].h,
  }));
  const layout = computeAtlasLayout(entries);

  const scene = new Container();
  const frames: TerrainAtlasManifest['frames'] = {};
  for (const spec of specs) {
    const frame = layout.frames[spec.name];
    const anchor = ANCHORS[spec.kind];
    frames[spec.name] = {
      x: frame.x,
      y: frame.y,
      w: frame.w,
      h: frame.h,
      anchorX: anchor.x,
      anchorY: anchor.y,
    };
    const g = new Graphics();
    spec.paint(g, makeRng(seedOf(spec.name)));
    // Painters draw around the footprint center; place that at the anchor.
    g.position.set(frame.x + anchor.x * frame.w, frame.y + anchor.y * frame.h);
    scene.addChild(g);
  }

  const target = RenderTexture.create({
    width: layout.width,
    height: layout.height,
    antialias: true,
  });
  renderer.render({ container: scene, target });
  scene.destroy({ children: true });

  const manifest: TerrainAtlasManifest = {
    footprintWidth: FOOTPRINT_W,
    frames,
    base: {
      D: variantNames('D'),
      s: variantNames('s'),
      g: variantNames('g'),
      p: variantNames('p'),
      h: variantNames('h'),
      m: variantNames('m'),
      d: variantNames('d'),
    },
    features: {
      m: featureNames('m'),
      h: featureNames('h'),
      tree: featureNames('tree'),
    },
  };
  return createTerrainAtlas(manifest, target.source);
}

function variantNames(code: TerrainCode): string[] {
  return Array.from({ length: BASE_VARIANTS[code] }, (_, v) => `base/${code}_${v}`);
}

function featureNames(key: keyof typeof FEATURE_VARIANTS): string[] {
  return Array.from({ length: FEATURE_VARIANTS[key] }, (_, v) => `feature/${key}_${v}`);
}
