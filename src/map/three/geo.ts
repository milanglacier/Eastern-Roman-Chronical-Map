/**
 * Ground-plane mapping for the 3D world. Plate carrée, same semantics as the
 * hex-era `lonLatToWorld`: linear in lon/lat, +X = east, +Z = south, Y = up.
 * Every world texture (heightmap, albedo, masks, territory) shares this one
 * UV space, so lon/lat → UV is a two-multiply affine.
 */
import { LON_MIN, LON_MAX, LAT_MIN, LAT_MAX } from '../../lib/hex';

export const UNITS_PER_DEGREE = 4;
/** World rect in ground units: X spans longitude, Z spans latitude. */
export const GROUND_W = (LON_MAX - LON_MIN) * UNITS_PER_DEGREE; // 232
export const GROUND_H = (LAT_MAX - LAT_MIN) * UNITS_PER_DEGREE; // 100

export interface GroundPoint {
  x: number;
  z: number;
}

export function lonLatToGround(lon: number, lat: number): GroundPoint {
  return {
    x: (lon - LON_MIN) * UNITS_PER_DEGREE,
    z: (LAT_MAX - lat) * UNITS_PER_DEGREE,
  };
}

export function groundToLonLat(x: number, z: number): { lon: number; lat: number } {
  return {
    lon: LON_MIN + x / UNITS_PER_DEGREE,
    lat: LAT_MAX - z / UNITS_PER_DEGREE,
  };
}

/**
 * Ground point → texture UV. All world textures are loaded with
 * `flipY = false`, so image row 0 (north, lat max) is V = 0.
 */
export function groundToUv(x: number, z: number): { u: number; v: number } {
  return { u: x / GROUND_W, v: z / GROUND_H };
}
