/**
 * Curved-earth bend: the whole world drops away quadratically with ground
 * distance from the camera's look-at target, so a low camera sees a true
 * horizon (the map rect's edge sinks below it) instead of the end of a flat
 * board. Single source of truth for the GLSL (every world material) and the
 * TypeScript twin (picking, DOM marker projection, occlusion) — they must
 * agree exactly or markers drift off their cities.
 *
 *   y' = y - |p.xz - center|² / (2 R)
 *
 * Only the *rendered* position bends: `worldpos_vertex` (shadow lookup) and
 * the shadow depth pass stay flat, so casters and receivers always agree.
 */
import type { Material, WebGLProgramParametersWithUniforms } from 'three';
import { Vector2 } from 'three';

const CURVE_RADIUS_MAX = 900;

/** Shared uniforms — the active camera rig writes them every view change. */
export const curvatureUniforms = {
  uCurveCenter: { value: new Vector2(0, 0) },
  uCurveRadius: { value: CURVE_RADIUS_MAX },
};

export function bendDrop(x: number, z: number, cx: number, cz: number, radius: number): number {
  const dx = x - cx;
  const dz = z - cz;
  return (dx * dx + dz * dz) / (2 * radius);
}

/** Bend using the live shared uniforms. */
export function bendY(x: number, y: number, z: number): number {
  const c = curvatureUniforms.uCurveCenter.value;
  return y - bendDrop(x, z, c.x, c.y, curvatureUniforms.uCurveRadius.value);
}

export const CURVE_PARS_VERTEX = /* glsl */ `
uniform vec2 uCurveCenter;
uniform float uCurveRadius;
vec4 curveWorld(vec4 worldPos) {
  vec2 cd = worldPos.xz - uCurveCenter;
  worldPos.y -= dot(cd, cd) / (2.0 * uCurveRadius);
  return worldPos;
}
`;

/** Drop-in replacement for three's `project_vertex` chunk. */
export const CURVE_PROJECT_VERTEX = /* glsl */ `
vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
  mvPosition = batchingMatrix * mvPosition;
#endif
#ifdef USE_INSTANCING
  mvPosition = instanceMatrix * mvPosition;
#endif
mvPosition = viewMatrix * curveWorld( modelMatrix * mvPosition );
gl_Position = projectionMatrix * mvPosition;
`;

/** Inject the bend into a built-in material's vertex shader (mutates `shader`). */
export function injectCurvature(shader: WebGLProgramParametersWithUniforms): void {
  shader.uniforms.uCurveCenter = curvatureUniforms.uCurveCenter;
  shader.uniforms.uCurveRadius = curvatureUniforms.uCurveRadius;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${CURVE_PARS_VERTEX}`)
    .replace('#include <project_vertex>', CURVE_PROJECT_VERTEX);
}

/**
 * Make a built-in material curve-aware, chaining any existing
 * onBeforeCompile hook (the terrain's territory/paint injections).
 */
export function applyCurvature<M extends Material>(material: M, cacheKey: string): M {
  const previous = material.onBeforeCompile.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    previous(shader, renderer);
    injectCurvature(shader);
  };
  material.customProgramCacheKey = () => `curved-${cacheKey}`;
  return material;
}

/**
 * Ray vs the bent sea-level surface y = -|p.xz - c|²/(2R). Exact: the
 * substitution is a quadratic in t. Returns the nearest positive t, or
 * null when the ray passes over the horizon.
 */
export function rayHitBentGround(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  cx: number, cz: number, radius: number,
  groundY = 0,
): number | null {
  const k = 1 / (2 * radius);
  const px = ox - cx;
  const pz = oz - cz;
  const a = k * (dx * dx + dz * dz);
  const b = dy + 2 * k * (px * dx + pz * dz);
  const c = oy - groundY + k * (px * px + pz * pz);
  if (Math.abs(a) < 1e-12) {
    if (Math.abs(b) < 1e-12) return null;
    const t = -c / b;
    return t > 0 ? t : null;
  }
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const s = Math.sqrt(disc);
  const r0 = (-b - s) / (2 * a);
  const r1 = (-b + s) / (2 * a);
  // Nearest positive root.
  const lo = Math.min(r0, r1);
  const hi = Math.max(r0, r1);
  if (lo > 1e-6) return lo;
  if (hi > 1e-6) return hi;
  return null;
}

/**
 * True when the straight sight line from the camera to a (bent) world
 * point dips below the bent sea surface — the point is over the horizon.
 */
export function occludedByHorizon(
  cam: { x: number; y: number; z: number },
  p: { x: number; y: number; z: number },
  cx: number, cz: number, radius: number,
): boolean {
  const STEPS = 12;
  for (let i = 1; i < STEPS; i++) {
    const t = i / STEPS;
    const x = cam.x + (p.x - cam.x) * t;
    const y = cam.y + (p.y - cam.y) * t;
    const z = cam.z + (p.z - cam.z) * t;
    if (y < -bendDrop(x, z, cx, cz, radius) - 0.01) return true;
  }
  return false;
}
