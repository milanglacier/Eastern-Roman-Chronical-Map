/**
 * Visual theme. `chronicle` (default) is the living chronicle map — an
 * illuminated manuscript world flown with a free-look drone camera.
 * `?theme=clockwork` keeps the earlier Game-of-Thrones-titles mechanical
 * model for comparison (docs/art-direction.md, History).
 */
export type Theme = 'chronicle' | 'clockwork';

export function activeTheme(): Theme {
  if (typeof location === 'undefined') return 'chronicle';
  return new URLSearchParams(location.search).get('theme') === 'clockwork' ? 'clockwork' : 'chronicle';
}
