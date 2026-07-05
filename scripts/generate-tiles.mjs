/**
 * Generates src/data/tiles.json — the terrain classification for every hex
 * tile — from the clipped coastline plus hand-authored terrain-config.json.
 *
 * Terrain codes (1 char per tile, row-major string):
 *   D deep sea   s shallow sea/coast   g grassland   p plains
 *   h hills      m mountain            d desert
 *
 * Classification order per land tile: mountains/hills (polyline buffers) win;
 * then green corridors (fertile strips inside deserts); then regions
 * (desert/plains/grass polygons); otherwise latitude + hash mix of grass/plains.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COLS, ROWS, tileCenterLonLat } from '../src/lib/hex.ts';
import { pointInMultiPolygon, pointInRing, nearPolyline } from '../src/lib/geo.ts';

const dir = dirname(fileURLToPath(import.meta.url));
const coastline = JSON.parse(await readFile(join(dir, 'assets', 'coastline-50m.json'), 'utf8'));
const config = JSON.parse(await readFile(join(dir, 'assets', 'terrain-config.json'), 'utf8'));

/** Deterministic 0..1 hash for grass/plains variety. */
function hash01(col, row) {
  let h = (col * 374761393 + row * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function classifyLand(lon, lat, col, row) {
  for (const range of config.mountainRanges) {
    if (nearPolyline(lon, lat, range.line, range.buffer)) return 'm';
  }
  for (const range of config.mountainRanges) {
    if (nearPolyline(lon, lat, range.line, range.buffer * config.hillFactor)) return 'h';
  }
  for (const corridor of config.greenCorridors) {
    if (nearPolyline(lon, lat, corridor.line, corridor.buffer)) return 'g';
  }
  for (const region of config.regions) {
    if (pointInRing(lon, lat, region.polygon)) {
      return { desert: 'd', plains: 'p', grass: 'g' }[region.terrain];
    }
  }
  if (lat >= 44) return hash01(col, row) < 0.75 ? 'g' : 'p';
  if (lat >= 37) return hash01(col, row) < 0.55 ? 'g' : 'p';
  return hash01(col, row) < 0.35 ? 'g' : 'p';
}

// Pass 1: land vs water at each tile center.
const land = new Array(COLS * ROWS).fill(false);
for (let row = 0; row < ROWS; row++) {
  for (let col = 0; col < COLS; col++) {
    const { lon, lat } = tileCenterLonLat(col, row);
    land[row * COLS + col] = pointInMultiPolygon(lon, lat, coastline.coordinates);
  }
}

const isLand = (col, row) =>
  col >= 0 && col < COLS && row >= 0 && row < ROWS && land[row * COLS + col];

/** Any land tile within `radius` grid steps (cheap box approximation). */
function landNearby(col, row, radius) {
  for (let dr = -radius; dr <= radius; dr++) {
    for (let dc = -radius; dc <= radius; dc++) {
      if (isLand(col + dc, row + dr)) return true;
    }
  }
  return false;
}

// Pass 2: full classification.
let terrain = '';
for (let row = 0; row < ROWS; row++) {
  for (let col = 0; col < COLS; col++) {
    if (land[row * COLS + col]) {
      const { lon, lat } = tileCenterLonLat(col, row);
      terrain += classifyLand(lon, lat, col, row);
    } else {
      terrain += landNearby(col, row, 1) ? 's' : 'D';
    }
  }
}

const counts = {};
for (const c of terrain) counts[c] = (counts[c] ?? 0) + 1;
console.log('terrain counts:', counts);

const out = { cols: COLS, rows: ROWS, terrain };
await mkdir(join(dir, '..', 'src', 'data'), { recursive: true });
await writeFile(join(dir, '..', 'src', 'data', 'tiles.json'), JSON.stringify(out));
console.log(`wrote src/data/tiles.json (${COLS}x${ROWS} = ${terrain.length} tiles)`);
