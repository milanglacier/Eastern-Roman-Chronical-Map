// .ts extension keeps this module importable from plain Node scripts.
import { ISO_SQUASH, tileCenterWorld, hexCorners, lonLatToWorld, HEX_SIZE } from '../lib/hex.ts';
import type { TerrainCode } from '../data/schema';

/** Vertical lift (screen px, pre-camera) for raised terrain. */
export const ELEVATION: Record<TerrainCode, number> = {
  D: 0,
  s: 0,
  g: 0,
  p: 0,
  h: 5,
  m: 11,
  d: 0,
};

export interface IsoPoint {
  x: number;
  y: number;
}

/** Project a world point onto the squashed isometric plane. */
export function isoProject(x: number, y: number, elevation = 0): IsoPoint {
  return { x, y: y * ISO_SQUASH - elevation };
}

/** Screen-plane center of a tile including its terrain elevation. */
export function tileIsoCenter(col: number, row: number, terrain: TerrainCode): IsoPoint {
  const { x, y } = tileCenterWorld(col, row);
  return isoProject(x, y, ELEVATION[terrain]);
}

/**
 * Hex corners projected to the iso plane at a given elevation.
 * Corner order (pointy-top): 0 NE, 1 SE, 2 S, 3 SW, 4 NW, 5 N.
 */
export function hexIsoCorners(
  col: number,
  row: number,
  elevation: number,
  size = HEX_SIZE,
): IsoPoint[] {
  const { x, y } = tileCenterWorld(col, row);
  return hexCorners(x, y, size).map(([cx, cy]) => isoProject(cx, cy, elevation));
}

/** Iso position for a geographic coordinate (markers, cities). */
export function lonLatToIso(lon: number, lat: number): IsoPoint {
  const { x, y } = lonLatToWorld(lon, lat);
  return isoProject(x, y);
}

/**
 * Edge index (between corner i and i+1) facing each odd-r neighbor direction.
 * Order matches cornerEdgeNeighbors() results.
 */
export type Direction = 'E' | 'SE' | 'SW' | 'W' | 'NW' | 'NE';

const EDGE_TO_DIR: Direction[] = ['E', 'SE', 'SW', 'W', 'NW', 'NE'];

export function neighborOf(col: number, row: number, dir: Direction): { col: number; row: number } {
  const odd = row % 2 === 1;
  switch (dir) {
    case 'E':
      return { col: col + 1, row };
    case 'W':
      return { col: col - 1, row };
    case 'NE':
      return { col: odd ? col + 1 : col, row: row - 1 };
    case 'NW':
      return { col: odd ? col : col - 1, row: row - 1 };
    case 'SE':
      return { col: odd ? col + 1 : col, row: row + 1 };
    case 'SW':
      return { col: odd ? col : col - 1, row: row + 1 };
  }
}

/** For each hex edge i (corners i → i+1), the neighbor across that edge. */
export function edgeNeighbor(col: number, row: number, edge: number): { col: number; row: number } {
  return neighborOf(col, row, EDGE_TO_DIR[edge]);
}
