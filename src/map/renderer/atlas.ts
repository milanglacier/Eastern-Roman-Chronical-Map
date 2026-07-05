/**
 * Terrain sprite atlas: manifest schema, texture slicing, and loader.
 *
 * The loader first tries the real art atlas at public/terrain/ (produced by
 * scripts/process-terrain-art.mjs); if it is missing or invalid it falls back
 * to the runtime-generated procedural placeholder atlas. Both go through the
 * exact same manifest + texture code path.
 */
import { Assets, Rectangle, Texture, type Renderer, type TextureSource } from 'pixi.js';
import { z } from 'zod';
import { generateProceduralAtlas } from './proceduralAtlas';

const AtlasFrameSchema = z.object({
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  w: z.number().int().positive(),
  h: z.number().int().positive(),
  /** Normalized position of the hex footprint center inside the frame. */
  anchorX: z.number().min(0).max(1),
  anchorY: z.number().min(0).max(1),
});

export type AtlasFrame = z.infer<typeof AtlasFrameSchema>;

const VariantList = z.array(z.string().min(1)).min(1);

export const TerrainAtlasManifestSchema = z.object({
  /** Art px of the hex footprint width; runtime scale = HEX_W / footprintWidth. */
  footprintWidth: z.number().positive(),
  frames: z.record(z.string(), AtlasFrameSchema),
  /** Base tile variants per terrain code (frame names into `frames`). */
  base: z.object({
    D: VariantList,
    s: VariantList,
    g: VariantList,
    p: VariantList,
    h: VariantList,
    m: VariantList,
    d: VariantList,
  }),
  /** Overlay feature variants (mountain massif, hill mounds, tree clump). */
  features: z.object({
    m: VariantList,
    h: VariantList,
    tree: VariantList,
  }),
});

export type TerrainAtlasManifest = z.infer<typeof TerrainAtlasManifestSchema>;

export interface TerrainAtlas {
  manifest: TerrainAtlasManifest;
  source: TextureSource;
  /** Memoized sub-texture for a manifest frame name. */
  texture(name: string): Texture;
}

export function createTerrainAtlas(
  manifest: TerrainAtlasManifest,
  source: TextureSource,
): TerrainAtlas {
  const cache = new Map<string, Texture>();
  return {
    manifest,
    source,
    texture(name: string): Texture {
      let tex = cache.get(name);
      if (!tex) {
        const f = manifest.frames[name];
        if (!f) throw new Error(`terrain atlas has no frame "${name}"`);
        tex = new Texture({ source, frame: new Rectangle(f.x, f.y, f.w, f.h) });
        cache.set(name, tex);
      }
      return tex;
    },
  };
}

/** Every frame name referenced by base/features must exist in `frames`. */
function validateFrameRefs(manifest: TerrainAtlasManifest): void {
  const names = [...Object.values(manifest.base), ...Object.values(manifest.features)].flat();
  for (const name of names) {
    if (!manifest.frames[name]) throw new Error(`manifest references missing frame "${name}"`);
  }
}

export async function loadTerrainAtlas(renderer: Renderer): Promise<TerrainAtlas> {
  try {
    const res = await fetch('terrain/atlas.json');
    if (!res.ok) throw new Error(`atlas.json: HTTP ${res.status}`);
    const manifest = TerrainAtlasManifestSchema.parse(await res.json());
    validateFrameRefs(manifest);
    const texture = await Assets.load<Texture>('terrain/atlas.png');
    return createTerrainAtlas(manifest, texture.source);
  } catch {
    // No shipped art (or it failed to parse) — build the placeholder atlas.
    return generateProceduralAtlas(renderer);
  }
}
