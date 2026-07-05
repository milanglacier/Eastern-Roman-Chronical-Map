# Civ5-Style Textured Terrain, Rivers & Animated Water

## Context

The map previously drew all 5040 hex tiles as flat-colored PixiJS `Graphics`
polygons with tiny procedural icons in `src/map/renderer/terrain.ts`. Goal:
believable, Civ5-like terrain — mountains that look like mountains, seas that
look like seas, and rivers (which didn't exist in the data at all).

**Confirmed decisions:**
1. **Sprite + PNG-atlas route**: final art will be AI-generated PNGs committed
   to the repo (user produces them from the spec in `docs/terrain-art-spec.md`).
   The full sprite pipeline ships now with a **runtime procedural placeholder
   atlas** (same code path, drop-in replacement later).
2. **New river system**: major rivers (Nile, Danube, Euphrates, Tigris, etc.)
   defined in `terrain-config.json`, baked into `tiles.json`, rendered as
   winding channels.
3. **Water animation**: subtle shimmer over sea + rivers, ticker-driven.

**Must preserve**: hex math (`src/lib/hex.ts`, ISO_SQUASH=0.62, HEX_SIZE=12,
90×56 grid — `tests/hex.test.ts` untouched), camera + zustand sync (DOM
EventMarkers), layer order terrain→territory→cities, 550ms territory
crossfade, terrain codes D/s/g/p/h/m/d, ELEVATION lifts (m=11, h=5), Rule #1
(never "Byzantium" for the state).

## Layer Stack (world container, bottom→top)

```
world
├─ waterLayer      Container of sea-tile Sprites (static)
├─ shimmerLayer    2 pre-masked noise Sprites, ticker-animated (see workarounds)
├─ landLayer       Container of land-tile Sprites + feature Sprites, row-major
├─ riversLayer     1 Graphics (smoothed polylines)
├─ territoryHost   Container; crossfade happens inside it
└─ citiesLayer     unchanged
```

~6.9k sprites sharing one atlas TextureSource → Pixi v8 batches fine. No
RenderTexture chunk-baking unless profiling demands it (follow-up only).

## Milestone 1 — Atlas foundation + sprite terrain ✅

- **`src/map/renderer/atlasLayout.ts`** — pure layout math + art-space
  constants (footprint 256×183, bleed 16, skirts m=136/h=62, canvas sizes,
  anchors, `computeAtlasLayout` shelf packing, `artHexCorners`). No pixi
  imports; Node-importable (used by the offline art script and tests).
- **`src/map/renderer/atlas.ts`** — manifest zod schema
  (`{footprintWidth, frames, base, features}`), `createTerrainAtlas`
  (memoized frame → `Texture`), `loadTerrainAtlas(renderer)`:
  fetch `terrain/atlas.json` + `Assets.load('terrain/atlas.png')`, on any
  failure fall back to `generateProceduralAtlas(renderer)`.
- **`src/map/renderer/proceduralAtlas.ts`** — placeholder art painted with
  Graphics (FillGradient bases, hash-jittered speckle, soft irregular hex
  edges, m/h skirts, per-code decorations, mountain massifs with lit/shadow
  faces + snow, hill mounds, tree clumps) rendered once into a RenderTexture.
  Variants: 3 per land code, 2 per sea code, 2 per feature.
- **`src/map/renderer/terrainSprites.ts`** — `buildTerrainLayers(atlas)`:
  variant via `hash01(col,row)`, position `tileIsoCenter` (keeps elevation
  lift), anchor from manifest, uniform scale `HEX_W / footprintWidth`.
  Row-major insertion; feature sprite (m/h always, g when `hash01 > 0.82`)
  appended immediately after its base tile.
- **`src/map/renderer/terrain.ts`** gutted to pure helpers: `terrainAt`,
  `isLandTile`, `hash01`, `variantIndex` (no pixi imports).
- **`src/map/MapCanvas.tsx`** — async atlas load, new layer stack,
  `territoryHost` container replaces `addChildAt(…, 1)` crossfade indexing.
  Dev-only `globalThis.__ercmDebug = { app, atlas }`.
- Tests: `tests/atlas.test.ts` (layout no-overlap/wrap/determinism, art-space
  constants vs ELEVATION, anchor invariants, variant pick determinism).

## Milestone 2 — Water shimmer ✅ (design revised, see workarounds)

**`src/map/renderer/water.ts`**: two world-sized noise textures with the
water mask **baked in at build time** (white sea hexes + river strokes,
inverted via `blendMode:'erase'` render passes). At runtime: two plain
Sprites, `blendMode:'add'`, alphas cross-fade in counter-phase + slow
breathing sine on the shared ticker. Zero runtime masking, zero extra draw
passes. `createShimmer(...)` returns `destroy()` to detach the ticker
callback (wired into MapCanvas cleanup).

## Milestone 3 — River data pipeline ✅

- `scripts/assets/terrain-config.json`: `"rivers": [{name, line:[[lon,lat],…]}]`
  for 10 rivers: Nile, Danube, Euphrates, Tigris, Halys, Po, Dnieper,
  Orontes, Maritsa, Sangarius (internal ids, not user-facing).
- `scripts/generate-tiles.mjs`: `traceRiver(line)` — densify (~0.08°), snap
  samples via `lonLatToTile`, bridge skips with greedy `neighbors()` steps,
  stop at first D/s tile (mouth). Output `{cols, rows, terrain, rivers}`;
  the 5040-char terrain string untouched. Idempotent (verified by hash).
- `src/data/schema.ts`: `RiverSchema` (name + `path` of `[col,row]` tuples,
  min 2); `TilesFileSchema` extended.
- `tests/data.test.ts`: ≥6 rivers, unique names, path tiles in grid,
  consecutive tiles adjacent via `neighbors()`.

## Milestone 4 — River rendering ✅

**`src/map/renderer/rivers.ts`** — `buildRiversGraphics()`: elevation-aware
points (`tileIsoCenter`), quadratic midpoint smoothing, round caps/joins,
three passes: bank (w3.4 0x2c4a66 α.85), water (w2.0 0x3f6f9e), highlight
(w0.7 0x7fa8cc α.7). `strokeRiversMask(g)` strokes white channels into the
shimmer mask bake. Layer sits between landLayer and territoryHost.

## Milestone 5 — Territory readability + perf ✅

- `TERRITORY_FILL_ALPHA` 0.58 → 0.45 (textured ground reads through; gold
  borders unchanged). Verified visually at 330 and 976 snapshots.
- Perf sanity at min/max zoom done on software GL (llvmpipe) — numbers there
  are not GPU-representative. Chunked `cacheAsTexture` remains a documented
  follow-up only if real-GPU profiling demands it.

## Milestone 6 — Real-art pipeline (offline) ✅

- **`docs/terrain-art-spec.md`** — full contract: pre-squashed iso pointy-top
  hex, footprint 256×183, canvases 288×224 / 288×286 / 288×360 / 288×352,
  skirt = ELEVATION × 12.32 art px/world px, NW light, transparent bg,
  naming `base/<code>_<n>.png` + `feature/{m,h,tree}_<n>.png`, palette
  anchored to `TERRAIN_COLORS`, per-terrain prompts + QA checklist.
  ("byzantine art style" allowed as style note only, per Rule #1.)
- **`scripts/process-terrain-art.mjs`** (+ `sharp` devDep, `npm run
  art:process`): gitignored `art-src/**.png` → resize → feathered hex-mask
  composite (SVG blur + `dest-in`) → shelf-packed atlas (reuses
  `computeAtlasLayout`) → `public/terrain/atlas.png` + `atlas.json` +
  `contact-sheet.png`. Requires ≥1 variant per code/feature (manifest schema
  demands it); errors listing what's missing. Validated end-to-end with
  dummy PNGs.

## Milestone 7 — Verification ✅

1. `npm test` — 87/87; `hex.test.ts` byte-identical.
2. `node scripts/generate-tiles.mjs` idempotent (identical sha across runs).
3. `npm run build` clean; build does not require `public/terrain/`.
4. Visual sweep (agent-browser): textured terrain at min/max zoom, mountains
   and hills read as 3D, sea shimmers (pixel-diff verified over sea only),
   rivers wind to coast, 550ms crossfade OK, markers aligned, pan/zoom OK.

## Follow-ups (not in scope)

- Real AI-generated art drop (user) → `npm run art:process`.
- Chunked `cacheAsTexture` for terrain layers if real-GPU profiling shows
  batching pressure.

---

## Known workarounds (hard-won, do not "simplify" away)

All discovered while verifying on headless Chromium with **llvmpipe software
GL**; the first three reproduce logically on any stack, the others may be
environment-sensitive. Mirrored in `water.ts` header comments.

1. **Pixi v8: a `Container` assigned as `.mask` renders nothing — silently.**
   The masked subtree just disappears with no warning. Masks must be a single
   `Graphics` or `Sprite`. (Bit us when the water mask was a Container of
   hex-fill Graphics + river-stroke Graphics; fix at the time was merging
   into one Graphics, later superseded by the baked-mask design.)

2. **Sprite alpha masks are screen-space and explode at high zoom.** Pixi
   implements sprite masks via per-frame RenderTextures sized to on-screen
   bounds. A world-sized masked layer at camera scale 6 wants a ~11k×3.8k px
   RT → exceeds texture limits → **entire layers (water) went black at max
   zoom**. Never runtime-mask world-sized content; bake instead.

3. **Baked-mask pattern** (`water.ts makeMaskedNoiseTexture`): render white
   world rect → erase water shapes (`blendMode:'erase'`, `clear:false`) →
   land-coverage RT; render noise → erase with land RT → pre-masked noise.
   Runtime is two plain additive Sprites with animated alpha. No masks, no
   per-frame RTs, works at every zoom.

4. **Pixi v8 `TilingSprite` silently failed to render inside the world
   container** (sprite-heavy subtree) while rendering fine as a direct stage
   child, on this GL stack. Isolated via A/B screenshots. Terrain/shimmer use
   plain `Sprite`s only.

5. **Graphics stencil masks are unreliable on software GL.** A hex-fill
   Graphics mask passed nothing; an axis-aligned rect mask "worked" only
   because pixi optimizes it into a scissor rect, which masked the bug.
   Don't use stencil masking here as evidence it works generally.

6. **Node-importable `.ts` chain**: `atlasLayout.ts` → `iso.ts` → `lib/hex.ts`
   use explicit `.ts` import extensions (`allowImportingTsExtensions` is on)
   so `scripts/process-terrain-art.mjs` can import the shared layout math
   under plain Node type-stripping. Keep extensions when touching these
   imports; keep `atlasLayout.ts` free of pixi imports.

7. **Vite dev SPA fallback**: `fetch('terrain/atlas.json')` for a missing
   file returns index.html with HTTP 200; the JSON parse throws and the
   catch falls back to the procedural atlas — this is the designed path, not
   an error to "fix".

8. **llvmpipe FPS is not real-world**: 15–30 FPS locally in headless
   software GL; a real GPU batches the ~6.9k-sprite scene trivially. Don't
   optimize against headless numbers.
