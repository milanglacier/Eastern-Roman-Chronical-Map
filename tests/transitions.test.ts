import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CANVAS_SIZES,
  TRANS_BAND,
  TRANS_OUT,
  transitionGeometry,
  hashStringSeed,
  mulberry32,
} from '../src/map/renderer/atlasLayout';
import { BLEND_PRIORITY, isLandTile, terrainAt, transitionsFor } from '../src/map/renderer/terrain';
import { TerrainAtlasManifestSchema, validateFrameRefs } from '../src/map/renderer/atlas';
import { tiles } from '../src/data';
import { inGrid } from '../src/lib/hex';
import { edgeNeighbor } from '../src/map/iso';

const TERRAIN_CODES = ['D', 's', 'g', 'p', 'h', 'm', 'd'] as const;
const FEATURE_KINDS = ['m', 'h', 'tree'] as const;

describe('transitionsFor (full-map scan)', () => {
  it('emits only valid, m-free, priority-increasing overlays and enough of them', () => {
    let count = 0;
    for (let row = 0; row < tiles.rows; row++) {
      for (let col = 0; col < tiles.cols; col++) {
        const own = terrainAt(col, row);
        for (const tr of transitionsFor(col, row)) {
          count++;
          expect(tr.edge).toBeGreaterThanOrEqual(0);
          expect(tr.edge).toBeLessThan(6);
          // m never blends, on either side of the edge.
          expect(own).not.toBe('m');
          expect(tr.code).not.toBe('m');
          // The invader strictly outranks the receiver.
          expect(BLEND_PRIORITY[tr.code]!).toBeGreaterThan(BLEND_PRIORITY[own]!);
          // Narrow-channel guard: no land strip onto a water tile whose
          // opposite shore is land too (would bridge one-tile straits).
          if (!isLandTile(own) && isLandTile(tr.code)) {
            const opp = edgeNeighbor(col, row, (tr.edge + 3) % 6);
            const oppLand = inGrid(opp.col, opp.row) && isLandTile(terrainAt(opp.col, opp.row));
            expect(oppLand, `land strip over strait at ${col},${row} edge ${tr.edge}`).toBe(false);
          }
        }
      }
    }
    // Boundary census on the real map found ~3,550 overlay edges.
    expect(count).toBeGreaterThan(3000);
  });

  it('is deterministic', () => {
    for (const [col, row] of [
      [0, 0],
      [45, 28],
      [89, 55],
      [30, 10],
      [70, 40],
    ]) {
      expect(transitionsFor(col, row)).toEqual(transitionsFor(col, row));
    }
  });
});

describe('transitionGeometry', () => {
  const { w: cw, h: ch } = CANVAS_SIZES.flat;

  it('keeps every crop inside the flat canvas', () => {
    for (let edge = 0; edge < 6; edge++) {
      const { crop } = transitionGeometry(edge);
      expect(crop.x).toBeGreaterThanOrEqual(0);
      expect(crop.y).toBeGreaterThanOrEqual(0);
      expect(crop.x + crop.w).toBeLessThanOrEqual(cw);
      expect(crop.y + crop.h).toBeLessThanOrEqual(ch);
      // The crop must at least contain the band depth.
      expect(Math.max(crop.w, crop.h)).toBeGreaterThan(TRANS_BAND + TRANS_OUT);
    }
  });

  it('produces unit-length outward normals', () => {
    for (let edge = 0; edge < 6; edge++) {
      const { a, b, normal } = transitionGeometry(edge);
      expect(Math.hypot(normal[0], normal[1])).toBeCloseTo(1, 6);
      // Outward: the normal points away from the footprint center (144,112).
      const mid = [(a[0] + b[0]) / 2 - cw / 2, (a[1] + b[1]) / 2 - ch / 2];
      expect(normal[0] * mid[0] + normal[1] * mid[1]).toBeGreaterThan(0);
    }
  });

  it('anchors every strip back at the footprint center', () => {
    for (let edge = 0; edge < 6; edge++) {
      const { crop, anchorX, anchorY } = transitionGeometry(edge);
      expect(crop.x + anchorX * crop.w).toBeCloseTo(cw / 2, 6);
      expect(crop.y + anchorY * crop.h).toBeCloseTo(ch / 2, 6);
    }
  });

  it('is deterministic and yields deterministic PRNG streams', () => {
    for (let edge = 0; edge < 6; edge++) {
      expect(transitionGeometry(edge)).toEqual(transitionGeometry(edge));
    }
    const a = mulberry32(hashStringSeed('trans/g_0'));
    const b = mulberry32(hashStringSeed('trans/g_0'));
    for (let i = 0; i < 16; i++) expect(a()).toBe(b());
  });
});

describe('manifest schema with transitions', () => {
  const frame = { x: 0, y: 0, w: 10, h: 10, anchorX: 0.5, anchorY: 0.5 };

  function minimalManifest() {
    const frames: Record<string, typeof frame> = {};
    const base: Record<string, string[]> = {};
    for (const c of TERRAIN_CODES) {
      frames[`base/${c}_0`] = { ...frame };
      base[c] = [`base/${c}_0`];
    }
    const features: Record<string, string[]> = {};
    for (const k of FEATURE_KINDS) {
      frames[`feature/${k}_0`] = { ...frame };
      features[k] = [`feature/${k}_0`];
    }
    return { footprintWidth: 256, frames, base, features };
  }

  function withTransitions() {
    const m = minimalManifest() as ReturnType<typeof minimalManifest> & {
      transitions: Record<string, string[]>;
    };
    const names = Array.from({ length: 6 }, (_, e) => `trans/g_${e}`);
    for (const n of names) {
      // Tight edge crops: the receiver-center anchor may exit [0,1].
      m.frames[n] = { ...frame, anchorX: -0.44, anchorY: 0.5 };
    }
    m.transitions = { g: names };
    return m;
  }

  it('parses a manifest without transitions (old atlases stay valid)', () => {
    const parsed = TerrainAtlasManifestSchema.parse(minimalManifest());
    expect(parsed.transitions).toBeUndefined();
    expect(() => validateFrameRefs(parsed)).not.toThrow();
  });

  it('parses a valid 6-strip transitions record with out-of-[0,1] anchors', () => {
    const parsed = TerrainAtlasManifestSchema.parse(withTransitions());
    expect(parsed.transitions!.g).toHaveLength(6);
    expect(parsed.frames['trans/g_0'].anchorX).toBe(-0.44);
    expect(() => validateFrameRefs(parsed)).not.toThrow();
  });

  it('rejects a transitions entry that is not exactly 6 frames', () => {
    const bad = withTransitions();
    bad.transitions.g = bad.transitions.g.slice(0, 5);
    expect(TerrainAtlasManifestSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects dangling transition frame refs', () => {
    const m = TerrainAtlasManifestSchema.parse(withTransitions());
    delete m.frames['trans/g_3'];
    expect(() => validateFrameRefs(m)).toThrow(/trans\/g_3/);
  });
});

describe('committed atlas manifest', () => {
  const path = join(__dirname, '..', 'public', 'terrain', 'atlas.json');

  it.skipIf(!existsSync(path))('parses and has no dangling frame refs', () => {
    const manifest = TerrainAtlasManifestSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
    expect(() => validateFrameRefs(manifest)).not.toThrow();
  });
});
