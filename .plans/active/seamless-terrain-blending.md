# Seamless Terrain: Organic Masks, Edge Blending, Macro Tint

## Context

The real terrain atlas (commit f371fef) renders, but the map reads as discrete
pasted hexes (贴图感太强). Verified visually (browser screenshots + contact
sheet), the causes are ~half art, ~half architecture:

1. **Source art** — the AI drew each tile as a 3D hex *game piece*: crisp
   silhouette, painted bevels/vignette even on flat tiles. The mask can't
   remove borders painted *inside* the footprint → honeycomb lattice even
   across uniform terrain.
2. **1 variant per code/feature** — every tile of a code is pixel-identical
   (cloned mountain rows).
3. **Straight-edged hex mask**, feather σ=4 art px ≈ 0.3 world px, only 12 px
   overlap → straight seams.
4. **No cross-terrain blending** — grass→desert, sea→coast are hard hex-edge
   color jumps.
5. **No macro-scale variation** — uniform regions look like wallpaper.
6. **No mipmaps** on the atlas → aliasing shimmer at low zoom (256 px art
   minified ~12×).

**Confirmed decisions** (full package, Civ5-style *baked* blending):
pipeline upgrades that work with the current 10 source PNGs + runtime baked
edge-blend overlays + macro tint + mipmaps + art-spec rewrite so the source
art can be regenerated later. No shaders/filters/runtime masks (see
pixi-gotchas on this GL stack) — everything baked offline via sharp, runtime
adds only plain static sprites.

**Reused plumbing** (verified): `edgeNeighbor(col,row,edge 0..5)`
`src/map/iso.ts:79` (edge k = corners k→k+1 = E,SE,SW,W,NW,NE — same order as
`artHexCorners`), `inGrid` `src/lib/hex.ts:45`, `artHexCorners(grow)` + shelf
packer in `src/map/renderer/atlasLayout.ts`, pixi 8.19
`Assets.load({src, data:{autoGenerateMipmaps:true}})` self-degrades on
WebGL1/NPOT.

Boundary census on the real map (5040 tiles): **3,550 overlay edges** on
1,616 tiles with the priority below; only 5 source codes blend → **30 strip
frames**.

## Design decisions

- **Blend priority**: `BLEND_PRIORITY = { g:6, p:5, d:4, h:3, s:2, D:1 }`;
  the higher code invades the lower across a shared edge. **`m` excluded
  entirely** (skirted frames, always feature-covered, 11 px lift mismatch —
  its crisp cliff IS the mountain transition). Land-over-`s` = beaches,
  `s`-over-`D` = coastal shelf. Features never blend.
- **Strips baked at art:process time**, tight-cropped (E/W ≈ 108×132,
  diagonals ≈ 188×154 → ~0.7 MP total). Their anchors fall outside [0,1] →
  schema relax needed.
- **Variant augmentation**: from each source PNG derive `f` (flop), `j`
  (hue/brightness jitter), `fj`; fill to targets 6 land / 4 sea / 4 feature
  (features jitter-only — flipping NW-lit 3D forms is wrong; h/m bases MAY
  flop, the skirt is symmetric). Today's 1-source art → 4 variants per code
  with zero new hand-made art.
- **Organic masks**: grow 16 (full BLEED), blur σ=6, multiplied by low-freq
  value noise (mulberry32-seeded per frame name, 9×7 grid cubic-upscaled),
  `lighten`-composited with an opaque core so interiors never thin. No
  feTurbulence (librsvg unreliable) — pure raster math.
- **Macro tint**: `public/terrain/macro-tint.png`, 1024×342 (world aspect
  ≈ 2.99), near-white noise (luma 232–255, ±3 per-channel), deterministic
  seed. Runtime: ONE plain Sprite, `blendMode:'multiply'`, alpha 0.85
  (≈ ±4–7% darken-only mottling; `overlay` would need forbidden filter blend
  modes), stretched to `WORLD_W × WORLD_H*ISO_SQUASH`, covers sea too.
- **Manifest**: optional `transitions: Record<code, string[6]>` — the old
  committed atlas.json AND the procedural manifest stay valid; runtime skips
  overlays when absent. Macro tint loaded independently with catch→null
  (Vite-404-serves-HTML safe, same robustness path as the atlas loader).

## Implementation steps (ordered)

1. **`src/map/renderer/atlasLayout.ts`** (pure) — add `TRANS_BAND=64`,
   `TRANS_OUT=BLEED`, `TRANS_BLUR=8`, `TRANS_PAD=20`;
   `transitionGeometry(edge) → {a, b, normal, crop, anchorX, anchorY}`
   (corners from `artHexCorners(0)`, outward normal via `dot(n, mid) > 0`,
   crop = padded band bbox clamped to the flat canvas 288×224, anchor =
   footprint center (144,112) relative to crop); shared `hashStringSeed()`
   (FNV) + `mulberry32()`.
2. **`src/map/renderer/terrain.ts`** (pure, no pixi) — `BLEND_PRIORITY`;
   `transitionsFor(col,row) → {edge, code}[]` using `edgeNeighbor` + `inGrid`
   + `terrainAt`: push the neighbor's code iff both codes are in the table
   and `pri[N] > pri[T]`.
3. **`tests/transitions.test.ts`** — full-map scan (edges 0..5, no `m` on
   either side, deterministic, count > 3000); `transitionGeometry` invariants
   (crop in-canvas, unit outward normals, `crop.x + anchorX*crop.w ≈ 144`);
   schema: manifest without `transitions` parses, valid 6-array parses,
   5-array fails, out-of-[0,1] anchors accepted, `validateFrameRefs` rejects
   a dangling transition ref; parse the committed `public/terrain/atlas.json`
   when present. `tests/hex.test.ts` stays byte-identical.
4. **`src/map/renderer/atlas.ts`** — relax `anchorX/anchorY` to
   `z.number().finite()`; add optional `transitions` + include it in
   `validateFrameRefs`; load the atlas via
   `Assets.load({src:'terrain/atlas.png', data:{autoGenerateMipmaps:true}})`
   (scaleMode already linear; do NOT touch the procedural RenderTexture);
   add `loadMacroTintTexture(): Promise<Texture|null>` (catch → null).
5. **`scripts/process-terrain-art.mjs`** (biggest chunk) —
   - `organicAlphaMask({w,h,shapeSvg,coreSvg,seed,…})` helper (blurred shape
     ramp × cubic-upscaled noise, `.linear(gain,0)`, `lighten` core, joined
     as alpha; `dest-in` keys on alpha).
   - Base masking: replace the `MASK_FEATHER=4` straight `maskSvg` path →
     grow-16/σ-6 organic mask, per-variant seed.
   - Augmentation: expand each source to `f/j/fj` (deterministic jitter via
     `.modulate()`, halved amplitude for D/s; features jitter-only), fill to
     targets 6/4/4; manifest `base`/`features` arrays just grow (runtime
     `variantIndex` already handles any length).
   - Strips: for `{g,p,d,h,s}` × 6 edges, sample `<code>_0` art (h: resize to
     hill canvas 288×286 then `extract` the top 288×224 so the skirt can
     never bleed), mask with a gradient-band SVG (full alpha from +TRANS_OUT
     past the edge, S-curve to 0 at −TRANS_BAND, σ=8 blur) × noise,
     `extract(crop)`, emit `trans/<code>_<edge>` frames + manifest
     `transitions`.
   - Macro tint generation (fixed seed, idempotent) →
     `public/terrain/macro-tint.png`.
   - Packing: sort order gains `trans:4`; warn if atlas height > 4096
     (est. ~2048×1850 now, ~2550 with future 3-variant art).
6. **Run `npm run art:process`** (current 1-variant art must keep working);
   inspect the contact sheet; run twice → identical hashes (determinism).
7. **`src/map/renderer/terrainSprites.ts`** — inside the row-major loop, per
   tile: base → overlays → feature. Overlay =
   `makeSprite(transitions[code][edge], col, row, T's code)` (rides the
   receiver's elevation via `tileIsoCenter`); container chosen by SOURCE
   code: land-source overlays → `land` (beaches render above shimmer),
   `s`-source → `water` (shelf below shimmer). Skip the pass when
   `manifest.transitions` is absent.
8. **`src/map/MapCanvas.tsx`** — await `loadMacroTintTexture()`; if non-null
   insert the multiply Sprite between `land` and rivers: stack becomes
   water → shimmer → land → **macro** → rivers → territoryHost → cities.
9. **`docs/terrain-art-spec.md` rewrite** (prompts + QA; geometry/naming/
   palette tables stay):
   - Core rule: every flat frame = "window cut from continuous terrain" —
     texture edge-to-edge and off-canvas; NO hex silhouette, bevel, rim
     light, vignette, or 3D thickness. Only h/m southern skirts remain as
     permitted "edges".
   - New prompt prefix ("seamless painterly terrain texture … pattern
     continues past every edge, no border, no tile shape").
   - Variants 3 land / 2 sea / 2–3 feature; note that the script auto-derives
     flip/jitter variants so few hand-made ones suffice; avoid
     mirrored-implausible directional forms; luminance match ±5% as hard QA
     (strips sample `_0`).
   - QA deltas: drop "soft/irregular tile edges" (the mask's job now); add
     "no landmark motifs that reveal repetition", "consistent texture scale
     across codes". Rule #1 language untouched.

## Verification

- `npm test` green; `tests/hex.test.ts` byte-identical;
  `scripts/generate-tiles.mjs` untouched.
- `npm run art:process` ×2 → identical sha256 (atlas.png, atlas.json,
  macro-tint.png); contact sheet: organic wobbling silhouettes, 4 distinct
  variants per code, 30 strips, no skirt pixels in h strips.
- Dev server + `agent-browser-wrapped` screenshots at min zoom / ~2× / ~5×:
  no honeycomb lattice on uniform regions; soft g/p and desert borders;
  beaches + coastal shelf visible; mountains keep crisp cliffs; no sparkle on
  beach strips; macro mottling at low zoom; no minification shimmer.
- Fallback drill: rename `public/terrain/atlas.json` → procedural atlas
  renders without overlays, macro still applies, no console errors; restore.
- llvmpipe FPS is unrepresentative — only check the scene stays a single
  batched static atlas.

## Out of scope / follow-ups

- Regenerating the AI art itself (user does this against the rewritten spec;
  pipeline + overlays already improve the current art meaningfully).
- Continuous single-texture ocean, river-bank blending, feature drop
  shadows — revisit after new art lands.
