/**
 * Shared color constants for the 3D scene and the UI legend. The baked
 * albedo palette lives in scripts/build-world-textures.mjs; these are the
 * runtime/lighting/UI counterparts.
 */

/**
 * Horizon haze: fog colour and the sky dome's horizon. A muted blue-grey
 * air tone — light enough to read as atmosphere over the far world, dark
 * enough that the ocean apron at max zoom-out still reads as distant sea
 * rather than washing white.
 */
export const SKY_COLOR = 0x6a7f90;
/** Sky dome overhead (only glimpsed at the top edge at far zoom). */
export const SKY_ZENITH_COLOR = 0x2c4f78;
/**
 * Grazing-angle sheen on the water. Decoupled from SKY_COLOR so darkening
 * the background doesn't dull the whole sea surface.
 */
export const WATER_FRESNEL_TINT = 0x93aabb;
/** Directional sun, warm late-afternoon tone. */
export const SUN_COLOR = 0xffeccf;
/** Hemisphere fill: cool sky bounce over warm earth bounce. */
export const HEMI_SKY_COLOR = 0x91b0d0;
export const HEMI_GROUND_COLOR = 0x54483a;

/** Legend swatches, sampled from the baked satellite albedo (sRGB). */
export const LEGEND_TERRAIN = {
  sea: 0x1e475c,
  grass: 0x4c5a30,
  desert: 0xdabd93,
  mountain: 0x8e7e60,
  snow: 0xe6e6e0,
} as const;
