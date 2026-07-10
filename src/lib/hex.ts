/**
 * Hex grid math for the isometric tile map.
 *
 * Grid: pointy-top hexagons in "odd-r" offset coordinates (odd rows shifted
 * right by half a hex). World space is a flat 2D plane; the isometric look is
 * applied at render time by squashing world Y by ISO_SQUASH.
 *
 * Geographic mapping: the map bbox (plate carrée) is stretched onto the full
 * grid extent. The map is stylized, not a precise projection.
 */

export const LON_MIN = -12;
export const LON_MAX = 60;
export const LAT_MIN = 24;
export const LAT_MAX = 59;

export const COLS = 90;
export const ROWS = 56;

export const HEX_SIZE = 12;
export const HEX_W = Math.sqrt(3) * HEX_SIZE;
export const HEX_H = 2 * HEX_SIZE;
export const ROW_STEP = 1.5 * HEX_SIZE;

/** Vertical squash applied at render time for the 45° god view. */
export const ISO_SQUASH = 0.62;

export const WORLD_W = HEX_W * (COLS + 0.5);
export const WORLD_H = ROW_STEP * (ROWS - 1) + HEX_H;

export interface TileCoord {
  col: number;
  row: number;
}

export function tileId(col: number, row: number): string {
  return `${col},${row}`;
}

export function parseTileId(id: string): TileCoord {
  const [col, row] = id.split(',').map(Number);
  return { col, row };
}

export function inGrid(col: number, row: number): boolean {
  return col >= 0 && col < COLS && row >= 0 && row < ROWS;
}

/** World-space center of a tile (pre-isometric). */
export function tileCenterWorld(col: number, row: number): { x: number; y: number } {
  const x = HEX_W * (col + 0.5 + (row % 2 === 1 ? 0.5 : 0));
  const y = HEX_SIZE + ROW_STEP * row;
  return { x, y };
}

export function lonLatToWorld(lon: number, lat: number): { x: number; y: number } {
  const x = ((lon - LON_MIN) / (LON_MAX - LON_MIN)) * WORLD_W;
  const y = ((LAT_MAX - lat) / (LAT_MAX - LAT_MIN)) * WORLD_H;
  return { x, y };
}

export function worldToLonLat(x: number, y: number): { lon: number; lat: number } {
  const lon = LON_MIN + (x / WORLD_W) * (LON_MAX - LON_MIN);
  const lat = LAT_MAX - (y / WORLD_H) * (LAT_MAX - LAT_MIN);
  return { lon, lat };
}

export function tileCenterLonLat(col: number, row: number): { lon: number; lat: number } {
  const { x, y } = tileCenterWorld(col, row);
  return worldToLonLat(x, y);
}

/** Nearest tile to a lon/lat point (approximate; exact enough for markers). */
export function lonLatToTile(lon: number, lat: number): TileCoord {
  const { x, y } = lonLatToWorld(lon, lat);
  const row = Math.max(0, Math.min(ROWS - 1, Math.round((y - HEX_SIZE) / ROW_STEP)));
  const offset = row % 2 === 1 ? 0.5 : 0;
  const col = Math.max(0, Math.min(COLS - 1, Math.round(x / HEX_W - 0.5 - offset)));
  return { col, row };
}

/** Corners of a pointy-top hex centered at (cx, cy), world space. */
export function hexCorners(cx: number, cy: number, size: number = HEX_SIZE): [number, number][] {
  const corners: [number, number][] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 30);
    corners.push([cx + size * Math.cos(angle), cy + size * Math.sin(angle)]);
  }
  return corners;
}

/** Neighbor coordinates in odd-r offset layout. */
export function neighbors(col: number, row: number): TileCoord[] {
  const odd = row % 2 === 1;
  const deltas: [number, number][] = odd
    ? [[1, 0], [-1, 0], [0, -1], [1, -1], [0, 1], [1, 1]]
    : [[1, 0], [-1, 0], [-1, -1], [0, -1], [-1, 1], [0, 1]];
  return deltas
    .map(([dc, dr]) => ({ col: col + dc, row: row + dr }))
    .filter((t) => inGrid(t.col, t.row));
}
