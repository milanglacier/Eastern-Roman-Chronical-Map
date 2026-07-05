import { describe, it, expect } from 'vitest';
import {
  lonLatToWorld,
  worldToLonLat,
  tileCenterLonLat,
  lonLatToTile,
  tileCenterWorld,
  neighbors,
  hexCorners,
  inGrid,
  COLS,
  ROWS,
  HEX_SIZE,
  LON_MIN,
  LON_MAX,
  LAT_MIN,
  LAT_MAX,
} from '../src/lib/hex';

describe('geographic mapping', () => {
  it('round-trips lon/lat through world coordinates', () => {
    const samples: [number, number][] = [
      [28.98, 41.01], // Constantinople
      [-9, 38],
      [45, 25],
      [0, 48],
    ];
    for (const [lon, lat] of samples) {
      const { x, y } = lonLatToWorld(lon, lat);
      const back = worldToLonLat(x, y);
      expect(back.lon).toBeCloseTo(lon, 8);
      expect(back.lat).toBeCloseTo(lat, 8);
    }
  });

  it('keeps every tile center inside the geographic bbox', () => {
    for (const [col, row] of [
      [0, 0],
      [COLS - 1, 0],
      [0, ROWS - 1],
      [COLS - 1, ROWS - 1],
      [45, 28],
    ]) {
      const { lon, lat } = tileCenterLonLat(col, row);
      expect(lon).toBeGreaterThanOrEqual(LON_MIN);
      expect(lon).toBeLessThanOrEqual(LON_MAX);
      expect(lat).toBeGreaterThanOrEqual(LAT_MIN);
      expect(lat).toBeLessThanOrEqual(LAT_MAX);
    }
  });

  it('maps a lon/lat to a nearby in-grid tile', () => {
    const probe = { lon: 28.98, lat: 41.01 };
    const { col, row } = lonLatToTile(probe.lon, probe.lat);
    expect(inGrid(col, row)).toBe(true);
    const center = tileCenterWorld(col, row);
    const target = lonLatToWorld(probe.lon, probe.lat);
    const dist = Math.hypot(center.x - target.x, center.y - target.y);
    expect(dist).toBeLessThan(HEX_SIZE * 1.6);
  });

  it('clamps out-of-range points to the grid', () => {
    const t = lonLatToTile(100, -10);
    expect(inGrid(t.col, t.row)).toBe(true);
  });
});

describe('hex grid topology', () => {
  it('gives interior tiles exactly 6 neighbors, all in grid', () => {
    for (const [col, row] of [
      [10, 10],
      [11, 11],
      [40, 30],
    ]) {
      const n = neighbors(col, row);
      expect(n).toHaveLength(6);
      for (const t of n) expect(inGrid(t.col, t.row)).toBe(true);
    }
  });

  it('gives corner tiles fewer neighbors', () => {
    expect(neighbors(0, 0).length).toBeLessThan(6);
  });

  it('produces 6 hex corners equidistant from the center', () => {
    const corners = hexCorners(100, 100, HEX_SIZE);
    expect(corners).toHaveLength(6);
    for (const [x, y] of corners) {
      expect(Math.hypot(x - 100, y - 100)).toBeCloseTo(HEX_SIZE, 6);
    }
  });
});
