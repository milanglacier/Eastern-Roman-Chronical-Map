import type { TerrainCode, EventCategory } from '../data/schema';

/** Terrain fills, tuned to sit under the imperial purple territory tint. */
export const TERRAIN_COLORS: Record<TerrainCode, number> = {
  D: 0x1c2f52, // deep sea
  s: 0x2f5178, // coastal shallows
  g: 0x6f9c52, // grassland
  p: 0xb3a05f, // plains
  h: 0x8c7f4e, // hills
  m: 0x8f8fa0, // mountain rock
  d: 0xd7c189, // desert sand
};

export const MOUNTAIN_SNOW = 0xeceef5;
export const MOUNTAIN_SHADE = 0x6c6c80;
export const HILL_SHADE = 0x6f6340;
export const SEA_RIPPLE = 0x4a6f97;
export const TILE_EDGE = 0x0d1526;

/** Imperial purple territory overlay. */
export const TERRITORY_FILL = 0x6b2fa0;
// Lowered from 0.58 when terrain moved to textured sprites: the busier
// ground reads through a lighter tint without muddying the purple.
export const TERRITORY_FILL_ALPHA = 0.45;
export const TERRITORY_BORDER = 0xd8b64a; // mosaic gold
export const TERRITORY_BORDER_ALPHA = 0.95;

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
