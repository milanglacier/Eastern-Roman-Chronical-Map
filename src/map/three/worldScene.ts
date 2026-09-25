/**
 * The world view: the whole Roman East as one model with its own camera
 * rig. Two themes share it (theme.ts):
 *
 *  - clockwork (default): the Game-of-Thrones-titles mechanical model in a
 *    dark hall — carved-stone sculpted relief, lacquered engraved sea, an
 *    astrolabe sun as the key light, the world bent into a bowl, and
 *    clockwork cities (Constantinople first) rising out of it.
 *  - painted: the v2 painted diorama (gouache bake, open sky, convex earth).
 *
 * The host (MapCanvas) owns the renderer, the post pipeline and the loop,
 * and pushes era moods / years in.
 */
import { Scene, Texture, Vector3, WebGLRenderer } from 'three';
import { snapshots } from '../../data';
import { snapshotForYear } from '../../lib/timeline';
import type { Mood } from '../../lib/mood';
import { CHRONICLE_RELIEF, clockworkY, sculptedY } from '../../lib/clockworkRelief';
import type { HeightField } from './heightField';
import { heightFieldToDataTexture } from './heightField';
import { createTerritoryController } from './territory';
import { buildSkirt, buildTerrain, type Terrain } from './terrain';
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
import { buildPopupConstantinople, type PopupCity } from './chronicle/popupCity';
import { createDroneRig, dronePathPose, type DronePose, type DroneRig } from './droneRig';

export interface WorldAssets {
  heightField: HeightField;
  albedo: Texture | null;
  normal: Texture | null;
  worldMask: Texture | null;
  waterNormal: Texture | null;
  brush: Texture | null;
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

export interface WorldView {
  scene: Scene;
  rig: ViewRig;
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
  dispose(): void;
}

export const HOME_LONLAT: [number, number] = [26.5, 38.2];
export const HOME_DISTANCE = 115;
export const HOME_PITCH = (46 * Math.PI) / 180;

const DEG = Math.PI / 180;
/** Constantinople model: centre (peninsula), world scale, rise duration. */
const CITY_LONLAT: [number, number] = [28.955, 41.018];
const CITY_SCALE = 2.5;
const CITY_RISE_SECONDS = 7.5;

/** Chronicle opening: high over the Aegean → dive over the Dardanelles → skim the Marmara → the city. */
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
    at(28.15, 40.66, 1.7, 58, -6),
    at(28.22, 40.64, 1.05, 62, -2),
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
  options: { theme: Theme; renderer: WebGLRenderer; shadowMapSize?: number; onViewChange?: () => void },
): WorldView {
  const { heightField } = assets;
  const { theme } = options;
  const clockwork = theme === 'clockwork';
  const chronicle = theme === 'chronicle';
  setCurveMode(clockwork ? 'concave' : 'convex');
  const scene = new Scene();

  /** Terrain surface Y, per theme — mesh, markers, rig and models all agree. */
  const coast = clockwork || chronicle ? decodeCoastField(assets.worldMask) : null;
  const surfaceY = (meters: number, lon: number, lat: number) =>
    clockwork
      ? clockworkY(meters, coast ? coast(lon, lat) : undefined)
      : chronicle
        ? sculptedY(meters, coast ? coast(lon, lat) : undefined, CHRONICLE_RELIEF)
        : heightField.metersToY(meters);
  const yAtLonLat = (lon: number, lat: number) => surfaceY(heightField.heightAt(lon, lat), lon, lat);

  const style = clockwork ? 'clockwork' : chronicle ? 'chronicle' : 'painted';
  const sky = createSky(style);
  scene.add(sky.mesh);
  const terrain: Terrain = clockwork
    ? buildClockworkTerrain(heightField, { albedo: assets.albedo, worldMask: assets.worldMask }, surfaceY)
    : chronicle
      ? buildChronicleTerrain(heightField, { albedo: assets.albedo, worldMask: assets.worldMask, brush: assets.brush }, surfaceY)
      : buildTerrain(heightField, {
        albedo: assets.albedo,
        normal: assets.normal,
        detail: assets.waterNormal,
        brush: assets.brush,
        worldMask: assets.worldMask,
      });
  scene.add(terrain.mesh);
  const skirt = clockwork
    ? buildSkirt(heightField, surfaceY, 0x3a2c1c)
    : chronicle
      ? buildSkirt(heightField, surfaceY, 0xb9a57e)
      : buildSkirt(heightField);
  scene.add(skirt.mesh);
  const water = createWater(
    { waterNormal: assets.waterNormal, heightY: heightFieldToDataTexture(heightField), worldMask: assets.worldMask },
    style,
  );
  scene.add(water.mesh);
  const apron = createOceanApron({ waterNormal: assets.waterNormal }, style);
  scene.add(apron.mesh);
  const lighting = createLighting(options.shadowMapSize ?? 2048, clockwork ? 'hall' : chronicle ? 'paper' : 'painted');
  scene.add(lighting.group);
  const atmosphere = createAtmosphere(scene, style);

  // ---- clockwork hall + cities ----
  const env = clockwork
    ? createHallEnvironment(options.renderer)
    : chronicle
      ? createHallEnvironment(options.renderer, 'daylight')
      : null;
  if (env) scene.environment = env.texture;
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
  let popup: PopupCity | null = null;
  if (chronicle) {
    popup = buildPopupConstantinople(1);
    const c = lonLatToGround(...CITY_LONLAT);
    popup.group.position.set(c.x, Math.max(0.02, yAtLonLat(...CITY_LONLAT)), c.z);
    scene.add(popup.group);
  }
  /** Rising landmark of whichever theme is active. */
  const riser: { rise: number; setRise(t: number): void } | null = city ?? popup;
  let riseClock: { from: number; to: number; t: number; seconds: number } | null = null;
  const startRise = (delay = 0) => {
    if (!riser) return;
    riseClock = { from: riser.rise, to: 1, t: -delay, seconds: chronicle ? 5.5 : CITY_RISE_SECONDS };
  };

  const territoryCtl = createTerritoryController(terrain.uniforms, heightField);
  let snapYear: number | null = null;

  let viewDirty = true;
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
  const rig: ViewRig = (drone ?? orbit)!;
  const home = lonLatToGround(...HOME_LONLAT);
  if (drone) {
    drone.setDrone(droneJourney()[0]);
  } else if (clockwork) {
    orbit!.setPose(journeyPoses()[0]);
  } else {
    orbit!.centerOn(home.x, home.z, HOME_DISTANCE, 0, HOME_PITCH);
  }

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

  const view: WorldView = {
    scene,
    rig,
    theme,
    setMood(mood) {
      lastMood = mood;
      sky.setMood(mood);
      lighting.setMood(mood);
      atmosphere.setMood(mood);
      applySeaMood(mood);
      astrolabe?.setNight(mood.night);
      popup?.setNight(mood.night);
      terrain.uniforms.uNight.value = mood.night;
    },
    setYear(year) {
      const next = snapshotForYear(snapshots, year).year;
      if (next === snapYear) return;
      const animate = snapYear !== null;
      snapYear = next;
      territoryCtl.setSnapshot(next, animate);
    },
    update(deltaSeconds, timeSeconds) {
      rig.update(deltaSeconds);
      terrain.uniforms.uTime.value = timeSeconds;
      water.setTime(timeSeconds);
      apron.setTime(timeSeconds);
      territoryCtl.update(deltaSeconds);
      sky.update(rig.camera.position, rig.camera.far, timeSeconds);
      astrolabe?.update(timeSeconds);
      if (riser && riseClock) {
        riseClock.t += deltaSeconds;
        const k = Math.min(1, Math.max(0, riseClock.t / riseClock.seconds));
        riser.setRise(riseClock.from + (riseClock.to - riseClock.from) * k);
        if (k >= 1) riseClock = null;
      }
      city?.update(timeSeconds);
      popup?.update(rig.camera);
      if (viewDirty) {
        viewDirty = false;
        refreshView();
      }
    },
    refreshView,
    setShadowMapSize(size) {
      lighting.setShadowMapSize(size);
    },
    project(lon, lat, width, height) {
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
        popup?.setRise(0);
        startRise(15);
        return drone.playDronePath(droneJourney(), 26);
      }
      if (!clockwork || !orbit) return Promise.resolve(false);
      city?.setRise(0);
      startRise(9);
      return orbit.playPath(journeyPoses(), 24);
    },
    journeyAt(u) {
      const k = Math.min(1, Math.max(0, u));
      if (drone) drone.setDrone(dronePathPose(droneJourney(), k));
      else orbit?.setPose(pathPose(journeyPoses(), k));
    },
    setCityRise(t) {
      riseClock = null;
      riser?.setRise(t);
    },
    setView(p) {
      if (drone) drone.setDrone(p as Partial<DronePose>);
      else orbit?.setPose(p as Partial<CameraPose>);
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
      popup?.dispose();
      cwMats?.dispose();
      astrolabe?.dispose();
      env?.dispose();
    },
  };
  return view;
}
