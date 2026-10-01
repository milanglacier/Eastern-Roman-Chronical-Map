# Development

Running, architecture and content editing. The controls are in the
[README](../README.md), the look in `art-direction.md`, and the terrain and camera
pipeline in `terrain-3d-spec.md`.

## Running

```bash
npm install
npm run dev        # dev server
npm test           # vitest: data validation + unit + component tests
npm run build      # static production build (dist/)
```

URL options:

- `?quality=high|medium|low` forces a quality tier.
- `?perf` shows a performance overlay (GPU, render size, frame and GPU times,
  stalls); `?perf=bench` also runs a fixed benchmark. Both work on the live site.

```bash
npm run perf                    # the benchmark in headless Chrome, printed as a table
npm run perf -- --headed        # in a visible window, synced to the display
npm run perf -- --out perf.json # also write the JSON result
```

Chrome is found via `$CHROME_PATH` or the usual install locations. See
`terrain-3d-spec.md` (`perf.ts`) and the performance plan in
`.plans/active/render-performance/`.

(Earlier looks, a painted diorama and a Game-of-Thrones-style clockwork model, were
tried and removed. See `art-direction.md`.)

## How it works

- **World:** a Three.js scene (`src/map/three/`) built on a real DEM heightmap,
  sculpted and bent over a curved horizon, and drawn in parchment, ink and
  watercolour. See `terrain-3d-spec.md` for the pipeline and `art-direction.md` for
  the look.
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
