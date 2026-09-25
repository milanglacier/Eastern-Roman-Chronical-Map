/**
 * Sculpted relief for the chronicle map: the land stands a thin inked
 * coast edge (COAST_SLAB) above the sea plane, with relief exaggerated
 * beyond the map shaping and peaks a little sharpened, so the mountains
 * read grandly from a low drone camera.
 *
 * One function feeds the mesh, marker projection and camera collision, so
 * everything sits on the same surface. The sea floor is left as in the
 * map shaping (the opaque sea hides it).
 */
import { shapedMeters } from './heightShaping';

const METERS_PER_WORLD_UNIT = 111320 / 4;
/** Height of the coastal edge above the sea plane (world units). */
export const COAST_SLAB = 0.03;
/** Extra vertical exaggeration on top of heightShaping. */
const RELIEF_BOOST = 2.6;

const smoothstep = (e0: number, e1: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Sculpted relief above the coast edge for a land elevation (≥ 0 m). */
function landRelief(meters: number): number {
  const base = (shapedMeters(Math.max(0, meters)) / METERS_PER_WORLD_UNIT) * RELIEF_BOOST;
  // Peaks climb a little faster than the foothills.
  return base * (1 + 0.25 * Math.min(1, base / 3));
}

/**
 * Terrain surface Y (world units) for a raw elevation in meters.
 *
 * `coastPx` (signed heightmap px from the coast, + = land; the baked
 * worldmask.R distance field) makes the coast edge a smooth function of
 * position: without it, the land/sea switch happens per mesh vertex on
 * the height sign and every coast becomes a pixel staircase.
 */
export function reliefY(meters: number, coastPx?: number): number {
  const seabed = Math.min(shapedMeters(Math.min(0, meters)) / METERS_PER_WORLD_UNIT, -0.004);
  if (coastPx === undefined) {
    return meters <= 0 ? shapedMeters(meters) / METERS_PER_WORLD_UNIT : COAST_SLAB + landRelief(meters);
  }
  const land = smoothstep(-0.6, 1.6, coastPx);
  return land * (COAST_SLAB + landRelief(meters)) + (1 - land) * seabed;
}
