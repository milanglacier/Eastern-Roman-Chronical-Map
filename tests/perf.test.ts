import { describe, expect, it } from 'vitest';
import { STALL_MS, createRollingWindow, isSoftwareRenderer, percentile, summarize } from '../src/lib/perfStats';
import { createRingTest, createSegmentIndex, distanceToPolyline, pointInRing, type XY } from '../src/lib/polyline';
import { mulberry32 } from '../src/lib/prng';

describe('frame statistics', () => {
  it('takes nearest-rank percentiles', () => {
    const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(sorted, 0.5)).toBe(5);
    expect(percentile(sorted, 0.95)).toBe(10);
    expect(percentile(sorted, 0)).toBe(1);
    expect(percentile([], 0.5)).toBeNaN();
  });

  it('summarizes frames and counts stalls', () => {
    const s = summarize([16, 17, 16, 400, 18, STALL_MS, STALL_MS + 1]);
    expect(s.count).toBe(7);
    expect(s.p50).toBe(18); // 16 16 17 [18] 50 51 400
    expect(s.max).toBe(400);
    expect(s.stalls).toBe(2);
  });

  it('keeps only the last N samples', () => {
    const w = createRollingWindow(3);
    for (const v of [1, 2, 3, 4, 5]) w.push(v);
    expect([...w.values()].sort()).toEqual([3, 4, 5]);
    w.clear();
    expect(w.values().length).toBe(0);
  });

  it('recognises software rasterizers', () => {
    expect(isSoftwareRenderer('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)')).toBe(true);
    expect(isSoftwareRenderer('llvmpipe (LLVM 15.0.7, 256 bits)')).toBe(true);
    expect(isSoftwareRenderer('ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0)')).toBe(true);
    expect(isSoftwareRenderer('ANGLE (NVIDIA, NVIDIA GeForce RTX 5090 Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe(false);
    expect(isSoftwareRenderer('ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)')).toBe(false);
  });
});

describe('segment index', () => {
  it('answers exactly as the brute-force polyline distance', () => {
    const rand = mulberry32(1453);
    const lines: XY[][] = Array.from({ length: 6 }, () => {
      let x = rand() * 4 - 2;
      let y = rand() * 4 - 2;
      return Array.from({ length: 40 }, () => {
        x += (rand() - 0.5) * 0.2;
        y += (rand() - 0.5) * 0.2;
        return [x, y] as XY;
      });
    });
    lines.push([[0.3, 0.3]]); // a single point has no segments
    const index = createSegmentIndex(lines, 0.03);
    let near = 0;
    for (let i = 0; i < 20000; i++) {
      const q: XY = [rand() * 5 - 2.5, rand() * 5 - 2.5];
      for (const margin of [0.012, 0.022, 0.03]) {
        const brute = lines.some((l) => distanceToPolyline(l, q) <= margin);
        expect(index.near(q, margin)).toBe(brute);
        if (brute) near++;
      }
    }
    // The sample must actually exercise both answers.
    expect(near).toBeGreaterThan(100);
  });
});

describe('ring test', () => {
  it('answers exactly as pointInRing', () => {
    const rand = mulberry32(330);
    const ring: XY[] = Array.from({ length: 30 }, (_, i) => {
      const a = (i / 30) * Math.PI * 2;
      const r = 1 + rand() * 0.6;
      return [0.4 + Math.cos(a) * r, -0.2 + Math.sin(a) * r * 0.7];
    });
    const inside = createRingTest(ring);
    let hits = 0;
    for (let i = 0; i < 20000; i++) {
      const q: XY = [rand() * 5 - 2.1, rand() * 4 - 2.2];
      expect(inside(q)).toBe(pointInRing(q, ring));
      if (inside(q)) hits++;
    }
    // Vertices sit on the bounding box: probe them too.
    for (const v of ring) expect(inside(v)).toBe(pointInRing(v, ring));
    expect(hits).toBeGreaterThan(1000);
  });
});
