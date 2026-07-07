/**
 * Fog + background: distance-scaled haze that swallows the far edge of the
 * world at the 45° view, matched to the sky color so the horizon dissolves
 * instead of ending at a hard mesh edge.
 */
import { Color, Fog, Scene } from 'three';
import { SKY_COLOR } from './palette';

export interface Atmosphere {
  /** Rescale fog to the current camera distance (call on zoom changes). */
  update(cameraDistance: number): void;
}

export function createAtmosphere(scene: Scene): Atmosphere {
  const sky = new Color(SKY_COLOR);
  scene.background = sky;
  const fog = new Fog(sky, 100, 500);
  scene.fog = fog;
  return {
    update(cameraDistance: number) {
      // Keep the near field crisp; let haze build toward the horizon.
      fog.near = cameraDistance * 1.35;
      fog.far = cameraDistance * 5.0;
    },
  };
}
