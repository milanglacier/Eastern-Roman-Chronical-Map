/**
 * City-page geometry shared by the page artwork and the pop-up models:
 * the baked plate (coast, contours, hachures, land mask), and the paths of
 * walls in page units, including sea walls that follow the coast.
 */
import type { CityStructure } from '../../../../data/schema';
import type { CityFrame } from '../../../../lib/cityFrame';
import { offset, pointInRing, resample, sliceBetween, smooth, type XY } from '../../../../lib/polyline';

export interface PlateData {
  /** The detailed plan (contours, hachures). */
  bbox: [number, number, number, number];
  /** The outer ground (land mask, coast lines). */
  outerBbox: [number, number, number, number];
  grid: { width: number; height: number; metresPerPixel: number };
  coast: Array<Array<[number, number]>>;
  contours: Array<{ level: number; lines: Array<Array<[number, number]>> }>;
  /** [lon0, lat0, lon1, lat1, steepness 0..1] */
  hachures: number[][];
}

export interface Plate {
  data: PlateData;
  /** The land mask image over `data.outerBbox` (white, alpha = land), for drawing. */
  landImage: HTMLImageElement;
  /** Land test in page units; false outside the outer ground. */
  isLand(x: number, z: number): boolean;
  /** Coast lines in page units. */
  coast: XY[][];
}

export async function loadPlate(baseUrl: string, frame: CityFrame): Promise<Plate> {
  const [data, landImage] = await Promise.all([
    fetch(`${baseUrl}/plate.json`).then((r) => r.json() as Promise<PlateData>),
    new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = `${baseUrl}/land.png`;
    }),
  ]);
  const c = document.createElement('canvas');
  c.width = landImage.width;
  c.height = landImage.height;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(landImage, 0, 0);
  const alpha = ctx.getImageData(0, 0, c.width, c.height).data;
  const [west, south, east, north] = data.outerBbox;
  const isLand = (x: number, z: number) => {
    const { lon, lat } = frame.fromPage(x, z);
    const px = Math.floor(((lon - west) / (east - west)) * c.width);
    const py = Math.floor(((north - lat) / (north - south)) * c.height);
    if (px < 0 || py < 0 || px >= c.width || py >= c.height) return false;
    return alpha[(py * c.width + px) * 4 + 3] > 127;
  };
  const toPage = ([lon, lat]: [number, number]): XY => {
    const p = frame.toPage(lon, lat);
    return [p.x, p.z];
  };
  return { data, landImage, isLand, coast: data.coast.map((line) => line.map(toPage)) };
}

/** Page-unit path of a linear structure, or null if it cannot be placed. */
export function structurePath(structure: CityStructure, frame: CityFrame, plate: Plate | null): XY[] | null {
  const toPage = ([lon, lat]: readonly [number, number]): XY => {
    const p = frame.toPage(lon, lat);
    return [p.x, p.z];
  };
  if (structure.path) return structure.path.map(toPage);
  if (!structure.coast || !plate) return null;
  const { start, end, inset } = structure.coast;
  const shore = sliceBetween(plate.coast, toPage(start), toPage(end), frame.units(400));
  if (!shore || shore.length < 2) return null;
  const line = smooth(resample(shore, frame.units(40)), 2);
  const d = frame.units(inset);
  // Set back toward the land: pick the side where more of the line lands.
  const score = (pts: XY[]) => pts.filter(([x, z]) => plate.isLand(x, z)).length;
  const left = offset(line, d);
  const right = offset(line, -d);
  return score(left) >= score(right) ? left : right;
}

/** Offset a wall path away from a centre (moats and outer walls lie outside). */
export function offsetOutward(path: XY[], distance: number, centre: XY): XY[] {
  const a = offset(path, distance);
  const b = offset(path, -distance);
  const mean = (pts: XY[]) => pts.reduce((s, [x, z]) => s + Math.hypot(x - centre[0], z - centre[1]), 0) / pts.length;
  return mean(a) > mean(b) ? a : b;
}

export function ringCentroid(ring: XY[]): XY {
  let x = 0;
  let z = 0;
  for (const p of ring) {
    x += p[0];
    z += p[1];
  }
  return [x / ring.length, z / ring.length];
}

export { pointInRing };
