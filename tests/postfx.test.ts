import { describe, expect, it } from 'vitest';
import { logDepthToViewZ, viewZToLogDepth } from '../src/lib/postfxMath';
import { QUALITY_PRESETS, createFrameProbe, nextLowerTier } from '../src/map/three/postfx/quality';

describe('log depth linearization', () => {
  it('round-trips view depth through the log encoding', () => {
    for (const far of [1500, 2640]) {
      for (const w of [0.05, 1, 12.5, 300, far * 0.9]) {
        expect(logDepthToViewZ(viewZToLogDepth(w, far), far)).toBeCloseTo(w, 6);
      }
    }
  });

  it('maps the far plane to depth 1 and the eye to 0', () => {
    expect(viewZToLogDepth(1500, 1500)).toBeCloseTo(1, 12);
    expect(viewZToLogDepth(0, 1500)).toBe(0);
  });
});

describe('quality tiers', () => {
  it('steps down high → medium → low → stop', () => {
    expect(nextLowerTier('high')).toBe('medium');
    expect(nextLowerTier('medium')).toBe('low');
    expect(nextLowerTier('low')).toBeNull();
  });

  it('lower tiers never cost more than higher ones', () => {
    expect(QUALITY_PRESETS.low.maxPixelRatio).toBeLessThanOrEqual(QUALITY_PRESETS.medium.maxPixelRatio);
    expect(QUALITY_PRESETS.medium.maxPixelRatio).toBeLessThanOrEqual(QUALITY_PRESETS.high.maxPixelRatio);
    expect(QUALITY_PRESETS.low.bloomLevels).toBeLessThanOrEqual(QUALITY_PRESETS.high.bloomLevels);
    expect(QUALITY_PRESETS.low.dof).toBe(false);
  });

  it('frame probe recommends a drop only for a slow median after warm-up', () => {
    const fast = createFrameProbe(30, 5, 10);
    const results = Array.from({ length: 40 }, () => fast.push(16));
    expect(results.some(Boolean)).toBe(false);
    const slow = createFrameProbe(30, 5, 10);
    const slowResults = Array.from({ length: 15 }, () => slow.push(50));
    expect(slowResults.slice(0, 5).some(Boolean)).toBe(false);
    expect(slowResults[14]).toBe(true);
  });
});
