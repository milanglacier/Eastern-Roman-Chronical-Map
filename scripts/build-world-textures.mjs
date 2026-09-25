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
 *   public/terrain/heightmap.png   2880x1400 split-byte RGB (R=hi, G=lo) heights
 *   public/terrain/heightmap.json  sidecar: bbox, encoding, exaggeration, units
 *   public/terrain/albedo.jpg      8192x3982 painted gouache terrain colour (no baked sun)
 *   public/terrain/worldmask.png   2880x1400 R=coast SDF, G=river mask, B=0 (unused)
 *   public/terrain/waternormal.png 512x512 tileable water-wave normal map
 *   public/terrain/granulation.png 512x512 tileable watercolour granulation (grey)
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
/* 4. Shaped heights + normals (for the flow field and the hillshade)  */

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

/* ------------------------------------------------------------------ */
/* 5. Coast SDF + river mask → worldmask.png; stroke flow field       */

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

/** Separable box blur (clamped edges), `passes` times — ~Gaussian at 3. */
function boxBlur(src, w, h, radius, passes = 3) {
  let a = Float32Array.from(src);
  let b = new Float32Array(src.length);
  const r = Math.max(1, Math.round(radius));
  const inv = 1 / (2 * r + 1);
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let acc = 0;
      for (let k = -r; k <= r; k++) acc += a[row + Math.min(w - 1, Math.max(0, k))];
      for (let x = 0; x < w; x++) {
        b[row + x] = acc * inv;
        acc += a[row + Math.min(w - 1, x + r + 1)] - a[row + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let k = -r; k <= r; k++) acc += b[Math.min(h - 1, Math.max(0, k)) * w + x];
      for (let y = 0; y < h; y++) {
        a[y * w + x] = acc * inv;
        acc += b[Math.min(h - 1, y + r + 1) * w + x] - b[Math.max(0, y - r) * w + x];
      }
    }
  }
  return a;
}

// The EDT of a binary mask is stair-stepped along diagonal coasts; a light
// blur rounds the contour for everything painted from it (coast rim, ink
// line, ripples, foam).
const coastSdfSmooth = boxBlur(coastSdf, HM_W, HM_H, 1, 2);

// Stroke flow field for the albedo brushwork (LIC, section 7): strokes
// follow the contours (perpendicular to the gradient of the broadly
// blurred relief) on slopes, and a slow domain-warped swirl on flats.
// Angles are blended as doubled-angle vectors because a stroke direction
// is only defined modulo 180°.
console.log('  flow field…');
const reliefSoft = boxBlur(heightsShaped, HM_W, HM_H, 3);
const flowNoise = makeValueNoise('east-roman-flow', 128);
const flowX = new Float32Array(HM_W * HM_H);
const flowY = new Float32Array(HM_W * HM_H);
for (let y = 0; y < HM_H; y++) {
  for (let x = 0; x < HM_W; x++) {
    const i = y * HM_W + x;
    const gx = reliefSoft[y * HM_W + Math.min(HM_W - 1, x + 1)] - reliefSoft[y * HM_W + Math.max(0, x - 1)];
    const gy = reliefSoft[Math.min(HM_H - 1, y + 1) * HM_W + x] - reliefSoft[Math.max(0, y - 1) * HM_W + x];
    const mag = Math.hypot(gx, gy);
    const tangent = Math.atan2(gy, gx) + Math.PI / 2;
    const wx = (flowNoise(x * 0.012 + 3.1, y * 0.012 + 7.7) - 0.5) * 6;
    const wy = (flowNoise(x * 0.012 + 11.3, y * 0.012 + 1.9) - 0.5) * 6;
    const swirl = flowNoise(x * 0.006 + wx, y * 0.006 + wy) * Math.PI * 2.4;
    let wSlope = smoothstep(30, 220, mag);
    let theta = tangent;
    if (!landMask[i]) {
      // Sea: strokes run parallel to the nearest coast, fading to a
      // gentle east-west drift offshore.
      const sgx = coastSdfSmooth[y * HM_W + Math.min(HM_W - 1, x + 1)] - coastSdfSmooth[y * HM_W + Math.max(0, x - 1)];
      const sgy = coastSdfSmooth[Math.min(HM_H - 1, y + 1) * HM_W + x] - coastSdfSmooth[Math.max(0, y - 1) * HM_W + x];
      theta = Math.atan2(sgy, sgx) + Math.PI / 2;
      wSlope = 1 - smoothstep(6, 20, -coastSdf[i]);
    }
    const drift = landMask[i] ? swirl : 0.12 * (swirl - Math.PI);
    const vx = wSlope * Math.cos(2 * theta) + (1 - wSlope) * Math.cos(2 * drift);
    const vy = wSlope * Math.sin(2 * theta) + (1 - wSlope) * Math.sin(2 * drift);
    // Canonical half-turn [0, π): fixes the vector's sign, which the LIC
    // walk (and so the albedo bytes) depends on.
    let ang = Math.atan2(vy, vx) / 2;
    if (ang < 0) ang += Math.PI;
    flowX[i] = Math.cos(ang);
    flowY[i] = Math.sin(ang);
  }
}

{
  const rgb = Buffer.alloc(HM_W * HM_H * 3);
  for (let i = 0; i < riverMask.length; i++) {
    // R: 128 = coastline, ±6 units per px, saturating ~21 px from shore.
    rgb[i * 3] = Math.round(Math.min(255, Math.max(0, 128 + coastSdfSmooth[i] * 6)));
    rgb[i * 3 + 1] = Math.round(riverMask[i] * 255);
  }
  await sharp(rgb, { raw: { width: HM_W, height: HM_H, channels: 3 } })
    .png({ compressionLevel: 9 })
    .toFile(out('worldmask.png'));
}

/* ------------------------------------------------------------------ */
/* 6. Hillshade (preview only — the albedo bakes no directional sun;   */
/*    the era moods move the real-time key light)                      */

console.log('building hillshade…');
const SUN = (() => {
  const az = (247 * Math.PI) / 180; // WSW
  const alt = (48 * Math.PI) / 180;
  return [Math.sin(az) * Math.cos(alt), Math.sin(alt), -Math.cos(az) * Math.cos(alt)];
})();
const HILLSHADE_BOOST = 2;
const hillshade = new Float32Array(HM_W * HM_H);
for (let y = 0; y < HM_H; y++) {
  for (let x = 0; x < HM_W; x++) {
    const [nx, ny, nz] = normalAt(x, y, HILLSHADE_BOOST);
    hillshade[y * HM_W + x] = Math.max(0, nx * SUN[0] + ny * SUN[1] + nz * SUN[2]);
  }
}

/* ------------------------------------------------------------------ */
/* 7. Albedo: the painted pigment base (chronicle washes, clockwork   */
/*    regional tint read their colour from it)                         */

console.log('painting albedo…');

// Region overrides as feathered weights (a hard polygon reads as a survey
// rectangle once the palette is banded): one blurred mask per terrain.
const regionWeight = { desert: new Float32Array(HM_W * HM_H), plains: new Float32Array(HM_W * HM_H), grass: new Float32Array(HM_W * HM_H) };
for (const region of config.regions) {
  const target = regionWeight[region.terrain];
  if (!target) continue;
  const mask = fillPolygonsMask([region.polygon], HM_W, HM_H);
  for (let i = 0; i < mask.length; i++) if (mask[i]) target[i] = 1;
}
for (const key of Object.keys(regionWeight)) regionWeight[key] = boxBlur(regionWeight[key], HM_W, HM_H, 9, 3);
// Green corridors override deserts (Nile valley, coastal strips): feathered 0..1.
const PX_PER_DEG_HM = HM_W / LON_SPAN;
const corridor = new Float32Array(HM_W * HM_H);
for (const c of config.greenCorridors) {
  const radius = c.buffer * PX_PER_DEG_HM;
  stampPolyline(c.line, HM_W, HM_H, radius * 1.8, (i, d) => {
    corridor[i] = Math.max(corridor[i], 1 - smoothstep(radius * 0.3, radius * 1.8, d));
  });
}

// Painted ambient occlusion: relief relative to its neighbourhood at three
// scales (valleys < 0 < ridges), normalized per scale. Drives a warm/cool
// colour shift rather than plain darkening.
console.log('  painted occlusion…');
const cavity = new Float32Array(HM_W * HM_H);
for (const [radius, scaleM, weight] of [
  [3, 140, 0.3],
  [8, 320, 0.4],
  [20, 700, 0.3],
]) {
  const blurred = boxBlur(heightsShaped, HM_W, HM_H, radius);
  for (let i = 0; i < cavity.length; i++) {
    cavity[i] += Math.tanh((heightsShaped[i] - blurred[i]) / scaleM) * weight;
  }
}
const cavitySoft = boxBlur(cavity, HM_W, HM_H, 1, 2);

const hex = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
// Palette (sRGB 0..255) — the gouache swatches from docs/art-direction.md.
const C = {
  deepSea: hex(0x17304e),
  openSea: hex(0x23466a),
  shelfSea: hex(0x3a7f86),
  lagoon: hex(0x6aa99c),
  beach: hex(0xe2cf9e),
  forest: hex(0x4d6445),
  meadow: hex(0x778b55),
  farmland: hex(0xa59d62),
  blueForest: hex(0x405847),
  scrub: hex(0x98945a),
  steppe: hex(0xc1aa6d),
  desert: hex(0xd8b073),
  dune: hex(0xc28a55),
  rock: hex(0x8e8391),
  highRock: hex(0xa79a96),
  snow: hex(0xf2ecdf),
  snowShade: hex(0xb9b3cf),
  ridgeWarm: hex(0xd9b980),
  hollowCool: hex(0x5a4658),
  ink: hex(0x3b2a22),
  riverWater: hex(0x3d6f7c),
};

/** Aridity (0 wet … 1 desert) → colour along the painted biome ramp. */
function biomeColor(a, variant) {
  const wet = mixRgb(C.forest, C.meadow, variant);
  if (a < 0.3) return mixRgb(wet, C.meadow, smoothstep(0.0, 0.3, a) * 0.6);
  if (a < 0.5) return mixRgb(mixRgb(wet, C.meadow, 0.6), C.scrub, smoothstep(0.3, 0.5, a));
  if (a < 0.72) return mixRgb(C.scrub, C.steppe, smoothstep(0.5, 0.72, a));
  return mixRgb(C.steppe, mixRgb(C.desert, C.dune, variant * 0.6), smoothstep(0.72, 0.92, a));
}

/** Gouache banding: soft steps so colour sits in flat areas with soft edges. */
const BANDS = 6;
const BAND_SOFT = 0.32;
function band(v) {
  const s = v * BANDS;
  const f = s - Math.floor(s);
  return (Math.floor(s) + smoothstep(0.5 - BAND_SOFT, 0.5 + BAND_SOFT, f)) / BANDS;
}
/** 1 at the middle of a band transition, 0 inside a flat band. */
function bandEdge(v) {
  const f = v * BANDS - Math.floor(v * BANDS);
  return 1 - smoothstep(0, BAND_SOFT, Math.abs(f - 0.5));
}

const noiseBiome = makeValueNoise('east-roman-biome', 256);
const noiseDetail = makeValueNoise('east-roman-detail', 256);

const ALB_PER_HM_X = ALB_W / HM_W;
const albedo = Buffer.alloc(ALB_W * ALB_H * 3);
const hmX = (ax) => ((ax + 0.5) / ALB_W) * HM_W - 0.5;
const hmY = (ay) => ((ay + 0.5) / ALB_H) * HM_H - 0.5;

for (let y = 0; y < ALB_H; y++) {
  const lat = pxToLat(y, ALB_H);
  for (let x = 0; x < ALB_W; x++) {
    const sx = hmX(x);
    const sy = hmY(y);
    const hMeters = sampleBilinear(heights, HM_W, HM_H, sx, sy);
    const sdf = sampleBilinear(coastSdfSmooth, HM_W, HM_H, sx, sy);
    const nBiome = noiseBiome(x * 0.013, y * 0.013) * 0.65 + noiseBiome(x * 0.051, y * 0.051) * 0.35;
    const nDetail = noiseDetail(x * 0.11, y * 0.11);

    let rgb;
    if (sdf < 0.5) {
      // Water: ultramarine deeps → turquoise shelf → pale lagoon at the shore.
      const depth = clamp01(-hMeters / 2600);
      rgb = mixRgb(C.openSea, C.deepSea, smoothstep(0.1, 0.6, depth));
      const shelf = 1 - smoothstep(0, 14, -sdf);
      rgb = mixRgb(rgb, C.shelfSea, clamp01(shelf * 0.8) * (1 - smoothstep(0.05, 0.3, depth)));
      rgb = mixRgb(rgb, C.lagoon, (1 - smoothstep(-3.5, -0.5, -Math.abs(sdf))) * 0.35);
      rgb = rgb.map((v) => v * (0.95 + nBiome * 0.1));
    } else {
      // Land: aridity from latitude + region overrides + corridors. The
      // region lookup is domain-warped so hand-drawn polygon borders become
      // wobbly organic transitions instead of straight survey lines.
      const warpX = (noiseBiome(x * 0.003 + 7.3, y * 0.003 + 2.1) - 0.5) * 70;
      const warpY = (noiseBiome(x * 0.003 + 13.9, y * 0.003 + 8.7) - 0.5) * 70;
      const rsx = sx + warpX / ALB_PER_HM_X;
      const rsy = sy + warpY / ALB_PER_HM_X;
      const wDesert = sampleBilinear(regionWeight.desert, HM_W, HM_H, rsx, rsy);
      const wPlains = sampleBilinear(regionWeight.plains, HM_W, HM_H, rsx, rsy);
      const wGrass = sampleBilinear(regionWeight.grass, HM_W, HM_H, rsx, rsy);
      const green = clamp01(sampleBilinear(corridor, HM_W, HM_H, sx, sy));

      // Band on a SMOOTH aridity (broad noise only): banding fine noise
      // makes camouflage blotches. Fine variation is added as colour below.
      const nBroad = noiseBiome(x * 0.004, y * 0.004) * 0.6 + noiseBiome(x * 0.013, y * 0.013) * 0.4;
      let aridity = clamp01((44 - lat) / 16); // 0 north … 1 south
      aridity += (nBroad - 0.5) * 0.3;
      aridity = lerp(aridity, Math.max(aridity, 0.92), wDesert);
      aridity = lerp(aridity, clamp01(Math.max(aridity, 0.55)), wPlains);
      aridity = lerp(aridity, Math.min(aridity, 0.25), wGrass);
      aridity = clamp01(aridity - green * 0.75);

      const a = band(aridity);
      let base = biomeColor(a, clamp01(nBiome * 1.3 - 0.15));
      // Broad painterly patches in the wet lands: golden fields, blue-green woods.
      const wetT = 1 - smoothstep(0.35, 0.6, a);
      const patch = noiseBiome(x * 0.0025 + 40.1, y * 0.0025 + 17.3);
      base = mixRgb(base, C.farmland, wetT * smoothstep(0.55, 0.8, patch) * 0.45);
      base = mixRgb(base, C.blueForest, wetT * (1 - smoothstep(0.2, 0.42, patch)) * 0.5);
      base = base.map((v) => v * (1 - 0.04 * bandEdge(aridity)));

      // Elevation: soft-stepped rock, then snow above a lat-adjusted snowline.
      const rockT = band(smoothstep(900, 2200, hMeters) * 0.999) ;
      base = mixRgb(base, mixRgb(C.rock, C.highRock, nDetail), rockT);
      const snowline = 2900 - (lat - LAT_MIN) * 44; // ~2900 m south → ~1800 m north
      const snowT = smoothstep(snowline, snowline + 380, hMeters);

      // Painted occlusion: ridges warm and lift, hollows cool and sink.
      const cav = sampleBilinear(cavitySoft, HM_W, HM_H, sx, sy);
      const ridge = clamp01(cav * 1.3);
      const hollow = clamp01(-cav * 1.3);
      base = mixRgb(base, C.ridgeWarm, ridge * 0.18);
      base = mixRgb(base, C.hollowCool, hollow * 0.2).map((v) => v * (1 - hollow * 0.1));
      // Snow on top: cream in the light, lavender in the folds.
      base = mixRgb(base, mixRgb(C.snow, C.snowShade, hollow * 0.8), snowT);

      // Beach rim right at the waterline, then an umber ink line on the coast.
      base = mixRgb(base, C.beach, (1 - smoothstep(0.45, 1.7, sdf)) * 0.7);
      base = mixRgb(base, C.ink, (1 - smoothstep(0.35, 0.95, sdf)) * 0.38);

      // Pigment mottle.
      base = base.map((v) => v * (0.94 + nDetail * 0.1));
      rgb = base;
    }
    const o = (y * ALB_W + x) * 3;
    albedo[o] = Math.round(Math.min(255, Math.max(0, rgb[0])));
    albedo[o + 1] = Math.round(Math.min(255, Math.max(0, rgb[1])));
    albedo[o + 2] = Math.round(Math.min(255, Math.max(0, rgb[2])));
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
  const riparian = mixRgb(C.forest, C.meadow, 0.45);
  for (let i = 0; i < riparianCov.length; i++) {
    if (riparianCov[i] === 0 && waterCov[i] === 0) continue;
    const ra = (riparianCov[i] / 255) * 0.34;
    const wa = (waterCov[i] / 255) * 0.85;
    const o = i * 3;
    for (let c = 0; c < 3; c++) {
      const banked = lerp(albedo[o + c], riparian[c], ra);
      albedo[o + c] = Math.round(lerp(banked, C.riverWater[c], wa));
    }
  }
}

// Brushwork: line-integral convolution of white noise along the flow
// field, so the land carries long strokes that follow the contours. The
// stroke strength itself varies slowly, like a painter's pressure.
console.log('brushing strokes (LIC)…');
{
  const L = 7;
  const hash = (ix, iy) => {
    let h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const flowAt = (ax, ay) => {
    const hx = Math.min(HM_W - 1, Math.max(0, Math.round(ax / ALB_PER_HM - 0.5)));
    const hy = Math.min(HM_H - 1, Math.max(0, Math.round(ay / ALB_PER_HM - 0.5)));
    const i = hy * HM_W + hx;
    return [flowX[i], flowY[i]];
  };
  const pressure = makeValueNoise('east-roman-pressure', 128);
  for (let y = 0; y < ALB_H; y++) {
    for (let x = 0; x < ALB_W; x++) {
      const o = (y * ALB_W + x) * 3;
      let sum = hash(x, y);
      for (const sign of [1, -1]) {
        let px = x;
        let py = y;
        let [dx, dy] = flowAt(x, y);
        dx *= sign;
        dy *= sign;
        for (let k = 0; k < L; k++) {
          let [nx, ny] = flowAt(px, py);
          if (nx * dx + ny * dy < 0) {
            nx = -nx;
            ny = -ny;
          }
          dx = nx;
          dy = ny;
          px += dx;
          py += dy;
          sum += hash(Math.round(px), Math.round(py));
        }
      }
      const lic = sum / (2 * L + 1) - 0.5; // ~±0.15
      const land = sampleBilinear(coastSdf, HM_W, HM_H, x / ALB_PER_HM - 0.5, y / ALB_PER_HM - 0.5) > 0;
      const strength = (0.35 + 0.65 * pressure(x * 0.02, y * 0.02)) * (land ? 1 : 0.4);
      const k = 1 + lic * 0.55 * strength;
      albedo[o] = Math.min(255, Math.round(albedo[o] * k));
      albedo[o + 1] = Math.min(255, Math.round(albedo[o + 1] * k));
      albedo[o + 2] = Math.min(255, Math.round(albedo[o + 2] * k));
    }
  }
}

console.log('writing albedo…');
await sharp(albedo, { raw: { width: ALB_W, height: ALB_H, channels: 3 } })
  .jpeg({ quality: 88, chromaSubsampling: '4:2:0', mozjpeg: false })
  .toFile(out('albedo.jpg'));

/* ------------------------------------------------------------------ */
/* 7b. Granulation tile: tileable watercolour pigment grain            */

console.log('writing granulation tile…');
{
  const SIZE = 512;
  const PERIOD = 16;
  const gA = makeValueNoise('east-roman-granule-a', PERIOD);
  const gB = makeValueNoise('east-roman-granule-b', PERIOD * 4);
  const grey = Buffer.alloc(SIZE * SIZE);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const u = (x / SIZE) * PERIOD;
      const v = (y / SIZE) * PERIOD;
      grey[y * SIZE + x] = Math.round(clamp01(gA(u, v) * 0.55 + gB(u * 4, v * 4) * 0.45) * 255);
    }
  }
  await sharp(grey, { raw: { width: SIZE, height: SIZE, channels: 1 } })
    .png({ compressionLevel: 9 })
    .toFile(out('granulation.png'));
}

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
