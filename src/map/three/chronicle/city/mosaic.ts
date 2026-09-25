/**
 * Mosaic treatment for city-page drawings, after Eastern Roman wall and
 * floor mosaics (the Madaba map, Ravenna, Hagia Sophia).
 *
 * The drawing is set in tesserae: a jittered grid of cells in texture space
 * (a Voronoi pattern, so the stones are irregular, like hand-cut ones).
 * Each tessera takes the drawing's colour at its centre with a small random
 * shift in tone, and grout shows between neighbours. Where the gold mask is
 * set, the tessera is gold smalti: each one is tilted at random, so it is
 * brighter or darker and glints as the camera moves.
 *
 * An auxiliary texture selects the treatment per texel: R = set in
 * tesserae, G = gold. Tesserae fade into the smooth drawing when they are
 * smaller than a few screen pixels, so distant pages do not shimmer.
 */
import { Color, type Material, type Texture } from 'three';

/**
 * How far the mosaic influence goes (`?mosaic=`):
 *  - a: ink-and-watercolour cards on a floor-mosaic page — the chosen look
 *    (the default)
 *  - b: everything set in tesserae, cards included (kept for comparison)
 *  - c: watercolour page and cards; mosaic only in the border and plaque
 *    (kept for comparison)
 */
export type MosaicSetting = 'a' | 'b' | 'c';

export function activeMosaic(): MosaicSetting {
  if (typeof location === 'undefined') return 'a';
  const v = new URLSearchParams(location.search).get('mosaic');
  return v === 'b' || v === 'c' ? v : 'a';
}

export interface MosaicOptions {
  /** R = set in tesserae, G = gold smalti; same layout as the map. */
  aux: Texture;
  /** Map size in texels. */
  size: [number, number];
  /** Tessera size in map texels. */
  tessera: number;
  /** Grout colour (sRGB hex). */
  grout?: number;
  /** Grout width as a fraction of a tessera. */
  groutWidth?: number;
  /** Glint strength of the gold smalti. */
  glint?: number;
  /**
   * Irregularity of the setting, 0..1: low gives the orderly rows of a wall
   * mosaic, high the hand-cut stones of a floor.
   */
  jitter?: number;
}

const MOSAIC_PARS = /* glsl */ `
uniform sampler2D uMosaicAux;
uniform vec2 uMosaicSize;
uniform float uMosaicTessera;
uniform vec3 uMosaicGrout;
uniform float uMosaicGroutW;
uniform float uMosaicGlint;
uniform float uMosaicJitter;
float mosaicHash1(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
vec2 mosaicHash2(vec2 p) {
  float n = mosaicHash1(p);
  return vec2(n, mosaicHash1(p + n + 17.17));
}
`;

const MOSAIC_MAP_FRAGMENT = /* glsl */ `
#ifdef USE_MAP
  vec2 mTexel = vMapUv * uMosaicSize;
  vec2 mCell = mTexel / uMosaicTessera;
  vec2 mIp = floor(mCell);
  vec2 mFp = fract(mCell);
  float mD1 = 8.0;
  float mD2 = 8.0;
  vec2 mSeed = vec2(0.0);
  vec2 mId = vec2(0.0);
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 o = 0.5 + (mosaicHash2(mIp + g) - 0.5) * uMosaicJitter;
      vec2 r = g + o - mFp;
      float d = dot(r, r);
      if (d < mD1) {
        mD2 = mD1;
        mD1 = d;
        mSeed = mIp + g + o;
        mId = mIp + g;
      } else if (d < mD2) {
        mD2 = d;
      }
    }
  }
  vec2 mSeedUv = mSeed * uMosaicTessera / uMosaicSize;
  vec2 mGx = dFdx(vMapUv);
  vec2 mGy = dFdy(vMapUv);
  vec4 mSmooth = texture2D(map, vMapUv);
  vec4 mStone = textureGrad(map, mSeedUv, mGx, mGy);
  vec4 mAux = textureGrad(uMosaicAux, mSeedUv, mGx, mGy);
  vec2 mFw = fwidth(mTexel);
  float mTexPerPx = max(max(mFw.x, mFw.y), 1e-4);
  float mOn = step(0.5, mAux.r) * smoothstep(2.2, 4.5, uMosaicTessera / mTexPerPx);
  float mH = mosaicHash1(mId);
  vec3 mC = mStone.rgb * (0.88 + 0.22 * mH);
  mC *= vec3(1.0 + (mosaicHash1(mId + 7.1) - 0.5) * 0.1, 1.0, 1.0 + (mosaicHash1(mId + 3.3) - 0.5) * 0.1);
  if (mAux.g > 0.5) {
    mC *= mix(0.6, 1.2, mosaicHash1(mId + 1.7));
    float mPhase = mH * 6.2831 + dot(cameraPosition.xz, vec2(23.0, 17.0)) + cameraPosition.y * 11.0;
    mC += pow(max(0.0, sin(mPhase)), 22.0) * uMosaicGlint * vec3(1.0, 0.85, 0.52);
  }
  float mEdge = sqrt(mD2) - sqrt(mD1);
  float mAa = mTexPerPx / uMosaicTessera;
  float mGrout = 1.0 - smoothstep(uMosaicGroutW - mAa, uMosaicGroutW + mAa, mEdge);
  mC = mix(mC, uMosaicGrout, mGrout * 0.85);
  vec4 sampledDiffuseColor = mix(mSmooth, vec4(mC, mStone.a), mOn);
  diffuseColor *= sampledDiffuseColor;
#endif
`;

/** Set a material's map in tesserae (chains any existing onBeforeCompile). */
export function applyMosaic<M extends Material>(material: M, options: MosaicOptions): M {
  const previous = material.onBeforeCompile.bind(material);
  const uniforms = {
    uMosaicAux: { value: options.aux },
    uMosaicSize: { value: options.size },
    uMosaicTessera: { value: options.tessera },
    uMosaicGrout: { value: new Color(options.grout ?? 0xcfc4ad) },
    uMosaicGroutW: { value: options.groutWidth ?? 0.1 },
    uMosaicGlint: { value: options.glint ?? 1.1 },
    uMosaicJitter: { value: options.jitter ?? 0.75 },
  };
  material.onBeforeCompile = (shader, renderer) => {
    previous(shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${MOSAIC_PARS}`)
      .replace('#include <map_fragment>', MOSAIC_MAP_FRAGMENT);
  };
  return material;
}
