/**
 * Offline world-texture bake for the 3D terrain renderer. Fully offline
 * (inputs are committed assets) and deterministic — run twice, same bytes.
 *
 * Reads:
 *   scripts/assets/dem-terrarium-z7.png(.json)  — mercator DEM mosaic (fetch-dem.mjs)
 *   scripts/assets/coastline-50m.json           — Natural Earth land polygons
 *   scripts/assets/terrain-config.json          — straits/rivers/regions/corridors
 *
 * Writes (committed):
 *   public/terrain/heightmap.png   2320x1000 split-byte RGB (R=hi, G=lo) heights
 *   public/terrain/heightmap.json  sidecar: bbox, encoding, exaggeration, units
 *   public/terrain/normal.png      2320x1000 object-space normals (exaggerated)
 *   public/terrain/albedo.jpg      4096x1766 stylized painterly terrain color
 *   public/terrain/worldmask.png   2320x1000 R=coast SDF, G=river mask, B=0
 *   public/terrain/waternormal.png 512x512 tileable water-wave normal map
 *   scripts/assets/dem-preview.png hillshade for human eyeballing (not shipped)
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { LON_MIN, LON_MAX, LAT_MIN, LAT_MAX } from '../src/lib/hex.ts';
import {
  metersToUint16,
  heightToBytes,
  HEIGHT_SCALE,
  HEIGHT_OFFSET,
  SEA_LEVEL_VALUE,
} from '../src/lib/heightEncoding.ts';
import { signedDistanceField } from '../src/lib/distanceField.ts';
import { hashStringSeed, mulberry32 } from '../src/lib/prng.ts';

const dir = dirname(fileURLToPath(import.meta.url));
const asset = (name) => join(dir, 'assets', name);
const out = (name) => join(dir, '..', 'public', 'terrain', name);

/* ------------------------------------------------------------------ */
/* World constants (must match src/map/three/geo.ts)                   */

const HM_W = 2320; // 40 px/degree over 58 degrees of longitude
const HM_H = 1000; // 40 px/degree over 25 degrees of latitude
const ALB_W = 8192;
const ALB_H = 3532; // same 58:25 aspect
const VERTICAL_EXAGGERATION = 2.5;
const UNITS_PER_DEGREE = 4;
const METERS_PER_WORLD_UNIT = 111320 / UNITS_PER_DEGREE; // 27,830 m per unit
const LON_SPAN = LON_MAX - LON_MIN;
const LAT_SPAN = LAT_MAX - LAT_MIN;

const OCEAN_MAX_M = -12; // ocean pixels forced at or below this
// Land sits a few meters proud of the runtime water plane (Y=0). Kept just
// large enough that, with the renderer's logarithmic depth buffer, coastal
// flats never z-fight the water at max camera distance.
const LAND_MIN_M = 4;
const STRAIT_DEPTH_M = -25;
const STRAIT_RADIUS_PX = 1.6;
const RIVER_INCISION_M = 4;

const pxToLon = (x, w) => LON_MIN + ((x + 0.5) / w) * LON_SPAN;
const pxToLat = (y, h) => LAT_MAX - ((y + 0.5) / h) * LAT_SPAN;
const lonToPx = (lon, w) => ((lon - LON_MIN) / LON_SPAN) * w - 0.5;
const latToPx = (lat, h) => ((LAT_MAX - lat) / LAT_SPAN) * h - 0.5;

/* ------------------------------------------------------------------ */
/* Small raster helpers                                                */

/** Bilinear sample of a single-channel Float32Array; clamps at borders. */
function sampleBilinear(data, w, h, x, y) {
  const cx = Math.min(Math.max(x, 0), w - 1);
  const cy = Math.min(Math.max(y, 0), h - 1);
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  const x1 = Math.min(x0 + 1, w - 1);
  const y1 = Math.min(y0 + 1, h - 1);
  const fx = cx - x0;
  const fy = cy - y0;
  const a = data[y0 * w + x0] * (1 - fx) + data[y0 * w + x1] * fx;
  const b = data[y1 * w + x0] * (1 - fx) + data[y1 * w + x1] * fx;
  return a * (1 - fy) + b * fy;
}

/**
 * Even-odd scanline fill of polygon rings into a Uint8 mask (1 = inside).
 * `rings` is an array of rings; each ring is [[lon,lat], ...]. Holes are
 * handled by the even-odd rule automatically.
 */
function fillPolygonsMask(rings, w, h) {
  const mask = new Uint8Array(w * h);
  for (let py = 0; py < h; py++) {
    const lat = pxToLat(py, h);
    const xs = [];
    for (const ring of rings) {
      for (let i = 0; i < ring.length; i++) {
        const [x1, y1] = ring[i];
        const [x2, y2] = ring[(i + 1) % ring.length];
        if (y1 === y2) continue;
        if ((lat < y1) === (lat < y2)) continue;
        xs.push(x1 + ((lat - y1) / (y2 - y1)) * (x2 - x1));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xStart = Math.max(0, Math.ceil(lonToPx(xs[k], w)));
      const xEnd = Math.min(w - 1, Math.floor(lonToPx(xs[k + 1], w)));
      for (let px = xStart; px <= xEnd; px++) mask[py * w + px] = 1;
    }
  }
  return mask;
}

/**
 * Visit every pixel within `radius` px of a lon/lat polyline; calls
 * visit(index, distPx). Single-point "lines" stamp a disc.
 */
function stampPolyline(line, w, h, radius, visit) {
  const pts = line.map(([lon, lat]) => [lonToPx(lon, w), latToPx(lat, h)]);
  const segs = pts.length === 1 ? [[pts[0], pts[0]]] : pts.slice(1).map((p, i) => [pts[i], p]);
  for (const [[ax, ay], [bx, by]] of segs) {
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - radius));
    const x1 = Math.min(w - 1, Math.ceil(Math.max(ax, bx) + radius));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by) - radius));
    const y1 = Math.min(h - 1, Math.ceil(Math.max(ay, by) + radius));
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    for (let py = y0; py <= y1; py++) {
      for (let px = x0; px <= x1; px++) {
        const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / len2));
        const ex = px - (ax + t * dx);
        const ey = py - (ay + t * dy);
        const d = Math.hypot(ex, ey);
        if (d <= radius) visit(py * w + px, d);
      }
    }
  }
}

/** Distance in px from a point to a lon/lat polyline (in a given raster space). */
function polylineDistancePx(line, w, h, px, py) {
  const pts = line.map(([lon, lat]) => [lonToPx(lon, w), latToPx(lat, h)]);
  let best = Infinity;
  for (let i = 0; i < Math.max(1, pts.length - 1); i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[Math.min(i + 1, pts.length - 1)];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / len2));
    best = Math.min(best, Math.hypot(px - (ax + t * dx), py - (ay + t * dy)));
  }
  return best;
}

/** Deterministic tileable value noise on a coarse lattice, fbm-summed. */
function makeValueNoise(seedLabel, period) {
  const rand = mulberry32(hashStringSeed(seedLabel));
  const lattice = new Float32Array(period * period);
  for (let i = 0; i < lattice.length; i++) lattice[i] = rand();
  const smooth = (t) => t * t * (3 - 2 * t);
  const at = (x, y) => lattice[((y % period) + period) % period * period + (((x % period) + period) % period)];
  return (x, y) => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = smooth(x - x0);
    const fy = smooth(y - y0);
    const a = at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx;
    const b = at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx;
    return a * (1 - fy) + b * fy;
  };
}

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const lerp = (a, b, t) => a + (b - a) * t;
const mixRgb = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const smoothstep = (e0, e1, v) => {
  const t = clamp01((v - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

/* ------------------------------------------------------------------ */
/* 1. Load DEM mosaic and build the raw height grid                    */

console.log('loading DEM mosaic…');
const demMeta = JSON.parse(await readFile(asset('dem-terrarium-z7.json'), 'utf8'));
const demRaw = await sharp(asset('dem-terrarium-z7.png')).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const dem = demRaw.data;
const DEM_W = demRaw.info.width;
const DEM_H = demRaw.info.height;

const nTiles = 2 ** demMeta.zoom;
const lonToDemPx = (lon) => (((lon + 180) / 360) * nTiles - demMeta.tileXMin) * demMeta.tileSize - 0.5;
const latToDemPx = (lat) => {
  const rad = (lat * Math.PI) / 180;
  const ty = ((1 - Math.asinh(Math.tan(rad)) / Math.PI) / 2) * nTiles;
  return (ty - demMeta.tileYMin) * demMeta.tileSize - 0.5;
};
const demMetersAt = (ix, iy) => {
  const x = Math.min(Math.max(ix, 0), DEM_W - 1);
  const y = Math.min(Math.max(iy, 0), DEM_H - 1);
  const o = (y * DEM_W + x) * 3;
  return dem[o] * 256 + dem[o + 1] + dem[o + 2] / 256 - 32768;
};
/** Bilinear elevation sample — decode Terrarium bytes first, then blend. */
function demSample(lon, lat) {
  const x = lonToDemPx(lon);
  const y = latToDemPx(lat);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const a = demMetersAt(x0, y0) * (1 - fx) + demMetersAt(x0 + 1, y0) * fx;
  const b = demMetersAt(x0, y0 + 1) * (1 - fx) + demMetersAt(x0 + 1, y0 + 1) * fx;
  return a * (1 - fy) + b * fy;
}

console.log('sampling heights…');
const heights = new Float32Array(HM_W * HM_H);
for (let y = 0; y < HM_H; y++) {
  const lat = pxToLat(y, HM_H);
  for (let x = 0; x < HM_W; x++) {
    heights[y * HM_W + x] = demSample(pxToLon(x, HM_W), lat);
  }
}

/* ------------------------------------------------------------------ */
/* 2. Conform to the vector coastline, carve straits, incise rivers    */

console.log('conforming to coastline…');
const config = JSON.parse(await readFile(asset('terrain-config.json'), 'utf8'));
const coast = JSON.parse(await readFile(asset('coastline-50m.json'), 'utf8'));
const allRings = coast.coordinates.flat();
const landMask = fillPolygonsMask(allRings, HM_W, HM_H);

for (let i = 0; i < heights.length; i++) {
  heights[i] = landMask[i]
    ? Math.max(heights[i], LAND_MIN_M)
    : Math.min(heights[i], OCEAN_MAX_M);
}

// Straits narrower than a heightmap pixel would close into land bridges at
// 2.2 km/px (the hex pipeline hit the same failure); force them open.
for (const strait of config.straits) {
  stampPolyline(strait.line, HM_W, HM_H, STRAIT_RADIUS_PX, (i) => {
    heights[i] = Math.min(heights[i], STRAIT_DEPTH_M);
    landMask[i] = 0;
  });
}

// Subtle valley incision along rivers (cosmetic; rivers are painted in the
// albedo). Floor well above sea level so riverbeds never read as ocean.
for (const river of config.rivers) {
  stampPolyline(river.line, HM_W, HM_H, 1.2, (i, d) => {
    if (!landMask[i]) return;
    const cut = RIVER_INCISION_M * (1 - d / 1.2);
    heights[i] = Math.max(heights[i] - cut, LAND_MIN_M);
  });
}

/* ------------------------------------------------------------------ */
/* 3. Write heightmap.png (split-byte) + sidecar                       */

console.log('writing heightmap…');
{
  const rgb = Buffer.alloc(HM_W * HM_H * 3);
  for (let i = 0; i < heights.length; i++) {
    const [hi, lo] = heightToBytes(metersToUint16(heights[i]));
    rgb[i * 3] = hi;
    rgb[i * 3 + 1] = lo;
  }
  await mkdir(join(dir, '..', 'public', 'terrain'), { recursive: true });
  await sharp(rgb, { raw: { width: HM_W, height: HM_H, channels: 3 } })
    .png({ compressionLevel: 9 })
    .toFile(out('heightmap.png'));
  await writeFile(
    out('heightmap.json'),
    JSON.stringify(
      {
        width: HM_W,
        height: HM_H,
        bbox: { lonMin: LON_MIN, lonMax: LON_MAX, latMin: LAT_MIN, latMax: LAT_MAX },
        encoding: 'uint16 v = R*256 + G; meters = v * scale + offset',
        scale: HEIGHT_SCALE,
        offset: HEIGHT_OFFSET,
        seaLevelValue: SEA_LEVEL_VALUE,
        verticalExaggeration: VERTICAL_EXAGGERATION,
        unitsPerDegree: UNITS_PER_DEGREE,
        metersPerWorldUnit: METERS_PER_WORLD_UNIT,
      },
      null,
      2,
    ) + '\n',
  );
}

/* ------------------------------------------------------------------ */
/* 4. Object-space normal map (exaggeration baked in)                  */

// Gradients are taken in *world units* (plate carrée, 4 units/degree on both
// axes) so shading matches the rendered mesh, not true ground meters.
const PX_PER_UNIT = HM_W / (LON_SPAN * UNITS_PER_DEGREE); // = 10 px per world unit
const metersToUnits = VERTICAL_EXAGGERATION / METERS_PER_WORLD_UNIT;

function normalAt(x, y, boost = 1) {
  const l = heights[y * HM_W + Math.max(0, x - 1)];
  const r = heights[y * HM_W + Math.min(HM_W - 1, x + 1)];
  const u = heights[Math.max(0, y - 1) * HM_W + x];
  const d = heights[Math.min(HM_H - 1, y + 1) * HM_W + x];
  const gx = (((r - l) * metersToUnits) / (2 / PX_PER_UNIT)) * boost; // dY/dX (world)
  const gz = (((d - u) * metersToUnits) / (2 / PX_PER_UNIT)) * boost; // dY/dZ (+Z = south)
  const inv = 1 / Math.hypot(gx, 1, gz);
  return [-gx * inv, inv, -gz * inv];
}

console.log('writing normal map…');
{
  const rgb = Buffer.alloc(HM_W * HM_H * 3);
  for (let y = 0; y < HM_H; y++) {
    for (let x = 0; x < HM_W; x++) {
      const [nx, ny, nz] = normalAt(x, y);
      const i = (y * HM_W + x) * 3;
      rgb[i] = Math.round((nx * 0.5 + 0.5) * 255);
      rgb[i + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      rgb[i + 2] = Math.round((nz * 0.5 + 0.5) * 255);
    }
  }
  await sharp(rgb, { raw: { width: HM_W, height: HM_H, channels: 3 } })
    .png({ compressionLevel: 9 })
    .toFile(out('normal.png'));
}

/* ------------------------------------------------------------------ */
/* 5. Coast SDF + river mask → worldmask.png                           */

console.log('building worldmask…');
const coastSdf = signedDistanceField(HM_W, HM_H, landMask); // +land / -water, px
const riverMask = new Float32Array(HM_W * HM_H);
for (const river of config.rivers) {
  stampPolyline(river.line, HM_W, HM_H, 2.2, (i, d) => {
    if (!landMask[i]) return;
    riverMask[i] = Math.max(riverMask[i], 1 - smoothstep(0.6, 2.2, d));
  });
}
{
  const rgb = Buffer.alloc(HM_W * HM_H * 3);
  for (let i = 0; i < riverMask.length; i++) {
    // R: 128 = coastline, ±6 units per px, saturating ~21 px from shore.
    rgb[i * 3] = Math.round(Math.min(255, Math.max(0, 128 + coastSdf[i] * 6)));
    rgb[i * 3 + 1] = Math.round(riverMask[i] * 255);
  }
  await sharp(rgb, { raw: { width: HM_W, height: HM_H, channels: 3 } })
    .png({ compressionLevel: 9 })
    .toFile(out('worldmask.png'));
}

/* ------------------------------------------------------------------ */
/* 6. Hillshade (shared by albedo + preview)                           */

console.log('building hillshade…');
// Sun from the WSW, softened — this is the *baked* painterly shading that
// multiplies the albedo; real-time lighting adds the directional drama.
const SUN = (() => {
  const az = (247 * Math.PI) / 180; // WSW
  const alt = (48 * Math.PI) / 180;
  return [Math.sin(az) * Math.cos(alt), Math.sin(alt), -Math.cos(az) * Math.cos(alt)];
})();
// True world-scale slopes are gentle (a whole mountain range spans ~1 world
// unit), so the *painterly* baked shading amplifies gradients well past the
// geometric truth; the runtime normal map (above) stays geometry-consistent.
const HILLSHADE_BOOST = 4;
let hillshade = new Float32Array(HM_W * HM_H);
for (let y = 0; y < HM_H; y++) {
  for (let x = 0; x < HM_W; x++) {
    const [nx, ny, nz] = normalAt(x, y, HILLSHADE_BOOST);
    hillshade[y * HM_W + x] = Math.max(0, nx * SUN[0] + ny * SUN[1] + nz * SUN[2]);
  }
}
// One 3x3 soften pass.
{
  const soft = new Float32Array(HM_W * HM_H);
  for (let y = 0; y < HM_H; y++) {
    for (let x = 0; x < HM_W; x++) {
      let sum = 0;
      let wsum = 0;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const sx = Math.min(HM_W - 1, Math.max(0, x + ox));
          const sy = Math.min(HM_H - 1, Math.max(0, y + oy));
          const wgt = ox === 0 && oy === 0 ? 4 : Math.abs(ox) + Math.abs(oy) === 1 ? 2 : 1;
          sum += hillshade[sy * HM_W + sx] * wgt;
          wsum += wgt;
        }
      }
      soft[y * HM_W + x] = sum / wsum;
    }
  }
  hillshade = soft;
}

/* ------------------------------------------------------------------ */
/* 7. Albedo                                                           */

console.log('painting albedo…');

// Region override map at heightmap resolution: 0 none, 1 desert, 2 plains, 3 grass.
const TERRAIN_TO_REGION_ID = { desert: 1, plains: 2, grass: 3 };
const regionId = new Uint8Array(HM_W * HM_H);
for (const region of config.regions) {
  const mask = fillPolygonsMask([region.polygon], HM_W, HM_H);
  const id = TERRAIN_TO_REGION_ID[region.terrain] ?? 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) regionId[i] = id;
}
// Green corridors override deserts (Nile valley, coastal strips): feathered 0..1.
const PX_PER_DEG_HM = HM_W / LON_SPAN;
const corridor = new Float32Array(HM_W * HM_H);
for (const c of config.greenCorridors) {
  const radius = c.buffer * PX_PER_DEG_HM;
  stampPolyline(c.line, HM_W, HM_H, radius * 1.4, (i, d) => {
    corridor[i] = Math.max(corridor[i], 1 - smoothstep(radius * 0.6, radius * 1.4, d));
  });
}

// Palette (sRGB 0..255) — heavy, slightly desaturated "old campaign atlas" tones.
const C = {
  deepSea: [16, 38, 58],
  shelfSea: [30, 71, 92],
  shoreSea: [58, 105, 118],
  sand: [196, 178, 132],
  lowGreen: [96, 116, 70],
  richGreen: [78, 104, 60],
  scrub: [136, 138, 84],
  steppe: [160, 148, 92],
  desert: [204, 178, 118],
  duneShadow: [176, 148, 96],
  rock: [122, 112, 100],
  highRock: [140, 132, 122],
  snow: [235, 236, 234],
  riverWater: [46, 92, 108],
};

const noiseBiome = makeValueNoise('east-roman-biome', 256);
const noiseDetail = makeValueNoise('east-roman-detail', 256);

const albedo = Buffer.alloc(ALB_W * ALB_H * 3);
const hmX = (ax) => ((ax + 0.5) / ALB_W) * HM_W - 0.5;
const hmY = (ay) => ((ay + 0.5) / ALB_H) * HM_H - 0.5;

for (let y = 0; y < ALB_H; y++) {
  const lat = pxToLat(y, ALB_H);
  for (let x = 0; x < ALB_W; x++) {
    const sx = hmX(x);
    const sy = hmY(y);
    const hMeters = sampleBilinear(heights, HM_W, HM_H, sx, sy);
    const sdf = sampleBilinear(coastSdf, HM_W, HM_H, sx, sy);
    const shade = sampleBilinear(hillshade, HM_W, HM_H, sx, sy);
    const nBiome = noiseBiome(x * 0.013, y * 0.013) * 0.65 + noiseBiome(x * 0.051, y * 0.051) * 0.35;
    const nDetail = noiseDetail(x * 0.11, y * 0.11);

    let rgb;
    if (sdf < 0.5) {
      // Water: depth ramp + shelf brightening near the coast.
      const depth = clamp01(-hMeters / 2600);
      rgb = mixRgb(C.shelfSea, C.deepSea, smoothstep(0.04, 0.55, depth));
      const shore = 1 - smoothstep(-6, -0.5, -Math.abs(sdf)); // ≈ near-coast band
      const shelf = 1 - smoothstep(0, 14, -sdf);
      rgb = mixRgb(rgb, C.shoreSea, clamp01(shelf * 0.65 + shore * 0.1));
      rgb = rgb.map((v) => v * (0.94 + nBiome * 0.12));
    } else {
      // Land: aridity from latitude + region overrides + corridors. The
      // region lookup is domain-warped so hand-drawn polygon borders become
      // wobbly organic transitions instead of straight survey lines.
      const warpX = (noiseBiome(x * 0.006 + 7.3, y * 0.006 + 2.1) - 0.5) * 22;
      const warpY = (noiseBiome(x * 0.006 + 13.9, y * 0.006 + 8.7) - 0.5) * 22;
      const rx = Math.min(HM_W - 1, Math.max(0, Math.round(sx + warpX)));
      const ry = Math.min(HM_H - 1, Math.max(0, Math.round(sy + warpY)));
      const region = regionId[ry * HM_W + rx];
      const cx = Math.min(HM_W - 1, Math.max(0, Math.round(sx)));
      const cy = Math.min(HM_H - 1, Math.max(0, Math.round(sy)));
      const green = clamp01(corridor[cy * HM_W + cx]);

      let aridity = clamp01((44 - lat) / 16); // 0 north … 1 south
      aridity += (nBiome - 0.5) * 0.25;
      if (region === 1) aridity = Math.max(aridity, 0.92);
      if (region === 2) aridity = clamp01(Math.max(aridity, 0.55));
      if (region === 3) aridity = Math.min(aridity, 0.25);
      aridity = clamp01(aridity - green * 0.85);

      const wet = mixRgb(C.richGreen, C.lowGreen, clamp01(nBiome * 1.2));
      let base;
      if (aridity < 0.45) base = mixRgb(wet, C.scrub, smoothstep(0.15, 0.45, aridity));
      else if (aridity < 0.75) base = mixRgb(C.scrub, C.steppe, smoothstep(0.45, 0.75, aridity));
      else base = mixRgb(C.steppe, mixRgb(C.desert, C.duneShadow, nDetail * 0.5), smoothstep(0.75, 0.92, aridity));

      // Beach band right at the waterline.
      base = mixRgb(C.sand, base, smoothstep(0.5, 3.5, sdf));

      // Elevation: rock above ~1200 m, snow above a lat-adjusted snowline.
      const rockT = smoothstep(1100, 2100, hMeters);
      base = mixRgb(base, mixRgb(C.rock, C.highRock, nDetail), rockT);
      const snowline = 2900 - (lat - LAT_MIN) * 44; // ~2900 m south → ~1800 m north
      base = mixRgb(base, C.snow, smoothstep(snowline, snowline + 420, hMeters));

      // Painterly mottle + baked hillshade.
      base = base.map((v) => v * (0.90 + nDetail * 0.14) * (0.62 + shade * 0.55));
      rgb = base;
    }
    const o = (y * ALB_W + x) * 3;
    albedo[o] = Math.round(Math.min(255, rgb[0]));
    albedo[o + 1] = Math.round(Math.min(255, rgb[1]));
    albedo[o + 2] = Math.round(Math.min(255, rgb[2]));
  }
}

// Stroke rivers into the albedo (feathered banks, widening downstream).
console.log('stroking rivers…');
const ALB_PER_HM = ALB_W / HM_W;
for (const river of config.rivers) {
  const pts = river.line;
  for (let i = 0; i + 1 < pts.length; i++) {
    const t0 = i / (pts.length - 1);
    const t1 = (i + 1) / (pts.length - 1);
    const w0 = lerp(1.4, 3.4, t0);
    const w1 = lerp(1.4, 3.4, t1);
    const seg = [pts[i], pts[i + 1]];
    const radius = Math.max(w0, w1) + 1.5;
    stampPolyline(seg, ALB_W, ALB_H, radius, (idx, d) => {
      // Land check at heightmap res so rivers stop at the sea.
      const ax = idx % ALB_W;
      const ay = (idx / ALB_W) | 0;
      const sdf = sampleBilinear(coastSdf, HM_W, HM_H, ax / ALB_PER_HM - 0.5, ay / ALB_PER_HM - 0.5);
      if (sdf < 0.8) return;
      const wHere = (w0 + w1) / 2;
      const alpha = (1 - smoothstep(wHere * 0.45, wHere, d)) * 0.85;
      if (alpha <= 0.01) return;
      const o = idx * 3;
      albedo[o] = Math.round(lerp(albedo[o], C.riverWater[0], alpha));
      albedo[o + 1] = Math.round(lerp(albedo[o + 1], C.riverWater[1], alpha));
      albedo[o + 2] = Math.round(lerp(albedo[o + 2], C.riverWater[2], alpha));
    });
  }
}

console.log('writing albedo…');
await sharp(albedo, { raw: { width: ALB_W, height: ALB_H, channels: 3 } })
  .jpeg({ quality: 88, chromaSubsampling: '4:2:0', mozjpeg: false })
  .toFile(out('albedo.jpg'));

/* ------------------------------------------------------------------ */
/* 8. Tileable water normal map                                        */

console.log('writing water normal…');
{
  const SIZE = 512;
  const PERIOD = 8; // lattice cells across the tile → seamless wrap
  const noiseA = makeValueNoise('east-roman-water-a', PERIOD);
  const noiseB = makeValueNoise('east-roman-water-b', PERIOD * 2);
  const heightsW = new Float32Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const u = (x / SIZE) * PERIOD;
      const v = (y / SIZE) * PERIOD;
      heightsW[y * SIZE + x] =
        noiseA(u, v) * 0.6 + noiseB(u * 2, v * 2) * 0.28 + noiseB(u * 4 + 3.7, v * 4 + 1.3) * 0.12;
    }
  }
  const rgb = Buffer.alloc(SIZE * SIZE * 3);
  const AMP = 2.6;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const l = heightsW[y * SIZE + ((x + SIZE - 1) % SIZE)];
      const r = heightsW[y * SIZE + ((x + 1) % SIZE)];
      const u = heightsW[((y + SIZE - 1) % SIZE) * SIZE + x];
      const d = heightsW[((y + 1) % SIZE) * SIZE + x];
      const nx = (l - r) * AMP;
      const ny = (u - d) * AMP;
      const inv = 1 / Math.hypot(nx, ny, 1);
      const o = (y * SIZE + x) * 3;
      rgb[o] = Math.round((nx * inv * 0.5 + 0.5) * 255);
      rgb[o + 1] = Math.round((ny * inv * 0.5 + 0.5) * 255);
      rgb[o + 2] = Math.round((inv * 0.5 + 0.5) * 255);
    }
  }
  await sharp(rgb, { raw: { width: SIZE, height: SIZE, channels: 3 } })
    .png({ compressionLevel: 9 })
    .toFile(out('waternormal.png'));
}

/* ------------------------------------------------------------------ */
/* 9. Human-eyeball preview (hillshade + water)                        */

console.log('writing preview…');
{
  const rgb = Buffer.alloc(HM_W * HM_H * 3);
  for (let i = 0; i < heights.length; i++) {
    const o = i * 3;
    if (coastSdf[i] < 0) {
      rgb[o] = 30;
      rgb[o + 1] = 55;
      rgb[o + 2] = 80;
    } else {
      const v = Math.round(40 + hillshade[i] * 200);
      rgb[o] = v;
      rgb[o + 1] = v;
      rgb[o + 2] = v;
    }
  }
  await sharp(rgb, { raw: { width: HM_W, height: HM_H, channels: 3 } })
    .png({ compressionLevel: 9 })
    .toFile(asset('dem-preview.png'));
}

console.log('done.');
