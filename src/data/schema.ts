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
    /** 0..1 painted cloud-band coverage. */
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
