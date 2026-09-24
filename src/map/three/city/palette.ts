/**
 * Shared materials for the procedural city. Surfaces get small canvas
 * textures (drawn once at runtime, deterministic) so walls read as masonry
 * and roofs as tile from the orbit camera without shipping image assets:
 * the Theodosian limestone-and-brick banding, terracotta roof courses,
 * lead-sheathed domes.
 */
import {
  CanvasTexture,
  Color,
  DoubleSide,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
} from 'three';
import { hashStringSeed, mulberry32 } from '../../../lib/prng';

export const CITY_COLORS = {
  limestone: 0xd9ccb0,
  brickBand: 0x9c5a3f,
  marble: 0xefe9dc,
  plaster: 0xe2d4b8,
  ochreWall: 0xcfae86,
  terracotta: 0xa9573a,
  lead: 0x8d979d,
  paving: 0xc9bca0,
  sand: 0xd8c49a,
  darkStone: 0x6d6255,
  ruin: 0x9a8d78,
  moat: 0x5b5344,
  timber: 0x6a4a2e,
  sail: 0xeee3c8,
  hull: 0x5a3b24,
  basin: 0x2d5b66,
  chain: 0x2a2622,
  gold: 0xd8b64a,
  porphyry: 0x6b3040,
} as const;

function canvasTexture(
  size: number,
  seed: string,
  draw: (ctx: CanvasRenderingContext2D, rand: () => number) => void,
): Texture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  draw(ctx, mulberry32(hashStringSeed(seed)));
  const tex = new CanvasTexture(canvas);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

const hex = (c: number) => `#${new Color(c).getHexString()}`;

/** Limestone ashlar with red brick courses (one texture tile = 10 m × 10 m). */
function masonryTexture(): Texture | null {
  return canvasTexture(256, 'city-masonry', (ctx, rand) => {
    ctx.fillStyle = hex(CITY_COLORS.limestone);
    ctx.fillRect(0, 0, 256, 256);
    // Ashlar blocks with jittered tone.
    for (let row = 0; row < 16; row++) {
      const y = row * 16;
      const offset = (row % 2) * 16;
      for (let x = -offset; x < 256; x += 32) {
        const t = 0.9 + rand() * 0.16;
        const c = new Color(CITY_COLORS.limestone).multiplyScalar(t);
        ctx.fillStyle = `#${c.getHexString()}`;
        ctx.fillRect(x + 1, y + 1, 30, 14);
      }
    }
    // Brick courses: five bricks deep, every ~quarter of the tile.
    for (const y of [40, 104, 168, 232]) {
      ctx.fillStyle = hex(CITY_COLORS.brickBand);
      ctx.fillRect(0, y, 256, 14);
      ctx.fillStyle = 'rgba(40,20,10,0.35)';
      for (let k = 0; k < 5; k++) ctx.fillRect(0, y + k * 3, 256, 1);
    }
  });
}

/** Terracotta roof tile courses (one tile = 4 m). */
function roofTexture(): Texture | null {
  return canvasTexture(128, 'city-roof', (ctx, rand) => {
    ctx.fillStyle = hex(CITY_COLORS.terracotta);
    ctx.fillRect(0, 0, 128, 128);
    for (let y = 0; y < 128; y += 8) {
      ctx.fillStyle = 'rgba(50,20,10,0.35)';
      ctx.fillRect(0, y, 128, 2);
      for (let x = 0; x < 128; x += 6) {
        ctx.fillStyle = `rgba(255,220,190,${(rand() * 0.12).toFixed(3)})`;
        ctx.fillRect(x, y + 2, 5, 6);
      }
    }
  });
}

/** Lead sheathing with radial seams (domes). */
function leadTexture(): Texture | null {
  return canvasTexture(128, 'city-lead', (ctx, rand) => {
    ctx.fillStyle = hex(CITY_COLORS.lead);
    ctx.fillRect(0, 0, 128, 128);
    for (let x = 0; x < 128; x += 8) {
      ctx.fillStyle = 'rgba(30,35,40,0.35)';
      ctx.fillRect(x, 0, 1, 128);
    }
    for (let i = 0; i < 300; i++) {
      ctx.fillStyle = `rgba(255,255,255,${(rand() * 0.06).toFixed(3)})`;
      ctx.fillRect(rand() * 128, rand() * 128, 3, 2);
    }
  });
}

/** Stone paving (one tile = 8 m). */
function pavingTexture(): Texture | null {
  return canvasTexture(128, 'city-paving', (ctx, rand) => {
    ctx.fillStyle = hex(CITY_COLORS.paving);
    ctx.fillRect(0, 0, 128, 128);
    for (let y = 0; y < 128; y += 16) {
      for (let x = (y / 16) % 2 ? -8 : 0; x < 128; x += 16) {
        const t = 0.88 + rand() * 0.18;
        const c = new Color(CITY_COLORS.paving).multiplyScalar(t);
        ctx.fillStyle = `#${c.getHexString()}`;
        ctx.fillRect(x + 1, y + 1, 14, 14);
      }
    }
  });
}

export interface CityMaterials {
  masonry: MeshStandardMaterial;
  ruin: MeshStandardMaterial;
  marble: MeshStandardMaterial;
  plaster: MeshStandardMaterial;
  ochre: MeshStandardMaterial;
  roof: MeshStandardMaterial;
  lead: MeshStandardMaterial;
  paving: MeshStandardMaterial;
  sand: MeshStandardMaterial;
  moat: MeshStandardMaterial;
  timber: MeshStandardMaterial;
  sail: MeshStandardMaterial;
  hull: MeshStandardMaterial;
  basin: MeshStandardMaterial;
  chain: MeshStandardMaterial;
  gold: MeshStandardMaterial;
  porphyry: MeshStandardMaterial;
  darkStone: MeshStandardMaterial;
  /** Houses: white base, per-instance colour tints it. */
  houseWall: MeshStandardMaterial;
  houseRoof: MeshStandardMaterial;
  dispose(): void;
}

export function createCityMaterials(): CityMaterials {
  const masonryTex = masonryTexture();
  const roofTex = roofTexture();
  const leadTex = leadTexture();
  const pavingTex = pavingTexture();
  const std = (color: number, extra: Partial<ConstructorParameters<typeof MeshStandardMaterial>[0]> = {}) =>
    // Double-sided: procedural ribbons/roofs need not get winding right,
    // and three flips back-face normals so lighting stays correct.
    new MeshStandardMaterial({ color, roughness: 0.92, metalness: 0, side: DoubleSide, ...extra });
  const mats = {
    masonry: std(0xffffff, { map: masonryTex ?? undefined, color: masonryTex ? 0xffffff : CITY_COLORS.limestone }),
    ruin: std(CITY_COLORS.ruin, { map: masonryTex ?? undefined, color: masonryTex ? 0xb8ab95 : CITY_COLORS.ruin }),
    marble: std(CITY_COLORS.marble, { roughness: 0.6 }),
    plaster: std(CITY_COLORS.plaster),
    ochre: std(CITY_COLORS.ochreWall),
    roof: std(0xffffff, { map: roofTex ?? undefined, color: roofTex ? 0xffffff : CITY_COLORS.terracotta }),
    lead: std(0xffffff, { map: leadTex ?? undefined, color: leadTex ? 0xffffff : CITY_COLORS.lead, roughness: 0.55, metalness: 0.25 }),
    paving: std(0xffffff, { map: pavingTex ?? undefined, color: pavingTex ? 0xffffff : CITY_COLORS.paving }),
    sand: std(CITY_COLORS.sand),
    moat: std(CITY_COLORS.moat),
    timber: std(CITY_COLORS.timber),
    sail: std(CITY_COLORS.sail),
    hull: std(CITY_COLORS.hull),
    basin: std(CITY_COLORS.basin, { roughness: 0.25, metalness: 0.1 }),
    chain: std(CITY_COLORS.chain, { roughness: 0.5, metalness: 0.6 }),
    gold: std(CITY_COLORS.gold, { roughness: 0.35, metalness: 0.8 }),
    porphyry: std(CITY_COLORS.porphyry, { roughness: 0.4 }),
    darkStone: std(CITY_COLORS.darkStone),
    houseWall: std(0xffffff),
    houseRoof: std(0xffffff, { map: roofTex ?? undefined }),
  };
  return {
    ...mats,
    dispose() {
      for (const m of Object.values(mats)) m.dispose();
      masonryTex?.dispose();
      roofTex?.dispose();
      leadTex?.dispose();
      pavingTex?.dispose();
    },
  };
}
