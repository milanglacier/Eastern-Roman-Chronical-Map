# Painted Diorama — a cinematic journey through the Roman East (v2)

> **Status: superseded (2026-09-24).** Phases 0–2 were built: the render pipeline,
> era moods, curved-earth camera, painted bake and cinematic UI. The user rejected
> the look at the Phase 1 art gate: "it now has the painted art style, but still as
> a map". Parts still live in the code: the post pipeline, moods, curvature, UI
> chrome and bake. The look itself is reachable with `?theme=painted`. Screenshots
> are in `docs/screenshots/archive/painted-*.jpg`. It was followed by
> `clockwork-world-prototype`, then `.plans/active/chronicle-map-prototype`.

## Context

The current map (master, 6f23245) reads as "a rough strategy game": 45° north-up
2.5D view, procedural biome albedo multiplied by a baked hillshade, flat imperial-purple
territory fill with a glowing gold border, heavy purple/gold UI frames, pin markers.
The user wants a *visually stunning, cinematic, artistic (not realistic)* journey across
a thousand years: landforms, mountains, rivers and culture; a true-3D camera; important
cities (Constantinople first) you can dive into at magnified scale; and the world changing
with time, e.g. war scenes such as the 1453 Ottoman army before the land walls.

Two earlier attempts exist on other branches. `feat/…grand-constantinople` (09-07) came
out with a blocky low-poly city and a siege camp. `…-claude-opus-5-5-v1` (today) used a
NASA satellite albedo with tiny red-roof houses. Both still read as realistic or toy-like.

**Decisions (user, this session):**
- Fresh **v2 from master**, on branch `feat/3d-realistic-rendering-and-grand-constantinople-claude-opus-5-5-v2`.
- Art direction **"Painted diorama"**: an oil/gouache look with a hand-tuned palette, a painterly Kuwahara filter, golden-hour light, aerial haze and tilt-shift. Cities are warm glowing miniatures, in the manner of a concept-art matte painting.
- Assets are **code-first + CC0**. Geometry and shaders are procedural. Quaternius CC0 glTF is used only where a silhouette needs it, restyled to the painted palette. No image generation in the runtime path.
- Milestone 1 covers four things:
  - the painted world
  - a true-3D camera with curved-earth horizon
  - a Constantinople lens across all eras
  - the 1453 siege as the first battle scene, plus a reusable battle framework and a cheap generic battle vignette for other military events

**Feasibility:** all three ideas are feasible on the existing stack (three 0.185, React,
zustand, static Vite build), with no new runtime dependencies. The post chain uses
`three/addons` (EffectComposer, UnrealBloomPass, OutputPass, GLTFLoader) plus custom
shaders. Known references back each technique: anisotropic Kuwahara painterly
post-processing, instanced vertex-animated crowds, and vertex-bent "curved world"
horizons. The main risk is aesthetic, not technical, hence a sign-off gate after Phase 1.

**Style-agnostic data reused from v1** (via `git checkout <v1> -- <paths>`, then audited):
- `scripts/assets/city/constantinople-dem.{png,json}`: Terrarium z13 crop, bbox 28.80–29.14E / 40.95–41.13N
- `scripts/assets/city/constantinople.json`: bake config
- `src/data/cities/constantinople.json`: urban rings, density keyframes, landmark lon/lat, captions

Only the data is reused, not its rendering code.

First implementation step: branch, then write this plan to
`.plans/active/painted-diorama-journey/plan.md` (project convention), and write
`docs/art-direction.md`, which covers palette swatches, rules (no satellite colour, no
saturated red roofs, low saturation plus atmospheric perspective) and reference notes.

---

## Phase 0: Render pipeline, quality tiers, era mood

**New files**
- `src/map/three/renderPipeline.ts`: EffectComposer on a HalfFloat MSAA target with a DepthTexture. OutputPass does the tone mapping, and the renderer uses `antialias:false`.
- `src/map/three/quality.ts`: picks tier `high|medium|low` from capabilities and a mobile check. A 90-frame probe steps down one tier. `?quality=` forces a tier and `?paint=0` gives an A/B.
- `src/lib/mood.ts`: pure `sampleMood(year)` (linear-space colour lerp, shortest-arc azimuth, smoothstep, hold keys).
- `src/data/moods.json`, with a `MoodKeySchema` in schema.ts: sun {az, alt, colour, intensity}, moon?, sky {zenith, horizon, glow}, fog, exposure, grade {lift, gamma, gain, sat, split tones}, bloom, emissiveBoost, weather, optional bilingual caption.

**Modified files**
- `MapCanvas.tsx`: split into a host (renderer, composer, loop, active-scene switch) and `worldScene.ts`.
- `lights.ts`: sun direction becomes mutable and rebuilds the shadow basis. When sun altitude drops below 0, a moon key light takes over.
- `water.ts`: `uSunDir` and the sky tint come from the mood.

**Keyframes** (story arc):

| Year | Mood |
|---|---|
| 330 | Rose dawn |
| 537 | Golden, warm |
| 626 | Storm grey-green |
| 843 | Cool clear morning |
| 1025 | Bright gold |
| 1071 | Overcast |
| 1204 | Crimson dusk + smoke haze |
| 1261 | Pale dawn |
| 1400 | Muted autumn |
| 1453 | Moonlit night with fires |

## Phase 1: The painted world (bake + runtime)

### Bake (`scripts/build-world-textures.mjs`, palette block in `terrain-config.json`)

1. **Remove the baked directional hillshade** (the `(0.62 + shade*0.55)` multiply, around lines 660–666). Relief now comes from the runtime sun, which changes with the era mood.
2. **Painted AO.** Compute curvature from shaped heights at 3 radii. Ridges warm toward ochre and hollows shift toward a violet-umber. Darkening stays at 20% or less.
3. **Gouache palette.** About 12 swatches, for example ochre, sienna, sage, olive, lavender-grey rock, cream snow, turquoise shelf sea and ultramarine deep sea. The biome ramp is soft-quantized into 5–6 flat colour bands.
4. **Brushstrokes.** Line-integral convolution of seeded noise along the contour tangent, or along a domain-warped flow on flats, at ±6% value. The flow angle is stored in `worldmask.B`.
5. **Gouache edges.** A slightly darker rim at biome-band edges, and a 1–2 px umber ink line on the coast.
6. **New outputs:** `public/terrain/brush.png` and `canvas.png` (512² tileable). The bake stays deterministic (seeded via `src/lib/prng.ts`).

### Runtime

**`terrain.ts`**
- The detail grain is replaced by the brush texture, rotated per fragment by the flow angle.
- Territory becomes an optional watercolour wash: granulation plus edge pooling. The frontier becomes an inked double line (dark core, thin gold edge) that survives the paint filter.
- Normals are slightly softened.

**`src/map/three/postfx/`** (pass order)
1. Structure tensor at half resolution.
2. Anisotropic Kuwahara: high tier uses 8 sectors at r=5, half-res; medium uses generalized 4-sector at r=3; low skips it.
3. Bloom.
4. One fused composite pass:
   - tilt-shift DOF from linearized log depth, focused at the rig target, with strength rising as pitch falls
   - depth/normal Sobel ink edges at about 20% umber
   - screen-fixed paper grain at about 5%
   - era grade, vignette and letterbox

**`sky.ts`**
- A background pass: mood gradient, sun or moon glow, 2–3 painted cloud bands.
- Its horizon colour also drives the fog colour, so the map edge dissolves into haze.

**Quality tiers**

| Tier | Pixel ratio | Kuwahara | Other |
|---|---|---|---|
| high | ≤ 2 | anisotropic | full bloom and DOF, 2048 shadows |
| medium | ≤ 1.5 | generalized | lighter bloom, 1024 shadows |
| low (phones) | 1 | none | grade + grain only; the painted bake carries the look |

**Gate:** screenshots at 330, 626, 1204 and 1453, in top-down, oblique and horizon views. Show them to the user for art sign-off before Phase 3.

## Phase 2: True-3D camera + curved earth

**`cameraRig.ts`**
- State becomes {x, z, distance, heading, pitch}. Pitch runs from 8° (near horizon) to 89°, and the minimum pitch rises with distance. DIST_MIN drops to about 3.
- Controls:
  - drag: pan
  - right-drag or Ctrl-drag: orbit and tilt
  - two fingers: pinch, twist and tilt
  - keys: Q/E rotate, R/F tilt
  - a compass widget snaps back to north
- `flyTo(pose)`: zoom-out-then-in arc with shortest-arc heading and ease-in-out. Any input cancels it.
- Near/far planes adapt to the horizon distance √(2Rh).
- Keep the rule "do state work before setPointerCapture".

**`src/map/three/curvature.ts`** (single source of truth)
- `drop = |p − target|² / 2R`, with R = clamp(8·distance, 150, 900).
- It exports:
  - the shared uniforms
  - a GLSL chunk replacing `project_vertex` (instancing-aware)
  - a TS twin, `bendY()`
- Used by terrain, water, apron, skirt, and every city, army and vignette material.
- Shadows use unbent world positions. Bent instanced meshes get padded bounds or `frustumCulled=false`.

**Picking and markers**
- `groundAt`: plane hit plus 2 Newton steps on the bent surface.
- `projection.ts` subtracts `bendY`, and markers past the horizon are hidden.
- The shadow-fit footprint in `lights.ts` is clamped at grazing views, and fog hides the far field.

## Phase 3: Constantinople lens

**Approach: a separate local-scale scene sharing the renderer and post chain.** In the
world view, the city shows only as a glowing miniature token (a stylized cluster of walls
and domes at about 8× scale, emissive at night). An in-world miniature can't work as the
real view: the peninsula is about 0.2 world units wide.

**Bake**
- `scripts/build-city.mjs` (chained into `world:build`, plus `city:build`) turns the committed z13 crop into `public/city/constantinople/*` at 12 m/px: heightmap, painted albedo and mask.
- It shares a new `scripts/lib/paint.mjs` (palette, AO, LIC) with the world bake.
- Local frame is 1 unit = 10 m, with 1.6× vertical exaggeration. The bake is deterministic.

**Data**
- `src/data/cities/constantinople.json`, with a `CitySceneSchema`: home pose, `urbanAreas[{from, to?, ring}]`, `density[]`, `captions[]`.
- Also `structures[{id, kind, name, from, to?, path|position, bearing, size, stages[{from, variant}]}]`.

**Builders** (`src/map/three/city/landmarks/*.ts`)
- Procedural geometry merged per material, flat painted materials, vertex-colour AO.
- Landmarks are about 1.5× height-exaggerated.

| Landmark | Years / variants |
|---|---|
| Theodosian land walls | 413+; moat, outer and inner wall, towers, gates |
| Sea walls | 439+ |
| Hagia Sophia | basilica 360 / 415, domed 537 |
| Hippodrome | |
| Great Palace | ruin variant after 1204 |
| Forum of Constantine + column | |
| Mese | |
| Aqueduct of Valens | 368+ |
| Blachernae | 1081+ |
| Golden Horn chain | |
| Galata walls / tower | walls 1267+, tower 1348+ |
| Harbours | |
| Rumeli Hisarı | 1452 |

**Houses**
- 4 procedural archetypes in muted terracotta and limewash.
- Seeded Poisson placement with a fixed birth rank: era density sets `InstancedMesh.count`, so scrubbing never regenerates. At most 10k on high, 3k on low.
- Window glow follows `emissiveBoost`.
- Quaternius CC0 props (market stalls, carts) go in `public/models/`, loaded with GLTFLoader. Materials are remapped to the palette by name. Each file is recorded in `public/models/LICENSES.md`, and a test enforces this.

**Store and transitions**
- Store gets `view: {mode:'world'} | {mode:'city', id}` and a `#city=…&year=…` hash.
- 1.4 s dive transition:
  - In: world `flyTo` → haze wipe (fog + DOF max) → swap scene → the establishing shot pulls out of the haze.
  - Out: the reverse, triggered by zooming past the maximum or by a button.
- City assets are lazy-loaded.

## Phase 4: Battle framework + the 1453 siege

**`src/data/scenes/*.json` + `BattleSceneSchema`**
- identity and timing: `id`, `eventId` (must exist), `host: 'world'|cityId`, `years {from, to}` (fractional), `loopSeconds`
- camera: establishing shot and shots
- `moodOverride?`, bilingual `title` and `captions[{t, text}]`
- `factions[{id, name, colors, banner}]`
- `formations[{faction, kind, anchor, bearing, rows, cols, spacingM, jitter, anim, path?, window?}]`
- `camps[]`, `artillery[{kind, position, target, interval}]`, `fleets[{faction, kind, count, anchor, path?, overland?, window?}]`
- `emitters[{kind: smoke|fire|dust, …}]`, `approximate: true`

**Runtime** (`src/map/three/scenes/`)

`director.ts`
- Activates and disposes scenes from `year` and `view`.
- Scene state is a **pure function of its own loop clock**, which is separate from the year timeline, so scrubbing backwards or re-entering always restores the same state.
- When autoplay reaches 1453, it flies to the establishing shot.

Other modules:
- `soldiers.ts`: one merged ~60-triangle figure as an InstancedMesh. Per-instance offset, formation and phase. The vertex shader handles formation transforms from a uniform array, bob/sway/spear tilt, and ground height from an R16F texture fetch. No skeletons, no per-frame uploads.
- **Banners:** vertex-shader wind cloth.
- **Particles:** stateless instanced painted puffs.
- **Muzzle flash:** an emissive sprite plus a bloom spike. No point lights.
- **Ships:** procedural galley (lofted hull, oars, lateen sail).

**1453 content** (approximate positions)

| Element | Location / notes |
|---|---|
| Mehmed's pavilion + camp | Maltepe |
| Janissary assault waves | Mesoteichion / St Romanus gate |
| Urban's great bombard + batteries | with smoke |
| Zaganos corps | Galata heights |
| Fleet | Double Columns |
| Overland haul | ships on rollers, Beşiktaş → Kasımpaşa → Golden Horn |
| Golden Horn chain | |
| Defenders | on the walls |
| Fires | along the breach |

## Phase 5: Generic battle vignette on the world map

- Add optional `battle?: {kind: battle|siege|naval, sides}` to `HistoricalEventSchema`, filled in for the military events. There is a default colour pairing when it is missing.
- A pool of 8 vignettes built from the Phase 4 modules: 2 banner poles, about 40 soldiers, a smoke column, and fire glow at night. They are curved-earth bent.
- A vignette is visible while `year ∈ [event.year − 1, (endYear ?? year) + 2]`, with a fade. This is tighter than the era filter used for markers.

## Phase 6: Cinematic UI

- **Chrome:** heavy purple/gold frames become translucent ink/parchment floating panels with gold hairlines. Cinzel for titles only.
- **Timeline:** slim, with era ticks.
- **Captions:** bilingual era title cards fade in on snapshot change, plus letterbox bars during `flyTo` and scenes.
- **Controls:** `H` hides the UI; compass and tilt widget.
- **Markers:** ink-medallion style.
- Mobile keeps the bottom sheet. New i18n keys come in {en, zh} pairs.
- Update `tests/components.test.tsx` and the Legend: terrain swatches follow the new palette, and a territory toggle is added.

---

## Critical files

- Modify:
  - `src/map/MapCanvas.tsx`, `src/map/three/{cameraRig,terrain,lights,water,atmosphere,palette,projection}.ts`
  - `scripts/build-world-textures.mjs`, `scripts/assets/terrain-config.json`
  - `src/data/schema.ts`, `src/data/events/era*.json` (the `battle` field)
  - `src/state/store.ts`, `src/ui/*`, `src/styles/theme.css`, `src/i18n/index.ts`, `package.json` scripts
- New:
  - `src/map/three/{renderPipeline,quality,curvature,sky,worldScene}.ts`, `postfx/`, `city/`, `scenes/`
  - `src/lib/mood.ts`, `src/data/moods.json`, `src/data/scenes/fall-1453.json`, `src/data/cities/constantinople.json`
  - `scripts/build-city.mjs`, `scripts/lib/paint.mjs`, `public/models/LICENSES.md`, `docs/art-direction.md`
- Reuse:
  - `heightShaping.ts` (`metersToY`), `heightField.ts` (decode, `heightAt`)
  - `prng.ts`, `distanceField.ts`, the water.ts ShaderMaterial template (logdepth/fog/tonemapping chunks)
  - `timeline.ts`, `projection.ts` setProjector
- Keep untouched: `src/lib/hex.ts`, `tests/hex.test.ts`.
- Update `docs/terrain-3d-spec.md` to the new pipeline.

## Verification

**Unit tests** (`npm test`)
- `mood.test.ts`: keyframe interpolation
- `curvature.test.ts`: zero drop at the centre, symmetry, projector ↔ `groundAt` round trip on the bent surface
- `postfx-math.test.ts`: log-depth linearization
- `scenes.test.ts`: schema, eventId exists, anchors inside the city bbox, factions resolve, years inside the event span
- `city-timeline.test.ts`: Hagia Sophia variants at 400 / 540 / 1453, Galata tower absent in 1300 and present in 1350, house count monotone in density
- `formation.test.ts`: deterministic layout
- `world-assets.test.ts` additions: `worldmask.B`, `brush.png` / `canvas.png` and city asset dimensions; straits and land anchors still pass
- Rule #1 (data.test) covers every new JSON, so the 330 caption must describe the city without its old name.

**Bake determinism:** run `npm run world:build` twice and compare with `sha256sum public/terrain/* public/city/**` (add `npm run world:verify`).

**Visual checks**
- `npm run dev`, then `agent-browser-wrapped` screenshots driven by an extended `__ercmDebug`: `setPose`, `setYear`, `setQuality`, `enterCity`, `freezeTime`, `whenIdle`.
- Fixed matrix at 1440×900 and 390×844:
  - world: 330, 626, 1204, 1453 × top-down, oblique and horizon views
  - city: 400, 540, 1100, 1453
  - 1453 siege: 3 shots
- Judge from native-res crops. Don't tune performance on llvmpipe.

**Build:** `npm run build` succeeds, and the city and scene chunks are lazy-loaded.

## Top risks → mitigations

1. **Ends up toy-like or realistic again.** `docs/art-direction.md` is written first; the Phase 1 screenshot gate gets user sign-off; low saturation, atmospheric perspective, no satellite colour and no red-roof carpets.
2. **The paint filter muddies key reads (frontier, figures) or costs too much.** Half-res paint with depth-weighted strength, an inked frontier line, DOM markers sitting outside the post chain, quality tiers and `?paint=0`.
3. **Curved-earth drift** across shaders, picking, markers, culling and shadows. One GLSL/TS module with parity tests; shadows unbent.
4. **Scope and mobile performance.** Budgets: city ≤ 250k tris, soldiers ≤ 10k high / 2k low, ≤ 300 smoke puffs, < 150 draw calls. Lazy-load everything local, stateless shaders.
5. **Historical placement and bilingual copy.** Siege positions marked `approximate`; the user reviews the new captions.
