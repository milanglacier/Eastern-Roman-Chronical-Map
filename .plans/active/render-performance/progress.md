# Performance progress

Tracks [`plan.md`](plan.md). Numbers come from `npm run perf` unless noted.

| Phase | Status |
|---|---|
| 0 — diagnose on the real machine | **Done** in code. Still to do: run it on the RTX 5090 machine (see below) |
| 1 — remove the stalls | **Done** on the map; 18 smaller stalls remain in the city view |
| 2 — stop shading hidden pixels | Not started |
| 3 — terrain LOD | Not started |
| 4 — smaller main-thread costs | Not started |

## User feedback

- 2026-09-30, after Phases 0 and 1, on the Apple M1: the user already feels the
  performance improvement a lot.
- Next: commit and push so Vercel deploys it, then open the live site with
  `?perf` / `?perf=bench` on the RTX 5090 machine (see "To do on the RTX 5090
  machine" below).

## Phase 0 — diagnostics (done, 2026-09-30)

- `?perf` overlay (`src/map/three/perf.ts`, stats in `src/lib/perfStats.ts`):
  - GPU name, plus a red warning on a software rasterizer (SwiftShader, llvmpipe,
    the Windows basic display driver).
  - Tier, DPR, pixel ratio, render size, MSAA, map or city view.
  - Frame, GPU (timer query around the whole pipeline) and loop CPU times as
    p50/p95/max over the last 240 frames, and stalls over 50 ms.
  - Works in production builds, so it can be opened on the live site.
- `?perf=bench`: a fixed benchmark in the page:
  - four map views (whole Empire, Aegean oblique, Dardanelles low pass,
    Anatolia top-down) and the city view
  - a timeline sweep on the map with the aerial tour flying, and one in the city
    view (330 → 1453, one year a frame)
  - The result goes to the overlay, the console and `globalThis.__ercmPerf.result`.
  - The tier is held still while it runs.
- `&perfsync`: waits for the GPU at the end of every frame (a 1-pixel read-back),
  so frame times are true costs when the browser runs without vsync.
- `npm run perf` (`scripts/perf.mjs`, no new dependencies):
  - Starts the dev server, drives Chrome over the DevTools protocol and prints a
    table (`--headed`, `--quality`, `--url`, `--out`, `--size`).
  - Headless runs are uncapped with `&perfsync`, which also keeps them working
    while a Mac's display sleeps (vsync'd frames stop then).
  - Chrome comes from `$CHROME_PATH`, the usual install locations (Chrome,
    Chromium, Edge, Brave) or `PATH`.
- Tests: `tests/perf.test.ts`.

### To do on the RTX 5090 machine

1. Open the live site with `?perf` and read the first line of the overlay. It
   should name the NVIDIA card. If it names the integrated GPU:
   - In Windows *Settings → Display → Graphics*, set the browser to "High
     performance".
   - `powerPreference` does nothing on Windows.

   A red warning means WebGL is on a software rasterizer: check `chrome://gpu`
   (hardware acceleration switched off, or a blocklisted driver).
2. Open it with `?perf=bench&quality=high` (a fixed tier) and copy the
   `[perf] {…}` JSON line from the console. Paste it here as the 5090 baseline for
   Phase 2.

## Phase 1 — stalls (done, 2026-09-30)

What changed:

- **City view idle on the map** (`worldScene.ts`): on the continental map the
  city view gets no year or mood updates; the latest ones are handed over when
  the city is entered, behind the cloud veil. This removes all the city work
  from playback on the map.
- **Houses** (`cityPage.ts`):
  - The scatter is split into a per-layout pass and a per-density pass. The
    layout pass (land cells, clearances, walls, avenues, harbours) runs only when
    its real inputs change. The density pass reselects from the cached spots and
    rewrites a preallocated `InstancedMesh` in place.
  - The land cells are computed once.
  - Wall and avenue distances go through an exact segment grid
    (`createSegmentIndex`), and rings through a bounding-box reject
    (`createRingTest`); both are in `src/lib/polyline.ts`.
  - Output is identical to the old code (sorted instance hashes compared at nine
    years).
  - Behaviour fix: the old key ignored walls and landmarks, so houses could stay
    inside a newly built wall until the density next changed. The scatter now
    follows walls and landmarks too.
- **City page** (`pageArt.ts`):
  - The ground below the dated layers (sea, waves, ripples, land, hills and
    fields) is cached per layer. It is redrawn only when the plate or the
    built-up areas change, which happens twice in the whole timeline, against 18
    page redraws.
  - The canvas state it leaves is restored exactly; the pixels are identical
    (canvas hashes compared).
- **Territory masks** (`territory.ts`, `territoryWorker.ts`,
  `src/lib/territoryRaster.ts`):
  - Every snapshot is rasterized at startup in a worker, instead of ~40 ms on the
    main thread the first time each one is shown.
  - Output is byte-identical across worker, `OffscreenCanvas` and DOM canvas (all
    26 snapshots).
  - Without workers, the old code runs one snapshot per idle slot.
- Not done: building the city view lazily. It costs ~57 ms at startup, not worth it.

Benchmark, Apple M1 (ANGLE Metal), headless, 1600×757, `quality=high`, each frame
waits for the GPU. Frame times are in ms; a stall is a frame over 50 ms.

| Run | Before: p95 | Before: max | Before: stalls | After: p95 | After: max | After: stalls |
|---|---|---|---|---|---|---|
| timeline sweep, map + tour | 176.9 | 443.7 | 120 | 28.3 | 35.2 | **0** |
| timeline sweep, city view | 177.5 | 426.0 | 100 | 16.9 | 213.9 | 18 |
| still views (5) | ≤ 17.2 | ≤ 33.4 | 0 | ≤ 17.2 | ≤ 31.6 | 0 |

GPU time is unchanged, as expected (Phase 2 is the GPU work): 8.6–17.6 ms p50 at
this size.

### Left over in the city view (18 stalls over the whole timeline)

Measured with temporary timers, since removed:

- **House rescatter, 45–90 ms**, about 16 times. Walls, landmarks or areas change
  in those years.
- **Page redraw, ~350 ms**, twice. The built-up areas change, so the cached
  underlay (fields) is redrawn: 4091×3795 canvas, ~60k parcels.
- **New landmark cards** drawn on first appearance (canvas art plus mosaic aux
  maps), small.

Options, if they matter after Phase 2:

- Precompute the scatter for every layout in a worker; its inputs are plain data.
- Draw the page layers into `OffscreenCanvas` in a worker.

Neither is needed for playback on the map, which is where the tour runs.

## Notes

- Timer queries in a **headed** Chrome on ANGLE Metal read higher than the frame
  interval (queue time is counted). Compare GPU numbers from headless `perfsync`
  runs only.
- The sweep plays one year a frame, 4× the density of real playback (15 years a
  second at 60 fps). Stalls are counted per event, so the counts compare.
