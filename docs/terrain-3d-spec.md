# 3D World Pipeline & World Model

The map is a real-time Three.js scene. A heightmap-displaced world is bent over a
curved horizon and flown with a free-look camera. It is lit by the era's moods,
drawn as the living chronicle map, and finished by a custom post pipeline. The
look is defined in `docs/art-direction.md`. This doc records the world model, the
offline bake and the runtime modules.

## Look

There is one look: the living chronicle map (parchment, ink, watercolour, pop-up
cities), flown with the free-look drone. `worldScene.ts` assembles the scene. Two
earlier themes were removed from the code: the **painted diorama** (a failed try;
the author did not like its art style) and the **clockwork** Game-of-Thrones-titles
model with its orbit camera (rejected as "still a 2.5D god-like view"). See the
History section of the art-direction doc.

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
  to 7×. On top of it the land is sculpted with `reliefY()` (`src/lib/relief.ts`),
  a further exaggeration with sharpened peaks standing on a thin coast edge. That
  one function feeds the mesh, the camera's ground and the marker projection.
    - The coast edge follows the baked coast distance field (worldmask.R, decoded
      on the CPU by `coastField.ts`), so coasts are smooth cut edges instead of a
      pixel staircase along the mesh grid.
- **Curved earth** (`curvature.ts`). Rendered positions drop by `d² / 2R` with ground
  distance from a bend centre.
  - Every world material injects `CURVE_PARS_VERTEX` / `CURVE_PROJECT_VERTEX`
    (`applyCurvature`).
  - The TypeScript twins (`bendY`, `rayHitBentGround`, `occludedByHorizon`) serve
    picking, the DOM marker projection and horizon occlusion.
  - Shadow lookup and the shadow depth pass stay unbent, so casters and receivers
    agree.
  - The drone bends the world **convex**, centred under the camera, with the radius
    set by altitude, so there is a true horizon.
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
3. **albedo.jpg** (8192×3982): a painted gouache base. The chronicle washes take
   their colour from it.
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
  `setYear`, `setDrone`, `journeyAt(u)`, `cityRise(t)`, `freezeTime`,
  `setTier` and `frames`. `?intro=0` skips the opening flight.
- **`worldScene.ts`** builds the scene and exposes `project()` for the DOM
  overlays and `playJourney()`.

**Camera**
- **`droneRig.ts`**: the free-look drone.
  - Mouse: drag looks around, right- or shift-drag moves over the ground, the wheel
    flies toward the cursor.
  - Touch: one finger looks, two fingers pinch to fly and drag to move.
  - Keys: WASD / QE and the arrows.
  - Guided journeys use `dronePathPose` (eased Catmull-Rom).

**Scene**
- **`terrain.ts`**: the 1152×560-segment grid (`buildTerrainGeometry` takes a
  meters → Y function), the shared territory uniforms and `buildSkirt`.
- **`chronicle/terrain.ts`**: the chronicle material.
  - Parchment and watercolour washes from the albedo.
  - Ink drawn after lighting: slope hachures at a constant screen spacing, contours
    and the coast.
  - Watercolour rivers.
  - The empire's purple glaze and its purple/gold frontier line.
- **`chronicle/city/` + `chronicle/illumination.ts`**: Constantinople's city view.
  - `cityView.ts` is a second scene with its own sky, light, haze and drone
    (bounded over the plan, ceiling `CITY_EXIT_ALTITUDE`). `worldScene.ts` exposes
    the scene and rig on screen (`scene`, `rig`, `mode`), asks the host to switch
    when the drone flies low toward the city or climbs out of it, and places the
    camera on the other side to continue the flight (`setMode`). `MapCanvas` veils
    the switch with a cloud overlay.
  - `cityPage.ts` builds the city model: two ground layers (the detailed plan, fading
    at its edges, over a coarse outer ground 26 units wide), strips, cards and
    houses.
  - `pageArt.ts` draws both ground layers from the baked plate
    (`public/city/<id>/plate.json` + `land.png`, from `npm run city:build`); past the
    baked land mask the coasts run straight on under the haze.
  - `strips.ts` builds walls, the aqueduct and colonnades as paper strips with
    tower boxes; `cardArt.ts` draws the landmark, ship and house cards.
  - `mosaic.ts` sets drawings in tesserae (Voronoi cells, grout, gold smalti that
    glint with the camera, faded out below a few pixels per tessera). The whole
    ground is set in tesserae; on the cards only the gilding is (art-gate
    setting A; the B and C candidates were removed).
  - The plan's frame (`src/lib/cityFrame.ts`) keeps true proportions at
    `magnification` × the world scale; `src/lib/cityTimeline.ts` resolves the year.
  - `setRise(t)` is a pure function.
- **`water.ts`**: the opaque, tessellated sea sheet plus the ocean apron
  (tessellated so the bend reads): a watercolour wash with coastal ripples.
- **`sky.ts`**: the watercolour sky dome.
- **`environment.ts`**: the PMREM daylight environment for reflections.
- **`coastField.ts`**: the CPU decoder of the baked coast distance field.
- **`atmosphere.ts`**: distance fog in the mood's haze colour, scaled to the drone's
  altitude.
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
- `three-geo.test.ts`: ground mapping and heading deltas.
- `relief.test.ts`: monotone relief and the smooth coast edge.
- `easing.test.ts`: the fold-up overshoot and the flight easing.
- `mood.test.ts`: keyframe coverage, interpolation, azimuth arc.
- `postfx.test.ts`: log-depth linearization, tier ordering, frame probe.
- `territory.test.ts`, `data.test.ts` (including Rule #1) and `components.test.tsx`.
- `hex.test.ts` stays byte-identical.

The WebGL scene is not jsdom-testable. Verify it visually through the dev server and
`__ercmDebug` screenshots.
