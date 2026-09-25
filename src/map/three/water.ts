/**
 * Animated sea surface: one plane at Y=0 over the world rect. Painted, not
 * photographic: ultramarine deeps grading to turquoise shelves, slow
 * scrolling waves, a key-light glint path (sun or moon, from the era
 * mood), and the old-chart device of thin light ripple lines drawn
 * parallel to the coast from the baked coast distance field (worldmask.R).
 * Semi-transparent so the baked shelf colour glows through. Land is above
 * Y=0 and simply depth-tests the water away. Bent by the curved earth.
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

/** Painted sea palette (sRGB; see docs/art-direction.md). */
const DEEP = 0x21507a;
const SHALLOW = 0x4a9aa0;
const RIPPLE = 0xb9d8cf;
/** Clockwork sea: dark lacquer (see clockwork/terrain.ts for the land). */
const LACQUER_DEEP = 0x121c22;
const LACQUER_SHALLOW = 0x263e42;
/** Chronicle sea: watercolour washes on parchment. */
const WASH_SHALLOW = 0x7fb3b1;
const WASH_DEEP = 0x2d5f7e;

type SeaStyle = 'painted' | 'clockwork' | 'chronicle';

function applyMood(uniforms: Record<string, { value: unknown }>, mood: Mood, style: SeaStyle = 'painted'): void {
  (uniforms.uSunDir.value as Vector3).set(...mood.keyDir);
  // Out of doors the sea mirrors the sky; in the clockwork hall it mirrors
  // the dark lamplit room; the chronicle sea just catches the paper haze.
  const sky = uniforms.uSkyColor.value as Color;
  if (style === 'clockwork') sky.setRGB(...mood.hazeColor).multiplyScalar(0.35);
  else if (style === 'chronicle') sky.setRGB(...mood.skyHorizon);
  else sky.setRGB(...mood.skyHorizon);
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
uniform vec3 uFoamColor;
uniform vec3 uSunDir;
uniform vec3 uGlintColor;
uniform float uGlintStrength;
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
  float depthT = smoothstep(0.0, 0.28, depth); // ~3100 m at full tint

  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  vec3 col = mix(uShallowColor, uDeepColor, depthT);
  float fresnel = pow(1.0 - max(dot(viewDir, n), 0.0), 3.0);
  col = mix(col, uSkyColor, fresnel * 0.45);
  col *= uLight;
  vec3 halfDir = normalize(viewDir + uSunDir);
  col += uGlintColor * pow(max(dot(n, halfDir), 0.0), 70.0) * uGlintStrength;

  // Shore foam: a thin, noise-broken animated lick just seaward of the coast.
  float maskR = texture2D(uWorldMask, vUv).r;
  float sdfPx = (maskR * 255.0 - 128.0) / 6.0; // signed px from coast (+land)
  float foamBand = 1.0 - smoothstep(0.2, 1.5, abs(sdfPx + 0.8));
  float foamWave = 0.55 + 0.45 * sin(uTime * 1.1 - sdfPx * 2.3);
  float foamNoise = texture2D(uWaterNormal, vUv * vec2(235.9, 114.7) + uTime * vec2(0.020, 0.013)).b;
  float foam = foamBand * foamWave * smoothstep(0.5, 0.85, foamNoise);

  // Chart ripples: thin light lines parallel to the coast, slowly drifting
  // shoreward and fading offshore — the painted-map sea.
  float rippleCoord = -sdfPx * 0.42 + uTime * 0.05;
  float ripple = 1.0 - smoothstep(0.0, 0.09, abs(fract(rippleCoord) - 0.5) - 0.41);
  // (GLSL smoothstep needs edge0 < edge1 — reversed edges are undefined.)
  ripple *= (1.0 - smoothstep(-1.6, -0.2, sdfPx)) * smoothstep(-13.0, -5.5, sdfPx);
  ripple *= 0.55 + 0.45 * foamNoise;
  col = mix(col, uRippleColor * uLight, ripple * 0.32);

  col = mix(col, uFoamColor * uLight, clamp(foam, 0.0, 1.0) * 0.5);
  float alpha = mix(0.55, 0.9, depthT);
  alpha = max(alpha, max(foam * 0.6, ripple * 0.5));
  // The coarse mesh can dip below Y=0 between low coastal land pixels
  // (deltas, lagoons) and let the sheet bleed inland in quad-sized blocks;
  // the baked coast SDF knows better — fade the sheet out over land.
  alpha *= 1.0 - smoothstep(0.8, 2.5, sdfPx);

  #ifdef CHRONICLE
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
    alpha = 1.0;
  #endif

  #ifdef CLOCKWORK
    // Lacquered, engraved sea: dark polished surface, carved wave lines
    // (contours of a slow noise field offshore, rings along the coasts),
    // a broad warm sheen from the hall light. Opaque, like the model.
    vec2 wp = vWorldPos.xz;
    float swell = wNoise(wp * 0.35 + vec2(uTime * 0.01, 0.0)) * 0.6 + wNoise(wp * 0.9 - vec2(0.0, uTime * 0.015)) * 0.4;
    float band = fract(swell * 7.0);
    float groove = 1.0 - smoothstep(0.0, 0.07, min(band, 1.0 - band));
    float ringCoord = -sdfPx * 0.5 + uTime * 0.04;
    float ringF = fract(ringCoord);
    float ring = (1.0 - smoothstep(0.0, 0.08, min(ringF, 1.0 - ringF))) * (1.0 - smoothstep(-1.0, -0.2, sdfPx)) * smoothstep(-9.0, -3.0, sdfPx);
    vec3 lac = mix(uShallowColor, uDeepColor, smoothstep(0.0, 0.35, depth)) * uLight;
    float carve = max(groove * 0.8, ring);
    lac *= 1.0 - 0.35 * carve;
    lac += uGlintColor * carve * 0.05 * uLight;
    float sheen = pow(max(dot(n, halfDir), 0.0), 24.0);
    lac += uGlintColor * (sheen * 0.12 + pow(max(dot(n, halfDir), 0.0), 220.0) * 1.0) * uGlintStrength;
    lac = mix(lac, uSkyColor * 0.6, fresnel * 0.35);
    col = lac;
    alpha = 1.0;
  #endif

  gl_FragColor = vec4(col, alpha);
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

  // Open ocean, always at full depth: the semi-transparent main sheet shows
  // alpha-0.8 deep water over the baked deep-sea albedo, so blending a bit
  // of that albedo tone into the deep color matches the seam by eye. Kept a
  // flat constant deliberately — continuing the clamped border texels of the
  // world textures out here (even mip-blurred) draws streak plumes off the
  // edge, and a crisp uniform facet reads as the diorama's edge instead.
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
 * Ring of open ocean around the world rect so max zoom-out never exposes the
 * bare background. Eight triangles between the rect edge and a rect APRON
 * units larger; the inner corners coincide with the main sheet's corners, so
 * the seam is vertex-exact. Opaque, no height/mask sampling (the border
 * texels of those textures are land along the south and east edges and would
 * bleed wrong tints out here), no shadows.
 */
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
  style: SeaStyle = 'painted',
): Water {
  const geometry = apronGeometry();

  const uniforms = UniformsUtils.merge([
    UniformsLib.fog,
    {
      uTime: { value: 0 },
      uDeepColor: { value: new Color(style === 'clockwork' ? LACQUER_DEEP : style === 'chronicle' ? WASH_DEEP : DEEP) },
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
      applyMood(uniforms, mood, style);
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
  style: SeaStyle = 'painted',
): Water {
  const clockwork = style === 'clockwork';
  const chronicle = style === 'chronicle';
  const opaque = clockwork || chronicle;
  if (textures.waterNormal) {
    textures.waterNormal.wrapS = RepeatWrapping;
    textures.waterNormal.wrapT = RepeatWrapping;
  }
  const uniforms = UniformsUtils.merge([
    UniformsLib.fog,
    {
      uTime: { value: 0 },
      uDeepColor: { value: new Color(clockwork ? LACQUER_DEEP : chronicle ? WASH_DEEP : DEEP) },
      uShallowColor: { value: new Color(clockwork ? LACQUER_SHALLOW : chronicle ? WASH_SHALLOW : SHALLOW) },
      uSkyColor: { value: new Color(WATER_FRESNEL_TINT) },
      uFoamColor: { value: new Color(0xe8efe6) },
      uRippleColor: { value: new Color(chronicle ? 0x2f4f5e : RIPPLE) },
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
    transparent: !opaque,
    depthWrite: opaque,
    fog: true,
    defines: clockwork ? { CLOCKWORK: '' } : chronicle ? { CHRONICLE: '' } : {},
  });

  // 2-unit segments: the curved-earth bend is per vertex (see apronGeometry).
  const geometry = new PlaneGeometry(GROUND_W, GROUND_H, GROUND_W / 2, GROUND_H / 2);
  geometry.rotateX(-Math.PI / 2); // plane in XZ, +Y up
  const mesh = new Mesh(geometry, material);
  mesh.position.set(GROUND_W / 2, 0, GROUND_H / 2);
  mesh.renderOrder = 10; // after opaque terrain
  mesh.frustumCulled = false; // bent by the curved earth
  mesh.updateMatrixWorld();

  return {
    mesh,
    setTime(t: number) {
      uniforms.uTime.value = t;
    },
    setMood(mood) {
      applyMood(uniforms, mood, style);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      textures.heightY.dispose();
    },
  };
}
