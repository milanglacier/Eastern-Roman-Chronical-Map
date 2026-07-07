import { cities } from '../data';
import type { City } from '../data/schema';

/** Cities that exist in the given year (inclusive range from data). */
export function visibleCities(year: number): City[] {
  return cities.filter((c) => year >= c.from && year <= c.to);
}
