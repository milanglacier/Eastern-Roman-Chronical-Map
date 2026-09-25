# East Roman Chronicle Map — Project Conventions

## Rule #1: Naming the Empire

**Never call the empire "Byzantium" / "Byzantine Empire" / "拜占庭".** In all UI copy,
data content (both English and Chinese), code identifiers, and documentation, the state
is the **Eastern Roman Empire (东罗马帝国)**, or simply **Rome / the Empire (罗马 / 帝国)**.

- The *artistic style* may be described as "byzantine art style" in design notes only.
- The *city* founded in 330 is Constantinople (君士坦丁堡); its pre-330 name Byzantion
  may appear only in historical context about the city itself.
- Tests assert that data files never use the forbidden names for the state.

## Project Shape

- Vite + React + TypeScript static site. Three.js renders the world in `src/map/three/`
  as a **living chronicle map** (default theme): a real-DEM heightmap sculpted and bent
  over a curved horizon, drawn in parchment, ink and watercolour, flown with a free-look
  drone camera, with pop-up city illustrations and era moods. React renders the UI
  (timeline, event panel, header) and the DOM marker overlays (events, cities); zustand
  is the shared store. Look and rules: `docs/art-direction.md`; pipeline:
  `docs/terrain-3d-spec.md`.
- Colour rule: the scene uses natural colours; imperial purple-gold is only for the UI,
  the empire's territory/frontier and emblems.
- All historical content (events, territory snapshots, cities) lives in JSON assets under
  `src/data/` validated by zod schemas in `src/data/schema.ts` — never hardcode content
  in components.
- Bilingual: every user-facing string is `{en, zh}` in data, or in the i18n dictionary
  (`src/i18n/`) for UI chrome.
- `public/terrain/*` is baked — edit `scripts/assets/terrain-config.json` (straits,
  rivers, biome regions) or `scripts/build-world-textures.mjs` and rerun
  `npm run world:build` instead of editing outputs by hand. The bake is deterministic
  and fully offline (DEM mosaic is committed); see `docs/terrain-3d-spec.md`.

## Commands

- `npm run dev` — dev server
- `npm test` — vitest (data validation + unit + component tests)
- `npm run build` — static build
- `npm run world:build` — rebake the world textures (heightmap/albedo/worldmask/granulation)
- `npm run world:fetch-dem` — re-download the DEM mosaic (only if bbox/zoom changes)
