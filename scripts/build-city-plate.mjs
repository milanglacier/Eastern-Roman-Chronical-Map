/**
 * Offline bake for a city view of the chronicle map: the coast and land
 * mask of the whole outer ground, and the contours and hachures of the
 * detailed plan. Fully offline (inputs are committed assets) and
 * deterministic: run twice, same bytes.
 *
 * Usage: node scripts/build-city-plate.mjs [cityId ...]
 *        (default: every scripts/assets/city/<id>-plate.json)
 *
 * Reads:
 *   scripts/assets/city/<id>-plate.json      bbox (plan), outerBbox (ground), grid resolution, fixes, contour/hachure settings
 *   scripts/assets/city/<id>-dem.png(.json)  Terrarium mercator mosaic (z13)
 *
 * Writes (committed) to public/city/<id>/:
 *   plate.json  bboxes, grid size, coast lines (outer), contours and hachure strokes (plan) in lon/lat
 *   land.png    land mask over the outer bbox: white, alpha = land
 *
 * Writes (not shipped): scripts/assets/city/<id>-plate-preview.png.
 */
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { isolines, simplifyPolyline, polylineLength } from '../src/lib/isolines.ts';
import { hashStringSeed, mulberry32 } from '../src/lib/prng.ts';

const dir = dirname(fileURLToPath(import.meta.url));
const cityDir = join(dir, 'assets', 'city');
const M_PER_DEG_LAT = 111320;

const round5 = (v) => Math.round(v * 1e5) / 1e5;

function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function blur(src, w, h, r) {
  if (r <= 0) return Float32Array.from(src);
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      let n = 0;
      for (let k = -r; k <= r; k++) {
        const xx = Math.min(w - 1, Math.max(0, x + k));
        s += src[y * w + xx];
        n++;
      }
      tmp[y * w + x] = s / n;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      let n = 0;
      for (let k = -r; k <= r; k++) {
        const yy = Math.min(h - 1, Math.max(0, y + k));
        s += tmp[yy * w + x];
        n++;
      }
      out[y * w + x] = s / n;
    }
  }
  return out;
}

/** Flip connected regions of `value` smaller than `minPx` (4-connected). */
function removeSmallRegions(mask, w, h, value, minPx) {
  const seen = new Uint8Array(w * h);
  const stack = [];
  for (let start = 0; start < w * h; start++) {
    if (seen[start] || mask[start] !== value) continue;
    const region = [];
    stack.push(start);
    seen[start] = 1;
    let touchesBorder = false;
    while (stack.length) {
      const i = stack.pop();
      region.push(i);
      const x = i % w;
      const y = (i - x) / w;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touchesBorder = true;
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (!seen[j] && mask[j] === value) {
          seen[j] = 1;
          stack.push(j);
        }
      }
    }
    if (region.length < minPx && !touchesBorder) for (const i of region) mask[i] = 1 - value;
  }
}

async function bakeCity(id) {
  const config = JSON.parse(await readFile(join(cityDir, `${id}-plate.json`), 'utf8'));
  const demMeta = JSON.parse(await readFile(join(cityDir, `${id}-dem.json`), 'utf8'));
  const dem = await sharp(join(cityDir, `${id}-dem.png`)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const demW = dem.info.width;
  const demH = dem.info.height;
  const demPx = dem.data;
  const n = 2 ** demMeta.zoom;
  const demMeters = (px, py) => {
    const x = Math.min(demW - 1, Math.max(0, px));
    const y = Math.min(demH - 1, Math.max(0, py));
    const i = (y * demW + x) * 3;
    return demPx[i] * 256 + demPx[i + 1] + demPx[i + 2] / 256 - 32768;
  };
  /** Bilinear DEM sample at lon/lat (web-mercator mosaic). */
  const demAt = (lon, lat) => {
    const tx = ((lon + 180) / 360) * n;
    const r = (lat * Math.PI) / 180;
    const ty = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n;
    const px = (tx - demMeta.tileXMin) * demMeta.tileSize - 0.5;
    const py = (ty - demMeta.tileYMin) * demMeta.tileSize - 0.5;
    const x0 = Math.floor(px);
    const y0 = Math.floor(py);
    const fx = px - x0;
    const fy = py - y0;
    const a = demMeters(x0, y0) * (1 - fx) + demMeters(x0 + 1, y0) * fx;
    const b = demMeters(x0, y0 + 1) * (1 - fx) + demMeters(x0 + 1, y0 + 1) * fx;
    return a * (1 - fy) + b * fy;
  };

  const [west, south, east, north] = config.outerBbox;
  const [pw, ps, pe, pn] = config.bbox;
  const inPlan = ([lon, lat]) => lon >= pw && lon <= pe && lat >= ps && lat <= pn;
  const latC = (south + north) / 2;
  const mPerDegLon = M_PER_DEG_LAT * Math.cos((latC * Math.PI) / 180);
  const W = Math.round(((east - west) * mPerDegLon) / config.metresPerPixel);
  const H = Math.round(((north - south) * M_PER_DEG_LAT) / config.metresPerPixel);
  // Grid point (x, y) sits at the centre of pixel (x, y).
  const lonAt = (x) => west + ((x + 0.5) / W) * (east - west);
  const latAt = (y) => north - ((y + 0.5) / H) * (north - south);
  const toLonLat = ([x, y]) => [round5(lonAt(x)), round5(latAt(y))];

  const heights = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) heights[y * W + x] = demAt(lonAt(x), latAt(y));
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const lon = lonAt(x);
      const lat = latAt(y);
      for (const fix of config.seaFixes) if (pointInRing(lon, lat, fix.ring)) heights[y * W + x] = -2;
      for (const fix of config.landFixes) if (pointInRing(lon, lat, fix.ring)) heights[y * W + x] = Math.max(2, heights[y * W + x]);
    }
  }

  // Land mask: threshold, drop specks (piers, ponds), smooth for the coast line.
  const mask = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) mask[i] = heights[i] > config.landThresholdM ? 1 : 0;
  removeSmallRegions(mask, W, H, 1, config.minIslandPx);
  removeSmallRegions(mask, W, H, 0, config.minLakePx);
  const maskField = blur(mask, W, H, config.smoothPx);
  const tolerancePx = config.simplifyM / config.metresPerPixel;
  const coast = isolines(maskField, W, H, 0.5)
    .map((l) => simplifyPolyline(l, tolerancePx))
    .filter((l) => polylineLength(l) * config.metresPerPixel > 150)
    .map((l) => l.map(toLonLat));

  // Contours and hachures on smoothed land heights.
  const land = blur(heights.map((h, i) => (mask[i] ? Math.max(0, h) : -5)), W, H, 2);
  const contours = [];
  for (let level = config.contourIntervalM; level <= config.contourMaxM; level += config.contourIntervalM) {
    const lines = isolines(land, W, H, level)
      .map((l) => simplifyPolyline(l, tolerancePx))
      .filter((l) => polylineLength(l) * config.metresPerPixel > 200)
      .map((l) => l.map(toLonLat))
      .filter((l) => l.some(inPlan));
    if (lines.length) contours.push({ level, lines });
  }
  const rand = mulberry32(hashStringSeed(`${id}-hachures`));
  const hachures = [];
  const step = config.hachure.spacingM / config.metresPerPixel;
  const [lenMin, lenMax] = config.hachure.lengthM;
  for (let gy = step / 2; gy < H - 2; gy += step) {
    for (let gx = step / 2; gx < W - 2; gx += step) {
      const x = Math.round(gx + (rand() - 0.5) * step * 0.8);
      const y = Math.round(gy + (rand() - 0.5) * step * 0.8);
      if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1 || !mask[y * W + x] || !inPlan([lonAt(x), latAt(y)])) continue;
      const dx = (land[y * W + x + 1] - land[y * W + x - 1]) / (2 * config.metresPerPixel);
      const dy = (land[(y + 1) * W + x] - land[(y - 1) * W + x]) / (2 * config.metresPerPixel);
      const slope = Math.hypot(dx, dy);
      if (slope < config.hachure.minSlope) continue;
      // Stroke runs downhill, longer on steeper ground.
      const lenM = lenMin + (lenMax - lenMin) * Math.min(1, (slope - config.hachure.minSlope) / 0.12);
      const len = lenM / config.metresPerPixel;
      const ux = -dx / slope;
      const uy = -dy / slope;
      const a = toLonLat([x - ux * len * 0.5, y - uy * len * 0.5]);
      const b = toLonLat([x + ux * len * 0.5, y + uy * len * 0.5]);
      hachures.push([a[0], a[1], b[0], b[1], Math.round(Math.min(1, slope / 0.15) * 100) / 100]);
    }
  }

  const outDir = join(dir, '..', 'public', 'city', id);
  await mkdir(outDir, { recursive: true });
  const plate = {
    $comment: `Baked by scripts/build-city-plate.mjs from ${id}-dem.png; do not edit by hand.`,
    bbox: config.bbox,
    outerBbox: config.outerBbox,
    grid: { width: W, height: H, metresPerPixel: config.metresPerPixel },
    coast,
    contours,
    hachures,
  };
  await writeFile(join(outDir, 'plate.json'), JSON.stringify(plate) + '\n');

  const rgba = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    rgba[i * 4] = 255;
    rgba[i * 4 + 1] = 255;
    rgba[i * 4 + 2] = 255;
    rgba[i * 4 + 3] = mask[i] ? 255 : 0;
  }
  await sharp(rgba, { raw: { width: W, height: H, channels: 4 } }).png({ compressionLevel: 9 }).toFile(join(outDir, 'land.png'));

  // Preview for human eyes: land/sea, contours and coast.
  const preview = Buffer.alloc(W * H * 3);
  for (let i = 0; i < W * H; i++) {
    const h = Math.max(0, heights[i]);
    const c = mask[i] ? [230 - Math.min(120, h * 0.6), 215 - Math.min(90, h * 0.4), 170] : [120, 170, 190];
    preview.set(c, i * 3);
  }
  await sharp(preview, { raw: { width: W, height: H, channels: 3 } }).png().toFile(join(cityDir, `${id}-plate-preview.png`));
  const points = coast.reduce((s, l) => s + l.length, 0);
  console.log(`${id}: ${W}x${H} grid, ${coast.length} coast lines (${points} pts), ${contours.length} contour levels, ${hachures.length} hachures`);
}

const args = process.argv.slice(2);
const ids = args.length
  ? args
  : (await readdir(cityDir))
      .filter((f) => f.endsWith('-plate.json'))
      .map((f) => f.replace(/-plate\.json$/, ''))
      .filter((cityId) => existsSync(join(cityDir, `${cityId}-dem.png`)));
for (const id of ids) await bakeCity(id);
