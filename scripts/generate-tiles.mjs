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
import { COLS, ROWS, tileCenterLonLat, lonLatToTile, neighbors } from '../src/lib/hex.ts';
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

// Pass 1.5: force-open straits. Channels narrower than a tile (Gibraltar,
// Bonifacio, Messina, the imperial straits, Kerch) fall between tile centers
// and get swallowed into land bridges by pass 1 — carve them back to water.
for (const strait of config.straits ?? []) {
  const samples = [...strait.line];
  for (let i = 0; i + 1 < strait.line.length; i++) {
    const [ax, ay] = strait.line[i];
    const [bx, by] = strait.line[i + 1];
    const steps = Math.ceil(Math.hypot(bx - ax, by - ay) / 0.05);
    for (let s = 1; s < steps; s++) {
      samples.push([ax + ((bx - ax) * s) / steps, ay + ((by - ay) * s) / steps]);
    }
  }
  let opened = 0;
  for (const [lon, lat] of samples) {
    const { col, row } = lonLatToTile(lon, lat);
    if (land[row * COLS + col]) {
      land[row * COLS + col] = false;
      opened++;
    }
  }
  console.log(`strait ${strait.name}: opened ${opened} tile(s)`);
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

// Pass 3: trace rivers onto the tile grid.
const isWaterTile = (col, row) => {
  const t = terrain[row * COLS + col];
  return t === 'D' || t === 's';
};

/** Squared lon/lat distance from a tile center to a target tile center. */
function tileDistSq(col, row, tcol, trow) {
  const a = tileCenterLonLat(col, row);
  const b = tileCenterLonLat(tcol, trow);
  return (a.lon - b.lon) ** 2 + (a.lat - b.lat) ** 2;
}

/**
 * Maps a lon/lat polyline to a connected chain of tiles: densify the line,
 * snap samples to tiles, and bridge any skips with greedy neighbor steps.
 * Tracing stops at the first sea tile (the river mouth).
 */
function traceRiver(line) {
  const samples = [];
  for (let i = 0; i + 1 < line.length; i++) {
    const [ax, ay] = line[i];
    const [bx, by] = line[i + 1];
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 0.08));
    for (let s = 0; s < steps; s++) {
      samples.push([ax + ((bx - ax) * s) / steps, ay + ((by - ay) * s) / steps]);
    }
  }
  samples.push(line[line.length - 1]);

  const path = [];
  for (const [lon, lat] of samples) {
    const { col, row } = lonLatToTile(lon, lat);
    const last = path[path.length - 1];
    if (!last) {
      if (isWaterTile(col, row)) continue; // wait for the source to hit land
      path.push([col, row]);
      continue;
    }
    // Walk from the previous tile to this sample's tile, one neighbor at a time.
    let [cc, cr] = last;
    let guard = 0;
    while ((cc !== col || cr !== row) && guard++ < 64) {
      let best = null;
      let bestD = Infinity;
      for (const n of neighbors(cc, cr)) {
        const d = tileDistSq(n.col, n.row, col, row);
        if (d < bestD) {
          bestD = d;
          best = n;
        }
      }
      if (!best) break;
      cc = best.col;
      cr = best.row;
      path.push([cc, cr]);
      if (isWaterTile(cc, cr)) return path; // reached the mouth
    }
  }
  return path;
}

const rivers = [];
for (const river of config.rivers ?? []) {
  const path = traceRiver(river.line);
  if (path.length < 2) {
    console.warn(`river ${river.name}: traced path too short, skipped`);
    continue;
  }
  rivers.push({ name: river.name, path });
}
console.log(`rivers: ${rivers.map((r) => `${r.name}(${r.path.length})`).join(', ')}`);

const out = { cols: COLS, rows: ROWS, terrain, rivers };
await mkdir(join(dir, '..', 'src', 'data'), { recursive: true });
await writeFile(join(dir, '..', 'src', 'data', 'tiles.json'), JSON.stringify(out));
console.log(`wrote src/data/tiles.json (${COLS}x${ROWS} = ${terrain.length} tiles)`);
