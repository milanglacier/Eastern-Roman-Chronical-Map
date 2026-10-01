/**
 * Frame statistics for the `?perf` overlay and benchmark (map/three/perf.ts).
 * Pure: unit-testable in jsdom.
 */

/** A frame longer than this is a stall: a visible hitch at any refresh rate. */
export const STALL_MS = 50;

export interface TimingSummary {
  count: number;
  p50: number;
  p95: number;
  max: number;
  mean: number;
  /** Frames longer than STALL_MS. */
  stalls: number;
}

/** Nearest-rank percentile of an ascending array (q in 0..1). */
export function percentile(sorted: ArrayLike<number>, q: number): number {
  if (sorted.length === 0) return NaN;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[i];
}

export function summarize(samples: ArrayLike<number>): TimingSummary {
  const sorted = Float64Array.from(samples).sort();
  let sum = 0;
  let stalls = 0;
  for (const v of sorted) {
    sum += v;
    if (v > STALL_MS) stalls++;
  }
  return {
    count: sorted.length,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    max: sorted.length ? sorted[sorted.length - 1] : NaN,
    mean: sorted.length ? sum / sorted.length : NaN,
    stalls,
  };
}

/** The last `size` samples, oldest overwritten first. */
export function createRollingWindow(size: number) {
  const buf = new Float64Array(size);
  let n = 0;
  let head = 0;
  return {
    push(v: number): void {
      buf[head] = v;
      head = (head + 1) % size;
      n = Math.min(size, n + 1);
    },
    values(): Float64Array {
      return n < size ? buf.slice(0, n) : buf.slice();
    },
    summary(): TimingSummary {
      return summarize(this.values());
    },
    clear(): void {
      n = 0;
      head = 0;
    },
  };
}

/**
 * True when WebGL runs on a CPU rasterizer (SwiftShader, llvmpipe, the Windows
 * basic display driver): the map cannot run smoothly there, whatever GPU is fitted.
 */
export function isSoftwareRenderer(name: string): boolean {
  return /swiftshader|llvmpipe|softpipe|lavapipe|microsoft basic render|software/i.test(name);
}
