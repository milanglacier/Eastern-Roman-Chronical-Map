/**
 * The world view: the whole Roman East as one model with its own camera.
 * Two themes share it (theme.ts):
 *
 *  - chronicle (default): the living chronicle map — parchment, ink and
 *    watercolour over sculpted relief on a convex curved earth, flown with
 *    the free-look drone camera. Flying down close to Constantinople enters
 *    its city view (chronicle/city/cityView.ts), a scene of its own;
 *    climbing high above it returns to the map. `scene` and `rig` always
 *    name the view on screen.
 *  - clockwork: the Game-of-Thrones-titles mechanical model in a dark hall
 *    — carved stone, lacquered sea, an astrolabe sun, the world bent into a
 *    bowl, a clockwork Constantinople; orbit camera.
 *
 * The host (MapCanvas) owns the renderer, the post pipeline and the loop,
 * and pushes era moods / years in.
 */
import { Scene, Texture, Vector3, WebGLRenderer } from 'three';
import { cities, cityPlans, snapshots } from '../../data';
import { snapshotForYear } from '../../lib/timeline';
import type { Mood } from '../../lib/mood';
import { CHRONICLE_RELIEF, clockworkY, sculptedY } from '../../lib/clockworkRelief';
import type { HeightField } from './heightField';
import { heightFieldToDataTexture } from './heightField';
import { createTerritoryController } from './territory';
import { buildSkirt, type Terrain } from './terrain';
import { createOceanApron, createWater } from './water';
import { createLighting } from './lights';
import { createAtmosphere } from './atmosphere';
import { createSky } from './sky';
import { createCameraRig, pathPose, type CameraPose, type CameraRig } from './cameraRig';
import { groundToLonLat, lonLatToGround } from './geo';
import { bendY, curvatureUniforms, occludedByHorizon, setCurveMode } from './curvature';
import type { Theme } from './theme';
import { buildClockworkTerrain } from './clockwork/terrain';
import { decodeCoastField } from './clockwork/coastField';
import { createClockworkMaterials } from './clockwork/materials';
import { createAstrolabe, createHallEnvironment } from './clockwork/hall';
import { buildConstantinople, type ClockworkCity } from './clockwork/constantinople';
import { buildChronicleTerrain } from './chronicle/terrain';
import { CITY_EXIT_ALTITUDE, createCityView, type CityView } from './chronicle/city/cityView';
import { activeMosaic } from './chronicle/city/mosaic';
import { createDroneRig, dronePathPose, lookVector, type DronePose, type DroneRig } from './droneRig';

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

/** What the host needs from either camera (orbit rig or free-look drone). */
export type ViewRig = Pick<CameraRig, 'camera' | 'distance' | 'enabled' | 'update' | 'resize' | 'dispose'> & {
  readonly pose: { x: number; z: number; distance: number; heading: number; pitch: number };
  flyTo(pose: { heading?: number }, seconds?: number): Promise<boolean>;
};

export type ViewMode = 'world' | 'city';

export interface WorldView {
  /** The scene and camera on screen (the map, or the city view). */
  readonly scene: Scene;
  readonly rig: ViewRig;
  readonly mode: ViewMode;
  /** Swap between the map and the city view, placing the camera to continue the flight. */
  setMode(mode: ViewMode): void;
  resize(width: number, height: number): void;
  theme: Theme;
  setMood(mood: Mood): void;
  setYear(year: number): void;
  /** Per frame: animations + flights. */
  update(deltaSeconds: number, timeSeconds: number): void;
  /** After the camera moved: shadows, fog. */
  refreshView(): void;
  setShadowMapSize(size: number): void;
  /** Lon/lat → CSS px in a viewport of the given size (bent + horizon-occluded). */
  project(lon: number, lat: number, width: number, height: number): ScreenPoint;
  /** Clockwork only: the opening flight to Constantinople as it rises. */
  playJourney(): Promise<boolean>;
  /** Screenshot/debug: pin the journey camera at progress u (0..1). */
  journeyAt(u: number): void;
  /** Screenshot/debug: set the city rise directly (0..1). */
  setCityRise(t: number): void;
  /** Screenshot/debug: place the camera (orbit pose or drone pose, per theme). */
  setView(pose: Record<string, number>): void;
  /** Screenshot/debug: enter the city view at a named view (cityView.ts CITY_VIEWS). */
  setCityView(name: string): boolean;
  dispose(): void;
}

const DEG = Math.PI / 180;
/** Constantinople model: centre (peninsula), world scale, rise duration. */
const CITY_LONLAT: [number, number] = [28.955, 41.018];
const CITY_SCALE = 2.5;
const CITY_RISE_SECONDS = 7.5;
/**
 * Chronicle: enter the city view below this altitude when looking at the
 * city (world units), and arrive back on the map a little above it, so the
 * switch cannot flip back and forth.
 */
export const CITY_ENTER_ALTITUDE = 1.5;
const CITY_ENTER_REACH = 0.8;
export const MAP_RETURN_ALTITUDE = 2.4;
/** Seconds after a switch before the next one may be asked for. */
const SWITCH_COOLDOWN = 1.5;
/** Length of the opening flight to Constantinople. */
const FLIGHT_SECONDS = 19;

/**
 * Chronicle opening: high over the Aegean → dive over the Dardanelles → skim
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

/** The opening flight: Aegean → low over the Dardanelles → Marmara → orbit the city. */
function journeyPoses(): CameraPose[] {
  const g = (lon: number, lat: number) => lonLatToGround(lon, lat);
  const aegean = g(25.3, 37.2);
  const dard = g(26.4, 40.05);
  const marmara = g(27.9, 40.72);
  const city = g(...CITY_LONLAT);
  return [
    { x: aegean.x, z: aegean.z, distance: 62, heading: 25 * DEG, pitch: 40 * DEG },
    { x: dard.x, z: dard.z, distance: 16, heading: 50 * DEG, pitch: 17 * DEG },
    { x: marmara.x, z: marmara.z, distance: 12, heading: 68 * DEG, pitch: 15 * DEG },
    { x: city.x - 1.5, z: city.z + 0.8, distance: 11, heading: 85 * DEG, pitch: 19 * DEG },
    { x: city.x, z: city.z, distance: 10.5, heading: 140 * DEG, pitch: 24 * DEG },
    { x: city.x, z: city.z, distance: 12, heading: 205 * DEG, pitch: 28 * DEG },
  ];
}

export function createWorldView(
  canvas: HTMLElement,
  assets: WorldAssets,
  options: {
    theme: Theme;
    renderer: WebGLRenderer;
    shadowMapSize?: number;
    onViewChange?: () => void;
    /** Chronicle: the camera wants to enter or leave the city view; the host veils the switch and calls setMode. */
    onModeRequest?: (mode: ViewMode) => void;
  },
): WorldView {
  const { heightField } = assets;
  const { theme } = options;
  const clockwork = theme === 'clockwork';
  const chronicle = !clockwork;
  setCurveMode(clockwork ? 'concave' : 'convex');
  const scene = new Scene();

  // Chronicle: Constantinople has a city view of its own.
  const cityPlan = chronicle ? cityPlans.get('constantinople') ?? null : null;
  const cityAt = (() => {
    const c = cities.find((x) => x.id === 'constantinople');
    return c ? lonLatToGround(c.lonlat[0], c.lonlat[1]) : lonLatToGround(...CITY_LONLAT);
  })();

  /** Terrain surface Y, per theme — mesh, markers, rig and models all agree. */
  const coast = decodeCoastField(assets.worldMask);
  const surfaceY = (meters: number, lon: number, lat: number) => {
    const coastPx = coast ? coast(lon, lat) : undefined;
    return clockwork ? clockworkY(meters, coastPx) : sculptedY(meters, coastPx, CHRONICLE_RELIEF);
  };
  const yAtLonLat = (lon: number, lat: number) => surfaceY(heightField.heightAt(lon, lat), lon, lat);

  const style = clockwork ? 'clockwork' : 'chronicle';
  const sky = createSky(style);
  scene.add(sky.mesh);
  const terrain: Terrain = clockwork
    ? buildClockworkTerrain(heightField, { albedo: assets.albedo, worldMask: assets.worldMask }, surfaceY)
    : buildChronicleTerrain(
        heightField,
        { albedo: assets.albedo, worldMask: assets.worldMask, granulation: assets.granulation },
        surfaceY,
      );
  scene.add(terrain.mesh);
  const skirt = buildSkirt(heightField, surfaceY, clockwork ? 0x3a2c1c : 0xb9a57e);
  scene.add(skirt.mesh);
  const water = createWater(
    { waterNormal: assets.waterNormal, heightY: heightFieldToDataTexture(heightField), worldMask: assets.worldMask },
    style,
  );
  scene.add(water.mesh);
  const apron = createOceanApron({ waterNormal: assets.waterNormal }, style);
  scene.add(apron.mesh);
  const lighting = createLighting(options.shadowMapSize ?? 2048, clockwork ? 'hall' : 'paper');
  scene.add(lighting.group);
  const atmosphere = createAtmosphere(scene, style);

  // ---- clockwork hall + cities ----
  const env = createHallEnvironment(options.renderer, clockwork ? 'hall' : 'daylight');
  scene.environment = env.texture;
  const astrolabe = clockwork ? createAstrolabe(new Vector3(144, 58, 64), 6) : null;
  if (astrolabe) scene.add(astrolabe.group);
  const cwMats = clockwork ? createClockworkMaterials() : null;
  let city: ClockworkCity | null = null;
  if (cwMats) {
    city = buildConstantinople(cwMats);
    const c = lonLatToGround(...CITY_LONLAT);
    // Seat the plate on the ground around the peninsula itself (upper
    // quartile of the inner footprint) — the highest ground under the whole
    // gear ring would include Mount Olympus of Bithynia and turn the
    // pedestal into a tower.
    const hs: number[] = [];
    const r = 0.6 * CITY_SCALE;
    for (let dz = -r; dz <= r; dz += r / 8) {
      for (let dx = -r; dx <= r; dx += r / 8) {
        if (dx * dx + dz * dz > r * r) continue;
        const { lon, lat } = groundToLonLat(c.x + dx, c.z + dz);
        hs.push(yAtLonLat(lon, lat));
      }
    }
    hs.sort((a, b) => a - b);
    const seat = Math.max(0.12, hs[Math.floor(hs.length * 0.75)]);
    city.group.position.set(c.x, seat + 0.04, c.z);
    city.group.scale.setScalar(CITY_SCALE);
    city.group.updateMatrixWorld(true);
    scene.add(city.group);
  }
  let viewDirty = true;
  let cityView: CityView | null = null;
  if (cityPlan) {
    cityView = createCityView(canvas, cityPlan, {
      setting: activeMosaic(),
      environment: env.texture,
      shadowMapSize: options.shadowMapSize ?? 2048,
      onViewChange: () => {
        viewDirty = true;
        options.onViewChange?.();
      },
    });
  }
  let mode: ViewMode = 'world';
  let sinceSwitch = SWITCH_COOLDOWN;
  let switchAsked = false;
  /** Rising landmark of whichever theme is active. */
  const riser: { rise: number; setRise(t: number): void } | null = city ?? cityView?.page ?? null;
  let riseClock: { from: number; to: number; t: number; seconds: number } | null = null;
  const startRise = (delay = 0) => {
    if (!riser) return;
    riseClock = { from: riser.rise, to: 1, t: -delay, seconds: chronicle ? 2.6 : CITY_RISE_SECONDS };
  };

  const territoryCtl = createTerritoryController(terrain.uniforms, heightField);
  let snapYear: number | null = null;

  const groundY = (x: number, z: number) => {
    const { lon, lat } = groundToLonLat(x, z);
    return Math.max(0, yAtLonLat(lon, lat));
  };
  const onRigChange = () => {
    viewDirty = true;
    options.onViewChange?.();
  };
  const orbit: CameraRig | null = chronicle ? null : createCameraRig(canvas, onRigChange, { groundY });
  const drone: DroneRig | null = chronicle ? createDroneRig(canvas, onRigChange, { groundY }) : null;
  const mapRig: ViewRig = (drone ?? orbit)!;
  const activeRig = (): ViewRig => (mode === 'city' && cityView ? cityView.rig : mapRig);
  const rig = mapRig;
  if (drone) drone.setDrone(droneJourney()[0]);
  else orbit!.setPose(journeyPoses()[0]);

  const probe = new Vector3();
  const viewSpace = new Vector3();
  const keyDir = new Vector3();

  function refreshView(): void {
    const pose = rig.pose;
    // Shadows/fog are fitted around what the camera looks at.
    const look = rig.camera.getWorldDirection(new Vector3());
    const reach = drone ? Math.min(rig.distance, drone.altitude * 6 + 4) : 0;
    const tx = pose.x + look.x * reach;
    const tz = pose.z + look.z * reach;
    const target = { x: tx, y: groundY(tx, tz), z: tz };
    if (astrolabe) {
      // The hall is lit by the astrolabe: light comes from it toward the view.
      keyDir.set(astrolabe.center.x - target.x, astrolabe.center.y - target.y, astrolabe.center.z - target.z).normalize();
      lighting.setDirectionOverride(keyDir);
      sky.setKeyDir(keyDir);
      if (lastMood) applySeaMood(lastMood);
    }
    lighting.updateShadowFrustum(
      rig.camera,
      target,
      {
        cx: curvatureUniforms.uCurveCenter.value.x,
        cz: curvatureUniforms.uCurveCenter.value.y,
        radius: curvatureUniforms.uCurveRadius.value,
      },
      rig.distance,
    );
    if (drone) {
      // Haze scales with altitude for the free-look camera.
      atmosphere.update(Math.max(6, drone.altitude * 3.2 + 4), Math.max(0.15, pose.pitch), curvatureUniforms.uCurveRadius.value);
    } else {
      atmosphere.update(rig.distance, pose.pitch, curvatureUniforms.uCurveRadius.value);
    }
  }

  let lastMood: Mood | null = null;
  /** The clockwork sea glints toward the astrolabe, not the era sun. */
  function applySeaMood(mood: Mood): void {
    const m = clockwork ? { ...mood, keyDir: [keyDir.x, keyDir.y, keyDir.z] as [number, number, number] } : mood;
    water.setMood(m);
    apron.setMood(m);
  }

  /** Chronicle: ask to enter the city when flying low toward it, or to leave when climbing out. */
  function checkSwitch(deltaSeconds: number): void {
    sinceSwitch += deltaSeconds;
    if (!cityView || !drone || switchAsked || sinceSwitch < SWITCH_COOLDOWN) return;
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
    theme,
    setMode(next) {
      switchAsked = false;
      if (next === mode || !cityView || !drone) return;
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
        cityView.arrive(near ? groundToLonLat(tx, tz) : null, d.yaw, d.pitch);
        drone.enabled = false;
        cityView.rig.enabled = true;
        mode = 'city';
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
      }
      viewDirty = true;
      options.onViewChange?.();
    },
    resize(width, height) {
      mapRig.resize(width, height);
      cityView?.rig.resize(width, height);
    },
    setMood(mood) {
      lastMood = mood;
      sky.setMood(mood);
      lighting.setMood(mood);
      atmosphere.setMood(mood);
      applySeaMood(mood);
      astrolabe?.setNight(mood.night);
      cityView?.setMood(mood);
      terrain.uniforms.uNight.value = mood.night;
    },
    setYear(year) {
      cityView?.setYear(year);
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
      rig.update(deltaSeconds);
      terrain.uniforms.uTime.value = timeSeconds;
      water.setTime(timeSeconds);
      apron.setTime(timeSeconds);
      territoryCtl.update(deltaSeconds);
      sky.update(rig.camera.position, rig.camera.far, timeSeconds);
      astrolabe?.update(timeSeconds);
      city?.update(timeSeconds);
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
      const cam = rig.camera;
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
    playJourney() {
      if (drone) {
        // The flight ends low over the Marmara, close enough to enter the city.
        view.setMode('world');
        return drone.playDronePath(droneJourney(), FLIGHT_SECONDS);
      }
      if (!orbit) return Promise.resolve(false);
      city?.setRise(0);
      startRise(9);
      return orbit.playPath(journeyPoses(), FLIGHT_SECONDS);
    },
    journeyAt(u) {
      const k = Math.min(1, Math.max(0, u));
      if (drone) {
        view.setMode('world');
        drone.setDrone(dronePathPose(droneJourney(), k));
      } else orbit?.setPose(pathPose(journeyPoses(), k));
    },
    setCityRise(t) {
      riseClock = null;
      riser?.setRise(t);
    },
    setView(p) {
      const r = activeRig();
      if (r === drone || (cityView && r === cityView.rig)) (r as DroneRig).setDrone(p as Partial<DronePose>);
      else orbit?.setPose(p as Partial<CameraPose>);
    },
    setCityView(name) {
      if (!cityView) return false;
      view.setMode('city');
      riseClock = null;
      cityView.page.setRise(1);
      return cityView.setView(name);
    },
    dispose() {
      rig.dispose();
      territoryCtl.dispose();
      terrain.dispose();
      skirt.dispose();
      water.dispose();
      apron.dispose();
      lighting.dispose();
      sky.dispose();
      city?.dispose();
      cityView?.dispose();
      cwMats?.dispose();
      astrolabe?.dispose();
      env.dispose();
    },
  };
  return view;
}
