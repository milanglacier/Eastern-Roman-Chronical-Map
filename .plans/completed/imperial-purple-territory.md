# Restore Imperial-Purple Territory Rendering on the 3D Terrain

## Context

The old PixiJS hex map rendered the empire as an **imperial purple `#6B2FA0` fill @ 0.45 alpha**
with a **crisp mosaic-gold border** (`#D8B64A` @ 0.95, ~1.6px stroke). The 3D rework commit
(93a7607) replaced that with a subtle warm-mauve diffuse tint (`#9A4A7A` @ 0.18) plus a soft
7px pulsing gold glow — this reads as a muddy stain, and we want the purple identity back.

**Decisions (confirmed):** fill = faithful old boldness (`#6B2FA0` @ ~0.45); border = crisp
~2px gold line + faint halo + gentle pulse.

**Load-bearing discovery:** territory GeoJSONs slop far over sea (e.g. `territories/555.json`
Balkan polygon spans lon 18.8–29.8 × lat 36.0–45.4 — the whole Aegean). The old renderer only
tinted *land* tiles; the current drape tints everything under the polygon, so at 0.45 the
seabed would glow purple through shallow water and frontier lines would run offshore.
**The mask must be clipped to land.**

**Exact land test available at runtime:** the bake clamps all land to ≥ +4 m (`LAND_MIN_M`,
`scripts/build-world-textures.mjs:65`), river incision floors at +4 m
(`Math.max(heights[i] - cut, LAND_MIN_M)`), and straits/sea are carved < 0. So
`heightField.heightAt(lon, lat) > 0` ⇔ land — no river holes, no threshold ambiguity.
No rebake needed; this is a pure runtime change.

## Changes

### 1. `src/map/colors.ts` — restore constants
- `TERRITORY_TINT`: `0x9a4a7a` → `0x6b2fa0` (imperial purple)
- `TERRITORY_TINT_STRENGTH`: `0.18` → `0.45`
- Rewrite the stale "warm Tyrian-leaning… strength kept low" comment.
- `src/ui/Legend.tsx` reads `TERRITORY_TINT` → legend swatch follows automatically (no edit).

### 2. `src/map/three/territory.ts` — clip the mask to land at raster time
- `createTerritoryController(uniforms, heightField)` — new param; the call site
  `src/map/MapCanvas.tsx:101` already has `heightField` in scope.
- Build **once per controller** a 1024×442 land mask (`Uint8Array`): per texel, 2×2
  supersample of `heightAt(lon, lat) > 0`, averaged → antialiased coast. Texel→lon/lat is
  the inverse of the linear map in `multiPolygonToPixelRings`.
- In `rasterizeTerritory`, after reading the canvas alpha:
  `mask[i] = round(mask[i] * land[i] / 255)`, **then** run the existing EDT. Both the purple
  fill and the gold frontier now hug coastlines — matching the old hex behavior where coastal
  boundary tiles got gold strokes (carved straits are sea, so e.g. the Bosporus gets a gold
  line on each shore).
- **Fallback safety:** if the land mask is all zeros (missing heightmap →
  `fallbackHeightField()`, flat 0 m), skip clipping so territory never vanishes.
- Export the pure parts for jsdom tests (`buildLandMask(w, h, isLand)` taking an
  `(lon, lat) => boolean` predicate, plus the clip step), following the existing
  `multiPolygonToPixelRings` pattern.

### 3. `src/map/three/terrain.ts` — shader: bold fill, crisp gold line + faint halo
In the `onBeforeCompile` injections (`map_fragment`, `emissivemap_fragment`; both live in the
same `main()` scope — the existing code already relies on this):

- Sample the two slots separately and threshold **per slot**, so the line stays crisp
  mid-crossfade instead of dissolving.
- **Implementation note (revised during the screenshot pass):** the planned
  texture-space threshold on G (`smoothstep(0.45, 0.8, g)`) produced a line of fixed
  *world* width (~2 texels ≈ 13 km) that fattened into a wide ribbon at close zoom.
  Shipped instead as an **fwidth-adaptive iso-contour of the inside mask** — `r = 0.5`
  lies exactly on the frontier, so
  `1.0 - smoothstep(0.0, min(fwidth(r) * 1.6, 0.35) + 0.001, abs(r - 0.5))`
  holds a ~2–3 *screen*-px line at every zoom (the cap keeps extreme far zoom from
  washing the interior gold; computed per slot A/B, then mixed).
- Fill formula unchanged —
  `diffuseColor.rgb = mix(diffuseColor.rgb, uTerritoryTint, territory.r * uTerritoryStrength);`
  — now purple @ 0.45; lighting applies after the mix, so sun/shadow relief still shades the
  purple.
- Emissive border — crisp core dominant, halo faint, pulse gentler than today:
  ```glsl
  float borderPulse = 0.92 + 0.08 * sin(uTime * 1.6);
  totalEmissiveRadiance += uBorderColor * (borderLine + territory.g * territory.g * 0.2)
                           * uBorderIntensity * borderPulse;
  ```
  Keep `uBorderIntensity` at 0.9; all numbers above are tuning knobs for the screenshot pass.

### 4. `docs/terrain-3d-spec.md` — update territory bullets
- Tint description → imperial purple fill + crisp gold frontier line.
- RG8 description → "R = **land-clipped** inside mask (clipped against the runtime
  heightfield, height > 0), G = frontier glow".

### 5. `tests/territory.test.ts` — cover the new pure helpers
- `buildLandMask` with a synthetic predicate (e.g. `lon < 20` is land): supersampled byte
  values, antialiased boundary column.
- Clip step: sea pixels zeroed, land pixels preserved; all-zero land mask ⇒ clip skipped
  (mask unchanged).
- Existing tests (ring conversion, holes, bbox bounds) stay untouched.

## Files touched
`src/map/colors.ts` · `src/map/three/territory.ts` · `src/map/three/terrain.ts` ·
`src/map/MapCanvas.tsx` (one line) · `docs/terrain-3d-spec.md` · `tests/territory.test.ts`

## Verification
1. `npm test` — existing + new tests pass.
2. `npm run dev` + `agent-browser-wrapped` — screenshots at **555, 1025, 1204, 1453**:
   - Empire reads unmistakably imperial purple **on land only**; Aegean/Med stay sea-blue
     (no purple seabed through shallows, no offshore glow rings).
   - Crisp gold line traces inland frontiers **and** coasts/islands; straits stay open water
     with gold on each shore.
   - Scrub the timeline: crossfade keeps lines crisp (per-slot thresholding), no popping.
   - Legend swatch now `#6B2FA0`.
3. Tune `TERRITORY_TINT_STRENGTH` (0.40–0.50), smoothstep bounds, halo factor,
   `uBorderIntensity` from screenshots.
4. `npm run build` sanity. Rule #1 untouched (no data/content changes).

## Outcome (2026-07-10)

Implemented and verified: 121/121 tests, clean build. Screenshot pass at 330 / 555 /
1025 / 1204 / 1453 confirmed purple-on-land-only (Aegean/Med stay blue), gold lines
tracing coasts + islands + inland frontiers, straits open with gold on each shore,
crisp line at all zooms (after the fwidth revision above), stable crossfades, and the
legend swatch following `TERRITORY_TINT` to `#6B2FA0`. Shipped values: tint `#6B2FA0`
@ 0.45, border pulse 0.92 ± 0.08, halo `g² × 0.2`, `uBorderIntensity` 0.9.
