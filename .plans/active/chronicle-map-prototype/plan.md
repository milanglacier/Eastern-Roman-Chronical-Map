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
     shading. Ink contour lines, gold-leaf rivers, and a vermilion ink coast line.
   - **Territory:** a vermilion rubric line with a gilt edge plus a pale purple wash.
   - **Sea:** watercolour blue-green, deeper offshore, with inked chart ripples along the coasts.
   - **Sky:** parchment sky with watercolour clouds. The haze is parchment too, so the distance
     dissolves into paper.
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
- Screenshots via `__ercmDebug` (`journeyAt(u)`, `setDrone(pose)`, `popRise(t)`).
