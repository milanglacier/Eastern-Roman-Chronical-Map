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
  /** Id of a zoomable city view (src/data/cities/<id>.json), if any. */
  scene: z.string().regex(/^[a-z0-9-]+$/).optional(),
});

export type City = z.infer<typeof CitySchema>;

export const CitiesFileSchema = z.array(CitySchema);

/* ------------------------------------------------------------------ */
/* City views (the zoomable "city lens", e.g. Constantinople)           */

const YearSchema = z.number().int().min(YEAR_MIN).max(YEAR_MAX);

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
  'cistern',
  'harbor',
  'chain',
  'avenue',
] as const;
export type CityStructureKind = (typeof CITY_STRUCTURE_KINDS)[number];

/** A version of a structure from `from` on (e.g. Hagia Sophia's rebuilds). */
export const CityStageSchema = z.object({
  from: YearSchema,
  /** Builder-specific variant key (e.g. 'basilica', 'domed', 'ruin'). */
  variant: z.string().min(1),
  note: LocalizedTextSchema.optional(),
});

export const CityStructureSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    kind: z.enum(CITY_STRUCTURE_KINDS),
    name: LocalizedTextSchema,
    from: YearSchema,
    /** Last year standing (inclusive); omitted = survives to 1453. */
    to: YearSchema.optional(),
    /** Polyline for linear works (walls, aqueducts, avenues, the chain). */
    path: z.array(LonLatSchema).min(2).optional(),
    /** Point landmarks. */
    position: LonLatSchema.optional(),
    /** Long-axis bearing in degrees clockwise from north. */
    bearing: z.number().optional(),
    /** Builder-specific dimensions in metres (e.g. [length, width, height]). */
    size: z.array(z.number().positive()).optional(),
    stages: z.array(CityStageSchema).optional(),
  })
  .refine((s) => s.path !== undefined || s.position !== undefined, {
    message: 'a structure needs a path or a position',
  });
export type CityStructure = z.infer<typeof CityStructureSchema>;

const KeyframeSchema = z.object({ year: YearSchema, value: z.number() });

export const CitySceneSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: LocalizedTextSchema,
  /** Establishing view: look-at point, camera distance (m), heading (deg, 0 = north). */
  home: z.object({
    lonlat: LonLatSchema,
    distance: z.number().positive(),
    heading: z.number(),
  }),
  /** Built-up area over time: the city fills the ring valid for the year. */
  urbanAreas: z
    .array(z.object({ from: YearSchema, to: YearSchema.optional(), ring: RingSchema }))
    .min(1),
  /** 0..1 share of the urban area that is built up (houses), keyed by year. */
  density: z.array(KeyframeSchema).min(1),
  /** Approximate population, keyed by year (for the caption). */
  population: z.array(KeyframeSchema).min(1),
  /** Era captions shown in the city view; each holds until the next. */
  captions: z.array(z.object({ from: YearSchema, text: LocalizedTextSchema })).min(1),
  structures: z.array(CityStructureSchema),
});
export type CityScene = z.infer<typeof CitySceneSchema>;
