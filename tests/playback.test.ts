import { describe, expect, it } from 'vitest';
import { snapshots } from '../src/data';
import { YEAR_MAX, YEAR_MIN } from '../src/data/schema';
import { ERA_SECONDS_MIN, SECONDS_PER_YEAR, createPlaybackClock, playbackClock as clock } from '../src/lib/playback';

const eraStarts = snapshots.map((s) => s.year).filter((y) => y < YEAR_MAX);

describe('playback clock', () => {
  it('gives every era its floor plus its share of the years', () => {
    for (const y of eraStarts) expect(clock.eraSeconds(y)).toBeGreaterThanOrEqual(ERA_SECONDS_MIN);
    expect(clock.eraSeconds(YEAR_MAX)).toBe(0);
    expect(clock.duration).toBeCloseTo(eraStarts.length * ERA_SECONDS_MIN + (YEAR_MAX - YEAR_MIN) * SECONDS_PER_YEAR, 9);
    // About two minutes for all of history.
    expect(clock.duration).toBeGreaterThan(110);
    expect(clock.duration).toBeLessThan(130);
  });

  it('reaches each era exactly when its budget says', () => {
    let t = 0;
    for (const y of eraStarts) {
      expect(clock.timeAt(y)).toBeCloseTo(t, 6);
      expect(clock.yearAt(t)).toBeCloseTo(y, 6);
      t += clock.eraSeconds(y);
    }
    expect(t).toBeCloseTo(clock.duration, 9);
  });

  it('runs from 330 to 1453, always forward', () => {
    expect(clock.yearAt(0)).toBe(YEAR_MIN);
    expect(clock.yearAt(clock.duration)).toBe(YEAR_MAX);
    expect(clock.yearAt(-5)).toBe(YEAR_MIN);
    expect(clock.yearAt(clock.duration + 5)).toBe(YEAR_MAX);
    let prev = clock.yearAt(0);
    for (let t = 0.01; t < clock.duration; t += 0.01) {
      const y = clock.yearAt(t);
      expect(y).toBeGreaterThan(prev);
      prev = y;
    }
  });

  it('inverts cleanly between years and seconds', () => {
    for (let y = YEAR_MIN; y <= YEAR_MAX; y += 3.7) expect(clock.yearAt(clock.timeAt(y))).toBeCloseTo(y, 4);
    for (let t = 0; t <= clock.duration; t += 1.3) expect(clock.timeAt(clock.yearAt(t))).toBeCloseTo(t, 4);
  });

  it('eases the pace across era boundaries instead of stepping', () => {
    const e = 1e-4;
    for (const y of eraStarts.slice(1)) {
      const t = clock.timeAt(y);
      const before = (clock.yearAt(t) - clock.yearAt(t - e)) / e;
      const after = (clock.yearAt(t + e) - clock.yearAt(t)) / e;
      expect(Math.abs(after - before)).toBeLessThan(0.01 * Math.max(1, before));
    }
  });

  it('never races faster than the old constant 15 years a second', () => {
    let peak = 0;
    for (let t = 0; t < clock.duration; t += 0.05) peak = Math.max(peak, (clock.yearAt(t + 0.05) - clock.yearAt(t)) / 0.05);
    expect(peak).toBeLessThan(14);
  });

  it('handles a final era that runs past the last snapshot', () => {
    const c = createPlaybackClock([0, 10, 100], 200);
    expect(c.eraSeconds(100)).toBeCloseTo(ERA_SECONDS_MIN + 5);
    expect(c.yearAt(c.duration)).toBe(200);
    expect(c.timeAt(100)).toBeCloseTo(c.eraSeconds(0) + c.eraSeconds(10), 6);
  });
});
