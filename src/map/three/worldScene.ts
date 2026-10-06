/**
 * The world view: the whole Roman East as the living chronicle map —
 * parchment, ink and watercolour over sculpted relief on a convex curved
 * earth, flown with the free-look drone camera. Flying down close to
 * Constantinople enters its city view (chronicle/city/cityView.ts), a
 * scene of its own; climbing high above it returns to the map. `scene` and
 * `rig` always name the view on screen.
 *
 * The host (MapCanvas) owns the renderer, the post pipeline and the loop,
 * and pushes era moods / years in.
 */
import { Scene, Texture, Vector3, WebGLRenderer } from 'three';
import { cities, cityPlans, snapshots } from '../../data';
import { YEAR_MIN } from '../../data/schema';
import { snapshotForYear } from '../../lib/timeline';
import type { Mood } from '../../lib/mood';
import { reliefY } from '../../lib/relief';
import type { HeightField } from './heightField';
import { heightFieldToDataTexture } from './heightField';
import { createTerritoryController } from './territory';
import { buildSkirt } from './terrain';
import { createOceanApron, createWater } from './water';
import { createLighting } from './lights';
import { createAtmosphere } from './atmosphere';
import { createSky } from './sky';
import { groundToLonLat, lonLatToGround } from './geo';
import { bendY, curvatureUniforms, occludedByHorizon } from './curvature';
import { decodeCoastField } from './coastField';
import { createDaylightEnvironment } from './environment';
import { buildChronicleTerrain } from './chronicle/terrain';
import { CITY_EXIT_ALTITUDE, createCityView, type CityView } from './chronicle/city/cityView';
import { createDroneRig, dronePathPose, lookVector, type DronePose, type DroneRig } from './droneRig';
import { createEmpireTour, createPoseFollower } from './aerialTour';

export interface WorldAssets {
  heightField: HeightField;
  albedo: Texture | null;
  worldMask: Texture | null;
  waterNormal: Texture | null;
  granulation: Texture | null;
}

export interface ScreenPoint {
  x: number;
  y: number;
  visible: boolean;
}

/** What the host needs from the camera on screen (the map's drone or the city's). */
export type ViewRig = Pick<DroneRig, 'camera' | 'distance' | 'pose' | 'drone' | 'enabled' | 'flyTo' | 'update' | 'resize' | 'dispose'>;

export type ViewMode = 'world' | 'city';

export interface WorldView {
  /** The scene and camera on screen (the map, or the city view). */
  readonly scene: Scene;
  readonly rig: ViewRig;
  readonly mode: ViewMode;
  /** Swap between the map and the city view, placing the camera to continue the flight. */
  setMode(mode: ViewMode): void;
  resize(width: number, height: number): void;
  setMood(mood: Mood): void;
  setYear(year: number): void;
  /** Per frame: animations + flights. */
  update(deltaSeconds: number, timeSeconds: number): void;
  /** After the camera moved: shadows, fog. */
  refreshView(): void;
  setShadowMapSize(size: number): void;
  /** Lon/lat → CSS px in a viewport of the given size (bent + horizon-occluded). */
  project(lon: number, lat: number, width: number, height: number): ScreenPoint;
  /**
   * The aerial tour while the timeline plays: on, the map camera flies the
   * era's shot; off, it glides to rest. Handing the camera over (any input,
   * a guided flight) stops it until it is switched on again; leaving the
   * city view while it is on picks it back up. Never runs in the city view.
   */
  setTour(on: boolean): void;
  /** The guided flight from where the camera is, over the Aegean, to Constantinople. */
  playJourney(): Promise<boolean>;
  /** Screenshot/debug: pin the journey camera at progress u (0..1). */
  journeyAt(u: number): void;
  /** Screenshot/debug: set the city rise directly (0..1). */
  setCityRise(t: number): void;
  /** Screenshot/debug: place the camera (a drone pose). */
  setView(pose: Record<string, number>): void;
  /** Screenshot/debug: enter the city view at a named view (cityView.ts CITY_VIEWS). */
  setCityView(name: string): boolean;
  dispose(): void;
}

const DEG = Math.PI / 180;
/** Fallback centre of Constantinople (the peninsula). */
const CITY_LONLAT: [number, number] = [28.955, 41.018];
/** Seconds for the city to fold up on arrival. */
const CITY_RISE_SECONDS = 2.6;
/**
 * Enter the city view below this altitude when looking at the city (world
 * units), and arrive back on the map a little above it, so the switch
 * cannot flip back and forth.
 */
export const CITY_ENTER_ALTITUDE = 1.5;
const CITY_ENTER_REACH = 0.8;
export const MAP_RETURN_ALTITUDE = 2.4;
/** Seconds after a switch before the next one may be asked for. */
const SWITCH_COOLDOWN = 1.5;
/** Length of the guided flight to Constantinople. */
const FLIGHT_SECONDS = 12;
/** Tour follower stiffness (1/s): a gentle pick-up, then a steady follow. */
const TOUR_OMEGA_START = 0.8;
const TOUR_OMEGA = 2.2;
const TOUR_PICKUP_SECONDS = 3;

/**
 * The guided flight: high over the Aegean → dive over the Dardanelles → skim
 * the Marmara → low toward Constantinople, close enough to enter its city view.
 */
function droneJourney(): DronePose[] {
  const at = (lon: number, lat: number, y: number, yawDeg: number, pitchDeg: number): DronePose => {
    const g = lonLatToGround(lon, lat);
    return { x: g.x, y, z: g.z, yaw: yawDeg * DEG, pitch: pitchDeg * DEG };
  };
  return [
    at(24.6, 35.6, 26, 32, -30),
    at(25.6, 38.9, 9, 42, -16),
    at(26.4, 40.15, 3.4, 52, -8),
    at(27.8, 40.66, 2.3, 60, -5),
    at(27.95, 40.7, 1.9, 62, -10),
    at(28.34, 40.73, 1.3, 66, -25),
  ];
}

export function createWorldView(
  canvas: HTMLElement,
  assets: WorldAssets,
  options: {
    renderer: WebGLRenderer;
    shadowMapSize?: number;
    onViewChange?: () => void;
    /** Chronicle: the camera wants to enter or leave the city view; the host veils the switch and calls setMode. */
    onModeRequest?: (mode: ViewMode) => void;
  },
): WorldView {
  const { heightField } = assets;
  const scene = new Scene();

  // Constantinople has a city view of its own.
  const cityPlan = cityPlans.get('constantinople') ?? null;
  const cityAt = (() => {
    const c = cities.find((x) => x.id === 'constantinople');
    return c ? lonLatToGround(c.lonlat[0], c.lonlat[1]) : lonLatToGround(...CITY_LONLAT);
  })();

  /** Terrain surface Y — mesh, markers and rig all agree. */
  const coast = decodeCoastField(assets.worldMask);
  const surfaceY = (meters: number, lon: number, lat: number) => reliefY(meters, coast ? coast(lon, lat) : undefined);
  const yAtLonLat = (lon: number, lat: number) => surfaceY(heightField.heightAt(lon, lat), lon, lat);

  const sky = createSky();
  scene.add(sky.mesh);
  const terrain = buildChronicleTerrain(
    heightField,
    { albedo: assets.albedo, worldMask: assets.worldMask, granulation: assets.granulation },
    surfaceY,
  );
  scene.add(terrain.mesh);
  const skirt = buildSkirt(heightField, surfaceY, 0xb9a57e);
  scene.add(skirt.mesh);
  const water = createWater({
    waterNormal: assets.waterNormal,
    heightY: heightFieldToDataTexture(heightField),
    worldMask: assets.worldMask,
  });
  scene.add(water.mesh);
  const apron = createOceanApron({ waterNormal: assets.waterNormal });
  scene.add(apron.mesh);
  const lighting = createLighting(options.shadowMapSize ?? 2048);
  scene.add(lighting.group);
  const atmosphere = createAtmosphere(scene);

  const env = createDaylightEnvironment(options.renderer);
  scene.environment = env.texture;
  let viewDirty = true;
  let cityView: CityView | null = null;
  if (cityPlan) {
    cityView = createCityView(canvas, cityPlan, {
      environment: env.texture,
      shadowMapSize: options.shadowMapSize ?? 2048,
      onViewChange: () => {
        viewDirty = true;
        options.onViewChange?.();
      },
    });
  }
  let mode: ViewMode = 'world';
  // On the map the city view is not drawn: its year and mood wait here and
  // are handed over on entering (behind the veil), since rebuilding the city
  // page costs tens to hundreds of ms and the timeline plays up to ~13 years a second.
  let cityYear: number | null = null;
  let cityMood: Mood | null = null;
  const syncCity = () => {
    if (!cityView) return;
    if (cityMood) cityView.setMood(cityMood);
    if (cityYear !== null) cityView.setYear(cityYear);
    cityMood = null;
    cityYear = null;
  };
  let sinceSwitch = SWITCH_COOLDOWN;
  let switchAsked = false;
  /** The city page, folding up as the city view is entered. */
  const riser = cityView?.page ?? null;
  let riseClock: { from: number; to: number; t: number; seconds: number } | null = null;
  const startRise = (delay = 0) => {
    if (!riser) return;
    riseClock = { from: riser.rise, to: 1, t: -delay, seconds: CITY_RISE_SECONDS };
  };

  const territoryCtl = createTerritoryController(terrain.uniforms, heightField);
  territoryCtl.prewarm();
  let snapYear: number | null = null;

  const groundY = (x: number, z: number) => {
    const { lon, lat } = groundToLonLat(x, z);
    return Math.max(0, yAtLonLat(lon, lat));
  };
  const onRigChange = () => {
    viewDirty = true;
    options.onViewChange?.();
  };
  // Aerial tour state: `tourWanted` follows playback; `tour` is what the camera does now.
  const empireTour = createEmpireTour();
  const follower = createPoseFollower();
  let tourWanted = false;
  let tour: 'off' | 'flying' | 'coasting' = 'off';
  let tourClock = 0;
  let tourYear: number = YEAR_MIN;
  const startTour = () => {
    tour = 'flying';
    tourClock = 0;
    follower.reset(drone.drone);
  };

  const drone = createDroneRig(canvas, onRigChange, {
    groundY,
    // The user takes the camera: the tour yields until playback is restarted.
    onUserInput: () => {
      tour = 'off';
    },
  });
  const activeRig = (): DroneRig => (mode === 'city' && cityView ? cityView.rig : drone);
  // Open on the whole Empire, where the tour begins.
  drone.setDrone(empireTour.poseAt(YEAR_MIN));

  function updateTour(deltaSeconds: number): void {
    if (tour === 'off') return;
    // A guided flight (the journey, north-up) has taken the camera.
    if (drone.flying) {
      tour = 'off';
      return;
    }
    if (tour === 'flying') {
      tourClock += deltaSeconds;
      const k = Math.min(1, tourClock / TOUR_PICKUP_SECONDS);
      const omega = TOUR_OMEGA_START + (TOUR_OMEGA - TOUR_OMEGA_START) * k * k * (3 - 2 * k);
      drone.setDrone(follower.step(empireTour.poseAt(tourYear), deltaSeconds, omega));
    } else {
      if (!follower.coast(deltaSeconds)) tour = 'off';
      drone.setDrone(follower.pose);
    }
  }

  const probe = new Vector3();
  const viewSpace = new Vector3();

  function refreshView(): void {
    const pose = drone.pose;
    // Shadows/fog are fitted around what the camera looks at.
    const look = drone.camera.getWorldDirection(new Vector3());
    const reach = Math.min(drone.distance, drone.altitude * 6 + 4);
    const tx = pose.x + look.x * reach;
    const tz = pose.z + look.z * reach;
    const target = { x: tx, y: groundY(tx, tz), z: tz };
    lighting.updateShadowFrustum(
      drone.camera,
      target,
      {
        cx: curvatureUniforms.uCurveCenter.value.x,
        cz: curvatureUniforms.uCurveCenter.value.y,
        radius: curvatureUniforms.uCurveRadius.value,
      },
      drone.distance,
    );
    // Haze scales with altitude for the free-look camera.
    atmosphere.update(Math.max(6, drone.altitude * 3.2 + 4), Math.max(0.15, pose.pitch), curvatureUniforms.uCurveRadius.value);
  }

  /** Ask to enter the city when flying low toward it, or to leave when climbing out. */
  function checkSwitch(deltaSeconds: number): void {
    sinceSwitch += deltaSeconds;
    if (!cityView || switchAsked || sinceSwitch < SWITCH_COOLDOWN) return;
    if (mode === 'world') {
      if (drone.flying || drone.altitude > CITY_ENTER_ALTITUDE) return;
      const d = drone.drone;
      const [lx, , lz] = lookVector(d.yaw, d.pitch);
      const reach = Math.min(drone.distance, drone.altitude * 8 + 2);
      const lookAt = Math.hypot(d.x + lx * reach - cityAt.x, d.z + lz * reach - cityAt.z);
      const above = Math.hypot(d.x - cityAt.x, d.z - cityAt.z);
      if (lookAt > CITY_ENTER_REACH && above > CITY_ENTER_REACH * 0.6) return;
    } else if (cityView.rig.flying || cityView.altitude < CITY_EXIT_ALTITUDE) {
      return;
    }
    switchAsked = true;
    options.onModeRequest?.(mode === 'world' ? 'city' : 'world');
  }

  const view: WorldView = {
    get scene() {
      return mode === 'city' && cityView ? cityView.scene : scene;
    },
    get rig() {
      return activeRig();
    },
    get mode() {
      return mode;
    },
    setMode(next) {
      switchAsked = false;
      if (next === mode || !cityView) return;
      sinceSwitch = 0;
      if (next === 'city') {
        // Continue the dive: look at the same place, from the city's height.
        const d = drone.drone;
        const [lx, , lz] = lookVector(d.yaw, d.pitch);
        const reach = Math.min(drone.distance, drone.altitude * 8 + 2);
        const tx = d.x + lx * reach;
        const tz = d.z + lz * reach;
        // Looking elsewhere (entered by clicking the marker): arrive over the city's heart.
        const near = Math.hypot(tx - cityAt.x, tz - cityAt.z) < 1.2;
        syncCity();
        cityView.arrive(near ? groundToLonLat(tx, tz) : null, d.yaw, d.pitch);
        drone.enabled = false;
        cityView.rig.enabled = true;
        mode = 'city';
        tour = 'off';
        // The city unfolds like a pop-up page as you arrive.
        cityView.page.setRise(0);
        startRise(0.15);
      } else {
        // Climb back out over the city on the map, keeping the heading.
        const dep = cityView.departure();
        const t = lonLatToGround(dep.lon, dep.lat);
        const down = Math.min(1.2, Math.max(0.35, -dep.pitch));
        const back = MAP_RETURN_ALTITUDE / Math.tan(down);
        drone.setDrone({
          x: t.x - Math.sin(dep.yaw) * back,
          y: MAP_RETURN_ALTITUDE,
          z: t.z + Math.cos(dep.yaw) * back,
          yaw: dep.yaw,
          pitch: -down,
        });
        cityView.rig.enabled = false;
        drone.enabled = true;
        mode = 'world';
        if (tourWanted) startTour();
      }
      viewDirty = true;
      options.onViewChange?.();
    },
    resize(width, height) {
      drone.resize(width, height);
      cityView?.rig.resize(width, height);
    },
    setMood(mood) {
      sky.setMood(mood);
      lighting.setMood(mood);
      atmosphere.setMood(mood);
      water.setMood(mood);
      apron.setMood(mood);
      if (mode === 'city') cityView?.setMood(mood);
      else cityMood = mood;
      terrain.uniforms.uNight.value = mood.night;
    },
    setYear(year) {
      tourYear = year;
      if (mode === 'city') cityView?.setYear(year);
      else cityYear = year;
      const next = snapshotForYear(snapshots, year).year;
      if (next === snapYear) return;
      const animate = snapYear !== null;
      snapYear = next;
      territoryCtl.setSnapshot(next, animate);
    },
    update(deltaSeconds, timeSeconds) {
      if (riser && riseClock) {
        riseClock.t += deltaSeconds;
        const k = Math.min(1, Math.max(0, riseClock.t / riseClock.seconds));
        riser.setRise(riseClock.from + (riseClock.to - riseClock.from) * k);
        if (k >= 1) riseClock = null;
      }
      checkSwitch(deltaSeconds);
      if (mode === 'city' && cityView) {
        cityView.update(deltaSeconds, timeSeconds);
        if (viewDirty) {
          viewDirty = false;
          cityView.refreshView();
        }
        return;
      }
      drone.update(deltaSeconds);
      updateTour(deltaSeconds);
      terrain.uniforms.uTime.value = timeSeconds;
      water.setTime(timeSeconds);
      apron.setTime(timeSeconds);
      territoryCtl.update(deltaSeconds);
      sky.update(drone.camera.position, drone.camera.far, timeSeconds);
      if (viewDirty) {
        viewDirty = false;
        refreshView();
      }
    },
    refreshView() {
      if (mode === 'city' && cityView) cityView.refreshView();
      else refreshView();
    },
    setShadowMapSize(size) {
      lighting.setShadowMapSize(size);
      cityView?.setShadowMapSize(size);
    },
    project(lon, lat, width, height) {
      if (mode === 'city' && cityView) return cityView.project(lon, lat, width, height);
      const g = lonLatToGround(lon, lat);
      const y = bendY(g.x, yAtLonLat(lon, lat), g.z);
      const cam = drone.camera;
      viewSpace.set(g.x, y, g.z).applyMatrix4(cam.matrixWorldInverse);
      if (viewSpace.z > -cam.near) return { x: 0, y: 0, visible: false };
      const c = curvatureUniforms.uCurveCenter.value;
      if (occludedByHorizon(cam.position, { x: g.x, y, z: g.z }, c.x, c.y, curvatureUniforms.uCurveRadius.value)) {
        return { x: 0, y: 0, visible: false };
      }
      probe.set(g.x, y, g.z).project(cam);
      return {
        x: ((probe.x + 1) / 2) * width,
        y: ((1 - probe.y) / 2) * height,
        visible: Math.abs(probe.x) <= 1.05 && Math.abs(probe.y) <= 1.05,
      };
    },
    setTour(on) {
      tourWanted = on;
      if (on) {
        if (mode === 'world' && tour !== 'flying') startTour();
      } else if (tour === 'flying') {
        tour = 'coasting';
      }
    },
    playJourney() {
      // From wherever the camera is, join the flight over the Aegean; it ends
      // low over the Marmara, close enough to enter the city.
      view.setMode('world');
      tour = 'off';
      return drone.playDronePath([drone.drone, ...droneJourney()], FLIGHT_SECONDS);
    },
    journeyAt(u) {
      view.setMode('world');
      drone.setDrone(dronePathPose(droneJourney(), Math.min(1, Math.max(0, u))));
    },
    setCityRise(t) {
      riseClock = null;
      riser?.setRise(t);
    },
    setView(p) {
      activeRig().setDrone(p as Partial<DronePose>);
    },
    setCityView(name) {
      if (!cityView) return false;
      view.setMode('city');
      riseClock = null;
      cityView.page.setRise(1);
      return cityView.setView(name);
    },
    dispose() {
      drone.dispose();
      territoryCtl.dispose();
      terrain.dispose();
      skirt.dispose();
      water.dispose();
      apron.dispose();
      lighting.dispose();
      sky.dispose();
      cityView?.dispose();
      env.dispose();
    },
  };
  return view;
}
