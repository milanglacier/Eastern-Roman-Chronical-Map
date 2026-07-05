import { useEffect, useRef } from 'react';
import { Application, Container } from 'pixi.js';
import { snapshots } from '../data';
import { snapshotForYear } from '../lib/timeline';
import { useAppStore } from '../state/store';
import { buildTerrainGraphics } from './renderer/terrain';
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

    (async () => {
      const pixi = new Application();
      await pixi.init({ backgroundAlpha: 0, antialias: true, resizeTo: host });
      if (disposed) {
        pixi.destroy(true);
        return;
      }
      app = pixi;
      host.appendChild(pixi.canvas);

      const world = new Container();
      pixi.stage.addChild(world);
      world.addChild(buildTerrainGraphics());

      const state = useAppStore.getState();
      let snapYear = snapshotForYear(snapshots, state.year).year;
      let territoryLayer = buildTerritoryGraphics(snapYear);
      world.addChild(territoryLayer);

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
        world.addChildAt(newLayer, 1);
        territoryLayer = newLayer;
        let elapsed = 0;
        const tick = () => {
          elapsed += pixi.ticker.deltaMS;
          const t = Math.min(1, elapsed / CROSSFADE_MS);
          newLayer.alpha = t;
          oldLayer.alpha = 1 - t;
          if (t >= 1) {
            pixi.ticker.remove(tick);
            world.removeChild(oldLayer);
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
      if (app) {
        app.destroy(true, { children: true });
        app = null;
      }
      host.replaceChildren();
    };
  }, []);

  return <div ref={hostRef} className="map-canvas" data-testid="map-canvas" />;
}
