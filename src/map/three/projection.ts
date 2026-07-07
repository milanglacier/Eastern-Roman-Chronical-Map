/**
 * Screen projection for DOM overlays (event + city markers). The live 3D
 * scene registers a projector on mount; before that (and in jsdom tests) a
 * flat plate-carrée fallback keeps markers renderable, mirroring the old
 * default camera `{x:0, y:0, scale:1}` behavior.
 */
import { lonLatToGround } from './geo';

export interface ProjectedPoint {
  /** CSS px within the map viewport. */
  x: number;
  y: number;
  /** False when behind the camera or outside the frustum. */
  visible: boolean;
}

export type Projector = (lon: number, lat: number) => ProjectedPoint;

const FALLBACK_PX_PER_UNIT = 6;
const fallbackProjector: Projector = (lon, lat) => {
  const g = lonLatToGround(lon, lat);
  return { x: g.x * FALLBACK_PX_PER_UNIT, y: g.z * FALLBACK_PX_PER_UNIT, visible: true };
};

let projector: Projector | null = null;

export function setProjector(next: Projector | null): void {
  projector = next;
}

export function projectLonLat(lon: number, lat: number): ProjectedPoint {
  return (projector ?? fallbackProjector)(lon, lat);
}
