/**
 * Packs AI-generated terrain art (see docs/terrain-art-spec.md) into the
 * runtime atlas consumed by src/map/renderer/atlas.ts.
 *
 *   art-src/base/<code>_<n>.png, art-src/feature/{m,h,tree}_<n>.png
 *     → public/terrain/atlas.png + atlas.json + contact-sheet.png
 *
 * Pipeline per base tile: resize to its kind's canvas → composite a
 * feathered hex mask (dest-in) so edges blend on the map. Feature frames are
 * trimmed and bottom-aligned onto the footprint instead of masked.
 * Reuses the exact layout/anchor math the procedural atlas uses.
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
  artHexCorners,
  baseKindFor,
  computeAtlasLayout,
} from '../src/map/renderer/atlasLayout.ts';

const dir = dirname(fileURLToPath(import.meta.url));
const SRC = join(dir, '..', 'art-src');
const OUT = join(dir, '..', 'public', 'terrain');

const TERRAIN_CODES = ['D', 's', 'g', 'p', 'h', 'm', 'd'];
const FEATURE_KINDS = ['m', 'h', 'tree'];
const MASK_FEATHER = 4; // gaussian blur stdDeviation for the hex mask edge

/** Collect and validate art-src file names. */
async function collectFrames() {
  const frames = []; // { name, kind, file }
  const list = async (sub) => {
    try {
      return (await readdir(join(SRC, sub))).filter((f) => f.endsWith('.png')).sort();
    } catch {
      return [];
    }
  };

  for (const file of await list('base')) {
    const m = /^([Dsgphmd])_(\d+)\.png$/.exec(file);
    if (!m) {
      console.warn(`skip base/${file}: name must match <code>_<n>.png`);
      continue;
    }
    frames.push({ name: `base/${m[1]}_${m[2]}`, kind: baseKindFor(m[1]), file: join(SRC, 'base', file) });
  }
  for (const file of await list('feature')) {
    const m = /^(m|h|tree)_(\d+)\.png$/.exec(file);
    if (!m) {
      console.warn(`skip feature/${file}: name must match {m,h,tree}_<n>.png`);
      continue;
    }
    frames.push({ name: `feature/${m[1]}_${m[2]}`, kind: 'feature', file: join(SRC, 'feature', file) });
  }
  return frames;
}

/** Feathered hex mask SVG for a base-tile kind (skirt included for h/m). */
function maskSvg(kind) {
  const { w, h } = CANVAS_SIZES[kind];
  const cx = w * ANCHORS[kind].x;
  const cy = h * ANCHORS[kind].y;
  const skirt = kind === 'mountain' ? SKIRT_PX.m : kind === 'hill' ? SKIRT_PX.h : 0;
  const c = artHexCorners(BLEED * 0.75).map(([x, y]) => [x + cx, y + cy]);
  // Corner order: 0 NE, 1 SE, 2 S, 3 SW, 4 NW, 5 N. Silhouette = hex ∪ skirt.
  const pts = [
    c[5], c[0], c[1],
    [c[1][0], c[1][1] + skirt],
    [c[2][0], c[2][1] + skirt],
    [c[3][0], c[3][1] + skirt],
    c[3], c[4],
  ];
  const points = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
      `<filter id="f" x="-20%" y="-20%" width="140%" height="140%">` +
      `<feGaussianBlur stdDeviation="${MASK_FEATHER}"/></filter>` +
      `<polygon points="${points}" fill="#fff" filter="url(#f)"/></svg>`,
  );
}

/** Base tile: fill the canvas, then feather-mask to the hex silhouette. */
async function processBase(frame) {
  const { w, h } = CANVAS_SIZES[frame.kind];
  return sharp(frame.file)
    .resize(w, h, { fit: 'cover' })
    .composite([{ input: maskSvg(frame.kind), blend: 'dest-in' }])
    .png()
    .toBuffer();
}

/** Feature: trim, fit inside the canvas, bottom-align on the footprint. */
async function processFeature(frame) {
  const { w, h } = CANVAS_SIZES.feature;
  const trimmed = await sharp(frame.file).trim().png().toBuffer();
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

const frames = await collectFrames();
if (frames.length === 0) {
  console.error(`no art found under ${SRC} — see docs/terrain-art-spec.md`);
  process.exit(1);
}

// The runtime manifest schema requires ≥1 variant per code/feature kind.
const missing = [
  ...TERRAIN_CODES.filter((c) => !frames.some((f) => f.name.startsWith(`base/${c}_`))).map((c) => `base/${c}`),
  ...FEATURE_KINDS.filter((k) => !frames.some((f) => f.name.startsWith(`feature/${k}_`))).map((k) => `feature/${k}`),
];
if (missing.length > 0) {
  console.error(`missing required variants: ${missing.join(', ')}`);
  process.exit(1);
}

// Tall frames first keeps shelf packing tight (same ordering as runtime).
const order = { mountain: 0, feature: 1, hill: 2, flat: 3 };
frames.sort((a, b) => order[a.kind] - order[b.kind] || a.name.localeCompare(b.name));

const layout = computeAtlasLayout(
  frames.map((f) => ({ name: f.name, w: CANVAS_SIZES[f.kind].w, h: CANVAS_SIZES[f.kind].h })),
);

const composites = [];
const manifestFrames = {};
for (const frame of frames) {
  const rect = layout.frames[frame.name];
  const anchor = ANCHORS[frame.kind];
  const buf = frame.kind === 'feature' ? await processFeature(frame) : await processBase(frame);
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

console.log(
  `wrote public/terrain/atlas.png (${layout.width}x${layout.height}, ${frames.length} frames), atlas.json, contact-sheet.png`,
);
