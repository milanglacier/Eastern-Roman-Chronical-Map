import snapshotsJson from './snapshots.json';
import citiesJson from './cities.json';
import era1 from './events/era1.json';
import era2 from './events/era2.json';
import era3 from './events/era3.json';
import era4 from './events/era4.json';
import {
  SnapshotsFileSchema,
  CitiesFileSchema,
  EventsFileSchema,
  type HistoricalEvent,
  type Snapshot,
  type City,
  type Territory,
  TerritorySchema,
} from './schema';

export const snapshots: Snapshot[] = SnapshotsFileSchema.parse(snapshotsJson).sort(
  (a, b) => a.year - b.year,
);

export const cities: City[] = CitiesFileSchema.parse(citiesJson);

export const events: HistoricalEvent[] = EventsFileSchema.parse([
  ...era1,
  ...era2,
  ...era3,
  ...era4,
]).sort((a, b) => a.year - b.year);

// Territory GeoJSON files, eagerly bundled and keyed by snapshot year.
const territoryModules = import.meta.glob('./territories/*.json', { eager: true, import: 'default' });

export const territories: Map<number, Territory> = new Map(
  Object.entries(territoryModules).map(([path, geometry]) => {
    const year = Number(path.match(/(\d+)\.json$/)![1]);
    return [year, TerritorySchema.parse(geometry)];
  }),
);
