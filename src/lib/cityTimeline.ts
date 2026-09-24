/**
 * Year → state lookups for city views (pure; shared by the 3D city model and
 * the caption UI). Keyframes interpolate linearly and clamp at the ends;
 * captions, urban areas and structure stages are step functions.
 */
import type { CityScene, CityStructure } from '../data/schema';

export function interpolateKeyframes(keys: { year: number; value: number }[], year: number): number {
  if (keys.length === 0) return 0;
  if (year <= keys[0].year) return keys[0].value;
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1];
    const b = keys[i];
    if (year <= b.year) {
      const t = (year - a.year) / (b.year - a.year || 1);
      return a.value + (b.value - a.value) * t;
    }
  }
  return keys[keys.length - 1].value;
}

/** The last caption whose `from` is at or before the year (or the first). */
export function captionForYear(scene: CityScene, year: number): CityScene['captions'][number] {
  let current = scene.captions[0];
  for (const c of scene.captions) if (c.from <= year) current = c;
  return current;
}

/** Built-up ring valid for the year (the latest one that has started). */
export function urbanAreaForYear(scene: CityScene, year: number): CityScene['urbanAreas'][number] {
  let current = scene.urbanAreas[0];
  for (const a of scene.urbanAreas) if (a.from <= year && (a.to === undefined || year <= a.to)) current = a;
  return current;
}

export function structureStands(s: CityStructure, year: number): boolean {
  return year >= s.from && (s.to === undefined || year <= s.to);
}

/** Active stage variant for the year, or null (structure has no stages / not built). */
export function structureVariant(s: CityStructure, year: number): string | null {
  if (!structureStands(s, year) || !s.stages?.length) return null;
  let variant: string | null = null;
  for (const st of s.stages) if (st.from <= year) variant = st.variant;
  return variant ?? s.stages[0].variant;
}

/** Round a population to a readable figure (e.g. 487,000 → 490,000). */
export function roundPopulation(n: number): number {
  const mag = 10 ** Math.max(0, Math.floor(Math.log10(Math.max(1, n))) - 1);
  return Math.round(n / mag) * mag;
}
