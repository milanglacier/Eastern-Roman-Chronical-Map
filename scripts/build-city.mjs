/**
 * Offline bake for a city view's local terrain. Fully offline (inputs are
 * committed assets) and deterministic — run twice, same bytes.
 *
 * Usage: node scripts/build-city.mjs [cityId ...]   (default: every
 *        scripts/assets/city/<id>.json that has a <id>-dem.png beside it)
 *
 * Reads:
 *   scripts/assets/city/<id>.json          bbox, origin, resolution, exaggeration
 *   scripts/assets/city/<id>-dem.png(.json) Terrarium mercator mosaic
 *                                           (node scripts/fetch-dem.mjs --city <id>)
 *
 * Writes (committed) to public/city/<id>/:
 *   heightmap.png   split-byte RGB heights (same codec as the world map)
 *   heightmap.json  sidecar: local frame, resolution, encoding
 *   normal.png      object-space normals of the exaggerated surface
 *   worldmask.png   R = coast SDF (128 = shore, 6 units/px), G = valley-ness
 *   albedo.jpg      2x-resolution painted ground: maquis, dry grass, field
 *                   parcels, orchards, beaches — the pre-modern countryside
 *                   (satellite imagery would show modern Istanbul)
 *
 * Local frame: X = metres east of `origin`, Z = metres south, Y = metres up
 * (exaggerated by verticalExaggeration at runtime).
 */
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { metersToUint16, heightToBytes, HEIGHT_SCALE, HEIGHT_OFFSET, SEA_LEVEL_VALUE } from '../src/lib/heightEncoding.ts';
import { signedDistanceField } from '../src/lib/distanceField.ts';
import { hashStringSeed, mulberry32 } from '../src/lib/prng.ts';

const dir = dirname(fileURLToPath(import.meta.url));
const cityDir = join(dir, 'assets', 'city');
const M_PER_DEG_LAT = 111320;

/** Land is floored a little above the Y=0 water sheet; sea is carved below. */
const LAND_MIN_M = 1.5;
/** Synthetic bathymetry (SRTM flattens water to 0): shelf slope + cap. */
const SEA_SHORE_DEPTH_M = 3;
const SEA_SLOPE = 0.06; // metres of depth per metre from shore
const SEA_MAX_DEPTH_M = 70;

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const lerp = (a, b, t) => a + (b - a) * t;
const mixRgb = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const smoothstep = (e0, e1, v) => {
  const t = clamp01((v - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

/** Deterministic value noise (non-tiling), smooth-interpolated lattice. */
function makeNoise(seedLabel) {
  const rand = mulberry32(hashStringSeed(seedLabel));
  const SIZE = 256;
  const lattice = new Float32Array(SIZE * SIZE);
  for (let i = 0; i < lattice.length; i++) lattice[i] = rand();
  const at = (x, y) => lattice[(y & (SIZE - 1)) * SIZE + (x & (SIZE - 1))];
  const s = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = s(x - x0);
    const fy = s(y - y0);
    const a = at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx;
    const b = at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx;
    return a * (1 - fy) + b * fy;
  };
}

/** Integer hash → [0,1), for per-parcel choices. */
function hash2(x, y, seed) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + seed) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function boxBlur(src, w, h, r) {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  for (let y = 0; y < h; y++) {
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += src[y * w + Math.min(w - 1, Math.max(0, k))];
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = acc / (2 * r + 1);
      acc += src[y * w + Math.min(w - 1, x + r + 1)] - src[y * w + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += tmp[Math.min(h - 1, Math.max(0, k)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / (2 * r + 1);
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}

async function bakeCity(id) {
  const cfg = JSON.parse(await readFile(join(cityDir, `${id}.json`), 'utf8'));
  const demMeta = JSON.parse(await readFile(join(cityDir, `${id}-dem.json`), 'utf8'));
  const demRaw = await sharp(join(cityDir, `${id}-dem.png`)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
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
  const demAt = (ix, iy) => {
    const x = Math.min(Math.max(ix, 0), DEM_W - 1);
    const y = Math.min(Math.max(iy, 0), DEM_H - 1);
    const o = (y * DEM_W + x) * 3;
    return dem[o] * 256 + dem[o + 1] + dem[o + 2] / 256 - 32768;
  };
  const demSample = (lon, lat) => {
    const x = lonToDemPx(lon);
    const y = latToDemPx(lat);
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const a = demAt(x0, y0) * (1 - fx) + demAt(x0 + 1, y0) * fx;
    const b = demAt(x0, y0 + 1) * (1 - fx) + demAt(x0 + 1, y0 + 1) * fx;
    return a * (1 - fy) + b * fy;
  };

  const [west, south, east, north] = cfg.bbox;
  const [lon0, lat0] = cfg.origin;
  const mPerDegLon = M_PER_DEG_LAT * Math.cos((lat0 * Math.PI) / 180);
  const widthM = (east - west) * mPerDegLon;
  const heightM = (north - south) * M_PER_DEG_LAT;
  const W = Math.round(widthM / cfg.metersPerPixel);
  const H = Math.round(heightM / cfg.metersPerPixel);
  const pxToLon = (x, w) => west + ((x + 0.5) / w) * (east - west);
  const pxToLat = (y, h) => north - ((y + 0.5) / h) * (north - south);
  console.log(`[${id}] ${W}x${H} px @ ${cfg.metersPerPixel} m (${(widthM / 1000).toFixed(1)} x ${(heightM / 1000).toFixed(1)} km)`);

  /* Heights: DEM land, synthetic shelf bathymetry. */
  const raw = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const lat = pxToLat(y, H);
    for (let x = 0; x < W; x++) raw[y * W + x] = demSample(pxToLon(x, W), lat);
  }
  const landMask = new Uint8Array(W * H);
  for (let i = 0; i < landMask.length; i++) landMask[i] = raw[i] > 0.5 ? 1 : 0;
  const land = (i) => landMask[i] === 1;
  const coastSdf = signedDistanceField(W, H, landMask); // px, + on land
  const heights = new Float32Array(W * H);
  for (let i = 0; i < heights.length; i++) {
    if (land(i)) heights[i] = Math.max(LAND_MIN_M, raw[i]);
    else {
      const distM = -coastSdf[i] * cfg.metersPerPixel;
      heights[i] = -Math.min(SEA_MAX_DEPTH_M, SEA_SHORE_DEPTH_M + distM * SEA_SLOPE);
    }
  }

  const outDir = join(dir, '..', 'public', 'city', id);
  await mkdir(outDir, { recursive: true });

  {
    const rgb = Buffer.alloc(W * H * 3);
    for (let i = 0; i < heights.length; i++) {
      const [hi, lo] = heightToBytes(metersToUint16(heights[i]));
      rgb[i * 3] = hi;
      rgb[i * 3 + 1] = lo;
    }
    await sharp(rgb, { raw: { width: W, height: H, channels: 3 } })
      .png({ compressionLevel: 9 })
      .toFile(join(outDir, 'heightmap.png'));
    await writeFile(
      join(outDir, 'heightmap.json'),
      JSON.stringify(
        {
          width: W,
          height: H,
          bbox: { lonMin: west, lonMax: east, latMin: south, latMax: north },
          origin: { lon: lon0, lat: lat0 },
          metersPerPixel: cfg.metersPerPixel,
          sizeMeters: { x: widthM, z: heightM },
          encoding: 'uint16 v = R*256 + G; meters = v * scale + offset',
          scale: HEIGHT_SCALE,
          offset: HEIGHT_OFFSET,
          seaLevelValue: SEA_LEVEL_VALUE,
          verticalExaggeration: cfg.verticalExaggeration,
        },
        null,
        2,
      ) + '\n',
    );
  }

  /* Normals of the exaggerated surface, in local metres. */
  const ex = cfg.verticalExaggeration;
  const hAt = (x, y) => heights[Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))];
  const normalAt = (x, y) => {
    const gx = ((hAt(x + 1, y) - hAt(x - 1, y)) * ex) / (2 * cfg.metersPerPixel);
    const gz = ((hAt(x, y + 1) - hAt(x, y - 1)) * ex) / (2 * cfg.metersPerPixel);
    const inv = 1 / Math.hypot(gx, 1, gz);
    return [-gx * inv, inv, -gz * inv];
  };
  {
    const rgb = Buffer.alloc(W * H * 3);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const n = normalAt(x, y);
        const o = (y * W + x) * 3;
        for (let c = 0; c < 3; c++) rgb[o + c] = Math.round((n[c] * 0.5 + 0.5) * 255);
      }
    }
    await sharp(rgb, { raw: { width: W, height: H, channels: 3 } })
      .png({ compressionLevel: 9 })
      .toFile(join(outDir, 'normal.png'));
  }

  /* Valley-ness: how far below its ~150 m neighbourhood each point sits. */
  const landHeights = heights.map((v) => Math.max(0, v));
  const localMean = boxBlur(boxBlur(landHeights, W, H, 6), W, H, 6);
  const valley = new Float32Array(W * H);
  for (let i = 0; i < valley.length; i++) valley[i] = clamp01((localMean[i] - landHeights[i]) / 12 + 0.5);

  {
    const rgb = Buffer.alloc(W * H * 3);
    for (let i = 0; i < W * H; i++) {
      rgb[i * 3] = Math.round(Math.min(255, Math.max(0, 128 + coastSdf[i] * 6)));
      rgb[i * 3 + 1] = Math.round(valley[i] * 255);
    }
    await sharp(rgb, { raw: { width: W, height: H, channels: 3 } })
      .png({ compressionLevel: 9 })
      .toFile(join(outDir, 'worldmask.png'));
  }

  /* Albedo at 2x: the pre-modern countryside. */
  const AW = W * 2;
  const AH = H * 2;
  const mPerAPx = cfg.metersPerPixel / 2;
  const C = {
    seaFloor: [46, 84, 92],
    sand: [210, 194, 152],
    dryGrass: [178, 160, 106],
    maquis: [104, 114, 66],
    darkScrub: [72, 86, 52],
    rock: [150, 138, 118],
    wheat: [200, 178, 114],
    stubble: [184, 160, 112],
    greenField: [124, 136, 74],
    fallow: [150, 122, 86],
    orchardGround: [150, 142, 96],
    orchardTree: [70, 84, 50],
    vineyard: [134, 128, 80],
    hedge: [88, 96, 58],
  };
  const PARCELS = [C.wheat, C.stubble, C.greenField, C.fallow, C.wheat, C.greenField, C.vineyard];
  const nBroad = makeNoise(`${id}-broad`);
  const nMid = makeNoise(`${id}-mid`);
  const nFine = makeNoise(`${id}-fine`);
  const nWarp = makeNoise(`${id}-warp`);
  const seed = hashStringSeed(`${id}-parcels`);
  const bil = (arr, fx, fy) => {
    const cx = Math.min(Math.max(fx, 0), W - 1);
    const cy = Math.min(Math.max(fy, 0), H - 1);
    const x0 = Math.floor(cx);
    const y0 = Math.floor(cy);
    const x1 = Math.min(x0 + 1, W - 1);
    const y1 = Math.min(y0 + 1, H - 1);
    const tx = cx - x0;
    const ty = cy - y0;
    return (arr[y0 * W + x0] * (1 - tx) + arr[y0 * W + x1] * tx) * (1 - ty) + (arr[y1 * W + x0] * (1 - tx) + arr[y1 * W + x1] * tx) * ty;
  };

  const albedo = Buffer.alloc(AW * AH * 3);
  for (let ay = 0; ay < AH; ay++) {
    for (let ax = 0; ax < AW; ax++) {
      const hx = (ax + 0.5) / 2 - 0.5;
      const hy = (ay + 0.5) / 2 - 0.5;
      const mx = ax * mPerAPx; // metres east of the bbox west edge
      const my = ay * mPerAPx; // metres south of the bbox north edge
      const hM = bil(heights, hx, hy);
      const sdf = bil(coastSdf, hx, hy);
      let rgb;
      if (sdf < 0) {
        rgb = mixRgb(C.sand, C.seaFloor, smoothstep(0, 3, -sdf));
      } else {
        const n = normalAt(Math.round(hx), Math.round(hy));
        const slope = 1 - n[1];
        const vly = bil(valley, hx, hy);
        const broad = nBroad(mx / 900, my / 900);
        const mid = nMid(mx / 180, my / 180);
        const fine = nFine(mx / 24, my / 24);

        // Wild ground: dry summer grass on ridges, maquis in the valleys
        // and on north-facing slopes, darker scrub in the deepest ravines.
        const green = clamp01(smoothstep(0.45, 0.75, vly) * 0.8 + (broad - 0.5) * 0.6 + clamp01(-n[2]) * 1.5 + mid * 0.25 - 0.1);
        let base = mixRgb(C.dryGrass, C.maquis, green);
        base = mixRgb(base, C.darkScrub, smoothstep(0.72, 0.95, vly) * smoothstep(0.4, 0.7, mid));
        base = mixRgb(base, C.rock, smoothstep(0.1, 0.22, slope) * 0.6);

        // Field parcels on gentle, low ground. The land is split into ~1.4 km
        // (warped) estates; each has its own plot orientation and size, so
        // the patchwork changes direction between estates like a real field
        // system instead of swirling around one global origin.
        const farmable =
          (1 - smoothstep(0.03, 0.07, slope)) *
          (1 - smoothstep(90, 160, hM)) *
          smoothstep(0.5, 2.5, sdf) *
          smoothstep(0.32, 0.52, broad);
        if (farmable > 0.01) {
          const wx = mx + (nWarp(mx / 500, my / 500) - 0.5) * 420;
          const wy = my + (nWarp(mx / 500 + 7, my / 500 + 5) - 0.5) * 420;
          const ex = Math.floor(wx / 1400);
          const ey = Math.floor(wy / 1400);
          const angle = hash2(ex, ey, seed + 7) * Math.PI;
          const plotU = 80 + hash2(ex, ey, seed + 8) * 110;
          const plotV = 45 + hash2(ex, ey, seed + 9) * 50;
          const ca = Math.cos(angle);
          const sa = Math.sin(angle);
          const lx = mx + (nWarp(mx / 260, my / 260) - 0.5) * 30;
          const ly = my + (nWarp(mx / 260 + 3, my / 260 + 9) - 0.5) * 30;
          const u = (lx * ca - ly * sa) / plotU;
          const v = (lx * sa + ly * ca) / plotV;
          const cu = Math.floor(u);
          const cv = Math.floor(v);
          const r = hash2(cu + ex * 977, cv + ey * 613, seed);
          let parcel;
          if (r < 0.14) {
            // Orchard / olive grove: dotted tree rows.
            const tu = (u * plotU) / 9;
            const tv = (v * plotV) / 9;
            const dotD = Math.hypot(tu - Math.round(tu), tv - Math.round(tv));
            parcel = mixRgb(C.orchardGround, C.orchardTree, 1 - smoothstep(0.22, 0.38, dotD));
          } else if (r < 0.3) {
            parcel = base; // uncultivated plot: wild ground shows through
          } else {
            parcel = PARCELS[Math.floor(hash2(cu + ex * 977, cv + ey * 613, seed + 1) * PARCELS.length)];
            // Furrows along the plot.
            parcel = parcel.map((c) => c * (0.95 + 0.05 * Math.sin(v * plotV * 1.4)));
          }
          const edgeU = Math.min(u - cu, 1 - (u - cu)) * plotU;
          const edgeV = Math.min(v - cv, 1 - (v - cv)) * plotV;
          const hedge = 1 - smoothstep(1.5, 4.5, Math.min(edgeU, edgeV));
          parcel = mixRgb(parcel, C.hedge, hedge * 0.6);
          base = mixRgb(base, parcel, farmable * 0.8);
        }

        // Shore: a thin beach where land meets sea.
        base = mixRgb(C.sand, base, smoothstep(0.2, 1.4, sdf));
        rgb = base.map((c) => c * (0.9 + fine * 0.16));
      }
      const o = (ay * AW + ax) * 3;
      albedo[o] = Math.round(Math.min(255, rgb[0]));
      albedo[o + 1] = Math.round(Math.min(255, rgb[1]));
      albedo[o + 2] = Math.round(Math.min(255, rgb[2]));
    }
  }
  await sharp(albedo, { raw: { width: AW, height: AH, channels: 3 } })
    .jpeg({ quality: 86, chromaSubsampling: '4:2:0', mozjpeg: false })
    .toFile(join(outDir, 'albedo.jpg'));
  console.log(`[${id}] done`);
}

let ids = process.argv.slice(2);
if (ids.length === 0) {
  ids = (await readdir(cityDir))
    .filter((f) => f.endsWith('.json') && !f.endsWith('-dem.json'))
    .map((f) => f.replace(/\.json$/, ''))
    .filter((cid) => existsSync(join(cityDir, `${cid}-dem.png`)))
    .sort();
}
for (const id of ids) await bakeCity(id);
