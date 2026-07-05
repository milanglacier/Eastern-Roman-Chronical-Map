import '@testing-library/jest-dom/vitest';

// jsdom lacks the Pointer Events API; provide the minimum the app touches.
if (typeof window !== 'undefined') {
  if (!window.PointerEvent) {
    class PointerEventPolyfill extends MouseEvent {
      pointerId: number;
      constructor(type: string, params: PointerEventInit = {}) {
        super(type, params);
        this.pointerId = params.pointerId ?? 1;
      }
    }
    // @ts-expect-error assigning polyfill
    window.PointerEvent = PointerEventPolyfill;
  }
  HTMLElement.prototype.setPointerCapture ??= () => {};
  HTMLElement.prototype.releasePointerCapture ??= () => {};
  HTMLElement.prototype.hasPointerCapture ??= () => false;
}
