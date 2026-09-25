import { describe, expect, it } from 'vitest';
import { logDepthToViewZ, paintScaleFor, viewZToLogDepth } from '../src/lib/postfxMath';
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

  it('only the low tier drops the paint filter', () => {
    expect(QUALITY_PRESETS.low.paint).toBe('none');
    expect(QUALITY_PRESETS.medium.paint).not.toBe('none');
    expect(paintScaleFor(2, 'low')).toBe(0);
    expect(paintScaleFor(2, 'high')).toBe(0.5);
    expect(paintScaleFor(1, 'high')).toBe(0.75);
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
