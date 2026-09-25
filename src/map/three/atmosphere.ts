/**
 * Aerial perspective: distance-scaled haze in the era mood's haze colour.
 * The sky dome resolves to the same colour below the horizon, so the
 * curved world dissolves into the sky instead of ending at a mesh edge.
 */
import { Color, Fog, Scene } from 'three';
import type { Mood } from '../../lib/mood';

export interface Atmosphere {
  readonly color: Color;
  setMood(mood: Mood): void;
  /**
   * Rescale fog to the view (call on view changes): haze builds from the
   * target toward the curved horizon and is full just past it.
   */
  update(cameraDistance: number, pitch: number, curveRadius: number): void;
}

/**
 * Sight distance from the camera to the bent sea-level horizon. The
 * camera sits D·cos(p) behind the bend centre, so its height above the
 * bent surface is D·sin(p) + (D·cos p)²/2R; horizon ≈ √(2R·height).
 */
export function horizonDistance(distance: number, pitch: number, radius: number): number {
  const back = distance * Math.cos(pitch);
  const height = distance * Math.sin(pitch) + (back * back) / (2 * radius);
  return Math.sqrt(2 * radius * height);
}

export function createAtmosphere(scene: Scene): Atmosphere {
  // The era's haze, leaning to a light blue air (matches the sky).
  const air = new Color(0xb9cddb);
  const color = new Color(0x9aa6b4);
  const fog = new Fog(color, 100, 500);
  scene.fog = fog;
  scene.background = null;
  let density = 1;
  let view = { distance: 100, pitch: 0.8, radius: 800 };
  const apply = () => {
    const horizon = horizonDistance(view.distance, view.pitch, view.radius);
    fog.far = Math.min(view.distance * 4.4, horizon * 1.05) / density;
    fog.near = Math.min(view.distance * 1.0, horizon * 0.32) / density;
  };
  return {
    color,
    setMood(mood) {
      color.setRGB(...mood.hazeColor).lerp(air, 0.55);
      fog.color.copy(color);
      density = mood.hazeDensity * 0.7;
      apply();
    },
    update(distance, pitch, radius) {
      view = { distance, pitch, radius };
      apply();
    },
  };
}
