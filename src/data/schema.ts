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
