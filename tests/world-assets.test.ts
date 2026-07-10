/**
 * Regression tests for the baked world assets in public/terrain/. Runs in
 * Node (sharp devDep) against the committed files — successor to the old
 * tile-grid strait tests: the six straits must stay open water and known
 * inland anchors must stay land, at heightmap resolution.
 */
import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { bytesToMeters, HEIGHT_SCALE, HEIGHT_OFFSET } from '../src/lib/heightEncoding';
import { LON_MIN, LON_MAX, LAT_MIN, LAT_MAX } from '../src/lib/hex';

const terrainDir = join(__dirname, '..', 'public', 'terrain');

interface Heightmap {
  width: number;
  height: number;
  data: Buffer;
  meta: {
    width: number;
    height: number;
    bbox: { lonMin: number; lonMax: number; latMin: number; latMax: number };
    scale: number;
    offset: number;
    verticalExaggeration: number;
    unitsPerDegree: number;
    metersPerWorldUnit: number;
  };
}

let cached: Heightmap | null = null;
async function loadHeightmap(): Promise<Heightmap> {
  if (cached) return cached;
  const meta = JSON.parse(await readFile(join(terrainDir, 'heightmap.json'), 'utf8'));
  const { data, info } = await sharp(join(terrainDir, 'heightmap.png'))
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  expect(info.channels).toBe(3);
  cached = { width: info.width, height: info.height, data, meta };
  return cached;
}

function metersAtLonLat(hm: Heightmap, lon: number, lat: number): number {
  const { bbox } = hm.meta;
  const x = Math.round(((lon - bbox.lonMin) / (bbox.lonMax - bbox.lonMin)) * hm.width - 0.5);
  const y = Math.round(((bbox.latMax - lat) / (bbox.latMax - bbox.latMin)) * hm.height - 0.5);
  const o = (y * hm.width + x) * 3;
  return bytesToMeters(hm.data[o], hm.data[o + 1]);
}

describe('heightmap sidecar', () => {
  it('matches the PNG dimensions and documents the encoding', async () => {
    const hm = await loadHeightmap();
    expect(hm.meta.width).toBe(hm.width);
    expect(hm.meta.height).toBe(hm.height);
    expect(hm.meta.scale).toBe(HEIGHT_SCALE);
    expect(hm.meta.offset).toBe(HEIGHT_OFFSET);
    expect(hm.meta.verticalExaggeration).toBeGreaterThan(1);
    expect(hm.meta.unitsPerDegree).toBe(4);
    expect(hm.meta.metersPerWorldUnit).toBeCloseTo(111320 / 4, 3);
  });

  it('covers the same bbox as the hex-era data conventions', async () => {
    const hm = await loadHeightmap();
    expect(hm.meta.bbox).toEqual({
      lonMin: LON_MIN,
      lonMax: LON_MAX,
      latMin: LAT_MIN,
      latMax: LAT_MAX,
    });
  });
});

describe('straits stay open water', () => {
  // Same six channels the tile pipeline had to force open; sampled at their
  // configured coordinates (scripts/assets/terrain-config.json).
  const straitPoints: Array<[string, number, number]> = [
    ['Gibraltar', -5.91, 36.28],
    ['Gibraltar south', -5.59, 35.83],
    ['Bonifacio', 8.83, 41.6],
    ['Messina', 15.24, 38.05],
    ['Dardanelles west', 26.13, 40.71],
    ['Dardanelles east', 26.77, 40.71],
    ['Bosporus', 29.4, 41.15],
    ['Kerch', 36.39, 45.15],
    ['Oresund', 12.68, 55.8],
    // Wide enough to survive DEM sampling without a config entry; pinned so
    // a future resolution change can't silently close them.
    ['Dover', 1.4, 51.0],
    ['Hormuz', 56.5, 26.6],
  ];

  it.each(straitPoints)('%s is below sea level', async (_name, lon, lat) => {
    const hm = await loadHeightmap();
    expect(metersAtLonLat(hm, lon, lat)).toBeLessThan(0);
  });
});

describe('land anchors stay land', () => {
  const landPoints: Array<[string, number, number]> = [
    ['Rome', 12.5, 41.9],
    ['Ankara', 32.85, 39.93],
    ['Antioch', 36.16, 36.2],
    ['Alexandria hinterland', 30.0, 30.8],
    ['Constantinople (European side)', 28.9, 41.1],
    ['Londinium', -0.1, 51.5],
    ['Lutetia', 2.35, 48.85],
    ['Persepolis', 52.9, 29.9],
  ];

  it.each(landPoints)('%s is above sea level', async (_name, lon, lat) => {
    const hm = await loadHeightmap();
    expect(metersAtLonLat(hm, lon, lat)).toBeGreaterThan(0);
  });

  it('open Mediterranean is deep', async () => {
    const hm = await loadHeightmap();
    expect(metersAtLonLat(hm, 18, 35)).toBeLessThan(-1000);
  });

  it('the Anatolian plateau reads as highland', async () => {
    const hm = await loadHeightmap();
    expect(metersAtLonLat(hm, 33, 38.8)).toBeGreaterThan(700);
  });
});

describe('companion textures', () => {
  it('normal, worldmask share heightmap dimensions; albedo shares its aspect', async () => {
    const hm = await loadHeightmap();
    const normal = await sharp(join(terrainDir, 'normal.png')).metadata();
    const mask = await sharp(join(terrainDir, 'worldmask.png')).metadata();
    const albedo = await sharp(join(terrainDir, 'albedo.jpg')).metadata();
    const water = await sharp(join(terrainDir, 'waternormal.png')).metadata();
    expect([normal.width, normal.height]).toEqual([hm.width, hm.height]);
    expect([mask.width, mask.height]).toEqual([hm.width, hm.height]);
    expect((albedo.width ?? 0) / (albedo.height ?? 1)).toBeCloseTo(hm.width / hm.height, 2);
    expect(water.width).toBe(water.height);
  });
});
