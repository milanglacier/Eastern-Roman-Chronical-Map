# Art direction: the living chronicle map

The world is a **living chronicle map**: an illuminated manuscript map you can fly
through. It is not a satellite globe or a strategy-game board. The viewer flies
over the land, looks up at the mountains and watches cities pop up out of the
page. Test every visual decision against this question:

> Would this frame look at home in an illuminated chronicle that had come to life?

## Hard rules

1. **Free-look camera, never an overview-map camera.** The drone camera
   (`src/map/three/droneRig.ts`) looks anywhere: 360° around, from straight down to
   up at the sky, flying low among the mountains. An orbit camera around a ground
   target reads as a map whatever the styling (see *History* below).
2. **Things stand up.** Mountains are sculpted and exaggerated
   (`src/lib/clockworkRelief.ts`, `CHRONICLE_RELIEF`). Cities are pop-up
   illustrations, not dots.
3. **Natural colours in the scene.** The sky, sea and land keep their natural
   hues: blue-green watercolour sea, the era's sky, and natural earth pigments
   washed onto parchment. The era moods (`src/data/moods.json`) set the light,
   from dawn in 330 to night in 1453.
4. **Imperial purple-gold is reserved for the empire and the UI.** Use it only for:
   - the UI chrome
   - the empire's territory wash and frontier line
   - emblems: city name ribbons and roundel petals

   Never recolour the sky, sea or land purple. Both attempts were rejected: a
   pastel lilac scene "looked like neon, gouache", and a deep purple scene "looked
   dead, lifeless".
5. **Drawn, not rendered.** Linework is ink: coasts, hachures down every slope,
   contours, and card outlines. Fills are watercolour washes with granulation and
   pigment pooled at the edges. Gold appears as leaf, with burnished strokes. No
   photo textures, and no image generation.
6. **Rule #1.** The state is the Eastern Roman Empire / Rome, never "Byzantine".

## Palette

| Role | Value | Where |
|---|---|---|
| Parchment | `#ecdcb4` | land ground (`chronicle/terrain.ts` `PARCHMENT`) |
| Sepia ink | `#3a2a1e` | hachures, contours, coasts, card linework |
| Sea, shallow → deep | `#7fb3b1` → `#2d5f7e` | watercolour sea (`water.ts`) |
| Sea ripple ink | `#2f4f5e` | coastal chart ripples |
| River | `#90bcc8` (linear 0.28, 0.5, 0.58) | watercolour-blue river channels |
| Imperial purple | `#5e2590` | frontier line, name ribbons |
| Territory glaze | `#8b5cc4` × 0.62 | multiplied over imperial land |
| Gold leaf | `#d4a93c` | frontier edge, domes, statue, roundel |
| UI scrim | `rgba(28, 11, 40, …)` | header, timeline, buttons, panels (`theme.css`) |

## Scene layers

- **Sky** (`sky.ts`, `CHRONICLE`): the era's sky biased toward a clear watercolour
  blue by day, painted clouds with pooled grey edges, and a gold sun with an ink
  rim. At night the clouds turn moonlit.
- **Haze** (`atmosphere.ts`): the era's haze mixed with a light blue air, thin
  enough that the distance stays readable.
- **Land** (`chronicle/terrain.ts`):
  - parchment and washes
  - ink hachures at a constant screen spacing, crossfaded across two levels of detail
  - sepia contours, with every fifth one bolder
  - the empire's glaze and frontier line
- **Sea** (`water.ts`, `CHRONICLE`): an opaque watercolour wash with three inked
  ripples following every coast.
- **Cities on the map** are markers, Constantinople included: nothing on the
  continental map is out of scale.
- **The city view** (`chronicle/city/`, drawn with `chronicle/illumination.ts`): flying
  down close to Constantinople (or clicking its marker) passes through a veil of
  painted cloud into a scene of its own. The plan of the city and its waters is set as
  a floor mosaic, after the Madaba map, out to a hazy horizon, with a gilded title
  plaque lying in the Marmara. Walls stand up as paper strips along their true paths.
  Landmarks, ships and houses are pop-up cards on their true sites that turn to face
  the viewer, and the city folds up like a pop-up page as you arrive. All of it follows
  the year (`src/data/cities/constantinople.json`). Climbing high out of the city
  returns to the map. The mosaic is used only inside the city view, so it never sits
  next to the watercolour world.
- **Post** (`postfx/`): tilt-shift, a light ink-edge pass, bloom, the era grade,
  paper grain and a vignette.

## History (why the rules exist)

Four looks were built and judged on 2026-09-24. Screenshots are in
`docs/screenshots/archive/`; the plans are in `.plans/completed/`.

1. **Satellite + miniature city** (v1 branch): read as realistic and game-like.
2. **Painted diorama: a failed try, removed from the code.** It used a gouache
   albedo with a flow-aligned brush-stroke material, a Kuwahara paint filter, and an
   orbit camera over a curved earth. The author did not like the art style: "it
   now has the painted art style, but still as a map". Its rendering code was
   deleted: the terrain material, the translucent sea, the painted sky, the
   Kuwahara passes, and the baked normal map and brush strokes. The screenshots
   (`archive/painted-*.jpg`) and the plan are kept only as a record.
   What survives from that round is shared infrastructure the chronicle map still
   uses: the era moods, the post pipeline, the curved earth, the UI chrome, and
   the albedo bake as the watercolour pigment source.
3. **Clockwork / Game-of-Thrones titles** (`?theme=clockwork`): a carved-stone model,
   brass gears and a rising clockwork city. The verdict: "still a 2.5D god-like view",
   because the orbit camera made it read as a map.
4. **Living chronicle map** (default): the free-look camera, the manuscript world
   and pop-up cities were approved.
