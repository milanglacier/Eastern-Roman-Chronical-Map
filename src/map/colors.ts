import type { EventCategory } from '../data/schema';

export const TERRITORY_BORDER = 0xd8b64a; // mosaic gold

/**
 * Territory drape: an imperial-purple watercolour glaze. It MULTIPLIES the
 * painted land (so relief, rivers and brushwork show through) and pools
 * darker toward the frontier; an umber ink line with a gilt rule inside
 * draws the border (see terrain.ts shader). The glaze colour is a light
 * violet — multiplied, it reads as imperial purple without drowning the land.
 */
export const TERRITORY_TINT = 0xa47fcf;
export const TERRITORY_TINT_STRENGTH = 0.5;
/** How the glazed empire reads on screen — for the legend swatch. */
export const TERRITORY_SWATCH = 0x6b2fa0;
/** Frontier ink (umber, docs/art-direction.md). */
export const TERRITORY_INK = 0x3b2a22;

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
