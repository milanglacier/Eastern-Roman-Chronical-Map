import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { cwd } from 'node:process';
import { events, snapshots, cities, tiles, territories } from '../src/data';
import { eraInterval, eventsForYear } from '../src/lib/timeline';
import { COLS, ROWS, neighbors, lonLatToTile } from '../src/lib/hex';
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

  it('traces the major rivers', () => {
    expect(tiles.rivers.length).toBeGreaterThanOrEqual(6);
    const names = new Set(tiles.rivers.map((r) => r.name));
    expect(names.size).toBe(tiles.rivers.length);
  });

  it('keeps every river path tile inside the grid', () => {
    for (const river of tiles.rivers) {
      for (const [col, row] of river.path) {
        expect(col, `${river.name} col`).toBeLessThan(COLS);
        expect(row, `${river.name} row`).toBeLessThan(ROWS);
      }
    }
  });

  it('keeps consecutive river path tiles adjacent', () => {
    for (const river of tiles.rivers) {
      for (let i = 1; i < river.path.length; i++) {
        const [pc, pr] = river.path[i - 1];
        const [c, r] = river.path[i];
        const adjacent = neighbors(pc, pr).some((n) => n.col === c && n.row === r);
        expect(adjacent, `${river.name} step ${i}: ${pc},${pr} -> ${c},${r}`).toBe(true);
      }
    }
  });

  it('keeps the great straits open water (no land bridges)', () => {
    // Channels narrower than a tile are force-opened by the `straits`
    // entries in terrain-config.json; regressing any of these fuses
    // landmasses (Iberia–Africa, Corsica–Sardinia, Europe–Asia…).
    const straits: Record<string, [number, number]> = {
      gibraltar: [-5.7, 36.0],
      bonifacio: [8.83, 41.6],
      messina: [15.24, 38.05],
      dardanelles: [26.45, 40.71],
      bosporus: [29.4, 41.15],
      kerch: [36.39, 45.15],
    };
    for (const [name, [lon, lat]] of Object.entries(straits)) {
      const { col, row } = lonLatToTile(lon, lat);
      const code = tiles.terrain[row * COLS + col];
      expect(code === 's' || code === 'D', `${name} at ${col},${row} is "${code}"`).toBe(true);
    }
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
