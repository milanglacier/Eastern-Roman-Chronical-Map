/**
 * Cylindrical billboarding on the GPU for instanced cards (houses, trees):
 * each instance turns about its own vertical axis to face the camera. The
 * instance matrices carry only translation and uniform scale.
 *
 * Instances also pick their drawing from an atlas: `aTile` is the tile's
 * column and row counted from the bottom of the (flipY) texture.
 */
import type { Material } from 'three';

const BILLBOARD_VERTEX = /* glsl */ `
vec3 transformed = vec3(position);
#ifdef USE_INSTANCING
  vec3 bbOrigin = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
#else
  vec3 bbOrigin = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
#endif
vec2 bbDir = cameraPosition.xz - bbOrigin.xz;
float bbA = atan(bbDir.x, bbDir.y);
float bbC = cos(bbA);
float bbS = sin(bbA);
transformed.xz = vec2(transformed.x * bbC + transformed.z * bbS, -transformed.x * bbS + transformed.z * bbC);
`;

export function applyBillboardAtlas<M extends Material>(material: M, grid: [number, number]): M {
  const previous = material.onBeforeCompile.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    previous(shader, renderer);
    shader.uniforms.uAtlasGrid = { value: grid };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aTile;\nuniform vec2 uAtlasGrid;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\nvMapUv = (uv + aTile) / uAtlasGrid;\n#endif')
      .replace('#include <begin_vertex>', BILLBOARD_VERTEX);
  };
  return material;
}
