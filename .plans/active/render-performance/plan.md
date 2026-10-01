# Performance plan

The map runs badly even on fast hardware (reported on an NVIDIA RTX 5090). Status
of each phase lives in [`progress.md`](progress.md).

## What was measured

Dev build, Chrome with the real GPU (Apple M1, ANGLE Metal), `?quality=high`,
2400×1170 device px, GPU time from `EXT_disjoint_timer_query_webgl2` around the
whole post pipeline. Absolute numbers are M1 numbers; the ratios are what matter.

**Two separate problems:**

1. **Main-thread stalls while the timeline plays.** A faster GPU does nothing for
   them. Frames up to 333 ms, repeating at the same years on every run.
2. **A very expensive frame per pixel.** The terrain dominates and the cost scales
   with pixels × MSAA.

### Stalls (CPU)

- Playing the timeline calls `world.setYear` every frame. It forwards to the city
  view (`cityView.setYear` → `cityPage.sync()`) **even on the continental map,
  where the city is not drawn**.
- `resolveCity` rounds the year, so `sync()` runs on every integer year. Over one
  sweep 330 → 1453 (1123 syncs):

  | Part of `sync()` | Total | Per hit |
  |---|---|---|
  | `rebuildHouses()` (the scatter re-runs whenever density moves 1/40) | 9.7 s | 40–240 ms, ~70 hits |
  | `redrawPage()` (two big canvases, when features/areas/labels change) | 2.6 s | 130–160 ms, ~18 hits |
  | wall paths + card diff | 0.35 s | < 2 ms |

- Building the whole city view at startup costs ~57 ms: not worth making lazy.
- Ruled out: the render call itself (~0.6 ms CPU), React markers (~0.07 ms/frame,
  ≤ a few dozen markers), `bumpView`.
- Territory masks are cached, but each snapshot's first rasterization costs
  ~40 ms (first thought harmless; found with the benchmark in Phase 1).
- The auto-quality probe steps down on the **median** frame over 30 ms only: it
  never sees stalls, and it never triggered at ~34 fps either.

### GPU

| Change (oblique view) | GPU ms/frame |
|---|---|
| baseline | ~55 |
| terrain hidden | ~12 |
| pixel ratio 2 → 1 | ~17 |
| MSAA 4× → off | ~35 |
| terrain at half mesh density | −8 |
| terrain in a plain PBR material (no ink or wash) | −9 |
| shadow map, environment map, DOF, bloom | ≈ 0 each |

Likely causes:

- The **logarithmic depth buffer** writes `gl_FragDepth`, which turns off early-Z
  (and hidden-surface removal on tile GPUs). Every covered fragment is shaded:
  water under land, the ocean apron, the skirt, hills behind hills. Not yet proven:
  three fixes the log-depth setting when the renderer is created, so it could not
  be A/B-tested at runtime.
- **1.29M terrain triangles, no culling, no LOD**: under 2 px per triangle in the
  distance, so quad overshading multiplies the fragment work, 4× MSAA on RGBA16F
  on top.

## Phases

### Phase 0 — diagnose on the real machine (small)

- `?perf` overlay: GPU name (`UNMASKED_RENDERER`), software-renderer warning, tier,
  DPR, render size, MSAA, frame p50/p95/max, GPU ms (timer query), stall count.
  Works in production builds so it can be opened on the live site.
- `?perf=bench`: a fixed in-page benchmark (camera poses, the city view, a
  timeline sweep with the tour on) that reports JSON.
- `npm run perf`: starts the dev server, drives Chrome over CDP through the
  benchmark and prints the result, so every later phase has before/after numbers.
- On the 5090 machine: confirm Chrome runs on the NVIDIA GPU. `powerPreference`
  is ignored on Windows; hybrid laptops often put Chrome on the integrated GPU, and
  a blocklisted driver falls back to software (check `chrome://gpu`).

### Phase 1 — remove the stalls (small, big effect)

- On the map, `worldScene` keeps the latest year and mood for the city view and
  hands them over when the city is entered (behind the cloud veil).
- Split `rebuildHouses()`: the expensive scatter (land, clearances, walls,
  avenues, harbours) is computed once per layout; density only reselects from
  the cached candidates and rewrites a preallocated `InstancedMesh` in place.
- Cut `redrawPage()`: cache the parts of the ground that never change with the
  year (sea, waves, coast ripples, land and hills, the land mask) once per plate
  and layer, and redraw only the dated layers on top.
- Found while doing this phase: each territory snapshot is rasterized (~40 ms)
  the first time it is shown. Rasterize all of them in a worker at startup.

### Phase 2 — stop shading hidden pixels (medium)

- Reversed-Z float depth (three's `reverseDepthBuffer`, needs `EXT_clip_control`)
  instead of the logarithmic depth buffer, with log depth as the fallback; update
  the depth texture, `postfxMath` and the composite's linearization. Verify the
  early-Z win on a branch first.
- Render scale: cap `high` at pixel ratio 1.5; 2× MSAA, or none plus a cheap
  edge AA in the composite (the ink and paper grain hide slight upscaling).
- Replace the frame probe with dynamic resolution: steer the render scale to a
  frame-time target, react to spikes as well as the median, and step back up.
- Shadow map only when the view or mood changes (`shadowMap.autoUpdate = false`).

### Phase 3 — terrain LOD (large)

- Split the terrain into tiles (e.g. 16×8), frustum-cull them with bounds padded
  for the curved-earth bend and the horizon.
- 2–3 levels of detail by distance with skirts or stitched edges; full detail near
  the camera.
- Update `docs/terrain-3d-spec.md` (it says 1.29M triangles is "trivial").

### Phase 4 — smaller main-thread costs (small)

- `bumpView()` every moving frame goes through the persisted zustand store:
  `persist` writes `localStorage` after every `set()`, and React re-renders the
  markers and the compass. Move the view tick out of the persisted store, or
  position markers and the compass directly with refs in the loop.
- React components that subscribe to the fractional `year` re-render every frame
  during playback: subscribe to a rounded year.
- Measure the six `backdrop-filter: blur()` panels over a canvas that changes
  every frame; swap for solid translucent fills if they cost.

## Order

0 → 1 → 2 (depth, then render scale) → 4 → 3. Phases 0 and 1 should remove the
stutter; Phase 2 carries the steady frame-rate gains; Phase 3 is the largest job,
so do it once `npm run perf` shows how much is left.
