import type { EventCategory } from '../data/schema';

export const TERRITORY_BORDER = 0xd8b64a; // mosaic gold

/**
 * Territory drape: a warm Tyrian-leaning imperial tint blended into the
 * terrain diffuse (strength kept low so relief stays readable inside the
 * empire), plus the gold frontier glow above.
 */
export const TERRITORY_TINT = 0x9a4a7a;
export const TERRITORY_TINT_STRENGTH = 0.18;

export const CITY_BUILDING = 0xf3ead6;
export const CITY_ROOF = 0xc9a227;
export const CITY_OUTLINE = 0x3a2a12;

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
