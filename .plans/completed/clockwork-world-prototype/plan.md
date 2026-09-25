# Clockwork world: prototype (Game-of-Thrones-titles direction)

> **Status: rejected, code removed (2026-09-25).** Built as specified (screenshots
> in `docs/screenshots/archive/clockwork-*.jpg`). The user rejected it:
> "I want a free angle of rotation that can go up and down, left and right, not a
> fixed angle; your current version is still a 2.5D god-like view." The orbit
> camera around a ground target is what made it read as a map. It was followed by
> `.plans/active/chronicle-map-prototype`. The clockwork theme (`?theme=clockwork`)
> was then deleted: the stone-and-brass materials, the hall and astrolabe, the
> clockwork Constantinople, the lacquer sea, the vault sky, the terraced relief,
> the concave bend and the orbit camera. The coast distance field decoder and the
> daylight reflection environment survive in the chronicle map.

## Why

At the art gate, the user rejected the painted diorama (`.plans/active/painted-diorama-journey/plan.md`):
"it now has the painted art style, but still as a map". What makes it map-like:

- the overview camera and geographic scale
- nothing standing up from the surface

Chosen direction: the **literal Game of Thrones title sequence**.

- The world is a crafted mechanical model in a dark hall: carved-stone land, a lacquered sea
  with engraved waves, brass inlays for rivers and frontiers, and an astrolabe sun overhead.
- Cities are giant clockwork models that rise out of the table on turning gears.
- The camera flies low guided paths between landmarks, and the user can grab it at any time.
- Geographic scale is dropped on purpose.

**Prototype first:** one proof scene on the Bosporus, shown to the user before the build-out.

## Reused from v2

- The render pipeline, used for DOF, bloom, grade, vignette and grain (paint pass off).
- Era moods, which now tint the hall light.
- The camera rig and the curvature module, now bent concave into a bowl, like the inside of
  the title sequence's sphere.
- The data, the chrome and the tests.

The painted look stays reachable with `?theme=painted`.

## Prototype scope

1. **Theme switch** (`src/map/three/theme.ts`): `clockwork` by default, `painted` via URL.
2. **Sculpted relief** (`src/lib/clockworkRelief.ts`, pure and tested):
   - Land is raised as a slab above the sea, so coasts read as cut cliff edges.
   - Relief is exaggerated about 3× beyond the v2 shaping, with sharpened peaks.
   - Soft terracing gives carved strata.
   - One function feeds the mesh, marker projection, the rig's ground and collision.
3. **Stone and brass materials:**
   - Terrain: stone ramp by height, engraved contour lines at the terrace steps, a 30%
     regional tint from the albedo, stone mottle, brass river inlays, and a brass frontier
     rail with a faint imperial lacquer.
   - Sea: dark blue-grey lacquer with engraved coastal wave lines and glossy highlights.
4. **Hall:**
   - Dark vault sky with a warm glow.
   - Astrolabe sun: an emissive sphere with rotating brass rings.
   - Warm key light from the astrolabe, a PMREM environment for metal reflections, and warm
     dark haze.
   - Concave curvature.
5. **Clockwork Constantinople** (`src/map/three/clockwork/constantinople.ts`), about 4 world
   units across:
   - hex brass base with gear rims and turning gears
   - stone peninsula slab
   - Theodosian land walls with towers and the Golden Gate, plus sea walls
   - instanced city blocks
   - Hagia Sophia, whose dome unfolds from petals
   - Hippodrome with obelisk, Column of Constantine with gilt statue
   - Golden Horn chain to Galata

   It rises in staged, gear-driven motion; `setRise(t)` is a pure function of t.
6. **Guided flight:** `rig.playPath(poses, seconds)` does Catmull-Rom pose interpolation and
   is cancelled by any input. The opening path: Aegean → low over the Dardanelles → the
   Marmara → orbit Constantinople as it rises. It is triggered by a "Journey" button, and
   when the year starts at 330.
7. **Screenshots:** mid-flight, city mid-rise, city risen, low orbit and phone. Show the user.

## After sign-off (not in the prototype)

- More cities: Rome, Antioch, Alexandria, Thessalonica, Ravenna, Carthage, Nicaea.
- Era variants: walls from 413, the domed Hagia Sophia from 537, ruin after 1204.
- Cities fall (sink or collapse) when lost.
- Armies as bronze figurines and the 1453 siege.
- Guided journey through all eras, and mobile tuning.

## Verification

- `npm test`: the relief lib (monotone on land, slab step, sea untouched), path interpolation
  (endpoints and continuity), rise staging (monotone, bounded), plus all existing tests.
- Screenshots via `agent-browser-wrapped` with `__ercmDebug` (`setPose`, `setYear`,
  `cityRise(t)`, `pathAt(u)`, `freezeTime`).
