import { describe, it, expect } from 'vitest';
import {
  pointInRing,
  pointInPolygon,
  pointInMultiPolygon,
  pointInGeometry,
  nearPolyline,
  type Ring,
} from '../src/lib/geo';

const square: Ring = [
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
  [0, 0],
];

describe('pointInRing', () => {
  it('detects inside and outside', () => {
    expect(pointInRing(5, 5, square)).toBe(true);
    expect(pointInRing(15, 5, square)).toBe(false);
    expect(pointInRing(-1, -1, square)).toBe(false);
  });
});

describe('pointInPolygon with holes', () => {
  const hole: Ring = [
    [4, 4],
    [6, 4],
    [6, 6],
    [4, 6],
    [4, 4],
  ];
  it('excludes points inside holes', () => {
    expect(pointInPolygon(5, 5, [square, hole])).toBe(false);
    expect(pointInPolygon(2, 2, [square, hole])).toBe(true);
  });
});

describe('pointInMultiPolygon / pointInGeometry', () => {
  const far: Ring = [
    [20, 20],
    [30, 20],
    [30, 30],
    [20, 30],
    [20, 20],
  ];
  it('matches any member polygon', () => {
    const mp = [[square], [far]];
    expect(pointInMultiPolygon(25, 25, mp)).toBe(true);
    expect(pointInMultiPolygon(5, 5, mp)).toBe(true);
    expect(pointInMultiPolygon(15, 15, mp)).toBe(false);
    expect(pointInGeometry(25, 25, { type: 'MultiPolygon', coordinates: mp })).toBe(true);
    expect(pointInGeometry(5, 5, { type: 'Polygon', coordinates: [square] })).toBe(true);
  });
});

describe('nearPolyline', () => {
  const line: [number, number][] = [
    [0, 0],
    [10, 0],
  ];
  it('detects proximity to segments, including endpoints', () => {
    expect(nearPolyline(5, 0.5, line, 1)).toBe(true);
    expect(nearPolyline(5, 2, line, 1)).toBe(false);
    expect(nearPolyline(-0.5, 0, line, 1)).toBe(true);
    expect(nearPolyline(11.5, 0, line, 1)).toBe(false);
  });
});
