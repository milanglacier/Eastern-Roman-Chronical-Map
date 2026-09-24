import { describe, expect, it } from 'vitest';
import { cityScenes } from '../src/data';
import {
  captionForYear,
  interpolateKeyframes,
  roundPopulation,
  structureStands,
  structureVariant,
  urbanAreaForYear,
} from '../src/lib/cityTimeline';

const constantinople = cityScenes.get('constantinople')!;
const byId = (id: string) => constantinople.structures.find((s) => s.id === id)!;

describe('city timeline lookups', () => {
  it('interpolates and clamps keyframes', () => {
    const keys = [
      { year: 400, value: 0 },
      { year: 500, value: 1 },
    ];
    expect(interpolateKeyframes(keys, 300)).toBe(0);
    expect(interpolateKeyframes(keys, 450)).toBeCloseTo(0.5);
    expect(interpolateKeyframes(keys, 900)).toBe(1);
  });

  it('switches from the Constantinian to the Theodosian urban area in 413', () => {
    expect(urbanAreaForYear(constantinople, 412).from).toBe(330);
    expect(urbanAreaForYear(constantinople, 413).from).toBe(413);
    expect(urbanAreaForYear(constantinople, 1453).from).toBe(413);
  });

  it('shows the Theodosian Walls only from 413', () => {
    expect(structureStands(byId('theodosian-walls'), 412)).toBe(false);
    expect(structureStands(byId('theodosian-walls'), 413)).toBe(true);
  });

  it('tracks the Hagia Sophia rebuilds', () => {
    const hs = byId('hagia-sophia');
    expect(structureVariant(hs, 359)).toBeNull();
    expect(structureVariant(hs, 400)).toBe('basilica');
    expect(structureVariant(hs, 533)).toBe('ruin');
    expect(structureVariant(hs, 537)).toBe('domed');
    expect(structureVariant(hs, 1453)).toBe('domed');
  });

  it('picks the caption in force', () => {
    expect(captionForYear(constantinople, 330).from).toBe(330);
    expect(captionForYear(constantinople, 1203).from).toBe(1081);
    expect(captionForYear(constantinople, 1453).from).toBe(1453);
  });

  it('rounds populations to two significant figures', () => {
    expect(roundPopulation(487000)).toBe(490000);
    expect(roundPopulation(52300)).toBe(52000);
  });
});
