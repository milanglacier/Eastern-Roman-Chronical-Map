/**
 * The city page's map frame. A city page is a magnified inset lying on the
 * world map: its plan keeps true proportions (local equirectangular metres,
 * the same projection as the plate bake in scripts/build-city-plate.mjs)
 * and is scaled `magnification` times larger than the world map around it.
 *
 * Page coordinates are world units relative to the page centre: +x east,
 * +z south, matching the world's ground axes.
 */

/** Metres per world unit on the world map (4 units per degree of latitude). */
export const WORLD_METRES_PER_UNIT = 111320 / 4;
const M_PER_DEG_LAT = 111320;

export type Bbox = readonly [west: number, south: number, east: number, north: number];

export interface CityFrame {
  readonly bbox: Bbox;
  readonly magnification: number;
  /** Page size in world units. */
  readonly width: number;
  readonly depth: number;
  /** Real metres per page unit. */
  readonly metresPerUnit: number;
  toPage(lon: number, lat: number): { x: number; z: number };
  fromPage(x: number, z: number): { lon: number; lat: number };
  /** 0..1 across the page: u east, v south (canvas and plate raster orientation). */
  toUv(lon: number, lat: number): { u: number; v: number };
  /** Real metres → page units. */
  units(metres: number): number;
}

export function createCityFrame(bbox: Bbox, magnification: number): CityFrame {
  const [west, south, east, north] = bbox;
  const lonC = (west + east) / 2;
  const latC = (south + north) / 2;
  const mPerDegLon = M_PER_DEG_LAT * Math.cos((latC * Math.PI) / 180);
  const metresPerUnit = WORLD_METRES_PER_UNIT / magnification;
  const widthM = (east - west) * mPerDegLon;
  const depthM = (north - south) * M_PER_DEG_LAT;
  return {
    bbox,
    magnification,
    width: widthM / metresPerUnit,
    depth: depthM / metresPerUnit,
    metresPerUnit,
    toPage(lon, lat) {
      return { x: ((lon - lonC) * mPerDegLon) / metresPerUnit, z: ((latC - lat) * M_PER_DEG_LAT) / metresPerUnit };
    },
    fromPage(x, z) {
      return { lon: lonC + (x * metresPerUnit) / mPerDegLon, lat: latC - (z * metresPerUnit) / M_PER_DEG_LAT };
    },
    toUv(lon, lat) {
      return { u: (lon - west) / (east - west), v: (north - lat) / (north - south) };
    },
    units(metres) {
      return metres / metresPerUnit;
    },
  };
}
