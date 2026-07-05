import type { HistoricalEvent, Snapshot } from '../data/schema';
import { YEAR_MAX } from '../data/schema';

/**
 * The snapshot in effect at `year`: the latest snapshot whose year is <= year
 * (clamped to the first). Snapshots must be sorted by year ascending.
 */
export function snapshotForYear(snapshots: Snapshot[], year: number): Snapshot {
  let current = snapshots[0];
  for (const snap of snapshots) {
    if (snap.year <= year) current = snap;
    else break;
  }
  return current;
}

/** The [start, end) year interval covered by the snapshot at `year`. */
export function eraInterval(snapshots: Snapshot[], year: number): [number, number] {
  const snap = snapshotForYear(snapshots, year);
  const idx = snapshots.indexOf(snap);
  const end = idx + 1 < snapshots.length ? snapshots[idx + 1].year : YEAR_MAX + 1;
  return [snap.year, end];
}

/**
 * Events shown while viewing the era that `year` falls in: any event whose
 * [year, endYear] range overlaps the era interval.
 */
export function eventsForYear(
  events: HistoricalEvent[],
  snapshots: Snapshot[],
  year: number,
): HistoricalEvent[] {
  const [start, end] = eraInterval(snapshots, year);
  return events.filter((e) => e.year < end && (e.endYear ?? e.year) >= start);
}

/** Autoplay sweep speed. Full 1123-year span plays in about 75 seconds. */
export const YEARS_PER_SECOND = 15;
