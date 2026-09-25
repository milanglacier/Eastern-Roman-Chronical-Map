import { z } from 'zod';
import { LON_MIN, LON_MAX, LAT_MIN, LAT_MAX } from '../lib/hex';

export const YEAR_MIN = 330;
export const YEAR_MAX = 1453;

export const EVENT_CATEGORIES = [
  'politics',
  'military',
  'economy',
  'culture',
  'art',
  'law',
  'religion',
  'civilization',
] as const;

export type EventCategory = (typeof EVENT_CATEGORIES)[number];

export const LocalizedTextSchema = z.object({
  en: z.string().min(1),
  zh: z.string().min(1),
});

export type LocalizedText = z.infer<typeof LocalizedTextSchema>;

const LonLatSchema = z.tuple([
  z.number().min(LON_MIN).max(LON_MAX),
  z.number().min(LAT_MIN).max(LAT_MAX),
]);

export const HistoricalEventSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  year: z.number().int().min(YEAR_MIN).max(YEAR_MAX),
  endYear: z.number().int().min(YEAR_MIN).max(YEAR_MAX).optional(),
  category: z.enum(EVENT_CATEGORIES),
  lonlat: LonLatSchema,
  importance: z.union([z.literal(1), z.literal(2)]),
  title: LocalizedTextSchema,
  summary: LocalizedTextSchema,
  detail: LocalizedTextSchema,
});

export type HistoricalEvent = z.infer<typeof HistoricalEventSchema>;

export const EventsFileSchema = z.array(HistoricalEventSchema);

export const SnapshotSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  year: z.number().int().min(YEAR_MIN).max(YEAR_MAX),
  label: LocalizedTextSchema,
  note: LocalizedTextSchema,
});

export type Snapshot = z.infer<typeof SnapshotSchema>;

export const SnapshotsFileSchema = z.array(SnapshotSchema);

const RingSchema = z.array(LonLatSchema).min(4);

export const TerritorySchema = z.object({
  type: z.literal('MultiPolygon'),
  coordinates: z.array(z.array(RingSchema).min(1)),
});

export type Territory = z.infer<typeof TerritorySchema>;

export const CitySchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: LocalizedTextSchema,
  lonlat: LonLatSchema,
  /** Year range(s) during which the city is shown on the map. */
  from: z.number().int().min(YEAR_MIN).max(YEAR_MAX),
  to: z.number().int().min(YEAR_MIN).max(YEAR_MAX),
  /** 1 = capital/great city (bigger icon), 2 = regular. */
  rank: z.union([z.literal(1), z.literal(2)]),
});

export type City = z.infer<typeof CitySchema>;

export const CitiesFileSchema = z.array(CitySchema);

/* ------------------------------------------------------------------ */
/* Era mood keyframes (lighting, sky, haze, colour grade)              */

const HexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/**
 * One art-direction keyframe: how the world is lit and graded at `year`.
 * `src/lib/mood.ts` interpolates between keys; see docs/art-direction.md.
 * The key light is the sun by day and the moon at night (`night` → 1).
 */
export const MoodKeySchema = z.object({
  year: z.number().int().min(YEAR_MIN).max(YEAR_MAX),
  name: z.string().min(1),
  key: z.object({
    /** Degrees clockwise from north. */
    azimuth: z.number().min(0).max(360),
    /** Degrees above the horizon. */
    altitude: z.number().min(2).max(89),
    color: HexColorSchema,
    intensity: z.number().min(0).max(6),
  }),
  sky: z.object({
    zenith: HexColorSchema,
    horizon: HexColorSchema,
    /** Glow around the sun/moon disc. */
    glow: HexColorSchema,
    /** 0..1 cloud coverage. */
    clouds: z.number().min(0).max(1),
  }),
  ambient: z.object({
    sky: HexColorSchema,
    ground: HexColorSchema,
    intensity: z.number().min(0).max(4),
  }),
  /** Aerial-perspective haze; fog colour = sky horizon tinted by this. */
  haze: z.object({
    color: HexColorSchema,
    /** Multiplier on the distance-scaled fog range (>1 = thicker). */
    density: z.number().min(0.2).max(4),
  }),
  exposure: z.number().min(0.2).max(3),
  grade: z.object({
    saturation: z.number().min(0).max(2),
    contrast: z.number().min(0.5).max(1.5),
    shadowTint: HexColorSchema,
    highlightTint: HexColorSchema,
    /** 0..1 strength of the split-tone. */
    split: z.number().min(0).max(1),
  }),
  bloom: z.number().min(0).max(2),
  /** 0 = day, 1 = full night (stars, moon disc, lamps and fires glow). */
  night: z.number().min(0).max(1),
});

export type MoodKey = z.infer<typeof MoodKeySchema>;

export const MoodsFileSchema = z.array(MoodKeySchema).min(2);

/* ------------------------------------------------------------------ */
/* City pages (a magnified pop-up city inset, e.g. Constantinople)      */

const YearSchema = z.number().int().min(YEAR_MIN).max(YEAR_MAX);

/** Dated presence: shown from `from` through `to` (inclusive; omitted = to 1453). */
const DatedSchema = z.object({ from: YearSchema, to: YearSchema.optional() });

export const CITY_STRUCTURE_KINDS = [
  'land-wall',
  'sea-wall',
  'gate',
  'tower',
  'great-church',
  'church',
  'hippodrome',
  'palace',
  'column',
  'forum',
  'aqueduct',
  'chain',
] as const;
export type CityStructureKind = (typeof CITY_STRUCTURE_KINDS)[number];

/** A version of a structure from `from` on (e.g. Hagia Sophia's rebuilds). */
export const CityStageSchema = z.object({
  from: YearSchema,
  /** Drawing variant key (e.g. 'basilica', 'domed', 'ruin'). */
  variant: z.string().regex(/^[a-z0-9-]+$/),
  note: LocalizedTextSchema.optional(),
});
export type CityStage = z.infer<typeof CityStageSchema>;

/** A wall that follows the baked coast between two points, set back inland. */
const CoastPathSchema = z.object({
  start: LonLatSchema,
  end: LonLatSchema,
  /** Setback from the shore in metres. */
  inset: z.number().min(0).max(300),
});

export const CityStructureSchema = DatedSchema.extend({
  id: z.string().regex(/^[a-z0-9-]+$/),
  kind: z.enum(CITY_STRUCTURE_KINDS),
  name: LocalizedTextSchema,
  /** Polyline for linear works (land walls, aqueducts, the chain). */
  path: z.array(LonLatSchema).min(2).optional(),
  /** Sea walls: the shore between two points. */
  coast: CoastPathSchema.optional(),
  /** Point landmarks. */
  position: LonLatSchema.optional(),
  /** Footprint in metres, for structures drawn on the ground (forums). */
  size: z.array(z.number().positive()).optional(),
  stages: z.array(CityStageSchema).min(1),
}).refine((s) => [s.path, s.coast, s.position].filter((v) => v !== undefined).length === 1, {
  message: 'a structure needs exactly one of path, coast or position',
});
export type CityStructure = z.infer<typeof CityStructureSchema>;

export const CITY_FEATURE_KINDS = ['harbour', 'cistern', 'avenue', 'plaza', 'garden', 'burnt'] as const;
export type CityFeatureKind = (typeof CITY_FEATURE_KINDS)[number];

/** Something drawn on the page itself: waters, roads, open spaces. */
export const CityFeatureSchema = DatedSchema.extend({
  id: z.string().regex(/^[a-z0-9-]+$/),
  kind: z.enum(CITY_FEATURE_KINDS),
  name: LocalizedTextSchema,
  ring: z.array(LonLatSchema).min(3).optional(),
  path: z.array(LonLatSchema).min(2).optional(),
  /** Centre of a rectangle or ellipse of `size` metres, turned by `bearing`. */
  position: LonLatSchema.optional(),
  size: z.tuple([z.number().positive(), z.number().positive()]).optional(),
  bearing: z.number().optional(),
  shape: z.enum(['rect', 'ellipse']).optional(),
}).refine((f) => f.ring !== undefined || f.path !== undefined || (f.position !== undefined && f.size !== undefined), {
  message: 'a feature needs a ring, a path, or a position with a size',
});
export type CityFeature = z.infer<typeof CityFeatureSchema>;

/** A built-up area; houses fill it in proportion to the density curve. */
export const CityUrbanAreaSchema = DatedSchema.extend({
  id: z.string().regex(/^[a-z0-9-]+$/),
  ring: z.array(LonLatSchema).min(4),
  /** Density multiplier relative to the city proper (1). */
  weight: z.number().min(0).max(2).default(1),
});
export type CityUrbanArea = z.infer<typeof CityUrbanAreaSchema>;

/** Lettering on the page: the art shows the period inscription. */
export const CityLabelSchema = DatedSchema.extend({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: LocalizedTextSchema,
  inscription: z.object({ greek: z.string().min(1), latin: z.string().min(1) }),
  position: LonLatSchema,
  /** Degrees counter-clockwise from east, along the water or ridge. */
  angle: z.number().default(0),
  size: z.enum(['sea', 'strait', 'place']),
});
export type CityLabel = z.infer<typeof CityLabelSchema>;

export const CityVesselSchema = DatedSchema.extend({
  kind: z.enum(['dromon', 'merchant']),
  position: LonLatSchema,
});
export type CityVessel = z.infer<typeof CityVesselSchema>;

const KeyframeSchema = z.object({ year: YearSchema, value: z.number().min(0) });

export const CityPlanSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: LocalizedTextSchema,
  /** Title plaque lettering. */
  inscription: z.object({ greek: z.string().min(1), latin: z.string().min(1) }),
  page: z.object({
    /** [west, south, east, north]; must match the plate bake config. */
    bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
    /** Plan scale relative to the world map. */
    magnification: z.number().min(1).max(40),
    /** Where the title plaque lies on the page. */
    plaque: LonLatSchema,
  }),
  urbanAreas: z.array(CityUrbanAreaSchema).min(1),
  /** 0..1 fill of the urban areas with houses. */
  density: z.array(KeyframeSchema).min(2),
  population: z.array(KeyframeSchema).min(2),
  captions: z.array(z.object({ from: YearSchema, text: LocalizedTextSchema })),
  structures: z.array(CityStructureSchema),
  features: z.array(CityFeatureSchema),
  labels: z.array(CityLabelSchema),
  vessels: z.array(CityVesselSchema),
});
export type CityPlan = z.infer<typeof CityPlanSchema>;
