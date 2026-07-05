# Eastern Roman Chronicle Map · 东罗马编年地图

An interactive, bilingual (English / 中文) historical visualization of the **Eastern
Roman Empire, AD 330–1453**: a Civilization-style isometric hex-tile map of the
Mediterranean world showing the empire's changing borders across 26 era snapshots,
with 100+ clickable event widgets covering politics, war, economy, culture, art,
law, religion, and civilization — each placed at the location where it happened.

> **Project rule #1:** the state is never called "Byzantium" — it is the Eastern
> Roman Empire (东罗马帝国). A test enforces this across all data files.

## Running

```bash
npm install
npm run dev        # dev server
npm test           # vitest: data validation + unit + component tests
npm run build      # static production build (dist/)
```

## How it works

- **Map** — `src/map/` renders a 90×56 pointy-top hex grid with PixiJS v8 in a
  squashed isometric projection (Civ-style 45° view). Terrain is procedural:
  mountains extrude with snow caps, hills mound, waves ripple. Drag to pan,
  scroll to zoom.
- **Territory** — each snapshot year has a hand-authored GeoJSON MultiPolygon in
  `src/data/territories/<year>.json`. At runtime, land tiles whose centers fall
  inside the polygon are tinted imperial purple with a gold Civ-style border;
  snapshot changes crossfade.
- **Events** — `src/data/events/era*.json` hold bilingual event entries (see
  schema in `src/data/schema.ts`). Events appear as clickable widgets on the map
  during their era; clicking one stops autoplay and opens the detail panel.
- **Timeline** — scrub freely, click a snapshot diamond, or press play to sweep
  through eleven centuries (space bar toggles; arrows step).

## Editing the content (no code required)

All historical content is data, validated by zod schemas and tests:

| What | Where | Notes |
| --- | --- | --- |
| Events | `src/data/events/era*.json` | bilingual title/summary/detail, category, `[lon, lat]`, importance |
| Era snapshots | `src/data/snapshots.json` | year + bilingual label/note, sorted by year |
| Borders | `src/data/territories/<year>.json` | GeoJSON MultiPolygon; may extend over sea — only land tiles paint |
| Cities | `src/data/cities.json` | name, `[lon, lat]`, visible year range, rank |
| Terrain | `scripts/assets/terrain-config.json` | then `npm run generate:tiles` |

Add an event: append an object to the matching era file, run `npm test`.
Add a snapshot: add a row to `snapshots.json` **and** a matching
`territories/<year>.json`; the tests check the pairing.

Coordinates must lie within the map bbox: lon **−12…46**, lat **24…49**.

## Regenerating the terrain

`src/data/tiles.json` is generated — don't edit it by hand:

```bash
node scripts/fetch-coastline.mjs   # one-time: re-download & clip Natural Earth land
npm run generate:tiles             # re-classify terrain from coastline + config
```

## Stack

Vite · React 18 · TypeScript · PixiJS 8 · zustand · zod · Vitest / Testing Library.
Pure static output — deployable to any static host.
