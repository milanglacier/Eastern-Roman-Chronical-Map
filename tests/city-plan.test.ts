import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cwd } from 'node:process';
import sharp from 'sharp';
import { cityPlans } from '../src/data';
import type { CityPlan } from '../src/data/schema';
import { createCityFrame } from '../src/lib/cityFrame';
import { resolveCity, sampleKeyframes, stageAt } from '../src/lib/cityTimeline';
import { isolines, simplifyPolyline } from '../src/lib/isolines';
import { offset, resample, sliceBetween } from '../src/lib/polyline';

const plan = cityPlans.get('constantinople') as CityPlan;
const plateDir = join(cwd(), 'public', 'city', 'constantinople');

let isLand: (lon: number, lat: number) => boolean;

beforeAll(async () => {
  const { data, info } = await sharp(join(plateDir, 'land.png')).raw().toBuffer({ resolveWithObject: true });
  const plate = JSON.parse(readFileSync(join(plateDir, 'plate.json'), 'utf8'));
  const [west, south, east, north] = plate.outerBbox as number[];
  isLand = (lon, lat) => {
    const x = Math.round(((lon - west) / (east - west)) * info.width - 0.5);
    const y = Math.round(((north - lat) / (north - south)) * info.height - 0.5);
    return data[(y * info.width + x) * info.channels + 3] > 127;
  };
});

describe('Constantinople city plan', () => {
  it('parses and has unique ids', () => {
    expect(plan).toBeDefined();
    const ids = [...plan.structures, ...plan.features, ...plan.labels, ...plan.urbanAreas].map((x) => x.id);
    // Labels may share an id with a built-up area (the same place).
    const structureIds = plan.structures.map((s) => s.id);
    expect(new Set(structureIds).size).toBe(structureIds.length);
    expect(ids.length).toBeGreaterThan(40);
  });

  it('never names the state "Byzantine" (Rule #1)', () => {
    const text = readFileSync(join(cwd(), 'src', 'data', 'cities', 'constantinople.json'), 'utf8');
    expect(text).not.toMatch(/byzan|拜占庭/i);
  });

  it('matches the bbox of the plate bake', () => {
    const bake = JSON.parse(readFileSync(join(cwd(), 'scripts', 'assets', 'city', 'constantinople-plate.json'), 'utf8'));
    const plate = JSON.parse(readFileSync(join(plateDir, 'plate.json'), 'utf8'));
    expect(plan.page.bbox).toEqual(bake.bbox);
    expect(plate.bbox).toEqual(bake.bbox);
    expect(plate.outerBbox).toEqual(bake.outerBbox);
    // The outer ground contains the plan.
    const [w, s, e, n] = bake.bbox;
    const [ow, os, oe, on] = bake.outerBbox;
    expect(ow <= w && os <= s && oe >= e && on >= n).toBe(true);
  });

  it('orders the stages of every structure, starting at its first year', () => {
    for (const s of plan.structures) {
      expect(s.stages[0].from, s.id).toBe(s.from);
      for (let i = 1; i < s.stages.length; i++) expect(s.stages[i].from, s.id).toBeGreaterThan(s.stages[i - 1].from);
      if (s.to !== undefined) expect(s.to, s.id).toBeGreaterThanOrEqual(s.from);
    }
  });

  it('keeps everything inside the page', () => {
    const [west, south, east, north] = plan.page.bbox;
    const inside = ([lon, lat]: readonly [number, number]) => lon > west && lon < east && lat > south && lat < north;
    for (const s of plan.structures) {
      for (const p of [...(s.path ?? []), ...(s.position ? [s.position] : [])]) expect(inside(p), s.id).toBe(true);
    }
    for (const l of plan.labels) expect(inside(l.position), l.id).toBe(true);
  });

  it('stands point landmarks on land and floats vessels and water labels on water', () => {
    for (const s of plan.structures) if (s.position) expect(isLand(...s.position), s.id).toBe(true);
    for (const v of plan.vessels) expect(isLand(...v.position), `vessel at ${v.position}`).toBe(false);
    for (const l of plan.labels) {
      if (l.size !== 'place') expect(isLand(...l.position), l.id).toBe(false);
    }
  });

  it('shows Justinian’s city in 537', () => {
    const state = resolveCity(plan, 537);
    const variant = (id: string) => state.structures.find((s) => s.structure.id === id)?.stage.variant;
    expect(variant('hagia-sophia')).toBe('domed');
    expect(variant('theodosian-walls')).toBe('triple');
    expect(variant('column-of-justinian')).toBeUndefined();
    expect(variant('galata-tower')).toBeUndefined();
    expect(state.urbanAreas.map((a) => a.id)).toContain('city-theodosius');
    expect(state.density).toBeGreaterThan(0.7);
  });
});

describe('city timeline', () => {
  const hs = plan.structures.find((s) => s.id === 'hagia-sophia')!;

  it('switches variants at the stage boundaries', () => {
    expect(stageAt(hs, 359)).toBeNull();
    expect(stageAt(hs, 360)?.variant).toBe('basilica');
    expect(stageAt(hs, 536)?.variant).toBe('ruin');
    expect(stageAt(hs, 537)?.variant).toBe('domed');
    expect(stageAt(hs, 562)?.variant).toBe('high-domed');
    expect(stageAt(hs, 1453)?.variant).toBe('buttressed');
  });

  it('ends structures after their last year', () => {
    const wall = plan.structures.find((s) => s.id === 'constantinian-wall')!;
    expect(stageAt(wall, 1000)?.variant).toBe('ruin');
    expect(stageAt(wall, 1001)).toBeNull();
  });

  it('interpolates keyframes and clamps at the ends', () => {
    const keys = [{ year: 400, value: 0 }, { year: 500, value: 1 }];
    expect(sampleKeyframes(keys, 330)).toBe(0);
    expect(sampleKeyframes(keys, 450)).toBeCloseTo(0.5);
    expect(sampleKeyframes(keys, 1453)).toBe(1);
  });

  it('changes the page key only when the page changes', () => {
    expect(resolveCity(plan, 540).pageKey).toBe(resolveCity(plan, 541).pageKey);
    expect(resolveCity(plan, 446).pageKey).not.toBe(resolveCity(plan, 447).pageKey); // the moat
  });
});

describe('city frame', () => {
  const frame = createCityFrame([28.9, 40.95, 29.1, 41.1], 10);

  it('round-trips lon/lat through page coordinates', () => {
    const p = frame.toPage(28.98, 41.01);
    const back = frame.fromPage(p.x, p.z);
    expect(back.lon).toBeCloseTo(28.98, 9);
    expect(back.lat).toBeCloseTo(41.01, 9);
  });

  it('puts the centre at the origin with +x east and +z south', () => {
    expect(frame.toPage(29.0, 41.025).x).toBeCloseTo(0, 9);
    expect(frame.toPage(29.05, 41.025).x).toBeGreaterThan(0);
    expect(frame.toPage(29.0, 41.0).z).toBeGreaterThan(0);
  });

  it('magnifies the world scale', () => {
    // 1 km of latitude is 10× longer on the page than on the world map (27.83 km per unit).
    expect(frame.units(1000)).toBeCloseTo((1000 / 27830) * 10, 6);
    expect(frame.depth).toBeCloseTo(frame.units(0.15 * 111320), 6);
  });
});

describe('isolines', () => {
  it('traces a closed loop around a bump', () => {
    const w = 9;
    const h = 9;
    const field = Array.from({ length: w * h }, (_, i) => {
      const x = (i % w) - 4;
      const y = Math.floor(i / w) - 4;
      return 10 - Math.hypot(x, y);
    });
    const lines = isolines(field, w, h, 7);
    expect(lines).toHaveLength(1);
    const loop = lines[0];
    expect(loop[0]).toEqual(loop[loop.length - 1]);
    for (const [x, y] of loop) expect(Math.hypot(x - 4, y - 4)).toBeCloseTo(3, 0);
  });

  it('keeps lines that reach the border open', () => {
    const w = 6;
    const h = 4;
    const field = Array.from({ length: w * h }, (_, i) => i % w);
    const lines = isolines(field, w, h, 2.5);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toHaveLength(h);
    for (const [x] of lines[0]) expect(x).toBeCloseTo(2.5, 9);
  });

  it('simplifies a straight run down to its ends', () => {
    const line: Array<[number, number]> = [[0, 0], [1, 0.01], [2, -0.01], [3, 0]];
    expect(simplifyPolyline(line, 0.1)).toEqual([[0, 0], [3, 0]]);
  });
});

describe('polyline helpers', () => {
  it('resamples at an even spacing and keeps the ends', () => {
    const pts = resample([[0, 0], [10, 0]], 3);
    expect(pts).toHaveLength(5);
    expect(pts[0]).toEqual([0, 0]);
    expect(pts[4]).toEqual([10, 0]);
    expect(pts[1][0]).toBeCloseTo(2.5);
  });

  it('offsets to the left of travel (north when heading east on a y-down page)', () => {
    const out = offset([[0, 0], [1, 0], [2, 0]], 0.5);
    for (const [, y] of out) expect(y).toBeCloseTo(-0.5);
  });

  it('slices the nearest line between two points in travel order', () => {
    const line: Array<[number, number]> = [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]];
    expect(sliceBetween([line], [3.1, 0.1], [0.9, 0], 0.5)).toEqual([[3, 0], [2, 0], [1, 0]]);
    expect(sliceBetween([line], [3, 5], [1, 0], 0.5)).toBeNull();
  });
});
