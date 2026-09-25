/** Easing curves shared by the camera flights and the pop-up city. */

export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Ease out with a small overshoot: things fold up and settle into place. */
export function easeOutBack(x: number): number {
  const c1 = 1.25;
  const c3 = c1 + 1;
  const u = x - 1;
  return 1 + c3 * u * u * u + c1 * u * u;
}
