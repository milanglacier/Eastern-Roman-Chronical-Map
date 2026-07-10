# 3D Terrain Pipeline & World Model

The map is a real-time Three.js scene: a heightmap-displaced terrain mesh under a
fixed-heading 45° strategy camera, lit by a WSW sun with a camera-following shadow
cascade, wrapped in distance fog, with an animated water plane and a draped imperial
territory tint. This doc records the world model and the offline bake that feeds it.

## World model (single source of truth)

- **Ground plane**: plate carrée, `4 world units / degree` (same linear semantics as
  the retired hex grid's `lonLatToWorld`). lon −12..60 → X 0..288 (east+), lat 59..24 →
  Z 0..140 (south+), Y up. Constants + converters: `src/map/three/geo.ts`.
- **UV space**: every world texture (heightmap, normal, albedo, worldmask, territory)
  shares one UV space over that rect, **north = V 0**; all textures are loaded with
  `flipY = false`. lon/lat → UV is a two-multiply affine.
- **Heights**: meters relative to sea level, quantized to uint16
  (`meters = v * 0.25 − 8192`, sea level = 32768) and stored **split-byte** in an
  8-bit RGB PNG: R = high byte, G = low byte. Canvas `getImageData` cannot decode a
  true 16-bit gray PNG (clamps to 8 bits); split-byte survives exactly. Codec:
  `src/lib/heightEncoding.ts`; sidecar `public/terrain/heightmap.json` documents all
  parameters and is zod-validated at load (`src/map/three/heightField.ts`).
- **Vertical scale**: `Y_units = shapedMeters(meters) / metersPerWorldUnit` where
  `shapedMeters` (`src/lib/heightShaping.ts`, shared by bake and runtime) applies an
  **elevation-dependent exaggeration**: 2.5× below sea level (bathymetry/depth tint
  unchanged), ramping on land from 2.8× at sea level to 7× above 1500 m. A flat factor
  either leaves mountains reading as painted texture or tilts every coastal plain;
  the ramp keeps plains calm while hills and ranges rise into real silhouettes. The
  runtime decodes the PNG once into a `Float32Array` and uses it for CPU vertex
  displacement, `heightAt(lon,lat)` marker projection, and an R16F depth-tint texture
  for the water shader — no vertex-texture-fetch, no raycasts.
- **Depth**: the renderer uses a **logarithmic depth buffer** — true-scale heights are
  so small next to the 288-unit world that linear depth would z-fight the water plane
  (Y=0) against coastal land (clamped to ≥ +4 m ≈ 0.00036 units).

## Offline bake (deterministic, offline, committed outputs)

`npm run world:fetch-dem` (network, run once) → `scripts/fetch-dem.mjs`:
- Downloads AWS Terrain Tiles (Terrarium PNG, `s3://elevation-tiles-prod`, no key,
  GMTED2010 land + ETOPO1 bathymetry) at zoom 7 over the bbox + 1° pad and composites
  them into the committed mercator mosaic `scripts/assets/dem-terrarium-z7.png(.json)`.
  Fallback source (different decode path needed): NOAA ETOPO 2022 60″ GeoTIFF.

`npm run world:build` → `scripts/build-world-textures.mjs` (pure transform of committed
inputs; run twice → identical sha256):
1. **heightmap.png** 2880×1400 (40 px/°) + sidecar. Bilinear-samples the mosaic
   (Terrarium decode first, then blend), **conforms to the Natural Earth coastline**
   (ocean ≤ −12 m, land ≥ +4 m) so the waterline matches the vector coast, **closes
   river slits** (Natural Earth slits big rivers like the Po into its land polygons;
   at 2.2 km/px they become 1-px ocean canals across whole valleys — thin water that
   is above sea level in the raw DEM is reclassified as land, except within 10 px of
   a configured strait), **carves the seven straits** from `terrain-config.json`
   (Gibraltar, Bonifacio, Messina, Dardanelles, Bosporus, Kerch, Öresund — they
   close at 2.2 km/px otherwise; the old tile pipeline had the same failure mode;
   Dover and Hormuz are wide enough to survive sampling and are only pinned by the
   regression tests), mops up
   small orphaned water fragments (components ≥ 500 px or containing carved strait
   pixels always stay water), and incises river valleys (12 m) along the meandered
   courses below.
2. **normal.png** — object-space normals computed from the **shaped** heights
   (`shapedMeters`), gradients taken in world units so shading matches the rendered
   mesh exactly (`material.normalMapType = ObjectSpaceNormalMap`, no tangents needed).
3. **albedo.jpg** 8192×3982 — stylized painterly color: biome ramp from
   elevation/latitude/slope, `terrain-config.json` region + green-corridor overrides
   with **domain-warped lookups** (no straight polygon borders), baked hillshade
   (computed on shaped heights, gradient-boosted 2× as a soft painterly base under
   the real-time sun), seeded value-noise mottling. Rivers are **meandered
   deterministically** (sparse hand-drawn polylines resampled to 0.04° and displaced
   perpendicular by seeded noise, endpoints anchored) and stroked as a soft riparian
   green band under a narrower water core widening downstream; the same meandered
   courses feed the heightmap incision and the worldmask river channel.
4. **worldmask.png** — R: signed coast distance field (128 = coastline, 6 units/px);
   G: feathered river mask; B: reserved.
5. **waternormal.png** — 512² tileable FBM wave normals (also reused by the terrain
   shader as high-frequency detail grain at close zoom).
6. `scripts/assets/dem-preview.png` — hillshade for human eyeballing (not shipped).

All noise is seeded via `src/lib/prng.ts` (`hashStringSeed` + `mulberry32`); the EDT
lives in `src/lib/distanceField.ts`. Both are unit-tested and shared with the runtime.

## Runtime modules (`src/map/three/`)

- `geo.ts` — ground↔lon/lat↔UV (pure).
- `heightField.ts` — PNG → Float32Array; flat 2×2 fallback if assets are missing
  (scene must boot regardless — same philosophy as the old procedural atlas).
- `terrain.ts` — 1152×560-segment mesh, CPU-displaced; `MeshStandardMaterial` with
  `onBeforeCompile` injections for the imperial-purple territory fill (#6B2FA0 mixed
  into the diffuse pre-lighting) + crisp gold frontier line with faint halo (the line
  is thresholded per crossfade slot so it stays sharp mid-fade) + detail grain
  + **river water** (worldmask.G: counter-scrolling ripple tint, lowered roughness in
  the channel core for a sun glint, drifting sparkle crests — sample the wave normal
  map's R/G for shimmer, never B, which is normal-Z ≈ 1 and just brightens);
  `buildSkirt()` adds the dark diorama edge wall around the world rect.
- `water.ts` — one plane at Y=0, custom ShaderMaterial (scrolling wave normals,
  depth tint from the R16F heightfield, fresnel, sun glint, shore foam from
  worldmask.R). Includes logdepth + fog + tonemapping chunks so it composits
  correctly with the standard-material terrain. Alpha fades out over land (coast
  SDF > ~1 px): the coarse mesh dips below Y=0 between low delta/lagoon pixels and
  the sheet would otherwise bleed inland in quad-sized blocks. `createOceanApron()`
  adds an opaque open-ocean ring 500 units past the world rect (vertex-exact seam,
  world-position UVs so the waves are phase-continuous, no height/mask sampling —
  border texels are land on the south/east edges) so max zoom-out shows sea, not
  bare background.
- `lights.ts` — warm sun + hemisphere fill; the sun shares the baked hillshade's
  azimuth but sits lower (34° vs 48°) so it rakes the shaped relief with long cast
  shadows. `updateShadowFrustum` fits one ortho cascade to the visible ground
  footprint per view change, radius-quantized and texel-snapped so shadows neither
  swim nor blur out at any zoom.
- `atmosphere.ts` — fog scaled to camera distance; swallows the far world edge.
- `cameraRig.ts` — fixed north-up heading; pitch eases 55°→40° with zoom; drag-pan
  keeps the grabbed ground point under the cursor; wheel zooms toward the cursor.
  Pure math exported for tests.
- `territory.ts` — snapshot MultiPolygon → offscreen-canvas raster → land clip →
  EDT → RG8 texture (R = inside mask **clipped to land**, G = frontier glow);
  550 ms crossfade via `uTerritoryMix`. The clip samples the runtime heightfield
  (height > 0 ⇔ land — the bake floors land and river incisions at +4 m and carves
  sea/straits below 0), because snapshot polygons are drawn loosely over open sea;
  it also makes the frontier trace coastlines. All-sea land mask (flat fallback
  heightfield) disables the clip so territory never vanishes.
- `projection.ts` — `projectLonLat` for the DOM overlays (EventMarkers, CityMarkers);
  plate-carrée fallback before the scene mounts / in jsdom.

The camera publishes view changes as a `viewVersion` counter in the zustand store;
DOM overlays subscribe and re-project. `MapCanvas.tsx` owns lifecycle (StrictMode
`disposed`-flag discipline, full three.js disposal on unmount,
`globalThis.__ercmDebug` dev handle).

## Regression tests

- `tests/world-assets.test.ts` — sidecar ↔ PNG agreement; **straits below sea
  level** (the seven carved ones plus Dover and Hormuz) and land anchors above
  (successor to the old tile strait test); texture dimension/aspect contracts.
- `tests/worldlib.test.ts` — height codec round-trip, exact EDT, PRNG determinism,
  height-shaping monotonicity/sign preservation (strait regressions depend on it).
- `tests/three-geo.test.ts` — ground mapping round-trip, camera pitch/clamp math.
- `tests/territory.test.ts` — polygon → texture-space ring conversion (pure part).
- `tests/hex.test.ts` — byte-identical guarantee; `src/lib/hex.ts` stays as the
  canonical bbox/mapping definition (schema validation still uses its bounds).
