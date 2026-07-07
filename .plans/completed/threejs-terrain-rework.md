# Map Visualization Rework: Three.js 45° God's-Eye Terrain

## Context

The hex-grid + Civ5-tile aesthetic has hit its ceiling despite the polish round
(`.plans/completed/post-art-visual-polish.md`). Decision: abandon the hex grid and the
game-tile look entirely. New target: a **45° god's-eye view over real 3D terrain** —
epic, heavy, Elder-Scrolls-ish atmosphere. Geographic precision is secondary to visual
impact. User-confirmed decisions:

1. **Real-time Three.js** (replaces PixiJS): heightmap-displaced terrain mesh, sun +
   shadow map, hemisphere light, fog, ACES tone mapping, animated water shader.
2. **Real-world DEM** elevation (ETOPO-class incl. bathymetry) — the Alps, Anatolian
   plateau, Taurus and Atlas come out epic for free; stylized, exaggerated 2.5×.
3. **Camera**: fixed north-up heading, pitch eases 55°→40° with zoom, pan + wheel zoom
   only, bounds-clamped (strategy-game feel). Initial center (25°E, 38.5°N).
4. **Territory**: draped warm tint (~18%) that follows relief + glowing gold frontier
   line; keep the 550 ms crossfade on snapshot change. (Reopens the earlier
   "keep territory look" decision — user chose the new style explicitly.)

Data layer is untouched: events/cities/snapshots/territory GeoJSON are all lon/lat and
renderer-agnostic. `src/lib/hex.ts` + `tests/hex.test.ts` stay **byte-identical**
(`schema.ts` imports LON/LAT bounds from hex.ts). Rule #1 naming applies to all new
identifiers/copy/docs.

## Core world model

- **Plate carrée linear mapping, same semantics as `lonLatToWorld`** (`src/lib/hex.ts`):
  lon −12..46 → X 0..232, lat 49..24 → Z 0..100 (**4 world units/degree**; X=east,
  Z=south, Y=up). Every texture (heightmap, albedo, masks, territory) shares this one
  UV space → lon/lat→UV is a two-multiply affine.
- **Heightmap 2320×1000 px = 40 px/degree**, meters relative to sea level.
- **16-bit height encoding via split-byte RGB8 PNG**: R = high byte, G = low byte of
  uint16; `meters = v*scale + offset` from a JSON sidecar. Survives canvas
  `getImageData` exactly (true 16-bit gray PNGs get clamped to 8 bits by canvas).
- **Vertical exaggeration 2.5×** baked into the normal map and applied to mesh Y at
  runtime (documented in sidecar).
- **CPU-decoded `Float32Array` heightfield is the runtime source of truth**: displaces
  mesh vertices on CPU (no vertex-texture-fetch; shadows just work), feeds an R16F
  DataTexture for the water depth tint, and answers `heightAt(lon,lat)` for marker
  projection (no raycasting).

## Phase 1 — Offline DEM + texture bake pipeline

New scripts (deterministic + idempotent, per repo convention; `sharp` already a devDep):

- **`scripts/fetch-dem.mjs`** (network, run once; mirror `fetch-coastline.mjs` style):
  fetch **AWS Terrain Tiles (Terrarium)** `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`
  (AWS Open Data, no key, PNG so sharp-native, includes ETOPO1 bathymetry —
  verified live 2026-07-07). Zoom 7 tiles over bbox + 1° pad (~a few MB). Decode
  `elevation = (R*256 + G + B/256) − 32768`. Composite into one mercator mosaic →
  commit `scripts/assets/dem-terrarium-z7.png` + sidecar JSON (zoom, tile range,
  origin) so the bake step is fully offline, like `coastline-50m.json`. Comment the
  NOAA ETOPO 2022 GeoTIFF URL as fallback source.
- **`scripts/build-world-textures.mjs`** reads the mosaic + `coastline-50m.json` +
  `terrain-config.json`, writes to `public/terrain/` (all committed):
  1. `heightmap.png` (2320×1000 split-byte RGB) + `heightmap.json` sidecar
     `{width,height,bbox,scale,offset,verticalExaggeration}`. Per pixel: lon/lat →
     mercator → bilinear sample → meters. Then **conform to coastline** (rasterize
     Natural Earth land polygons; ocean forced ≤ −12 m, land ≥ +2 m, 1 px feather) so
     the 3D waterline matches the vector coast. Then **carve the six straits** from
     `terrain-config.json` `straits` polylines (stamp water, radius ~1.5 px, −25 m) —
     Bosporus/Messina close at 2.2 km/px otherwise (same failure the hex pipeline hit).
     Optional −4 m micro-incision along river polylines.
  2. `normal.png` (2320×1000, **object-space** normals, exaggeration baked in) — no
     tangents needed; `material.normalMapType = ObjectSpaceNormalMap`.
  3. `albedo.jpg` (4096×1766, q≈88) — stylized painterly color: biome ramp from
     elevation+latitude+slope (deep sea/shelf/shore/lowland green/steppe/rock/snowline),
     overridden by `terrain-config.json` regions + greenCorridors (deserts, Nile);
     multiply a softened hillshade; seeded value noise for mottling (reuse
     `hashStringSeed`/`mulberry32` pattern); **rivers stroked in** from the lon/lat
     `rivers` polylines (feathered banks, widening downstream).
  4. `worldmask.png`: R = signed coast distance field (foam/shallow tint),
     G = feathered river mask, B = 0.
  5. `waternormal.png` (512×512 tileable, seeded FBM) for the water shader.
  6. `scripts/assets/dem-preview.png` hillshade for human eyeballing (not in public/).
- **Shared pure helpers** (scripts import `.ts` directly — established pattern):
  new `src/lib/heightEncoding.ts` (split-byte encode/decode), new
  `src/lib/distanceField.ts` (two-pass EDT). Both unit-tested.
- package.json scripts: add `world:fetch-dem`, `world:build`.

**Verify**: bake ×2 → identical sha256 of all outputs; eyeball `dem-preview.png`;
new `tests/world-assets.test.ts` green (see Phase 6). Old Pixi site still runs.

## Phase 2 — Static lit terrain (runtime skeleton)

Add `three` + `@types/three`; import from three core only (no OrbitControls, **no
EffectComposer** — border glow is shader-emissive; bloom passes are llvmpipe pain for
marginal gain). Renderer: `WebGLRenderer({antialias:true})`, `outputColorSpace =
SRGBColorSpace`, `toneMapping = ACESFilmicToneMapping` (exposure ≈1.1),
`shadowMap.type = PCFSoftShadowMap`.

New `src/map/three/` modules:

- `geo.ts` — pure: `UNITS_PER_DEG=4`, `lonLatToGround`/`groundToLonLat`, world rect,
  UV helpers. Unit-tested round-trip.
- `heightField.ts` — loads heightmap + sidecar, decodes to Float32Array
  (canvas `getImageData` + `heightEncoding`), exposes `heightAt(lon,lat)` (bilinear)
  and `toDataTexture()` (R16F, LinearFilter — filterable in core WebGL2).
  **Fallback**: fetch/decode failure → flat 2×2 zero field + console.warn (scene still
  boots, same philosophy as the old procedural-atlas fallback).
- `terrain.ts` — grid geometry **928×400 segments** (~743k tris; fine on real GPUs,
  llvmpipe FPS explicitly not a target), Y displaced on CPU. Material:
  `MeshStandardMaterial` (map=albedo, normalMap object-space, roughness 1) with
  **`onBeforeCompile`** injections: territory tint after `#include <map_fragment>`
  (sample `uTerritoryA`/`uTerritoryB` RG textures, `mix()` by `uTerritoryMix`, blend
  diffuse toward tint × mask × ~0.18) and gold frontier glow into
  `totalEmissiveRadiance` (SDF-channel falloff × color × subtle pulse). Set
  `customProgramCacheKey`. Standard-material injection buys lights/shadow/fog/tonemap
  for free vs a full ShaderMaterial.
- `lights.ts` — warm DirectionalLight (WSW, ~2.5, shadow.mapSize 2048, tuned bias) +
  HemisphereLight. `updateShadowFrustum(view)`: unproject the 4 screen corners to Y=0,
  fit the ortho shadow camera to that footprint + margin, **snap to shadow-texel grid**
  (kills swimming) — one camera-following cascade, no CSM.
- `atmosphere.ts` — `scene.fog` with near/far scaled to camera distance (haze swallows
  the far edge at 45°), background matched.
- `palette.ts` — biome/atmosphere color constants (shared with Legend).
- `cameraRig.ts` — `{targetX, targetZ, distance}`, fixed azimuth; pitch eases 55°→40°
  max→min distance. Pan = drag via ray∩(Y=0) so ground sticks to cursor; wheel zoom
  keeps the ground point under the cursor fixed (same UX as today); target clamped to
  bbox with distance-dependent margin. Clamp/ease math exported as pure functions for
  tests. On change: update projector + `bumpView()`.
- `projection.ts` — module-registered projector: `projectLonLat(lon,lat) →
  {x,y,visible}` = terrain-surface point (`heightAt` for Y) through `camera.project` →
  CSS px. Null projector (unmounted/tests) → `visible:false`.
- **`src/map/MapCanvas.tsx` rewrite** — same StrictMode discipline as today
  (`disposed` flag; dev global `globalThis.__ercmDebug = {renderer, scene}` assigned
  **after** the disposed check); `Promise.all` asset loading; ResizeObserver; rAF loop
  with `Clock` driving water time, glow pulse, crossfade, shadow refits; full disposal
  on unmount (geometry/material/texture/renderer `.dispose()`).

**Store change** (`src/state/store.ts`): replace `camera:{x,y,scale}` + `setCamera`
with `viewVersion: number` + `bumpView()` — the projection function lives in
`projection.ts`, not the store. **`EventMarkers.tsx`**: subscribe to `viewVersion`,
replace `lonLatToIso` + camera math (lines 28–34) with `projectLonLat`; keep fan-out
logic; skip `visible:false`.

**Verify**: dev server + `agent-browser-wrapped` screenshots at 3 zoom levels —
recognizable Anatolia/Balkans/Italy relief, shadows, fog; event markers stick to
terrain during pan/zoom; no StrictMode double-canvas.

## Phase 3 — Water + atmosphere polish

`water.ts`: one plane at Y=0 over the world rect, custom ShaderMaterial (transparent,
drawn after terrain): two scrolling samples of `waternormal.png`, fresnel-ish
deep→sky tint, depth tint from the R16F heightfield texture, shore foam band +
shallow lightening from `worldmask.R`. Optional river glint from `worldmask.G` in the
terrain shader. Tune fog/exposure/sun.

**Verify**: screenshots of Aegean coasts (foam hugging islands); Bosporus, Messina,
Gibraltar visibly open water.

## Phase 4 — Territory drape + crossfade

`territory.ts`: per snapshot year (lazy, cached — 26 × ~0.9 MB ≈ 23 MB max):
rasterize the MultiPolygon into an offscreen canvas at 1024×442 (lon/lat→UV affine,
even-odd fill for holes), read back, run shared EDT → **RG8 DataTexture** (R =
antialiased inside mask, G = distance-to-border normalized over ~24 px). Crossfade:
set `uTerritoryB`, animate `uTerritoryMix` 0→1 over **550 ms** in the rAF loop,
promote B→A. Colors from `src/map/colors.ts` `TERRITORY_*` (now shader uniforms —
retune the hue for the new "warm imperial tint" look). Pure ring-conversion helpers
exported for jsdom-safe unit tests.

**Verify**: screenshots at year 555 (greatest extent) vs 1400 (rump state); scrub the
timeline in-browser → smooth fade; frontier glow hugs ridgelines.

## Phase 5 — Cities, legend, UI reintegration

- **`src/map/CityMarkers.tsx` (new)**: cities move from Pixi Graphics/Text to a DOM
  overlay sibling of EventMarkers — crisp bilingual labels (Cinzel/serif), rank-1 vs
  rank-2 CSS styling, positioned via `projectLonLat`, filtered by `visibleCities(year)`
  (kept as pure helper in `src/map/cities.ts`). Accepted trade-off: DOM markers don't
  depth-test against terrain — negligible at 40–55° pitch.
- **`src/ui/Legend.tsx`**: drop hex `TERRAIN_COLORS`; new terrain section from
  `palette.ts` (sea, lowlands, steppe/desert, highlands, snow) reusing existing
  `terrainSea/terrainGrass/…` i18n keys; add `terrainSnow` (en + zh).
- `src/map/colors.ts`: keep `CATEGORY_COLORS` + `TERRITORY_*`; delete Pixi/terrain-code
  entries.

**Verify**: screenshots in both languages; event-marker click still opens the panel;
component tests green.

## Phase 6 — Cleanup, tests, docs

**Delete**: `src/map/iso.ts`, `src/map/camera.ts`, all of `src/map/renderer/`,
`tests/atlas.test.ts`, `tests/transitions.test.ts`, `pixi.js` dep,
`public/terrain/{atlas.png,atlas.json,ocean.png,macro-tint.png,contact-sheet.png}`,
`scripts/process-terrain-art.mjs`, `scripts/generate-tiles.mjs`, `src/data/tiles.json`,
`docs/terrain-art-spec.md`; package.json scripts `generate:tiles`/`art:process`.
`scripts/fetch-coastline.mjs` + `terrain-config.json` **stay** (they feed the bake).

**Keep byte-identical**: `src/lib/hex.ts`, `tests/hex.test.ts`.

**Schema/data**: remove `TilesFileSchema`/`TerrainCode` from `src/data/schema.ts` and
the tiles import from `src/data/index.ts`; add a zod schema for the heightmap sidecar
(beside `heightField.ts`).

**Tests**:
- `tests/data.test.ts`: remove the three tile-grid tests (grid constants, river tile
  adjacency, strait tiles); Rule #1 scan + event/snapshot/city/territory tests stay.
- New `tests/world-assets.test.ts` (node, uses sharp): sidecar validates + matches PNG
  dims; **six straits stay water** (decode strait-coordinate pixels via
  `heightEncoding`, assert meters < 0) + land anchors (Rome, Ankara) > 0 — direct
  successor to the old strait regression.
- New unit tests: `heightEncoding` round-trip, `distanceField` on toy grids, `geo.ts`
  round-trip, `cameraRig` clamp/pitch-ease pure functions, territory ring conversion
  (skip canvas rasterization in jsdom — 2D context is a stub there).
- Update `tests/components.test.tsx` + `tests/store.test.ts` for the
  `viewVersion` store change.

**Docs**: rewrite CLAUDE.md "Project Shape" bullet (PixiJS→Three.js; tiles.json line →
heightmap pipeline) + Commands; write `docs/terrain-3d-spec.md` (pipeline, encodings,
world model). Move this plan file into `.plans/` flow per repo convention
(`.plans/active/` during work → `completed/` at the end). Update auto-memory (layer
stack, gotchas that no longer apply, new pipeline).

**Final verify**: `npm test` green; `npm run build` (pixi gone from bundle);
screenshot pass at min/mid/max zoom over Aegean + Italy + Levant;
`grep -ri byzant src/ docs/ scripts/` clean (Rule #1); bake idempotency ×2.

## Risks & mitigations

- **DEM source**: Terrarium S3 verified live 2026-07-07; committed mosaic makes the
  bake permanently offline; ETOPO 2022 URL documented as fallback.
- **16-bit precision on the web**: split-byte RGB8 + CPU decode, unit-tested — never
  rely on canvas decoding true 16-bit PNGs.
- **Straits closing at ~2.2 km/px**: explicit carve pass + pixel-level regression test
  (project has been burned here before).
- **Shadow quality over a 232×100 world**: camera-fitted texel-snapped single cascade;
  if edges shimmer, enlarge the fixed frustum before considering CSM.
- **llvmpipe**: screenshots verify correctness/composition only, never perf; optional
  `?lowres` dev query param (halved segments) if headless iteration is painful.
- **StrictMode double-mount**: `disposed`-flag pattern that already fixed this in the
  Pixi MapCanvas, plus full three.js disposal.
