/**
 * Territory rasterization, free of three.js and the DOM so it runs on the
 * main thread and in the territory worker (map/three/territoryWorker.ts)
 * alike: a snapshot's MultiPolygon → RG8 pixels in the shared world UV space
 * (R = antialiased inside-mask clipped to land, G = frontier glow from a
 * distance field).
 */
import type { Territory as TerritoryGeometry } from '../data/schema';
import { distanceTransform } from './distanceField';
import { LON_MIN, LON_MAX, LAT_MIN, LAT_MAX } from './hex';

export const TERRITORY_TEX_W = 1024;
export const TERRITORY_TEX_H = 498; // same 288:140 aspect as the world rect
/** Frontier glow half-width in territory-texture px (~1.7 world units). */
const GLOW_PX = 6;

/**
 * MultiPolygon (lon/lat) → pixel rings in territory-texture space (row 0 =
 * north, matching every world texture). Pure — unit-testable in jsdom.
 */
export function multiPolygonToPixelRings(
  geometry: TerritoryGeometry,
  width = TERRITORY_TEX_W,
  height = TERRITORY_TEX_H,
): number[][][] {
  const rings: number[][][] = [];
  for (const polygon of geometry.coordinates) {
    for (const ring of polygon) {
      rings.push(
        ring.map(([lon, lat]) => [
          ((lon - LON_MIN) / (LON_MAX - LON_MIN)) * width,
          ((LAT_MAX - lat) / (LAT_MAX - LAT_MIN)) * height,
        ]),
      );
    }
  }
  return rings;
}

/**
 * Land coverage in territory-texture space: 2×2 supersamples of the land
 * predicate per texel, averaged so the coast edge stays antialiased after
 * the clip. Pure — unit-testable in jsdom.
 */
export function buildLandMask(
  width: number,
  height: number,
  isLand: (lon: number, lat: number) => boolean,
): Uint8Array {
  const mask = new Uint8Array(width * height);
  const offsets = [0.25, 0.75];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let hits = 0;
      for (const oy of offsets) {
        const lat = LAT_MAX - ((y + oy) / height) * (LAT_MAX - LAT_MIN);
        for (const ox of offsets) {
          const lon = LON_MIN + ((x + ox) / width) * (LON_MAX - LON_MIN);
          if (isLand(lon, lat)) hits++;
        }
      }
      mask[y * width + x] = Math.round((hits * 255) / 4);
    }
  }
  return mask;
}

/** Intersect a polygon coverage mask with the land mask (null = no clip). */
export function clipMaskToLand(mask: Uint8Array, land: Uint8Array | null): Uint8Array {
  if (!land) return mask;
  for (let i = 0; i < mask.length; i++) {
    mask[i] = Math.round((mask[i] * land[i]) / 255);
  }
  return mask;
}

type Canvas2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

/** A 2D canvas: OffscreenCanvas where there is one (always in a worker), else a DOM canvas. */
function canvas2d(w: number, h: number): Canvas2D | null {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(w, h).getContext('2d', { willReadFrequently: true });
  }
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return canvas.getContext('2d', { willReadFrequently: true });
}

/** Rasterize a snapshot's territory into RG8 pixels (null without a 2D canvas). */
export function rasterizeTerritoryData(geometry: TerritoryGeometry, land: Uint8Array | null): Uint8Array | null {
  const w = TERRITORY_TEX_W;
  const h = TERRITORY_TEX_H;
  const ctx = canvas2d(w, h);
  if (!ctx) return null;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  for (const ring of multiPolygonToPixelRings(geometry)) {
    ring.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.closePath();
  }
  ctx.fill('evenodd');
  const rgba = ctx.getImageData(0, 0, w, h).data;

  // Antialiased inside mask from the canvas alpha channel, clipped to land
  // BEFORE the distance fields so the frontier glow traces coastlines too.
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < mask.length; i++) mask[i] = rgba[i * 4 + 3];
  clipMaskToLand(mask, land);

  // Frontier glow: falloff of the distance to the mask boundary (both sides).
  const inside = distanceTransform(w, h, (i) => mask[i] > 127);
  const outside = distanceTransform(w, h, (i) => mask[i] <= 127);
  const data = new Uint8Array(w * h * 2);
  for (let i = 0; i < mask.length; i++) {
    const d = Math.max(inside[i], outside[i]) - 0.5; // px to the frontier
    const glow = Math.max(0, 1 - d / GLOW_PX);
    data[i * 2] = mask[i];
    data[i * 2 + 1] = Math.round(glow * glow * 255); // quadratic falloff
  }
  return data;
}
