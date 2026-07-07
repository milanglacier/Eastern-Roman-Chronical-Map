/**
 * Shared color constants for the 3D scene and the UI legend. The baked
 * albedo palette lives in scripts/build-world-textures.mjs; these are the
 * runtime/lighting/UI counterparts.
 */

/** Sky / fog — the warm haze that swallows the far edge of the world. */
export const SKY_COLOR = 0xb8c4cf;
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
