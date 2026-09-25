/**
 * Pure math shared by the post-process shaders and their tests.
 *
 * three.js' logarithmic depth buffer writes
 *   d = log2(1 + w) * logDepthBufFC * 0.5,  logDepthBufFC = 2 / log2(far + 1)
 * i.e. d = log2(1 + w) / log2(far + 1), where w is the view-space depth.
 * The post chain (tilt-shift DOF, ink edges) needs w back.
 */
export function logDepthToViewZ(d: number, far: number): number {
  return Math.pow(far + 1, d) - 1;
}

export function viewZToLogDepth(w: number, far: number): number {
  return Math.log2(1 + w) / Math.log2(far + 1);
}

/** Paint-filter resolution scale: half-res is crisp on HiDPI, softer at 1x. */
export function paintScaleFor(pixelRatio: number, tier: 'high' | 'medium' | 'low'): number {
  if (tier === 'low') return 0;
  if (tier === 'medium') return 0.5;
  return pixelRatio >= 1.5 ? 0.5 : 0.75;
}
