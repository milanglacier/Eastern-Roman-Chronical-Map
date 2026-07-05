import { Graphics } from 'pixi.js';
import { tiles, territories } from '../../data';
import type { TerrainCode } from '../../data/schema';
import { tileCenterLonLat, tileId, inGrid } from '../../lib/hex';
import { pointInGeometry } from '../../lib/geo';
import { ELEVATION, hexIsoCorners, edgeNeighbor } from '../iso';
import { terrainAt, isLandTile } from './terrain';
import {
  TERRITORY_FILL,
  TERRITORY_FILL_ALPHA,
  TERRITORY_BORDER,
  TERRITORY_BORDER_ALPHA,
} from '../colors';

const cache = new Map<number, Set<string>>();

/** Land tiles inside the territory polygon of a snapshot year. Memoized. */
export function territoryTiles(snapshotYear: number): Set<string> {
  const cached = cache.get(snapshotYear);
  if (cached) return cached;

  const geometry = territories.get(snapshotYear);
  const set = new Set<string>();
  if (geometry) {
    for (let row = 0; row < tiles.rows; row++) {
      for (let col = 0; col < tiles.cols; col++) {
        if (!isLandTile(terrainAt(col, row))) continue;
        const { lon, lat } = tileCenterLonLat(col, row);
        if (pointInGeometry(lon, lat, geometry)) set.add(tileId(col, row));
      }
    }
  }
  cache.set(snapshotYear, set);
  return set;
}

function toFlat(points: { x: number; y: number }[]): number[] {
  const flat: number[] = [];
  for (const p of points) flat.push(p.x, p.y);
  return flat;
}

/**
 * Purple tint over every imperial tile plus a gold border along edges facing
 * tiles outside the empire (Civ-style national border).
 */
export function buildTerritoryGraphics(snapshotYear: number): Graphics {
  const g = new Graphics();
  const set = territoryTiles(snapshotYear);

  for (const id of set) {
    const [col, row] = id.split(',').map(Number);
    const code = terrainAt(col, row) as TerrainCode;
    const corners = hexIsoCorners(col, row, ELEVATION[code]);
    g.poly(toFlat(corners)).fill({ color: TERRITORY_FILL, alpha: TERRITORY_FILL_ALPHA });
  }

  for (const id of set) {
    const [col, row] = id.split(',').map(Number);
    const code = terrainAt(col, row) as TerrainCode;
    const corners = hexIsoCorners(col, row, ELEVATION[code]);
    for (let edge = 0; edge < 6; edge++) {
      const n = edgeNeighbor(col, row, edge);
      const outside = !inGrid(n.col, n.row) || !set.has(tileId(n.col, n.row));
      if (outside) {
        const a = corners[edge];
        const b = corners[(edge + 1) % 6];
        g.beginPath();
        g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({
          width: 1.6,
          color: TERRITORY_BORDER,
          alpha: TERRITORY_BORDER_ALPHA,
        });
        g.beginPath();
      }
    }
  }

  return g;
}
