# Eastern Roman Chronicle Map · 东罗马编年地图

An interactive, bilingual (English / 中文) journey through the **Eastern Roman Empire,
AD 330–1453**. The Mediterranean world is a living chronicle map: an illuminated
manuscript you fly through freely. The mountains are sculpted and drawn in ink, the
sea is watercolour, and light and weather change with each era. The empire's borders
shift across 26 snapshots in imperial purple and gold, and 100+ bilingual events sit
where they happened. Fly down into Constantinople and the map gives way to the city
itself, set like a floor mosaic, with its walls, churches and houses standing up
from the page.

## Constantinople

On the continental map, Constantinople is a city like the others. Fly low toward it,
or click its name, and you pass through a veil of cloud into its **city view**. The
peninsula, the Golden Horn, Galata and the Asian shore are laid out at their true
shape as a floor mosaic, after the 6th-century Madaba map. The Theodosian walls,
Hagia Sophia, the Hippodrome, the Great Palace, the columns, the harbours and
thousands of houses stand up from the mosaic as pop-up drawings. The city follows
the timeline: walls rise and fall, and Hagia Sophia is rebuilt. Climb high, or press
**Back to the map**, to return.

| The continental view | The city view |
|---|---|
| ![The continental map in AD 537: Greece, the Aegean and Asia Minor, with Constantinople as a city marker](docs/screenshots/constantinople-1-continental-537.jpg) | ![The city view of Constantinople in AD 537, set as a floor mosaic](docs/screenshots/constantinople-2-city-view-537.jpg) |
| ![The continental map from higher up in AD 537: Italy, Greece, Asia Minor, the Levant and Egypt](docs/screenshots/constantinople-4-mediterranean-537.jpg) | ![Across the Golden Horn from Sykai (Galata) to the sea walls and Hagia Sophia](docs/screenshots/constantinople-3-golden-horn-537.jpg) |

## Running

```bash
npm install
npm run dev        # dev server
npm test           # vitest: data validation + unit + component tests
npm run build      # static production build (dist/)
```

## Flying

| Input | Action |
|---|---|
| drag | look around (360°, down to the ground, up to the sky) |
| right-drag / shift-drag | move over the ground |
| wheel / pinch | fly toward the cursor |
| W A S D · Q E · arrows | move · descend/climb · look |
| N · compass | face north |
| **Fly to Constantinople** | guided flight from the Aegean down into Constantinople's city view |
| fly low toward Constantinople · click its name | enter its city view |
| climb high · **Back to the map** | leave the city view |
| H | hide the interface |

The timeline scrubs or plays through eleven centuries (space toggles, arrows step).
Clicking an event opens its account.

URL options: `?quality=high|medium|low`, `?intro=0` (skip the opening flight),
`?mosaic=b|c` (the heavier and lighter mosaic treatments the city view was chosen
from), and `?theme=clockwork` for the earlier Game-of-Thrones-style clockwork look. (A painted-
diorama look was also tried; the author did not like its art style, and it was
removed. See `docs/art-direction.md`.)

## How it works

- **World:** a Three.js scene (`src/map/three/`) built on a real DEM heightmap,
  sculpted and bent over a curved horizon, and drawn in parchment, ink and
  watercolour. See `docs/terrain-3d-spec.md` for the pipeline and
  `docs/art-direction.md` for the look.
- **The city view:** a separate scene (`src/map/three/chronicle/city/`). The coast
  comes from a z13 elevation crop (`npm run city:build`). The mosaic is a shader
  over canvas drawings, and the landmarks, walls and houses are pop-up cards drawn
  procedurally on a canvas; there are no image assets.
- **Eras:** `src/data/moods.json` sets the light, sky, haze and colour grade per
  year, from dawn in 330 to night in 1453.
- **Territory:** a hand-authored GeoJSON MultiPolygon per snapshot, rasterized to a
  land-clipped mask and drawn as an imperial-purple glaze with a purple-and-gold
  frontier line.
- **UI:** React (header, timeline, event panel, legend, markers) over the canvas;
  zustand for the shared state.

## Editing the content (no code required)

All historical content is data, validated by zod schemas and tests:

| What | Where | Notes |
| --- | --- | --- |
| Events | `src/data/events/era*.json` | bilingual title/summary/detail, category, `[lon, lat]`, importance |
| Era snapshots | `src/data/snapshots.json` | year + bilingual label/note, sorted by year |
| Borders | `src/data/territories/<year>.json` | GeoJSON MultiPolygon; may extend over sea (only land is tinted) |
| Cities | `src/data/cities.json` | name, `[lon, lat]`, visible year range, rank |
| Constantinople's city view | `src/data/cities/constantinople.json` | structures with dated stages, harbours, cisterns, roads, built-up areas, labels, ships |
| Era light | `src/data/moods.json` | per-year sky, light, haze and grade keyframes |
| Terrain | `scripts/assets/terrain-config.json` | straits, rivers, regions; then `npm run world:build` |

To add an event, append an object to the matching era file and run `npm test`. To
add a snapshot, add a row to `snapshots.json` **and** a matching
`territories/<year>.json`; the tests check that they pair up. Coordinates must lie
within the map bbox: lon **−12…60**, lat **24…59**.

## Regenerating the world textures

`public/terrain/*` is baked. Don't edit it by hand:

```bash
npm run world:build       # deterministic, offline (the DEM mosaic is committed); also runs city:build
npm run city:build        # only the city view's coast and hills (public/city/<id>/)
npm run world:fetch-dem   # only if the bbox or zoom changes
```

## Stack

Vite · React 18 · TypeScript · Three.js · zustand · zod · Vitest / Testing Library.
The output is pure static files, deployable to any static host.
