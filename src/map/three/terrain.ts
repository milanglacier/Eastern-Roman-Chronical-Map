/**
 * Terrain mesh: a CPU-displaced grid over the world rect, shaded by a
 * MeshStandardMaterial with onBeforeCompile injections for the territory
 * tint + glowing frontier (fed by territory.ts in a later phase). Standard
 * material means lights/shadows/fog/tone-mapping come from three for free.
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
import { TERRITORY_TINT, TERRITORY_TINT_STRENGTH, TERRITORY_BORDER } from '../colors';

/** 16 quads per degree — ~743k tris; trivial for real GPUs (llvmpipe FPS is not a target). */
export const SEGMENTS_X = 928;
export const SEGMENTS_Z = 400;

export interface TerrainUniforms {
  uTime: { value: number };
  uTerritoryA: { value: Texture };
  uTerritoryB: { value: Texture };
  uTerritoryMix: { value: number };
  uTerritoryTint: { value: Color };
  uTerritoryStrength: { value: number };
  uBorderColor: { value: Color };
  uBorderIntensity: { value: number };
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

export function buildTerrainGeometry(hf: HeightField): BufferGeometry {
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
      positions[o + 1] = hf.yAt(lon, lat);
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

export function buildTerrain(
  hf: HeightField,
  textures: { albedo: Texture | null; normal: Texture | null; detail: Texture | null },
): Terrain {
  const detailTex = textures.detail ?? blankDetailTexture();
  detailTex.wrapS = RepeatWrapping;
  detailTex.wrapT = RepeatWrapping;
  const uniforms: TerrainUniforms = {
    uTime: { value: 0 },
    uTerritoryA: { value: blankTerritoryTexture() },
    uTerritoryB: { value: blankTerritoryTexture() },
    uTerritoryMix: { value: 0 },
    uTerritoryTint: { value: new Color(TERRITORY_TINT) },
    uTerritoryStrength: { value: TERRITORY_TINT_STRENGTH },
    uBorderColor: { value: new Color(TERRITORY_BORDER) },
    uBorderIntensity: { value: 0.9 },
  };

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
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.uniforms.uDetailTex = uDetailTex;
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
        uniform float uTime;
        uniform sampler2D uDetailTex;`,
      )
      .replace(
        '#include <map_fragment>',
        /* glsl */ `#include <map_fragment>
        #ifdef USE_MAP
          vec2 territoryUv = vMapUv;
          // High-frequency painterly grain so close zoom never reads as a
          // blurry upscale of the baked albedo (tiling aspect-corrected).
          float terrainDetail = texture2D(uDetailTex, vMapUv * vec2(170.0, 73.3)).b;
          diffuseColor.rgb *= 0.93 + 0.14 * terrainDetail;
        #else
          vec2 territoryUv = vec2(0.0);
        #endif
        vec2 territory = mix(
          texture2D(uTerritoryA, territoryUv).rg,
          texture2D(uTerritoryB, territoryUv).rg,
          uTerritoryMix
        );
        diffuseColor.rgb = mix(diffuseColor.rgb, uTerritoryTint, territory.r * uTerritoryStrength);`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `#include <emissivemap_fragment>
        float borderPulse = 0.86 + 0.14 * sin(uTime * 1.6);
        totalEmissiveRadiance += uBorderColor * territory.g * uBorderIntensity * borderPulse;`,
      );
  };
  material.customProgramCacheKey = () => 'east-roman-terrain';

  const geometry = buildTerrainGeometry(hf);
  const mesh = new Mesh(geometry, material);
  mesh.receiveShadow = true;
  mesh.castShadow = true;

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
    },
  };
}

const SKIRT_DEPTH = 2;

/**
 * Diorama edge: a dark wall dropping from the terrain perimeter so the world
 * ends like a carved museum model instead of a floating paper cutout.
 */
export function buildSkirt(hf: HeightField): { mesh: Mesh; dispose(): void } {
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
    positions[top + 1] = hf.yAt(lon, lat);
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
  const material = new MeshStandardMaterial({
    color: 0x30271f,
    roughness: 1,
    metalness: 0,
    side: DoubleSide,
  });
  const mesh = new Mesh(geometry, material);
  return {
    mesh,
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
