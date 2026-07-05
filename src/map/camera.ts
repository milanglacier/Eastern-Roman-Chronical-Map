import type { Container } from 'pixi.js';
import { WORLD_W, WORLD_H, ISO_SQUASH } from '../lib/hex';
import { useAppStore } from '../state/store';

const ISO_WORLD_H = WORLD_H * ISO_SQUASH;
const MAX_SCALE = 6;

/**
 * Drag-to-pan / wheel-to-zoom camera. Applies its transform to the world
 * container and mirrors it into the store so the DOM marker overlay can
 * position itself with the same mapping (screen = world * scale + offset).
 */
export function createCamera(canvas: HTMLCanvasElement, world: Container) {
  let scale = 1;
  let x = 0;
  let y = 0;

  const viewport = () => ({ w: canvas.clientWidth, h: canvas.clientHeight });

  const minScale = () => {
    const { w, h } = viewport();
    return Math.max(w / WORLD_W, h / ISO_WORLD_H);
  };

  function clamp() {
    const { w, h } = viewport();
    scale = Math.min(MAX_SCALE, Math.max(minScale(), scale));
    x = Math.min(0, Math.max(w - WORLD_W * scale, x));
    y = Math.min(0, Math.max(h - ISO_WORLD_H * scale, y));
  }

  function apply() {
    clamp();
    world.scale.set(scale);
    world.position.set(x, y);
    useAppStore.getState().setCamera({ x, y, scale });
  }

  /** Center the view on a world-iso point at the given scale. */
  function centerOn(wx: number, wy: number, s: number) {
    const { w, h } = viewport();
    scale = s;
    x = w / 2 - wx * scale;
    y = h / 2 - wy * scale;
    apply();
  }

  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  const onPointerDown = (e: PointerEvent) => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent) => {
    if (!dragging) return;
    x += e.clientX - lastX;
    y += e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    apply();
  };
  const onPointerUp = (e: PointerEvent) => {
    dragging = false;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const prev = scale;
    scale = Math.min(MAX_SCALE, Math.max(minScale(), scale * Math.pow(1.0015, -e.deltaY)));
    const k = scale / prev;
    x = cx - (cx - x) * k;
    y = cy - (cy - y) * k;
    apply();
  };
  const onResize = () => apply();

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('resize', onResize);

  return {
    centerOn,
    refresh: apply,
    destroy() {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
      window.removeEventListener('resize', onResize);
    },
  };
}
