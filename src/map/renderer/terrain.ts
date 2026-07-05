/**
 * Pure terrain-data helpers. Rendering lives in terrainSprites.ts
 * (sprite atlas pipeline) — keep this module free of pixi.js imports.
 */
import { tiles } from '../../data';
import type { TerrainCode } from '../../data/schema';

export function terrainAt(col: number, row: number): TerrainCode {
  return tiles.terrain[row * tiles.cols + col] as TerrainCode;
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
