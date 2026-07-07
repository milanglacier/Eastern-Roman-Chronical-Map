/**
 * Shared deterministic PRNG helpers. Used by the offline world-texture bake
 * (scripts/build-world-textures.mjs) and anywhere runtime code needs stable,
 * seedable noise. Determinism here is what keeps the bake idempotent.
 */

/** FNV-1a hash of a string → 32-bit unsigned seed. */
export function hashStringSeed(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** mulberry32: tiny deterministic PRNG over [0, 1). */
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
