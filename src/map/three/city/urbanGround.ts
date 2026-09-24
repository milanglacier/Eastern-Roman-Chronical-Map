/**
 * Built-up ground under the houses: a mask of the year's urban ring
 * (canvas-rasterized, soft-edged, fading from the city core outward) that
 * the city terrain shader mixes toward trodden street soil. Its strength
 * follows the density curve, so a shrunken city's gardens and fields show
 * through again inside the walls.
 */
import { CanvasTexture, Color, LinearFilter, NoColorSpace, type Texture } from 'three';
import type { CityScene as CitySceneData } from '../../../data/schema';
import { interpolateKeyframes, urbanAreaForYear } from '../../../lib/cityTimeline';
import type { CityFrame } from './cityFrame';

const MASK_W = 1024;
const SOIL = new Color(0xc9ba9b);

export interface UrbanGround {
  uniforms: {
    uUrbanMask: { value: Texture | null };
    uUrbanStrength: { value: number };
    uUrbanSoil: { value: Color };
  };
  setYear(year: number): void;
  update(deltaSec: number): void;
  dispose(): void;
}

/** GLSL for the terrain's map_fragment: mixes albedo toward street soil. */
export const URBAN_GROUND_GLSL = /* glsl */ `
  #ifdef USE_MAP
    float urbanM = texture2D(uUrbanMask, vMapUv).a * uUrbanStrength;
    diffuseColor.rgb = mix(diffuseColor.rgb, uUrbanSoil * (0.9 + 0.2 * diffuseColor.g), urbanM);
  #endif
`;

export function createUrbanGround(data: CitySceneData, frame: CityFrame, core: { x: number; z: number }): UrbanGround {
  const { bounds } = frame;
  const sizeX = bounds.maxX - bounds.minX;
  const sizeZ = bounds.maxZ - bounds.minZ;
  const h = Math.round((MASK_W * sizeZ) / sizeX);
  const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  let texture: CanvasTexture | null = null;
  if (canvas) {
    canvas.width = MASK_W;
    canvas.height = h;
    texture = new CanvasTexture(canvas);
    texture.flipY = false; // row 0 = north = V 0, like the baked textures
    texture.colorSpace = NoColorSpace;
    texture.minFilter = LinearFilter;
    texture.generateMipmaps = false;
  }
  const toPx = (lon: number, lat: number) => {
    const p = frame.lonLatToLocal(lon, lat);
    return [((p.x - bounds.minX) / sizeX) * MASK_W, ((p.z - bounds.minZ) / sizeZ) * h] as const;
  };
  const corePx = [((core.x - bounds.minX) / sizeX) * MASK_W, ((core.z - bounds.minZ) / sizeZ) * h] as const;

  let drawnRing = -1;
  const draw = (ringIndex: number) => {
    if (!canvas || !texture || ringIndex === drawnRing) return;
    drawnRing = ringIndex;
    const ctx = canvas.getContext('2d')!;
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, MASK_W, h);
    ctx.filter = 'blur(3px)';
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    data.urbanAreas[ringIndex].ring.forEach(([lon, lat], i) => {
      const [x, y] = toPx(lon, lat);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.fill();
    ctx.filter = 'none';
    // Fade from the dense core toward the walls (houses do the same).
    ctx.globalCompositeOperation = 'destination-in';
    const r = (5500 / sizeX) * MASK_W;
    const grad = ctx.createRadialGradient(corePx[0], corePx[1], r * 0.15, corePx[0], corePx[1], r);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(1, 'rgba(255,255,255,0.3)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, MASK_W, h);
    texture.needsUpdate = true;
  };

  const uniforms = {
    uUrbanMask: { value: texture as Texture | null },
    uUrbanStrength: { value: 0 },
    uUrbanSoil: { value: SOIL.clone().convertSRGBToLinear() },
  };
  let target = 0;
  return {
    uniforms,
    setYear(year) {
      draw(data.urbanAreas.indexOf(urbanAreaForYear(data, year)));
      target = Math.min(0.92, interpolateKeyframes(data.density, year) * 1.15);
    },
    update(deltaSec) {
      const cur = uniforms.uUrbanStrength.value;
      if (cur === target) return;
      const step = deltaSec / 0.6;
      uniforms.uUrbanStrength.value = cur < target ? Math.min(target, cur + step) : Math.max(target, cur - step);
    },
    dispose() {
      texture?.dispose();
    },
  };
}
