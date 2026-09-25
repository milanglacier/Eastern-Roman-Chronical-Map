# Living chronicle map, phase 2: Constantinople through the ages

Phase 1 (`plan-phase-1.md`) built the chronicle map: the free-look drone camera, the manuscript
world and a pop-up Constantinople. The user approved it. This phase covers the chronicle theme
only; the clockwork theme is not changed. Other cities come in phase 3.

## Why

The phase-1 city is one stack of three cards: walls in front, a generic quarter in the middle, and
Hagia Sophia with the palace and column at the back. The whole stack turns to face the camera. It
reads as "a city", but not as Constantinople:

- **The geography is missing.** Constantinople is a triangular peninsula. The Golden Horn
  separates it from Galata/Pera to the north. The Bosphorus separates it from Asia (Chrysopolis
  and Chalcedon) to the east. The Sea of Marmara lies to the south, and the land walls close the
  west side. On the world map, one texel is about 2.8 km. The Golden Horn (about 0.5 km wide) and
  the city itself (about 6 km) are smaller than a few texels, so the world terrain cannot show
  any of this.
- **Landmarks are not where they stand.** Everything stands in one row, facing the viewer. Hagia
  Sophia should sit at the tip of the peninsula above the Marmara. The land walls should run
  6.5 km from the Marmara to the Golden Horn.
- **Nothing changes with time.** The same drawing stands from 330 to 1453. It shows the domed
  Hagia Sophia in 330, two centuries early, and the Theodosian walls before they were built.
- **Some details are wrong.** The great dome of Hagia Sophia is drawn as gold leaf. Its outside
  was covered in lead sheet, so it looked grey. The gold was inside, in the mosaics.

The user asked for Constantinople to look like the real city, and to change over time:

- the walls
- the city split by the water
- Hagia Sophia and the other landmarks

The user also asked to draw inspiration from the Eastern Roman mosaic art style where possible.

## Direction

**The city page.** Constantinople becomes a magnified inset lying on the map: a drawn plan of
the peninsula and its waters, at about ×12 scale, on a slightly raised page with a deckled edge
and a gilded mosaic border. Walls stand up from the page as folded paper strips along their true
paths. Each landmark stands on its true site as its own pop-up card. Houses fill the quarters.
All of it changes with the year.

This keeps the pop-up language the user approved ("things stand up", drawn, not rendered). It
also shows the geography honestly: the gilded border marks the page as an inset at a different
scale, the way a chronicle map would inset a city plan. The historical models for the page are:

- **Cristoforo Buondelmonti's plan of Constantinople** (c. 1420): the triangle of walls, the
  Golden Horn with Pera across it, and Hagia Sophia, the Hippodrome and the columns drawn in
  elevation on a plan.
- **The Vavassore woodcut** (c. 1520, showing the city of the later 15th century).
- **The Madaba mosaic map** (6th century): a floor mosaic that draws cities as walled plans with
  their buildings in elevation. It is a direct model for a mosaic city page.
- **The Ravenna mosaics.** The "Palatium" and "Civitas Classis" panels in Sant'Apollinare Nuovo
  show a city as walls and buildings standing in a row, which is already a pop-up.

**The mosaic influence.** Three uses, from light to heavy. The art gate (step 5) decides how far
to go.

1. **Ornament.** The page's border is a mosaic frieze: a wave or meander band and a jewelled
   band, set in gold tesserae. The title plaque is set in mosaic and reads
   `ΚΩΝΣΤΑΝΤΙΝΟΥΠΟΛΙΣ · CONSTANTINOPOLIS`. The colour rule allows gold here, because these are
   emblems.
2. **The page floor.** The plan of the city is set as a floor mosaic in the manner of Madaba:
   - natural stone tesserae for the land
   - blue-green water with rows of zigzag wave tesserae
   - dark outline rows for coasts and walls
3. **The cards.** The pop-up cards themselves are tessellated. Rows of tesserae follow the ink
   outlines (opus vermiculatum), with grout lines between them and a small colour variation from
   one tessera to the next. Gilded parts (crosses, the statue on the Column of Constantine, the
   Golden Gate) use gold smalti. Each gold tessera is set at a slightly different tilt, so it
   glints as the camera moves, the way real gold mosaics do.

Colour rule check: the tesserae keep natural colours. Gold appears only where the art direction
already allows it (emblems) or where the real object was gilded.

## Revision: a separate city view (2026-09-25, after the art gate)

The user found the page lying on the continental map "a bit harsh". The mosaic city sat
next to the watercolour world, and the magnified inset made an unnatural jump in scale at a
hard edge. The new direction:

- **In the continental view, Constantinople is a regular city:** a city marker like the
  others, with no magnified inset and no flattened terrain.
- **Zooming in far enough on the city enters the city view.** This is a separate scene with
  its own sky, light and haze, where the continental map is not visible. The city page fills
  the ground: the detailed plan in the middle, and a coarser outer ground out to a hazy
  horizon, so no edge is ever seen.
- **Climbing high enough in the city view returns to the continental view,** above the city
  with the same heading. A gap between the two thresholds stops the view from flipping back
  and forth.
- **The switch passes through a veil of painted cloud:** it fades in, the scenes swap, and it
  fades out while still zooming, so it reads as flying down through the clouds (or back up).
  Clicking the city's marker also enters the city, and a "back to the map" button in the city
  view leaves it.
- **The mosaic stays as chosen (setting A),** but only inside the city view. The border that
  framed the inset goes. The title plaque stays, lying in the Marmara like a Madaba
  inscription.

This replaces the placement in step 3 (the page no longer lies on the terrain) and the
page slab in step 4. The plate bake grows an outer ground: the land mask covers the whole
z13 DEM crop, and it is extended past the crop edges, which the haze hides.

## Scope

### 1. City data (`src/data/cities/constantinople.json`)

This file holds all city content, validated by a new `CityPlanSchema` in `src/data/schema.ts`.
Components never hardcode it.

- **Port the v1 data.** The rejected v1 branch
  (`feat/3d-realistic-rendering-and-grand-constantinople-claude-opus-5-5-v1`) has well-researched
  data we can reuse:
  - urban rings for 330–412 and from 413
  - a density curve and a population curve
  - 11 era captions
  - 31 structures, each with `kind`, a `position` or `path` in lon/lat, `bearing`, `size`, and
    dated `stages` (`from`, `variant`, bilingual `note`)

  Re-check every date against the sources and apply Rule #1.
- **Add the missing structures and variants.** The table in *Constantinople through time* below
  lists them.
- **Add geography features:**
  - harbours, with the dates they were open (the Harbour of Theodosius silted up by the 11th
    century)
  - the Lycus valley and the seven hills
  - open-air cisterns (Aetius 421, Aspar 459, Mocius c. 500)
  - gardens and fields inside the walls in the late period
  - the district burnt in the fires of 1203–1204
  - place names on the page: Galata/Pera, Chrysopolis, Chalcedon, the Golden Horn, the
    Bosphorus, the Propontis (Sea of Marmara)
- **Generic shape.** The schema describes any city page, so phase 3 can add Rome and Antioch as
  new JSON files and drawing sets without changing the schema.

### 2. Coast bake (`scripts/build-city-plate.mjs`)

- **Source:** the v1 branch's z13 DEM crop (`scripts/assets/city/constantinople-dem.png` and its
  config, bbox 28.80–29.14°E, 40.95–41.13°N). It covers the Golden Horn up to Kağıthane, Galata,
  Rumeli Hisarı and the Asian shore. Bring it over as a committed asset, so the bake stays
  offline.
- **Output:** `public/city/constantinople/plate.json`, holding:
  - simplified coast polygons for each land mass
  - hill contours at about 20 m spacing, for hachures on the page
  - a coarse height grid, for placing things on the page
- **Historic corrections** go in the config: remove modern fills (the Marmara shore road, the
  Yenikapı fill, the Golden Horn quays) and keep the harbours open until their silting dates.
- **Build:** chained into `npm run world:build`. The output is deterministic, and the existing
  sha256 idempotency test covers it.

### 3. Map frame (`src/lib/cityFrame.ts`)

This module maps lon/lat to page coordinates and back, around a centre, with the magnification
`M`. It is a pure function and has unit tests.

- **`M` about 12.** The page is about 6 world units across. It covers Theodosian walls → Chalcedon
  and Marmara → the upper Golden Horn, and it is tuned in the art gate.
- **Placement.** The page lies on the terrain at the city's site, above the world surface, and
  hides the 1:1 coast under it.
- **Drone clearance.** The drone keeps its clearance above the page and the tallest card. This
  extends the ground-clearance code in `droneRig.ts`.

### 4. City page renderer (`src/map/three/chronicle/city/`)

This module replaces `chronicle/popupCity.ts` and its roundel.

- **`page.ts`: the ground.** A canvas-drawn plan:
  - the land in parchment and watercolour (or mosaic, depending on the art gate)
  - hachured hills and the Lycus valley
  - the three waters with inked ripples and the harbours
  - the moat
  - the Mese road and the forums as open spaces
  - gardens, open cisterns, and the burnt district
  - lettered place names

  The mosaic border sits on a deckled page mesh. The page is redrawn only when its era key
  changes, and cached.
- **`wallStrips.ts`: the walls.** Folded paper strips along the true paths. Each strip is a chain
  of vertical quads that follow the path, double-sided and not billboarded, with a tower tab at
  every tower position. A repeating drawn texture shows the crenellations and the masonry
  courses (the Theodosian walls have bands of brick between the stone).
  - **Theodosian land walls:** the inner wall and the lower outer wall, with the moat drawn on
    the page.
  - **Other circuits:** the Constantinian wall, the sea walls along the Marmara and the Golden
    Horn, the Blachernae walls, and the Galata walls.
  - **Folding:** strips fold up from the page segment by segment, like a pop-up page opening.
- **`landmarkCards.ts`: the landmarks.** One card per landmark variant, drawn with
  `illumination.ts` in its own drawing function under `drawings/constantinople/`. Each card
  stands on its site with a cylindrical billboard.
  - Optional: Hagia Sophia gets two drawings, the long south side and the west front with the
    atrium, cross-faded by view angle. Its silhouette changes a lot between the two.
- **`houses.ts`: the quarters.** Small house cards, instanced from a drawn atlas: tiled houses,
  a few church domes, and monastery enclosures.
  - **Placement:** blue-noise positions inside the urban ring, with the count set by the density
    curve.
  - **Late period:** the city thins into clusters of villages among gardens, as described by
    visitors in the 14th and 15th centuries.
  - **Outside the walls:** Galata, Chrysopolis and Chalcedon get small clusters of their own.
- **`cityPopup.ts`: assembly.** It builds the page, and exposes these functions to the host:
  - `setYear`
  - `setRise`
  - `setNight` (at night, lit windows are optional)
  - `update(camera)`

  It keeps the `riser` contract used by `worldScene.ts`.

### 5. Mosaic treatment and the art gate (`chronicle/city/mosaic.ts`)

- **Card and page shader.** Each tessera is a cell of a jittered grid in texture space. A tessera
  samples the drawing at its centre, adds a small jitter to its colour, and is separated from its
  neighbours by grout lines. The drawing function also paints a second canvas, the gold mask.
  Where the mask is set, a tessera takes a random tilted normal, which gives a view-dependent
  glint.
- **Level of detail.** The tesserae fade into the smooth drawing with distance, based on the
  screen-space size of a tessera, so there is no shimmer or aliasing.
- **Art gate.** Build the city page for **537** only (the Theodosian walls, Justinian's Hagia
  Sophia, the Hippodrome, the Great Palace, the columns and the houses). Screenshot it with three
  settings:
  - **A (recommended):** ink-and-watercolour cards on a Madaba-style mosaic page, with a mosaic
    border and plaque.
  - **B:** full mosaic, where both the cards and the page are tessellated.
  - **C:** watercolour only, where the mosaic appears only in the border and plaque.

  Show the user and get a verdict before building the other eras.

### 6. Time (`src/lib/cityTimeline.ts`)

- **Resolver.** A pure function takes a year and returns, for every structure:
  - the active variant
  - its state: rising, standing, ruined, or gone

  The v1 branch has a first version of this; port it and add tests.
- **Transitions.** When the year crosses a stage boundary:
  - a removed card folds down
  - a new card folds up
  - a changed variant flips like a page: down, swap, up

  The house count eases toward the new density.
- **Era events:**
  - **1203–1204.** The fire and the sack: a scorched wash over the burnt district on the page,
    charred edges and ink smoke curls on the cards in that district, and the Hippodrome's bronze
    horses gone to Venice.
  - **1453.** The last weeks, shown as set dressing and not animated:
    - Ottoman tents and banners before the land walls, with Mehmed's tent facing the St Romanus
      Gate
    - Rumeli Hisarı (1452) on the European shore of the Bosphorus, and Anadolu Hisarı (1394)
      opposite it
    - the chain across the Golden Horn
    - ships on the overland slipway behind Galata
    - the great bombard

    The animated siege tableau is still in the build-out list.

### 7. Labels and camera

- **Labels.** Landmark names (bilingual) appear as DOM labels through the existing marker
  overlay when the drone is close. Hovering or tapping a label shows the current variant's
  `note`.
- **Opening flight.** The final pose of the opening journey frames the Golden Horn, with Galata
  across the water.
- **Debug hooks:**
  - `__ercmDebug.cityYear(y)` jumps the city to a year without the timeline.
  - `__ercmDebug.cityView(name)` sets a named drone pose for screenshots: `marmara-north`,
    `land-walls-low`, `asia-skyline`, `hagia-sophia-close` and `golden-horn`.

### 8. Clean-up and documents

- Delete `chronicle/popupCity.ts` and its roundel; `chronicle/city/` replaces them.
- Update `docs/art-direction.md`:
  - the city page
  - the mosaic rules, including where gold is allowed
  - the historical-accuracy rules for city art
- Save a memory of the gate verdict.

## Constantinople through time

The table lists the key states the drawings must cover. The dates come from the v1 data and
standard topographies; re-check each one while authoring the data.

| From | What changes on the page |
|---|---|
| 330 | Constantine's city: the Constantinian land wall (about 1.5 km east of the later walls), the Great Palace, the Hippodrome with the Serpent Column (brought from Delphi), the oval Forum of Constantine with the porphyry column and the statue of Constantine as Helios, the Mese, and the first Holy Apostles. No Hagia Sophia yet. |
| 360 | The first Hagia Sophia: a timber-roofed basilica. It burned in 404. |
| 368 | The Aqueduct of Valens. |
| c. 390 | The Obelisk of Theodosius on the Hippodrome spina. The Golden Gate, a freestanding triumphal arch in marble. The Forum of Theodosius (393). |
| 413 | The Theodosian land wall (inner line), which takes in the Golden Gate. The urban ring moves west. |
| 415 | The second Hagia Sophia, still a basilica. |
| 421 | The Column of Arcadius. |
| 421–c. 500 | The open cisterns of Aetius, Aspar and Mocius. |
| 439 | The sea walls along the Marmara and the Golden Horn. |
| 447 | After the earthquake: the outer wall and the moat, completing the triple line. |
| 532 | The Nika riot burns the centre, including the second Hagia Sophia and Hagia Irene. |
| 537 | Justinian's Hagia Sophia: the great shallow dome, the half-domes and the buttresses. The dome is covered in lead (grey), and the crosses are gilded. Sts Sergius and Bacchus (536), the rebuilt Hagia Irene, and the Column of Justinian with its bronze horseman (543). |
| 550 | Holy Apostles rebuilt as a cross-plan church with five domes. |
| 558–562 | The first dome collapses and is rebuilt higher: the silhouette changes. |
| 627 | The Blachernae wall is added at the north end of the land walls. |
| 717 | The chain across the Golden Horn, anchored at the Kastellion in Galata. The city has shrunk: fewer houses and more gardens. |
| 9th–10th c. | Recovery: the Nea Ekklesia (880), the Myrelaion (922), and a denser city. |
| 989–994 | An earthquake damages the dome, and the architect Trdat repairs it. |
| 1081–1136 | The Komnenian city: the Blachernae Palace becomes the main residence, Manuel I's wall, the Chora rebuilt, and the Pantokrator monastery (1118–1136). Italian merchant quarters line the Golden Horn. |
| 1106 | The statue on the Column of Constantine falls. A cross replaces it. |
| 1203–1204 | The fires and the crusader sack. The Latin period follows, with a burnt district and a shrinking city. The bronze horses leave the Hippodrome. |
| 1261 | The restoration. The Great Palace is left as ruins, and the court stays at Blachernae. |
| 1267–1348 | Galata becomes a Genoese colony, walled from 1303, and gets the Galata Tower (the Christea Turris, 1348). |
| 1346–1354 | The eastern part of the dome collapses and is repaired. |
| 14th–15th c. | The late city: clusters of villages among gardens and fields inside the walls. The Chora has its new mosaics and frescoes (1315–1321). |
| 1453 | The siege set dressing (see step 6). Show no minarets at any date: they were added after the conquest, and the app ends in 1453. |

## Out of scope

- Other cities: phase 3.
- The animated 1453 siege tableau and battle vignettes.
- The clockwork theme's Constantinople.
- Guided journeys through the eras.

## Order of work

1. Data and schema (step 1), the coast bake (step 2), and the map frame (step 3), with tests.
2. The page, the wall strips, and the 537 landmarks and houses (step 4), plus the mosaic shader
   (step 5).
3. **Art gate:** screenshots of settings A, B and C for 537. The user's verdict sets the
   treatment.
4. All the eras: the rest of the drawings, the timeline resolver, and the transitions and era
   events (step 6).
5. Labels, camera and debug hooks (step 7), and the clean-up and documents (step 8).
6. **Final review:** era screenshots, shown to the user.

## Verification

- **`npm test`:**
  - the city schema, and Rule #1 on the city JSON
  - that every structure variant has a drawing (a registry test)
  - that positions fall inside the page bbox and on land, except harbour and chain features
  - that the stages of each structure are ordered
  - the timeline resolver at boundary years
  - the map-frame round trip
  - the idempotency of the plate bake
  - all existing tests
- **Screenshots** with `?intro=0`, `cityYear` and `cityView`:
  - **Years:** 330, 413, 447, 537, 562, 717, 1000, 1150, 1204, 1300, 1453.
  - **Views:** from over the Marmara looking north, with the Golden Horn separating Galata;
    low along the land walls; the skyline seen from Asia across the Bosphorus; Hagia Sophia
    close up; night in 1453.
- **Checks:** frame time on llvmpipe and on a mobile-sized viewport, and the texture memory of
  the card atlases.

## Open questions (decide at the art gate)

- How much mosaic: setting A, B or C.
- The magnification `M` and the page size: large enough to read the Golden Horn and the landmarks
  from mountain height, small enough not to swallow Thrace.
- Whether landmark cards billboard, or keep fixed orientations the way a real pop-up book does.
  Walls stay fixed either way.

## Status (2026-09-25)

Steps 1–5 are built for **537**. **Art gate verdict (2026-09-25): setting A**, a
floor-mosaic page with watercolour cards and gold smalti on the gilding. `?mosaic=a` is the
default; B and C stay reachable for comparison. Next: step 6, the other eras.

**Feedback on Hagia Sophia:** "it looks like The Grand Budapest Hotel", with a tall box of
window rows under a small dome. It is redrawn as the real stepped mass:
- one great dome, 40% of the building's length across, on its ring of windows
- two massive piers carrying it
- a recessed tympanum with rows of windows under a heavy great arch
- half-domes and exedrae stepping down at each end
- low galleries under lean-to lead roofs, with few, grouped windows
- variants for 537 (shallow dome), 558 (dome fallen, scaffolding), 562 (higher dome) and
  1317 (flying buttresses)

Keep this silhouette rule for every domed church: the dome and its supports carry the
image, not the windows.

**Built:**
- **Data:** `src/data/cities/constantinople.json` holds the v1 data (checked and corrected)
  plus new structures (St Polyeuctus, St John of Stoudios, St Mary of Blachernae,
  St Euphemia), harbours, open cisterns, plazas, the 1203 fire, settlements, labels
  and ships. `CityPlanSchema` validates it.
- **Coast bake:** `npm run city:build` bakes the coast, contours and hachures from the
  v1 z13 DEM crop into `public/city/constantinople/`. The bake is deterministic, and
  `world:build` runs it too. The DEM is SRTM (2000), so the large modern fills such
  as the Yenikapı rally ground are not in it.
- **Page and frame:** `src/lib/cityFrame.ts`, and `src/map/three/chronicle/city/`:
  - the page slab, with the terrain under it pressed down
  - the drawn plan with its border and plaque
  - wall strips with towers (the triple line and moat from 447), the aqueduct and
    the forum colonnades
  - landmark cards
  - instanced houses and trees driven by density
  - the mosaic shader
- **Views:** `__ercmDebug.cityView(name)` jumps to a named view. The opening flight
  now ends low over the Marmara, looking up the Golden Horn.
- **Clean-up:** `chronicle/popupCity.ts` is removed. The Constantinople DOM marker is
  hidden in the chronicle theme, because the page carries its own title plaque.

**Art gate:** `?mosaic=a|b|c`, with screenshots of six views for each setting.
- **A:** a Madaba-style floor-mosaic page, with watercolour cards whose gilding is
  set in gold smalti.
- **B:** everything tessellated. The cards use a wall-mosaic setting (finer and more
  regular than the floor).
- **C:** a watercolour page and cards; only the border and the plaque are mosaic.

**City view (2026-09-25, after the revision):**
- The page is gone from the continental map, and Constantinople is a regular (clickable) marker.
- The city view is a separate scene (`chronicle/city/cityView.ts`).
- **Entering:** the drone must be below 1.5 world units, looking at the city (within 0.8
  units) or hovering over it. Clicking the marker also enters.
- **Arriving:** 1.2 city units up, with the heading and pitch continued from the map.
- **Leaving:** climbing above 2.1 city units. The map comes back 2.4 units up, clear of the
  1.5 entry threshold, with a 1.5 s cooldown after each switch.
- **The veil:** a DOM cloud overlay, scaling 1 → 1.18 → 1.42 on the way in and the reverse
  on the way out. The city folds up over about 2.6 s on arrival.
- **Ground:** the detail layer (4096 px) reaches 1.1 units past the plan, and the outer
  layer (2048 px) is 26 units wide. The outer layer lies 0.004 below the detail layer,
  because the log depth buffer ignores polygon offset.
- The opening flight ends low over the Marmara looking at the city, so it dives into the
  city view. Its button is named "Fly to Constantinople" (飞往君士坦丁堡). The old name,
  "Begin the journey", read as the chronicle of the empire. The flight takes 19 s
  (it was 24 s).

**Notes for the build-out:**
- The landmark cards are about 8× wider than their true footprint, so neighbours
  (Hagia Sophia and Hagia Irene, the Hippodrome and the Great Palace) overlap in
  depth. That is the vignette convention, but watch it as more cards are added.
- Drawings for other eras exist only where they share a generic drawing
  (basilica, domed, cross-domed and ruin churches, gates, columns). The rest of
  step 6 is still to do.
