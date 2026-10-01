/**
 * Territory rasterizer off the main thread (~40 ms a snapshot: a polygon
 * fill and two distance transforms), so the timeline never waits on it.
 * Protocol with territory.ts:
 *   in:  { land }                  the land mask, once (null = no clip)
 *        { year, geometry }        rasterize one snapshot
 *   out: { year, data }            RG8 pixels (transferred), or data = null
 */
import type { Territory } from '../../data/schema';
import { rasterizeTerritoryData } from '../../lib/territoryRaster';

export type TerritoryWorkerRequest = { land: Uint8Array | null } | { year: number; geometry: Territory };
export interface TerritoryWorkerResult {
  year: number;
  data: Uint8Array | null;
}

interface WorkerScope {
  onmessage: ((ev: MessageEvent<TerritoryWorkerRequest>) => void) | null;
  postMessage(message: TerritoryWorkerResult, transfer: Transferable[]): void;
}
const scope = self as unknown as WorkerScope;

let land: Uint8Array | null = null;
scope.onmessage = (ev) => {
  const msg = ev.data;
  if ('land' in msg) {
    land = msg.land;
    return;
  }
  const data = rasterizeTerritoryData(msg.geometry, land);
  scope.postMessage({ year: msg.year, data }, data ? [data.buffer] : []);
};
