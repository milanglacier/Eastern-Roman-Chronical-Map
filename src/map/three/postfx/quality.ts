/**
 * Quality tiers for the painted pipeline. Chosen once from the device (and
 * `?quality=high|medium|low` for testing), then stepped down at most twice by
 * a frame-time probe. The low tier drops the paint filter entirely — the
 * painted bake has to carry the look on phones.
 */
export type QualityTier = 'high' | 'medium' | 'low';

export interface QualitySettings {
  tier: QualityTier;
  maxPixelRatio: number;
  /** 'anisotropic' = structure-tensor Kuwahara; 'isotropic' = circular 8-sector. */
  paint: 'anisotropic' | 'isotropic' | 'none';
  /** Kernel radius in paint-buffer pixels. */
  paintRadius: number;
  msaa: number;
  bloomLevels: number;
  dof: boolean;
  shadowMapSize: number;
}

export const QUALITY_PRESETS: Record<QualityTier, QualitySettings> = {
  high: {
    tier: 'high',
    maxPixelRatio: 2,
    paint: 'anisotropic',
    paintRadius: 4,
    msaa: 4,
    bloomLevels: 5,
    dof: true,
    shadowMapSize: 2048,
  },
  medium: {
    tier: 'medium',
    maxPixelRatio: 1.5,
    paint: 'isotropic',
    paintRadius: 3,
    msaa: 4,
    bloomLevels: 4,
    dof: true,
    shadowMapSize: 2048,
  },
  low: {
    tier: 'low',
    maxPixelRatio: 1,
    paint: 'none',
    paintRadius: 0,
    msaa: 2,
    bloomLevels: 3,
    dof: false,
    shadowMapSize: 1024,
  },
};

export function nextLowerTier(tier: QualityTier): QualityTier | null {
  return tier === 'high' ? 'medium' : tier === 'medium' ? 'low' : null;
}

function forcedTier(): QualityTier | null {
  if (typeof location === 'undefined') return null;
  const q = new URLSearchParams(location.search).get('quality');
  return q === 'high' || q === 'medium' || q === 'low' ? q : null;
}

/** Initial tier from URL override or a coarse device heuristic. */
export function initialTier(): { tier: QualityTier; forced: boolean } {
  const forced = forcedTier();
  if (forced) return { tier: forced, forced: true };
  if (typeof window === 'undefined') return { tier: 'medium', forced: false };
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const small = Math.min(window.innerWidth, window.innerHeight) < 600;
  if (coarse && small) return { tier: 'low', forced: false };
  if (coarse || (navigator.hardwareConcurrency ?? 8) <= 4) return { tier: 'medium', forced: false };
  return { tier: 'high', forced: false };
}

/** `?paint=0` disables the paint pass for A/B comparisons. */
export function paintDisabledByUrl(): boolean {
  if (typeof location === 'undefined') return false;
  return new URLSearchParams(location.search).get('paint') === '0';
}

/**
 * Frame-time probe: after a warm-up, if the median frame over a window is
 * slower than the budget, recommend one tier down. Pure state machine.
 */
export function createFrameProbe(budgetMs = 30, warmup = 45, window = 90) {
  const samples: number[] = [];
  let seen = 0;
  return {
    /** Feed one frame time; returns true when the tier should drop. */
    push(frameMs: number): boolean {
      seen++;
      if (seen <= warmup) return false;
      samples.push(frameMs);
      if (samples.length < window) return false;
      const sorted = [...samples].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      samples.length = 0;
      return median > budgetMs;
    },
    reset() {
      samples.length = 0;
      seen = 0;
    },
  };
}
