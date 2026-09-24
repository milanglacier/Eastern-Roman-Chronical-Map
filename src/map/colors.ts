import type { EventCategory } from '../data/schema';

export const TERRITORY_BORDER = 0xd8b64a; // mosaic gold

/**
 * Territory drape: imperial purple mixed into the diffuse before lighting,
 * so sun/shadow relief still shades the empire. A light veil over the whole
 * interior plus a stronger band just inside the frontier keeps the
 * satellite land readable while the Empire's extent still reads at a glance;
 * a crisp gold frontier line rims it (see terrain.ts shader).
 */
export const TERRITORY_TINT = 0x6b2fa0;
export const TERRITORY_TINT_STRENGTH = 0.14;
/** Extra tint just inside the frontier, fading over the glow band (~50 km). */
export const TERRITORY_EDGE_STRENGTH = 0.34;

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
