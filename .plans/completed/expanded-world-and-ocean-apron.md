# Expand map bbox (Gaul/Germania/Britain/Persia) + kill the white out-of-map background

## Context

The map currently covers lon −12..46, lat 24..49 — Gaul's north, Germania, Britain, and Persia's heartland are cut off. At max zoom-out, the viewport exceeds the terrain rect and the pale sky color `0xb8c4cf` shows as ugly white. User decisions: expand to **lon −12..60, lat 24..59** (72°×35°; full British Isles, Iranian plateau to 60°E), and fill out-of-map areas with an **infinite ocean apron** plus a darker sky.

The bbox is canonical in `src/lib/hex.ts`; schema/geo/heightField auto-derive from it. Hardcoded copies live in `scripts/fetch-dem.mjs`, `scripts/fetch-coastline.mjs` (easy-to-miss blocker — without re-fetching the coastline, all new land bakes as ocean), and dimension constants in the bake script / territory / terrain mesh.

## 1. Constant changes

| File | Change |
|---|---|
| `src/lib/hex.ts:12-15` | `LON_MAX 46→60`, `LAT_MAX 49→59` (LON_MIN/LAT_MIN/COLS/ROWS unchanged) |
| `scripts/fetch-dem.mjs:28-29` | bbox copy → −12..60 / 24..59 (+PAD 1) |
| `scripts/fetch-coastline.mjs:15` | bbox copy → −12..60 / 24..59 (+PAD 2) |
| `scripts/build-world-textures.mjs:49-52` | `HM_W 2320→2880`, `HM_H 1000→1400` (keep 40 px/°); `ALB_W 8192` keep, `ALB_H 3532→3982` (8192×35/72; 8192 is the safe universal MAX_TEXTURE_SIZE) |
| `src/map/three/territory.ts:21-24` | `TERRITORY_TEX_H 442→498` (1024×35/72); `GLOW_PX 7→6` (px/unit drops 4.41→3.56) |
| `src/map/three/terrain.ts:27-28` | `SEGMENTS_X 928→1152`, `SEGMENTS_Z 400→560` (keeps 16 quads/°; ~1.29M tris — fine for real GPUs; fallback 864×420 if perf regresses) |
| `src/map/three/cameraRig.ts:11` | `DIST_MAX 175→220` (width framing: 144/tan(34.3° half-hfov @16:9) ≈ 211; also = 175 × 288/232) |
| `src/map/three/palette.ts:8` | `SKY_COLOR 0xb8c4cf→0x263646` (deep blue-slate between albedo deepSea 0x10263a and shelfSea 0x1e475c); add `WATER_FRESNEL_TINT = 0x93aabb` |
| `src/map/three/geo.ts:11-12` | update stale `// 232` `// 100` comments (values auto-derive → 288×140) |

**Aspect-locked shader tilings** (× 288/232 in X, × 140/100 in Y, so wave/grain size per world unit is unchanged):
- `water.ts:72-73` tileA `(120, 51.7)→(149, 72.4)`, tileB `(53, 22.8)→(65.8, 31.9)`; `:94` foam noise `(190, 81.9)→(235.9, 114.7)`; update the `232x100` comment
- `terrain.ts` detail `(170, 73.3)→(211, 102.6)`, flowA `(310, 133.6)→(384.8, 187)`, flowB `(214, 92.2)→(265.7, 129.1)` (~lines 172/180/181)

## 2. terrain-config.json additions (new land must not look empty)

- **Straits**: add `Oresund` `[[12.65,56.1],[12.7,55.55]]` (~4 km, will close without it). Dover/Hormuz/Great Belt/North Channel are wide enough at 2.2 km/px — verify via new test points instead. Little Belt will fuse (accepted).
- **Mountains** (new): Massif Central, Vosges, Black Forest, Jura, Bohemian Forest, Cambrian, Pennines, Scottish Highlands, Alborz `[[48.8,36.5],[51,36.1],[52.5,35.9],[54.2,36.6]]`, Kopet Dag. **Extend existing**: Zagros southeast to `[57.5,27.3]` (buffer 0.7→0.8); Caucasus append `[48.6,41.3]`. Skip Ardennes (too low; DEM suffices).
- **Regions** (desert): Dasht-e Kavir, Dasht-e Lut polygons. No North-European-Plain entry needed — the aridity ramp already paints >44°N green.
- **Rivers** (new): Rhine, Rhône, Loire, Seine, Garonne, Elbe, Thames, Shatt al-Arab `[[45.9,32.2]→[48.6,30.0]]` (continues existing Euphrates/Tigris endpoints to the Persian Gulf; don't touch existing entries).
- **Green corridors**: Lower Mesopotamia extension to the Gulf.

(Exact coordinates as in the Plan-agent output; use restrained density matching existing entries. Rule #1: geographic names only.)

## 3. Ocean apron (the white-fix core)

New `createOceanApron()` in `src/map/three/water.ts`:
- **Geometry**: `ShapeGeometry` outer rect `(−500,−500)..(GROUND_W+500, GROUND_H+500)` with a **hole exactly at the world rect** `(0,0)..(GROUND_W,GROUND_H)`; `rotateX(-π/2)` at Y=0. Hole edge and water-plane edge are single segments with identical corners → vertex-exact seam, no cracks. APRON=500 covers the worst frustum-corner ground hit at DIST_MAX 220 (~430 units, ultrawide).
- **Material**: opaque `ShaderMaterial` reusing the water VERT/FRAG template (logdepthbuf/fog/tonemapping chunks), with:
  - `vUv` from **world position** (`worldPos.xz / uWorldSize`) so RepeatWrapping wave normals are continuous across the seam.
  - **No uHeightY/uWorldMask sampling** (avoids ClampToEdge land-texel bleed at south/east edges): hardcode deep water — `depthT=1.0`, `foam=0.0`, color = `mix(uDeepColor, vec3(16,38,58)/255, 0.2)` matching what the alpha-0.8 water shows over deep-sea albedo. Keep fresnel + sun glint at ×0.35.
  - `transparent:false`, `depthWrite:true`, default renderOrder (draws before renderOrder-10 water), `fog:true`, no cast/receiveShadow (so `lights.ts` cascade fit is untouched).
- Land edges (Sahara south, Persia east) meet the existing dark skirt wall → intentional diorama-in-a-sea look.
- **Fresnel decouple**: switch `uSkyColor` in `water.ts:127` to `WATER_FRESNEL_TINT` so the darker sky doesn't dull the sea's grazing sheen.
- **Fog**: keep near=d·1.35 / far=d·5. At DIST_MAX 220: near 297 / far 1100 < camera far 1500. Only retune (far→×4) if the apron horizon band looks abrupt.
- **Wiring** in `src/map/MapCanvas.tsx`: create after `createWater`, add to scene, drive `setTime(t)`, dispose in cleanup; update the "232-unit world" comment.

## 4. Order of operations

1. All constant edits (§1) + terrain-config additions (§2).
2. **Network fetches (one-time)**: `node scripts/fetch-coastline.mjs`, then `npm run world:fetch-dem` — z7 tiles x 59..85, y 37..55 = 513 tiles, mosaic 6912×4864, committed PNG grows 27→~50 MB (flag in commit msg).
3. `npm run world:build`; sanity-check console slit/orphan counts and `scripts/assets/dem-preview.png` (Baltic/North Sea/Persian Gulf stay sea; English Channel + Øresund open).
4. Runtime work: ocean apron + sky/fresnel + camera (§1, §3).
5. Tests (§5), then visual check.
6. Update docs: `docs/terrain-3d-spec.md` (bbox, X 0..288 / Z 0..140, texture dims, segments, tile counts), `README.md:~53` bbox line.

## 5. Tests & verification

- `tests/world-assets.test.ts`: mostly auto-adapts (sidecar bbox vs hex constants, aspect assertions hold: 8192/3982 ≈ 2880/1400 ≈ 2.057). **Add** strait points Dover `(1.4,51.0)`, Øresund `(12.68,55.8)`, Hormuz `(56.5,26.6)`; land anchors Londinium `(−0.1,51.5)`, Lutetia `(2.35,48.85)`, Persepolis `(52.9,29.9)`.
- `tests/territory.test.ts`, `three-geo.test.ts`, `hex.test.ts`, `data.test.ts` derive from constants — expect auto-pass. Quick grep for stray hardcoded coords.
- `npm test` green; rebake twice → identical sha256 (determinism).
- Visual via `npm run dev` + `agent-browser-wrapped` screenshots: (a) max zoom-out — no white, seamless apron at sea edges, skirt-into-sea at land edges; (b) Channel/Øresund open; (c) Gaul/Britain green with river grooves; (d) Zagros→Alborz relief, Kavir/Lut deserts; (e) home view (HOME_DISTANCE 120) unchanged in character; (f) event/city markers track terrain while panning.

## Risks

- Repo weight: DEM ~50 MB (GitHub soft-warn), public/terrain ~10→17 MB. All baked assets change bytes (expected).
- Danish straits may need dem-preview iteration; Little Belt fusion accepted.
- Plate-carrée stretching of northern landforms at 59°N is inherent/stylistic, not a bug.
- If a shallow-shelf seam band shows at the apron boundary (west of Ireland/Portugal), blend apron color toward shelfSea within ~10 units of the hole edge (shader-only fix).
