/**
 * River rendering: smoothed polylines through tile centers, stroked in
 * layered passes — two wide low-alpha feather underlays (poor-man's blur;
 * no filter blend modes on this GL stack), dark bank, water channel, thin
 * highlight. The same path builder feeds the white river strokes of the
 * water shimmer mask.
 */
import { Graphics } from 'pixi.js';
import { tiles } from '../../data';
import { tileIsoCenter, type IsoPoint } from '../iso';
import { terrainAt } from './terrain';

const FEATHER_OUTER = { width: 6.0, color: 0x2c4a66, alpha: 0.15 };
const FEATHER_INNER = { width: 4.6, color: 0x2c4a66, alpha: 0.25 };
const BANK = { width: 3.4, color: 0x2c4a66, alpha: 0.85 };
const WATER = { width: 2.0, color: 0x3f6f9e, alpha: 1 };
const HIGHLIGHT = { width: 0.7, color: 0x7fa8cc, alpha: 0.7 };

interface StrokeStyle {
  width: number;
  color: number;
  alpha: number;
}

function riverPoints(path: [number, number][]): IsoPoint[] {
  // Elevation-aware so channels ride up onto hills/mountain valleys.
  return path.map(([col, row]) => tileIsoCenter(col, row, terrainAt(col, row)));
}

/** Quadratic midpoint smoothing: curve through each interior point. */
function traceSmoothPath(g: Graphics, pts: IsoPoint[]): void {
  g.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i].x + pts[i + 1].x) / 2;
    const my = (pts[i].y + pts[i + 1].y) / 2;
    g.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
  }
  const last = pts[pts.length - 1];
  g.lineTo(last.x, last.y);
}

/** Strokes every river once with the given style. */
export function strokeRivers(g: Graphics, style: StrokeStyle): Graphics {
  for (const river of tiles.rivers) {
    g.beginPath();
    traceSmoothPath(g, riverPoints(river.path));
    g.stroke({ ...style, cap: 'round', join: 'round' });
  }
  g.beginPath();
  return g;
}

export function buildRiversGraphics(): Graphics {
  const g = new Graphics();
  strokeRivers(g, FEATHER_OUTER);
  strokeRivers(g, FEATHER_INNER);
  strokeRivers(g, BANK);
  strokeRivers(g, WATER);
  strokeRivers(g, HIGHLIGHT);
  return g;
}

/** Strokes white river channels into the water shimmer mask Graphics. */
export function strokeRiversMask(g: Graphics): void {
  strokeRivers(g, { width: 2.4, color: 0xffffff, alpha: 1 });
}
