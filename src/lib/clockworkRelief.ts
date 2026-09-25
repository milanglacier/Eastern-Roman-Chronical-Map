/**
 * Sculpted relief for the clockwork (Game-of-Thrones-titles) world. The
 * land is a carved slab: raised LAND_SLAB above the lacquered sea so coasts
 * read as cut edges, relief exaggerated far beyond the map shaping with
 * sharpened peaks, and softly terraced into carved strata. Geography is
 * only roughly faithful by design — the model must read as a physical
 * object from a low camera, not as a map.
 *
 * One function feeds the mesh, marker projection and camera collision, so
 * everything sits on the same surface. The sea floor is left as in the
 * map shaping (the opaque sea hides it).
 */
import { shapedMeters } from './heightShaping';

export const METERS_PER_WORLD_UNIT = 111320 / 4;
/** Height of the coastal cut above the sea plane (world units). */
export const LAND_SLAB = 0.1;
/** Extra vertical exaggeration on top of heightShaping. */
export const RELIEF_BOOST = 2.4;
/** Terrace riser spacing (world units) and how strongly terraces snap. */
export const TERRACE_STEP = 0.11;
export const TERRACE_MIX = 0.6;

const smoothstep = (e0: number, e1: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Shape of a sculpted world: coastal cut, exaggeration, terracing. */
export interface ReliefProfile {
  slab: number;
  boost: number;
  terraceMix: number;
}

export const CLOCKWORK_RELIEF: ReliefProfile = { slab: LAND_SLAB, boost: RELIEF_BOOST, terraceMix: TERRACE_MIX };
/** Chronicle map: a thin inked coast edge, grand mountains, no terraces. */
export const CHRONICLE_RELIEF: ReliefProfile = { slab: 0.03, boost: 2.6, terraceMix: 0 };

/** Sculpted relief above the slab for a land elevation (≥ 0 m). */
function landRelief(meters: number, profile: ReliefProfile = CLOCKWORK_RELIEF): number {
  const base = (shapedMeters(Math.max(0, meters)) / METERS_PER_WORLD_UNIT) * profile.boost;
  // Peaks climb a little faster than the foothills (sculpted spires).
  const sharpened = base * (1 + 0.25 * Math.min(1, base / 3));
  if (profile.terraceMix <= 0) return sharpened;
  const t = sharpened / TERRACE_STEP;
  const fl = Math.floor(t);
  const terraced = TERRACE_STEP * (fl + smoothstep(0.35, 0.65, t - fl));
  return sharpened + (terraced - sharpened) * profile.terraceMix;
}

/** Surface Y for any relief profile (see clockworkY for the coast handling). */
export function sculptedY(meters: number, coastPx: number | undefined, profile: ReliefProfile): number {
  const seabed = Math.min(shapedMeters(Math.min(0, meters)) / METERS_PER_WORLD_UNIT, -0.004);
  if (coastPx === undefined) {
    return meters <= 0 ? shapedMeters(meters) / METERS_PER_WORLD_UNIT : profile.slab + landRelief(meters, profile);
  }
  const land = smoothstep(-0.6, 1.6, coastPx);
  return land * (profile.slab + landRelief(meters, profile)) + (1 - land) * seabed;
}

/**
 * Terrain surface Y (world units) for a raw elevation in meters.
 *
 * `coastPx` (signed heightmap px from the coast, + = land; the baked
 * worldmask.R distance field) makes the slab edge a smooth function of
 * position: without it, the land/sea switch happens per mesh vertex on
 * the height sign and every coast becomes a pixel staircase.
 */
export function clockworkY(meters: number, coastPx?: number): number {
  return sculptedY(meters, coastPx, CLOCKWORK_RELIEF);
}
