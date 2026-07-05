import { useEffect, useRef } from 'react';
import { Application, Container } from 'pixi.js';
import { snapshots } from '../data';
import { snapshotForYear } from '../lib/timeline';
import { useAppStore } from '../state/store';
import { loadTerrainAtlas } from './renderer/atlas';
import { buildTerrainLayers } from './renderer/terrainSprites';
import { buildRiversGraphics, strokeRiversMask } from './renderer/rivers';
import { createShimmer, type Shimmer } from './renderer/water';
import { buildTerritoryGraphics } from './renderer/territory';
import { buildCitiesLayer, visibleCities } from './renderer/cities';
import { createCamera } from './camera';
import { lonLatToIso } from './iso';

const CROSSFADE_MS = 550;

/** Pixi host. All map drawing is imperative; React only owns the container div. */
export function MapCanvas() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let app: Application | null = null;
    let camera: ReturnType<typeof createCamera> | null = null;
    let unsubscribe: (() => void) | null = null;
    let shimmer: Shimmer | null = null;

    (async () => {
      const pixi = new Application();
      await pixi.init({ backgroundAlpha: 0, antialias: true, resizeTo: host });
      const atlas = await loadTerrainAtlas(pixi.renderer);
      if (import.meta.env.DEV) {
        // Dev-console handle for inspecting the atlas and scene.
        (globalThis as Record<string, unknown>).__ercmDebug = { app: pixi, atlas };
      }
      if (disposed) {
        pixi.destroy(true);
        return;
      }
      app = pixi;
      host.appendChild(pixi.canvas);

      // Layer stack (bottom → top): water, shimmer, land, rivers,
      // territoryHost (crossfades happen inside it), cities.
      const world = new Container();
      pixi.stage.addChild(world);
      const { water, land } = buildTerrainLayers(atlas);
      world.addChild(water);
      shimmer = createShimmer(pixi.renderer, pixi.ticker, strokeRiversMask);
      world.addChild(shimmer.container);
      world.addChild(land);
      world.addChild(buildRiversGraphics());
      const territoryHost = new Container();
      world.addChild(territoryHost);

      const state = useAppStore.getState();
      let snapYear = snapshotForYear(snapshots, state.year).year;
      let territoryLayer = buildTerritoryGraphics(snapYear);
      territoryHost.addChild(territoryLayer);

      let citiesKey = '';
      let citiesLayer: Container | null = null;
      const refreshCities = (year: number, language: 'en' | 'zh') => {
        const key = `${language}:${visibleCities(year).map((c) => c.id).join(',')}`;
        if (key === citiesKey) return;
        citiesKey = key;
        if (citiesLayer) {
          world.removeChild(citiesLayer);
          citiesLayer.destroy({ children: true });
        }
        citiesLayer = buildCitiesLayer(year, language);
        world.addChild(citiesLayer);
      };
      refreshCities(state.year, state.language);

      const swapTerritory = (newSnapYear: number) => {
        const oldLayer = territoryLayer;
        const newLayer = buildTerritoryGraphics(newSnapYear);
        newLayer.alpha = 0;
        territoryHost.addChild(newLayer);
        territoryLayer = newLayer;
        let elapsed = 0;
        const tick = () => {
          elapsed += pixi.ticker.deltaMS;
          const t = Math.min(1, elapsed / CROSSFADE_MS);
          newLayer.alpha = t;
          oldLayer.alpha = 1 - t;
          if (t >= 1) {
            pixi.ticker.remove(tick);
            territoryHost.removeChild(oldLayer);
            oldLayer.destroy();
          }
        };
        pixi.ticker.add(tick);
      };

      unsubscribe = useAppStore.subscribe((s) => {
        const newSnapYear = snapshotForYear(snapshots, s.year).year;
        if (newSnapYear !== snapYear) {
          snapYear = newSnapYear;
          swapTerritory(newSnapYear);
        }
        refreshCities(s.year, s.language);
      });

      camera = createCamera(pixi.canvas, world);
      // Open wide over the imperial heartland so the whole empire reads at a
      // glance; the camera clamps to its fill-the-viewport minimum scale.
      const home = lonLatToIso(25, 38.5);
      camera.centerOn(home.x, home.y, 1.0);
    })();

    return () => {
      disposed = true;
      unsubscribe?.();
      camera?.destroy();
      shimmer?.destroy();
      if (app) {
        app.destroy(true, { children: true });
        app = null;
      }
      host.replaceChildren();
    };
  }, []);

  return <div ref={hostRef} className="map-canvas" data-testid="map-canvas" />;
}
