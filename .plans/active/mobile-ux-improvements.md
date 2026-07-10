# Mobile UX Improvements

## Context

On mobile, opening an event popup gives content that **cannot be scrolled** — the reported bug. Investigation confirmed the cause and surfaced several other mobile gaps worth fixing in the same pass:

- **Scroll bug root cause**: in `@media (max-width: 720px)` (`src/styles/theme.css:633`), `.event-panel` gets `top: auto; max-height: 55%`, making its height *indefinite*. The scroller `.event-panel-inner { height: 100%; overflow-y: auto }` then resolves `100%` against an auto-height parent → the inner grows to content height, `overflow-y` never engages, and content is clipped off-screen. (Desktop works because `top: 14px; bottom: 14px` gives a definite height.)
- **No zoom on mobile at all**: `src/map/three/cameraRig.ts` supports only wheel-zoom + single-pointer drag; the canvas has `touch-action: none`, so native pinch is disabled too. A second finger currently re-grabs and fights the first.
- **Timeline scrubbing flaky on touch**: `.timeline-track` has no `touch-action` CSS, so mobile browsers can hijack the gesture and fire `pointercancel` mid-scrub.
- **Touch targets too small**: timeline ticks 12px, close button 26px, markers 26px.

Desktop behavior must remain unchanged; all mobile-specific CSS goes behind `@media (max-width: 720px)` / `(pointer: coarse)` / `(hover: hover)` guards.

## Step 1 — Fix event-panel scroll (bottom sheet on mobile)

File: `src/styles/theme.css`

1. Base `.event-panel-inner` (line 287): add `overscroll-behavior: contain;` (no desktop effect; prevents scroll chaining on mobile).
2. Add a `panel-in-up` keyframes block next to `panel-in` (line 276): fade + `translateY(24px)` → none.
3. Replace the `.event-panel` rule inside `@media (max-width: 720px)` with the flex bottom-sheet pattern (flex container with `max-height` clamps a `min-height: 0` item, which then scrolls; short content stays auto-sized):

```css
.event-panel {
  top: auto;
  left: 10px;
  right: 10px;
  bottom: 10px;
  width: auto;
  max-height: 55%;
  display: flex;
  flex-direction: column;
  animation-name: panel-in-up;
}
.event-panel-inner {
  height: auto;
  min-height: 0;
  flex: 1 1 auto;
}
```

Panel is absolutely positioned inside `.map-stage`, so `55%` is of the map area — correct for a sheet over the map.

## Step 2 — Timeline touch scrubbing (small, independent)

- `src/styles/theme.css`: add `touch-action: none;` to `.timeline-track` (line 443 block) — this is the actual fix for pointercancel hijacking.
- `src/ui/Timeline.tsx:39`: change `(e.target as HTMLElement).setPointerCapture(...)` → `e.currentTarget.setPointerCapture(...)` (`e.target` can be `.timeline-rail`; capture must live on the element handling `onPointerMove`).

## Step 3 — Pinch zoom + multi-touch state machine in cameraRig

File: `src/map/three/cameraRig.ts`. Keep `groundAt`, `apply`, `onWheel`, and existing exported math unchanged; mouse path stays byte-for-byte the old behavior.

New exported pure functions (testable, next to `clampDistance`):
- `pinchZoomFactor(prevSpan, span)`: returns `prevSpan / span`; returns `1` for spans ≤ 0. (Fingers spreading → factor < 1 → zoom in.)
- `pinchMidSpan(a, b)`: returns `{ mid: {x, y}, span: hypot }`.

Replace `dragging`/`grabbed` booleans with:
- `pointers: Map<pointerId, {x, y}>`, `grabbed: {x, z} | null` (ground anchor — drag point or pinch midpoint), `pinchPrevSpan: number`.
- **pointerdown**: ignore non-left mouse buttons (`e.pointerType === 'mouse' && e.button !== 0`); add to map; `setPointerCapture`. 1 pointer → `grabbed = groundAt(x, y)` (existing drag start). 2 pointers → `grabbed = groundAt(mid)`, `pinchPrevSpan = span`. 3+ → `grabbed = null` (suspend).
- **pointermove**: update map entry. 1 pointer + grabbed → existing drag-pan math unchanged. 2 pointers → `state.distance = clampDistance(state.distance * pinchZoomFactor(pinchPrevSpan, span))`, update `pinchPrevSpan`, `apply()`, then keep the grabbed ground point under the midpoint (same before/after `groundAt` trick as `onWheel` lines 99–112) — this gives combined pinch-zoom + two-finger pan in one rule.
- **pointerup/pointercancel** (one unified handler): delete from map, release capture (keep the `hasPointerCapture` guard — iOS Safari can throw after cancel). 2→1: **re-grab under the surviving finger** (reusing the pinch-midpoint grab would make the map jump). 3→2: restart pinch baseline. →0: `grabbed = null`.
- Update `dispose()` for renamed handlers.

Edge cases handled by this design: `pointercancel` mid-pinch (per-pointer pruning), span→0 (factor 1 + clamp), `groundAt` returning null near horizon (keep `grabbed`, recover next move), one finger landing on a DOM marker (canvas sees one pointer → degrades to drag; acceptable).

## Step 4 — Touch target sizes (`@media (pointer: coarse)`)

File: `src/styles/theme.css` — append one block with invisible hit-area extenders (visuals unchanged; ticks/markers are `position: absolute`, track is `relative`, so pseudo-element insets work):

- `.timeline-track::before { inset: -12px 0 }` → ~46px hit band (seek math uses only `rect.left/width`, unaffected).
- `.timeline-tick::before { inset: -12px }` → ~36px.
- `.event-marker::before { inset: -9px }` → ~44px (`::after` is taken by the pointer arrow).
- `.event-panel-close { width/height: 38px; font-size: 16px }`.

## Step 5 — Tap responsiveness, sticky hover, viewport hardening

- Global `button` rule (`theme.css:46`): add `touch-action: manipulation;` (kills iOS double-tap-zoom delay on all buttons at once).
- Wrap `.event-marker:hover` and `.timeline-tick:hover` styles in `@media (hover: hover)` so touch doesn't leave sticky hover states. Line 189 combines `:hover, .selected` — split it: `.selected` stays unguarded, `:hover` moves into the media query.
- `.app` (`theme.css:51`): add `height: 100dvh;` after `height: 100%;` (fallback for old browsers) so the timeline stays visible as mobile browser chrome collapses.
- `index.html:5`: viewport meta → add `viewport-fit=cover`; `.timeline` (`theme.css:384`) bottom padding → `calc(12px + env(safe-area-inset-bottom))` to clear the iPhone home indicator.

## Step 6 — Tests

- `tests/three-geo.test.ts` (existing camera-math suite, follows lines 52–73 pattern):
  - `pinchZoomFactor(100, 200) === 0.5`, `pinchZoomFactor(100, 50) === 2`.
  - Degenerate spans return 1: `(0, 100)`, `(100, 0)`, `(-5, 100)`.
  - `clampDistance(d * pinchZoomFactor(a, b))` stays within `[DIST_MIN, DIST_MAX]` for extreme ratios.
  - `pinchMidSpan({0,0},{6,8})` → mid `{3,4}`, span `10`; symmetric under swap.
- `tests/components.test.tsx` (existing pointer pattern at line 38): after `pointerDown` at `clientX: 500`, fire `pointerMove` with `{ clientX: 750, pointerId: 1, buttons: 1 }` and assert the year advances toward the 3/4 mark — locks in scrubbing + the `currentTarget` capture change.

The pinch state machine and CSS scroll behavior aren't testable in jsdom — pinch math lives in the exported pure functions instead.

## Verification

1. `npm test` — new + existing vitest suites pass.
2. `npm run dev`, then use `agent-browser-wrapped` with a mobile viewport (e.g. 390×844, touch emulation):
   - Open an event marker → popup appears as bottom sheet → **touch-scroll the detail text** (the reported bug).
   - Pinch on the canvas → zoom in/out toward the pinch point; one-finger drag still pans.
   - Scrub the timeline by touch-drag; tap a tick.
   - Verify no layout regressions at desktop width (panel on the right, wheel zoom, drag pan unchanged).
