/**
 * Pure atlas-layout math and art-space constants, shared by the runtime
 * procedural atlas, the offline art-processing script, and unit tests.
 * Keep this module free of pixi.js imports so Node scripts can consume it.
 *
 * Art convention: the isometric squash is baked into the art. A tile's hex
 * footprint is FOOTPRINT_W x FOOTPRINT_H art px (matching HEX_W : HEX_H*0.62
 * in world space); art may bleed up to BLEED px past the footprint so
 * neighboring tiles overlap softly. Mountain/hill base frames extend below
 * the footprint with a southern "skirt" matching their ELEVATION lift.
 */
// Explicit .ts extensions keep this import chain runnable under plain Node
// (type stripping) for scripts/process-terrain-art.mjs.
import { HEX_W } from '../../lib/hex.ts';
import { ELEVATION } from '../iso.ts';

/** Hex footprint width in art px (flat-to-flat of the pointy-top hex). */
export const FOOTPRINT_W = 256;
/** Iso-squashed footprint height in art px (~ FOOTPRINT_W * 2/sqrt(3) * 0.62). */
export const FOOTPRINT_H = 183;
/** Max art px a flat tile may bleed past the footprint on each side. */
export const BLEED = 16;

/** Art px per world px: FOOTPRINT_W maps onto HEX_W at render time. */
export const ART_PER_WORLD = FOOTPRINT_W / HEX_W;

/** Southern skirt height (art px) below the footprint for raised terrain. */
export const SKIRT_PX = {
  m: Math.ceil(ELEVATION.m * ART_PER_WORLD),
  h: Math.ceil(ELEVATION.h * ART_PER_WORLD),
} as const;

export type FrameKind = 'flat' | 'hill' | 'mountain' | 'feature';

const FLAT_W = FOOTPRINT_W + 2 * BLEED; // 288
const FLAT_H = 224; // footprint + generous vertical bleed, centered

/** Canvas size in art px for each frame kind. */
export const CANVAS_SIZES: Record<FrameKind, { w: number; h: number }> = {
  flat: { w: FLAT_W, h: FLAT_H },
  hill: { w: FLAT_W, h: FLAT_H + SKIRT_PX.h },
  mountain: { w: FLAT_W, h: FLAT_H + SKIRT_PX.m },
  feature: { w: FLAT_W, h: 352 },
};

/**
 * Normalized anchor (position of the hex footprint center inside the frame).
 * Flat tiles center the footprint; hill/mountain add the skirt below it;
 * feature frames keep the flat-tile box at the bottom with headroom above.
 */
export const ANCHORS: Record<FrameKind, { x: number; y: number }> = {
  flat: { x: 0.5, y: (FLAT_H / 2) / FLAT_H },
  hill: { x: 0.5, y: (FLAT_H / 2) / CANVAS_SIZES.hill.h },
  mountain: { x: 0.5, y: (FLAT_H / 2) / CANVAS_SIZES.mountain.h },
  feature: { x: 0.5, y: (CANVAS_SIZES.feature.h - FLAT_H / 2) / CANVAS_SIZES.feature.h },
};

/** Frame kind for a base tile of the given terrain code. */
export function baseKindFor(code: string): FrameKind {
  return code === 'm' ? 'mountain' : code === 'h' ? 'hill' : 'flat';
}

export interface AtlasEntry {
  name: string;
  w: number;
  h: number;
}

export interface LayoutFrame {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface AtlasLayout {
  width: number;
  height: number;
  frames: Record<string, LayoutFrame>;
}

/** Shelf-packs entries left-to-right, wrapping at maxWidth. Deterministic. */
export function computeAtlasLayout(
  entries: AtlasEntry[],
  maxWidth = 2048,
  padding = 2,
): AtlasLayout {
  const frames: Record<string, LayoutFrame> = {};
  let x = 0;
  let y = 0;
  let shelfH = 0;
  let width = 0;

  for (const e of entries) {
    if (x > 0 && x + e.w > maxWidth) {
      x = 0;
      y += shelfH + padding;
      shelfH = 0;
    }
    frames[e.name] = { x, y, w: e.w, h: e.h };
    x += e.w + padding;
    shelfH = Math.max(shelfH, e.h);
    width = Math.max(width, x - padding);
  }

  return { width, height: y + shelfH, frames };
}

/**
 * Corners of the squashed hex footprint in art px around the footprint
 * center, optionally grown radially by `grow` px. Same corner order as
 * hexIsoCorners: 0 NE, 1 SE, 2 S, 3 SW, 4 NW, 5 N.
 */
export function artHexCorners(grow = 0): [number, number][] {
  const rx = FOOTPRINT_W / Math.sqrt(3) + grow;
  const ry = (FOOTPRINT_H / 2) * (1 + grow / (FOOTPRINT_W / Math.sqrt(3)));
  const corners: [number, number][] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 30);
    corners.push([rx * Math.cos(a), ry * Math.sin(a)]);
  }
  return corners;
}
