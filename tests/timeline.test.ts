import { describe, it, expect } from 'vitest';
import { snapshotForYear, eraInterval, eventsForYear } from '../src/lib/timeline';
import type { Snapshot, HistoricalEvent } from '../src/data/schema';

const loc = (en: string) => ({ en, zh: en });

const snaps: Snapshot[] = [
  { id: 'a', year: 330, label: loc('a'), note: loc('a') },
  { id: 'b', year: 395, label: loc('b'), note: loc('b') },
  { id: 'c', year: 555, label: loc('c'), note: loc('c') },
];

const makeEvent = (id: string, year: number, endYear?: number): HistoricalEvent => ({
  id,
  year,
  endYear,
  category: 'politics',
  lonlat: [28.98, 41.01],
  importance: 1,
  title: loc(id),
  summary: loc(id),
  detail: loc(id),
});

describe('snapshotForYear', () => {
  it('clamps years before the first snapshot', () => {
    expect(snapshotForYear(snaps, 100).id).toBe('a');
  });
  it('returns the exact snapshot on boundary years', () => {
    expect(snapshotForYear(snaps, 395).id).toBe('b');
  });
  it('returns the era in progress between snapshots', () => {
    expect(snapshotForYear(snaps, 500).id).toBe('b');
  });
  it('returns the last snapshot beyond the end', () => {
    expect(snapshotForYear(snaps, 1453).id).toBe('c');
  });
});

describe('eraInterval', () => {
  it('spans from a snapshot to the next', () => {
    expect(eraInterval(snaps, 400)).toEqual([395, 555]);
  });
  it('extends the last era to the end of history', () => {
    expect(eraInterval(snaps, 600)).toEqual([555, 1454]);
  });
});

describe('eventsForYear', () => {
  const events = [
    makeEvent('founding', 330),
    makeEvent('late-first-era', 394),
    makeEvent('second-era', 400),
    makeEvent('spanning', 390, 410),
    makeEvent('third-era', 600),
  ];

  it('shows only events in the current era interval', () => {
    const ids = eventsForYear(events, snaps, 350).map((e) => e.id);
    expect(ids).toContain('founding');
    expect(ids).toContain('late-first-era');
    expect(ids).not.toContain('second-era');
    expect(ids).not.toContain('third-era');
  });

  it('includes multi-year events overlapping the era', () => {
    const ids = eventsForYear(events, snaps, 350).map((e) => e.id);
    expect(ids).toContain('spanning');
    const secondEra = eventsForYear(events, snaps, 450).map((e) => e.id);
    expect(secondEra).toContain('spanning');
    expect(secondEra).toContain('second-era');
  });
});
