/**
 * CPU copy of the baked coast distance field (worldmask.R: 128 = coast,
 * ±6 per heightmap px, + = land), bilinearly sampled by lon/lat. The
 * clockwork relief uses it so the carved slab edge follows a smooth
 * contour instead of the mesh grid.
 */
import type { Texture } from 'three';
import { LON_MIN, LON_MAX, LAT_MIN, LAT_MAX } from '../../../lib/hex';

export type CoastField = (lon: number, lat: number) => number;

export function decodeCoastField(worldMask: Texture | null): CoastField | null {
  const img = worldMask?.image as (CanvasImageSource & { width: number; height: number }) | undefined;
  if (!img || !img.width || typeof document === 'undefined') return null;
  const w = img.width;
  const h = img.height;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0);
  const rgba = ctx.getImageData(0, 0, w, h).data;
  const sdf = new Float32Array(w * h);
  for (let i = 0; i < sdf.length; i++) sdf[i] = (rgba[i * 4] - 128) / 6;
  return (lon, lat) => {
    const fx = ((lon - LON_MIN) / (LON_MAX - LON_MIN)) * w - 0.5;
    const fy = ((LAT_MAX - lat) / (LAT_MAX - LAT_MIN)) * h - 0.5;
    const cx = Math.min(Math.max(fx, 0), w - 1);
    const cy = Math.min(Math.max(fy, 0), h - 1);
    const x0 = Math.floor(cx);
    const y0 = Math.floor(cy);
    const x1 = Math.min(x0 + 1, w - 1);
    const y1 = Math.min(y0 + 1, h - 1);
    const tx = cx - x0;
    const ty = cy - y0;
    const a = sdf[y0 * w + x0] * (1 - tx) + sdf[y0 * w + x1] * tx;
    const b = sdf[y1 * w + x0] * (1 - tx) + sdf[y1 * w + x1] * tx;
    return a * (1 - ty) + b * ty;
  };
}
