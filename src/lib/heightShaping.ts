/**
 * Elevation-dependent vertical exaggeration, shared by the offline bake
 * (normal map, hillshade, preview) and the runtime height field so the
 * displaced mesh, its lighting and the marker projection always agree.
 *
 * Motivation: with a flat 2.5x factor the whole relief spans ~1% of the
 * camera distance and mountains read as painted texture, not geometry.
 * A flat *large* factor would fix peaks but also tilt every coastal plain.
 * Instead the factor ramps with elevation: plains stay calm, hills rise,
 * high ranges become the epic silhouettes the 45-degree view is built for.
 * Bathymetry keeps the base factor so the water depth tint is unaffected.
 */

/** Base factor for the sea floor (and the reference documented in the sidecar). */
export const SEA_EXAGGERATION = 2.5;
/** Land factor at sea level … */
export const LAND_EXAGGERATION_MIN = 2.8;
/** … ramping up to this above LAND_RAMP_END_M. */
export const LAND_EXAGGERATION_MAX = 7.0;
export const LAND_RAMP_START_M = 60;
export const LAND_RAMP_END_M = 1500;

function smoothstep(e0: number, e1: number, v: number): number {
  const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** Exaggeration factor at a raw elevation (meters, negative = below sea level). */
export function exaggerationAt(meters: number): number {
  if (meters <= 0) return SEA_EXAGGERATION;
  const t = smoothstep(LAND_RAMP_START_M, LAND_RAMP_END_M, meters);
  return LAND_EXAGGERATION_MIN + (LAND_EXAGGERATION_MAX - LAND_EXAGGERATION_MIN) * t;
}

/**
 * Raw meters -> exaggerated meters. Monotonic in `meters` (the ramp's slope
 * is far too gentle to fold the curve), so relative height ordering — and
 * the strait/land-anchor regressions — are preserved.
 */
export function shapedMeters(meters: number): number {
  return meters * exaggerationAt(meters);
}
