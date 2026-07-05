/**
 * Minimal GeoJSON geometry helpers (lon/lat degrees, planar approximation).
 */

export type Position = [number, number];
export type Ring = Position[];
export type PolygonCoords = Ring[]; // [outer, ...holes]
export type MultiPolygonCoords = PolygonCoords[];

export interface GeoPolygon {
  type: 'Polygon';
  coordinates: PolygonCoords;
}

export interface GeoMultiPolygon {
  type: 'MultiPolygon';
  coordinates: MultiPolygonCoords;
}

export type TerritoryGeometry = GeoPolygon | GeoMultiPolygon;

/** Ray-casting point-in-ring test. Points on edges may go either way. */
export function pointInRing(lon: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

export function pointInPolygon(lon: number, lat: number, poly: PolygonCoords): boolean {
  if (poly.length === 0 || !pointInRing(lon, lat, poly[0])) return false;
  for (let h = 1; h < poly.length; h++) {
    if (pointInRing(lon, lat, poly[h])) return false;
  }
  return true;
}

export function pointInMultiPolygon(lon: number, lat: number, mp: MultiPolygonCoords): boolean {
  return mp.some((poly) => pointInPolygon(lon, lat, poly));
}

export function pointInGeometry(lon: number, lat: number, geom: TerritoryGeometry): boolean {
  return geom.type === 'Polygon'
    ? pointInPolygon(lon, lat, geom.coordinates)
    : pointInMultiPolygon(lon, lat, geom.coordinates);
}

/** Squared distance from point to segment, in degree units. */
function distSqToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return (px - cx) * (px - cx) + (py - cy) * (py - cy);
}

/** True if the point lies within `bufferDeg` of the polyline. */
export function nearPolyline(
  lon: number,
  lat: number,
  line: Position[],
  bufferDeg: number,
): boolean {
  const bufSq = bufferDeg * bufferDeg;
  for (let i = 0; i + 1 < line.length; i++) {
    if (distSqToSegment(lon, lat, line[i][0], line[i][1], line[i + 1][0], line[i + 1][1]) <= bufSq) {
      return true;
    }
  }
  return false;
}
