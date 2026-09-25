# Art direction: the painted diorama

The map is a **painted diorama** of the Roman East: a gouache or oil matte painting
that happens to be three-dimensional. It is not a satellite globe, and it is not a
strategy-game board. Every visual decision is checked against one question:

> Would this frame look at home as a concept-art painting for a historical film?

## Hard rules

1. **No satellite colour, no photo textures.** All land colour comes from a hand-tuned
   palette (below), baked by `scripts/build-world-textures.mjs`. A CC0 photo texture
   never goes straight onto terrain.
2. **Low saturation, atmospheric perspective.** Saturation lives in the foreground
   and fades with distance into the era's haze colour. Distant ranges read as layered
   silhouettes, not as detail.
3. **Light tells the era.** Every era has a mood keyframe (`src/data/moods.json`):
   sun height and colour, sky gradient, haze and colour grade. The empire's arc is told
   through light, from dawn in 330 to a moonlit night in 1453.
4. **No saturated red-roof carpets.** City roofs are muted terracotta and limewash,
   and they sit under the same haze as the land. Landmarks carry the silhouette;
   the house mass is texture.
5. **Painted, not toy.** Geometry can be simple, but it must go through the paint
   pass: Kuwahara, ink edges and paper grain. Flat untextured primitives under
   hard lighting read as toys.
6. **Ink and gold for information.** Borders, rivers and the frontier are inked
   lines with a gold edge, like a manuscript map. Neither glowing neon strips nor
   flat fills.
7. **Rule #1 still applies.** The state is the Eastern Roman Empire / Rome,
   never "Byzantine".

## Palette (sRGB)

| Role | Hex | Notes |
|---|---|---|
| Deep sea | `#17304e` | ultramarine, never black |
| Open sea | `#23466a` | |
| Shelf sea | `#3a7f86` | turquoise glaze near coasts |
| Lagoon / shallows | `#6aa99c` | |
| Beach | `#e2cf9e` | thin cream rim |
| Northern forest | `#4b6440` | deep olive-green |
| Meadow | `#6f8a4e` | sage |
| Mediterranean scrub | `#98945a` | olive-ochre |
| Steppe / plateau | `#c1aa6d` | straw |
| Desert | `#d8b073` | ochre |
| Dune shadow | `#c28a55` | sienna |
| Rock | `#8e8391` | lavender-grey |
| High rock | `#a79a96` | warm grey |
| Snow | `#f2ecdf` | cream; shadows go lavender |
| Ink | `#3b2a22` | umber, for coasts, edges and frontier core |
| Imperial wash | `#6b2fa0` | watercolour glaze, ≤ 0.3 |
| Gilt | `#d8b64a` | frontier edge, titles |

Painted ambient occlusion shifts colour rather than darkening: ridges go toward
ochre `#d9b980` and hollows toward violet-umber `#5a4658`, with a darkening cap of
about 20%.

## Mood keyframes

| Year | Mood | Light |
|---|---|---|
| 330 | Rose dawn | low sun from the east, pink-gold haze |
| 537 | Golden age | warm afternoon, clear air |
| 626 | Storm | overcast, grey-green haze, low saturation |
| 843 | Restoration | cool clear morning |
| 1025 | Zenith | bright gold |
| 1071 | Overcast | Manzikert, the plateau lost |
| 1204 | Crimson dusk | sun on the horizon, smoke haze |
| 1261 | Pale dawn | restoration |
| 1400 | Autumn | muted, cool |
| 1453 | Night | moonlight, city lamps and fires |

## Post-processing stack

1. **Anisotropic Kuwahara** at half resolution: the brushstroke look. Its strength is
   weighted by depth, so the near field keeps legible detail.
2. **Bloom:** only lamps, fires and the sun glint on water.
3. **Composite:**
   - tilt-shift depth of field (a miniature feel at low pitch)
   - umber ink edges from depth and normals
   - screen-fixed paper grain
   - era colour grade
   - vignette
   - letterbox during cinematic moves

The low tier on phones keeps only grade and grain; the painted bake must carry the
look alone.

## References (for mood, not for copying)

- Matte-painting concept art for historical epics: layered haze and a warm key over cool shadows
- Maxime Heckel, "On Crafting Painterly Shaders" (Kuwahara variants)
- Codrops, "Susurrus": a Kuwahara-only painterly world in three.js
- Illuminated portolan charts: inked coasts, gilded rhumb lines
