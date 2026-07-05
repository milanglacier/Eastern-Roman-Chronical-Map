# Eastern Roman Empire Chronicle Map Visualization

## Context

Greenfield project (empty repository). Goal: an interactive historical visualization website that presents the territorial changes of the Eastern Roman Empire (330–1453) on a Civilization V–style 45° isometric hex-tile map, paired with clickable major-event widgets (categories: politics, military, economy, culture, art, law, civilization), a draggable + auto-playing timeline, Chinese–English bilingual support, and a purple-themed UI in the Eastern Roman artistic style (byzantine artistic style).

**Rule #1 of the project: Never refer to the state as "Byzantium / Byzantine Empire" — always "Eastern Roman Empire / Rome."** (The artistic style may be described as "byzantine art style," but in all UI copy, data content, and code naming the state must be the Eastern Roman Empire.) This convention is recorded in the project `CLAUDE.md`.

Confirmed decisions:
- Map: PixiJS procedural isometric hex-tile map (Civilization V–style)
- Content scale: ~25 territorial snapshots, ~100 bilingual major events (content written by Claude)
- Tech stack: React + TypeScript + Vite, pure static site; Vitest for testing
- All event content lives as data assets (JSON config), never hard-coded

## Technical Architecture

```
React (UI layer: timeline / detail panel / language toggle)
  ├─ zustand store (currentYear, isPlaying, selectedEvent, language, camera)
  ├─ PixiJS v8 map layer (terrain tiles, territory coloring, city icons) — mounted on a <canvas>
  └─ DOM overlay event widget layer (absolute positioning, synced with camera transforms) — easier styling & testing
Data assets (src/data/*.json, zod validation)
Build scripts (scripts/) — generate tile assets from geographic data
```

Dependencies: `react` `react-dom` `pixi.js@^8` `zustand` `zod`; dev: `vite` `vitest` `@testing-library/react` `jsdom` `typescript` `eslint`. Fonts: `@fontsource/cinzel` (Latin display face) + system Chinese serif fallback (optionally `@fontsource-variable/noto-serif-sc`, mind the bundle size).

## Directory Structure

```
CLAUDE.md                      # Project conventions (Rule #1: no "Byzantium")
scripts/
  generate-tiles.mjs           # Build-time hex tile terrain asset generation
  assets/coastline-110m.json   # Simplified coastline GeoJSON (Natural Earth 110m clipped to map extent)
  assets/terrain-config.json   # Manual config: mountain polylines (Taurus/Pontic/Balkans/Alps/Atlas/Zagros/Caucasus/Pindus/Apennines), desert regions, major rivers (Danube/Nile/Euphrates, decorative)
src/
  main.tsx / App.tsx
  lib/hex.ts                   # Axial coords ↔ pixels, isometric projection (y-squash 0.5 + elevation offset), lat/lng ↔ tile
  lib/geo.ts                   # point-in-polygon, GeoJSON utilities
  data/schema.ts               # zod: EventSchema / SnapshotSchema / TilesSchema
  data/tiles.json              # Generated tile asset (committed to repo)
  data/snapshots.json          # 25 snapshot metadata: {id, year, label:{en,zh}, note:{en,zh}}
  data/territories/<year>.json # One GeoJSON MultiPolygon per snapshot (hand-drawn approximate historical borders, lat/lng)
  data/events.json             # ~100 events (see schema)
  data/cities.json             # Major cities: {id, name:{en,zh}, lonlat, eras[]} — Constantinople/Thessaloniki/Antioch/Alexandria/Ravenna/Rome/Carthage/Nicaea/Trebizond/Mystras…
  map/MapCanvas.tsx            # Pixi init + React bridge
  map/renderer/terrain.ts      # Tile rendering: sea (deep/shallow) / plains / grassland / hills / mountains / desert; hills & mountains with extruded height
  map/renderer/territory.ts    # Territory layer: snapshot polygon → tile set (runtime rasterize + memoize), purple tint + stroke, crossfade on snapshot switch
  map/renderer/cities.ts       # City icons (procedurally drawn small buildings/wall outlines, special icon for Constantinople)
  map/camera.ts                # Drag pan, scroll zoom, boundary clamping
  map/EventMarkers.tsx         # DOM overlay: current-era event widgets, category-colored badge icons
  state/store.ts               # zustand
  i18n/index.ts                # useT() hook + UI string dictionary {en, zh}
  ui/Timeline.tsx              # Bottom timeline: 330–1453 scale, snapshot nodes, drag scrubber, play/pause, year display (with bilingual era notation)
  ui/EventPanel.tsx            # Detail panel shown on widget click (parchment/mosaic style)
  ui/Legend.tsx  ui/Header.tsx ui/LanguageToggle.tsx
  styles/theme.css             # Purple & gold theme
tests/ (or co-located *.test.ts(x))
```

## Key Design Decisions

### 1. Tile Map Generation (not hand-authoring 4,000 tiles)
`scripts/generate-tiles.mjs`: Map extent roughly lon [-12, 46] × lat [24, 49] (covers Justinian's maximum extent including North Africa, Italy, southern Spain). Hex grid roughly 90×55 ≈ 4,500 tiles. For each tile center: inside coastline polygon → land, otherwise sea (far offshore → deep sea); within mountain polyline buffer → mountain/hill; within desert region → desert; remainder classified as grassland/plain by latitude. Output `src/data/tiles.json` (axial coords + terrain type, committed to repo, zero geographic computation at runtime). Script is re-runnable; terrain-config can be hand-tuned.

### 2. Isometric Rendering (lib/hex.ts + renderer)
Pointy-top hexagons, screen Y = world Y × 0.55 to achieve a 45° overhead feel; hill/mountain tiles are shifted upward with drawn side prisms + snowcap triangles; ocean tiles get ripple accents, creating a Civ V–style sense of depth. All rendered procedurally with Pixi Graphics (no external texture assets). Terrain tiles are drawn into a static container (drawn once); territory / cities / highlights each have their own independent layers.

### 3. Territorial Snapshots
Snapshot = hand-drawn GeoJSON polygon (approximate historical borders). At runtime, `territoryTiles(snapshot)`: all land tile centers → point-in-polygon → Set<tileId>, memoized. Coloring: Imperial Purple (#6B2FA0 family) semi-transparent overlay + gold stroke on boundary tiles (Civ-style border feel). Roughly 25 snapshot years (approximate): 330, 395, 450, 527, 555 (Justinian's zenith), 565, 602, 626, 650, 717, 780, 843, 867, 925, 976, 1025 (Basil II's zenith), 1071 (post-Manzikert), 1081, 1143, 1180, 1204 (Empire shattered / Nicaea), 1261 (Constantinople recovered), 1300, 1350, 1400, 1453 — subject to minor adjustment while authoring data.

### 4. Event Data (config, not hard-coded — direction confirmed by user)
```jsonc
{
  "id": "founding-constantinople",
  "year": 330,
  "category": "politics",  // politics|military|economy|culture|art|law|religion|civilization
  "lonlat": [28.98, 41.01],
  "importance": 1,          // 1 major / 2 notable
  "title":   {"en": "...", "zh": "..."},
  "summary": {"en": "...", "zh": "..."},   // widget hover / panel opening paragraph
  "detail":  {"en": "...", "zh": "..."}    // detail panel body, 2–3 paragraphs
}
```
Display rules: events whose year falls within the current snapshot's interval `[snapshot.year, next.year)` are shown as widgets on the map. Categories are distinguished by badge color/icon (military = sword red, law = scroll gold, art = mosaic cyan… all harmonious within the purple-gold theme). ~100 events covering all categories: Edict of Milan aftermath, founding of Constantinople, Theodosius, Codex Justinianus, Hagia Sophia, Heraclius & the True Cross, Greek Fire, Iconoclasm, the Farmer's Law, Cyrillic alphabet, Macedonian Renaissance, Basil II, the Great Schism of 1054, Manzikert, the Pronoia system, Komnenian restoration, 1204 Fourth Crusade, Nicaean exile, 1261 recovery, Palaiologan Renaissance, Hesychast controversy, 1341 civil war, 1453 fall, etc.

### 5. Timeline + Auto-play
- Bottom timeline: linear scale 330–1453, snapshot years as nodes, scrubber draggable / click-to-jump.
- Play/pause button: auto-play advances snapshots at a fixed cadence (~4s per snapshot, driven by `isPlaying` in the store + rAF/interval driver).
- **Clicking any event widget → `pause()` + open EventPanel** (user explicitly requested). Closing the panel does not auto-resume play (user resumes manually).
- Year display updates during playback; territory crossfades on snapshot transitions.

### 6. Bilingual
`language: 'en' | 'zh'` stored in zustand (persisted to localStorage). UI strings use an i18n dictionary; data content reads directly from `field[language]`. Language toggle button in Header. Year display: `AD 555 / 公元555年`.

### 7. Theme (Eastern Roman Artistic Style)
- Primary: Imperial Purple `#3D1A5B`(dark bg) / `#6B2FA0`(territory) / Tyrian Purple accent `#66023C`
- Secondary: Mosaic Gold `#C9A227`, Parchment `#F0E6D2`, Deep Sea Blue
- Header/Panels: gold mosaic tessera borders (CSS repeating-gradient), Chi-Rho / double-headed eagle SVG decorations (hand-drawn inline SVG)
- Fonts: Cinzel (Latin headings), Chinese serif (Song/Ming system fallback)
- Follow the dataviz skill to verify category color contrast ratios (load that skill during implementation)

## Testing (Vitest)

1. **Data validation tests** (most important — safeguard config asset quality): all events/snapshots/cities/territories pass zod schemas; year ∈ [330,1453]; coordinates within map extent; both en & zh non-empty; event IDs unique; every snapshot has a corresponding territory file; snapshot years strictly increasing.
2. **Lib unit tests**: hex coordinate conversion round-trip, lonlat→tile, point-in-polygon edge cases.
3. **Logic unit tests**: `snapshotForYear()` bounds (clamp before 330, at 1453, between snapshots); play driver advancing/pausing; event filtering (era interval attribution).
4. **Component tests** (Testing Library + jsdom): Timeline drag/click changes year; play button toggles state; clicking an event widget → auto-play stops + panel opens; text changes after language switch.
5. **Script tests**: generate-tiles produces expected terrain classifications on a small fixture.
Pixi rendering layer is not tested under jsdom (canvas environment limitations); covered by end-to-end manual / browser verification.

## Implementation Sequence

1. Scaffolding: Vite+React+TS, Vitest, eslint, CLAUDE.md (with naming convention), directory skeleton
2. `lib/hex.ts` + `generate-tiles.mjs` (including fetching/clipping Natural Earth coastline, authoring terrain-config) → `tiles.json`
3. Pixi map: terrain rendering + camera (drag/zoom)
4. Data schemas + `snapshots.json` + 25 territory GeoJSONs (first major content effort) + territory rendering layer + city layer
5. `events.json` ~100 bilingual events (second major content effort, batched by category and era)
6. EventMarkers overlay + EventPanel + click-to-pause linkage
7. Timeline + auto-play + language toggle
8. Theme polish (purple-gold mosaic style), legend, responsive layout
9. Test completion, README (including data contribution guide for adding new events/snapshots)

Content authoring is substantial (100 events × bilingual + 25 border polygons). Steps 4/5 can use parallel sub-agents to batch-produce data files by era, with schema tests providing a unified quality gate.

## Verification

- `npm test`: all data validation + unit + component tests pass
- `npm run build`: static build succeeds
- `npm run dev` + `agent-browser-wrapped` browser manual check: screenshots to verify map rendering (isometric terrain, purple territory); drag timeline to observe territory changes (key points: 330→555→1025→1204→1453); click auto-play then click an event widget to verify pause + panel; toggle Chinese/English to check bilingual; verify no occurrence of "Byzantium / Byzantine" as a state name anywhere on the site (grep data files as a gate, add assertions in tests)
