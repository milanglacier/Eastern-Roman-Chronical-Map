/**
 * Builds the static terrain sprite layers from the terrain atlas.
 *
 * Tiles are inserted row-major (top to bottom) so southern tiles paint over
 * the skirts/bleed of northern ones — same painter's order the old Graphics
 * renderer relied on. Feature sprites (mountain massifs, hill mounds, tree
 * clumps) are appended immediately after their base tile so the next row
 * still covers them correctly.
 */
import { Container, Sprite } from 'pixi.js';
import { tiles } from '../../data';
import type { TerrainCode } from '../../data/schema';
import { HEX_W } from '../../lib/hex';
import { tileIsoCenter } from '../iso';
import { terrainAt, isLandTile, hash01, variantIndex } from './terrain';
import type { TerrainAtlas } from './atlas';

const TREE_THRESHOLD = 0.82;

export function buildTerrainLayers(atlas: TerrainAtlas): { water: Container; land: Container } {
  const water = new Container();
  const land = new Container();
  const scale = HEX_W / atlas.manifest.footprintWidth;

  const makeSprite = (name: string, col: number, row: number, code: TerrainCode): Sprite => {
    const frame = atlas.manifest.frames[name];
    const sprite = new Sprite(atlas.texture(name));
    sprite.anchor.set(frame.anchorX, frame.anchorY);
    const c = tileIsoCenter(col, row, code); // includes ELEVATION lift
    sprite.position.set(c.x, c.y);
    sprite.scale.set(scale);
    return sprite;
  };

  for (let row = 0; row < tiles.rows; row++) {
    for (let col = 0; col < tiles.cols; col++) {
      const code = terrainAt(col, row);
      const variants = atlas.manifest.base[code];
      const name = variants[variantIndex(variants.length, col, row)];

      if (!isLandTile(code)) {
        water.addChild(makeSprite(name, col, row, code));
        continue;
      }
      land.addChild(makeSprite(name, col, row, code));

      const featureSet =
        code === 'm'
          ? atlas.manifest.features.m
          : code === 'h'
            ? atlas.manifest.features.h
            : code === 'g' && hash01(col, row) > TREE_THRESHOLD
              ? atlas.manifest.features.tree
              : null;
      if (featureSet) {
        // Swapped args give an independent hash for the feature variant.
        const pick = Math.min(featureSet.length - 1, Math.floor(hash01(row, col) * featureSet.length));
        land.addChild(makeSprite(featureSet[pick], col, row, code));
      }
    }
  }

  return { water, land };
}
