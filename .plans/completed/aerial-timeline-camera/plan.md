# Aerial timeline camera: no auto-flight, a 12 s journey, an aerial tour on play

Started 2026-09-30 on master (after 91032a4). Progress and verification are in
`progress.md` next to this file.

## Why

Before this change the page played the guided flight to Constantinople by itself. The flight
started 600 ms after load and took 19 s. Pressing play on the timeline only advanced the year,
and the camera stayed where it was. The user asked for three changes:

1. 开场不要默认直接飞跃君士坦丁堡，当用户点击飞跃君士坦丁堡才飞跃。飞跃的速度再快一点，调整到12秒飞跃。
   (Do not fly on open; fly only when the user clicks it; make the flight 12 s.)
2. 用户直接点击播放的时候应该有一个世界地图的移动，就像是直升机/航拍在切换视角一样，保持镜头运镜流畅自然。
   (Playing should move over the world map like a helicopter / aerial shot changing views,
   smooth and natural.)
3. 在城市视角时播放不要有航拍运镜，就保持自然。
   (In the city view, playing should not move the camera.)

## Decisions (user, this session)

- **Opening shot:** a still, high oblique view over the whole Empire (the 330 frontier). The
  aerial tour starts from this same pose, so pressing play at 330 flows straight into it.
- **What the tour follows:** each era's territory. The camera flies high and wide while the
  Empire is vast, and low and close as it shrinks. Between eras it glides and banks across.
- **User input during play:** the tour hands the camera back and the year keeps playing. The
  tour resumes only when play is pressed again.
- **Fly to Constantinople during play:** the flight takes the camera and the year keeps
  playing. It arrives in the city view, where the camera stays still.

## Design

### `src/map/three/aerialTour.ts` (new, pure)

- `territoryFraming(geometry)`: area centroid and RMS radius of the snapshot's MultiPolygon,
  from exact polygon moments over the outer rings. The centroid is pulled 25% toward
  Constantinople so the capital stays in the story. The radius is `1.5 × RMS`, clamped to
  9–75 world units.
- `createAerialTour(framings)` → `poseAt(year)`: a pure function of the fractional year.
  - Step framings per snapshot are Gaussian-smoothed over σ = 16 years. This is done in
    closed form: a sum of normal-CDF ramps, one per frontier change, with the radius blended
    in log space. Sampling the kernel instead made the pose jump by a small step each time a
    sample crossed an era boundary.
  - The camera sits `1.5 × radius` from the target. It looks down at 34–50°, steeper when
    high. A slow two-sine yaw drift (about ±15°) circles the shot, and a ±5% zoom breathes
    with it.
- `createEmpireTour()` builds the tour from `snapshots` and `territories`.
- `createPoseFollower()`: a critically damped follower over drone poses. It uses the closed
  form of Unity's SmoothDamp, so it is stable for any frame time. It never overshoots, and yaw
  is unwrapped toward the target. `coast(dt)` lets the camera glide on and slow to rest.

### `worldScene.ts`

- A new `setTour(on)` method.
  - `tourWanted` follows playback. `tour` is what the camera is doing now: `off`, `flying` or
    `coasting`.
  - While flying, it steps the follower toward `poseAt(year)` each frame. The stiffness ramps
    from 0.8 to 2.2 s⁻¹ over 3 s, a gentle pick-up. It writes the pose with `drone.setDrone`.
  - Pause turns `flying` into `coasting`, and the camera comes to rest in about 1.5 s.
  - User input (the drone's `onUserInput`) turns the tour off. So does any guided flight on
    the drone (the journey, north-up) and entering the city view.
  - Leaving the city view while `tourWanted` is set starts the tour again from the camera's
    new pose.
- The opening pose is `empireTour.poseAt(YEAR_MIN)`. It was `droneJourney()[0]`.
- `FLIGHT_SECONDS` goes from 19 to 12. `playJourney()` now flies
  `[current pose, ...droneJourney()]`, so it never snaps back to the Aegean start first.

### `MapCanvas.tsx`

- Remove the 600 ms auto-journey and the `?intro=0` flag.
- Subscribe to `isPlaying` → `world.setTour(isPlaying && !prefersReducedMotion)`.

### Docs

- `docs/terrain-3d-spec.md`: the `aerialTour.ts` entry, `setTour`, the 12 s journey, and the
  opening on the whole Empire. Drop `?intro=0`.
- `README.md` (visitor voice): one sentence about the camera taking to the air as the
  timeline plays and staying put inside Constantinople. Drop `?intro=0`.

### Tests: `tests/aerial-tour.test.ts`

- The 330 framing is much wider than 1400's, and the tour is higher at 330 than at 1453.
- Across all years, poses stay inside the drone bounds, above the ground, below
  `DRONE_MAX_Y`, and looking down.
- Continuity at autoplay speed: under 1.2 camera heights per second, and yaw under 0.01 rad
  per frame.
- `poseAt` is pure.
- The follower eases from rest without overshoot, takes the short way round in yaw, and
  coasts to rest.

## Out of scope / possible follow-ups

- Event-driven shots (flying to each event's place) were considered and not chosen.
- The tour does not avoid the DOM chrome. The top caption can overlap the upper third of the
  frame.
- The shot at the end of history (1453 over the Morea) is quite low. Revisit it if it feels
  too close.
