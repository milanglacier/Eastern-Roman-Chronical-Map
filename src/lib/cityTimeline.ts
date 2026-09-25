/**
 * What a city page shows in a given year: which structures stand and in
 * which variant, which features, built-up areas, labels and vessels are
 * present, and how densely the quarters are built. Pure functions over the
 * city plan (src/data/cities/*.json).
 */
import type {
  CityFeature,
  CityLabel,
  CityPlan,
  CityStage,
  CityStructure,
  CityUrbanArea,
  CityVessel,
} from '../data/schema';

export function isPresent(item: { from: number; to?: number }, year: number): boolean {
  return year >= item.from && (item.to === undefined || year <= item.to);
}

/** The stage in force at `year`, or null when the structure is not there. */
export function stageAt(structure: CityStructure, year: number): CityStage | null {
  if (!isPresent(structure, year)) return null;
  let current: CityStage | null = null;
  for (const stage of structure.stages) if (stage.from <= year) current = stage;
  return current;
}

/** Piecewise-linear keyframe sample, clamped at both ends. */
export function sampleKeyframes(keys: ReadonlyArray<{ year: number; value: number }>, year: number): number {
  if (year <= keys[0].year) return keys[0].value;
  for (let i = 1; i < keys.length; i++) {
    if (year <= keys[i].year) {
      const a = keys[i - 1];
      const b = keys[i];
      return a.value + ((b.value - a.value) * (year - a.year)) / (b.year - a.year);
    }
  }
  return keys[keys.length - 1].value;
}

export interface CityState {
  year: number;
  structures: Array<{ structure: CityStructure; stage: CityStage }>;
  features: CityFeature[];
  urbanAreas: CityUrbanArea[];
  labels: CityLabel[];
  vessels: CityVessel[];
  /** 0..1 fill of the built-up areas. */
  density: number;
  /**
   * Identifies everything drawn on the page itself (features, built-up
   * areas, labels and the moat): the page is redrawn only when it changes.
   */
  pageKey: string;
}

export function resolveCity(plan: CityPlan, year: number): CityState {
  const structures: CityState['structures'] = [];
  for (const structure of plan.structures) {
    const stage = stageAt(structure, year);
    if (stage) structures.push({ structure, stage });
  }
  const features = plan.features.filter((f) => isPresent(f, year));
  const urbanAreas = plan.urbanAreas.filter((a) => isPresent(a, year));
  const labels = plan.labels.filter((l) => isPresent(l, year));
  const vessels = plan.vessels.filter((v) => isPresent(v, year));
  const walls = structures
    .filter(({ structure }) => structure.kind === 'land-wall')
    .map(({ structure, stage }) => `${structure.id}:${stage.variant}`);
  const pageKey = [
    ...features.map((f) => f.id),
    ...urbanAreas.map((a) => a.id),
    ...labels.map((l) => l.id),
    ...walls,
  ].join('|');
  return {
    year,
    structures,
    features,
    urbanAreas,
    labels,
    vessels,
    density: sampleKeyframes(plan.density, year),
    pageKey,
  };
}
