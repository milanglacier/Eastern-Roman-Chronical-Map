/**
 * Territory drape: each snapshot's MultiPolygon is rasterized once into an
 * RG8 texture in the shared world UV space (R = antialiased inside-mask,
 * G = frontier glow from a distance field) and sampled by the terrain
 * shader as tint + glowing border. Snapshot changes crossfade by animating
 * the uTerritoryMix uniform between the A and B texture slots.
 */
import { DataTexture, LinearFilter, RGFormat, UnsignedByteType } from 'three';
import { territories } from '../../data';
import type { Territory as TerritoryGeometry } from '../../data/schema';
import { distanceTransform } from '../../lib/distanceField';
import { LON_MIN, LON_MAX, LAT_MIN, LAT_MAX } from '../../lib/hex';
import type { TerrainUniforms } from './terrain';
import { blankTerritoryTexture } from './terrain';

export const TERRITORY_TEX_W = 1024;
export const TERRITORY_TEX_H = 442; // same 232:100 aspect as the world rect
/** Frontier glow half-width in territory-texture px (~1.6 world units). */
const GLOW_PX = 7;
export const CROSSFADE_MS = 550;

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

/** Rasterize a snapshot's territory into RG8 (R = mask, G = border glow). */
function rasterizeTerritory(geometry: TerritoryGeometry): DataTexture {
  const w = TERRITORY_TEX_W;
  const h = TERRITORY_TEX_H;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return blankTerritoryTexture();
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  for (const ring of multiPolygonToPixelRings(geometry)) {
    ring.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.closePath();
  }
  ctx.fill('evenodd');
  const rgba = ctx.getImageData(0, 0, w, h).data;

  // Antialiased inside mask from the canvas alpha channel.
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < mask.length; i++) mask[i] = rgba[i * 4 + 3];

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
  const tex = new DataTexture(data, w, h, RGFormat, UnsignedByteType);
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearFilter;
  tex.flipY = false;
  tex.needsUpdate = true;
  return tex;
}

export interface TerritoryController {
  /** Show a snapshot year; animate=false jumps without a crossfade. */
  setSnapshot(year: number, animate?: boolean): void;
  /** Advance the crossfade; call once per frame with seconds elapsed. */
  update(deltaSeconds: number): void;
  dispose(): void;
}

export function createTerritoryController(uniforms: TerrainUniforms): TerritoryController {
  const cache = new Map<number, DataTexture>();
  let fading = false;

  const textureFor = (year: number): DataTexture => {
    let tex = cache.get(year);
    if (!tex) {
      const geometry = territories.get(year);
      tex = geometry ? rasterizeTerritory(geometry) : blankTerritoryTexture();
      cache.set(year, tex);
    }
    return tex;
  };

  return {
    setSnapshot(year, animate = true) {
      const tex = textureFor(year);
      if (!animate) {
        uniforms.uTerritoryA.value = tex;
        uniforms.uTerritoryB.value = tex;
        uniforms.uTerritoryMix.value = 0;
        fading = false;
        return;
      }
      // If a fade is in flight, freeze its current blend into slot A first.
      if (fading && uniforms.uTerritoryMix.value > 0.5) {
        uniforms.uTerritoryA.value = uniforms.uTerritoryB.value;
      }
      uniforms.uTerritoryB.value = tex;
      uniforms.uTerritoryMix.value = 0;
      fading = true;
    },
    update(deltaSeconds) {
      if (!fading) return;
      const next = uniforms.uTerritoryMix.value + (deltaSeconds * 1000) / CROSSFADE_MS;
      if (next >= 1) {
        uniforms.uTerritoryA.value = uniforms.uTerritoryB.value;
        uniforms.uTerritoryMix.value = 0;
        fading = false;
      } else {
        uniforms.uTerritoryMix.value = next;
      }
    },
    dispose() {
      for (const tex of cache.values()) tex.dispose();
      cache.clear();
    },
  };
}
