/**
 * One-time fetch: download NASA Blue Marble Next Generation (BMNG) true-color
 * land imagery covering the map bbox, crop it, and write the committed asset
 * consumed by build-world-textures.mjs. Like the DEM mosaic, the output is
 * committed so the bake never needs the network; rerun only to change the
 * bbox, month, or resolution.
 *
 * Source: NASA Earth Observatory, Blue Marble: Next Generation (Stöckli et al.),
 * July 2004 composite, 500 m/px (240 px/degree) plate carrée tiles, no relief
 * shading, no bathymetry. Public domain (NASA imagery is not copyrighted).
 *   https://visibleearth.nasa.gov/images/74092
 * Tiles are 90x90 degrees: B1 = lon -90..0, C1 = lon 0..90, both lat 90..0.
 *
 * Downloads are cached in $BMNG_CACHE (default: os tmpdir) because each tile
 * is 200-400 MB.
 */
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const MONTH = '200407';
const RECORD = 'https://eoimages.gsfc.nasa.gov/images/imagerecords/74000/74092';
const SRC_PX_PER_DEG = 240;
const OUT_PX_PER_DEG = 120;

// Map bbox from src/lib/hex.ts, padded 1° like the DEM mosaic.
const PAD = 1;
const LON_MIN = -12 - PAD, LON_MAX = 60 + PAD;
const LAT_MIN = 24 - PAD, LAT_MAX = 59 + PAD;

const TILES = [
  { name: 'B1', lon0: -90 },
  { name: 'C1', lon0: 0 },
];

const dir = dirname(fileURLToPath(import.meta.url));
const cacheDir = process.env.BMNG_CACHE ?? join(tmpdir(), 'bmng-cache');
await mkdir(cacheDir, { recursive: true });

async function ensureTile(name) {
  const file = join(cacheDir, `world.${MONTH}.${name}.png`);
  const url = `${RECORD}/world.${MONTH}.3x21600x21600.${name}.png`;
  const head = await fetch(url, { method: 'HEAD' });
  const expected = Number(head.headers.get('content-length'));
  const have = await stat(file).then((s) => s.size, () => -1);
  if (have === expected) return file;
  console.log(`downloading ${url} (${(expected / 1e6).toFixed(0)} MB)…`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch failed ${res.status}: ${url}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(file));
  const got = (await stat(file)).size;
  if (got !== expected) throw new Error(`truncated download ${got}/${expected}: ${url}`);
  return file;
}

const top = (90 - LAT_MAX) * SRC_PX_PER_DEG;
const cropH = (LAT_MAX - LAT_MIN) * SRC_PX_PER_DEG;
const parts = [];
for (const t of TILES) {
  const lo = Math.max(LON_MIN, t.lon0);
  const hi = Math.min(LON_MAX, t.lon0 + 90);
  if (hi <= lo) continue;
  const file = await ensureTile(t.name);
  const left = (lo - t.lon0) * SRC_PX_PER_DEG;
  const width = (hi - lo) * SRC_PX_PER_DEG;
  console.log(`cropping ${t.name}: lon ${lo}..${hi}`);
  const buf = await sharp(file, { limitInputPixels: false })
    .extract({ left, top, width, height: cropH })
    .removeAlpha()
    .raw()
    .toBuffer();
  parts.push({ buf, width, x: (lo - LON_MIN) * SRC_PX_PER_DEG });
}

const fullW = (LON_MAX - LON_MIN) * SRC_PX_PER_DEG;
const outW = (LON_MAX - LON_MIN) * OUT_PX_PER_DEG;
const outH = (LAT_MAX - LAT_MIN) * OUT_PX_PER_DEG;
const outFile = join(dir, 'assets', 'bmng-crop.jpg');
// Stitch the tile crops row by row (plain buffer copy; sharp's composite
// would add an alpha channel to the raw output).
const full = Buffer.alloc(fullW * cropH * 3);
for (const p of parts) {
  for (let row = 0; row < cropH; row++) {
    p.buf.copy(full, (row * fullW + p.x) * 3, row * p.width * 3, (row + 1) * p.width * 3);
  }
}
await sharp(full, { raw: { width: fullW, height: cropH, channels: 3 }, limitInputPixels: false })
  .resize(outW, outH, { kernel: 'lanczos3' })
  .jpeg({ quality: 90, chromaSubsampling: '4:4:4' })
  .toFile(outFile);

await writeFile(
  join(dir, 'assets', 'bmng-crop.json'),
  JSON.stringify(
    {
      source: `${RECORD}/world.${MONTH}.3x21600x21600.{B1,C1}.png`,
      dataset: 'NASA Blue Marble: Next Generation, July 2004, true color, no shading',
      license: 'Public domain (NASA Earth Observatory imagery)',
      projection: 'plate carree',
      lonMin: LON_MIN,
      lonMax: LON_MAX,
      latMin: LAT_MIN,
      latMax: LAT_MAX,
      width: outW,
      height: outH,
    },
    null,
    2,
  ) + '\n',
);
console.log(`wrote ${outFile} (${outW}x${outH})`);
