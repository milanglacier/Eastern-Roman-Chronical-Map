# Timeline pacing: every era gets its moment

Started 2026-10-06 on master (after 7235bf0). Completed the same day. Progress and
verification are in `progress.md` next to this file.

## Why

The user's request:

> 我想要改进一下按时间线播放的功能，目前我感觉整体来说播放的太快了，尤其是有几个较短的时代，字幕刚出现就马上结束了。
> (Playback feels too fast overall. In the short eras especially, the caption is gone almost
> as soon as it appears.)

How playback works today:

- Autoplay (`useAutoplay` in `src/App.tsx`) advances the year at a constant
  `YEARS_PER_SECOND = 15` (`src/lib/timeline.ts`). The whole of history, 330 to 1453, takes
  about 75 s.
- The era caption (`src/ui/EraCaption.tsx`) is a fixed 4.2 s CSS animation, keyed by the
  snapshot. A new era remounts it and cuts off the one still showing.
- Era lengths range from 70 years down to 4. At 15 years/s, eight eras last under 2 s:

  | era | years | today |
  |---|---|---|
  | 626 darkest hour | 4 | 0.27 s |
  | 1071 Manzikert | 10 | 0.67 s |
  | 630 Heraclius' triumph | 20 | 1.33 s |
  | 843, 1180 | 24 | 1.6 s |
  | 600, 527 | 26–28 | 1.7–1.9 s |

## Decisions (user, this session)

- **Pacing model:** each era gets a floor plus a share that grows with its length:
  `seconds = 4 + years / 20`. Short eras become readable, and long eras still feel longer.
  The pace changes smoothly between eras, so the year counter never jumps faster or slower.
- **Total length:** about 2.5 minutes. The formula gives 25 × 4 + 1123 / 20 ≈ **156 s**,
  with eras lasting 4.2 to 7.5 s.
- **Speed control:** none. Only the default pace changes, and the UI stays as it is.
- **Caption:** its length follows the era. It fades in as the era begins and fades out just
  before the next one, so a long era holds its title longer. A caption is never cut off by
  the next one.

## Design

### `src/lib/playback.ts` (new, pure): the playback clock

- `ERA_SECONDS_MIN = 4` and `SECONDS_PER_YEAR = 1 / 20`. These are the only tuning knobs.
- `createPlaybackClock(snapshotYears, yearMax)` returns
  `{ duration, yearAt(t), timeAt(year), eraSeconds(snapshotYear) }`.
  - The knots are `(T_i, year_i)` at every snapshot year, where `T_i` is the running sum of
    the era budgets. The final knot is `(duration, YEAR_MAX)`.
  - `yearAt(t)` is a monotone cubic (Fritsch–Carlson / PCHIP) through the knots. The year is
    C¹ in time: the pace slows on the way into a short era and picks up on the way out, with
    no step change at a boundary. Every secant is positive, so the curve strictly increases.
  - `timeAt(year)` is its inverse, by bisection over the right segment. It is used to resume
    from any year, for example after a scrub or a tick click.
- `playbackClock` is a singleton built once from `snapshots`.
- `YEARS_PER_SECOND` goes away from `src/lib/timeline.ts`.

### Autoplay (`src/App.tsx`)

- The effect keeps a playback time `t`. On start, `t = timeAt(year)`. Each frame
  `t += dt` and `setYear(yearAt(t))`. At `t >= duration` it sets `YEAR_MAX` and pauses, as
  today.
- If the store year differs from the last value the loop wrote (the arrow keys still work
  during play), `t` re-syncs through `timeAt`. A per-frame inverse is not needed.
- Unchanged: play at the end of history restarts from 330; selecting an event or scrubbing
  pauses.

### Era caption (`EraCaption.tsx`, `theme.css`)

- The single 4.2 s keyframe becomes two animations: `era-caption-in` (0.9 s, the blur
  lifting) and `era-caption-out` (1.2 s). The fade-out is delayed by the CSS variable
  `--era-caption-hold`. Keyframe percentages cannot take variables, so splitting the
  animation keeps the fades a fixed length while the hold stretches.
- The inline style sets the hold when the caption mounts:
  - **Playing:** `eraSeconds(era) − 0.9 − 1.2 − 0.3`. The extra 0.3 s is a breath before
    the next title. A 4 s era holds for 1.6 s; a 7.5 s era holds for 5.1 s.
  - **Paused** (scrub, tick click): 2.1 s, so the total stays at today's 4.2 s.
  - **The final era (1453):** playback stops as it arrives, so its caption gets a fixed
    6 s ending card.
- The `prefers-reduced-motion` rule keeps hiding the caption. It has to cover both
  animations.

### Aerial tour (`src/map/three/aerialTour.ts`)

The tour is a pure function of the year, smoothed with σ = 16 years. At the new pace that
breaks down. In the 626 era, 4 years take about 4 s, so a 16-year σ blurs 600, 626 and 630
into one shot. The two-sine yaw drift, keyed to years, would also almost stop in short eras.

- `poseAt(year)` stays the public API and stays pure. Internally it maps
  `t = playbackClock.timeAt(year)`, then:
  - The framing ramps are smoothed in **playback seconds**, with σ ≈ 1.5 s. That is the
    current feel: 16 years at 15 years/s is about 1.1 s, a touch slower. Every frontier
    change then becomes a glide of about 3 s, whatever the length of the era.
  - The drift phase runs on `t`, so the helicopter circles at a steady rate.
- `createAerialTour` takes the clock (or a `timeAt` function) so tests can inject one.
- The follower and the `setTour` wiring in `worldScene.ts` are unchanged.

### Small follow-ups

- `worldScene.ts:197` and `perf.ts:103`: the comments that say "15 years a second" now say
  playback peaks at about 10 years a second. The benchmark sweep stays at one year per
  frame; it is a stress test.
- `docs/terrain-3d-spec.md`: the `aerialTour.ts` entry (smoothing in playback time), plus a
  line on the playback clock.
- `README.md`: no change unless its wording implies the old pace (checked when
  implementing).

## Tests

- `tests/playback.test.ts` (new):
  - Every era budget is ≥ 4 s. The total is 156 ± 1 s.
  - `timeAt(snapshot.year)` equals the running budget sum.
  - `yearAt` strictly increases over a dense sweep, `yearAt(0) = 330`, and
    `yearAt(duration) = 1453`.
  - Round trip: `yearAt(timeAt(y)) ≈ y` and `timeAt(yearAt(t)) ≈ t`.
  - C¹: the finite-difference rate on either side of each knot agrees within a small
    tolerance.
  - The peak rate is below 12 years/s.
- `tests/aerial-tour.test.ts`: the continuity test steps in playback time at 60 fps (it
  stepped `YEARS_PER_SECOND / 60`). The 626 and 630 shots now differ: the tour does not
  blur them together.
- `tests/components.test.tsx`: the caption sets a longer hold while playing in a long era
  than in a short one, and the default hold when paused.
- Existing store and timeline tests stay green.

## Verification

- `npm test`, `npm run build`.
- Browser (`agent-browser-wrapped`, dev server):
  - Play from 330 to 1453 and log `(performance.now(), year, era)`. Check a total of about
    156 s and that each era lasts at least 4 s.
  - Each caption runs its full fade-in, hold and fade-out with no cut-off. Spot-check 626,
    630 and 1071.
  - The year counter changes pace smoothly at era boundaries.
  - The aerial camera glides once per frontier change, keeps drifting in the short eras,
    and has no jerks.
  - Scrubbing mid-play, then play again, resumes from the scrubbed year.
- `?perf` overlay during play: no new stalls.

## Out of scope

- A user-facing speed control (0.5× / 1× / 2×). It was declined for now; adding one later
  is a single multiplier on `dt`.
- A one-line era summary under the caption. It would need 26 bilingual blurbs.
- Pausing on events or flying to each event's place during play.

## Revision (2026-10-06, after first review)

The user's reaction to the first version:

> I think 4s is a bit too slow? Can you tweak it to make it 2.5s? So that the
> transitioning of footage should be based on the 2.5s base?

- `ERA_SECONDS_MIN` goes from 4 to **2.5**. Each era is now `2.5 s + years / 20`, and all
  of history plays in about **119 s**. Eras last 2.7 to 6 s.
- The base is now the playback beat, and the timings below scale from it:
  - **Camera glide:** `SMOOTH_SECONDS = 0.375 × ERA_SECONDS_MIN`, about 0.94 s; it was a
    fixed 1.5 s. A frontier change is a glide of about 4σ, close to the shortest era, so a
    short era still gets its own shot.
  - **Caption fades (playing):** `0.9 / 1.2 / 0.3 s × (base / 4)`, that is 0.56 s in,
    0.75 s out and a 0.19 s gap. The hold fills the rest of the era: 1.1 s in the 626
    era, 4.5 s in the longest. The fade lengths are now CSS variables
    (`--era-caption-in`, `--era-caption-out`) set inline, like the hold.
  - The paused card (4.2 s) and the 1453 ending card (6 s) keep their fixed timing.
- The pace now peaks at about 13 years/s in the long eras. That is still under the old
  constant 15, and the test bound is now "below 14".
