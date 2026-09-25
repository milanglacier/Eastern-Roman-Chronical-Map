/**
 * Shared runtime colour constants. The baked albedo palette lives in
 * scripts/build-world-textures.mjs; the chronicle palette in
 * docs/art-direction.md.
 */

/** Default grazing-angle sheen on the water (replaced by the era mood). */
export const WATER_FRESNEL_TINT = 0x93aabb;

/** Legend swatches: how each terrain reads on the chronicle map (sRGB). */
export const LEGEND_TERRAIN = {
  sea: 0x4f8a98,
  grass: 0x8c9a62,
  desert: 0xd8b77f,
  mountain: 0x8e8391,
  snow: 0xf2ecdf,
} as const;
