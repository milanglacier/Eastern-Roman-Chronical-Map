/**
 * Terrain mesh: a CPU-displaced grid over the world rect, shaded by a
 * MeshStandardMaterial with onBeforeCompile injections: flow-aligned brush
 * strokes over the painted albedo, living river water, and the empire as a
 * watercolour glaze with an inked-and-gilded frontier (fed by
 * territory.ts). Bent by the curved earth (curvature.ts). Standard
 * material means lights/shadows/fog come from three for free.
 */
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  DoubleSide,
  Mesh,
  MeshStandardMaterial,
  ObjectSpaceNormalMap,
  RepeatWrapping,
  RGBAFormat,
  RGFormat,
  Texture,
  UnsignedByteType,
} from 'three';
import type { HeightField } from './heightField';
import { GROUND_W, GROUND_H, groundToLonLat } from './geo';
import { TERRITORY_TINT, TERRITORY_TINT_STRENGTH, TERRITORY_BORDER, TERRITORY_INK } from '../colors';
import { applyCurvature } from './curvature';

/** 16 quads per degree — ~1.29M tris; trivial for real GPUs (llvmpipe FPS is not a target). */
export const SEGMENTS_X = 1152;
export const SEGMENTS_Z = 560;

export interface TerrainUniforms {
  uTime: { value: number };
  uTerritoryA: { value: Texture };
  uTerritoryB: { value: Texture };
  uTerritoryMix: { value: number };
  uTerritoryTint: { value: Color };
  uTerritoryStrength: { value: number };
  uBorderColor: { value: Color };
  uBorderIntensity: { value: number };
  uInkColor: { value: Color };
  /** 0..1 night: frontier gilt catches lamplight. */
  uNight: { value: number };
}

export interface Terrain {
  mesh: Mesh;
  material: MeshStandardMaterial;
  uniforms: TerrainUniforms;
  dispose(): void;
}

/** 1×1 transparent RG texture = "no territory"; swapped by territory.ts. */
export function blankTerritoryTexture(): DataTexture {
  const tex = new DataTexture(new Uint8Array([0, 0]), 1, 1, RGFormat, UnsignedByteType);
  tex.flipY = false;
  tex.needsUpdate = true;
  return tex;
}

/** Neutral 1×1 detail texture (B=128 → multiply by 1.0) for the fallback path. */
function blankDetailTexture(): DataTexture {
  const tex = new DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1, RGBAFormat, UnsignedByteType);
  tex.flipY = false;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Grid over the world rect. `yOf` maps raw meters to world Y; by default
 * the map shaping (`hf.yAt`), the clockwork theme passes its sculpted relief.
 */
export function buildTerrainGeometry(
  hf: HeightField,
  yOf?: (meters: number, lon: number, lat: number) => number,
): BufferGeometry {
  const vertsX = SEGMENTS_X + 1;
  const vertsZ = SEGMENTS_Z + 1;
  const positions = new Float32Array(vertsX * vertsZ * 3);
  const uvs = new Float32Array(vertsX * vertsZ * 2);
  for (let j = 0; j < vertsZ; j++) {
    const z = (j / SEGMENTS_Z) * GROUND_H;
    for (let i = 0; i < vertsX; i++) {
      const x = (i / SEGMENTS_X) * GROUND_W;
      const { lon, lat } = groundToLonLat(x, z);
      const o = (j * vertsX + i) * 3;
      positions[o] = x;
      positions[o + 1] = yOf ? yOf(hf.heightAt(lon, lat), lon, lat) : hf.yAt(lon, lat);
      positions[o + 2] = z;
      const t = (j * vertsX + i) * 2;
      uvs[t] = x / GROUND_W;
      uvs[t + 1] = z / GROUND_H; // flipY=false textures: V=0 at north
    }
  }
  const indices = new Uint32Array(SEGMENTS_X * SEGMENTS_Z * 6);
  let k = 0;
  for (let j = 0; j < SEGMENTS_Z; j++) {
    for (let i = 0; i < SEGMENTS_X; i++) {
      const a = j * vertsX + i;
      const b = a + 1;
      const c = a + vertsX;
      const d = c + 1;
      indices[k++] = a;
      indices[k++] = c;
      indices[k++] = b;
      indices[k++] = b;
      indices[k++] = c;
      indices[k++] = d;
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2));
  geometry.setIndex(new BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  return geometry;
}

export function createTerrainUniforms(): TerrainUniforms {
  return {
    uTime: { value: 0 },
    uTerritoryA: { value: blankTerritoryTexture() },
    uTerritoryB: { value: blankTerritoryTexture() },
    uTerritoryMix: { value: 0 },
    uTerritoryTint: { value: new Color(TERRITORY_TINT) },
    uTerritoryStrength: { value: TERRITORY_TINT_STRENGTH },
    uBorderColor: { value: new Color(TERRITORY_BORDER) },
    uBorderIntensity: { value: 1 },
    uInkColor: { value: new Color(TERRITORY_INK) },
    uNight: { value: 0 },
  };
}

export function buildTerrain(
  hf: HeightField,
  textures: {
    albedo: Texture | null;
    normal: Texture | null;
    detail: Texture | null;
    brush?: Texture | null;
    worldMask?: Texture | null;
  },
): Terrain {
  const detailTex = textures.detail ?? blankDetailTexture();
  detailTex.wrapS = RepeatWrapping;
  detailTex.wrapT = RepeatWrapping;
  const brushTex = textures.brush ?? blankDetailTexture();
  brushTex.wrapS = RepeatWrapping;
  brushTex.wrapT = RepeatWrapping;
  // Missing worldmask -> RG zeros -> river mask 0 everywhere (no shimmer).
  const worldMaskTex = textures.worldMask ?? blankTerritoryTexture();
  const uniforms = createTerrainUniforms();

  const material = new MeshStandardMaterial({
    map: textures.albedo ?? undefined,
    color: textures.albedo ? 0xffffff : 0x8a8a80,
    roughness: 1,
    metalness: 0,
  });
  if (textures.normal) {
    material.normalMap = textures.normal;
    material.normalMapType = ObjectSpaceNormalMap;
  }
  const uDetailTex = { value: detailTex as Texture };
  const uBrushTex = { value: brushTex as Texture };
  const uWorldMask = { value: worldMaskTex as Texture };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.uniforms.uDetailTex = uDetailTex;
    shader.uniforms.uBrushTex = uBrushTex;
    shader.uniforms.uWorldMask = uWorldMask;
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        uniform sampler2D uTerritoryA;
        uniform sampler2D uTerritoryB;
        uniform float uTerritoryMix;
        uniform vec3 uTerritoryTint;
        uniform float uTerritoryStrength;
        uniform vec3 uBorderColor;
        uniform float uBorderIntensity;
        uniform vec3 uInkColor;
        uniform float uNight;
        uniform float uTime;
        uniform sampler2D uDetailTex;
        uniform sampler2D uBrushTex;
        uniform sampler2D uWorldMask;
        // Signed screen-px distance to a mask's r = 0.5 iso-line (per slot,
        // so a crossfade never swims). Capped so far zoom can't smear it.
        float isoPx(float r) { return (r - 0.5) / max(fwidth(r), 0.004); }`,
      )
      .replace(
        '#include <map_fragment>',
        /* glsl */ `#include <map_fragment>
        float riverM = 0.0;
        float riverWave = 0.0;
        float granulation = 0.5;
        #ifdef USE_MAP
          vec2 territoryUv = vMapUv;
          // Brush strokes: the baked stroke tile (180°-symmetric, so the
          // angle wrap is seamless) rotated along the flow field in
          // worldmask.B — contour-following on slopes, swirling on flats.
          // Two scales so close zoom never reads as a blurry upscale.
          vec4 wm = texture2D(uWorldMask, vMapUv);
          float flow = wm.b * 3.14159265;
          // Rotate by -flow (GLSL mat2 is column-major) so the tile's
          // stroke axis (+x) lines up with the flow direction.
          mat2 flowRot = mat2(cos(flow), -sin(flow), sin(flow), cos(flow));
          vec2 worldUv = vMapUv * vec2(${GROUND_W.toFixed(1)}, ${GROUND_H.toFixed(1)});
          float strokeA = texture2D(uBrushTex, flowRot * worldUv * 0.9).r;
          float strokeB = texture2D(uBrushTex, flowRot * worldUv * 3.7 + 0.37).r;
          granulation = texture2D(uBrushTex, worldUv * 1.3).g;
          diffuseColor.rgb *= 0.9 + 0.13 * strokeA + 0.07 * strokeB;
          // River channels (worldmask.G): two counter-scrolling noise reads
          // make the painted course move like water instead of a decal.
          riverM = texture2D(uWorldMask, vMapUv).g;
          if (riverM > 0.003) {
            // R/G of the wave normal map are zero-mean around 0.5 (B is
            // normal-Z ~= 1.0 and would just brighten constantly).
            float flowA = texture2D(uDetailTex, vMapUv * vec2(384.8, 187.0) + uTime * vec2(0.016, 0.006)).r;
            float flowB = texture2D(uDetailTex, vMapUv * vec2(265.7, 129.1) - uTime * vec2(0.009, 0.013)).g;
            riverWave = flowA * 0.5 + flowB * 0.5;
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.055, 0.13, 0.16), riverM * 0.3);
            diffuseColor.rgb *= 1.0 + riverM * (riverWave - 0.5) * 0.6;
          }
        #else
          vec2 territoryUv = vec2(0.0);
        #endif
        vec2 territoryA = texture2D(uTerritoryA, territoryUv).rg;
        vec2 territoryB = texture2D(uTerritoryB, territoryUv).rg;
        vec2 territory = mix(territoryA, territoryB, uTerritoryMix);
        // Frontier as a manuscript line: an umber ink core on the border
        // with a thin gilt rule just inside it. Screen-px widths from
        // fwidth, per snapshot slot (an iso of the mixed masks would swim).
        float pa = isoPx(territoryA.r);
        float pb = isoPx(territoryB.r);
        // Masks are land-clipped, so the empire's "border" also runs along
        // every coast; the coast has its own painted ink — draw the frontier
        // rule only where it crosses land.
        #ifdef USE_MAP
          float coastPx = abs(texture2D(uWorldMask, vMapUv).r * 255.0 - 128.0) / 6.0;
          // Territory texels are ~2.8 heightmap px, so the land-clipped iso
          // line can sit a few px off the true coast: suppress generously.
          float inland = smoothstep(3.0, 7.0, coastPx);
        #else
          float inland = 1.0;
        #endif
        // Wide enough (≈2.5 px ink, ≈2 px gilt) to survive the paint filter.
        float inkLine = mix(1.0 - smoothstep(1.0, 1.9, abs(pa)), 1.0 - smoothstep(1.0, 1.9, abs(pb)), uTerritoryMix);
        float giltLine = mix(1.0 - smoothstep(0.8, 1.5, abs(pa - 3.2)), 1.0 - smoothstep(0.8, 1.5, abs(pb - 3.2)), uTerritoryMix);
        float borderLine = giltLine;
        // Watercolour glaze: multiplicative (the painted land shows
        // through), granulated pigment, darker pooling toward the edge.
        float pool = territory.g * territory.g * territory.r;
        float wash = territory.r * uTerritoryStrength * (0.72 + 0.5 * granulation) * (1.0 + pool * 1.1);
        diffuseColor.rgb *= mix(vec3(1.0), uTerritoryTint, clamp(wash, 0.0, 1.0));
        giltLine *= inland;
        inkLine *= inland;
        diffuseColor.rgb = mix(diffuseColor.rgb, uBorderColor * 0.8, giltLine * 0.85 * uBorderIntensity);
        diffuseColor.rgb = mix(diffuseColor.rgb, uInkColor, inkLine * 0.85 * uBorderIntensity);`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        /* glsl */ `#include <roughnessmap_fragment>
        // Rivers are glossier than the matte terrain, but only in the channel
        // core (riverM^2) and kept semi-rough — a full gloss streak reads as
        // a silver ruler line from the 45-degree sun.
        roughnessFactor = mix(roughnessFactor, 0.62, riverM * riverM);`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `#include <emissivemap_fragment>
        // The gilt rule catches a little light — more at night, like gold leaf by lamplight.
        totalEmissiveRadiance += uBorderColor * borderLine * uBorderIntensity * (0.12 + 0.5 * uNight);
        // Drifting sparkle crests on river water (riverWave is ~0.5-mean).
        totalEmissiveRadiance += vec3(0.75, 0.85, 0.9) * riverM * pow(max(riverWave - 0.5, 0.0) * 2.0, 3.0) * 0.2;`,
      );
  };
  applyCurvature(material, 'east-roman-terrain');

  const geometry = buildTerrainGeometry(hf);
  const mesh = new Mesh(geometry, material);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  mesh.frustumCulled = false; // bent by the curved earth

  return {
    mesh,
    material,
    uniforms,
    dispose() {
      geometry.dispose();
      material.dispose();
      uniforms.uTerritoryA.value.dispose();
      uniforms.uTerritoryB.value.dispose();
      detailTex.dispose();
      brushTex.dispose();
    },
  };
}

const SKIRT_DEPTH = 2;

/**
 * Diorama edge: a dark wall dropping from the terrain perimeter so the world
 * ends like a carved museum model instead of a floating paper cutout.
 */
export function buildSkirt(
  hf: HeightField,
  yOf?: (meters: number, lon: number, lat: number) => number,
  color = 0x30271f,
): { mesh: Mesh; dispose(): void } {
  // Ordered boundary points: N (west→east), E (north→south), S (east→west), W (south→north).
  const boundary: Array<[number, number]> = [];
  for (let i = 0; i <= SEGMENTS_X; i++) boundary.push([(i / SEGMENTS_X) * GROUND_W, 0]);
  for (let j = 1; j <= SEGMENTS_Z; j++) boundary.push([GROUND_W, (j / SEGMENTS_Z) * GROUND_H]);
  for (let i = SEGMENTS_X - 1; i >= 0; i--) boundary.push([(i / SEGMENTS_X) * GROUND_W, GROUND_H]);
  for (let j = SEGMENTS_Z - 1; j >= 1; j--) boundary.push([0, (j / SEGMENTS_Z) * GROUND_H]);
  boundary.push(boundary[0]);

  const positions = new Float32Array(boundary.length * 2 * 3);
  for (let k = 0; k < boundary.length; k++) {
    const [x, z] = boundary[k];
    const { lon, lat } = groundToLonLat(x, z);
    const top = k * 6;
    positions[top] = x;
    positions[top + 1] = yOf ? yOf(hf.heightAt(lon, lat), lon, lat) : hf.yAt(lon, lat);
    positions[top + 2] = z;
    positions[top + 3] = x;
    positions[top + 4] = -SKIRT_DEPTH;
    positions[top + 5] = z;
  }
  const quadCount = boundary.length - 1;
  const indices = new Uint32Array(quadCount * 6);
  let k = 0;
  for (let q = 0; q < quadCount; q++) {
    const a = q * 2; // top q
    const b = a + 1; // bottom q
    const c = a + 2; // top q+1
    const d = a + 3; // bottom q+1
    indices[k++] = a;
    indices[k++] = b;
    indices[k++] = c;
    indices[k++] = c;
    indices[k++] = b;
    indices[k++] = d;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setIndex(new BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  const material = applyCurvature(
    new MeshStandardMaterial({
      color,
      roughness: 1,
      metalness: 0,
      side: DoubleSide,
    }),
    'terrain-skirt',
  );
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  return {
    mesh,
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
