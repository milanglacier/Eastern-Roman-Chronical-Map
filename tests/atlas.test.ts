import { describe, it, expect } from 'vitest';
import {
  computeAtlasLayout,
  CANVAS_SIZES,
  ANCHORS,
  ART_PER_WORLD,
  FOOTPRINT_W,
  FOOTPRINT_H,
  artHexCorners,
  baseKindFor,
} from '../src/map/renderer/atlasLayout';
import { ELEVATION } from '../src/map/iso';
import { HEX_W, HEX_H, ISO_SQUASH } from '../src/lib/hex';
import { hash01, variantIndex } from '../src/map/renderer/terrain';

describe('computeAtlasLayout', () => {
  const entries = [
    { name: 'a', w: 288, h: 360 },
    { name: 'b', w: 288, h: 224 },
    { name: 'c', w: 288, h: 224 },
    { name: 'd', w: 288, h: 352 },
  ];

  it('places every entry within bounds without overlap', () => {
    const layout = computeAtlasLayout(entries, 640);
    expect(Object.keys(layout.frames)).toHaveLength(entries.length);
    const rects = Object.values(layout.frames);
    for (const r of rects) {
      expect(r.x + r.w).toBeLessThanOrEqual(layout.width);
      expect(r.y + r.h).toBeLessThanOrEqual(layout.height);
    }
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i];
        const b = rects[j];
        const overlap =
          a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlap, `frames ${i} and ${j} overlap`).toBe(false);
      }
    }
  });

  it('wraps onto a new shelf at maxWidth and is deterministic', () => {
    const layout = computeAtlasLayout(entries, 640);
    expect(layout.width).toBeLessThanOrEqual(640);
    // 288*2 + padding fits per shelf; four entries need two shelves.
    expect(layout.height).toBeGreaterThan(360);
    expect(computeAtlasLayout(entries, 640)).toEqual(layout);
  });
});

describe('art-space constants', () => {
  it('matches the footprint aspect to the iso-squashed hex', () => {
    // FOOTPRINT_W : FOOTPRINT_H ≈ HEX_W : HEX_H * ISO_SQUASH
    const artRatio = FOOTPRINT_W / FOOTPRINT_H;
    const worldRatio = HEX_W / (HEX_H * ISO_SQUASH);
    expect(Math.abs(artRatio - worldRatio)).toBeLessThan(0.01);
  });

  it('sizes mountain/hill skirts to the ELEVATION lift', () => {
    const mSkirt = CANVAS_SIZES.mountain.h - CANVAS_SIZES.flat.h;
    const hSkirt = CANVAS_SIZES.hill.h - CANVAS_SIZES.flat.h;
    expect(Math.abs(mSkirt - ELEVATION.m * ART_PER_WORLD)).toBeLessThanOrEqual(1);
    expect(Math.abs(hSkirt - ELEVATION.h * ART_PER_WORLD)).toBeLessThanOrEqual(1);
  });

  it('anchors every kind at the footprint center', () => {
    // Flat/hill/mountain share the same absolute anchor Y (footprint center
    // sits at the same px from the top; extra height extends downward).
    const flatY = ANCHORS.flat.y * CANVAS_SIZES.flat.h;
    expect(ANCHORS.hill.y * CANVAS_SIZES.hill.h).toBeCloseTo(flatY, 5);
    expect(ANCHORS.mountain.y * CANVAS_SIZES.mountain.h).toBeCloseTo(flatY, 5);
    // Feature frames keep the flat-tile box at the bottom (headroom above).
    const featY = ANCHORS.feature.y * CANVAS_SIZES.feature.h;
    expect(CANVAS_SIZES.feature.h - featY).toBeCloseTo(CANVAS_SIZES.flat.h - flatY, 5);
  });

  it('spans the footprint with the art hex corners', () => {
    const xs = artHexCorners().map(([x]) => x);
    const ys = artHexCorners().map(([, y]) => y);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(FOOTPRINT_W, 0);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(FOOTPRINT_H, 0);
  });

  it('maps terrain codes to frame kinds', () => {
    expect(baseKindFor('m')).toBe('mountain');
    expect(baseKindFor('h')).toBe('hill');
    for (const code of ['D', 's', 'g', 'p', 'd']) expect(baseKindFor(code)).toBe('flat');
  });
});

describe('deterministic variant picks', () => {
  it('is stable and in range for every tile', () => {
    for (let row = 0; row < 56; row += 7) {
      for (let col = 0; col < 90; col += 9) {
        expect(hash01(col, row)).toBe(hash01(col, row));
        for (const count of [2, 3]) {
          const v = variantIndex(count, col, row);
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThan(count);
          expect(variantIndex(count, col, row)).toBe(v);
        }
      }
    }
  });
});
