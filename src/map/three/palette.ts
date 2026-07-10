/**
 * Shared color constants for the 3D scene and the UI legend. The baked
 * albedo palette lives in scripts/build-world-textures.mjs; these are the
 * runtime/lighting/UI counterparts.
 */

/**
 * Sky / fog — deep blue-slate sitting between the baked deep-sea (0x10263a)
 * and shelf-sea (0x1e475c) tones, so background beyond the ocean apron reads
 * as distant ocean instead of washing white at far zoom.
 */
export const SKY_COLOR = 0x263646;
/**
 * Grazing-angle sheen on the water. Decoupled from SKY_COLOR so darkening
 * the background doesn't dull the whole sea surface.
 */
export const WATER_FRESNEL_TINT = 0x93aabb;
/** Directional sun, warm late-afternoon tone. */
export const SUN_COLOR = 0xffe0b3;
/** Hemisphere fill: cool sky bounce over warm earth bounce. */
export const HEMI_SKY_COLOR = 0x91b0d0;
export const HEMI_GROUND_COLOR = 0x54483a;

/** Legend swatches (match the baked albedo palette, sRGB). */
export const LEGEND_TERRAIN = {
  sea: 0x1e475c,
  grass: 0x607446,
  desert: 0xccb276,
  mountain: 0x7a7064,
  snow: 0xebecea,
} as const;
