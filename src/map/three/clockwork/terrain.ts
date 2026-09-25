/**
 * Clockwork terrain: the world as a carved stone model. Sculpted relief
 * (src/lib/clockworkRelief.ts) with a stone ramp by height, engraved
 * contour lines at every terrace, darker carved risers, a faint regional
 * tint borrowed from the painted albedo, and brass inlays for rivers and
 * the imperial frontier. Territory is a thin lacquer glaze. Bent by the
 * curved world like everything else.
 */
import { Color, Mesh, MeshStandardMaterial, RepeatWrapping, Texture } from 'three';
import type { HeightField } from '../heightField';
import { applyCurvature } from '../curvature';
import { blankTerritoryTexture, buildTerrainGeometry, createTerrainUniforms, type Terrain } from '../terrain';
import { LAND_SLAB, TERRACE_STEP } from '../../../lib/clockworkRelief';

export const STONE = {
  low: 0x716a5e,
  mid: 0x908878,
  high: 0xb4ab97,
  peak: 0xdcd5c6,
};
export const BRASS = 0xc9a45c;
/** Imperial lacquer: a light violet glaze multiplied into the stone. */
const LACQUER = 0xc4a8e0;

/**
 * The mesh samples the DEM every ~2.5 heightmap px, which aliases single-
 * pixel peaks into stalagmite spikes once the relief is sculpted up; a
 * small tent blur (land only, so coasts keep their cut) rounds the forms.
 */
function smoothedField(hf: HeightField): HeightField {
  const r = 1.2 / hf.width * (hf.meta.bbox.lonMax - hf.meta.bbox.lonMin);
  const s = 1.2 / hf.height * (hf.meta.bbox.latMax - hf.meta.bbox.latMin);
  const heightAt = (lon: number, lat: number) => {
    const c = hf.heightAt(lon, lat);
    if (c <= 0) return c;
    let sum = c * 4;
    let w = 4;
    for (const [dx, dy, k] of [[1, 0, 2], [-1, 0, 2], [0, 1, 2], [0, -1, 2], [1, 1, 1], [-1, 1, 1], [1, -1, 1], [-1, -1, 1]]) {
      const v = hf.heightAt(lon + dx * r, lat + dy * s);
      if (v > 0) {
        sum += v * k;
        w += k;
      }
    }
    return sum / w;
  };
  return { ...hf, heightAt, yAt: (lon, lat) => hf.metersToY(heightAt(lon, lat)) };
}

export function buildClockworkTerrain(
  hf: HeightField,
  textures: { albedo: Texture | null; worldMask?: Texture | null },
  surfaceY: (meters: number, lon: number, lat: number) => number,
): Terrain {
  const uniforms = createTerrainUniforms();
  uniforms.uTerritoryTint.value = new Color(LACQUER);
  uniforms.uTerritoryStrength.value = 0.22;
  uniforms.uBorderColor.value = new Color(BRASS);
  const worldMaskTex = textures.worldMask ?? blankTerritoryTexture();
  if (textures.worldMask) {
    textures.worldMask.wrapS = RepeatWrapping;
  }
  const extra = {
    uWorldMask: { value: worldMaskTex as Texture },
    uStoneLow: { value: new Color(STONE.low) },
    uStoneMid: { value: new Color(STONE.mid) },
    uStoneHigh: { value: new Color(STONE.high) },
    uStonePeak: { value: new Color(STONE.peak) },
    uBrass: { value: new Color(BRASS) },
    uSlab: { value: LAND_SLAB },
    uTerraceStep: { value: TERRACE_STEP },
  };

  const material = new MeshStandardMaterial({
    map: textures.albedo ?? undefined,
    color: 0xffffff,
    roughness: 0.86,
    metalness: 0,
    envMapIntensity: 0.55,
  });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms, extra);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vCwPos;\nvarying vec3 vCwNormal;`)
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vCwPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vCwNormal = normalize(mat3(modelMatrix) * objectNormal);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        varying vec3 vCwPos;
        varying vec3 vCwNormal;
        uniform sampler2D uTerritoryA;
        uniform sampler2D uTerritoryB;
        uniform float uTerritoryMix;
        uniform vec3 uTerritoryTint;
        uniform float uTerritoryStrength;
        uniform vec3 uBorderColor;
        uniform float uBorderIntensity;
        uniform float uNight;
        uniform float uTime;
        uniform sampler2D uWorldMask;
        uniform vec3 uStoneLow;
        uniform vec3 uStoneMid;
        uniform vec3 uStoneHigh;
        uniform vec3 uStonePeak;
        uniform vec3 uBrass;
        uniform float uSlab;
        uniform float uTerraceStep;
        float cwHash(vec2 p) {
          vec3 p3 = fract(vec3(p.xyx) * 0.1031);
          p3 += dot(p3, p3.yzx + 33.33);
          return fract((p3.x + p3.y) * p3.z);
        }
        float cwNoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(cwHash(i), cwHash(i + vec2(1.0, 0.0)), f.x), mix(cwHash(i + vec2(0.0, 1.0)), cwHash(i + vec2(1.0, 1.0)), f.x), f.y);
        }
        float isoPx(float r) { return (r - 0.5) / max(fwidth(r), 0.004); }`,
      )
      .replace(
        '#include <map_fragment>',
        /* glsl */ `#include <map_fragment>
        vec3 albedoC = diffuseColor.rgb;
        float hy = max(vCwPos.y - uSlab, 0.0);
        vec3 stone = mix(uStoneLow, uStoneMid, smoothstep(0.0, 0.9, hy));
        stone = mix(stone, uStoneHigh, smoothstep(0.9, 2.3, hy));
        stone = mix(stone, uStonePeak, smoothstep(2.5, 3.8, hy));
        // A whisper of regional colour (sandy south, greener north).
        float lum = dot(albedoC, vec3(0.2126, 0.7152, 0.0722));
        vec3 chroma = albedoC / max(lum, 1e-3);
        stone *= mix(vec3(1.0), chroma, 0.3);
        // Stone mottle at two scales.
        float n1 = cwNoise(vCwPos.xz * 5.0);
        float n2 = cwNoise(vCwPos.xz * 41.0);
        stone *= 0.88 + 0.14 * n1 + 0.08 * n2;
        // Carved risers and cliffs read darker than the terrace treads.
        float slope = 1.0 - clamp(normalize(vCwNormal).y, 0.0, 1.0);
        stone *= mix(1.0, 0.62, smoothstep(0.22, 0.72, slope));
        // Engraved contour at each terrace step.
        float f = fract(hy / uTerraceStep);
        float dLine = min(f, 1.0 - f) * uTerraceStep;
        float wLine = fwidth(hy) * 1.1 + 1e-5;
        float contour = (1.0 - smoothstep(wLine * 0.6, wLine * 1.7, dLine)) * step(0.03, hy);
        stone *= 1.0 - 0.32 * contour;
        diffuseColor.rgb = stone;

        vec2 cwUv = vMapUv;
        vec4 wm = texture2D(uWorldMask, cwUv);
        float brassMask = smoothstep(0.3, 0.55, wm.g); // rivers: brass inlay
        vec2 territoryA = texture2D(uTerritoryA, cwUv).rg;
        vec2 territoryB = texture2D(uTerritoryB, cwUv).rg;
        vec2 territory = mix(territoryA, territoryB, uTerritoryMix);
        float pa = isoPx(territoryA.r);
        float pb = isoPx(territoryB.r);
        float coastPx = abs(wm.r * 255.0 - 128.0) / 6.0;
        float inland = smoothstep(3.0, 7.0, coastPx);
        float rail = mix(1.0 - smoothstep(1.1, 2.1, abs(pa)), 1.0 - smoothstep(1.1, 2.1, abs(pb)), uTerritoryMix) * inland;
        diffuseColor.rgb *= mix(vec3(1.0), uTerritoryTint, clamp(territory.r * uTerritoryStrength, 0.0, 1.0));
        brassMask = max(brassMask, rail * uBorderIntensity);
        diffuseColor.rgb = mix(diffuseColor.rgb, uBrass, brassMask);`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>\n        roughnessFactor = mix(roughnessFactor, 0.28, brassMask);`,
      )
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>\n        metalnessFactor = mix(metalnessFactor, 1.0, brassMask);`,
      );
  };
  applyCurvature(material, 'clockwork-terrain');

  const geometry = buildTerrainGeometry(smoothedField(hf), surfaceY);
  const mesh = new Mesh(geometry, material);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  mesh.frustumCulled = false;

  return {
    mesh,
    material,
    uniforms,
    dispose() {
      geometry.dispose();
      material.dispose();
      uniforms.uTerritoryA.value.dispose();
      uniforms.uTerritoryB.value.dispose();
    },
  };
}
