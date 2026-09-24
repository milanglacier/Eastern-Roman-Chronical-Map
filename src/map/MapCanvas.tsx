import { useEffect, useRef } from 'react';
import {
  ACESFilmicToneMapping,
  Camera,
  NoColorSpace,
  PCFShadowMap,
  Scene,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  Vector3,
  WebGLRenderer,
} from 'three';
import { cities, cityScenes, snapshots } from '../data';
import { snapshotForYear } from '../lib/timeline';
import { useAppStore, type MapView } from '../state/store';
import { heightFieldToDataTexture, loadHeightField } from './three/heightField';
import { createTerritoryController } from './three/territory';
import { buildSkirt, buildTerrain } from './three/terrain';
import { createOceanApron, createWater } from './three/water';
import { createLighting } from './three/lights';
import { createAtmosphere } from './three/atmosphere';
import { createCameraRig, DIST_MIN } from './three/cameraRig';
import { lonLatToGround } from './three/geo';
import { setProjector, type Projector } from './three/projection';
import { createCloudLayer, createCloudUniforms } from './three/clouds';
import { createPostFx } from './three/postfx';
import { createCityScene, type CityScene } from './three/city/cityScene';

const HOME_LONLAT: [number, number] = [25, 38.5];
const HOME_DISTANCE = 120;
/** The world camera offers a city view when zoomed in this close… */
const LENS_OFFER_DISTANCE = 48;
/** …with its look-at point within this many units (~0.75°) of the city. */
const LENS_OFFER_RADIUS = 3;

async function loadWorldTexture(url: string, srgb: boolean): Promise<Texture | null> {
  try {
    const tex = await new TextureLoader().loadAsync(url);
    tex.flipY = false; // all world textures: image row 0 = north = V 0
    tex.colorSpace = srgb ? SRGBColorSpace : NoColorSpace;
    return tex;
  } catch {
    console.warn(`texture unavailable: ${url}`);
    return null;
  }
}

/** Three.js host. All map drawing is imperative; React only owns the container div. */
export function MapCanvas() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let cleanup: (() => void) | null = null;

    (async () => {
      const [heightField, albedo, normal, worldMask, waterNormal, cloudTex, detailMix] = await Promise.all([
        loadHeightField(),
        loadWorldTexture('terrain/albedo.jpg', true),
        loadWorldTexture('terrain/normal.png', false),
        loadWorldTexture('terrain/worldmask.png', false),
        loadWorldTexture('terrain/waternormal.png', false),
        loadWorldTexture('terrain/clouds.png', false),
        loadWorldTexture('textures/detail/detail-mix.png', false),
      ]);
      if (disposed) {
        albedo?.dispose();
        normal?.dispose();
        worldMask?.dispose();
        waterNormal?.dispose();
        cloudTex?.dispose();
        detailMix?.dispose();
        return;
      }

      let renderer: WebGLRenderer;
      try {
        // Log depth: true-scale heights are tiny next to the 288-unit world,
        // so linear depth would z-fight the water plane against coastal land.
        // MSAA happens in the post chain's render target (postfx.ts).
        renderer = new WebGLRenderer({ antialias: false, logarithmicDepthBuffer: true });
      } catch (err) {
        console.warn('WebGL unavailable, map disabled:', err);
        return;
      }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.outputColorSpace = SRGBColorSpace;
      renderer.toneMapping = ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.2;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = PCFShadowMap;
      if (albedo) albedo.anisotropy = renderer.capabilities.getMaxAnisotropy();
      if (detailMix) detailMix.anisotropy = renderer.capabilities.getMaxAnisotropy();
      host.appendChild(renderer.domElement);

      const scene = new Scene();
      const clouds = createCloudUniforms(cloudTex);
      const terrain = buildTerrain(
        heightField,
        { albedo, normal, detail: waterNormal, worldMask, detailMix },
        clouds,
      );
      scene.add(terrain.mesh);
      const skirt = buildSkirt(heightField);
      scene.add(skirt.mesh);
      const water = createWater(
        {
          waterNormal,
          heightY: heightFieldToDataTexture(heightField),
          worldMask,
        },
        clouds,
      );
      scene.add(water.mesh);
      const oceanApron = createOceanApron({ waterNormal }, clouds);
      scene.add(oceanApron.mesh);
      const cloudLayer = createCloudLayer(clouds);
      scene.add(cloudLayer.mesh);
      const lighting = createLighting();
      scene.add(lighting.group);
      const atmosphere = createAtmosphere(scene);

      // Territory drape: instant on load, crossfading on snapshot changes.
      const territoryCtl = createTerritoryController(terrain.uniforms, heightField);
      let snapYear = snapshotForYear(snapshots, useAppStore.getState().year).year;
      territoryCtl.setSnapshot(snapYear, false);
      const unsubscribe = useAppStore.subscribe((s) => {
        const newSnapYear = snapshotForYear(snapshots, s.year).year;
        if (newSnapYear !== snapYear) {
          snapYear = newSnapYear;
          territoryCtl.setSnapshot(newSnapYear);
        }
      });

      let worldDirty = true;
      const rig = createCameraRig(renderer.domElement, () => {
        worldDirty = true;
      });
      const postFx = createPostFx(renderer, scene, rig.camera);

      // City lens: per-city scenes built on first entry, then cached.
      const citySceneCache = new Map<string, CityScene>();
      let activeCity: CityScene | null = null;
      let cityDirty = true;

      const resize = () => {
        const w = host.clientWidth || 1;
        const h = host.clientHeight || 1;
        renderer.setSize(w, h);
        postFx.setSize(w, h);
        rig.resize(w, h);
        for (const cs of citySceneCache.values()) cs.rig.resize(w, h);
      };
      const observer = new ResizeObserver(resize);
      observer.observe(host);
      resize();

      // Open over the imperial heartland so the whole east reads at a glance.
      const home = lonLatToGround(...HOME_LONLAT);
      rig.centerOn(home.x, home.z, HOME_DISTANCE);

      // Screen projection for the DOM marker overlays.
      const projected = new Vector3();
      const toScreen = (camera: Camera, x: number, y: number, z: number) => {
        projected.set(x, y, z).project(camera);
        return {
          x: ((projected.x + 1) / 2) * (host.clientWidth || 1),
          y: ((1 - projected.y) / 2) * (host.clientHeight || 1),
          visible:
            projected.z < 1 &&
            Math.abs(projected.x) <= 1.05 &&
            Math.abs(projected.y) <= 1.05,
        };
      };
      const worldProjector: Projector = (lon, lat) => {
        const g = lonLatToGround(lon, lat);
        return toScreen(rig.camera, g.x, heightField.yAt(lon, lat), g.z);
      };
      const cityProjector =
        (cs: CityScene): Projector =>
        (lon, lat) => {
          const { frame } = cs.heightField;
          if (!frame.contains(lon, lat)) return { x: 0, y: 0, visible: false };
          const p = frame.lonLatToLocal(lon, lat);
          return toScreen(cs.rig.camera, p.x, cs.heightField.yAt(p.x, p.z), p.z);
        };
      setProjector(worldProjector);

      // Haze veil for the dive between world and city.
      const veil = document.createElement('div');
      veil.className = 'view-veil';
      host.appendChild(veil);
      const setVeil = (opacity: number, ms: number) =>
        new Promise<void>((resolve) => {
          veil.style.transition = `opacity ${ms}ms ease-in-out`;
          veil.style.opacity = String(opacity);
          window.setTimeout(resolve, ms);
        });
      const wait = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

      const getCityScene = async (id: string): Promise<CityScene> => {
        const cached = citySceneCache.get(id);
        if (cached) return cached;
        const data = cityScenes.get(id);
        if (!data) throw new Error(`no city view data: ${id}`);
        const cs = await createCityScene({
          id,
          renderer,
          domElement: renderer.domElement,
          waterNormal,
          data,
          onViewChange: () => {
            cityDirty = true;
          },
        });
        citySceneCache.set(id, cs);
        cs.rig.resize(host.clientWidth || 1, host.clientHeight || 1);
        return cs;
      };
      const cityLonLat = (id: string): [number, number] =>
        cities.find((c) => c.scene === id)?.lonlat ?? cityScenes.get(id)!.home.lonlat;

      const enterCity = async (id: string) => {
        const g = lonLatToGround(...cityLonLat(id));
        const loading = getCityScene(id); // load while diving
        const dive = rig.flyTo({ x: g.x, z: g.z, distance: DIST_MIN }, 1200);
        await wait(450);
        await setVeil(1, 700);
        await dive;
        let cs: CityScene;
        try {
          cs = await loading;
        } catch (err) {
          console.warn('city view unavailable:', err);
          await setVeil(0, 500);
          useAppStore.getState().exitCity();
          return;
        }
        if (disposed) return;
        rig.enabled = false;
        activeCity = cs;
        cs.rig.enabled = true;
        cs.setYear(useAppStore.getState().year);
        postFx.setView(cs.scene, cs.rig.camera);
        setProjector(cityProjector(cs));
        // Establishing shot: arrive high and turned, settle onto the home view.
        const h = cs.home;
        cs.rig.centerOn(h.x, h.z, h.distance * 2.4, h.heading - 0.6);
        cityDirty = true;
        const settle = cs.rig.flyTo(h, 3200);
        await setVeil(0, 1000);
        await settle;
      };

      const exitCity = async () => {
        const cs = activeCity;
        if (!cs) return;
        const t = cs.rig.target;
        const rise = cs.rig.flyTo({ x: t.x, z: t.z, distance: cs.rig.distance * 2.6 }, 1000);
        await wait(200);
        await setVeil(1, 700);
        await rise;
        if (disposed) return;
        cs.rig.enabled = false;
        activeCity = null;
        rig.enabled = true;
        postFx.setView(scene, rig.camera);
        setProjector(worldProjector);
        const g = lonLatToGround(...cityLonLat(cs.id));
        rig.centerOn(g.x, g.z, DIST_MIN);
        worldDirty = true;
        const pull = rig.flyTo({ x: g.x, z: g.z, distance: 42 }, 1800);
        await setVeil(0, 900);
        await pull;
      };

      // Serialize transitions: each view request waits for the previous one.
      let transition: Promise<void> = Promise.resolve();
      let shownView: MapView = { kind: 'world' };
      const unsubscribeView = useAppStore.subscribe((s) => {
        const next = s.view;
        if (next === shownView) return;
        const prev = shownView;
        shownView = next;
        transition = transition.then(async () => {
          if (disposed) return;
          if (prev.kind === 'city') await exitCity();
          if (next.kind === 'city') await enterCity(next.cityId);
        });
      });
      const unsubscribeYear = useAppStore.subscribe((s, prev) => {
        if (s.year !== prev.year) activeCity?.setYear(s.year);
      });

      /** Offer the city lens when the world camera is zoomed in near one. */
      const updateLensCandidate = () => {
        let candidate: string | null = null;
        if (!activeCity && rig.distance < LENS_OFFER_DISTANCE) {
          const t = rig.target;
          for (const c of cities) {
            if (!c.scene) continue;
            const g = lonLatToGround(...c.lonlat);
            if (Math.hypot(g.x - t.x, g.z - t.z) < LENS_OFFER_RADIUS) candidate = c.scene;
          }
        }
        useAppStore.getState().setLensCandidate(candidate);
      };

      const bumpView = useAppStore.getState().bumpView;
      let lastTimeMs = 0;
      renderer.setAnimationLoop((timeMs: number) => {
        const delta = Math.min(0.1, (timeMs - lastTimeMs) / 1000);
        lastTimeMs = timeMs;
        rig.update(timeMs);
        const w = host.clientWidth;
        const h = host.clientHeight;
        if (activeCity) {
          activeCity.rig.update(timeMs);
          activeCity.update(timeMs / 1000, delta, cityDirty, w, h);
          if (cityDirty) {
            cityDirty = false;
            bumpView();
          }
        } else {
          terrain.uniforms.uTime.value = timeMs / 1000;
          water.setTime(timeMs / 1000);
          oceanApron.setTime(timeMs / 1000);
          clouds.uCloudTime.value = timeMs / 1000;
          territoryCtl.update(delta);
          if (worldDirty) {
            worldDirty = false;
            lighting.updateShadowFrustum(rig.camera, w, h);
            atmosphere.update(rig.distance, rig.camera.position);
            cloudLayer.update(rig.distance);
            updateLensCandidate();
            bumpView();
          }
        }
        postFx.render();
      });

      if (import.meta.env.DEV) {
        // Dev-console handle for inspecting the scene. Assigned after the
        // disposed check so a StrictMode-destroyed first mount never wins
        // the race against the surviving one.
        (globalThis as Record<string, unknown>).__ercmDebug = {
          renderer,
          scene,
          rig,
          terrain,
          water,
          city: () => activeCity,
        };
      }

      cleanup = () => {
        setProjector(null);
        unsubscribe();
        unsubscribeView();
        unsubscribeYear();
        territoryCtl.dispose();
        observer.disconnect();
        rig.dispose();
        renderer.setAnimationLoop(null);
        for (const cs of citySceneCache.values()) cs.dispose();
        citySceneCache.clear();
        terrain.dispose();
        skirt.dispose();
        water.dispose();
        oceanApron.dispose();
        cloudLayer.dispose();
        atmosphere.dispose();
        postFx.dispose();
        lighting.dispose();
        albedo?.dispose();
        normal?.dispose();
        worldMask?.dispose();
        waterNormal?.dispose();
        cloudTex?.dispose();
        renderer.dispose();
      };
    })();

    return () => {
      disposed = true;
      cleanup?.();
      cleanup = null;
      host.replaceChildren();
    };
  }, []);

  return <div ref={hostRef} className="map-canvas" data-testid="map-canvas" />;
}
