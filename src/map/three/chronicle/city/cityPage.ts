/**
 * The city model shown in the city view (cityView.ts): Constantinople's
 * plan at true proportions, `magnification` times the world map's scale
 * (see .plans/active/chronicle-map-prototype/plan-phase-2.md).
 *
 *  - The ground: the detailed plan of the city (pageArt.ts), fading out at
 *    its edges into a coarser outer ground that runs on to the horizon.
 *  - Walls, the aqueduct and forum colonnades stand up along their true
 *    paths as folded paper strips with tower boxes (strips.ts).
 *  - Landmarks and ships are pop-up cards on their true sites, each turning
 *    about its own vertical axis to face the viewer (cardArt.ts).
 *  - Houses and trees are instanced cards filling the built-up areas in
 *    proportion to the density of the year, with gardens where it thins,
 *    and scattered over the countryside.
 *
 * Everything follows the year through the city plan's dated stages
 * (src/lib/cityTimeline.ts). Group origin: the plan's centre, ground at y = 0.
 */
import {
  CanvasTexture,
  DoubleSide,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshDepthMaterial,
  MeshStandardMaterial,
  NoColorSpace,
  PlaneGeometry,
  RGBADepthPacking,
  SRGBColorSpace,
  type Camera,
  type Material,
  type Texture,
} from 'three';
import type { CityPlan, CityStructure } from '../../../../data/schema';
import { createCityFrame } from '../../../../lib/cityFrame';
import { resolveCity, type CityState } from '../../../../lib/cityTimeline';
import { distanceToPolyline, pointInRing, type XY } from '../../../../lib/polyline';
import { hashStringSeed } from '../../../../lib/prng';
import { applyCurvature } from '../../curvature';
import { easeOutBack } from '../../clockwork/constantinople';
import { makePen } from '../illumination';
import { applyBillboardAtlas } from './billboard';
import {
  ATLAS_CHAPEL,
  ATLAS_CYPRESS,
  ATLAS_GRID,
  ATLAS_HOUSES,
  ATLAS_PINE,
  cardArt,
  drawAtlas,
  type CardArt,
} from './cardArt';
import { loadPlate, offsetOutward, ringCentroid, structurePath, type Plate } from './geometry';
import { applyMosaic, type MosaicSetting } from './mosaic';
import { drawGround, mergeGold, regionSize, type GroundRegion, type PageCanvases, type PageStyle, type PageWalls } from './pageArt';
import { TILE_LENGTH, drawStripTexture, stripGeometry, towerGeometry, towersAlong, type StripKind, type StripTexture } from './strips';

export interface CityPage {
  group: Group;
  /** Half extents of the detailed plan (world units, around the group origin). */
  readonly halfWidth: number;
  readonly halfDepth: number;
  /** Page coordinates of a lon/lat (world units, around the group origin). */
  toPage(lon: number, lat: number): { x: number; z: number };
  fromPage(x: number, z: number): { lon: number; lat: number };
  readonly rise: number;
  setRise(t: number): void;
  setYear(year: number): void;
  setNight(night: number): void;
  /** Turn the cards to face the camera; call per frame. */
  update(camera: Camera): void;
  dispose(): void;
}

export interface CityPageOptions {
  setting: MosaicSetting;
  /** URL folder of the baked plate (plate.json, land.png). */
  baseUrl: string;
}

/** The outer ground: a square this wide around the plan, lost in the haze. */
export const OUTER_GROUND = 26;
/** How far the detailed ground reaches past the plan (world units). */
const DETAIL_MARGIN = 1.1;
/** Canvas pixels per page unit for pop-up cards. */
const CARD_PPU = 2600;
const CARD_MAX_PX = 1024;
/**
 * Tessera size on the cards (page units): wall-mosaic fine, smaller than
 * the floor's; finer still when only the gilding is set in gold smalti.
 */
const CARD_TESSERA = { all: 0.0036, gold: 0.0018 };
/** Tessera size on the page floor (page units). */
const PAGE_TESSERA = 0.0072;

/** Heights of the paper walls (page units). */
const WALLS = {
  inner: { height: 0.05, tower: 0.074, towerWidth: 0.03, spacing: 0.085 },
  outer: { height: 0.03, tower: 0.044, towerWidth: 0.022, spacing: 0.085 },
  sea: { height: 0.034, tower: 0.05, towerWidth: 0.024, spacing: 0.12 },
  aqueduct: { height: 0.06 },
  colonnade: { height: 0.024 },
};
/** The outer wall and the moat stand this far outside the inner wall. */
const OUTER_WALL_OFFSET = 0.028;

function fold(t: number, a: number, b: number): number {
  if (t <= a) return 0;
  if (t >= b) return 1;
  return easeOutBack((t - a) / (b - a));
}

function newCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** Aux map for the mosaic shader: R = tesserae (everywhere, or only gold), G = gold. */
function auxCanvas(gold: HTMLCanvasElement, tessellate: 'all' | 'gold'): HTMLCanvasElement {
  const aux = newCanvas(gold.width, gold.height);
  const a = aux.getContext('2d')!;
  a.fillStyle = tessellate === 'all' ? '#ff0000' : '#000000';
  a.fillRect(0, 0, aux.width, aux.height);
  mergeGold(aux, gold);
  if (tessellate === 'gold') {
    // Gold tesserae only: copy the gold mask into R as well.
    const tint = newCanvas(aux.width, aux.height);
    const t = tint.getContext('2d')!;
    t.drawImage(gold, 0, 0);
    t.globalCompositeOperation = 'source-in';
    t.fillStyle = '#ff0000';
    t.fillRect(0, 0, aux.width, aux.height);
    a.globalCompositeOperation = 'lighter';
    a.drawImage(tint, 0, 0);
  }
  return aux;
}

interface Built {
  key: string;
  object: Group | Mesh;
  /** Rise window (0..1) and how it folds. */
  a: number;
  b: number;
  mode: 'hinge' | 'scale';
  hinge?: Group;
  billboard?: boolean;
  materials: Material[];
  disposables: Array<{ dispose(): void }>;
}

export function createCityPage(plan: CityPlan, options: CityPageOptions): CityPage {
  const { setting } = options;
  const frame = createCityFrame(plan.page.bbox, plan.page.magnification);
  const pageStyle: PageStyle = setting === 'c' ? 'watercolour' : 'mosaic';
  const flatCards = setting === 'b';
  const cardTessellation: 'all' | 'gold' | null = setting === 'b' ? 'all' : setting === 'a' ? 'gold' : null;
  const cardTessera = CARD_TESSERA[cardTessellation ?? 'all'];

  const group = new Group();
  group.name = `city-page-${plan.id}`;
  const content = new Group();
  group.add(content);

  const nightMaterials = new Set<MeshBasicMaterial>();
  let night = 0;
  const applyNight = (m: MeshBasicMaterial) => {
    const k = 1 - 0.55 * night;
    m.color.setRGB(k, k, k * 1.08);
  };

  /* ---------------- the ground ---------------- */
  const groundLayer = (region: GroundRegion, segments: number, key: string, transparent: boolean) => {
    const [cw, ch] = regionSize(region);
    const canvases: PageCanvases = { canvas: newCanvas(cw, ch), aux: newCanvas(cw, ch) };
    const map = new CanvasTexture(canvases.canvas);
    map.colorSpace = SRGBColorSpace;
    map.anisotropy = 8;
    const aux = new CanvasTexture(canvases.aux);
    aux.colorSpace = NoColorSpace;
    const material = applyCurvature(
      applyMosaic(
        new MeshStandardMaterial({ map, roughness: 0.92, metalness: 0, transparent, depthWrite: !transparent }),
        { aux, size: [cw, ch], tessera: PAGE_TESSERA * region.ppu, grout: 0xcdc3ad, groutWidth: 0.11 },
      ),
      `city-ground-${key}-${setting}`,
    );
    const geo = new PlaneGeometry(region.width, region.depth, segments, segments);
    geo.rotateX(-Math.PI / 2);
    // The outer layer lies a hair below the detailed one: the log depth
    // buffer ignores polygon offset, so coplanar layers would fight.
    geo.translate(region.x0 + region.width / 2, transparent ? 0 : -0.004, region.z0 + region.depth / 2);
    const mesh = new Mesh(geo, material);
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.renderOrder = transparent ? 1 : 0;
    group.add(mesh);
    return { region, canvases, map, aux, material, geo };
  };
  const outer = groundLayer({ x0: -OUTER_GROUND / 2, z0: -OUTER_GROUND / 2, width: OUTER_GROUND, depth: OUTER_GROUND, ppu: 2048 / OUTER_GROUND }, 160, 'outer', false);
  // The detailed layer reaches well past the plan, so the camera (kept over
  // the plan) never sees its faded edge up close.
  const detailW = frame.width + 2 * DETAIL_MARGIN;
  const detailD = frame.depth + 2 * DETAIL_MARGIN;
  const detail = groundLayer(
    { x0: -detailW / 2, z0: -detailD / 2, width: detailW, depth: detailD, ppu: Math.floor(4096 / Math.max(detailW, detailD)) },
    96,
    'detail',
    true,
  );

  /* ---------------- data ---------------- */
  let plate: Plate | null = null;
  let state: CityState = resolveCity(plan, 537);
  let drawnPageKey = '';
  let wallPaths: PageWalls[] = [];

  const redrawPage = () => {
    const input = { plan, state, frame, plate, walls: wallPaths, style: pageStyle };
    for (const [layer, kind] of [[outer, 'outer'], [detail, 'detail']] as const) {
      drawGround(input, layer.region, kind, layer.canvases);
      layer.map.needsUpdate = true;
      layer.aux.needsUpdate = true;
    }
  };

  /* ---------------- cards ---------------- */
  const stripTextures = new Map<StripKind, StripTexture>();
  const stripTexture = (kind: StripKind) => {
    let t = stripTextures.get(kind);
    if (!t) {
      t = drawStripTexture(kind, flatCards);
      stripTextures.set(kind, t);
    }
    return t;
  };

  const texturedMaterial = (
    map: Texture,
    gold: HTMLCanvasElement,
    size: [number, number],
    key: string,
    tessera: number,
  ): { material: MeshBasicMaterial; disposables: Array<{ dispose(): void }> } => {
    const material = new MeshBasicMaterial({ map, alphaTest: 0.5, alphaToCoverage: true, side: DoubleSide });
    const disposables: Array<{ dispose(): void }> = [material];
    if (cardTessellation) {
      const aux = new CanvasTexture(auxCanvas(gold, cardTessellation));
      aux.colorSpace = NoColorSpace;
      applyMosaic(material, { aux, size, tessera, grout: 0x8a7d68, groutWidth: 0.07, glint: 1.3, jitter: 0.55 });
      disposables.push(aux);
    }
    applyCurvature(material, `city-card-${cardTessellation ?? 'none'}-${key}`);
    applyNight(material);
    nightMaterials.add(material);
    return { material, disposables };
  };

  const depthMaterial = (map: Texture) =>
    new MeshDepthMaterial({ depthPacking: RGBADepthPacking, map, alphaTest: 0.5 });

  const cardCache = new Map<string, { canvas: HTMLCanvasElement; gold: HTMLCanvasElement }>();
  const drawCard = (art: CardArt, seedKey: string) => {
    const cached = cardCache.get(seedKey);
    if (cached) return cached;
    let w = Math.round(art.width * CARD_PPU);
    let h = Math.round(art.height * CARD_PPU);
    const s = Math.min(1, CARD_MAX_PX / Math.max(w, h));
    w = Math.max(32, Math.round(w * s));
    h = Math.max(32, Math.round(h * s));
    const c = newCanvas(w, h);
    const gold = newCanvas(w, h);
    const pen = makePen(c.getContext('2d')!, hashStringSeed(seedKey), Math.max(w, h) / 900, { flat: flatCards, gold: gold.getContext('2d')! });
    art.draw(pen, w, h);
    const out = { canvas: c, gold };
    cardCache.set(seedKey, out);
    return out;
  };

  const buildCard = (key: string, art: CardArt, at: XY, a: number, b: number): Built => {
    const { canvas, gold } = drawCard(art, key);
    const tex = new CanvasTexture(canvas);
    tex.colorSpace = SRGBColorSpace;
    tex.anisotropy = 8;
    const { material, disposables } = texturedMaterial(tex, gold, [canvas.width, canvas.height], 'card', cardTessera * (canvas.width / art.width));
    const geo = new PlaneGeometry(art.width, art.height);
    geo.translate(0, art.height / 2, 0);
    const mesh = new Mesh(geo, material);
    mesh.castShadow = true;
    mesh.customDepthMaterial = depthMaterial(tex);
    mesh.frustumCulled = false;
    const hinge = new Group();
    hinge.add(mesh);
    const holder = new Group();
    holder.position.set(at[0], 0, at[1]);
    holder.add(hinge);
    return {
      key,
      object: holder,
      a,
      b,
      mode: 'hinge',
      hinge,
      billboard: true,
      materials: [material],
      disposables: [tex, geo, mesh.customDepthMaterial, ...disposables],
    };
  };

  const buildStrip = (key: string, kind: StripKind, path: XY[], spec: { height: number; tower?: number; towerWidth?: number; spacing?: number; phase?: number }, skip?: (i: number) => boolean, closed = false): Built => {
    const holder = new Group();
    const materials: Material[] = [];
    const disposables: Array<{ dispose(): void }> = [];
    const addMesh = (geo: ReturnType<typeof stripGeometry>, t: StripTexture) => {
      const { material, disposables: d } = texturedMaterial(t.texture, t.gold, t.size, kind, cardTessera * (t.size[0] / (kind === 'tower' ? spec.towerWidth ?? 0.03 : TILE_LENGTH[kind as Exclude<StripKind, 'tower'>])));
      const mesh = new Mesh(geo, material);
      mesh.castShadow = true;
      mesh.customDepthMaterial = depthMaterial(t.texture);
      mesh.frustumCulled = false;
      holder.add(mesh);
      materials.push(material);
      disposables.push(geo, mesh.customDepthMaterial, ...d);
    };
    if (kind !== 'tower') {
      const pts = closed ? [...path, path[0]] : path;
      addMesh(stripGeometry(pts, spec.height, TILE_LENGTH[kind], skip), stripTexture(kind));
    }
    if (spec.tower && spec.towerWidth && spec.spacing) {
      addMesh(towerGeometry(towersAlong(path, spec.spacing, spec.phase ?? 0), spec.towerWidth, spec.tower), stripTexture('tower'));
    }
    return { key, object: holder, a: 0.1, b: 0.55, mode: 'scale', materials, disposables };
  };

  const built = new Map<string, Built>();
  const pagePoint = ([lon, lat]: readonly [number, number]): XY => {
    const p = frame.toPage(lon, lat);
    return [p.x, p.z];
  };
  const cityCentre = (): XY => {
    const ring = state.urbanAreas.find((a) => a.id.startsWith('city'))?.ring;
    return ring ? ringCentroid(ring.map(pagePoint)) : [0, 0];
  };

  /** Everything that should stand this year, keyed so unchanged items are kept. */
  function wanted(): Map<string, () => Built | null> {
    const out = new Map<string, () => Built | null>();
    const centre = cityCentre();
    const distance = (p: XY) => Math.hypot(p[0], p[1]);
    const maxR = Math.hypot(frame.width, frame.depth) / 2;
    // Rise order: from the city's heart outward.
    const window = (p: XY): [number, number] => {
      const k = Math.min(1, distance([p[0] - centre[0], p[1] - centre[1]]) / maxR);
      return [0.05 + k * 0.4, 0.45 + k * 0.45];
    };
    for (const { structure, stage } of state.structures) {
      const key = `${structure.id}:${stage.variant}`;
      if (structure.position && structure.kind !== 'forum') {
        const art = cardArt(structure.id, structure.kind, stage.variant);
        if (!art) continue;
        const at = pagePoint(structure.position);
        const [a, b] = window(at);
        out.set(key, () => buildCard(key, art, at, a, b));
        continue;
      }
      if (structure.kind === 'forum' && structure.position && structure.size) {
        out.set(key, () => {
          const [x, z] = pagePoint(structure.position!);
          const rx = frame.units(structure.size![0] * 2.2) / 2;
          const rz = frame.units((structure.size![1] ?? structure.size![0]) * 2.2) / 2;
          const n = stage.variant === 'oval' ? 36 : 4;
          const ring: XY[] = Array.from({ length: n }, (_, i) => {
            const t = (i / n) * Math.PI * 2 + (n === 4 ? Math.PI / 4 : 0);
            const f = n === 4 ? Math.SQRT2 : 1;
            return [x + Math.cos(t) * rx * f, z + Math.sin(t) * rz * f];
          });
          return buildStrip(key, 'colonnade', ring, WALLS.colonnade, (i) => i % 9 === 4, true);
        });
        continue;
      }
      const path = wallPaths.find((w) => w.id === structure.id)?.path ?? (structure.kind === 'aqueduct' ? structurePath(structure, frame, plate) : null);
      if (!path) continue;
      if (structure.kind === 'aqueduct') {
        out.set(key, () => buildStrip(key, 'aqueduct', path, WALLS.aqueduct));
      } else if (structure.kind === 'land-wall') {
        const ruin = stage.variant === 'ruin';
        const skip = ruin ? (i: number) => i % 3 !== 0 : undefined;
        const spec = ruin ? { ...WALLS.inner, height: WALLS.inner.height * 0.55, tower: 0 } : WALLS.inner;
        out.set(key, () => buildStrip(key, 'land-wall', path, spec, skip));
        if (stage.variant === 'triple' || stage.variant === 'breached') {
          const outer = offsetOutward(path, OUTER_WALL_OFFSET, centre);
          out.set(`${key}:outer`, () => buildStrip(`${key}:outer`, 'land-wall', outer, { ...WALLS.outer, phase: WALLS.outer.spacing / 2 }));
        }
      } else if (structure.kind === 'sea-wall') {
        out.set(key, () => buildStrip(key, 'sea-wall', path, WALLS.sea));
      }
    }
    state.vessels.forEach((v, i) => {
      const key = `vessel-${i}:${v.kind}`;
      const art = cardArt(key, 'vessel', v.kind);
      if (!art) return;
      const at = pagePoint(v.position);
      out.set(key, () => buildCard(key, art, at, 0.5, 0.95));
    });
    return out;
  }

  /* ---------------- houses and trees ---------------- */
  const atlasTile = 128;
  const atlasCanvas = newCanvas(atlasTile * ATLAS_GRID[0], atlasTile * ATLAS_GRID[1]);
  const atlasGold = newCanvas(atlasCanvas.width, atlasCanvas.height);
  drawAtlas(makePen(atlasCanvas.getContext('2d')!, 1453, atlasTile / 300, { flat: flatCards, gold: atlasGold.getContext('2d')! }), atlasTile);
  const atlasTex = new CanvasTexture(atlasCanvas);
  atlasTex.colorSpace = SRGBColorSpace;
  atlasTex.anisotropy = 4;
  const atlasMat = new MeshBasicMaterial({ map: atlasTex, alphaTest: 0.5, alphaToCoverage: true, side: DoubleSide });
  const atlasDisposables: Array<{ dispose(): void }> = [atlasTex, atlasMat];
  if (cardTessellation) {
    const aux = new CanvasTexture(auxCanvas(atlasGold, cardTessellation));
    aux.colorSpace = NoColorSpace;
    applyMosaic(atlasMat, { aux, size: [atlasCanvas.width, atlasCanvas.height], tessera: 9, grout: 0x8a7d68, groutWidth: 0.07, jitter: 0.55 });
    atlasDisposables.push(aux);
  }
  applyBillboardAtlas(atlasMat, ATLAS_GRID);
  applyCurvature(atlasMat, `city-atlas-${cardTessellation ?? 'none'}`);
  nightMaterials.add(atlasMat);
  const houseGeo = new PlaneGeometry(1, 1);
  houseGeo.translate(0, 0.5, 0);
  atlasDisposables.push(houseGeo);
  let houses: InstancedMesh | null = null;
  const housesHolder = new Group();
  content.add(housesHolder);
  let housesKey = '';

  const hash01 = (i: number, j: number, salt: number) => {
    let h = Math.imul(i, 374761393) + Math.imul(j, 668265263) + salt;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };

  function rebuildHouses(): void {
    if (!plate) return;
    const key = `${state.urbanAreas.map((a) => a.id).join(',')}|${Math.round(state.density * 40)}`;
    if (key === housesKey) return;
    housesKey = key;
    if (houses) {
      housesHolder.remove(houses);
      houses.geometry.dispose();
      houses.dispose();
      houses = null;
    }
    // Keep clear of landmarks, walls and the moat.
    const clear: Array<{ at: XY; r: number }> = [];
    for (const { structure, stage } of state.structures) {
      if (!structure.position) continue;
      const art = cardArt(structure.id, structure.kind, stage.variant);
      const r = art ? art.width * 0.42 : structure.kind === 'forum' ? frame.units((structure.size?.[0] ?? 100) * 1.3) : 0.02;
      clear.push({ at: pagePoint(structure.position), r });
    }
    for (const f of state.features) {
      if ((f.kind === 'plaza' || f.kind === 'cistern') && f.position && f.size) {
        clear.push({ at: pagePoint(f.position), r: frame.units(Math.max(...f.size)) * 1.1 });
      }
    }
    const lines: XY[][] = wallPaths.map((w) => w.path);
    const centre = cityCentre();
    for (const w of wallPaths) if (w.kind === 'land-wall') lines.push(offsetOutward(w.path, 0.05, centre));
    const avenues = state.features.filter((f) => f.kind === 'avenue' && f.path).map((f) => f.path!.map(pagePoint));
    const harbours = state.features.filter((f) => f.kind === 'harbour' && f.ring).map((f) => f.ring!.map(pagePoint));
    const rings = state.urbanAreas.map((a) => ({ ring: a.ring.map(pagePoint), weight: a.weight }));

    const items: Array<{ at: XY; size: number; tile: number }> = [];
    const free = (p: XY, margin: number) =>
      plate!.isLand(p[0], p[1]) &&
      clear.every((c) => Math.hypot(p[0] - c.at[0], p[1] - c.at[1]) > c.r) &&
      lines.every((l) => distanceToPolyline(l, p) > margin) &&
      avenues.every((l) => distanceToPolyline(l, p) > 0.012) &&
      harbours.every((r) => !pointInRing(p, r));
    const step = 0.034;
    // The countryside runs over the whole baked crop, beyond the plan.
    const [ow, os, oe, on] = plate.data.outerBbox;
    const nw = frame.toPage(ow, on);
    const se = frame.toPage(oe, os);
    const halfW = Math.max(-nw.x, se.x);
    const halfD = Math.max(-nw.z, se.z);
    for (let j = 0; j * step < 2 * halfD; j++) {
      for (let i = 0; i * step < 2 * halfW; i++) {
        const p: XY = [-halfW + (i + 0.5 + (hash01(i, j, 1) - 0.5) * 0.8) * step, -halfD + (j + 0.5 + (hash01(i, j, 2) - 0.5) * 0.8) * step];
        const h = hash01(i, j, 3);
        const area = rings.find((r) => pointInRing(p, r.ring));
        if (area) {
          if (!free(p, 0.022)) continue;
          const fill = Math.min(1, state.density * area.weight * 1.15);
          if (h < fill) {
            const chapel = hash01(i, j, 4) < 0.035;
            items.push({ at: p, size: chapel ? 0.042 : 0.03 + hash01(i, j, 5) * 0.014, tile: chapel ? ATLAS_CHAPEL : Math.floor(hash01(i, j, 6) * ATLAS_HOUSES) });
          } else if (h > 1 - (1 - state.density) * 0.35) {
            items.push({ at: p, size: 0.035 + hash01(i, j, 7) * 0.02, tile: ATLAS_CYPRESS[i % 2] });
          }
        } else if ((i + j) % 2 === 0 && h < 0.07 && free(p, 0.03)) {
          // Countryside: cypresses and umbrella pines, now and then a farm.
          const t = hash01(i, j, 8);
          items.push({ at: p, size: 0.035 + t * 0.025, tile: t < 0.55 ? ATLAS_CYPRESS[j % 2] : t < 0.85 ? ATLAS_PINE : Math.floor(t * ATLAS_HOUSES) });
        }
      }
    }
    const mesh = new InstancedMesh(houseGeo, atlasMat, Math.max(1, items.length));
    mesh.count = items.length;
    const tiles = new Float32Array(Math.max(1, items.length) * 2);
    const m = new Matrix4();
    items.forEach((it, k) => {
      m.makeScale(it.size, it.size, it.size);
      m.setPosition(it.at[0], 0, it.at[1]);
      mesh.setMatrixAt(k, m);
      const col = it.tile % ATLAS_GRID[0];
      const row = Math.floor(it.tile / ATLAS_GRID[0]);
      tiles[k * 2] = col;
      tiles[k * 2 + 1] = ATLAS_GRID[1] - 1 - row;
    });
    mesh.geometry = houseGeo.clone();
    mesh.geometry.setAttribute('aTile', new InstancedBufferAttribute(tiles, 2));
    mesh.frustumCulled = false;
    houses = mesh;
    housesHolder.add(mesh);
  }

  /* ---------------- year sync ---------------- */
  let rise = 1;

  function applyRise(item: Built): void {
    const k = fold(rise, item.a, item.b);
    if (item.mode === 'hinge' && item.hinge) {
      item.hinge.rotation.x = -(Math.PI / 2) * (1 - k);
      item.object.visible = rise > item.a;
    } else {
      item.object.scale.y = Math.max(0.001, k);
      item.object.visible = k > 0.001;
    }
  }

  function sync(): void {
    wallPaths = [];
    for (const { structure, stage } of state.structures) {
      if (structure.kind !== 'land-wall' && structure.kind !== 'sea-wall') continue;
      const path = structurePath(structure as CityStructure, frame, plate);
      if (path) wallPaths.push({ id: structure.id, kind: structure.kind, variant: stage.variant, path });
    }
    const pageKey = `${state.pageKey}|${plate ? 'plate' : ''}|${wallPaths.length}`;
    if (pageKey !== drawnPageKey) {
      drawnPageKey = pageKey;
      redrawPage();
    }
    const want = wanted();
    for (const [key, item] of built) {
      if (want.has(key)) continue;
      content.remove(item.object);
      for (const d of item.disposables) d.dispose();
      for (const m of item.materials) nightMaterials.delete(m as MeshBasicMaterial);
      built.delete(key);
    }
    for (const [key, make] of want) {
      if (built.has(key)) continue;
      const item = make();
      if (!item) continue;
      built.set(key, item);
      content.add(item.object);
      applyRise(item);
    }
    rebuildHouses();
    housesHolder.scale.y = Math.max(0.001, fold(rise, 0.3, 0.8));
  }

  void loadPlate(options.baseUrl, frame)
    .then((p) => {
      plate = p;
      sync();
    })
    .catch((err) => console.warn('city plate unavailable:', err));
  if (typeof document !== 'undefined' && document.fonts?.load) {
    void Promise.all([document.fonts.load('600 48px Cinzel'), document.fonts.load('700 48px "Noto Serif"')]).then(() => {
      redrawPage();
    });
  }
  sync();

  const page: CityPage = {
    group,
    halfWidth: frame.width / 2,
    halfDepth: frame.depth / 2,
    toPage: (lon, lat) => frame.toPage(lon, lat),
    fromPage: (x, z) => frame.fromPage(x, z),
    get rise() {
      return rise;
    },
    setRise(t) {
      rise = Math.min(1, Math.max(0, t));
      for (const item of built.values()) applyRise(item);
      housesHolder.scale.y = Math.max(0.001, fold(rise, 0.3, 0.8));
      housesHolder.visible = rise > 0.3;
    },
    setYear(year) {
      const next = resolveCity(plan, Math.round(year));
      if (next.year === state.year && plate) return;
      state = next;
      sync();
    },
    setNight(n) {
      night = n;
      for (const m of nightMaterials) applyNight(m);
    },
    update(camera) {
      const gx = group.position.x;
      const gz = group.position.z;
      for (const item of built.values()) {
        if (!item.billboard || !item.object.visible) continue;
        const dx = camera.position.x - (gx + item.object.position.x);
        const dz = camera.position.z - (gz + item.object.position.z);
        item.object.rotation.y = Math.atan2(dx, dz);
      }
    },
    dispose() {
      for (const item of built.values()) for (const d of item.disposables) d.dispose();
      built.clear();
      houses?.geometry.dispose();
      houses?.dispose();
      for (const t of stripTextures.values()) t.texture.dispose();
      for (const d of atlasDisposables) d.dispose();
      for (const layer of [outer, detail]) {
        layer.map.dispose();
        layer.aux.dispose();
        layer.material.dispose();
        layer.geo.dispose();
      }
    },
  };
  return page;
}
