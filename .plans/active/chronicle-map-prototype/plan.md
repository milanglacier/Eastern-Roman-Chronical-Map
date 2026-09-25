# Living chronicle map: prototype (free-look camera)

## Why

The user reviewed the clockwork prototype (`.plans/active/clockwork-world-prototype/plan.md`)
and said: "not right… I want a free angle of rotation that can go up and down, left and right,
not a fixed angle; your current version is still a 2.5D god-like view."

Every attempt so far used an orbit camera fixed on a ground target, with left-drag to pan. That
makes it read as a map whatever the art style.

The user asked for a prototype of the second style option, the **living chronicle map**: an
illuminated manuscript with parchment, watercolour, ink hachures, gilded rivers and borders, and
cities that rise like pop-up engravings.

## Prototype scope

1. **Free-look drone camera** (`src/map/three/droneRig.ts`, implementing the `CameraRig`
   interface so the host, markers and compass keep working).
   - **State:** position plus yaw (0–360°) and pitch (−85° looking down to +70° looking up).
   - **Mouse:** drag looks around (turning right turns the view right). Right-drag or
     shift-drag moves across the ground. The wheel flies toward the cursor, at a speed that
     scales with altitude.
   - **Touch:** one finger looks, two fingers pinch to fly and drag to move.
   - **Keys:** WASD move, Q/E descend and climb, arrows look, N faces north.
   - **Limits:** it stays above the terrain and within the world rect.
   - **Curvature:** convex, centred under the camera, so there is always a true horizon.
   - **Guided flights:** Catmull-Rom interpolation over drone poses; any input takes over.
2. **Chronicle theme** (`?theme=chronicle`, now the default; `clockwork` and `painted` stay
   reachable).
   - **Land:** parchment ground, and watercolour washes taken from the painted albedo with soft,
     pigment-pooled edges. Ink hachures follow the slope, with density from steepness and
     shading. Sepia contour lines, watercolour-blue rivers, and an inked coast line.
   - **Territory:** an imperial-purple wash plus a purple frontier line with a gold edge.
   - **Sea:** watercolour blue-green, deeper offshore, with inked chart ripples along the coasts.
   - **Sky:** the era's natural sky as a watercolour, with painted clouds and a gold-rimmed sun.
     The haze is a light blue air with a little paper in it.
   - **Relief:** the sculpted relief with a coast distance field, a small slab and no terraces.
3. **Pop-up Constantinople** (`src/map/three/chronicle/popupCity.ts`).
   - Three layered cards drawn procedurally on a Canvas with ink linework, watercolour fills,
     gold leaf and hatching: the Theodosian walls and Golden Gate at the front, the city
     quarter in the middle, and Hagia Sophia, the palace, the column and domes at the back.
   - Cylindrical billboarding, so the layers always face the viewer with real parallax.
   - A gilded roundel with the city name on the ground.
   - Cards fold up from flat like a pop-up book, staggered, with an overshoot.
4. **Opening journey:** high over the Aegean, looking toward the horizon → dive over the
   Dardanelles → skim the Marmara at mountain height → Constantinople pops up.
5. **Screenshots:** include looking up at mountains, a horizon view and the pop-up city. Show the
   user.

## Verification

- `npm test`: drone math (look clamps, ground clearance, path interpolation), the relief variant,
  and all existing tests.
- Screenshots via `__ercmDebug` (`journeyAt(u)`, `setDrone(pose)`, `cityRise(t)`, `setYear`,
  `freezeTime`). Pass `?intro=0` to skip the opening flight.

## Status (2026-09-25)

Prototype built and approved ("this is in general good"), committed as `8b7ae25`.

**Colour decision.** The user tried an all-purple-gold scene: first a pastel lilac,
which read "like neon, gouache", then a deep dark purple, which read "dead, lifeless".
The final rule is recorded in `docs/art-direction.md`:

- The **scene uses natural colours**: the era's sky, a blue-green watercolour sea,
  and natural land pigments on parchment with sepia ink.
- **Purple-gold is reserved** for:
  - the UI chrome
  - the empire's territory wash and purple/gold frontier line
  - emblems (city name ribbons, roundel petals)

## Next: build-out (not started)

- **Pop-up vignettes for other cities:** Rome, Antioch, Alexandria, Thessalonica,
  Ravenna, Carthage, Nicaea, Trebizond.
- **Cities follow the eras:**
  - Constantinople variants: the land walls from 413, the domed Hagia Sophia from
    537, damage after 1204, the Ottoman camp in 1453.
  - Cities fold down or burn when lost.
- **The 1453 siege** as a pop-up tableau: armies, the great bombard, the fleet and
  the chain. Also a smaller battle vignette for other military events.
- **Guided journeys** through all eras, flying from event to event.
- **Clean-up:**
  - grainy hachures and visible mesh facets on close-up peaks
  - the pale horizon at high altitude
  - performance on mobile
