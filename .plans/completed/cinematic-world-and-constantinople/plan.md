# Cinematic World + Constantinople City View (Phase 1)

## Context

The user feels the map "looks like a rough strategy game" rather than a visually
stunning journey through real landscape and a thousand years of civilization.

Findings from research (2026-09-24):
- **Idea 1 (Three.js 3D terrain) is already shipped** (July 2026 rework; see
  `docs/terrain-3d-spec.md`). No gpt-image assets remain in the code. The albedo is
  procedurally baked by `scripts/build-world-textures.mjs`.
- What actually causes the strategy-game look (confirmed via screenshots):
  1. Flat, saturated biome ramp colours: solid-yellow desert and uniform green north.
  2. The imperial-purple fill (0.45 mix) paints over half the land and hides it.
  3. Close zoom turns to mush: about 1 km per albedo texel, with no detail layer.
  4. No sky, clouds, aerial haze or post-processing. The background is a flat
     slate colour.
- **Idea 2 (zoom into important cities) is feasible** as a dedicated city scene.
  At world scale Constantinople's land walls (~6 km) span ~0.28 world units, which
  is about 3 heightmap pixels. So the city needs its own high-res local scene
  rather than just a lower `DIST_MIN`.
- **Idea 3 (battle scenes over time) is feasible.** It is deferred to Phase 2 by
  user choice. The procedural + CC0 model kit built here is reused for armies.
- Asset strategy: **drop image generation entirely.** Land colour comes from
  **NASA Blue Marble Next Generation** (public domain, 500 m; verified: tiles B1/C1
  resolve, 200/408 MB). Close-range surface detail uses **ambientCG / Poly Haven
  CC0** tiling textures. City geometry is **procedural** in code. Small props
  (ships, trees) come from **CC0 kits** (Kenney, Quaternius).

User decisions: **Hybrid direction** (satellite base + cinematic grading, with
miniature-style cities on top). **Phase 1 = terrain beauty + a Constantinople city
view that evolves across all of 330–1453.** 3D assets: **procedural + CC0 kits.**

Step 0: copy this plan to `.plans/active/cinematic-world-and-constantinople.md`
before implementing (project convention).

---

## Part A — World terrain beauty

### A1. Satellite albedo bake
- New `scripts/fetch-imagery.mjs` (network, run once, like `fetch-dem.mjs`):
  - Download BMNG `world.2004MM.3x21600x21600.{B1,C1}.png`. Pick the month by eye:
    try May (Alpine snow) and July (least snow).
  - Crop to bbox + 1° pad.
  - Resample to plate carrée at 8192 px width.
  - Write the committed source `scripts/assets/bmng-crop.jpg` (~10–15 MB) plus a
    `.json` sidecar that records the source URL, the month and the public-domain
    notice.
  - Add `npm run world:fetch-imagery`.
- In `build-world-textures.mjs`, replace the biome-ramp colour in the albedo stage
  (around line 563–670) with a **graded satellite colour**:
  - Grade: slight desaturation, warm filmic curve, lifted shadows.
  - Blend a small amount of the existing procedural ramp and value-noise mottling
    back in, so the palette stays unified with the painterly direction.
  - Clean up modern artefacts, using the landmask we already compute:
    - Reservoirs and lakes that read as water on pixels our heightmap marks as land
      (Atatürk, Keban, Assad…): inpaint them from neighbouring pixels.
    - Center-pivot irrigation in the Arabian and Libyan deserts: median/low-pass
      filter where aridity is high.
    - City-lights grey blobs: replace low-saturation grey clusters with the local
      median colour.
  - Keep the existing river stroke, riparian band and meander code unchanged.
  - Drop the baked hillshade from the albedo, or keep only a weak AO term. BMNG has
    no shading, and the real-time sun plus the normal map do the relief.
- Determinism: the bake remains a pure transform of committed inputs. The sha256
  idempotency check must still pass.
- Update `LEGEND_TERRAIN` in `src/map/three/palette.ts` to swatches sampled from the
  new albedo, or drop the terrain legend block if it no longer maps to discrete
  biomes.

### A2. Close-zoom surface detail
- In `terrain.ts`, add an `onBeforeCompile` injection that blends 3 CC0 tiling
  detail textures (grass/scrub, rock, sand) with world-space UVs. The weights come
  from slope (from the normal map) and albedo luminance/hue.
- The detail fades in only below a camera distance of about 40.
- Put the textures in `public/textures/detail/` (512² or 1k, jpg). Add a
  `public/ASSETS_LICENSES.md` manifest listing every third-party asset with its
  source and licence.
- Reuse the existing detail-grain uniform plumbing (the `detail: waterNormal` path)
  as the template.

### A3. Sky, atmosphere, clouds, post-processing
- `atmosphere.ts`:
  - Replace the flat background with a gradient sky dome (horizon haze to zenith).
  - Replace linear `Fog` with **aerial perspective**: distance and height-based
    blue-grey haze injected via the existing fog chunks. Terrain, water and apron
    all already include the fog chunks.
  - Retune `SKY_COLOR` and `WATER_FRESNEL_TINT` together (see memory: the apron
    must still read as ocean).
- **Cloud shadows**: a scrolling low-frequency noise term multiplied into the
  terrain shader's direct light. It is cheap and makes the land feel alive.
- **Cloud layer at far zoom**: a few large soft cloud sprites or a noise-shaded
  plane at altitude that fades out as the camera zooms in (distance > ~120).
- New `src/map/three/postfx.ts`: an `EffectComposer` chain (three/examples) with:
  - SMAA
  - subtle bloom (sun glint, gold border)
  - vignette + colour-grade LUT pass
  - tilt-shift DoF, used only in the city view.
  - Quality tiers: reduced chain on `(pointer: coarse)` or when DPR is low. Never
    tune performance on llvmpipe.

### A4. Territory restyle
- In `territory.ts` and the terrain injection, cut the flat fill from 0.45 to
  ~0.12. Add a **frontier-weighted inner glow**: stronger purple within ~30 km of
  the border that fades toward the interior, using the existing G frontier-glow
  channel.
- Keep the gold fwidth iso-line.
- Result: the land stays visible and the Empire still reads at a glance.

---

## Part B — Constantinople city view (all eras, 330–1453)

### B1. Interaction model: a "city lens" scene
- The world scale stays untouched. Constantinople gets its own `Scene`, rendered by
  the same `WebGLRenderer`.
- Entry points:
  - Clicking the Constantinople marker.
  - Zooming to near `DIST_MIN` within ~2 units of the city. This shows a floating
    "Enter Constantinople / 进入君士坦丁堡" button; there is no auto-teleport.
- Transition: the world camera dives toward the city while haze/white fades in.
  The render swaps to the city scene, which fades back in with an establishing
  orbit shot.
- A "Back to map / 返回地图" button reverses the transition.
- New store state: `view: 'world' | {city: 'constantinople'}`.
- `MapCanvas.tsx` holds both scenes and chooses which one to render.
- `setProjector` (`src/map/three/projection.ts`) is swapped to the city camera, so
  DOM overlays keep working.
- City camera `src/map/three/city/cityCameraRig.ts`:
  - orbit around the city center (heading free)
  - pitch clamped to 25–60°
  - zoom ~0.4–6 km
  - pan clamped to the city bbox
  - Reuse the pure-math style and pointer/pinch handling of `cameraRig.ts`.

### B2. Local terrain (baked, offline)
- Extend `fetch-dem.mjs` with a parametrised local mode (or add a sibling script):
  - Terrarium **z12** tiles (~29 m/px, SRTM-based; verified reachable) for the bbox
    lon 28.82–29.12, lat 40.96–41.12.
  - Include Galata, the Golden Horn, the Bosporus mouth and the Asian shore at
    Chrysopolis/Chalcedon.
  - Commit the mosaic under `scripts/assets/city/constantinople-dem.png`.
- New bake step in `npm run world:build` writes `public/city/constantinople/`:
  - heightmap (same split-byte codec, `src/lib/heightEncoding.ts`)
  - normal map
  - worldmask (coast SDF for foam)
  - **procedural albedo**: Mediterranean scrub, fields and gardens. It does *not*
    use satellite imagery, which would show modern Istanbul.
- Historical coastline tweaks (Theodosian/Eleutherios harbour, Kontoskalion,
  Golden Horn shore) are optional polygon edits in the city config. Nice-to-have
  in Phase 1.
- Reuse the water shader (`water.ts`) on the local plane (same wave normals).
- Reuse `heightField.ts` decode, generalised to take a sidecar URL.

### B3. Data: a time-varying city model
- New `src/data/cities/constantinople.json`, validated by a new `CitySceneSchema`
  in `schema.ts`. Each structure has:
  `{ id, kind, name{en,zh}, path | position, from, to, stages? }`
- Kinds:
  - `wall`: Constantinian wall 330; Theodosian land walls 413; sea walls ~439;
    Blachernae extension (Komnenian); Golden Horn chain.
  - `great-church`: Hagia Sophia, with stages 360 / 415 / 537 (dome), 558 rebuild.
  - `church`: Holy Apostles, Pantokrator 1136, Chora.
  - `hippodrome`, `palace` (Great Palace → declining after 1204; Blachernae 1081+),
    `forum-column` (Forum of Constantine, Theodosius, Column of Justinian),
    `aqueduct` (Valens 368+), `harbor`, `tower` (Galata 1348), `gate` (Golden Gate).
- City-wide time curves:
  - `density` keyframes: ~330 small → ~540 peak ~500k → 1204 sack/fire damage →
    1453 sparse villages with fields inside the walls.
  - `condition` keyframes (intact / damaged / ruin) that drive geometry variants
    and colour.
- Add optional `scene: "constantinople"` to `CitySchema` so the marker knows it has
  a city view.
- Extend the Rule #1 data test to cover `src/data/cities/*.json`.

### B4. Procedural city generators (`src/map/three/city/`)
- `walls.ts`: extrude a wall along a polyline. Towers every N metres; crenellations,
  towers and gates are InstancedMeshes. The Theodosian triple line gets
  moat + outer wall + inner wall. Condition drives breaches and ruin variants.
- `landmarks.ts`: parametric builders.
  - basilica + central dome + half-domes (Hagia Sophia; smaller churches reuse it
    with different parameters)
  - hippodrome (U-stadium + spina, obelisk, serpent column)
  - palace terraces
  - honorific columns
  - aqueduct arcade along a path
  - Landmarks get a mild "landmark scale" (~1.3×) so they read from the orbit
    camera.
- `houses.ts`: seeded scatter (`src/lib/prng.ts`) of InstancedMesh houses with
  terracotta hipped roofs.
  - Sampled by `density(year)` inside the walls.
  - Monument footprints and the Mese avenue stay clear.
  - Fields/gardens replace houses as density falls.
  - Sample positions are stable across years (a threshold on a per-house seed), so
    scrubbing the timeline thins or grows the city smoothly instead of reshuffling.
- CC0 props in `public/models/` (glTF, loaded with `GLTFLoader`, listed in
  `ASSETS_LICENSES.md`):
  - Kenney watercraft/pirate kit ships moored in the harbours; count varies by era.
  - Quaternius cypress and olive trees.
- Materials: a shared warm stone/terracotta/lead-dome palette in a new
  `city/palette.ts`. Everything casts and receives shadows via one tight shadow
  frustum over the city.
- The timeline year drives `cityScene.setYear(year)`:
  - Structures fade and scale in/out over ~400 ms.
  - Houses animate by per-house threshold.

### B5. Events inside the city
- Events whose `lonlat` falls inside the city bbox render as DOM pins (existing
  `EventMarkers` via the swapped projector) at their exact position in the city
  view. Correct a few event `lonlat`s to precise sites (e.g. Hippodrome for Nika
  532, Hagia Sophia for 537).
- A header caption per era, e.g. "Constantinople, AD 540 — ~500,000 souls".
  - Stored as bilingual keyframed captions in the city JSON.

---

## Critical files
- Modify:
  - `scripts/build-world-textures.mjs`
  - `scripts/fetch-dem.mjs`
  - `src/map/MapCanvas.tsx`
  - `src/map/three/{terrain,atmosphere,territory,palette,heightField,projection}.ts`
  - `src/map/CityMarkers.tsx`
  - `src/data/schema.ts`
  - `src/data/index.ts`
  - `src/data/cities.json`
  - `src/state/store.ts`
  - `src/i18n/*`
  - `src/styles/theme.css`
  - `docs/terrain-3d-spec.md`
  - `package.json`
- New:
  - `scripts/fetch-imagery.mjs`
  - `src/map/three/postfx.ts`
  - `src/map/three/city/*` (scene, camera rig, walls, landmarks, houses, palette)
  - `src/data/cities/constantinople.json`
  - `public/city/constantinople/*`
  - `public/textures/detail/*`
  - `public/models/*`
  - `public/ASSETS_LICENSES.md`
- Must not change: `src/lib/hex.ts`, `tests/hex.test.ts` (byte-identical).

## Order of work (each step is a separately verifiable commit)
1. A1 satellite albedo, then A4 territory restyle. These are the biggest visual win
   and a checkpoint with the user.
2. A3 sky, atmosphere, clouds and postfx; then A2 detail textures.
3. B2 local terrain bake + B1 city lens scene/transition with bare terrain.
4. B3 schema/data + B4 walls, then landmarks, then houses/props.
5. B5 city events + captions; docs/memory update.

## Verification
- `npm test`:
  - Existing strait/landmark/bake tests still pass.
  - New tests:
    - `CitySceneSchema` validation and Rule #1 on the city JSON.
    - Generator determinism (same seed/year → same instance count and transforms).
    - House-threshold monotonicity (density up ⇒ house set is a superset).
    - Local heightmap sidecar ↔ PNG agreement.
    - Asset-licence manifest covers every file in `public/models` and
      `public/textures`.
- `npm run world:build` twice → identical sha256 for all outputs (world + city).
- `npm run build` passes (tsc + vite). Bundle/asset sizes are reported, and the
  total `public/` payload stays reasonable (<~40 MB).
- Visual: dev server + `agent-browser-wrapped` screenshots, judged on native-res
  sharp crops:
  - World at far/mid/close zoom for years 330, 565, 1025, 1453.
  - City view at 330, 540, 1204, 1453 (walls appear 413, dome 537, sparse 1453).
  - The enter/exit transition.
  - Mobile viewport (390×844) sanity check.
- Performance is judged on a real GPU by the user, not llvmpipe.

## Later phases (not in this plan)
- Phase 2: battle/siege scenes. Event-level `scene` data (armies, fleets, camps,
  cannon) using the same procedural + CC0 kit. The first is 1453 (the Ottoman host
  before the land walls, and the ships dragged overland into the Golden Horn).
- Phase 3: more city views (Rome, Antioch, Alexandria, Thessalonica) reusing the
  city generators with new JSON.

---

## Outcome (2026-09-24)

Implemented in commits b335b22 → (final docs commit): satellite albedo +
territory veil; sky/clouds/cloud shadows/post grade/ground detail; city-lens
bake + transition; procedural Constantinople by year; landmark labels, event
sites, docs.

Deviations from the plan:
- BMNG month: only the July 2004 record (74092) had a verified URL; snow comes
  from a raised procedural snowline instead of a May composite.
- Detail textures are high-pass luminance only (colour stays satellite): at
  map scale, photo colour tiles read as repeating patterns.
- Ships are procedural lateen-rigged hulls, not a Kenney kit; no CC0 tree
  models yet — `public/models/` is not created. The licence test covers it
  when it appears.
- Tilt-shift DoF for the city view was not added (the post chain has the hook
  via `postFx.setView`).
- Found and fixed along the way: the Dardanelles carve line cut a fake canal
  across Thrace north of the Gulf of Saros (the real strait was closed at
  heightmap resolution); shallow-sea z-fight dashes (Azov/Caspian/Baltic).
- Not done: touch-screen orbit (two-finger twist) in the city view; the Gate
  of the Spring / Blachernae Komnenian wall are not modelled separately.
