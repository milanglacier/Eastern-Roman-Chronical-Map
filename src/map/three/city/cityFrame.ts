/**
 * Local ground frame of a city view: metres east (+X) and south (+Z) of the
 * city's origin, Y = metres up (exaggerated). Baked by scripts/build-city.mjs
 * into public/city/<id>/, whose heightmap uses the world map's split-byte
 * codec. Everything here is pure except `loadCityHeightField`.
 */
import { z } from 'zod';
import { decodeHeightPng } from '../heightField';

export const M_PER_DEG_LAT = 111320;

export const CitySidecarSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  bbox: z.object({
    lonMin: z.number(),
    lonMax: z.number(),
    latMin: z.number(),
    latMax: z.number(),
  }),
  origin: z.object({ lon: z.number(), lat: z.number() }),
  metersPerPixel: z.number().positive(),
  sizeMeters: z.object({ x: z.number().positive(), z: z.number().positive() }),
  scale: z.number(),
  offset: z.number(),
  verticalExaggeration: z.number().positive(),
});
export type CitySidecar = z.infer<typeof CitySidecarSchema>;

export interface CityFrame {
  meta: CitySidecar;
  /** Local rect of the baked area (metres). */
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  lonLatToLocal(lon: number, lat: number): { x: number; z: number };
  localToLonLat(x: number, z: number): { lon: number; lat: number };
  contains(lon: number, lat: number): boolean;
  /** Local metres → UV over the baked textures (north = V 0). */
  localToUv(x: number, z: number): { u: number; v: number };
}

export function makeCityFrame(meta: CitySidecar): CityFrame {
  const { origin, bbox } = meta;
  const mPerDegLon = M_PER_DEG_LAT * Math.cos((origin.lat * Math.PI) / 180);
  const lonLatToLocal = (lon: number, lat: number) => ({
    x: (lon - origin.lon) * mPerDegLon,
    z: (origin.lat - lat) * M_PER_DEG_LAT,
  });
  const nw = lonLatToLocal(bbox.lonMin, bbox.latMax);
  const se = lonLatToLocal(bbox.lonMax, bbox.latMin);
  const bounds = { minX: nw.x, maxX: se.x, minZ: nw.z, maxZ: se.z };
  return {
    meta,
    bounds,
    lonLatToLocal,
    localToLonLat: (x, z) => ({ lon: origin.lon + x / mPerDegLon, lat: origin.lat - z / M_PER_DEG_LAT }),
    contains: (lon, lat) =>
      lon >= bbox.lonMin && lon <= bbox.lonMax && lat >= bbox.latMin && lat <= bbox.latMax,
    localToUv: (x, z) => ({
      u: (x - bounds.minX) / (bounds.maxX - bounds.minX),
      v: (z - bounds.minZ) / (bounds.maxZ - bounds.minZ),
    }),
  };
}

export interface CityHeightField {
  frame: CityFrame;
  width: number;
  height: number;
  /** Metres, row-major, row 0 = north. */
  data: Float32Array;
  /** Bilinear raw metres at a local point. */
  heightAt(x: number, z: number): number;
  /** Scene Y (exaggerated metres) at a local point. */
  yAt(x: number, z: number): number;
  metersToY(meters: number): number;
}

export function makeCityHeightField(frame: CityFrame, data: Float32Array): CityHeightField {
  const { width, height, verticalExaggeration } = frame.meta;
  const metersToY = (m: number) => m * verticalExaggeration;
  const heightAt = (x: number, z: number) => {
    const { u, v } = frame.localToUv(x, z);
    const cx = Math.min(Math.max(u * width - 0.5, 0), width - 1);
    const cy = Math.min(Math.max(v * height - 0.5, 0), height - 1);
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
    frame,
    width,
    height,
    data,
    heightAt,
    yAt: (x, z) => metersToY(heightAt(x, z)),
    metersToY,
  };
}

export async function loadCityHeightField(baseUrl: string): Promise<CityHeightField> {
  const metaRes = await fetch(`${baseUrl}heightmap.json`);
  if (!metaRes.ok) throw new Error(`city sidecar fetch ${metaRes.status}: ${baseUrl}`);
  const meta = CitySidecarSchema.parse(await metaRes.json());
  const data = await decodeHeightPng(`${baseUrl}heightmap.png`, meta.width, meta.height);
  return makeCityHeightField(makeCityFrame(meta), data);
}
