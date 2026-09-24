/**
 * The living city: every structure of a city view built once per stage
 * variant, then switched by year — structures rise out of the ground when
 * they are built, sink when they fall; houses fill and thin with the
 * density curve inside the urban ring of the day; ships come and go with
 * the population.
 */
import { Group } from 'three';
import type { CityScene as CitySceneData, CityStructure } from '../../../data/schema';
import { hashStringSeed, mulberry32 } from '../../../lib/prng';
import {
  interpolateKeyframes,
  structureStands,
  structureVariant,
  urbanAreaForYear,
} from '../../../lib/cityTimeline';
import type { CityHeightField } from './cityFrame';
import { createCityMaterials } from './palette';
import { buildWall, type BuildContext } from './walls';
import { buildLandmark } from './landmarks';
import { disposeGroup } from './batch';
import { createHouseLayer, generateHouseSites, type HouseLayer } from './houses';
import { createFleet, type Fleet, type ShipSpot } from './ships';
import type { P2 } from './geom';

/** Structures rise from this far below ground (scene units) when built. */
const RISE_DEPTH = 90;
const RISE_SECONDS = 0.9;
/** Population at which harbours and anchorages are full. */
const FULL_TRADE_POPULATION = 450000;

interface Entry {
  s: CityStructure;
  /** Built group per stage variant (key '' = no stages). */
  variants: Map<string, Group>;
  /** Visible variant key, or null when not standing. */
  shown: string | null;
  /** Per variant: current rise 0..1. */
  rise: Map<string, number>;
}

export interface CityModel {
  group: Group;
  setYear(year: number): void;
  update(timeSec: number, deltaSec: number): void;
  dispose(): void;
}

function makeHash(): (key: string, i: number) => number {
  return (key, i) => mulberry32((hashStringSeed(key) ^ Math.imul(i + 1, 0x9e3779b1)) >>> 0)();
}

export function createCityModel(data: CitySceneData, hf: CityHeightField, hs: number): CityModel {
  const mats = createCityMaterials();
  const toLocal = (ll: [number, number]): P2 => hf.frame.lonLatToLocal(ll[0], ll[1]);
  const groundY = (x: number, z: number) => Math.max(hf.yAt(x, z), 0.3);
  const byId = new Map(data.structures.map((s) => [s.id, s]));
  const breachGate = byId.get('gate-st-romanus');
  const ctx: BuildContext = {
    toLocal,
    groundY,
    mats,
    hs,
    cityCenter: toLocal(data.home.lonlat),
    breaches: breachGate?.position ? [toLocal(breachGate.position)] : [],
    hash: makeHash(),
  };

  const root = new Group();
  root.name = `city-${data.id}`;

  /* Structures ---------------------------------------------------- */
  const entries: Entry[] = data.structures.map((s) => {
    const keys = s.stages?.length ? [...new Set(s.stages.map((st) => st.variant))] : [''];
    const variants = new Map<string, Group>();
    for (const key of keys) {
      const variant = key || null;
      const g =
        s.kind === 'land-wall' || s.kind === 'sea-wall'
          ? buildWall(s, variant ?? (s.kind === 'land-wall' ? 'intact' : null), ctx)
          : buildLandmark(s, variant, ctx);
      if (!g) continue;
      g.visible = false;
      g.position.y = -RISE_DEPTH;
      root.add(g);
      variants.set(key, g);
    }
    return { s, variants, shown: null, rise: new Map(keys.map((k) => [k, 0])) };
  });

  /* Houses -------------------------------------------------------- */
  const rings = data.urbanAreas.map((a) => a.ring.map((p) => toLocal(p)));
  const keepClear = data.structures
    .filter((s) => s.position && s.kind !== 'column')
    .map((s) => {
      const p = toLocal(s.position!);
      const [a = 30, b = 30] = s.size ?? [];
      const extra = s.kind === 'great-church' ? 60 : 12;
      return { x: p.x, z: p.z, r: Math.max(a, b) / 2 + extra };
    });
  const corridors = data.structures
    .filter((s) => s.path)
    .map((s) => {
      const path = s.path!.map((p) => toLocal(p));
      const halfWidth =
        s.id === 'theodosian-walls'
          ? 55
          : s.kind === 'land-wall'
            ? 16
            : s.kind === 'sea-wall'
              ? 10
              : s.kind === 'avenue'
                ? (s.size?.[0] ?? 20) / 2 + 12
                : 10;
      return { path, halfWidth };
    });
  const sites = generateHouseSites({
    seed: `${data.id}-houses`,
    rings,
    heightAt: (x, z) => hf.heightAt(x, z),
    core: toLocal(byId.get('column-of-constantine')?.position ?? data.home.lonlat),
    keepClear,
    corridors,
  });
  const houses: HouseLayer = createHouseLayer(sites, groundY, hs, mats);
  for (const m of houses.meshes) root.add(m);

  /* Ships ---------------------------------------------------------- */
  const rand = mulberry32(hashStringSeed(`${data.id}-ships`));
  const spots: ShipSpot[] = [];
  const isWater = (x: number, z: number, depth = 2) => hf.heightAt(x, z) < -depth;
  const addSpot = (x: number, z: number, group: string, length: number, rotY?: number) => {
    spots.push({ x, z, group, length, rotY: rotY ?? rand() * Math.PI * 2, threshold: rand(), phase: rand() * 10 });
  };
  for (const s of data.structures) {
    if (s.kind !== 'harbor' || !s.position) continue;
    const c = toLocal(s.position);
    const [len = 200, width = 100] = s.size ?? [];
    const rotY = ((90 - (s.bearing ?? 90)) * Math.PI) / 180;
    const cols = Math.max(2, Math.floor(len / 34));
    const rows = Math.max(1, Math.floor(width / 26));
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        const lx = (i + 0.5) * (len / cols) - len / 2;
        const lz = (j + 0.5) * (width / rows) - width / 2;
        const x = c.x + lx * Math.cos(rotY) + lz * Math.sin(rotY);
        const z = c.z - lx * Math.sin(rotY) + lz * Math.cos(rotY);
        addSpot(x, z, s.id, 16 + rand() * 10, rotY + (rand() - 0.5) * 0.3);
      }
    }
  }
  // Open-water anchorages: scattered water points in three regions.
  const anchorages: Array<{ group: string; center: [number, number]; radius: number; count: number }> = [
    { group: 'golden-horn', center: [28.962, 41.031], radius: 1300, count: 36 },
    { group: 'bosporus', center: [29.0, 41.035], radius: 1600, count: 14 },
    { group: 'propontis', center: [28.96, 40.995], radius: 1800, count: 18 },
  ];
  for (const a of anchorages) {
    const c = toLocal(a.center);
    let placed = 0;
    for (let tries = 0; tries < a.count * 40 && placed < a.count; tries++) {
      const ang = rand() * Math.PI * 2;
      const r = Math.sqrt(rand()) * a.radius;
      const x = c.x + Math.cos(ang) * r;
      const z = c.z + Math.sin(ang) * r;
      if (!isWater(x, z, 4) || !isWater(x + 25, z, 3) || !isWater(x - 25, z, 3)) continue;
      addSpot(x, z, a.group, 18 + rand() * 16);
      placed++;
    }
  }
  const fleet: Fleet = createFleet(spots, mats);
  for (const m of fleet.meshes) root.add(m);

  /* Year switching -------------------------------------------------- */
  const setYear = (year: number) => {
    for (const e of entries) {
      let key: string | null = null;
      if (structureStands(e.s, year)) key = structureVariant(e.s, year) ?? '';
      e.shown = key !== null && e.variants.has(key) ? key : null;
    }
    const ringIndex = data.urbanAreas.indexOf(urbanAreaForYear(data, year));
    houses.setTarget(interpolateKeyframes(data.density, year), ringIndex);
    const trade = Math.min(1, interpolateKeyframes(data.population, year) / FULL_TRADE_POPULATION);
    const shares: Record<string, number> = {
      'golden-horn': 0.25 + 0.75 * trade,
      bosporus: 0.3 + 0.5 * trade,
      propontis: 0.2 + 0.6 * trade,
    };
    for (const s of data.structures) {
      if (s.kind === 'harbor') shares[s.id] = structureStands(s, year) ? 0.3 + 0.7 * trade : 0;
    }
    // Galata's Genoese quays teem after the 1260s.
    if (year >= 1267) shares['golden-horn'] = Math.min(1, shares['golden-horn'] + 0.3);
    fleet.setShares(shares);
  };

  const update = (timeSec: number, deltaSec: number) => {
    const step = deltaSec / RISE_SECONDS;
    for (const e of entries) {
      for (const [key, g] of e.variants) {
        const target = e.shown === key ? 1 : 0;
        let r = e.rise.get(key) ?? 0;
        if (r === target) continue;
        r = target > r ? Math.min(1, r + step) : Math.max(0, r - step);
        e.rise.set(key, r);
        const k = r * r * (3 - 2 * r);
        g.position.y = -RISE_DEPTH * (1 - k);
        g.visible = r > 0;
      }
    }
    houses.update(deltaSec);
    fleet.update(timeSec);
  };

  return {
    group: root,
    setYear,
    update,
    dispose() {
      for (const e of entries) for (const g of e.variants.values()) disposeGroup(g);
      houses.dispose();
      fleet.dispose();
      mats.dispose();
    },
  };
}
