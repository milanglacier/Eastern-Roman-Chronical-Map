/**
 * Visual theme. `chronicle` (default) is the living chronicle map — an
 * illuminated manuscript world flown with a free-look drone camera. The
 * earlier prototypes stay reachable for comparison: `?theme=clockwork`
 * (Game-of-Thrones-titles mechanical model) and `?theme=painted` (v2
 * painted diorama).
 */
export type Theme = 'chronicle' | 'clockwork' | 'painted';

export function activeTheme(): Theme {
  if (typeof location === 'undefined') return 'chronicle';
  const t = new URLSearchParams(location.search).get('theme');
  return t === 'painted' || t === 'clockwork' ? t : 'chronicle';
}
