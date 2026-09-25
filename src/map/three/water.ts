/**
 * Animated sea surface: one opaque, tessellated sheet at Y=0 over the world
 * rect plus an open-ocean apron around it, bent by the curved earth: a
 * watercolour wash, pale at the shores and deepening offshore, with inked
 * chart ripples following every coast (from the baked coast distance
 * field, worldmask.R).
 * Land is above Y=0 and simply depth-tests the water away.
 */
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  DoubleSide,
  Mesh,
  PlaneGeometry,
  RepeatWrapping,
  ShaderMaterial,
  Texture,
  UniformsLib,
  UniformsUtils,
  Vector2,
  Vector3,
} from 'three';
import { GROUND_W, GROUND_H } from './geo';
import { WATER_FRESNEL_TINT } from './palette';
import { CURVE_PARS_VERTEX, curvatureUniforms } from './curvature';
import type { Mood } from '../../lib/mood';

export interface Water {
  mesh: Mesh;
  /** Advance the wave animation (seconds). */
  setTime(t: number): void;
  setMood(mood: Mood): void;
  dispose(): void;
}

/** Watercolour washes (see docs/art-direction.md). */
const WASH_SHALLOW = 0x7fb3b1;
const WASH_DEEP = 0x2d5f7e;
const WASH_RIPPLE = 0x2f4f5e;

function applyMood(uniforms: Record<string, { value: unknown }>, mood: Mood): void {
  (uniforms.uSunDir.value as Vector3).set(...mood.keyDir);
  // The sea catches the era's sky.
  (uniforms.uSkyColor.value as Color).setRGB(...mood.skyHorizon);
  (uniforms.uGlintColor.value as Color).setRGB(...mood.keyColor);
  uniforms.uGlintStrength.value = 0.35 + mood.keyIntensity * 0.12;
  // The sea shader is unlit: dim it with the night.
  uniforms.uLight.value = 1 - mood.night * 0.62;
}

const VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
#include <fog_pars_vertex>
${CURVE_PARS_VERTEX}
varying vec2 vUv;
varying vec3 vWorldPos;
void main() {
  // World textures have north at V=0; the rotated plane's V runs the other
  // way, so flip here once and every sampler agrees.
  vUv = vec2(uv.x, 1.0 - uv.y);
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPos.xyz;
  vec4 mvPosition = viewMatrix * curveWorld(worldPos);
  gl_Position = projectionMatrix * mvPosition;
  #include <logdepthbuf_vertex>
  #include <fog_vertex>
}
`;

const FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
#include <fog_pars_fragment>
uniform sampler2D uWaterNormal;
uniform sampler2D uHeightY;
uniform sampler2D uWorldMask;
uniform float uTime;
uniform vec3 uDeepColor;
uniform vec3 uShallowColor;
uniform vec3 uSkyColor;
uniform vec3 uRippleColor;
uniform float uLight;
varying vec2 vUv;
varying vec3 vWorldPos;

float wHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float wNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(wHash(i), wHash(i + vec2(1.0, 0.0)), f.x), mix(wHash(i + vec2(0.0, 1.0)), wHash(i + vec2(1.0, 1.0)), f.x), f.y);
}

void main() {
  #include <logdepthbuf_fragment>

  // Two counter-scrolling samples of the tileable wave normals (tangent
  // space; the plane's up is +Y so tangent XY maps to world XZ). Tiling is
  // aspect-corrected so waves are isotropic on the 288x140 rect.
  vec2 tileA = vec2(149.0, 72.4);
  vec2 tileB = vec2(65.8, 31.9);
  vec3 na = texture2D(uWaterNormal, vUv * tileA + uTime * vec2(0.010, 0.006)).rgb * 2.0 - 1.0;
  vec3 nb = texture2D(uWaterNormal, vUv * tileB - uTime * vec2(0.007, 0.010)).rgb * 2.0 - 1.0;
  vec3 n = normalize(vec3(na.x + nb.x, 2.8, na.y + nb.y));

  float bedY = texture2D(uHeightY, vUv).r; // world-unit Y of the seabed
  float depth = max(0.0, -bedY);
  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  float fresnel = pow(1.0 - max(dot(viewDir, n), 0.0), 3.0);
  float sdfPx = (texture2D(uWorldMask, vUv).r * 255.0 - 128.0) / 6.0; // signed px from coast (+land)
  vec3 col;

  // Watercolour sea on parchment: a pale wash at the shores deepening
  // offshore, granulated and blotched, with three inked chart ripples
  // following every coast (the portolan-chart device).
  vec2 wpc = vWorldPos.xz;
  float blotW = wNoise(wpc * 0.45) * 0.6 + wNoise(wpc * 1.7 + 3.1) * 0.4;
  vec3 washW = mix(uShallowColor, uDeepColor, smoothstep(0.0, 0.5, depth + (blotW - 0.5) * 0.14));
  washW *= 0.93 + 0.12 * blotW;
  float rc = -sdfPx * 0.6 - 0.35;
  float rfw = fwidth(rc) * 1.4 + 1e-4;
  float rd = min(fract(rc), 1.0 - fract(rc));
  float rippleC = (1.0 - smoothstep(rfw * 0.5, rfw * 1.5, rd)) * step(0.0, rc) * (1.0 - smoothstep(2.2, 3.2, rc));
  washW = mix(washW, uRippleColor, rippleC * 0.6);
  washW = mix(washW, uSkyColor, fresnel * 0.25);
  col = washW * uLight;

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

/**
 * How far the open-ocean apron reaches beyond the world rect, in world
 * units. Covers the farthest frustum-corner ground hit at DIST_MAX (~430
 * units on an ultrawide viewport); everything beyond fades into fog anyway.
 */
const APRON = 500;

const APRON_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
#include <fog_pars_vertex>
${CURVE_PARS_VERTEX}
uniform vec2 uWorldSize;
varying vec2 vUv;
varying vec3 vWorldPos;
void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPos.xyz;
  // UVs from world position, matching the main sheet's (x/W, z/H) mapping,
  // so the RepeatWrapping wave samples are phase-continuous across the seam.
  vUv = worldPos.xz / uWorldSize;
  vec4 mvPosition = viewMatrix * curveWorld(worldPos);
  gl_Position = projectionMatrix * mvPosition;
  #include <logdepthbuf_vertex>
  #include <fog_vertex>
}
`;

const APRON_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
#include <fog_pars_fragment>
uniform sampler2D uWaterNormal;
uniform float uTime;
uniform vec3 uDeepColor;
uniform vec3 uSkyColor;
uniform vec3 uSunDir;
uniform vec3 uGlintColor;
uniform float uGlintStrength;
uniform float uLight;
varying vec2 vUv;
varying vec3 vWorldPos;

void main() {
  #include <logdepthbuf_fragment>

  vec2 tileA = vec2(149.0, 72.4);
  vec2 tileB = vec2(65.8, 31.9);
  vec3 na = texture2D(uWaterNormal, vUv * tileA + uTime * vec2(0.010, 0.006)).rgb * 2.0 - 1.0;
  vec3 nb = texture2D(uWaterNormal, vUv * tileB - uTime * vec2(0.007, 0.010)).rgb * 2.0 - 1.0;
  vec3 n = normalize(vec3(na.x + nb.x, 2.8, na.y + nb.y));

  // Open ocean, always at full depth. Kept a flat colour deliberately —
  // continuing the clamped border texels of the world textures out here
  // (even mip-blurred) draws streak plumes off the edge.
  vec3 col = uDeepColor;

  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  float fresnel = pow(1.0 - max(dot(viewDir, n), 0.0), 3.0);
  col = mix(col, uSkyColor, fresnel * 0.45);
  col *= uLight;
  vec3 halfDir = normalize(viewDir + uSunDir);
  col += uGlintColor * pow(max(dot(n, halfDir), 0.0), 70.0) * uGlintStrength * 0.5;

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

/**
 * Grid breakpoints from `from` to `to`: `fine` spacing near the world rect
 * edge, growing geometrically outward. The curved-earth bend moves only
 * vertices, so big flat quads would float or sag — every sea surface must
 * be tessellated finely enough for the bend to read as a curve.
 */
function apronBreaks(edge: number, to: number, fine: number): number[] {
  const out: number[] = [];
  const dir = Math.sign(to - edge);
  let step = fine;
  for (let v = edge; dir > 0 ? v < to : v > to; v += dir * step) {
    out.push(v);
    step = Math.min(step * 1.18, 40);
  }
  out.push(to);
  return out;
}

/**
 * Ring of open ocean around the world rect so a high camera never sees the
 * bare background. No height/mask sampling (the border texels of those
 * textures are land along the south and east edges and would bleed wrong
 * tints out here), no shadows.
 */
function apronGeometry(): BufferGeometry {
  // Inner edge matches the main sheet's 2-unit segments exactly (no
  // T-junction hairlines once both are bent).
  const xsLeft = apronBreaks(0, -APRON, 2).reverse();
  const xsMid: number[] = [];
  for (let x = 0; x <= GROUND_W + 1e-6; x += 2) xsMid.push(Math.min(GROUND_W, x));
  const xsRight = apronBreaks(GROUND_W, GROUND_W + APRON, 2);
  const xs = [...xsLeft.slice(0, -1), ...xsMid, ...xsRight.slice(1)];
  const zsTop = apronBreaks(0, -APRON, 2).reverse();
  const zsMid: number[] = [];
  for (let z = 0; z <= GROUND_H + 1e-6; z += 2) zsMid.push(Math.min(GROUND_H, z));
  const zsBottom = apronBreaks(GROUND_H, GROUND_H + APRON, 2);
  const zs = [...zsTop.slice(0, -1), ...zsMid, ...zsBottom.slice(1)];
  const positions: number[] = [];
  for (const z of zs) for (const x of xs) positions.push(x, 0, z);
  const indices: number[] = [];
  const nx = xs.length;
  for (let j = 0; j + 1 < zs.length; j++) {
    for (let i = 0; i + 1 < nx; i++) {
      const cx = (xs[i] + xs[i + 1]) / 2;
      const cz = (zs[j] + zs[j + 1]) / 2;
      if (cx > 0 && cx < GROUND_W && cz > 0 && cz < GROUND_H) continue; // main sheet covers it
      const a = j * nx + i;
      const b = a + 1;
      const c = a + nx;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  g.setIndex(indices);
  return g;
}

export function createOceanApron(
  textures: { waterNormal: Texture | null },
): Water {
  const geometry = apronGeometry();

  const uniforms = UniformsUtils.merge([
    UniformsLib.fog,
    {
      uTime: { value: 0 },
      uDeepColor: { value: new Color(WASH_DEEP) },
      uSkyColor: { value: new Color(WATER_FRESNEL_TINT) },
      uSunDir: { value: new Vector3(0, 1, 0) },
      uGlintColor: { value: new Color(1, 0.93, 0.78) },
      uGlintStrength: { value: 0.5 },
      uLight: { value: 1 },
      uWorldSize: { value: new Vector2(GROUND_W, GROUND_H) },
    },
  ]);
  uniforms.uWaterNormal = { value: textures.waterNormal };
  uniforms.uCurveCenter = curvatureUniforms.uCurveCenter;
  uniforms.uCurveRadius = curvatureUniforms.uCurveRadius;

  const material = new ShaderMaterial({
    vertexShader: APRON_VERT,
    fragmentShader: APRON_FRAG,
    uniforms,
    fog: true,
    side: DoubleSide,
  });

  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false; // bent by the curved earth
  mesh.updateMatrixWorld();

  return {
    mesh,
    setTime(t: number) {
      uniforms.uTime.value = t;
    },
    setMood(mood) {
      applyMood(uniforms, mood);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

export function createWater(
  textures: {
    waterNormal: Texture | null;
    heightY: DataTexture;
    worldMask: Texture | null;
  },
): Water {
  if (textures.waterNormal) {
    textures.waterNormal.wrapS = RepeatWrapping;
    textures.waterNormal.wrapT = RepeatWrapping;
  }
  const uniforms = UniformsUtils.merge([
    UniformsLib.fog,
    {
      uTime: { value: 0 },
      uDeepColor: { value: new Color(WASH_DEEP) },
      uShallowColor: { value: new Color(WASH_SHALLOW) },
      uSkyColor: { value: new Color(WATER_FRESNEL_TINT) },
      uRippleColor: { value: new Color(WASH_RIPPLE) },
      uSunDir: { value: new Vector3(0, 1, 0) },
      uGlintColor: { value: new Color(1, 0.93, 0.78) },
      uGlintStrength: { value: 0.5 },
      uLight: { value: 1 },
    },
  ]);
  // Textures and shared objects are assigned after merge (merge clones values).
  uniforms.uWaterNormal = { value: textures.waterNormal };
  uniforms.uHeightY = { value: textures.heightY };
  uniforms.uWorldMask = { value: textures.worldMask };
  uniforms.uCurveCenter = curvatureUniforms.uCurveCenter;
  uniforms.uCurveRadius = curvatureUniforms.uCurveRadius;

  const material = new ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms,
    fog: true,
  });

  // 2-unit segments: the curved-earth bend is per vertex (see apronGeometry).
  const geometry = new PlaneGeometry(GROUND_W, GROUND_H, GROUND_W / 2, GROUND_H / 2);
  geometry.rotateX(-Math.PI / 2); // plane in XZ, +Y up
  const mesh = new Mesh(geometry, material);
  mesh.position.set(GROUND_W / 2, 0, GROUND_H / 2);
  mesh.renderOrder = 10;
  mesh.frustumCulled = false; // bent by the curved earth
  mesh.updateMatrixWorld();

  return {
    mesh,
    setTime(t: number) {
      uniforms.uTime.value = t;
    },
    setMood(mood) {
      applyMood(uniforms, mood);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      textures.heightY.dispose();
    },
  };
}
