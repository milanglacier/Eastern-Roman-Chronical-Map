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

- Vite + React + TypeScript static site. PixiJS v8 renders the isometric hex-tile map;
  React renders UI (timeline, event panel, header); zustand is the shared store.
- All historical content (events, territory snapshots, cities) lives in JSON assets under
  `src/data/` validated by zod schemas in `src/data/schema.ts` — never hardcode content
  in components.
- Bilingual: every user-facing string is `{en, zh}` in data, or in the i18n dictionary
  (`src/i18n/`) for UI chrome.
- `src/data/tiles.json` is generated — edit `scripts/assets/terrain-config.json` and rerun
  `node scripts/generate-tiles.mjs` instead of editing it by hand.

## Commands

- `npm run dev` — dev server
- `npm test` — vitest (data validation + unit + component tests)
- `npm run build` — static build
- `node scripts/generate-tiles.mjs` — regenerate the terrain tile asset
