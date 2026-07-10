/**
 * Animated sea surface: one plane at Y=0 over the world rect. Scrolling
 * normal-map waves, depth-tinted color from the height field, fresnel sky
 * tint, sun glint, and shore foam driven by the baked coast distance field
 * (worldmask.R). Semi-transparent so the painterly baked shelf art glows
 * through. Land is above Y=0 and simply depth-tests the water away.
 */
import {
  Color,
  DataTexture,
  Mesh,
  PlaneGeometry,
  RepeatWrapping,
  ShaderMaterial,
  Texture,
  UniformsLib,
  UniformsUtils,
  Vector3,
} from 'three';
import { GROUND_W, GROUND_H } from './geo';
import { SUN_DIRECTION } from './lights';
import { SKY_COLOR } from './palette';

export interface Water {
  mesh: Mesh;
  /** Advance the wave animation (seconds). */
  setTime(t: number): void;
  dispose(): void;
}

const VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
#include <fog_pars_vertex>
varying vec2 vUv;
varying vec3 vWorldPos;
void main() {
  // World textures have north at V=0; the rotated plane's V runs the other
  // way, so flip here once and every sampler agrees.
  vUv = vec2(uv.x, 1.0 - uv.y);
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPos.xyz;
  vec4 mvPosition = viewMatrix * worldPos;
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
varying vec2 vUv;
varying vec3 vWorldPos;

void main() {
  #include <logdepthbuf_fragment>

  // Two counter-scrolling samples of the tileable wave normals (tangent
  // space; the plane's up is +Y so tangent XY maps to world XZ). Tiling is
  // aspect-corrected so waves are isotropic on the 232x100 rect.
  vec2 tileA = vec2(120.0, 51.7);
  vec2 tileB = vec2(53.0, 22.8);
  vec3 na = texture2D(uWaterNormal, vUv * tileA + uTime * vec2(0.010, 0.006)).rgb * 2.0 - 1.0;
  vec3 nb = texture2D(uWaterNormal, vUv * tileB - uTime * vec2(0.007, 0.010)).rgb * 2.0 - 1.0;
  vec3 n = normalize(vec3(na.x + nb.x, 2.8, na.y + nb.y));

  float bedY = texture2D(uHeightY, vUv).r; // world-unit Y of the seabed
  float depth = max(0.0, -bedY);
  float depthT = smoothstep(0.0, 0.28, depth); // ~3100 m at full tint

  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  vec3 col = mix(uShallowColor, uDeepColor, depthT);
  float fresnel = pow(1.0 - max(dot(viewDir, n), 0.0), 3.0);
  col = mix(col, uSkyColor, fresnel * 0.5);
  vec3 halfDir = normalize(viewDir + uSunDir);
  col += vec3(1.0, 0.93, 0.78) * pow(max(dot(n, halfDir), 0.0), 90.0) * 0.5;

  // Shore foam: a thin, noise-broken animated lick just seaward of the coast.
  float maskR = texture2D(uWorldMask, vUv).r;
  float sdfPx = (maskR * 255.0 - 128.0) / 6.0; // signed px from coast (+land)
  float foamBand = 1.0 - smoothstep(0.2, 1.5, abs(sdfPx + 0.8));
  float foamWave = 0.55 + 0.45 * sin(uTime * 1.1 - sdfPx * 2.3);
  float foamNoise = texture2D(uWaterNormal, vUv * vec2(190.0, 81.9) + uTime * vec2(0.020, 0.013)).b;
  float foam = foamBand * foamWave * smoothstep(0.5, 0.85, foamNoise);

  col = mix(col, uFoamColor, clamp(foam, 0.0, 1.0) * 0.55);
  float alpha = mix(0.45, 0.8, depthT);
  alpha = max(alpha, foam * 0.6);
  // The coarse mesh can dip below Y=0 between low coastal land pixels
  // (deltas, lagoons) and let the sheet bleed inland in quad-sized blocks;
  // the baked coast SDF knows better — fade the sheet out over land.
  alpha *= 1.0 - smoothstep(0.8, 2.5, sdfPx);

  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

export function createWater(textures: {
  waterNormal: Texture | null;
  heightY: DataTexture;
  worldMask: Texture | null;
}): Water {
  if (textures.waterNormal) {
    textures.waterNormal.wrapS = RepeatWrapping;
    textures.waterNormal.wrapT = RepeatWrapping;
  }
  const uniforms = UniformsUtils.merge([
    UniformsLib.fog,
    {
      uTime: { value: 0 },
      uDeepColor: { value: new Color(0x0e2e45) },
      uShallowColor: { value: new Color(0x2e6f80) },
      uSkyColor: { value: new Color(SKY_COLOR) },
      uFoamColor: { value: new Color(0xdfe9e4) },
      uSunDir: { value: new Vector3().copy(SUN_DIRECTION) },
    },
  ]);
  // Textures are assigned after merge (UniformsUtils.merge clones values).
  uniforms.uWaterNormal = { value: textures.waterNormal };
  uniforms.uHeightY = { value: textures.heightY };
  uniforms.uWorldMask = { value: textures.worldMask };

  const material = new ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms,
    transparent: true,
    depthWrite: false,
    fog: true,
  });

  const geometry = new PlaneGeometry(GROUND_W, GROUND_H);
  geometry.rotateX(-Math.PI / 2); // plane in XZ, +Y up
  const mesh = new Mesh(geometry, material);
  mesh.position.set(GROUND_W / 2, 0, GROUND_H / 2);
  mesh.renderOrder = 10; // after opaque terrain
  mesh.updateMatrixWorld();

  return {
    mesh,
    setTime(t: number) {
      uniforms.uTime.value = t;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      textures.heightY.dispose();
    },
  };
}
