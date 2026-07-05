import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { cwd } from 'node:process';
import { events, snapshots, cities, tiles, territories } from '../src/data';
import { eraInterval, eventsForYear } from '../src/lib/timeline';
import { COLS, ROWS } from '../src/lib/hex';
import { YEAR_MIN, YEAR_MAX, EVENT_CATEGORIES } from '../src/data/schema';

const DATA_DIR = join(cwd(), 'src', 'data');

describe('data assets', () => {
  it('parses all data files through their schemas (throws on import otherwise)', () => {
    expect(events.length).toBeGreaterThanOrEqual(100);
    expect(snapshots.length).toBeGreaterThanOrEqual(25);
    expect(cities.length).toBeGreaterThan(10);
  });

  it('has globally unique event ids', () => {
    const ids = new Set(events.map((e) => e.id));
    expect(ids.size).toBe(events.length);
  });

  it('has strictly increasing snapshot years starting at 330', () => {
    expect(snapshots[0].year).toBe(YEAR_MIN);
    for (let i = 1; i < snapshots.length; i++) {
      expect(snapshots[i].year).toBeGreaterThan(snapshots[i - 1].year);
    }
  });

  it('has a territory file for every snapshot year', () => {
    for (const snap of snapshots) {
      expect(territories.has(snap.year), `territory for ${snap.year}`).toBe(true);
    }
  });

  it('covers every event category', () => {
    const used = new Set(events.map((e) => e.category));
    for (const cat of EVENT_CATEGORIES) expect(used, cat).toContain(cat);
  });

  it('places at least one event in every era interval', () => {
    for (const snap of snapshots) {
      const visible = eventsForYear(events, snapshots, snap.year);
      expect(visible.length, `era ${snap.year} has no events`).toBeGreaterThan(0);
    }
  });

  it('keeps endYear >= year on ranged events', () => {
    for (const e of events) {
      if (e.endYear !== undefined) expect(e.endYear, e.id).toBeGreaterThanOrEqual(e.year);
    }
  });

  it('keeps event years within an era that can display them', () => {
    for (const e of events) {
      const [start, end] = eraInterval(snapshots, e.year);
      expect(e.year, e.id).toBeGreaterThanOrEqual(start);
      expect(e.year, e.id).toBeLessThan(end === YEAR_MAX + 1 ? YEAR_MAX + 1 : end);
    }
  });

  it('matches the generated tile grid to the hex constants', () => {
    expect(tiles.cols).toBe(COLS);
    expect(tiles.rows).toBe(ROWS);
    expect(tiles.terrain.length).toBe(COLS * ROWS);
  });

  it('keeps city year ranges valid', () => {
    for (const c of cities) {
      expect(c.from, c.id).toBeLessThanOrEqual(c.to);
      expect(c.from).toBeGreaterThanOrEqual(YEAR_MIN);
      expect(c.to).toBeLessThanOrEqual(YEAR_MAX);
    }
  });
});

describe('project rule #1: the state is never called Byzantium', () => {
  const collectJsonFiles = (dir: string): string[] => {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) out.push(...collectJsonFiles(full));
      else if (entry.name.endsWith('.json')) out.push(full);
    }
    return out;
  };

  it.each(collectJsonFiles(DATA_DIR))('%s contains no forbidden name', (file) => {
    const text = readFileSync(file, 'utf8');
    expect(text).not.toMatch(/byzant/i);
    expect(text).not.toMatch(/拜占庭/);
  });
});
