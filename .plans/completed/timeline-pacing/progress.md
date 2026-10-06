# Progress: timeline pacing

Plan: `plan.md` next to this file.

## Status (2026-10-06)

Completed. Implemented and verified in the browser, then revised to a 2.5 s base (see the
Revision section of `plan.md`). The user approved the feel, and it is committed.

- [x] `src/lib/playback.ts`: era budgets, PCHIP clock, inverse
- [x] `App.tsx` autoplay on the playback clock; drop `YEARS_PER_SECOND`
- [x] Era caption: split in/out animations, hold follows the era
- [x] Aerial tour: smoothing (σ = 0.375 × base) and drift in playback seconds
- [x] Comments in `worldScene.ts` / `perf.ts`; `docs/terrain-3d-spec.md` (README needed
      no change)
- [x] Tests: `playback.test.ts`, `aerial-tour.test.ts`, `components.test.tsx`
- [x] `npm test`, `npm run build`, browser verification
- [x] Revision: 2.5 s base; camera glide and caption fades scale from it
- [x] User review of the feel
- [x] Commit

## Verification (first version, 4 s base)

- `npm test`: 20 files, 208 tests passed. `npm run build` and `tsc --noEmit`: clean. The
  existing chunk-size warning is unchanged.
- Clock: 156.2 s for all of history. The pace runs from 0.66 to 10.6 years/s; the old pace
  was a constant 15.
- Browser (dev server, 1440×900, `agent-browser-wrapped`, per-frame probe of the year, era,
  caption opacity and camera pose over one full playback):
  - Play reached 1453 after 156.0 s.
  - Era lengths on screen: 626 4.19 s, 1071 4.51 s, 630 5.00 s; the longest are
    1261/1330 at 7.45/7.50 s.
  - Every caption reached full opacity and was fully gone (opacity 0) before the next one
    mounted. Full-strength time: 626 1.9 s, 1071 2.2 s, long eras 4.5–5.2 s. The final
    card (1453) held 4.0 s.
  - Camera: at most 0.92 heights/s, at most 0.003 rad of yaw per frame, no frame gap over
    53 ms. In the 626 era the camera kept circling: it moved 12 units and turned 0.04 rad.
  - Jumping to a tick (1071) paused playback; play resumed from there (AD 1076 after 2 s).

## Verification (revision, 2.5 s base)

- `npm test`: 20 files, 209 tests passed. `tsc --noEmit` and `npm run build`: clean.
- Browser, one full playback with the same probe:
  - Play reached 1453 after 118.6 s.
  - Eras last 2.69 s (626) to 6.00 s (1330).
  - None of the 25 captions was cut off; each was at opacity 0 before the next mounted.
    Full-strength time: 626 1.3 s, 1071 1.6 s, 630 2.1 s, 1330 4.6 s. The ending card
    keeps its 0.9/3.9/1.2 s timing.
  - Camera: at most 1.39 heights/s (it was 0.92; the glides are now faster, as intended),
    at most 0.0034 rad of yaw per frame, no frame gap over 53 ms. In the 626 era the
    camera moved 8 units.
