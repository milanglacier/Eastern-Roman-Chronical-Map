/**
 * Pure terrain-data helpers. Rendering lives in terrainSprites.ts
 * (sprite atlas pipeline) — keep this module free of pixi.js imports.
 */
import { tiles } from '../../data';
import type { TerrainCode } from '../../data/schema';
import { inGrid } from '../../lib/hex';
import { edgeNeighbor } from '../iso';

export function terrainAt(col: number, row: number): TerrainCode {
  return tiles.terrain[row * tiles.cols + col] as TerrainCode;
}

/**
 * Cross-terrain blend priority: across a shared edge the higher-priority
 * code "invades" the lower one with a baked transition strip. `m` is
 * excluded entirely — its crisp cliff IS the transition.
 */
export const BLEND_PRIORITY: Partial<Record<TerrainCode, number>> = {
  g: 6,
  p: 5,
  d: 4,
  h: 3,
  s: 2,
  D: 1,
};

export interface TileTransition {
  /** Hex edge 0..5 (E,SE,SW,W,NW,NE) of the receiving tile. */
  edge: number;
  /** Terrain code of the invading neighbor (the strip's source art). */
  code: TerrainCode;
}

/** Transition overlays the tile at (col,row) receives from its neighbors. */
export function transitionsFor(col: number, row: number): TileTransition[] {
  const ownCode = terrainAt(col, row);
  const own = BLEND_PRIORITY[ownCode];
  if (own === undefined) return [];
  const out: TileTransition[] = [];
  for (let edge = 0; edge < 6; edge++) {
    const n = edgeNeighbor(col, row, edge);
    if (!inGrid(n.col, n.row)) continue;
    const code = terrainAt(n.col, n.row);
    const pri = BLEND_PRIORITY[code];
    if (pri === undefined || pri <= own) continue;
    // Narrow-channel guard: a water tile refuses a land strip when the
    // OPPOSITE shore is land too, so one-tile straits (Gibraltar, the
    // Bosporus, Kerch…) are not beach-invaded from both banks into a
    // visual land bridge.
    if (!isLandTile(ownCode) && isLandTile(code)) {
      const opp = edgeNeighbor(col, row, (edge + 3) % 6);
      if (inGrid(opp.col, opp.row) && isLandTile(terrainAt(opp.col, opp.row))) continue;
    }
    out.push({ edge, code });
  }
  return out;
}

export function isLandTile(code: TerrainCode): boolean {
  return code !== 'D' && code !== 's';
}

/** Deterministic 0..1 hash per tile — variant picks, feature placement. */
export function hash01(col: number, row: number): number {
  let h = (col * 374761393 + row * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Deterministic variant index in [0, count) for a tile. */
export function variantIndex(count: number, col: number, row: number): number {
  return Math.min(count - 1, Math.floor(hash01(col, row) * count));
}
