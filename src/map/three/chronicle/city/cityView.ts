/**
 * The city view: a scene of its own for one city (Constantinople), entered
 * by flying down close to the city on the continental map and left by
 * climbing high above it (worldScene.ts decides when; MapCanvas veils the
 * switch). The city model (cityPage.ts) fills the ground out to a hazy
 * horizon under the era's own sky and light, so the continental map is
 * never seen from here and no edge of the model shows.
 *
 * Units are the city model's: world units at the city's magnification,
 * ground at y = 0, the plan's centre at the origin.
 */
import { Scene, Vector3, type Texture } from 'three';
import type { CityPlan } from '../../../../data/schema';
import type { Mood } from '../../../../lib/mood';
import { createAtmosphere } from '../../atmosphere';
import { bendY, curvatureUniforms, occludedByHorizon } from '../../curvature';
import { createDroneRig, lookVector, type DronePose, type DroneRig } from '../../droneRig';
import { createLighting } from '../../lights';
import { createSky } from '../../sky';
import { createCityPage, type CityPage } from './cityPage';
import type { MosaicSetting } from './mosaic';

/** Leave the city when the camera climbs above this; arrive at this height. */
export const CITY_EXIT_ALTITUDE = 2.1;
export const CITY_ARRIVAL_ALTITUDE = 1.2;
const CITY_MAX_Y = 2.4;

/** Named views for screenshots and debugging (city units, around the plan's centre). */
export const CITY_VIEWS: Record<string, DronePose> = {
  'marmara-north': { x: -0.3, y: 1.05, z: 2.26, yaw: 0, pitch: -0.55 },
  'city-centre': { x: 0.55, y: 0.36, z: 0.91, yaw: -0.75, pitch: -0.42 },
  'land-walls': { x: -2.35, y: 0.24, z: 0.41, yaw: 0.75, pitch: -0.3 },
  'asia-skyline': { x: 1.7, y: 0.3, z: 0.06, yaw: -1.62, pitch: -0.2 },
  'golden-horn': { x: 0.3, y: 0.32, z: -0.9, yaw: -2.48, pitch: -0.3 },
  'hagia-sophia': { x: 0.44, y: 0.16, z: 0.56, yaw: -0.82, pitch: -0.26 },
};

export interface CityView {
  scene: Scene;
  rig: DroneRig;
  page: CityPage;
  readonly altitude: number;
  setMood(mood: Mood): void;
  setYear(year: number): void;
  update(deltaSeconds: number, timeSeconds: number): void;
  /** After the camera moved: shadows, haze. */
  refreshView(): void;
  setShadowMapSize(size: number): void;
  /** Lon/lat → CSS px; only points on the city's plan are visible. */
  project(lon: number, lat: number, width: number, height: number): { x: number; y: number; visible: boolean };
  /** Place the camera arriving from the map: looking at `target` with this heading and pitch. */
  arrive(target: { lon: number; lat: number } | null, yaw: number, pitch: number): void;
  /** Where the camera looks (lon/lat) and how, to leave toward the map. */
  departure(): { lon: number; lat: number; yaw: number; pitch: number };
  setView(name: string): boolean;
  dispose(): void;
}

export function createCityView(
  canvas: HTMLElement,
  plan: CityPlan,
  options: { setting: MosaicSetting; environment: Texture | null; shadowMapSize: number; onViewChange: () => void },
): CityView {
  const scene = new Scene();
  scene.environment = options.environment;
  const sky = createSky('chronicle');
  scene.add(sky.mesh);
  const lighting = createLighting(options.shadowMapSize, 'paper');
  scene.add(lighting.group);
  const atmosphere = createAtmosphere(scene, 'chronicle');
  const page = createCityPage(plan, { setting: options.setting, baseUrl: `city/${plan.id}` });
  scene.add(page.group);

  const margin = 0.3;
  const rig = createDroneRig(canvas, options.onViewChange, {
    groundY: () => 0,
    bounds: { minX: -page.halfWidth - margin, maxX: page.halfWidth + margin, minZ: -page.halfDepth - margin, maxZ: page.halfDepth + margin },
    maxY: CITY_MAX_Y,
    minClear: 0.05,
    speedFloor: 0.15,
  });
  rig.enabled = false;
  rig.setDrone(CITY_VIEWS['marmara-north']);

  const probe = new Vector3();
  const viewSpace = new Vector3();

  /** Where the centre of the view meets the ground (city units). */
  const lookTarget = () => {
    const d = rig.drone;
    const [lx, , lz] = lookVector(d.yaw, d.pitch);
    const reach = Math.min(rig.distance, rig.altitude * 8 + 2);
    return { x: d.x + lx * reach, z: d.z + lz * reach };
  };

  const clampToPlan = (x: number, z: number) => ({
    x: Math.min(page.halfWidth - margin, Math.max(-page.halfWidth + margin, x)),
    z: Math.min(page.halfDepth - margin, Math.max(-page.halfDepth + margin, z)),
  });

  const view: CityView = {
    scene,
    rig,
    page,
    get altitude() {
      return rig.altitude;
    },
    setMood(mood) {
      sky.setMood(mood);
      lighting.setMood(mood);
      atmosphere.setMood(mood);
      page.setNight(mood.night);
    },
    setYear(year) {
      page.setYear(year);
    },
    update(dt, t) {
      rig.update(dt);
      sky.update(rig.camera.position, rig.camera.far, t);
      page.update(rig.camera);
    },
    refreshView() {
      const target = lookTarget();
      lighting.updateShadowFrustum(
        rig.camera,
        { x: target.x, y: 0, z: target.z },
        { cx: curvatureUniforms.uCurveCenter.value.x, cz: curvatureUniforms.uCurveCenter.value.y, radius: curvatureUniforms.uCurveRadius.value },
        Math.max(1, rig.distance),
      );
      // Close haze: the ground runs on, but the horizon dissolves into the sky.
      atmosphere.update(1.1 + rig.altitude * 0.45, Math.max(0.15, -rig.drone.pitch), curvatureUniforms.uCurveRadius.value);
    },
    setShadowMapSize(size) {
      lighting.setShadowMapSize(size);
    },
    project(lon, lat, width, height) {
      const p = page.toPage(lon, lat);
      if (Math.abs(p.x) > page.halfWidth || Math.abs(p.z) > page.halfDepth) return { x: 0, y: 0, visible: false };
      const cam = rig.camera;
      const y = bendY(p.x, 0, p.z);
      viewSpace.set(p.x, y, p.z).applyMatrix4(cam.matrixWorldInverse);
      if (viewSpace.z > -cam.near) return { x: 0, y: 0, visible: false };
      const c = curvatureUniforms.uCurveCenter.value;
      if (occludedByHorizon(cam.position, { x: p.x, y, z: p.z }, c.x, c.y, curvatureUniforms.uCurveRadius.value)) {
        return { x: 0, y: 0, visible: false };
      }
      probe.set(p.x, y, p.z).project(cam);
      return {
        x: ((probe.x + 1) / 2) * width,
        y: ((1 - probe.y) / 2) * height,
        visible: Math.abs(probe.x) <= 1.05 && Math.abs(probe.y) <= 1.05,
      };
    },
    arrive(target, yaw, pitch) {
      const p = target ? page.toPage(target.lon, target.lat) : { x: 0.2, z: 0.2 };
      const t = clampToPlan(p.x, p.z);
      const down = Math.min(1.2, Math.max(0.35, -pitch));
      const back = CITY_ARRIVAL_ALTITUDE / Math.tan(down);
      rig.setDrone({
        x: t.x - Math.sin(yaw) * back,
        y: CITY_ARRIVAL_ALTITUDE,
        z: t.z + Math.cos(yaw) * back,
        yaw,
        pitch: -down,
      });
    },
    departure() {
      const t = lookTarget();
      const { lon, lat } = page.fromPage(t.x, t.z);
      return { lon, lat, yaw: rig.drone.yaw, pitch: rig.drone.pitch };
    },
    setView(name) {
      const v = CITY_VIEWS[name];
      if (!v) return false;
      rig.setDrone(v);
      return true;
    },
    dispose() {
      rig.dispose();
      page.dispose();
      sky.dispose();
      lighting.dispose();
    },
  };
  return view;
}
