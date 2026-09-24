/**
 * The "city lens": a self-contained scene for one city at true metre scale,
 * rendered by the same WebGLRenderer as the world map. Local terrain (baked
 * by scripts/build-city.mjs), a water sheet reusing the world's shader, its
 * own sun/shadow fit, sky, and an orbiting camera rig. Structures that
 * change with the year are added by the city model (see cityModel.ts).
 */
import {
  BufferAttribute,
  BufferGeometry,
  Mesh,
  MeshStandardMaterial,
  NoColorSpace,
  ObjectSpaceNormalMap,
  Scene,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  Vector3,
  WebGLRenderer,
} from 'three';
import { createCameraRig, type CameraRig } from '../cameraRig';
import { createLighting } from '../lights';
import { createAtmosphere } from '../atmosphere';
import { createWater } from '../water';
import { createCloudUniforms } from '../clouds';
import { heightFieldToDataTexture } from '../heightField';
import { loadCityHeightField, type CityHeightField } from './cityFrame';
import type { CityScene as CitySceneData } from '../../../data/schema';
import { createCityModel } from './cityModel';
import { createUrbanGround, URBAN_GROUND_GLSL } from './urbanGround';

/** Terrain grid resolution (~36 m quads over the ~28 km bake). */
const SEGMENTS_X = 800;
const SEGMENTS_Z = 560;

export interface CityScene {
  id: string;
  scene: Scene;
  rig: CameraRig;
  heightField: CityHeightField;
  /** Establishing view: centre of the historic city. */
  home: { x: number; z: number; distance: number; heading: number };
  /** Show the city as it stood in `year` (structures, density). */
  setYear(year: number): void;
  /** Per-frame animation (seconds, frame delta) + view-dependent refits. */
  update(timeSec: number, deltaSec: number, viewDirty: boolean, viewportW: number, viewportH: number): void;
  dispose(): void;
}

async function loadTexture(url: string, srgb: boolean): Promise<Texture | null> {
  try {
    const tex = await new TextureLoader().loadAsync(url);
    tex.flipY = false; // image row 0 = north = V 0, like the world textures
    tex.colorSpace = srgb ? SRGBColorSpace : NoColorSpace;
    return tex;
  } catch {
    console.warn(`city texture unavailable: ${url}`);
    return null;
  }
}

function buildCityTerrainGeometry(hf: CityHeightField): BufferGeometry {
  const { bounds } = hf.frame;
  const vertsX = SEGMENTS_X + 1;
  const vertsZ = SEGMENTS_Z + 1;
  const positions = new Float32Array(vertsX * vertsZ * 3);
  const uvs = new Float32Array(vertsX * vertsZ * 2);
  for (let j = 0; j < vertsZ; j++) {
    const v = j / SEGMENTS_Z;
    const z = bounds.minZ + v * (bounds.maxZ - bounds.minZ);
    for (let i = 0; i < vertsX; i++) {
      const u = i / SEGMENTS_X;
      const x = bounds.minX + u * (bounds.maxX - bounds.minX);
      const o = (j * vertsX + i) * 3;
      positions[o] = x;
      positions[o + 1] = hf.yAt(x, z);
      positions[o + 2] = z;
      uvs[(j * vertsX + i) * 2] = u;
      uvs[(j * vertsX + i) * 2 + 1] = v;
    }
  }
  const indices = new Uint32Array(SEGMENTS_X * SEGMENTS_Z * 6);
  let k = 0;
  for (let j = 0; j < SEGMENTS_Z; j++) {
    for (let i = 0; i < SEGMENTS_X; i++) {
      const a = j * vertsX + i;
      const b = a + 1;
      const c = a + vertsX;
      const d = c + 1;
      indices.set([a, c, b, b, c, d], k);
      k += 6;
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2));
  geometry.setIndex(new BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  return geometry;
}

export interface CitySceneOptions {
  id: string;
  renderer: WebGLRenderer;
  domElement: HTMLElement;
  /** Shared tileable wave normals (the world's waternormal.png). */
  waterNormal: Texture | null;
  onViewChange: () => void;
  data: CitySceneData;
}

export async function createCityScene(opts: CitySceneOptions): Promise<CityScene> {
  const base = `city/${opts.id}/`;
  const [heightField, albedo, normal, worldMask] = await Promise.all([
    loadCityHeightField(base),
    loadTexture(`${base}albedo.jpg`, true),
    loadTexture(`${base}normal.png`, false),
    loadTexture(`${base}worldmask.png`, false),
  ]);
  const { bounds, meta } = heightField.frame;
  const sizeX = bounds.maxX - bounds.minX;
  const sizeZ = bounds.maxZ - bounds.minZ;

  const scene = new Scene();
  if (albedo) albedo.anisotropy = opts.renderer.capabilities.getMaxAnisotropy();

  const material = new MeshStandardMaterial({
    map: albedo ?? undefined,
    color: albedo ? 0xffffff : 0x9a9070,
    roughness: 1,
    metalness: 0,
  });
  if (normal) {
    material.normalMap = normal;
    material.normalMapType = ObjectSpaceNormalMap;
  }
  const coreLonLat =
    opts.data.structures.find((s) => s.id === 'column-of-constantine')?.position ?? opts.data.home.lonlat;
  const urban = createUrbanGround(opts.data, heightField.frame, heightField.frame.lonLatToLocal(...coreLonLat));
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, urban.uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform sampler2D uUrbanMask;\nuniform float uUrbanStrength;\nuniform vec3 uUrbanSoil;',
      )
      .replace('#include <map_fragment>', `#include <map_fragment>\n${URBAN_GROUND_GLSL}`);
  };
  material.customProgramCacheKey = () => 'city-terrain';
  const geometry = buildCityTerrainGeometry(heightField);
  const terrain = new Mesh(geometry, material);
  terrain.receiveShadow = true;
  terrain.castShadow = true;
  scene.add(terrain);

  // No clouds over the city: the world deck is a stylized 40 km layer.
  const noClouds = createCloudUniforms(null);
  const waveM = 85; // metres per wave-normal tile
  const water = createWater(
    { waterNormal: opts.waterNormal, heightY: heightFieldToDataTexture(heightField), worldMask },
    noClouds,
    {
      width: sizeX,
      height: sizeZ,
      centerX: (bounds.minX + bounds.maxX) / 2,
      centerZ: (bounds.minZ + bounds.maxZ) / 2,
      tileA: [sizeX / waveM, sizeZ / waveM],
      tileB: [sizeX / (waveM * 2.6), sizeZ / (waveM * 2.6)],
      foamTile: [sizeX / 60, sizeZ / 60],
      depthFull: 45 * meta.verticalExaggeration,
    },
  );
  scene.add(water.mesh);

  const model = createCityModel(opts.data, heightField, meta.verticalExaggeration);
  scene.add(model.group);

  const lighting = createLighting({ maxRayLength: 30000, normalBias: 3 });
  scene.add(lighting.group);
  const atmosphere = createAtmosphere(scene);

  const margin = 1500;
  const rig = createCameraRig(opts.domElement, opts.onViewChange, {
    limits: {
      distMin: 350,
      distMax: 11000,
      pitchNear: (30 * Math.PI) / 180,
      pitchFar: (58 * Math.PI) / 180,
      bounds: {
        minX: bounds.minX + margin,
        maxX: bounds.maxX - margin,
        minZ: bounds.minZ + margin,
        maxZ: bounds.maxZ - margin,
      },
    },
    near: 5,
    far: 90000,
    rotatable: true,
  });
  rig.enabled = false;

  const homeData = opts.data.home;
  const homeLocal = heightField.frame.lonLatToLocal(...homeData.lonlat);
  const home = {
    x: homeLocal.x,
    z: homeLocal.z,
    distance: homeData.distance,
    heading: (homeData.heading * Math.PI) / 180,
  };
  rig.centerOn(home.x, home.z, home.distance, home.heading);

  const camPos = new Vector3();
  return {
    id: opts.id,
    scene,
    rig,
    heightField,
    home,
    setYear(year) {
      model.setYear(year);
      urban.setYear(year);
    },
    update(timeSec, deltaSec, viewDirty, viewportW, viewportH) {
      water.setTime(timeSec);
      model.update(timeSec, deltaSec);
      urban.update(deltaSec);
      if (viewDirty) {
        lighting.updateShadowFrustum(rig.camera, viewportW, viewportH);
        camPos.copy(rig.camera.position);
        atmosphere.update(rig.distance, camPos);
      }
    },
    dispose() {
      rig.dispose();
      model.dispose();
      urban.dispose();
      geometry.dispose();
      material.dispose();
      water.dispose();
      lighting.dispose();
      atmosphere.dispose();
      albedo?.dispose();
      normal?.dispose();
      worldMask?.dispose();
    },
  };
}
