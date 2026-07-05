/**
 * Packs AI-generated terrain art (see docs/terrain-art-spec.md) into the
 * runtime atlas consumed by src/map/renderer/atlas.ts.
 *
 *   art-src/base/<code>_<n>.png, art-src/feature/{m,h,tree}_<n>.png
 *     → public/terrain/atlas.png + atlas.json + contact-sheet.png
 *       + macro-tint.png
 *
 * Pipeline (all deterministic — running twice yields identical bytes):
 *   1. Variant augmentation: each hand-made source spawns `f` (flop),
 *      `j` (color jitter) and `fj` derivatives up to per-kind targets, so a
 *      single source already yields 4 distinct variants.
 *   2. Base tiles get an ORGANIC mask: blurred hex∪skirt silhouette ramp ×
 *      low-freq value noise (per-frame seed) with an opaque core — wobbling
 *      alpha contours instead of a straight honeycomb edge.
 *   3. Cross-terrain transition strips: for each invader code in {g,p,d,h,s}
 *      and each hex edge, a gradient-band crop of the `_0` art is baked as a
 *      `trans/<code>_<edge>` frame (Civ5-style edge blending, no shaders).
 *   4. A near-white macro tint sheet (multiplied over the map at runtime)
 *      breaks up wallpaper repetition at low zoom.
 */
import { readdir, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import {
  ANCHORS,
  BLEED,
  CANVAS_SIZES,
  FOOTPRINT_W,
  FOOTPRINT_H,
  SKIRT_PX,
  TRANS_BAND,
  TRANS_BLUR,
  TRANS_OUT,
  artHexCorners,
  baseKindFor,
  computeAtlasLayout,
  transitionGeometry,
  hashStringSeed,
  mulberry32,
} from '../src/map/renderer/atlasLayout.ts';

const dir = dirname(fileURLToPath(import.meta.url));
const SRC = join(dir, '..', 'art-src');
const OUT = join(dir, '..', 'public', 'terrain');

const TERRAIN_CODES = ['D', 's', 'g', 'p', 'h', 'm', 'd'];
const SEA_CODES = new Set(['D', 's']);
const FEATURE_KINDS = ['m', 'h', 'tree'];
/** Blend invaders (see BLEND_PRIORITY in src/map/renderer/terrain.ts); D
 * never invades and m never blends, so neither needs strips. */
const TRANS_CODES = ['g', 'p', 'd', 'h', 's'];

/* Organic base-mask parameters. */
const MASK_GROW = BLEED; // silhouette reaches the full bleed allowance
const MASK_BLUR = 6; // gaussian σ of the silhouette ramp
const MASK_GAIN = 2; // ramp×noise gain: interiors saturate opaque
const CORE_SHRINK = -6; // opaque inner hex inset — interiors never thin
const NOISE_GRID = { w: 9, h: 7 }; // low-freq value noise grid (cubic-upscaled)
const NOISE_MIN = 128; // noise luma floor → factor range [0.5, 1.0]

/* Variant augmentation targets (caps — never invents beyond f/j/fj). */
const VARIANT_TARGET = { land: 6, sea: 4, feature: 4 };
const JITTER = { brightness: 0.05, saturation: 0.08, hue: 8 };

/* Transition strips: extend band ends past the hex corners so adjacent
 * strips still meet at full alpha after the σ=TRANS_BLUR feather. */
const STRIP_END_EXT = TRANS_BLUR;

/* Macro tint sheet: near-white, multiplied over the world at runtime. */
const MACRO = {
  w: 1024,
  h: 342, // matches the world aspect (WORLD_W : WORLD_H*ISO_SQUASH ≈ 2.99)
  grid: { w: 48, h: 16 },
  lumaMin: 232,
  lumaMax: 255,
  chroma: 3,
  seed: hashStringSeed('macro-tint-v1'),
};

/* ------------------------------------------------------------------ */
/* deterministic noise + organic alpha masks                           */

function noiseRaw(seed, gw, gh) {
  const rng = mulberry32(seed);
  const buf = Buffer.alloc(gw * gh);
  for (let i = 0; i < buf.length; i++) buf[i] = Math.round(NOISE_MIN + rng() * (255 - NOISE_MIN));
  return buf;
}

/** Low-frequency value-noise field at (w×h), single channel. */
function noiseField(seed, w, h) {
  return sharp(noiseRaw(seed, NOISE_GRID.w, NOISE_GRID.h), {
    raw: { width: NOISE_GRID.w, height: NOISE_GRID.h, channels: 1 },
  })
    .resize(w, h, { kernel: 'cubic', fit: 'fill' })
    .raw()
    .toBuffer();
}

/** Render an SVG (black background, white shape) to a 1-channel ramp. */
function svgRamp(svg) {
  return sharp(svg).extractChannel(1).raw().toBuffer();
}

/**
 * Organic alpha mask: blurred silhouette ramp × value noise, gain-clamped so
 * interiors saturate, max()ed with an opaque core so they never thin.
 * Returns a single-channel raw buffer (w×h) used as the frame's alpha.
 */
async function organicAlphaMask({ w, h, shapeSvg, coreSvg, seed, gain = MASK_GAIN }) {
  const [ramp, core, noise] = await Promise.all([
    svgRamp(shapeSvg),
    coreSvg ? svgRamp(coreSvg) : null,
    noiseField(seed, w, h),
  ]);
  const out = Buffer.alloc(w * h);
  for (let i = 0; i < out.length; i++) {
    const v = Math.min(255, Math.round((ramp[i] * noise[i] * gain) / 255));
    out[i] = core ? Math.max(v, core[i]) : v;
  }
  return out;
}

/** Multiply a raw 1-channel mask into an image's alpha (dest-in keys on alpha). */
async function applyAlphaMask(artBuf, maskRaw, w, h) {
  const alphaImg = await sharp({
    create: { width: w, height: h, channels: 3, background: '#fff' },
  })
    .joinChannel(maskRaw, { raw: { width: w, height: h, channels: 1 } })
    .png()
    .toBuffer();
  return sharp(artBuf)
    .ensureAlpha()
    .composite([{ input: alphaImg, blend: 'dest-in' }])
    .png()
    .toBuffer();
}

/* ------------------------------------------------------------------ */
/* base-tile silhouettes                                               */

/** Hex ∪ skirt silhouette polygon points for a base-tile kind. */
function silhouettePoints(kind, grow) {
  const { w, h } = CANVAS_SIZES[kind];
  const cx = w * ANCHORS[kind].x;
  const cy = h * ANCHORS[kind].y;
  const skirt = kind === 'mountain' ? SKIRT_PX.m : kind === 'hill' ? SKIRT_PX.h : 0;
  const c = artHexCorners(grow).map(([x, y]) => [x + cx, y + cy]);
  // Corner order: 0 NE, 1 SE, 2 S, 3 SW, 4 NW, 5 N. Silhouette = hex ∪ skirt.
  const pts = [
    c[5], c[0], c[1],
    [c[1][0], c[1][1] + skirt],
    [c[2][0], c[2][1] + skirt],
    [c[3][0], c[3][1] + skirt],
    c[3], c[4],
  ];
  return pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
}

/** White silhouette on black, optionally gaussian-blurred (the ramp). */
function silhouetteSvg(kind, grow, blur) {
  const { w, h } = CANVAS_SIZES[kind];
  const filter = blur
    ? `<filter id="f" x="-30%" y="-30%" width="160%" height="160%">` +
      `<feGaussianBlur stdDeviation="${blur}"/></filter>`
    : '';
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
      `<rect width="100%" height="100%" fill="#000"/>${filter}` +
      `<polygon points="${silhouettePoints(kind, grow)}" fill="#fff"` +
      `${blur ? ' filter="url(#f)"' : ''}/></svg>`,
  );
}

/* ------------------------------------------------------------------ */
/* frame collection + variant augmentation                             */

/** Collect hand-made sources grouped by code / feature kind. */
async function collectSources() {
  const list = async (sub) => {
    try {
      return (await readdir(join(SRC, sub))).filter((f) => f.endsWith('.png')).sort();
    } catch {
      return [];
    }
  };

  const base = new Map(); // code → [{name, kind, code, file}]
  for (const file of await list('base')) {
    const m = /^([Dsgphmd])_(\d+)\.png$/.exec(file);
    if (!m) {
      console.warn(`skip base/${file}: name must match <code>_<n>.png`);
      continue;
    }
    const entry = {
      name: `base/${m[1]}_${m[2]}`,
      kind: baseKindFor(m[1]),
      code: m[1],
      file: join(SRC, 'base', file),
    };
    if (!base.has(m[1])) base.set(m[1], []);
    base.get(m[1]).push(entry);
  }

  const feature = new Map(); // kind → [{name, kind:'feature', file}]
  for (const file of await list('feature')) {
    const m = /^(m|h|tree)_(\d+)\.png$/.exec(file);
    if (!m) {
      console.warn(`skip feature/${file}: name must match {m,h,tree}_<n>.png`);
      continue;
    }
    const entry = { name: `feature/${m[1]}_${m[2]}`, kind: 'feature', file: join(SRC, 'feature', file) };
    if (!feature.has(m[1])) feature.set(m[1], []);
    feature.get(m[1]).push(entry);
  }
  return { base, feature };
}

/** Deterministic per-frame color jitter for `.modulate()`. */
function jitterFor(name, halved) {
  const rng = mulberry32(hashStringSeed(`jitter:${name}`));
  const k = halved ? 0.5 : 1;
  return {
    brightness: 1 + (rng() * 2 - 1) * JITTER.brightness * k,
    saturation: 1 + (rng() * 2 - 1) * JITTER.saturation * k,
    hue: Math.round((rng() * 2 - 1) * JITTER.hue * k),
  };
}

/**
 * Expand hand-made sources with derived variants — `f` flop, `j` jitter,
 * `fj` both — capped at `target`. Op-major order so two sources prefer a
 * flop of each over an fj of one. Features never flop (NW-lit 3D forms);
 * base tiles may (the h/m skirt silhouette is symmetric).
 */
function augment(sources, target, { flop: allowFlop, halvedJitter }) {
  const variants = sources.map((s) => ({ ...s }));
  const ops = allowFlop ? ['f', 'j', 'fj'] : ['j'];
  for (const op of ops) {
    for (const s of sources) {
      if (variants.length >= target) return variants;
      const name = `${s.name}${op}`;
      variants.push({
        ...s,
        name,
        flop: op.includes('f'),
        jitter: op.includes('j') ? jitterFor(name, halvedJitter) : undefined,
      });
    }
  }
  return variants;
}

/* ------------------------------------------------------------------ */
/* frame processing                                                    */

/** Base tile: flop/jitter → fill canvas → organic silhouette alpha. */
async function processBase(frame) {
  const { w, h } = CANVAS_SIZES[frame.kind];
  let img = sharp(frame.file);
  if (frame.flop) img = img.flop();
  if (frame.jitter) img = img.modulate(frame.jitter);
  const art = await img.resize(w, h, { fit: 'cover' }).png().toBuffer();
  const mask = await organicAlphaMask({
    w,
    h,
    shapeSvg: silhouetteSvg(frame.kind, MASK_GROW, MASK_BLUR),
    coreSvg: silhouetteSvg(frame.kind, CORE_SHRINK, 0),
    seed: hashStringSeed(frame.name),
  });
  return applyAlphaMask(art, mask, w, h);
}

/** Feature: jitter, trim, fit inside the canvas, bottom-align on the footprint. */
async function processFeature(frame) {
  const { w, h } = CANVAS_SIZES.feature;
  let src = sharp(frame.file);
  if (frame.jitter) src = src.modulate(frame.jitter);
  const trimmed = await src.trim().png().toBuffer();
  const meta = await sharp(trimmed).metadata();
  const scale = Math.min(w / meta.width, h / meta.height, 1);
  const fw = Math.max(1, Math.round(meta.width * scale));
  const fh = Math.max(1, Math.round(meta.height * scale));
  // Bottom of the art sits at the bottom edge of the hex footprint.
  const footprintBottom = Math.round(h * ANCHORS.feature.y + FOOTPRINT_H / 2);
  const top = Math.max(0, Math.min(h - fh, footprintBottom - fh));
  const left = Math.round((w - fw) / 2);
  return sharp({ create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: await sharp(trimmed).resize(fw, fh).png().toBuffer(), left, top }])
    .png()
    .toBuffer();
}

/* ------------------------------------------------------------------ */
/* transition strips                                                   */

/** Gradient-band mask SVG for hex edge `edge`: opaque from TRANS_OUT past
 * the edge, S-curve falloff to 0 at TRANS_BAND inside it. */
function stripMaskSvg(edge) {
  const { w, h } = CANVAS_SIZES.flat;
  const geo = transitionGeometry(edge);
  const [nx, ny] = geo.normal;
  const [ax, ay] = geo.a;
  const [bx, by] = geo.b;
  const elen = Math.hypot(bx - ax, by - ay);
  const ex = (bx - ax) / elen;
  const ey = (by - ay) / elen;
  const A = [ax - ex * STRIP_END_EXT, ay - ey * STRIP_END_EXT];
  const B = [bx + ex * STRIP_END_EXT, by + ey * STRIP_END_EXT];
  const quad = [
    [A[0] + nx * TRANS_OUT, A[1] + ny * TRANS_OUT],
    [B[0] + nx * TRANS_OUT, B[1] + ny * TRANS_OUT],
    [B[0] - nx * TRANS_BAND, B[1] - ny * TRANS_BAND],
    [A[0] - nx * TRANS_BAND, A[1] - ny * TRANS_BAND],
  ]
    .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
    .join(' ');
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2;
  const g1 = [mx + nx * TRANS_OUT, my + ny * TRANS_OUT];
  const g2 = [mx - nx * TRANS_BAND, my - ny * TRANS_BAND];
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
      `<defs><linearGradient id="g" gradientUnits="userSpaceOnUse" ` +
      `x1="${g1[0].toFixed(1)}" y1="${g1[1].toFixed(1)}" ` +
      `x2="${g2[0].toFixed(1)}" y2="${g2[1].toFixed(1)}">` +
      `<stop offset="0" stop-color="#fff"/>` +
      `<stop offset="0.25" stop-color="#e8e8e8"/>` +
      `<stop offset="0.5" stop-color="#808080"/>` +
      `<stop offset="0.75" stop-color="#171717"/>` +
      `<stop offset="1" stop-color="#000"/>` +
      `</linearGradient>` +
      `<filter id="f" x="-30%" y="-30%" width="160%" height="160%">` +
      `<feGaussianBlur stdDeviation="${TRANS_BLUR}"/></filter></defs>` +
      `<rect width="100%" height="100%" fill="#000"/>` +
      `<polygon points="${quad}" fill="url(#g)" filter="url(#f)"/></svg>`,
  );
}

/**
 * Continuous flat-canvas texture sheet from a code's `_0` art (no hex mask).
 *
 * Tile art (today's especially) paints rims/bevels near the hex edge and is
 * transparent outside it, so strips sample the CENTRAL HALF of the source —
 * pure interior texture — stretched to the canvas (a ~2x zoom window; fine
 * for a soft blend band, and equally valid for edge-to-edge continuous art).
 * All 6 edges share this one sheet, so strips agree where corners overlap.
 * Hills aspect-crop against the hill canvas: the central half then ends at
 * 75% of the art height, above the southern skirt (top 224/286 ≈ 78%).
 */
async function stripArt(code, file) {
  const { w, h } = CANVAS_SIZES.flat;
  const canvas = code === 'h' ? CANVAS_SIZES.hill : CANVAS_SIZES.flat;
  const meta = await sharp(file).metadata();
  // Centered cover-crop of the source to the canvas aspect...
  let sw = meta.width;
  let sh = meta.height;
  let sx = 0;
  let sy = 0;
  if (sw / sh > canvas.w / canvas.h) {
    const cw = Math.round((sh * canvas.w) / canvas.h);
    sx = Math.floor((sw - cw) / 2);
    sw = cw;
  } else {
    const ch = Math.round((sw * canvas.h) / canvas.w);
    sy = Math.floor((sh - ch) / 2);
    sh = ch;
  }
  // ...then its central half, stretched onto the flat canvas.
  return sharp(file)
    .extract({
      left: sx + Math.floor(sw / 4),
      top: sy + Math.floor(sh / 4),
      width: Math.floor(sw / 2),
      height: Math.floor(sh / 2),
    })
    // mitchell: soft 2x upscale without lanczos ringing on fine paint strokes
    .resize(w, h, { fit: 'fill', kernel: 'mitchell' })
    .png()
    .toBuffer();
}

/** Bake the `trans/<code>_<edge>` frame: band-mask the art, crop tight. */
async function processStrip(code, edge, file) {
  const { w, h } = CANVAS_SIZES.flat;
  const name = `trans/${code}_${edge}`;
  const [art, mask] = await Promise.all([
    stripArt(code, file),
    organicAlphaMask({ w, h, shapeSvg: stripMaskSvg(edge), coreSvg: null, seed: hashStringSeed(name) }),
  ]);
  const { crop } = transitionGeometry(edge);
  return sharp(await applyAlphaMask(art, mask, w, h))
    .extract({ left: crop.x, top: crop.y, width: crop.w, height: crop.h })
    .png()
    .toBuffer();
}

/* ------------------------------------------------------------------ */
/* macro tint                                                          */

/** Near-white low-freq noise sheet; runtime multiplies it over the world. */
async function writeMacroTint() {
  const { w, h, grid, lumaMin, lumaMax, chroma, seed } = MACRO;
  const rng = mulberry32(seed);
  const buf = Buffer.alloc(grid.w * grid.h * 3);
  for (let i = 0; i < grid.w * grid.h; i++) {
    const luma = lumaMin + rng() * (lumaMax - lumaMin);
    for (let c = 0; c < 3; c++) {
      buf[i * 3 + c] = Math.max(0, Math.min(255, Math.round(luma + (rng() * 2 - 1) * chroma)));
    }
  }
  await sharp(buf, { raw: { width: grid.w, height: grid.h, channels: 3 } })
    .resize(w, h, { kernel: 'cubic', fit: 'fill' })
    .png()
    .toFile(join(OUT, 'macro-tint.png'));
  console.log(`wrote public/terrain/macro-tint.png (${w}x${h})`);
}

/* ------------------------------------------------------------------ */
/* main                                                                */

const sources = await collectSources();
if (sources.base.size === 0 && sources.feature.size === 0) {
  console.error(`no art found under ${SRC} — see docs/terrain-art-spec.md`);
  process.exit(1);
}

// The runtime manifest schema requires ≥1 variant per code/feature kind.
const missing = [
  ...TERRAIN_CODES.filter((c) => !sources.base.has(c)).map((c) => `base/${c}`),
  ...FEATURE_KINDS.filter((k) => !sources.feature.has(k)).map((k) => `feature/${k}`),
];
if (missing.length > 0) {
  console.error(`missing required variants: ${missing.join(', ')}`);
  process.exit(1);
}

// Augment hand-made sources into the variant sets the map will cycle through.
const frames = [];
for (const code of TERRAIN_CODES) {
  const target = SEA_CODES.has(code) ? VARIANT_TARGET.sea : VARIANT_TARGET.land;
  frames.push(...augment(sources.base.get(code), target, { flop: true, halvedJitter: SEA_CODES.has(code) }));
}
for (const kind of FEATURE_KINDS) {
  frames.push(...augment(sources.feature.get(kind), VARIANT_TARGET.feature, { flop: false, halvedJitter: false }));
}

// Transition strips sample each invader code's `_0` source art.
const strips = [];
for (const code of TRANS_CODES) {
  for (let edge = 0; edge < 6; edge++) {
    strips.push({
      name: `trans/${code}_${edge}`,
      kind: 'trans',
      code,
      edge,
      file: sources.base.get(code)[0].file,
      geo: transitionGeometry(edge),
    });
  }
}

// Tall frames first keeps shelf packing tight (strips last: short + narrow).
const order = { mountain: 0, feature: 1, hill: 2, flat: 3, trans: 4 };
const packables = [...frames, ...strips].sort(
  (a, b) => order[a.kind] - order[b.kind] || a.name.localeCompare(b.name),
);

const layout = computeAtlasLayout(
  packables.map((f) => ({
    name: f.name,
    w: f.kind === 'trans' ? f.geo.crop.w : CANVAS_SIZES[f.kind].w,
    h: f.kind === 'trans' ? f.geo.crop.h : CANVAS_SIZES[f.kind].h,
  })),
);
if (layout.height > 4096) {
  console.warn(`atlas height ${layout.height}px exceeds 4096 — trim variants or raise maxWidth`);
}

const composites = [];
const manifestFrames = {};
for (const frame of packables) {
  const rect = layout.frames[frame.name];
  let buf;
  let anchor;
  if (frame.kind === 'trans') {
    buf = await processStrip(frame.code, frame.edge, frame.file);
    anchor = { x: frame.geo.anchorX, y: frame.geo.anchorY };
  } else if (frame.kind === 'feature') {
    buf = await processFeature(frame);
    anchor = ANCHORS.feature;
  } else {
    buf = await processBase(frame);
    anchor = ANCHORS[frame.kind];
  }
  composites.push({ input: buf, left: rect.x, top: rect.y });
  manifestFrames[frame.name] = {
    x: rect.x, y: rect.y, w: rect.w, h: rect.h,
    anchorX: anchor.x, anchorY: anchor.y,
  };
  console.log(`packed ${frame.name} (${rect.w}x${rect.h} @ ${rect.x},${rect.y})`);
}

const manifest = {
  footprintWidth: FOOTPRINT_W,
  frames: manifestFrames,
  base: Object.fromEntries(
    TERRAIN_CODES.map((c) => [c, frames.filter((f) => f.name.startsWith(`base/${c}_`)).map((f) => f.name)]),
  ),
  features: Object.fromEntries(
    FEATURE_KINDS.map((k) => [k, frames.filter((f) => f.name.startsWith(`feature/${k}_`)).map((f) => f.name)]),
  ),
  transitions: Object.fromEntries(
    TRANS_CODES.map((c) => [c, Array.from({ length: 6 }, (_, e) => `trans/${c}_${e}`)]),
  ),
};

await mkdir(OUT, { recursive: true });
const atlas = sharp({
  create: { width: layout.width, height: layout.height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
}).composite(composites);
await atlas.clone().png().toFile(join(OUT, 'atlas.png'));
await writeFile(join(OUT, 'atlas.json'), JSON.stringify(manifest, null, 2));
await sharp(await atlas.png().toBuffer())
  .resize({ width: Math.min(1024, layout.width) })
  .flatten({ background: { r: 24, g: 28, b: 40 } })
  .png()
  .toFile(join(OUT, 'contact-sheet.png'));
await writeMacroTint();

console.log(
  `wrote public/terrain/atlas.png (${layout.width}x${layout.height}, ` +
    `${frames.length} tile frames + ${strips.length} strips), atlas.json, contact-sheet.png`,
);
