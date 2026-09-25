import type { EventCategory } from '../data/schema';

/** Gold edge of the imperial frontier (gold leaf). */
export const TERRITORY_BORDER = 0xd4a93c;

/**
 * The empire: an imperial-purple glaze MULTIPLIED over the natural land (so
 * relief, ink and washes show through), with a purple frontier rule edged in
 * gold (chronicle/terrain.ts). Purple-gold is reserved for the empire and the
 * UI — see docs/art-direction.md.
 */
export const TERRITORY_TINT = 0x8b5cc4;
export const TERRITORY_TINT_STRENGTH = 0.62;
/** How the glazed empire reads on screen — for the legend swatch. */
export const TERRITORY_SWATCH = 0x6b2fa0;

/** Category badge colors — must hold up against the parchment panel and map. */
export const CATEGORY_COLORS: Record<EventCategory, string> = {
  politics: '#8e3ec9',
  military: '#c04545',
  economy: '#c9a227',
  culture: '#3f8fbf',
  art: '#3fada0',
  law: '#b0722f',
  religion: '#7d68c9',
  civilization: '#5f9e5f',
};
