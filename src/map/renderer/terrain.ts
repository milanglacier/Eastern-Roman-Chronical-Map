import { Graphics } from 'pixi.js';
import { tiles } from '../../data';
import type { TerrainCode } from '../../data/schema';
import { HEX_SIZE } from '../../lib/hex';
import { ELEVATION, hexIsoCorners, tileIsoCenter } from '../iso';
import {
  TERRAIN_COLORS,
  MOUNTAIN_SNOW,
  MOUNTAIN_SHADE,
  HILL_SHADE,
  SEA_RIPPLE,
  TILE_EDGE,
} from '../colors';

export function terrainAt(col: number, row: number): TerrainCode {
  return tiles.terrain[row * tiles.cols + col] as TerrainCode;
}

export function isLandTile(code: TerrainCode): boolean {
  return code !== 'D' && code !== 's';
}

function hash01(col: number, row: number): number {
  let h = (col * 374761393 + row * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function toFlat(points: { x: number; y: number }[]): number[] {
  const flat: number[] = [];
  for (const p of points) flat.push(p.x, p.y);
  return flat;
}

/**
 * Draws the full static terrain into one Graphics. Rows are drawn top to
 * bottom so southern tiles overlap the extruded skirts of northern ones.
 */
export function buildTerrainGraphics(): Graphics {
  const g = new Graphics();

  for (let row = 0; row < tiles.rows; row++) {
    for (let col = 0; col < tiles.cols; col++) {
      const code = terrainAt(col, row);
      const elev = ELEVATION[code];
      const corners = hexIsoCorners(col, row, elev);
      const color = TERRAIN_COLORS[code];

      if (elev > 0) {
        // Skirt: connect the three lower corners (SE=1, S=2, SW=3) to ground level.
        const skirt = [
          corners[1],
          corners[2],
          corners[3],
          { x: corners[3].x, y: corners[3].y + elev },
          { x: corners[2].x, y: corners[2].y + elev },
          { x: corners[1].x, y: corners[1].y + elev },
        ];
        g.poly(toFlat(skirt)).fill(code === 'm' ? MOUNTAIN_SHADE : HILL_SHADE);
      }

      g.poly(toFlat(corners)).fill(color).stroke({ width: 0.6, color: TILE_EDGE, alpha: 0.22 });

      const c = tileIsoCenter(col, row, code);
      const r = hash01(col, row);

      if (code === 'm') {
        // Peak with snow cap.
        const w = HEX_SIZE * 0.85;
        const peakH = HEX_SIZE * (1.0 + r * 0.35);
        g.poly([c.x - w * 0.55, c.y + w * 0.3, c.x, c.y - peakH * 0.55, c.x + w * 0.55, c.y + w * 0.3])
          .fill(MOUNTAIN_SHADE);
        g.poly([c.x - w * 0.22, c.y - peakH * 0.18, c.x, c.y - peakH * 0.55, c.x + w * 0.22, c.y - peakH * 0.18])
          .fill(MOUNTAIN_SNOW);
      } else if (code === 'h') {
        // Two soft mounds.
        g.ellipse(c.x - HEX_SIZE * 0.28, c.y + 1, HEX_SIZE * 0.34, HEX_SIZE * 0.2).fill({
          color: HILL_SHADE,
          alpha: 0.75,
        });
        g.ellipse(c.x + HEX_SIZE * 0.3, c.y - 1.5, HEX_SIZE * 0.28, HEX_SIZE * 0.17).fill({
          color: HILL_SHADE,
          alpha: 0.6,
        });
      } else if ((code === 'D' || code === 's') && r < 0.18) {
        // Sparse wave strokes. beginPath keeps segments from chaining into streaks.
        g.beginPath();
        g.moveTo(c.x - 3.5, c.y).quadraticCurveTo(c.x, c.y - 2.2, c.x + 3.5, c.y).stroke({
          width: 0.8,
          color: SEA_RIPPLE,
          alpha: 0.8,
        });
        g.beginPath();
      } else if (code === 'd' && r < 0.25) {
        // Dune ticks.
        g.beginPath();
        g.moveTo(c.x - 3, c.y + 1).quadraticCurveTo(c.x, c.y - 1.2, c.x + 3, c.y + 1).stroke({
          width: 0.7,
          color: 0xb89f63,
          alpha: 0.9,
        });
        g.beginPath();
      } else if (code === 'g' && r > 0.82) {
        // Tiny tree: trunk + canopy.
        g.rect(c.x - 0.5, c.y - 1, 1, 3).fill(0x5a4630);
        g.circle(c.x, c.y - 3, 2.4).fill(0x4d7a3a);
      }
    }
  }

  return g;
}
