/**
 * Offline world-texture bake for the 3D terrain renderer. Fully offline
 * (inputs are committed assets) and deterministic — run twice, same bytes.
 *
 * Reads:
 *   scripts/assets/dem-terrarium-z7.png(.json)  — mercator DEM mosaic (fetch-dem.mjs)
 *   scripts/assets/coastline-50m.json           — Natural Earth land polygons
 *   scripts/assets/terrain-config.json          — straits/rivers/regions/corridors
 *   scripts/assets/bmng-crop.jpg(.json)         — NASA Blue Marble land colour (fetch-imagery.mjs)
 *   scripts/assets/detail/*.jpg                 — ambientCG CC0 ground photos (detail layer)
 *
 * Writes (committed):
 *   public/terrain/heightmap.png   2880x1400 split-byte RGB (R=hi, G=lo) heights
 *   public/terrain/heightmap.json  sidecar: bbox, encoding, exaggeration, units
 *   public/terrain/normal.png      2880x1400 object-space normals (exaggerated)
 *   public/terrain/albedo.jpg      8192x3982 graded satellite terrain color
 *   public/terrain/worldmask.png   2880x1400 R=coast SDF, G=river mask, B=0
 *   public/terrain/waternormal.png 512x512 tileable water-wave normal map
 *   public/terrain/clouds.png      512x512 tileable cloud density (R), soft edges
 *   public/textures/detail/detail-mix.png 512x512 tileable high-pass luminance
 *                                  detail: R = vegetated soil, G = rock, B = sand
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
import {
  shapedMeters,
  SEA_EXAGGERATION,
  LAND_EXAGGERATION_MIN,
  LAND_EXAGGERATION_MAX,
  LAND_RAMP_START_M,
  LAND_RAMP_END_M,
} from '../src/lib/heightShaping.ts';

const dir = dirname(fileURLToPath(import.meta.url));
const asset = (name) => join(dir, 'assets', name);
const out = (name) => join(dir, '..', 'public', 'terrain', name);

/* ------------------------------------------------------------------ */
/* World constants (must match src/map/three/geo.ts)                   */

const HM_W = 2880; // 40 px/degree over 72 degrees of longitude
const HM_H = 1400; // 40 px/degree over 35 degrees of latitude
const ALB_W = 8192;
const ALB_H = 3982; // same 72:35 aspect
// Base (sea) factor documented in the sidecar; land uses the elevation-shaped
// curve from src/lib/heightShaping.ts (shared with the runtime height field).
const VERTICAL_EXAGGERATION = SEA_EXAGGERATION;
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
// Deep enough that, with the land exaggeration curve, river courses sit in
// visibly shaded grooves instead of relying on the painted stroke alone.
const RIVER_INCISION_M = 12;
const RIVER_INCISION_RADIUS_PX = 1.4;

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

/**
 * Deterministic meander: resample a sparse hand-drawn polyline to ~0.04°
 * steps and displace it perpendicular with seeded value noise, so rivers
 * wander like rivers instead of ruling dead-straight lines between control
 * points (the Nile spans 7° of latitude on 6 points). Endpoints stay
 * anchored (source/mouth) and the amplitude eases in from both ends.
 */
function meanderLine(line, seedLabel) {
  if (line.length < 2) return line;
  const noise = makeValueNoise(`meander-${seedLabel}`, 64);
  const cum = [0];
  for (let i = 1; i < line.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]));
  }
  const total = cum[cum.length - 1];
  const STEP_DEG = 0.04;
  const n = Math.max(2, Math.ceil(total / STEP_DEG));
  const out = [];
  for (let k = 0; k <= n; k++) {
    const s = (k / n) * total;
    let i = 1;
    while (i < line.length - 1 && cum[i] < s) i++;
    const t = (s - cum[i - 1]) / Math.max(1e-9, cum[i] - cum[i - 1]);
    const x = lerp(line[i - 1][0], line[i][0], t);
    const y = lerp(line[i - 1][1], line[i][1], t);
    const dx = line[i][0] - line[i - 1][0];
    const dy = line[i][1] - line[i - 1][1];
    const inv = 1 / Math.max(1e-9, Math.hypot(dx, dy));
    // Perpendicular offset: broad sweep + a finer wiggle, zero-mean.
    const wander =
      (noise(s * 0.9, 3.7) - 0.5) * 1.6 + (noise(s * 2.8, 11.2) - 0.5) * 0.5;
    const envelope = smoothstep(0, 0.5, s) * smoothstep(0, 0.5, total - s);
    const amp = 0.11 * envelope;
    out.push([x + -dy * inv * wander * amp, y + dx * inv * wander * amp]);
  }
  return out;
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

const rawHeights = heights.slice(); // pre-conform DEM, for un-drowning slits below
for (let i = 0; i < heights.length; i++) {
  heights[i] = landMask[i]
    ? Math.max(heights[i], LAND_MIN_M)
    : Math.min(heights[i], OCEAN_MAX_M);
}

// Natural Earth land polygons slit major rivers (e.g. the Po) into the
// coast; at 2.2 km/px those become 1-2 px ocean trenches running across
// whole valleys, rendered as bright foam-lined canals. Close water that is
// both thin (land within 2 px on opposite sides) and above sea level in the
// raw DEM — real sea channels have negative bathymetry, so genuine straits
// and lagoon mouths survive. Two sweeps catch slits the first pass narrows.
// The configured straits are narrow, misregistered against the DEM, and
// meant to stay open — never slit-close anywhere near them (the Bosporus
// channel is thin water the closing pass would otherwise eat whole).
const straitProtect = new Uint8Array(HM_W * HM_H);
for (const strait of config.straits) {
  stampPolyline(strait.line, HM_W, HM_H, 10, (i) => {
    straitProtect[i] = 1;
  });
}
for (let pass = 0; pass < 2; pass++) {
  const nearLand = (x, y, dx, dy) => {
    for (let s = 1; s <= 2; s++) {
      const nx = x + dx * s;
      const ny = y + dy * s;
      if (nx < 0 || nx >= HM_W || ny < 0 || ny >= HM_H) return false;
      if (landMask[ny * HM_W + nx]) return true;
    }
    return false;
  };
  const toClose = [];
  for (let y = 0; y < HM_H; y++) {
    for (let x = 0; x < HM_W; x++) {
      const i = y * HM_W + x;
      if (landMask[i] || straitProtect[i] || rawHeights[i] <= 2) continue;
      if ((nearLand(x, y, 0, -1) && nearLand(x, y, 0, 1)) || (nearLand(x, y, -1, 0) && nearLand(x, y, 1, 0))) {
        toClose.push(i);
      }
    }
  }
  for (const i of toClose) {
    landMask[i] = 1;
    heights[i] = Math.max(rawHeights[i], LAND_MIN_M);
  }
  console.log(`  river-slit water px closed (pass ${pass + 1}): ${toClose.length}`);
}

// Straits narrower than a heightmap pixel would close into land bridges at
// 2.2 km/px (the hex pipeline hit the same failure); force them open.
const straitCarved = new Uint8Array(HM_W * HM_H);
for (const strait of config.straits) {
  stampPolyline(strait.line, HM_W, HM_H, STRAIT_RADIUS_PX, (i) => {
    heights[i] = Math.min(heights[i], STRAIT_DEPTH_M);
    landMask[i] = 0;
    straitCarved[i] = 1;
  });
}

// Mop up small orphaned water fragments (lagoon shreds the slit closing cut
// off). Flood-fill sea from the map border through the carved straits, then
// land-fill only *small* unreached components — big ones are real seas that
// must survive even if a data quirk ever pinches their connection.
{
  const reached = new Uint8Array(HM_W * HM_H);
  const fill = (seeds, mark) => {
    const stack = [];
    const push = (i) => {
      if (!reached[i] && !landMask[i]) {
        reached[i] = mark;
        stack.push(i);
      }
    };
    for (const s of seeds) push(s);
    const component = [];
    while (stack.length) {
      const i = stack.pop();
      component.push(i);
      const x = i % HM_W;
      if (x > 0) push(i - 1);
      if (x < HM_W - 1) push(i + 1);
      if (i >= HM_W) push(i - HM_W);
      if (i < (HM_H - 1) * HM_W) push(i + HM_W);
    }
    return component;
  };
  const border = [];
  for (let x = 0; x < HM_W; x++) border.push(x, (HM_H - 1) * HM_W + x);
  for (let y = 0; y < HM_H; y++) border.push(y * HM_W, y * HM_W + HM_W - 1);
  fill(border, 1);
  let closed = 0;
  for (let i = 0; i < landMask.length; i++) {
    if (landMask[i] || reached[i]) continue;
    const component = fill([i], 2);
    if (component.length >= 500) continue; // a real (if pinched) sea — keep
    if (component.some((j) => straitCarved[j])) continue; // carved straits stay water
    for (const j of component) {
      landMask[j] = 1;
      heights[j] = Math.max(rawHeights[j], LAND_MIN_M);
      closed++;
    }
  }
  console.log(`  orphaned water px reclassified as land: ${closed}`);
}

// One meandered course per river, shared by the incision, the worldmask
// river channel and the albedo stroke so they always coincide.
const riverLines = config.rivers.map((r) => ({ ...r, line: meanderLine(r.line, r.name) }));

// Valley incision along rivers so courses sit in shaded grooves. Floor well
// above sea level so riverbeds never read as ocean.
for (const river of riverLines) {
  stampPolyline(river.line, HM_W, HM_H, RIVER_INCISION_RADIUS_PX, (i, d) => {
    if (!landMask[i]) return;
    const cut = RIVER_INCISION_M * (1 - d / RIVER_INCISION_RADIUS_PX);
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
        heightShaping: {
          note: 'runtime Y uses shapedMeters() from src/lib/heightShaping.ts, not the flat factor',
          seaExaggeration: SEA_EXAGGERATION,
          landExaggerationMin: LAND_EXAGGERATION_MIN,
          landExaggerationMax: LAND_EXAGGERATION_MAX,
          landRampStartM: LAND_RAMP_START_M,
          landRampEndM: LAND_RAMP_END_M,
        },
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
// axes) so shading matches the rendered mesh, not true ground meters. The
// elevation-shaped exaggeration is applied to the heights first — exactly
// what the runtime metersToY does to the mesh vertices.
const PX_PER_UNIT = HM_W / (LON_SPAN * UNITS_PER_DEGREE); // = 10 px per world unit
const metersToUnits = 1 / METERS_PER_WORLD_UNIT;
const heightsShaped = new Float32Array(heights.length);
for (let i = 0; i < heights.length; i++) heightsShaped[i] = shapedMeters(heights[i]);

function normalAt(x, y, boost = 1) {
  const l = heightsShaped[y * HM_W + Math.max(0, x - 1)];
  const r = heightsShaped[y * HM_W + Math.min(HM_W - 1, x + 1)];
  const u = heightsShaped[Math.max(0, y - 1) * HM_W + x];
  const d = heightsShaped[Math.min(HM_H - 1, y + 1) * HM_W + x];
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
// Slightly tighter than the painted stroke so the runtime water shimmer
// stays inside the visible channel instead of licking the banks.
const riverMask = new Float32Array(HM_W * HM_H);
for (const river of riverLines) {
  stampPolyline(river.line, HM_W, HM_H, 1.3, (i, d) => {
    if (!landMask[i]) return;
    riverMask[i] = Math.max(riverMask[i], 1 - smoothstep(0.3, 1.3, d));
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
// The shaped exaggeration already amplifies upland gradients ~2-3x over the
// old flat factor, so the painterly boost drops accordingly (4 -> 2) to keep
// the baked shading from double-darkening under the real-time sun.
const HILLSHADE_BOOST = 2;
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
  riverWater: [56, 102, 114],
};

/* Satellite land colour (NASA Blue Marble NG, public domain). Graded toward
 * the atlas palette, with modern artefacts (dam reservoirs, pivot farms,
 * coastline mismatch against Natural Earth) inpainted from a masked low-res
 * average of the surrounding land. */
const bmngMeta = JSON.parse(await readFile(asset('bmng-crop.json'), 'utf8'));
const bmngRaw = await sharp(asset('bmng-crop.jpg')).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const BM = bmngRaw.data;
const BM_W = bmngRaw.info.width;
const BM_H = bmngRaw.info.height;
const lonToBmPx = (lon) => ((lon - bmngMeta.lonMin) / (bmngMeta.lonMax - bmngMeta.lonMin)) * BM_W - 0.5;
const latToBmPx = (lat) => ((bmngMeta.latMax - lat) / (bmngMeta.latMax - bmngMeta.latMin)) * BM_H - 0.5;

/** Open water / reservoir colours in BMNG: dark and bluish-cyan, never forest. */
const isWaterish = (r, g, b) => r < 45 && b > r + 6 && b >= g * 0.55 && r + g + b < 200;

function bmSample(lon, lat) {
  const x = Math.min(Math.max(lonToBmPx(lon), 0), BM_W - 1);
  const y = Math.min(Math.max(latToBmPx(lat), 0), BM_H - 1);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, BM_W - 1);
  const y1 = Math.min(y0 + 1, BM_H - 1);
  const fx = x - x0;
  const fy = y - y0;
  const out = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const a = BM[(y0 * BM_W + x0) * 3 + c] * (1 - fx) + BM[(y0 * BM_W + x1) * 3 + c] * fx;
    const b = BM[(y1 * BM_W + x0) * 3 + c] * (1 - fx) + BM[(y1 * BM_W + x1) * 3 + c] * fx;
    out[c] = a * (1 - fy) + b * fy;
  }
  return out;
}

// Masked low-res land average: cells average only non-water pixels, then
// empty cells are filled by repeated neighbour averaging (inpaint source).
const FILL_CELL = 12;
const FILL_W = Math.ceil(BM_W / FILL_CELL);
const FILL_H = Math.ceil(BM_H / FILL_CELL);
const fillRgb = new Float32Array(FILL_W * FILL_H * 3);
{
  const fillN = new Float32Array(FILL_W * FILL_H);
  for (let y = 0; y < BM_H; y++) {
    for (let x = 0; x < BM_W; x++) {
      const o = (y * BM_W + x) * 3;
      if (isWaterish(BM[o], BM[o + 1], BM[o + 2])) continue;
      const cell = ((y / FILL_CELL) | 0) * FILL_W + ((x / FILL_CELL) | 0);
      fillRgb[cell * 3] += BM[o];
      fillRgb[cell * 3 + 1] += BM[o + 1];
      fillRgb[cell * 3 + 2] += BM[o + 2];
      fillN[cell] += 1;
    }
  }
  // Sparse cells (mostly water) are unreliable — treat as empty.
  let known = new Uint8Array(FILL_W * FILL_H);
  for (let i = 0; i < fillN.length; i++) {
    if (fillN[i] >= FILL_CELL * FILL_CELL * 0.25) {
      for (let c = 0; c < 3; c++) fillRgb[i * 3 + c] /= fillN[i];
      known[i] = 1;
    } else {
      fillRgb[i * 3] = fillRgb[i * 3 + 1] = fillRgb[i * 3 + 2] = 0;
    }
  }
  for (let pass = 0; pass < 400; pass++) {
    const next = known.slice();
    let grew = 0;
    for (let y = 0; y < FILL_H; y++) {
      for (let x = 0; x < FILL_W; x++) {
        const i = y * FILL_W + x;
        if (known[i]) continue;
        let n = 0;
        const acc = [0, 0, 0];
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= FILL_W || ny >= FILL_H) continue;
          const j = ny * FILL_W + nx;
          if (!known[j]) continue;
          for (let c = 0; c < 3; c++) acc[c] += fillRgb[j * 3 + c];
          n++;
        }
        if (n === 0) continue;
        for (let c = 0; c < 3; c++) fillRgb[i * 3 + c] = acc[c] / n;
        next[i] = 1;
        grew++;
      }
    }
    known = next;
    if (grew === 0) break;
  }
}
function fillSample(lon, lat) {
  const x = Math.min(Math.max((lonToBmPx(lon) + 0.5) / FILL_CELL - 0.5, 0), FILL_W - 1);
  const y = Math.min(Math.max((latToBmPx(lat) + 0.5) / FILL_CELL - 0.5, 0), FILL_H - 1);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, FILL_W - 1);
  const y1 = Math.min(y0 + 1, FILL_H - 1);
  const fx = x - x0;
  const fy = y - y0;
  const out = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const a = fillRgb[(y0 * FILL_W + x0) * 3 + c] * (1 - fx) + fillRgb[(y0 * FILL_W + x1) * 3 + c] * fx;
    const b = fillRgb[(y1 * FILL_W + x0) * 3 + c] * (1 - fx) + fillRgb[(y1 * FILL_W + x1) * 3 + c] * fx;
    out[c] = a * (1 - fy) + b * fy;
  }
  return out;
}
const reservoirs = config.modernReservoirs ?? [];
const inBox = (lon, lat, [w, so, e, n]) => lon >= w && lon <= e && lat >= so && lat <= n;

/** Cinematic grade: lift the dark satellite land, warm it, ease saturation. */
const GRADE_GAMMA = 0.72;
const GRADE_SAT = 0.86;
const GRADE_WARM = [1.015, 1.0, 0.97];
function gradeSatellite(rgb) {
  const lifted = rgb.map((v, c) => 255 * Math.pow(v / 255, GRADE_GAMMA) * GRADE_WARM[c]);
  const l = lifted[0] * 0.2126 + lifted[1] * 0.7152 + lifted[2] * 0.0722;
  return lifted.map((v) => l + (v - l) * GRADE_SAT);
}
/** Share of the procedural painterly ramp kept under the satellite colour. */
const PROCEDURAL_MIX = 0.16;

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
      // Narrow, soft shelf: a wide bright band reads as a glowing outline
      // against the satellite land.
      const shelf = 1 - smoothstep(0, 6, -sdf);
      rgb = mixRgb(rgb, C.shoreSea, clamp01(shelf * 0.4 + shore * 0.08));
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

      // Elevation: rock above ~1200 m.
      const rockT = smoothstep(1100, 2100, hMeters);
      base = mixRgb(base, mixRgb(C.rock, C.highRock, nDetail), rockT);

      // Satellite colour, with modern artefacts inpainted.
      const lon = pxToLon(x, ALB_W);
      let sat = bmSample(lon, lat);
      let inpaint = isWaterish(sat[0], sat[1], sat[2]) && sdf < 8;
      for (const r of reservoirs) {
        if (!inBox(lon, lat, r.bbox)) continue;
        // Dam lakes are often murky green-black in BMNG: any dark pixel goes.
        if (!r.kind && sat[0] < 50 && sat[0] + sat[1] + sat[2] < 170) inpaint = true;
        if (r.kind === 'pivots' && sat[1] > sat[0] * 0.95) inpaint = true;
      }
      if (inpaint) sat = fillSample(lon, lat).map((v) => v * (0.94 + nDetail * 0.12));
      base = mixRgb(gradeSatellite(sat), base, PROCEDURAL_MIX);

      // Snow caps on the highest summits only (the July composite has the
      // real Alpine snow already; this just crowns the Caucasus/Taurus).
      const snowline = 3300 - (lat - LAT_MIN) * 30; // ~3300 m south → ~2250 m north
      base = mixRgb(base, C.snow, 0.7 * smoothstep(snowline, snowline + 600, hMeters));

      // Light mottle + soft baked occlusion; the real-time sun does the relief.
      base = base.map((v) => v * (0.95 + nDetail * 0.08) * (0.8 + shade * 0.32));
      rgb = base;
    }
    const o = (y * ALB_W + x) * 3;
    albedo[o] = Math.round(Math.min(255, rgb[0]));
    albedo[o + 1] = Math.round(Math.min(255, rgb[1]));
    albedo[o + 2] = Math.round(Math.min(255, rgb[2]));
  }
}

// Stroke rivers into the albedo: a soft riparian green band under a
// narrower water core. Coverage is accumulated as max-alpha first and
// composited once — the meandered courses are dense polylines whose stamp
// bounding boxes overlap heavily, and lerping per segment would band.
console.log('stroking rivers…');
const ALB_PER_HM = ALB_W / HM_W;
const riparianCov = new Uint8Array(ALB_W * ALB_H);
const waterCov = new Uint8Array(ALB_W * ALB_H);
const onLand = (idx) => {
  const ax = idx % ALB_W;
  const ay = (idx / ALB_W) | 0;
  return sampleBilinear(coastSdf, HM_W, HM_H, ax / ALB_PER_HM - 0.5, ay / ALB_PER_HM - 0.5) >= 0.8;
};
for (const river of riverLines) {
  const pts = river.line;
  for (let i = 0; i + 1 < pts.length; i++) {
    const t0 = i / (pts.length - 1);
    const w = lerp(1.1, 2.8, t0); // water half-width, widening downstream
    const seg = [pts[i], pts[i + 1]];
    stampPolyline(seg, ALB_W, ALB_H, w * 3.2, (idx, d) => {
      if (!onLand(idx)) return;
      const band = Math.round((1 - smoothstep(w * 0.7, w * 3.2, d)) * 255);
      if (band > riparianCov[idx]) riparianCov[idx] = band;
      const core = Math.round((1 - smoothstep(w * 0.4, w, d)) * 255);
      if (core > waterCov[idx]) waterCov[idx] = core;
    });
  }
}
{
  const riparian = mixRgb(C.richGreen, C.lowGreen, 0.35);
  for (let i = 0; i < riparianCov.length; i++) {
    if (riparianCov[i] === 0 && waterCov[i] === 0) continue;
    // Kept faint: the satellite colour already shows the real valleys, and
    // the hand-drawn courses only approximate them.
    const ra = (riparianCov[i] / 255) * 0.12;
    const wa = (waterCov[i] / 255) * 0.45;
    const o = i * 3;
    for (let c = 0; c < 3; c++) {
      const banked = lerp(albedo[o + c], riparian[c], ra);
      albedo[o + c] = Math.round(lerp(banked, C.riverWater[c], wa));
    }
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
/* 8b. Tileable cloud density                                          */

// Domain-warped gradient-noise fbm, tileable (every octave's period divides
// the tile), so the runtime can scroll it forever. R = density 0..1 before
// the runtime coverage threshold. Gradient (Perlin) noise, not the value
// noise above: value noise's lattice shows up as streaks once thresholded.
console.log('writing clouds…');
/** Tileable 2D Perlin noise with the given integer period, range ~[-0.7, 0.7]. */
function makePerlin(seedLabel, period) {
  const rand = mulberry32(hashStringSeed(seedLabel));
  const grads = new Float32Array(period * period * 2);
  for (let i = 0; i < period * period; i++) {
    const a = rand() * Math.PI * 2;
    grads[i * 2] = Math.cos(a);
    grads[i * 2 + 1] = Math.sin(a);
  }
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const dot = (ix, iy, dx, dy) => {
    const k = ((((iy % period) + period) % period) * period + (((ix % period) + period) % period)) * 2;
    return grads[k] * dx + grads[k + 1] * dy;
  };
  return (x, y) => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const u = fade(fx);
    const v = fade(fy);
    const a = lerp(dot(x0, y0, fx, fy), dot(x0 + 1, y0, fx - 1, fy), u);
    const b = lerp(dot(x0, y0 + 1, fx, fy - 1), dot(x0 + 1, y0 + 1, fx - 1, fy - 1), u);
    return lerp(a, b, v);
  };
}
{
  const SIZE = 512;
  const P = 5; // base lattice cells across the tile
  const octaves = [1, 2, 4, 8, 16, 32].map((m, k) => ({
    noise: makePerlin(`east-roman-cloud-${k}`, P * m),
    freq: m,
    amp: 0.52 ** k,
  }));
  const warpX = makePerlin('east-roman-cloud-warp-x', P * 2);
  const warpY = makePerlin('east-roman-cloud-warp-y', P * 2);
  const density = new Float32Array(SIZE * SIZE);
  let lo = Infinity;
  let hi = -Infinity;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const u = (x / SIZE) * P;
      const v = (y / SIZE) * P;
      const wu = u + warpX(u * 2, v * 2) * 0.5;
      const wv = v + warpY(u * 2, v * 2) * 0.5;
      let sum = 0;
      // Warp only the broad octaves: warped high octaves stretch into streaks.
      for (const o of octaves) {
        const [cu, cv] = o.freq <= 2 ? [wu, wv] : [u, v];
        sum += o.noise(cu * o.freq, cv * o.freq) * o.amp;
      }
      density[y * SIZE + x] = sum;
      lo = Math.min(lo, sum);
      hi = Math.max(hi, sum);
    }
  }
  const gray = Buffer.alloc(SIZE * SIZE);
  for (let i = 0; i < density.length; i++) gray[i] = Math.round(((density[i] - lo) / (hi - lo)) * 255);
  await sharp(gray, { raw: { width: SIZE, height: SIZE, channels: 1 } })
    .png({ compressionLevel: 9 })
    .toFile(out('clouds.png'));
}

/* ------------------------------------------------------------------ */
/* 8c. Close-zoom detail layers                                        */

// Three CC0 ground photos reduced to tileable, zero-mean (128) high-pass
// luminance, one per channel. The runtime multiplies them into the albedo
// by slope/land colour at close zoom only; colour stays the satellite's.
console.log('writing detail layers…');
{
  const SIZE = 512;
  const sources = ['Ground037.jpg', 'Rock030.jpg', 'Ground054.jpg']; // R, G, B
  const packed = Buffer.alloc(SIZE * SIZE * 3);
  /** Separable box blur with wrap-around (keeps the tile seamless). */
  const boxBlurWrap = (src, radius) => {
    const tmp = new Float32Array(src.length);
    const dst = new Float32Array(src.length);
    const n = radius * 2 + 1;
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        let sum = 0;
        for (let k = -radius; k <= radius; k++) sum += src[y * SIZE + ((x + k + SIZE) % SIZE)];
        tmp[y * SIZE + x] = sum / n;
      }
    }
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        let sum = 0;
        for (let k = -radius; k <= radius; k++) sum += tmp[((y + k + SIZE) % SIZE) * SIZE + x];
        dst[y * SIZE + x] = sum / n;
      }
    }
    return dst;
  };
  for (let c = 0; c < 3; c++) {
    const gray = await sharp(join(dir, 'assets', 'detail', sources[c]))
      .resize(SIZE, SIZE, { kernel: 'lanczos3' })
      .greyscale()
      .raw()
      .toBuffer();
    const lum = Float32Array.from(gray);
    let low = lum;
    for (let pass = 0; pass < 3; pass++) low = boxBlurWrap(low, 10);
    const hp = new Float32Array(lum.length);
    let sq = 0;
    for (let i = 0; i < lum.length; i++) {
      hp[i] = lum[i] - low[i];
      sq += hp[i] * hp[i];
    }
    const std = Math.sqrt(sq / hp.length) || 1;
    for (let i = 0; i < hp.length; i++) {
      packed[i * 3 + c] = Math.round(Math.min(255, Math.max(0, 128 + (hp[i] / std) * 34)));
    }
  }
  await mkdir(join(dir, '..', 'public', 'textures', 'detail'), { recursive: true });
  await sharp(packed, { raw: { width: SIZE, height: SIZE, channels: 3 } })
    .png({ compressionLevel: 9 })
    .toFile(join(dir, '..', 'public', 'textures', 'detail', 'detail-mix.png'));
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
