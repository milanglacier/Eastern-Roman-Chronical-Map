# Terrain Art Spec

Contract for the AI-generated terrain tile art. Drop finished PNGs into
`art-src/` (gitignored) and run `npm run art:process`; the script masks,
packs, and writes `public/terrain/atlas.png` + `atlas.json`, which the app
loads instead of the built-in procedural placeholder atlas. Nothing else in
the code changes — the manifest drives everything.

Style note: the target look is a painterly, byzantine-art-style strategy-map
tile set (rich color, mosaic-like texture, gold-leaf warmth). Style words are
fine in prompts; **never** name the *state* "Byzantium"/"Byzantine Empire" in
any copy — the polity is the Eastern Roman Empire (project Rule #1).

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
- Hill/mountain tiles: hex footprint center stays at (144, 112), same as flat
  tiles; the extra canvas extends **downward** only. The skirt is the visible
  southern "cliff face" of the raised tile (cool rock shadow, cf.
  `MOUNTAIN_SHADE 0x6c6c80`, `HILL_SHADE 0x6f6340`).
- Feature frames (mountain massif, hill mounds, tree clump): footprint center
  sits at (144, 240) — i.e. the bottom 224 px behave like a flat-tile canvas
  and the top 128 px are headroom for peaks/canopies. Features are rendered
  *on top of* their base tile, so they need transparent surroundings and
  should sit visually "on" the tile center.

## Light, edges, background

- Light from the **north-west** (upper-left). Shadows fall south-east.
- **Transparent background** (PNG alpha). No drop shadows outside the canvas.
- Tile edges must be soft/irregular (organic coastline of texture), not a
  crisp hex outline — neighbors overlap by the bleed, and the processing
  script additionally applies a feathered hex mask, so art that reaches the
  canvas edge is fine.
- Seams: neighboring tiles of the same terrain are placed at random from the
  variants, so keep large-scale luminance consistent between variants of a
  code (no variant much darker than its siblings).

## Naming & required set

```
art-src/
  base/<code>_<n>.png      code ∈ D s g p h m d      n = 0,1,2,...
  feature/<kind>_<n>.png   kind ∈ m h tree
```

At least one variant per base code and per feature kind is required (the
runtime manifest schema demands it); 3 variants per land code, 2 per sea
code, 2–3 per feature are recommended. The script packs whatever exists.

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

Common prefix: *"isometric strategy game terrain tile, pre-squashed pointy-top
hexagon, painterly byzantine art style, soft NW sunlight, transparent
background, no outline, 288×224"* (adjust canvas per kind).

- **D deep sea** — dark lapis water, subtle depth variation, faint mosaic
  shimmer, no waves at edges.
- **s shallows** — turquoise-over-sand coastal water, gentle foam wisps,
  reads lighter than deep sea.
- **g grassland** — lush green meadow, small blotches of olive and gold,
  occasional wildflower flecks.
- **p plains** — dry golden farmland/steppe, faint furrow streaks, warm
  parchment tone.
- **h hills** (288×286) — rolling ochre mounds on the top face, southern
  cliff skirt in shaded earth filling the bottom 62 px.
- **m mountain** (288×360) — grey rocky plateau top, southern cliff skirt in
  cool `#6c6c80` rock filling the bottom 136 px.
- **d desert** — pale dune sand, crescent dune shadows, no vegetation.
- **feature m** (288×352) — cluster of 2–3 sharp peaks with snow caps, lit NW
  faces, shadowed SE faces, base fading out by the footprint edge.
- **feature h** (288×352) — 2–3 soft rounded hills with highlights.
- **feature tree** (288×352) — small clump of 4–6 Mediterranean trees
  (cypress/olive/pine mix), individual canopies readable at small scale.

## QA checklist (before running `art:process`)

- [ ] Canvas exactly the size for its kind; footprint area filled edge to edge.
- [ ] Background fully transparent (no white matte fringe).
- [ ] Iso squash baked in — hex looks ~1.4× wider than tall.
- [ ] Light from NW on every frame.
- [ ] Skirt present and tonally darker than the top face (h/m bases).
- [ ] Variants of one code match in overall brightness.
- [ ] Features readable when scaled down ~12× (zoomed-out map).
- [ ] File names match `base/<code>_<n>.png` / `feature/{m,h,tree}_<n>.png`.

Then: `npm run art:process` → inspect `public/terrain/contact-sheet.png` →
`npm run dev` and verify in the browser (the app silently falls back to the
procedural atlas if the manifest is missing or invalid).
