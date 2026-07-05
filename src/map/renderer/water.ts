/**
 * Animated water shimmer: two world-sized noise Sprites whose alphas breathe
 * in counter-phase on the shared ticker, giving an evolving sparkle over the
 * sea and river channels.
 *
 * The water mask is baked INTO the noise textures once at build time (via
 * the 'erase' blend), so no runtime masking happens at all. Hard-won notes:
 * - TilingSprite silently failed to render inside the world container on
 *   some GL stacks (pixi v8) — plain Sprites only.
 * - Runtime masks were unusable: Container masks render nothing in pixi v8,
 *   Graphics stencil masks were unreliable on software GL, and Sprite alpha
 *   masks allocate screen-space RenderTextures that blow past texture-size
 *   limits at high zoom (world × 6 ≈ 11k px), blanking whole layers.
 */
import {
  Container,
  Graphics,
  RenderTexture,
  Sprite,
  type Renderer,
  type Ticker,
} from 'pixi.js';
import { tiles } from '../../data';
import { WORLD_W, WORLD_H, ISO_SQUASH } from '../../lib/hex';
import { hexIsoCorners } from '../iso';
import { terrainAt, isLandTile } from './terrain';

const MASK_W = Math.ceil(WORLD_W);
const MASK_H = Math.ceil(WORLD_H * ISO_SQUASH);
const BASE_ALPHA = 0.2;

function drawNoise(g: Graphics, seedStart: number): void {
  let seed = seedStart;
  const rng = () => {
    seed = Math.imul(seed ^ (seed >>> 13), 1274126177);
    return ((seed ^ (seed >>> 16)) >>> 0) / 4294967296;
  };
  const count = Math.ceil((MASK_W * MASK_H) / 400); // ~1 blob per 20x20 px
  for (let i = 0; i < count; i++) {
    const x = rng() * MASK_W;
    const y = rng() * MASK_H;
    const rx = 5 + rng() * 13;
    const ry = rx * (0.35 + rng() * 0.3);
    g.ellipse(x, y, rx, ry).fill({ color: 0xffffff, alpha: 0.16 + rng() * 0.18 });
  }
}

/** White shapes over everything that shimmers: sea tiles + extras (rivers). */
function drawWaterShapes(g: Graphics, addExtras?: (g: Graphics) => void): void {
  for (let row = 0; row < tiles.rows; row++) {
    for (let col = 0; col < tiles.cols; col++) {
      if (isLandTile(terrainAt(col, row))) continue;
      const flat: number[] = [];
      for (const p of hexIsoCorners(col, row, 0)) flat.push(p.x, p.y);
      g.poly(flat).fill(0xffffff);
    }
  }
  addExtras?.(g);
}

/**
 * World-sized noise texture with the land areas already erased, so the
 * resulting Sprite needs no runtime mask.
 */
export function makeMaskedNoiseTexture(
  renderer: Renderer,
  seed: number,
  addMaskExtras?: (g: Graphics) => void,
): RenderTexture {
  const opts = { width: MASK_W, height: MASK_H, antialias: true };

  // Land coverage = white world rect minus the water shapes ('erase').
  const landRT = RenderTexture.create(opts);
  const whole = new Graphics().rect(0, 0, MASK_W, MASK_H).fill(0xffffff);
  renderer.render({ container: whole, target: landRT });
  whole.destroy();
  const water = new Graphics();
  drawWaterShapes(water, addMaskExtras);
  water.blendMode = 'erase';
  renderer.render({ container: water, target: landRT, clear: false });
  water.destroy();

  // Noise, then erase it wherever land covers.
  const noiseRT = RenderTexture.create(opts);
  const noise = new Graphics();
  drawNoise(noise, seed);
  renderer.render({ container: noise, target: noiseRT });
  noise.destroy();
  const landSprite = new Sprite(landRT);
  landSprite.blendMode = 'erase';
  renderer.render({ container: landSprite, target: noiseRT, clear: false });
  landSprite.destroy();
  landRT.destroy(true);

  return noiseRT;
}

export interface Shimmer {
  /** Add this to the world between the water and land layers. */
  container: Container;
  /** Detach the ticker callback (display objects die with the app). */
  destroy(): void;
}

export function createShimmer(
  renderer: Renderer,
  ticker: Ticker,
  addMaskExtras?: (g: Graphics) => void,
): Shimmer {
  const a = new Sprite(makeMaskedNoiseTexture(renderer, 48271, addMaskExtras));
  const b = new Sprite(makeMaskedNoiseTexture(renderer, 914742619, addMaskExtras));
  for (const sprite of [a, b]) sprite.blendMode = 'add';

  const container = new Container();
  container.addChild(a, b);

  let elapsed = 0;
  const tick = (t: Ticker) => {
    elapsed += t.deltaMS / 1000;
    // Counter-phased cross-fade evolves the pattern; slow sine breathes it.
    const mix = 0.5 + 0.5 * Math.sin(elapsed * 0.55);
    const breath = 0.75 + 0.25 * Math.sin(elapsed * 0.23 + 1.1);
    a.alpha = BASE_ALPHA * breath * mix;
    b.alpha = BASE_ALPHA * breath * (1 - mix);
  };
  tick(ticker); // sensible alphas before the first shared tick
  ticker.add(tick);

  return {
    container,
    destroy() {
      ticker.remove(tick);
    },
  };
}
