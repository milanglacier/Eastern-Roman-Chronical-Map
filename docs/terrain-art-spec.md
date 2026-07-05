# Terrain Art Spec

Contract for the AI-generated terrain tile art. Drop finished PNGs into
`art-src/` (gitignored) and run `npm run art:process`; the script masks,
augments, packs, and writes `public/terrain/atlas.png` + `atlas.json` (plus
`macro-tint.png`), which the app loads instead of the built-in procedural
placeholder atlas. Nothing else in the code changes — the manifest drives
everything.

Style note: the target look is a painterly, byzantine-art-style strategy-map
tile set (rich color, mosaic-like texture, gold-leaf warmth). Style words are
fine in prompts; **never** name the *state* "Byzantium"/"Byzantine Empire" in
any copy — the polity is the Eastern Roman Empire (project Rule #1).

## Core rule: a window, not a game piece

Every flat frame is a **window cut from an endless stretch of terrain**, not
a hex-shaped object. The processing script cuts the organic hex silhouette
itself and bakes cross-terrain blends — the art must give it continuous
material to cut from:

- Texture runs **edge to edge and implicitly past every canvas edge** — paint
  as if the canvas were cropped out of a much larger landscape.
- **NO hex silhouette, no outline, no bevel, no rim light, no vignette, no
  3D slab/thickness, no darkened border** anywhere inside the frame. If the
  tile shape is visible in the art itself, the map shows a honeycomb lattice
  that no mask can remove.
- No transparent margins on flat frames — fill the whole canvas.
- The only permitted "edge" in the whole set: the **southern cliff skirt** of
  hill/mountain base tiles (below the footprint, see geometry). Its crisp
  face is deliberate — it reads as relief, and for mountains it IS the
  terrain transition.
- Feature frames (peaks, mounds, trees) are the opposite: freestanding
  objects on a fully transparent background.

## Geometry (all sizes in px, art is pre-squashed isometric)

The isometric squash is **baked into the art**. Tiles are pointy-top hexes
already flattened to the map's 0.62 vertical squash — do not draw upright
hexes.

| Constant            | Value     | Meaning                                        |
| ------------------- | --------- | ---------------------------------------------- |
| Footprint           | 256 × 183 | The hex footprint (flat-to-flat × squashed height) |
| Bleed               | ≤ 16      | Art may run past the footprint on every side   |
| Flat tile canvas    | 288 × 224 | Footprint centered (center at 144, 112)        |
| Hill tile canvas    | 288 × 286 | Flat canvas + 62 px skirt below                |
| Mountain tile canvas| 288 × 360 | Flat canvas + 136 px skirt below               |
| Feature canvas      | 288 × 352 | Flat-tile box at the bottom, 128 px headroom   |

- Scale: 256 art px = one hex width (≈20.78 world px) → **12.32 art px per
  world px**. The skirts equal the engine's elevation lifts (m = 11, h = 5
  world px → 136 / 62 art px).
- Hill/mountain tiles: the **top face** follows the window rule above
  (continuous rock/mound texture, no hex shape); only the bottom 62 / 136 px
  are the southern cliff skirt (cool rock shadow, cf. `MOUNTAIN_SHADE
  0x6c6c80`, `HILL_SHADE 0x6f6340`), tonally darker than the top face.
- Feature frames (mountain massif, hill mounds, tree clump): footprint center
  sits at (144, 240) — i.e. the bottom 224 px behave like a flat-tile canvas
  and the top 128 px are headroom for peaks/canopies. Features are rendered
  *on top of* their base tile, so they need transparent surroundings and
  should sit visually "on" the tile center.

## Light and background

- Light from the **north-west** (upper-left). Shadows fall south-east.
- Flat frames: opaque, texture filling the whole canvas (see core rule).
  Feature frames: transparent background (PNG alpha), no drop shadows outside
  the canvas.
- Neighboring tiles of the same terrain are placed at random from the
  variants and overlap by the bleed, so keep large-scale luminance consistent
  between variants of a code — **±5% average luminance is a hard limit**
  (transition strips sample `_0`, so a bright `_1` next to a `_0`-textured
  blend seam will show).

## Naming & required set

```
art-src/
  base/<code>_<n>.png      code ∈ D s g p h m d      n = 0,1,2,...
  feature/<kind>_<n>.png   kind ∈ m h tree
```

At least one variant per base code and per feature kind is required (the
runtime manifest schema demands it). Recommended hand-made counts: **3 per
land code, 2 per sea code, 2–3 per feature** — the script then auto-derives
flipped (`f`), color-jittered (`j`) and flip+jitter (`fj`) variants up to 6
land / 4 sea / 4 feature, so a few hand-made sources go a long way (even a
single source yields 4 on-map variants).

Because base tiles may be auto-flipped: avoid strongly directional motifs
that would look wrong mirrored (readable script-like marks, a river-bank
running through, a single dominant landmark). Features are never flipped
(their NW-lit 3D forms would break), only jittered.

Avoid unique landmark motifs in base tiles altogether — a lone ruin, an odd
rock — anything the eye can spot twice reveals the repetition. Keep texture
element size (tufts, dunes, waves) at a consistent physical scale across all
codes so adjacent terrains read as one landscape.

## Palette anchors (`src/map/colors.ts`)

Keep the average tile color near these so the territory tint and UI hold up:

| Code | Terrain          | Anchor      |
| ---- | ---------------- | ----------- |
| D    | deep sea         | `#1c2f52`   |
| s    | coastal shallows | `#2f5178`   |
| g    | grassland        | `#6f9c52`   |
| p    | plains           | `#b3a05f`   |
| h    | hills            | `#8c7f4e`   |
| m    | mountain rock    | `#8f8fa0`   |
| d    | desert sand      | `#d7c189`   |

Accents: snow `#eceef5`, sea foam/ripple `#4a6f97`, gold `#d8b64a`.

## Per-terrain prompt suggestions

Common prefix for flat/base frames: *"seamless painterly terrain texture,
top-down slightly isometric strategy map, byzantine art style, soft NW
sunlight, the pattern continues past every edge of the image, no border, no
outline, no tile shape, no vignette, 288×224"* (adjust canvas per kind).
Feature frames keep the old object-style prompt (transparent background).

- **D deep sea** — dark lapis water, subtle depth variation, faint mosaic
  shimmer; uniform coverage, no shoreline, no waves fading at edges.
- **s shallows** — turquoise-over-sand coastal water, scattered gentle foam
  wisps, reads lighter than deep sea; no beach, no shoreline — just shallow
  water everywhere.
- **g grassland** — lush green meadow, small blotches of olive and gold,
  occasional wildflower flecks, even coverage corner to corner.
- **p plains** — dry golden farmland/steppe, faint furrow streaks, warm
  parchment tone, furrows running off the canvas.
- **h hills** (288×286) — top 224 px: continuous rolling ochre mound texture
  (no hex shape); bottom 62 px: southern cliff skirt in shaded earth.
- **m mountain** (288×360) — top 224 px: continuous grey rocky plateau
  texture; bottom 136 px: southern cliff skirt in cool `#6c6c80` rock.
- **d desert** — pale dune sand, crescent dune shadows repeating off-canvas,
  no vegetation.
- **feature m** (288×352) — cluster of 2–3 sharp peaks with snow caps, lit NW
  faces, shadowed SE faces, base fading out by the footprint edge.
- **feature h** (288×352) — 2–3 soft rounded hills with highlights.
- **feature tree** (288×352) — small clump of 4–6 Mediterranean trees
  (cypress/olive/pine mix), individual canopies readable at small scale.

## QA checklist (before running `art:process`)

- [ ] Canvas exactly the size for its kind; flat frames filled edge to edge.
- [ ] **No visible tile shape**: no hex outline, bevel, rim light, vignette,
      or darkened border anywhere in a flat frame / a raised tile's top face.
- [ ] Texture would tile on in every direction if the canvas were larger.
- [ ] Iso squash baked in (relevant to skirts/features; flat texture is
      simply top-down).
- [ ] Light from NW on every frame.
- [ ] Skirt present and tonally darker than the top face (h/m bases).
- [ ] Variants of one code within ±5% average luminance of `_0`.
- [ ] No landmark motifs that reveal repetition; no strongly directional
      marks that would look wrong auto-flipped.
- [ ] Texture element scale consistent across codes.
- [ ] Features readable when scaled down ~12× (zoomed-out map); transparent
      background, no white matte fringe.
- [ ] File names match `base/<code>_<n>.png` / `feature/{m,h,tree}_<n>.png`.

Then: `npm run art:process` → inspect `public/terrain/contact-sheet.png`
(organic wobbling silhouettes, derived `f`/`j`/`fj` variants, 30 `trans/*`
blend strips, macro tint) → `npm run dev` and verify in the browser (the app
silently falls back to the procedural atlas if the manifest is missing or
invalid).
