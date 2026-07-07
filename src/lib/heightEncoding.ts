/**
 * Split-byte height encoding shared by the offline bake
 * (scripts/build-world-textures.mjs) and the runtime height-field decoder.
 *
 * Heights in meters are quantized to uint16 and stored in an ordinary 8-bit
 * RGB PNG as R = high byte, G = low byte. A true 16-bit gray PNG would be
 * clamped to 8 bits by canvas `getImageData`, so it can never round-trip in
 * the browser; two 8-bit channels survive exactly (alpha stays 255, so no
 * premultiplication loss either).
 */

/** meters = uint16 * HEIGHT_SCALE + HEIGHT_OFFSET → range [-8192, +8191.75] at 0.25 m steps. */
export const HEIGHT_SCALE = 0.25;
export const HEIGHT_OFFSET = -8192;
/** The uint16 value that encodes 0 m (sea level). */
export const SEA_LEVEL_VALUE = 32768;

export function metersToUint16(meters: number): number {
  const v = Math.round((meters - HEIGHT_OFFSET) / HEIGHT_SCALE);
  return Math.max(0, Math.min(65535, v));
}

export function uint16ToMeters(v: number): number {
  return v * HEIGHT_SCALE + HEIGHT_OFFSET;
}

/** uint16 → [highByte, lowByte] for the R and G channels. */
export function heightToBytes(v: number): [number, number] {
  return [(v >> 8) & 0xff, v & 0xff];
}

/** [highByte, lowByte] (R, G channels) → uint16. */
export function bytesToHeight(hi: number, lo: number): number {
  return ((hi & 0xff) << 8) | (lo & 0xff);
}

export function metersToBytes(meters: number): [number, number] {
  return heightToBytes(metersToUint16(meters));
}

export function bytesToMeters(hi: number, lo: number): number {
  return uint16ToMeters(bytesToHeight(hi, lo));
}
