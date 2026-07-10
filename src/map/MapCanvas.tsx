import { useEffect, useRef } from 'react';
import {
  ACESFilmicToneMapping,
  NoColorSpace,
  PCFShadowMap,
  Scene,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  Vector3,
  WebGLRenderer,
} from 'three';
import { snapshots } from '../data';
import { snapshotForYear } from '../lib/timeline';
import { useAppStore } from '../state/store';
import { heightFieldToDataTexture, loadHeightField } from './three/heightField';
import { createTerritoryController } from './three/territory';
import { buildSkirt, buildTerrain } from './three/terrain';
import { createWater } from './three/water';
import { createLighting } from './three/lights';
import { createAtmosphere } from './three/atmosphere';
import { createCameraRig } from './three/cameraRig';
import { lonLatToGround } from './three/geo';
import { setProjector } from './three/projection';

const HOME_LONLAT: [number, number] = [25, 38.5];
const HOME_DISTANCE = 120;

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
      const [heightField, albedo, normal, worldMask, waterNormal] = await Promise.all([
        loadHeightField(),
        loadWorldTexture('terrain/albedo.jpg', true),
        loadWorldTexture('terrain/normal.png', false),
        loadWorldTexture('terrain/worldmask.png', false),
        loadWorldTexture('terrain/waternormal.png', false),
      ]);
      if (disposed) {
        albedo?.dispose();
        normal?.dispose();
        worldMask?.dispose();
        waterNormal?.dispose();
        return;
      }

      let renderer: WebGLRenderer;
      try {
        // Log depth: true-scale heights are tiny next to the 232-unit world,
        // so linear depth would z-fight the water plane against coastal land.
        renderer = new WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
      } catch (err) {
        console.warn('WebGL unavailable, map disabled:', err);
        return;
      }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.outputColorSpace = SRGBColorSpace;
      renderer.toneMapping = ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.1;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = PCFShadowMap;
      if (albedo) albedo.anisotropy = renderer.capabilities.getMaxAnisotropy();
      host.appendChild(renderer.domElement);

      const scene = new Scene();
      const terrain = buildTerrain(heightField, { albedo, normal, detail: waterNormal, worldMask });
      scene.add(terrain.mesh);
      const skirt = buildSkirt(heightField);
      scene.add(skirt.mesh);
      const water = createWater({
        waterNormal,
        heightY: heightFieldToDataTexture(heightField),
        worldMask,
      });
      scene.add(water.mesh);
      const lighting = createLighting();
      scene.add(lighting.group);
      const atmosphere = createAtmosphere(scene);

      // Territory drape: instant on load, crossfading on snapshot changes.
      const territoryCtl = createTerritoryController(terrain.uniforms);
      let snapYear = snapshotForYear(snapshots, useAppStore.getState().year).year;
      territoryCtl.setSnapshot(snapYear, false);
      const unsubscribe = useAppStore.subscribe((s) => {
        const newSnapYear = snapshotForYear(snapshots, s.year).year;
        if (newSnapYear !== snapYear) {
          snapYear = newSnapYear;
          territoryCtl.setSnapshot(newSnapYear);
        }
      });

      let viewDirty = true;
      const rig = createCameraRig(renderer.domElement, () => {
        viewDirty = true;
      });

      const resize = () => {
        const w = host.clientWidth || 1;
        const h = host.clientHeight || 1;
        renderer.setSize(w, h);
        rig.resize(w, h);
      };
      const observer = new ResizeObserver(resize);
      observer.observe(host);
      resize();

      // Open over the imperial heartland so the whole east reads at a glance.
      const home = lonLatToGround(...HOME_LONLAT);
      rig.centerOn(home.x, home.z, HOME_DISTANCE);

      // Screen projection for the DOM marker overlays.
      const projected = new Vector3();
      setProjector((lon, lat) => {
        const g = lonLatToGround(lon, lat);
        projected.set(g.x, heightField.yAt(lon, lat), g.z).project(rig.camera);
        return {
          x: ((projected.x + 1) / 2) * (host.clientWidth || 1),
          y: ((1 - projected.y) / 2) * (host.clientHeight || 1),
          visible:
            projected.z < 1 &&
            Math.abs(projected.x) <= 1.05 &&
            Math.abs(projected.y) <= 1.05,
        };
      });

      const bumpView = useAppStore.getState().bumpView;
      let lastTimeMs = 0;
      renderer.setAnimationLoop((timeMs: number) => {
        const delta = Math.min(0.1, (timeMs - lastTimeMs) / 1000);
        lastTimeMs = timeMs;
        terrain.uniforms.uTime.value = timeMs / 1000;
        water.setTime(timeMs / 1000);
        territoryCtl.update(delta);
        if (viewDirty) {
          viewDirty = false;
          lighting.updateShadowFrustum(rig.camera, host.clientWidth, host.clientHeight);
          atmosphere.update(rig.distance);
          bumpView();
        }
        renderer.render(scene, rig.camera);
      });

      if (import.meta.env.DEV) {
        // Dev-console handle for inspecting the scene. Assigned after the
        // disposed check so a StrictMode-destroyed first mount never wins
        // the race against the surviving one.
        (globalThis as Record<string, unknown>).__ercmDebug = { renderer, scene, rig, terrain, water };
      }

      cleanup = () => {
        setProjector(null);
        unsubscribe();
        territoryCtl.dispose();
        observer.disconnect();
        rig.dispose();
        renderer.setAnimationLoop(null);
        terrain.dispose();
        skirt.dispose();
        water.dispose();
        lighting.dispose();
        albedo?.dispose();
        normal?.dispose();
        worldMask?.dispose();
        waterNormal?.dispose();
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
