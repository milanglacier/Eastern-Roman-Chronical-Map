# Post-Art-Regen: Visual Polish Round (Ocean + Rivers + Shadows + Strip Scale)

## Context — visual review of the regenerated art (2026-07-05)

Reviewed the new terrain in the browser at min zoom, 3× and 6×, across the
Aegean, Italy, North Africa, central Europe, and the eastern frontier.

**The art regeneration succeeded.** Untinted regions (outside the 330 AD
border, e.g. east of Antioch) look genuinely good: no honeycomb lattice on
uniform grass/desert, soft organic grass↔desert borders, beaches and coastal
shelf render cleanly, mountains keep crisp cliffs, no sparkle or visible
texture-scale jump in blend strips at any zoom. The committed
`public/terrain/atlas.png` + `contact-sheet.png` deltas are good to keep.

**Remaining beauty gaps, ranked by visual impact:**

1. **Deep ocean is flat** — per-tile D sprites read as a uniform blue field;
   only the shimmer animates it.
2. **Rivers are hard-edged ribbons** — 3-pass constant-width strokes
   (`src/map/renderer/rivers.ts:11-13`) with no bank softening.
3. **Features float** — trees/hills/mountains have no ground shadow.
4. (Minor, invisible in practice) blend strips sample the central half of
   sources stretched 2× — a workaround for the old rimmed art
   (`scripts/process-terrain-art.mjs:353` `stripArt()`).

Also observed: the purple territory wash (`TERRITORY_FILL_ALPHA = 0.45`,
`src/map/colors.ts:24`) mutes the terrain inside imperial borders. **User
decided to keep the current territory look** — explicitly out of scope for
this round.

## Steps (ordered by impact)

### 0. Housekeeping — land the verified art

- Commit `public/terrain/atlas.png` + `contact-sheet.png`
  (`feat: regenerate terrain art against seamless spec`).
- `git mv .plans/active/seamless-terrain-blending.md .plans/completed/`.

### 1. Continuous deep ocean

Kill the tiled look of open water:

- `art:process` gains an `ocean.png` sheet: world-aspect (~1024×342 like
  macro-tint), seamless painterly deep-water noise derived from the D/s
  palette, deterministic seed, written to `public/terrain/`.
- Runtime (`terrainSprites.ts` + `MapCanvas.tsx`): render ONE plain Sprite
  stretched to `WORLD_W × WORLD_H*ISO_SQUASH` at the bottom of the water
  layer and **skip per-tile sprites for `D` tiles only** (s shelf tiles stay;
  s-over-D shelf strips already live on the water layer and now blend into
  the sheet). Loader mirrors `loadMacroTintTexture()` (catch → null; if null,
  keep per-tile D sprites — procedural fallback path unchanged).
- Drops ~1–2k sprites as a bonus. No masks, no TilingSprite (gotchas).

### 2. River-bank softening

No shader/filter blur available on this GL stack, so feather with layered
strokes in `rivers.ts`: two extra underlay passes before BANK (e.g. width
6.0 alpha 0.15, width 4.6 alpha 0.25, bank color) → soft gradient banks.
Keep the shimmer mask stroke as-is. Tune widths at 3× zoom.

### 3. Feature drop shadows (baked)

In `process-terrain-art.mjs` feature processing: extract feature alpha,
blur σ≈5, tint black ~35%, offset SE (+6,+8 art px — NW light per spec),
composite UNDER the feature art before packing. Zero runtime cost; feature
frame bboxes grow slightly (packer + anchors already handle arbitrary
sizes). Verify no clipping at canvas edges (pad crop if needed).

### 4. Full-canvas strip sampling (spec consistency, lowest priority)

`stripArt()`: replace central-half extract + 2× mitchell upscale with a
plain cover-resize of the full (now rim-free) source; `h` keeps its skirt
guard (resize to hill canvas 288×286, extract top 288×224). Update the
function comment. Review found no visible mismatch, so this is
housekeeping — do it last, in the same art:process run as step 3 to avoid
churning the atlas twice.

## Verification

- After each visual step: dev server + `agent-browser-wrapped` screenshots
  at min / 3× / 6× (camera via `globalThis.__ercmDebug` world container —
  set scale + position directly; wheel/pointer event dispatch also works).
  Judge: ocean untiled, river banks soft, shadows ground the features,
  territory styling unchanged.
- `npm run art:process` ×2 → identical sha256 (determinism preserved for
  ocean.png + shadowed features); `npm test` green; `tests/hex.test.ts`
  byte-identical.
- Fallback drill once at the end: rename `public/terrain/atlas.json` →
  procedural atlas + no ocean sheet still renders, no console errors.
- Update auto-memory: art-src note ("hex game-pieces with painted rims") is
  stale — new art is seamless; strips now full-canvas; layer stack gains
  the ocean sheet.

## Out of scope

- Territory overlay styling (user decision: keep current look).
- Regenerating source art again; territory *data* changes; performance work
  (llvmpipe FPS unrepresentative).
