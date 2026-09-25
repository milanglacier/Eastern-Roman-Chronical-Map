# 3D World Pipeline & World Model

The map is a real-time Three.js scene. A heightmap-displaced world is bent over a
curved horizon and flown with a free-look camera. It is lit by the era's moods,
drawn in one of two visual themes, and finished by a custom post pipeline. The
look is defined in `docs/art-direction.md`. This doc records the world model, the
offline bake and the runtime modules.

## Themes

`src/map/three/theme.ts` reads `?theme=`:

| Theme | Default | Camera | Look |
|---|---|---|---|
| `chronicle` | ✔ | free-look drone | living chronicle map: parchment, ink, watercolour, pop-up cities |
| `clockwork` | | orbit rig | Game-of-Thrones-titles model: carved stone, brass gears, clockwork city |

`worldScene.ts` assembles the scene for the active theme. The clockwork theme is
kept for comparison. An earlier **painted diorama** theme was a failed try; the
author did not like its art style, and its code was removed (see the History
section of the art-direction doc).

## World model (single source of truth)

- **Ground plane.** Plate carrée at `4 world units / degree`: lon −12..60 → X 0..288
  (east +), lat 59..24 → Z 0..140 (south +), Y up. Constants and converters:
  `src/map/three/geo.ts`. `src/lib/hex.ts` stays the canonical bbox.
- **UV space.** Every world texture (heightmap, albedo, worldmask,
  territory) shares one UV space over that rect, with **north = V 0**. All textures
  load with `flipY = false`.
- **Heights.** Meters relative to sea level, quantized to uint16
  (`meters = v * 0.25 − 8192`) and stored **split-byte** in an 8-bit RGB PNG
  (R = high byte, G = low byte), because canvas clamps true 16-bit PNGs.
  - Codec: `src/lib/heightEncoding.ts`.
  - The sidecar `heightmap.json` is zod-validated at load (`heightField.ts`).
- **Vertical scale.** `shapedMeters()` (`src/lib/heightShaping.ts`) is the base
  exaggeration, shared by the bake and the runtime: sea 2.5×; land ramps from 2.8×
  to 7×. On top of it each theme sculpts the land with `sculptedY()`
  (`src/lib/clockworkRelief.ts`), a further exaggeration with sharpened peaks. One
  function per theme feeds the mesh, the camera's ground, the marker projection
  and the city seating.
    - The coastal slab edge follows the baked coast distance field (worldmask.R,
      decoded on the CPU by `clockwork/coastField.ts`), so coasts are smooth cut
      edges instead of a pixel staircase along the mesh grid.
    - Profiles: `CHRONICLE_RELIEF` (thin slab, no terraces) and `CLOCKWORK_RELIEF`
      (carved terraces).
- **Curved earth** (`curvature.ts`). Rendered positions drop by `d² / 2R` with ground
  distance from a bend centre.
  - Every world material injects `CURVE_PARS_VERTEX` / `CURVE_PROJECT_VERTEX`
    (`applyCurvature`).
  - The TypeScript twins (`bendY`, `rayHitBentGround`, `occludedByHorizon`) serve
    picking, the DOM marker projection and horizon occlusion.
  - Shadow lookup and the shadow depth pass stay unbent, so casters and receivers
    agree.
  - The chronicle drone bends **convex**, centred under the camera, with the radius
    set by altitude, so there is a true horizon. Clockwork bends **concave** (a bowl).
- **Depth.** A **logarithmic depth buffer**: coastal land is only ~0.0004 units above
  the Y=0 water plane. The post pipeline linearizes it with
  `w = (far + 1)^d − 1` (`src/lib/postfxMath.ts`).

## Offline bake (deterministic, offline, committed outputs)

`npm run world:fetch-dem` (network, run once) → `scripts/fetch-dem.mjs`. It downloads
the AWS Terrarium tiles at zoom 7 into the committed mosaic
`scripts/assets/dem-terrarium-z7.png(.json)`.

`npm run world:build` → `scripts/build-world-textures.mjs`. It is a pure transform of
committed inputs: running it twice gives identical sha256, with all noise seeded via
`src/lib/prng.ts`. Outputs:

1. **heightmap.png** (2880×1400, 40 px/°) plus its sidecar.
   - Conforms to the Natural Earth coastline: ocean ≤ −12 m, land ≥ +4 m.
   - Closes river slits (thin water above sea level in the raw DEM), except within
     10 px of a strait.
   - **Carves the straits** in `terrain-config.json`:
     - Gibraltar, Bonifacio, Messina, Kerch and Öresund.
     - The Dardanelles as a polyline from Kumkale to Gelibolu.
     - The Bosporus as a polyline along its real course.
   - Mops up orphaned water fragments.
   - Incises the meandered rivers by 12 m.
2. **worldmask.png**:
   - **R** is the signed coast distance field (128 = coast, 6 units per px),
     lightly smoothed.
   - **G** is the river mask.
   - **B** is unused (0).
3. **albedo.jpg** (8192×3982): a painted gouache base. The chronicle washes and the
   clockwork regional tint take their colour from it.
   - Hand-tuned palette with soft-banded aridity; regions and corridors are
     feathered and domain-warped.
   - Painted occlusion: ridges warm, hollows cool.
   - No baked sun. The moods move the light.
   - Beach rim and inked coast.
   - Meandered rivers stroked in.
   - Line-integral-convolution brush strokes along a stroke flow field. The field
     follows the contours on slopes, swirls on flats, and runs parallel to the
     coast at sea.
4. **granulation.png** (512², grey): tileable watercolour pigment grain.
5. **waternormal.png** (512²): tileable wave normals.
6. `scripts/assets/dem-preview.png`: a hillshade for eyeballing (not shipped).

## Runtime modules (`src/map/three/`)

**Host**
- **`MapCanvas.tsx`** owns the renderer, the post pipeline, the loop, the era mood
  and the quality tiers. Its DEV handle is `globalThis.__ercmDebug`, with
  `setYear`, `setDrone` / `setPose`, `journeyAt(u)`, `cityRise(t)`, `freezeTime`,
  `setTier` and `frames`. `?intro=0` skips the opening flight.
- **`worldScene.ts`** builds the themed scene and exposes `project()` for the DOM
  overlays and `playJourney()`.

**Cameras**
- **`droneRig.ts`** (chronicle): the free-look drone.
  - Mouse: drag looks around, right- or shift-drag moves over the ground, the wheel
    flies toward the cursor.
  - Touch: one finger looks, two fingers pinch to fly and drag to move.
  - Keys: WASD / QE and the arrows.
  - Guided journeys use `dronePathPose` (eased Catmull-Rom).
- **`cameraRig.ts`** (clockwork): the orbit rig, with free heading and pitch,
  cinematic aim, `flyTo` and `playPath`.

**Scene**
- **`terrain.ts`**: the 1152×560-segment grid (`buildTerrainGeometry` takes a
  meters → Y function), the shared territory uniforms and `buildSkirt`.
- **`chronicle/terrain.ts`**: the chronicle material.
  - Parchment and watercolour washes from the albedo.
  - Ink drawn after lighting: slope hachures at a constant screen spacing, contours
    and the coast.
  - Watercolour rivers.
  - The empire's purple glaze and its purple/gold frontier line.
- **`chronicle/popupCity.ts` + `chronicle/illumination.ts`**: canvas-drawn pop-up
  city cards (pen, wash, hatch, gild). They fold up from a roundel, billboard
  cylindrically and dim at night. `setRise(t)` is a pure function.
- **`clockwork/`**: the stone-and-brass material, hall and astrolabe, and the
  clockwork Constantinople (staged `setRise`).
- **`water.ts`**: the opaque, tessellated sea sheet plus the ocean apron
  (tessellated so the bend reads). It has chronicle (watercolour with coastal
  ripples) and clockwork (lacquer) variants.
- **`sky.ts`**: the sky dome, per theme.
- **`atmosphere.ts`**: distance fog in the mood's haze colour, scaled to the camera
  distance or the drone's altitude.
- **`lights.ts`**: the mood-driven key light and hemisphere fill, with a
  camera-fitted, texel-snapped shadow cascade.
- **`territory.ts`**: snapshot MultiPolygon → land-clipped RG8 mask, with a 550 ms
  crossfade.

**Overlays and post**
- **`projection.ts`**: `projectLonLat` for EventMarkers / CityMarkers; it also
  carries the camera heading for the compass and the DOM → scene events (north-up,
  journey).
- **`postfx/`**: scene → HDR MSAA target.
  - Dual-Kawase bloom.
  - One composite pass: tilt-shift DOF, depth ink edges, neutral tone map, grade,
    paper grain, vignette, letterbox and fade.
  - Quality tiers (`quality.ts`): `?quality=high|medium|low`, plus a frame-time
    probe that steps the tier down.

**Era moods.** `src/data/moods.json` (zod `MoodKeySchema`) holds keyframes for the key
light, sky, haze, exposure, grade, bloom and night. `src/lib/mood.ts`
(`sampleMood`) interpolates them by year in linear colour.

## Regression tests

- `world-assets.test.ts`: sidecar ↔ PNG; straits below sea level; land anchors
  above; texture contracts; granulation tile.
- `worldlib.test.ts`: height codec, EDT, PRNG, height shaping.
- `curvature.test.ts`: the bend, and the exact ray ↔ bent-ground round trip.
- `drone.test.ts`: look clamps, axes, horizon radius, path continuity.
- `three-geo.test.ts`: ground mapping, orbit clamps, flights, framing.
- `clockwork-relief.test.ts`: monotone relief and the smooth slab edge.
- `clockwork-city.test.ts`: rise staging.
- `mood.test.ts`: keyframe coverage, interpolation, azimuth arc.
- `postfx.test.ts`: log-depth linearization, tier ordering, frame probe.
- `territory.test.ts`, `data.test.ts` (including Rule #1) and `components.test.tsx`.
- `hex.test.ts` stays byte-identical.

The WebGL scene is not jsdom-testable. Verify it visually through the dev server and
`__ercmDebug` screenshots.
