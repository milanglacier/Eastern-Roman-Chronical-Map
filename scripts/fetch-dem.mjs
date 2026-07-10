/**
 * One-time fetch: download AWS Terrain Tiles (Terrarium encoding) covering the
 * map bbox, composite them into a single web-mercator mosaic, and write the
 * committed asset consumed by build-world-textures.mjs. Like coastline-50m.json,
 * the output is committed so the bake step never needs the network; rerun only
 * to change the bbox or zoom.
 *
 * Source: AWS Open Data "Terrain Tiles" (no key required), Terrarium PNG:
 *   https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png
 *   elevation_meters = (R * 256 + G + B / 256) - 32768
 * At low/mid zooms the source blends GMTED2010 land with ETOPO1 bathymetry —
 * exactly the ETOPO-class relief (including sea floor) we want.
 * Fallback source if the S3 bucket ever disappears: NOAA ETOPO 2022 60-arcsecond
 * GeoTIFF, https://www.ncei.noaa.gov/products/etopo-global-relief-model
 * (float32 GeoTIFF; would need a different decode path).
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ZOOM = 7;
const TILE_SIZE = 256;
const CONCURRENCY = 6;

// Map bbox from src/lib/hex.ts, padded 1° so edge pixels sample cleanly.
const PAD = 1;
const LON_MIN = -12 - PAD, LON_MAX = 60 + PAD;
const LAT_MIN = 24 - PAD, LAT_MAX = 59 + PAD;

const n = 2 ** ZOOM;
const lonToTileX = (lon) => ((lon + 180) / 360) * n;
const latToTileY = (lat) => {
  const rad = (lat * Math.PI) / 180;
  return ((1 - Math.asinh(Math.tan(rad)) / Math.PI) / 2) * n;
};

const tileXMin = Math.floor(lonToTileX(LON_MIN));
const tileXMax = Math.floor(lonToTileX(LON_MAX));
const tileYMin = Math.floor(latToTileY(LAT_MAX)); // note: y grows southward
const tileYMax = Math.floor(latToTileY(LAT_MIN));

const tilesX = tileXMax - tileXMin + 1;
const tilesY = tileYMax - tileYMin + 1;
const width = tilesX * TILE_SIZE;
const height = tilesY * TILE_SIZE;
console.log(
  `zoom ${ZOOM}: tiles x ${tileXMin}..${tileXMax}, y ${tileYMin}..${tileYMax} ` +
    `(${tilesX * tilesY} tiles, mosaic ${width}x${height})`,
);

const mosaic = Buffer.alloc(width * height * 3);

async function fetchTile(tx, ty) {
  const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${ZOOM}/${tx}/${ty}.png`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch failed ${res.status}: ${url}`);
  const png = Buffer.from(await res.arrayBuffer());
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.width !== TILE_SIZE || info.height !== TILE_SIZE || info.channels !== 3) {
    throw new Error(`unexpected tile shape ${info.width}x${info.height}x${info.channels}: ${url}`);
  }
  const ox = (tx - tileXMin) * TILE_SIZE;
  const oy = (ty - tileYMin) * TILE_SIZE;
  for (let row = 0; row < TILE_SIZE; row++) {
    data.copy(
      mosaic,
      ((oy + row) * width + ox) * 3,
      row * TILE_SIZE * 3,
      (row + 1) * TILE_SIZE * 3,
    );
  }
}

const jobs = [];
for (let ty = tileYMin; ty <= tileYMax; ty++) {
  for (let tx = tileXMin; tx <= tileXMax; tx++) jobs.push([tx, ty]);
}
let done = 0;
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (jobs.length > 0) {
      const [tx, ty] = jobs.pop();
      await fetchTile(tx, ty);
      done++;
      if (done % 50 === 0) console.log(`  ${done}/${tilesX * tilesY} tiles`);
    }
  }),
);

const dir = dirname(fileURLToPath(import.meta.url));
await mkdir(join(dir, 'assets'), { recursive: true });
await sharp(mosaic, { raw: { width, height, channels: 3 } })
  .png({ compressionLevel: 9 })
  .toFile(join(dir, 'assets', 'dem-terrarium-z7.png'));
await writeFile(
  join(dir, 'assets', 'dem-terrarium-z7.json'),
  JSON.stringify(
    {
      source: 'AWS Terrain Tiles (Terrarium), s3://elevation-tiles-prod',
      encoding: 'meters = (R * 256 + G + B / 256) - 32768',
      zoom: ZOOM,
      tileSize: TILE_SIZE,
      tileXMin,
      tileXMax,
      tileYMin,
      tileYMax,
      width,
      height,
    },
    null,
    2,
  ),
);
console.log(`wrote dem-terrarium-z7.png (${width}x${height}) + sidecar`);
