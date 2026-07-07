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

- Vite + React + TypeScript static site. Three.js renders a 45° god's-eye 3D terrain
  (real-DEM heightmap mesh, sun + shadows, animated water, draped territory) in
  `src/map/three/`; React renders UI (timeline, event panel, header) and the DOM
  marker overlays (events, cities); zustand is the shared store.
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
- `npm run world:build` — rebake the world textures (heightmap/normal/albedo/masks)
- `npm run world:fetch-dem` — re-download the DEM mosaic (only if bbox/zoom changes)
