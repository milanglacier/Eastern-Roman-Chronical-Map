/**
 * Era mood sampling: the art-direction keyframes in src/data/moods.json are
 * interpolated by year into one resolved `Mood` that drives the key light,
 * sky, haze, water and the post-process grade. Pure (no three.js) so it is
 * unit-testable; colours come out in *linear* RGB, ready for uniforms.
 *
 * Between keys the blend is smoothstepped, so a pair of identical keys
 * (e.g. 470 and 565 both "golden-age") holds a mood across a span and the
 * change happens in the gap between spans.
 */
import type { MoodKey } from '../data/schema';

export type Rgb = [number, number, number];

export interface Mood {
  /** Unit vector pointing from the ground TOWARD the key light (world axes: +X east, +Y up, +Z south). */
  keyDir: [number, number, number];
  keyAltitudeDeg: number;
  keyColor: Rgb;
  keyIntensity: number;
  skyZenith: Rgb;
  skyHorizon: Rgb;
  skyGlow: Rgb;
  clouds: number;
  ambientSky: Rgb;
  ambientGround: Rgb;
  ambientIntensity: number;
  hazeColor: Rgb;
  hazeDensity: number;
  exposure: number;
  saturation: number;
  contrast: number;
  shadowTint: Rgb;
  highlightTint: Rgb;
  split: number;
  bloom: number;
  night: number;
}

const srgbToLinear = (c: number): number =>
  c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);

export function hexToLinear(hex: string): Rgb {
  const v = parseInt(hex.slice(1), 16);
  return [
    srgbToLinear(((v >> 16) & 255) / 255),
    srgbToLinear(((v >> 8) & 255) / 255),
    srgbToLinear((v & 255) / 255),
  ];
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpRgb = (a: Rgb, b: Rgb, t: number): Rgb => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const smooth = (t: number) => t * t * (3 - 2 * t);

/** Interpolate compass degrees along the shorter arc; result in [0, 360). */
export function lerpAngleDeg(a: number, b: number, t: number): number {
  const d = ((((b - a) % 360) + 540) % 360) - 180;
  return (((a + d * t) % 360) + 360) % 360;
}

/** Compass azimuth (clockwise from north) + altitude → unit vector toward the light. */
export function directionFromAzAlt(azimuthDeg: number, altitudeDeg: number): [number, number, number] {
  const az = (azimuthDeg * Math.PI) / 180;
  const alt = (altitudeDeg * Math.PI) / 180;
  // North = -Z, east = +X (same convention as the old fixed SUN_DIRECTION).
  return [Math.sin(az) * Math.cos(alt), Math.sin(alt), -Math.cos(az) * Math.cos(alt)];
}

function resolve(a: MoodKey, b: MoodKey, t: number): Mood {
  const az = lerpAngleDeg(a.key.azimuth, b.key.azimuth, t);
  const alt = lerp(a.key.altitude, b.key.altitude, t);
  const c = (x: string, y: string) => lerpRgb(hexToLinear(x), hexToLinear(y), t);
  return {
    keyDir: directionFromAzAlt(az, alt),
    keyAltitudeDeg: alt,
    keyColor: c(a.key.color, b.key.color),
    keyIntensity: lerp(a.key.intensity, b.key.intensity, t),
    skyZenith: c(a.sky.zenith, b.sky.zenith),
    skyHorizon: c(a.sky.horizon, b.sky.horizon),
    skyGlow: c(a.sky.glow, b.sky.glow),
    clouds: lerp(a.sky.clouds, b.sky.clouds, t),
    ambientSky: c(a.ambient.sky, b.ambient.sky),
    ambientGround: c(a.ambient.ground, b.ambient.ground),
    ambientIntensity: lerp(a.ambient.intensity, b.ambient.intensity, t),
    hazeColor: c(a.haze.color, b.haze.color),
    hazeDensity: lerp(a.haze.density, b.haze.density, t),
    exposure: lerp(a.exposure, b.exposure, t),
    saturation: lerp(a.grade.saturation, b.grade.saturation, t),
    contrast: lerp(a.grade.contrast, b.grade.contrast, t),
    shadowTint: c(a.grade.shadowTint, b.grade.shadowTint),
    highlightTint: c(a.grade.highlightTint, b.grade.highlightTint),
    split: lerp(a.grade.split, b.grade.split, t),
    bloom: lerp(a.bloom, b.bloom, t),
    night: lerp(a.night, b.night, t),
  };
}

/** Resolve the mood at a (fractional) year. `keys` must be sorted by year. */
export function sampleMood(keys: readonly MoodKey[], year: number): Mood {
  if (year <= keys[0].year) return resolve(keys[0], keys[0], 0);
  const last = keys[keys.length - 1];
  if (year >= last.year) return resolve(last, last, 0);
  let i = 0;
  while (i < keys.length - 2 && keys[i + 1].year <= year) i++;
  const a = keys[i];
  const b = keys[i + 1];
  const t = smooth((year - a.year) / Math.max(1e-6, b.year - a.year));
  return resolve(a, b, t);
}
