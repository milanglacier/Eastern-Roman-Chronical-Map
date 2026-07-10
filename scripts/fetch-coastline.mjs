/**
 * One-time fetch: download Natural Earth 50m land polygons, clip them to the
 * map bbox (with padding), and write the trimmed asset used by
 * generate-tiles.mjs. The output is committed; rerun only to change the bbox.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const URL =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_land.geojson';

// Map bbox from src/lib/hex.ts, padded so coastal tiles at the edge classify correctly.
const PAD = 2;
const XMIN = -12 - PAD, XMAX = 60 + PAD, YMIN = 24 - PAD, YMAX = 59 + PAD;

/** Sutherland–Hodgman clip of a ring against one half-plane. */
function clipHalfPlane(ring, inside, intersect) {
  const out = [];
  for (let i = 0; i < ring.length; i++) {
    const cur = ring[i];
    const prev = ring[(i + ring.length - 1) % ring.length];
    const curIn = inside(cur);
    const prevIn = inside(prev);
    if (curIn) {
      if (!prevIn) out.push(intersect(prev, cur));
      out.push(cur);
    } else if (prevIn) {
      out.push(intersect(prev, cur));
    }
  }
  return out;
}

function clipRingToBBox(ring) {
  const lerpAtX = (a, b, x) => [x, a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0])];
  const lerpAtY = (a, b, y) => [a[0] + ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]), y];
  let r = ring;
  r = clipHalfPlane(r, (p) => p[0] >= XMIN, (a, b) => lerpAtX(a, b, XMIN));
  if (r.length < 3) return null;
  r = clipHalfPlane(r, (p) => p[0] <= XMAX, (a, b) => lerpAtX(a, b, XMAX));
  if (r.length < 3) return null;
  r = clipHalfPlane(r, (p) => p[1] >= YMIN, (a, b) => lerpAtY(a, b, YMIN));
  if (r.length < 3) return null;
  r = clipHalfPlane(r, (p) => p[1] <= YMAX, (a, b) => lerpAtY(a, b, YMAX));
  return r.length < 3 ? null : r;
}

function round(ring) {
  return ring.map(([x, y]) => [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000]);
}

const res = await fetch(URL);
if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
const geojson = await res.json();

const polygons = [];
for (const feature of geojson.features) {
  const geom = feature.geometry;
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  for (const poly of polys) {
    const outer = clipRingToBBox(poly[0]);
    if (!outer) continue;
    const rings = [round(outer)];
    for (let h = 1; h < poly.length; h++) {
      const hole = clipRingToBBox(poly[h]);
      if (hole) rings.push(round(hole));
    }
    polygons.push(rings);
  }
}

const out = { type: 'MultiPolygon', coordinates: polygons };
const dir = dirname(fileURLToPath(import.meta.url));
await mkdir(join(dir, 'assets'), { recursive: true });
await writeFile(join(dir, 'assets', 'coastline-50m.json'), JSON.stringify(out));
console.log(`wrote ${polygons.length} clipped land polygons`);
