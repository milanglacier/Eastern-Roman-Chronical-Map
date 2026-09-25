/**
 * Living chronicle map terrain: the world drawn as an illuminated
 * manuscript in natural colours.
 *  - Parchment ground under watercolour washes whose pigment comes from the
 *    baked albedo (softened, granulated, pooled along the coasts).
 *  - Ink drawn OVER the lit wash (ink is not lit): contours, and hachures —
 *    short strokes down every slope, denser on steep and shaded ground, at a
 *    stroke spacing that stays a few screen px at any distance — plus the
 *    coastline.
 *  - Watercolour-blue rivers.
 *  - The empire, in the imperial colours reserved for it: a purple glaze,
 *    and a purple frontier rule edged in gold leaf.
 */
import { Color, Mesh, MeshStandardMaterial, RepeatWrapping, Texture, Vector2 } from 'three';
import type { HeightField } from '../heightField';
import { applyCurvature } from '../curvature';
import { GROUND_W, GROUND_H } from '../geo';
import { blankTerritoryTexture, buildTerrainGeometry, createTerrainUniforms, type Terrain } from '../terrain';

export const PARCHMENT = 0xecdcb4;
export const SEPIA_INK = 0x3a2a1e;
/** Frontier rule in imperial purple, with a gold edge (GOLD_LEAF). */
export const IMPERIAL_PURPLE = 0x5e2590;
export const GOLD_LEAF = 0xd4a93c;

export function buildChronicleTerrain(
  hf: HeightField,
  textures: { albedo: Texture | null; worldMask?: Texture | null; granulation?: Texture | null },
  surfaceY: (meters: number, lon: number, lat: number) => number,
): Terrain {
  const uniforms = createTerrainUniforms();
  if (textures.granulation) {
    textures.granulation.wrapS = RepeatWrapping;
    textures.granulation.wrapT = RepeatWrapping;
  }
  const extra = {
    uWorldMask: { value: (textures.worldMask ?? blankTerritoryTexture()) as Texture },
    uGranulation: { value: (textures.granulation ?? blankTerritoryTexture()) as Texture },
    uPaper: { value: new Color(PARCHMENT) },
    uInk: { value: new Color(SEPIA_INK) },
    uImperialPurple: { value: new Color(IMPERIAL_PURPLE) },
    uGold: { value: new Color(GOLD_LEAF) },
    uWorldSize: { value: new Vector2(GROUND_W, GROUND_H) },
    uContourStep: { value: 0.16 },
  };

  const material = new MeshStandardMaterial({
    map: textures.albedo ?? undefined,
    roughness: 0.95,
    metalness: 0,
    envMapIntensity: 0.9,
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
        uniform sampler2D uGranulation;
        uniform vec3 uPaper;
        uniform vec3 uInk;
        uniform vec3 uImperialPurple;
        uniform vec3 uGold;
        uniform vec2 uWorldSize;
        uniform float uContourStep;
        float chHash(vec2 p) {
          vec3 p3 = fract(vec3(p.xyx) * 0.1031);
          p3 += dot(p3, p3.yzx + 33.33);
          return fract((p3.x + p3.y) * p3.z);
        }
        float chNoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(chHash(i), chHash(i + vec2(1.0, 0.0)), f.x), mix(chHash(i + vec2(0.0, 1.0)), chHash(i + vec2(1.0, 1.0)), f.x), f.y);
        }
        float isoPx(float r) { return (r - 0.5) / max(fwidth(r), 0.004); }
        // One family of parallel strokes: lines across 'across', broken into
        // dashes along 'along' (each line its own random phase = hand-drawn).
        float strokes(vec2 p, vec2 across, vec2 along, float spacing) {
          float u = dot(p, across) / spacing;
          float line = 1.0 - smoothstep(0.11, 0.11 + fwidth(u) * 1.4, abs(fract(u) - 0.5));
          // Long strokes with short gaps (a pen lifting now and then).
          float v = dot(p, along) / (spacing * 7.0) + chHash(vec2(floor(u), 7.0)) * 5.0;
          float dash = smoothstep(0.04, 0.1, fract(v)) * (1.0 - smoothstep(0.8, 0.88, fract(v)));
          return line * dash;
        }`,
      )
      .replace(
        '#include <map_fragment>',
        /* glsl */ `#include <map_fragment>
        vec2 chUv = vCwPos.xz / uWorldSize;
        vec3 alb = diffuseColor.rgb;
        // Watercolour pigment from the baked albedo: softer, lighter.
        float lumA = dot(alb, vec3(0.2126, 0.7152, 0.0722));
        vec3 pigment = mix(vec3(lumA), alb, 0.95);
        pigment = mix(pigment, uPaper, 0.1);
        float gran = texture2D(uGranulation, vCwPos.xz * 0.7).r;
        float blot = chNoise(vCwPos.xz * 0.55) * 0.6 + chNoise(vCwPos.xz * 2.1) * 0.4;
        float washAmt = clamp(0.8 * (0.75 + 0.4 * blot) * (0.85 + 0.3 * gran), 0.0, 1.0);
        vec3 col = mix(uPaper, pigment, washAmt);
        col *= 0.965 + 0.05 * chNoise(vCwPos.xz * 70.0); // paper fibre
        vec4 wm = texture2D(uWorldMask, chUv);
        float coastPx = (wm.r * 255.0 - 128.0) / 6.0;
        float landM = smoothstep(-0.2, 0.8, coastPx);
        // Pigment pools along the coast, as a wash does at its edge.
        float halo = (1.0 - smoothstep(0.4, 4.5, coastPx)) * landM;
        col = mix(col, col * vec3(0.8, 0.76, 0.72), halo * 0.5);
        diffuseColor.rgb = col;

        float riverMask = smoothstep(0.3, 0.55, wm.g) * landM; // watercolour rivers
        vec2 territoryA = texture2D(uTerritoryA, chUv).rg;
        vec2 territoryB = texture2D(uTerritoryB, chUv).rg;
        vec2 territory = mix(territoryA, territoryB, uTerritoryMix);
        float pa = isoPx(territoryA.r);
        float pb = isoPx(territoryB.r);
        float inland = smoothstep(3.0, 7.0, abs(coastPx));
        // Imperial frontier: a broad purple rule edged in gold on the inside.
        float rubric = mix(1.0 - smoothstep(1.6, 2.6, abs(pa)), 1.0 - smoothstep(1.6, 2.6, abs(pb)), uTerritoryMix) * inland;
        float gilt = mix(1.0 - smoothstep(0.8, 1.5, abs(pa - 3.8)), 1.0 - smoothstep(0.8, 1.5, abs(pb - 3.8)), uTerritoryMix) * inland;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.28, 0.5, 0.58), riverMask * 0.85);
        diffuseColor.rgb *= mix(vec3(1.0), uTerritoryTint, clamp(territory.r * uTerritoryStrength, 0.0, 1.0));
        diffuseColor.rgb = mix(diffuseColor.rgb, uImperialPurple, rubric * 0.9 * uBorderIntensity);
        float goldMask = gilt * uBorderIntensity; // gold leaf: metallic, burnished
        diffuseColor.rgb = mix(diffuseColor.rgb, uGold, goldMask);`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>\n        roughnessFactor = mix(roughnessFactor, 0.32, goldMask);`,
      )
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>\n        metalnessFactor = mix(metalnessFactor, 1.0, goldMask);`,
      )
      .replace(
        '#include <opaque_fragment>',
        /* glsl */ `#include <opaque_fragment>
        // ---- Ink, drawn over the lit wash (before fog) ----
        float tone = dot(gl_FragColor.rgb, vec3(0.2126, 0.7152, 0.0722));
        vec3 nrm = normalize(vCwNormal);
        float slope = 1.0 - clamp(nrm.y, 0.0, 1.0);
        float inkA = 0.0;
        // Contours (every 5th bolder), faded out where they would crowd.
        float hy = max(vCwPos.y, 0.0) / uContourStep;
        float fwH = fwidth(hy);
        float dC = min(fract(hy), 1.0 - fract(hy));
        float contour = (1.0 - smoothstep(fwH * 0.5, fwH * 1.5, dC)) * (1.0 - smoothstep(0.2, 0.45, fwH));
        float idx = 1.0 - step(0.5, mod(floor(hy + 0.5), 5.0)); // every 5th: index contour
        inkA = max(inkA, contour * mix(0.22, 0.42, idx) * landM * step(0.06, vCwPos.y));
        // Hachures: strokes down the slope, spacing ~6 screen px, two LOD
        // octaves crossfaded so the pattern never pops.
        vec2 down = normalize(nrm.xz + vec2(1e-5));
        vec2 across = vec2(-down.y, down.x);
        float pxW = length(fwidth(vCwPos.xz));
        float lvl = log2(max(pxW * 9.0, 1e-5) / 0.01);
        float l0 = floor(lvl);
        float sp0 = 0.01 * exp2(l0);
        float h0 = strokes(vCwPos.xz, across, down, sp0);
        float h1 = strokes(vCwPos.xz, across, down, sp0 * 2.0);
        float hatch = mix(h0, h1, fract(lvl));
        float shade = 1.0 - clamp(tone * 1.6, 0.0, 1.0);
        float hatchAmt = smoothstep(0.07, 0.38, slope) * (0.55 + 0.9 * shade);
        inkA = max(inkA, hatch * clamp(hatchAmt, 0.0, 1.0) * 0.85 * landM);
        // The coastline itself, in firm ink.
        float coastW = fwidth(coastPx) * 1.3 + 1e-4;
        float coastLine = 1.0 - smoothstep(coastW * 0.6, coastW * 1.6, abs(coastPx - 0.3));
        inkA = max(inkA, coastLine * 0.85);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, uInk, clamp(inkA, 0.0, 1.0));
`,
      );
  };
  applyCurvature(material, 'chronicle-terrain');

  const geometry = buildTerrainGeometry(hf, surfaceY);
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
