import { useEffect, useRef } from 'react';
import { NoColorSpace, NoToneMapping, PCFShadowMap, SRGBColorSpace, Texture, TextureLoader, WebGLRenderer } from 'three';
import { moods } from '../data';
import { sampleMood, type Mood } from '../lib/mood';
import { useAppStore } from '../state/store';
import { loadHeightField } from './three/heightField';
import { createWorldView, type ViewMode } from './three/worldScene';
import {
  ENTER_CITY_EVENT,
  JOURNEY_EVENT,
  LEAVE_CITY_EVENT,
  NORTH_UP_EVENT,
  setCameraHeading,
  setProjector,
} from './three/projection';
import { activeTheme } from './three/theme';
import { createPipeline } from './three/postfx/pipeline';
import {
  QUALITY_PRESETS,
  createFrameProbe,
  initialTier,
  nextLowerTier,
  type QualityTier,
} from './three/postfx/quality';

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

/**
 * Three.js host. Owns the renderer, the post pipeline, the loop and the era
 * mood; the world view (worldScene.ts) owns everything in the scene. React
 * only owns the container div.
 */
export function MapCanvas() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let cleanup: (() => void) | null = null;

    (async () => {
      const [heightField, albedo, worldMask, waterNormal, granulation] = await Promise.all([
        loadHeightField(),
        loadWorldTexture('terrain/albedo.jpg', true),
        loadWorldTexture('terrain/worldmask.png', false),
        loadWorldTexture('terrain/waternormal.png', false),
        loadWorldTexture('terrain/granulation.png', false),
      ]);
      const textures = [albedo, worldMask, waterNormal, granulation];
      if (disposed) {
        for (const t of textures) t?.dispose();
        return;
      }

      let renderer: WebGLRenderer;
      try {
        // Log depth: true-scale heights are tiny next to the 288-unit world,
        // so linear depth would z-fight the water plane against coastal land.
        // No canvas MSAA: the pipeline renders into its own MSAA target.
        renderer = new WebGLRenderer({ antialias: false, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
      } catch (err) {
        console.warn('WebGL unavailable, map disabled:', err);
        return;
      }
      const theme = activeTheme();
      const tierInfo = initialTier();
      let tier: QualityTier = tierInfo.tier;
      const pixelRatioFor = (t: QualityTier) => Math.min(window.devicePixelRatio || 1, QUALITY_PRESETS[t].maxPixelRatio);
      renderer.setPixelRatio(pixelRatioFor(tier));
      renderer.outputColorSpace = SRGBColorSpace;
      renderer.toneMapping = NoToneMapping; // the composite pass tone-maps
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = PCFShadowMap;
      if (albedo) albedo.anisotropy = renderer.capabilities.getMaxAnisotropy();
      if (granulation) granulation.anisotropy = renderer.capabilities.getMaxAnisotropy();
      host.appendChild(renderer.domElement);

      const pipeline = createPipeline(renderer, QUALITY_PRESETS[tier]);
      Object.assign(
        pipeline.params,
        theme === 'clockwork' ? { ink: 0.22, grain: 0.035, vignette: 0.8 } : { ink: 0.4, grain: 0.06, vignette: 0.55 },
      );
      const bumpView = useAppStore.getState().bumpView;

      // The switch between the map and a city view passes through a veil of
      // painted cloud: it thickens while zooming in (or out), the scenes swap
      // behind it, and it thins while the zoom carries on.
      const veil = document.createElement('div');
      veil.className = 'city-veil';
      veil.setAttribute('aria-hidden', 'true');
      host.appendChild(veil);
      let switching = false;
      const switchTo = async (next: ViewMode) => {
        if (switching || world.mode === next) return;
        switching = true;
        const inward = next === 'city';
        const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
        const [s0, s1, s2] = inward ? [1, 1.18, 1.42] : [1.42, 1.18, 1];
        try {
          await veil.animate(
            [
              { opacity: 0, transform: `scale(${s0})` },
              { opacity: 1, transform: `scale(${s1})` },
            ],
            { duration: reduce ? 120 : 480, easing: 'cubic-bezier(0.5, 0, 0.9, 0.6)', fill: 'forwards' },
          ).finished;
          world.setMode(next);
          useAppStore.getState().setCityView(inward ? 'constantinople' : null);
          await veil.animate(
            [
              { opacity: 1, transform: `scale(${s1})` },
              { opacity: 0, transform: `scale(${s2})` },
            ],
            { duration: reduce ? 160 : 900, easing: 'cubic-bezier(0.2, 0.5, 0.4, 1)', fill: 'forwards' },
          ).finished;
        } finally {
          switching = false;
        }
      };

      const world = createWorldView(
        renderer.domElement,
        { heightField, albedo, worldMask, waterNormal, granulation },
        {
          theme,
          renderer,
          shadowMapSize: QUALITY_PRESETS[tier].shadowMapSize,
          onModeRequest: (next) => void switchTo(next),
        },
      );

      // Era mood + territory follow the year.
      let mood: Mood = sampleMood(moods, useAppStore.getState().year);
      let moodYear = useAppStore.getState().year;
      const applyYear = (year: number) => {
        moodYear = year;
        mood = sampleMood(moods, year);
        world.setMood(mood);
        pipeline.setMood(mood);
        world.setYear(year);
      };
      applyYear(moodYear);
      const unsubscribe = useAppStore.subscribe((s) => {
        if (s.year !== moodYear) applyYear(s.year);
      });

      const resize = () => {
        const w = host.clientWidth || 1;
        const h = host.clientHeight || 1;
        renderer.setSize(w, h);
        pipeline.setSize(w, h, renderer.getPixelRatio());
        world.resize(w, h);
      };
      const observer = new ResizeObserver(resize);
      observer.observe(host);
      resize();

      setProjector((lon, lat) => world.project(lon, lat, host.clientWidth || 1, host.clientHeight || 1));
      const onNorthUp = () => void world.rig.flyTo({ heading: 0 }, 0.9);
      window.addEventListener(NORTH_UP_EVENT, onNorthUp);
      const onJourney = async () => {
        if (world.mode === 'city') await switchTo('world');
        void world.playJourney();
      };
      window.addEventListener(JOURNEY_EVENT, onJourney);
      const onEnterCity = () => void switchTo('city');
      const onLeaveCity = () => void switchTo('world');
      window.addEventListener(ENTER_CITY_EVENT, onEnterCity);
      window.addEventListener(LEAVE_CITY_EVENT, onLeaveCity);
      // Opening: fly in over the Aegean as Constantinople rises (skipped for
      // scripted screenshots via ?intro=0).
      const intro = new URLSearchParams(location.search).get('intro') !== '0';
      if (intro) setTimeout(() => void world.playJourney(), 600);

      const setTier = (next: QualityTier) => {
        tier = next;
        renderer.setPixelRatio(pixelRatioFor(next));
        pipeline.setQuality(QUALITY_PRESETS[next]);
        world.setShadowMapSize(QUALITY_PRESETS[next].shadowMapSize);
        resize();
      };
      const probe = createFrameProbe();

      let frozenTime: number | null = null;
      let frames = 0;
      let lastTimeMs = 0;
      let lastCam = '';
      renderer.setAnimationLoop((timeMs: number) => {
        const frameMs = lastTimeMs ? timeMs - lastTimeMs : 16;
        const delta = Math.min(0.1, frameMs / 1000);
        lastTimeMs = timeMs;
        const t = frozenTime ?? timeMs / 1000;
        world.update(delta, t);
        const cam = world.rig.camera;
        const camKey = `${cam.position.x.toFixed(4)},${cam.position.y.toFixed(4)},${cam.position.z.toFixed(4)},${cam.quaternion.w.toFixed(5)},${cam.quaternion.y.toFixed(5)}`;
        if (camKey !== lastCam) {
          lastCam = camKey;
          setCameraHeading(world.rig.pose.heading);
          bumpView();
        }
        // Tilt-shift focus on what the camera looks at; the clockwork model
        // is shot like a macro miniature, stronger as the camera lowers.
        pipeline.params.focus = world.rig.distance;
        pipeline.params.dof = theme === 'clockwork' ? 0.55 + 0.9 * (1 - Math.sin(world.rig.pose.pitch)) : 0.3;
        pipeline.render(world.scene, cam);
        frames++;
        if (!tierInfo.forced && probe.push(frameMs)) {
          const lower = nextLowerTier(tier);
          if (lower) {
            console.info(`render pipeline: stepping quality ${tier} → ${lower}`);
            setTier(lower);
          }
        }
      });

      if (import.meta.env.DEV) {
        // Dev-console / screenshot handle. Assigned after the disposed check
        // so a StrictMode-destroyed first mount never wins the race.
        (globalThis as Record<string, unknown>).__ercmDebug = {
          renderer,
          pipeline,
          world,
          rig: world.rig,
          get mood() {
            return mood;
          },
          get tier() {
            return tier;
          },
          get frames() {
            return frames;
          },
          setTier,
          setYear: (y: number) => useAppStore.getState().setYear(y),
          setPose: (p: Record<string, number>) => world.setView(p),
          setDrone: (p: Record<string, number>) => world.setView(p),
          journeyAt: (u: number) => world.journeyAt(u),
          cityView: (name: string) => {
            const ok = world.setCityView(name);
            if (ok) useAppStore.getState().setCityView('constantinople');
            return ok;
          },
          mode: () => world.mode,
          cityRise: (t: number) => world.setCityRise(t),
          playJourney: () => world.playJourney(),
          freezeTime: (t: number | null) => {
            frozenTime = t;
          },
        };
      }

      cleanup = () => {
        setProjector(null);
        window.removeEventListener(NORTH_UP_EVENT, onNorthUp);
        window.removeEventListener(JOURNEY_EVENT, onJourney);
        window.removeEventListener(ENTER_CITY_EVENT, onEnterCity);
        window.removeEventListener(LEAVE_CITY_EVENT, onLeaveCity);
        veil.remove();
        useAppStore.getState().setCityView(null);
        unsubscribe();
        observer.disconnect();
        renderer.setAnimationLoop(null);
        world.dispose();
        pipeline.dispose();
        for (const tex of textures) tex?.dispose();
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
