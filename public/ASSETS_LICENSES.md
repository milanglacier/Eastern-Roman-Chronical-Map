# Third-party assets

Every file shipped under `public/` that is derived from or copied out of a
third-party source is listed here with its source and license.
`tests/asset-licenses.test.ts` fails if a file in `public/models/` or
`public/textures/` has no entry below.

| Path | Source | License |
| --- | --- | --- |
| `terrain/albedo.jpg` (land colour) | NASA Earth Observatory, Blue Marble: Next Generation, July 2004 (<https://visibleearth.nasa.gov/images/74092>), graded and baked by `scripts/build-world-textures.mjs` | Public domain |
| `terrain/heightmap.png`, `terrain/normal.png` | AWS Open Data Terrain Tiles (Terrarium; GMTED2010, ETOPO1, SRTM) | Public domain / open data |
| `terrain/*` coastline conform | Natural Earth 1:50m land | Public domain |
| `terrain/clouds.png` | Procedural (seeded Perlin fbm in `scripts/build-world-textures.mjs`) | Project (MIT) |
| `textures/detail/detail-mix.png` | ambientCG Ground037, Rock030, Ground054 colour maps (<https://ambientcg.com>), reduced to high-pass luminance by the bake | CC0 1.0 |
| `city/constantinople/heightmap.png`, `normal.png` | AWS Open Data Terrain Tiles (Terrarium z13; SRTM), baked by `scripts/build-city.mjs` | Public domain / open data |
| `city/constantinople/albedo.jpg`, `worldmask.png` | Procedural (seeded) in `scripts/build-city.mjs` | Project (MIT) |
