/**
 * Territory drape: each snapshot's MultiPolygon is rasterized once into an
 * RG8 texture in the shared world UV space (R = antialiased inside-mask
 * clipped to land, G = frontier glow from a distance field) and sampled by
 * the terrain shader as purple fill + gold border. The polygons are drawn
 * loosely over sea (the whole Aegean sits inside 555's Balkan ring), so the
 * mask is intersected with a heightfield land mask — the empire tints land
 * only and its frontier hugs the coastline, like the old hex renderer.
 * Snapshot changes crossfade by animating the uTerritoryMix uniform between
 * the A and B texture slots.
 *
 * Rasterizing costs ~40 ms a snapshot, so every snapshot is rasterized ahead
 * of time in a worker (territoryWorker.ts); a snapshot asked for before its
 * turn is rasterized on the spot.
 */
import { DataTexture, LinearFilter, RGFormat, UnsignedByteType } from 'three';
import { territories } from '../../data';
import { TERRITORY_TEX_H, TERRITORY_TEX_W, buildLandMask, rasterizeTerritoryData } from '../../lib/territoryRaster';
import type { HeightField } from './heightField';
import type { TerrainUniforms } from './terrain';
import { blankTerritoryTexture } from './terrain';
import type { TerritoryWorkerRequest, TerritoryWorkerResult } from './territoryWorker';

export {
  TERRITORY_TEX_H,
  TERRITORY_TEX_W,
  buildLandMask,
  clipMaskToLand,
  multiPolygonToPixelRings,
} from '../../lib/territoryRaster';

export const CROSSFADE_MS = 550;

function territoryTexture(data: Uint8Array): DataTexture {
  const tex = new DataTexture(data, TERRITORY_TEX_W, TERRITORY_TEX_H, RGFormat, UnsignedByteType);
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
  /**
   * Rasterize every snapshot ahead of time, in a worker (or, without one,
   * one per idle slot), so playing the timeline never waits on it.
   */
  prewarm(): void;
  dispose(): void;
}

export function createTerritoryController(
  uniforms: TerrainUniforms,
  heightField: HeightField,
): TerritoryController {
  const cache = new Map<number, DataTexture>();
  let fading = false;
  let idleHandle: number | null = null;
  let worker: Worker | null = null;
  let disposed = false;

  // Bake guarantee: land ≥ +4 m (LAND_MIN_M, river incisions floor there
  // too), sea/carved straits < 0 — so the height sign is an exact land test.
  let landMask: Uint8Array | null = buildLandMask(
    TERRITORY_TEX_W,
    TERRITORY_TEX_H,
    (lon, lat) => heightField.heightAt(lon, lat) > 0,
  );
  // The flat fallback heightfield (assets missing) is all sea; clipping with
  // it would erase every territory, so skip the clip instead.
  if (!landMask.some((v) => v > 0)) landMask = null;

  const textureFor = (year: number): DataTexture => {
    let tex = cache.get(year);
    if (!tex) {
      const geometry = territories.get(year);
      const data = geometry ? rasterizeTerritoryData(geometry, landMask) : null;
      tex = data ? territoryTexture(data) : blankTerritoryTexture();
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
    prewarm() {
      if (worker || idleHandle !== null) return;
      const pending = [...territories.keys()].filter((y) => !cache.has(y)).sort((a, b) => a - b);
      if (!pending.length) return;
      if (typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined') {
        try {
          worker = new Worker(new URL('./territoryWorker.ts', import.meta.url), { type: 'module' });
        } catch {
          worker = null;
        }
      }
      if (worker) {
        worker.onmessage = (ev: MessageEvent<TerritoryWorkerResult>) => {
          const { year, data } = ev.data;
          // Already rasterized on the spot when it was asked for early.
          if (disposed || !data || cache.has(year)) return;
          cache.set(year, territoryTexture(data));
        };
        worker.onerror = () => {
          worker?.terminate();
          worker = null;
        };
        const post = (msg: TerritoryWorkerRequest) => worker!.postMessage(msg);
        post({ land: landMask });
        for (const year of pending) post({ year, geometry: territories.get(year)! });
        return;
      }
      // No worker: one snapshot per idle slot, in timeline order.
      const idle = (cb: () => void): number =>
        typeof requestIdleCallback === 'function' ? requestIdleCallback(cb, { timeout: 2000 }) : window.setTimeout(cb, 50);
      const next = () => {
        idleHandle = null;
        if (disposed) return;
        const year = pending.find((y) => !cache.has(y));
        if (year === undefined) return;
        textureFor(year);
        idleHandle = idle(next);
      };
      idleHandle = idle(next);
    },
    dispose() {
      disposed = true;
      worker?.terminate();
      worker = null;
      if (idleHandle !== null) {
        if (typeof cancelIdleCallback === 'function') cancelIdleCallback(idleHandle);
        else window.clearTimeout(idleHandle);
        idleHandle = null;
      }
      for (const tex of cache.values()) tex.dispose();
      cache.clear();
    },
  };
}
