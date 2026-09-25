import { describe, expect, it } from 'vitest';
import { moods } from '../src/data';
import { directionFromAzAlt, hexToLinear, lerpAngleDeg, sampleMood } from '../src/lib/mood';
import { YEAR_MAX, YEAR_MIN } from '../src/data/schema';

describe('era moods', () => {
  it('covers the whole timeline with strictly increasing keys', () => {
    expect(moods[0].year).toBe(YEAR_MIN);
    expect(moods[moods.length - 1].year).toBe(YEAR_MAX);
    for (let i = 1; i < moods.length; i++) expect(moods[i].year).toBeGreaterThan(moods[i - 1].year);
  });

  it('returns the exact keyframe at key years', () => {
    for (const key of [moods[0], moods[5], moods[moods.length - 1]]) {
      const m = sampleMood(moods, key.year);
      expect(m.night).toBeCloseTo(key.night, 10);
      expect(m.keyIntensity).toBeCloseTo(key.key.intensity, 10);
      expect(m.skyZenith).toEqual(hexToLinear(key.sky.zenith));
    }
  });

  it('interpolates continuously between keys', () => {
    let prev = sampleMood(moods, YEAR_MIN);
    for (let y = YEAR_MIN + 0.5; y <= YEAR_MAX; y += 0.5) {
      const m = sampleMood(moods, y);
      expect(Math.abs(m.keyIntensity - prev.keyIntensity)).toBeLessThan(0.2);
      expect(Math.abs(m.night - prev.night)).toBeLessThan(0.2);
      prev = m;
    }
  });

  it('ends the story at night and begins it by day', () => {
    expect(sampleMood(moods, YEAR_MIN).night).toBe(0);
    expect(sampleMood(moods, YEAR_MAX).night).toBe(1);
  });

  it('keeps the key light above the horizon', () => {
    for (let y = YEAR_MIN; y <= YEAR_MAX; y += 7) expect(sampleMood(moods, y).keyDir[1]).toBeGreaterThan(0);
  });
});

describe('mood math', () => {
  it('interpolates azimuth along the short arc', () => {
    expect(lerpAngleDeg(350, 10, 0.5)).toBeCloseTo(0, 10);
    expect(lerpAngleDeg(10, 350, 0.5)).toBeCloseTo(0, 10);
    expect(lerpAngleDeg(90, 180, 0.5)).toBeCloseTo(135, 10);
  });

  it('maps compass directions onto world axes (north = -Z, east = +X)', () => {
    const north = directionFromAzAlt(0, 0);
    expect(north[2]).toBeCloseTo(-1, 10);
    const east = directionFromAzAlt(90, 0);
    expect(east[0]).toBeCloseTo(1, 10);
    expect(directionFromAzAlt(0, 90)[1]).toBeCloseTo(1, 10);
  });

  it('decodes sRGB hex into linear light', () => {
    expect(hexToLinear('#ffffff')).toEqual([1, 1, 1]);
    expect(hexToLinear('#000000')).toEqual([0, 0, 0]);
    expect(hexToLinear('#808080')[0]).toBeCloseTo(0.2158, 3);
  });
});
