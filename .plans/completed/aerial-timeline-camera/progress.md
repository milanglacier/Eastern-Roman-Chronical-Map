# Progress: aerial timeline camera

Plan: `plan.md` next to this file.

## Status (2026-09-30)

Implemented, verified in the browser, committed and pushed to master. Waiting on the
user's review of the feel.

- [x] Remove the auto-journey on open and the `?intro=0` flag (`MapCanvas.tsx`, README, spec)
- [x] Open on the whole Empire (`empireTour.poseAt(YEAR_MIN)`)
- [x] Journey takes 12 s and starts from the current camera pose
- [x] `aerialTour.ts`: territory framings, closed-form smoothing, drift, follower
- [x] `worldScene.setTour()`: follow / coast / yield / resume after leaving the city
- [x] `MapCanvas` wires `isPlaying` to the tour; reduced motion disables it
- [x] `tests/aerial-tour.test.ts`
- [x] Docs: `docs/terrain-3d-spec.md`, `README.md`
- [ ] User review of the feel in their own browser
- [x] Commit

## Verification

- `npm test`: 18 files, 190 tests passed. `npm run build`: clean.
  - Before the tests could run, the local `node_modules` was missing `three` and `sharp`,
    so six existing test files failed to load. `npm ci` restored it from the lockfile. No
    dependency changes.
- Browser (dev server, 1440×900, `__ercmDebug` probes):
  - **Opening:** the camera did not move over 3 s after load. The shot shows the whole 330
    Empire, from Britain to Mesopotamia.
  - **Play:** the camera glides from the 330 overview to the Eastern Empire after 395. It
    widens for Justinian's reconquests and pulls back after the Arab conquests. At 1204 it
    comes down low over Nicaea. By 1453 it is over the Morea, with Constantinople at the
    edge of the frame.
  - **Pause:** the camera coasts to rest in about 1.5 s.
  - **Fly to Constantinople during play:** a 12 s flight, then the veil. The city view is
    entered 13.7 s after the click, and the year keeps playing.
  - **City view during play:** the camera pose did not change over 3 s while the year
    advanced from 988 to 1160.
  - **Leaving the city during play:** the tour resumes after the veil and climbs smoothly
    out.
  - **Drag during play:** the camera stays where the user left it, and the year keeps
    advancing (669 → 718).
  - **Play at the end of history:** restarts at 330, and the tour climbs smoothly back to
    the overview.

## Notes

- The first smoothing version sampled the Gaussian every 2 years, which put small jumps into
  the pose at era boundaries (up to about 6 camera heights per second for one frame).
  Replacing it with the closed-form sum of normal-CDF ramps brought the peak down to 0.8
  heights per second, at the 1204 zoom-in.
