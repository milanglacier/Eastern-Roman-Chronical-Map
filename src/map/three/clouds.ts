/**
 * Drifting cloud deck: one tileable density texture (baked clouds.png)
 * scrolled by a constant wind drives both a translucent cloud layer at
 * altitude (visible from far zoom) and the moving cloud shadows on land and
 * sea. Shadows are the cloud density projected down the sun direction, so
 * each shadow sits exactly where its cloud's shadow would fall.
 */
import {
  Color,
  DoubleSide,
  Mesh,
  PlaneGeometry,
  RepeatWrapping,
  ShaderMaterial,
  Texture,
  UniformsLib,
  UniformsUtils,
  Vector2,
} from 'three';
import { GROUND_W, GROUND_H } from './geo';
import { SUN_DIRECTION } from './lights';

/**
 * Cloud deck altitude in world units (~40 km: stylized, but low enough that
 * each shadow falls right beside its cloud — at the sun's 34° elevation the
 * shadow sits 1.5x this height downwind, and a high deck splits every cloud
 * into a hard bright/dark pair).
 */
export const CLOUD_Y = 1.5;
/** World units covered by one tile of the cloud texture. */
const CLOUD_TILE = 44;
/** Wind drift, world units per second (~2 km/s — sped up for life). */
const CLOUD_WIND = new Vector2(0.07, 0.025);
/** Density threshold: higher = clearer sky. */
const CLOUD_COVERAGE = 0.55;
/** Density ramp above the threshold: wide = soft, wispy edges. */
const CLOUD_SOFTNESS = 0.36;
/** Direct-light loss under a full cloud shadow. */
export const CLOUD_SHADOW_STRENGTH = 0.3;

/** Camera distance where the cloud layer starts to show, and is full. */
const LAYER_FADE_START = 95;
const LAYER_FADE_END = 190;
const LAYER_MAX_OPACITY = 0.8;

export interface CloudUniforms {
  uCloudTex: { value: Texture | null };
  uCloudTime: { value: number };
  uCloudWind: { value: Vector2 };
  uCloudCoverage: { value: number };
  uCloudSoftness: { value: number };
  uCloudTile: { value: number };
  uCloudY: { value: number };
  /** Sun direction projected per unit height: xz offset to the deck. */
  uCloudSunSlope: { value: Vector2 };
  uCloudShadowStrength: { value: number };
}

export function createCloudUniforms(tex: Texture | null): CloudUniforms {
  if (tex) {
    tex.wrapS = RepeatWrapping;
    tex.wrapT = RepeatWrapping;
  }
  return {
    uCloudTex: { value: tex },
    uCloudTime: { value: 0 },
    uCloudWind: { value: CLOUD_WIND.clone() },
    uCloudCoverage: { value: tex ? CLOUD_COVERAGE : 2.0 }, // no texture → no clouds
    uCloudSoftness: { value: CLOUD_SOFTNESS },
    uCloudTile: { value: CLOUD_TILE },
    uCloudY: { value: CLOUD_Y },
    uCloudSunSlope: {
      value: new Vector2(SUN_DIRECTION.x / SUN_DIRECTION.y, SUN_DIRECTION.z / SUN_DIRECTION.y),
    },
    uCloudShadowStrength: { value: CLOUD_SHADOW_STRENGTH },
  };
}

/** GLSL declarations + helpers; include once per fragment shader. */
export const CLOUD_GLSL = /* glsl */ `
uniform sampler2D uCloudTex;
uniform float uCloudTime;
uniform vec2 uCloudWind;
uniform float uCloudCoverage;
uniform float uCloudSoftness;
uniform float uCloudTile;
uniform float uCloudY;
uniform vec2 uCloudSunSlope;
uniform float uCloudShadowStrength;
float cloudDensity(vec2 xz) {
  vec2 drift = xz - uCloudWind * uCloudTime;
  float d = texture2D(uCloudTex, drift / uCloudTile).r;
  // Weather fronts: a slow, 5.3x larger read of the same texture swings the
  // coverage so some regions stay clear and others overcast — it also hides
  // the tile repeat.
  float front = texture2D(uCloudTex, drift / (uCloudTile * 5.3) + 0.37).r;
  float coverage = uCloudCoverage + (0.5 - front) * 0.42;
  return smoothstep(coverage, coverage + uCloudSoftness, d);
}
/** 0 = open sun, 1 = full cloud shadow, for a world-space point. */
float cloudShadow(vec3 worldPos) {
  return cloudDensity(worldPos.xz + uCloudSunSlope * (uCloudY - worldPos.y));
}
`;

const LAYER_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
#include <fog_pars_vertex>
varying vec3 vWorldPos;
void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPos.xyz;
  vec4 mvPosition = viewMatrix * worldPos;
  gl_Position = projectionMatrix * mvPosition;
  #include <logdepthbuf_vertex>
  #include <fog_vertex>
}
`;

const LAYER_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
#include <fog_pars_fragment>
${CLOUD_GLSL}
uniform float uOpacity;
uniform vec3 uLitColor;
uniform vec3 uShadeColor;
varying vec3 vWorldPos;
void main() {
  #include <logdepthbuf_fragment>
  float d = cloudDensity(vWorldPos.xz);
  if (d < 0.004) discard;
  // Cheap self-shadowing: denser cloud toward the sun darkens this texel.
  float towardSun = cloudDensity(vWorldPos.xz + uCloudSunSlope * 0.35);
  float shade = clamp(towardSun * 0.9 + d * 0.25, 0.0, 1.0);
  vec3 col = mix(uLitColor, uShadeColor, shade * 0.75);
  gl_FragColor = vec4(col, d * uOpacity);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

export interface CloudLayer {
  mesh: Mesh;
  /** Fade the layer with camera distance (call on zoom changes). */
  update(cameraDistance: number): void;
  dispose(): void;
}

export function createCloudLayer(clouds: CloudUniforms): CloudLayer {
  const margin = 260;
  const geometry = new PlaneGeometry(GROUND_W + margin * 2, GROUND_H + margin * 2);
  geometry.rotateX(-Math.PI / 2);
  const uniforms = UniformsUtils.merge([
    UniformsLib.fog,
    {
      uOpacity: { value: 0 },
      uLitColor: { value: new Color(0xfffaf0) },
      uShadeColor: { value: new Color(0x9aa7b8) },
    },
  ]);
  // Shared by reference so the time/wind advance in one place.
  Object.assign(uniforms, clouds);
  const material = new ShaderMaterial({
    vertexShader: LAYER_VERT,
    fragmentShader: LAYER_FRAG,
    uniforms,
    transparent: true,
    depthWrite: false,
    fog: true,
    side: DoubleSide,
  });
  const mesh = new Mesh(geometry, material);
  mesh.position.set(GROUND_W / 2, CLOUD_Y, GROUND_H / 2);
  mesh.renderOrder = 20; // after water
  mesh.updateMatrixWorld();
  mesh.visible = false;

  return {
    mesh,
    update(cameraDistance: number) {
      const t = Math.min(
        1,
        Math.max(0, (cameraDistance - LAYER_FADE_START) / (LAYER_FADE_END - LAYER_FADE_START)),
      );
      const opacity = t * t * (3 - 2 * t) * LAYER_MAX_OPACITY;
      uniforms.uOpacity.value = opacity;
      mesh.visible = opacity > 0.001 && clouds.uCloudTex.value !== null;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
