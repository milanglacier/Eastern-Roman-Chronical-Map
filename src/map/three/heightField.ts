/**
 * Runtime height field: decodes the split-byte heightmap PNG once into a
 * Float32Array of meters — the single source of truth for terrain vertex
 * displacement, marker projection (`heightAt`) and the water depth tint
 * (`toDataTexture`). See docs in src/lib/heightEncoding.ts for the format.
 */
import { DataTexture, RedFormat, HalfFloatType, LinearFilter, ClampToEdgeWrapping, DataUtils } from 'three';
import { z } from 'zod';
import { bytesToMeters } from '../../lib/heightEncoding';
import { LON_MIN, LON_MAX, LAT_MIN, LAT_MAX } from '../../lib/hex';

export const HeightmapMetaSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  bbox: z.object({
    lonMin: z.number(),
    lonMax: z.number(),
    latMin: z.number(),
    latMax: z.number(),
  }),
  scale: z.number(),
  offset: z.number(),
  verticalExaggeration: z.number().positive(),
  unitsPerDegree: z.number().positive(),
  metersPerWorldUnit: z.number().positive(),
});
export type HeightmapMeta = z.infer<typeof HeightmapMetaSchema>;

export interface HeightField {
  width: number;
  height: number;
  meta: HeightmapMeta;
  /** Meters, row-major, row 0 = north. */
  data: Float32Array;
  /** Bilinear height in meters at a lon/lat. */
  heightAt(lon: number, lat: number): number;
  /** World-unit Y (vertical exaggeration applied) at a lon/lat. */
  yAt(lon: number, lat: number): number;
  /** Meters → world-unit Y. */
  metersToY(meters: number): number;
}

function makeHeightField(width: number, height: number, meta: HeightmapMeta, data: Float32Array): HeightField {
  const { bbox } = meta;
  const metersToY = (m: number) => (m * meta.verticalExaggeration) / meta.metersPerWorldUnit;
  const heightAt = (lon: number, lat: number): number => {
    const fx = ((lon - bbox.lonMin) / (bbox.lonMax - bbox.lonMin)) * width - 0.5;
    const fy = ((bbox.latMax - lat) / (bbox.latMax - bbox.latMin)) * height - 0.5;
    const cx = Math.min(Math.max(fx, 0), width - 1);
    const cy = Math.min(Math.max(fy, 0), height - 1);
    const x0 = Math.floor(cx);
    const y0 = Math.floor(cy);
    const x1 = Math.min(x0 + 1, width - 1);
    const y1 = Math.min(y0 + 1, height - 1);
    const tx = cx - x0;
    const ty = cy - y0;
    const a = data[y0 * width + x0] * (1 - tx) + data[y0 * width + x1] * tx;
    const b = data[y1 * width + x0] * (1 - tx) + data[y1 * width + x1] * tx;
    return a * (1 - ty) + b * ty;
  };
  return {
    width,
    height,
    meta,
    data,
    heightAt,
    metersToY,
    yAt: (lon, lat) => metersToY(heightAt(lon, lat)),
  };
}

const FALLBACK_META: HeightmapMeta = {
  width: 2,
  height: 2,
  bbox: { lonMin: LON_MIN, lonMax: LON_MAX, latMin: LAT_MIN, latMax: LAT_MAX },
  scale: 0.25,
  offset: -8192,
  verticalExaggeration: 2.5,
  metersPerWorldUnit: 111320 / 4,
  unitsPerDegree: 4,
};

/** Flat sea-level field so the scene still boots if assets are missing. */
export function fallbackHeightField(): HeightField {
  return makeHeightField(2, 2, FALLBACK_META, new Float32Array(4));
}

/**
 * Fetch + decode public/terrain/heightmap.{png,json}. Returns the fallback
 * (with a console warning) on any failure — same philosophy as the old
 * procedural-atlas fallback: missing art must never blank the app.
 */
export async function loadHeightField(baseUrl = 'terrain/'): Promise<HeightField> {
  try {
    const [metaRes, imgRes] = await Promise.all([
      fetch(`${baseUrl}heightmap.json`),
      fetch(`${baseUrl}heightmap.png`),
    ]);
    if (!metaRes.ok || !imgRes.ok) throw new Error(`heightmap fetch ${metaRes.status}/${imgRes.status}`);
    const meta = HeightmapMetaSchema.parse(await metaRes.json());
    const bitmap = await createImageBitmap(await imgRes.blob(), {
      premultiplyAlpha: 'none',
      colorSpaceConversion: 'none',
    });
    const { width: bw, height: bh } = bitmap;
    if (bw !== meta.width || bh !== meta.height) {
      throw new Error('heightmap.png dimensions disagree with sidecar');
    }
    const canvas = document.createElement('canvas');
    canvas.width = bw;
    canvas.height = bh;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('2d context unavailable');
    ctx.drawImage(bitmap, 0, 0);
    const { data: rgba } = ctx.getImageData(0, 0, bw, bh);
    bitmap.close();
    const meters = new Float32Array(meta.width * meta.height);
    for (let i = 0; i < meters.length; i++) {
      meters[i] = bytesToMeters(rgba[i * 4], rgba[i * 4 + 1]);
    }
    return makeHeightField(meta.width, meta.height, meta, meters);
  } catch (err) {
    console.warn('height field unavailable, using flat fallback:', err);
    return fallbackHeightField();
  }
}

/**
 * Height field as a half-float R texture in world-unit Y (exaggerated), for
 * the water shader's depth tint. Half-float linear filtering is core WebGL2.
 */
export function heightFieldToDataTexture(hf: HeightField): DataTexture {
  const half = new Uint16Array(hf.width * hf.height);
  for (let i = 0; i < half.length; i++) {
    half[i] = DataUtils.toHalfFloat(hf.metersToY(hf.data[i]));
  }
  const tex = new DataTexture(half, hf.width, hf.height, RedFormat, HalfFloatType);
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearFilter;
  tex.wrapS = ClampToEdgeWrapping;
  tex.wrapT = ClampToEdgeWrapping;
  tex.flipY = false;
  tex.needsUpdate = true;
  return tex;
}
