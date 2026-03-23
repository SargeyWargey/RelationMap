# Concept: The Orrery
### A Living Universe Visualization — Full Product Requirements Document

---

## The Idea

The Orrery turns your Notion workspace into a navigable, living universe. Unlike the original orrery concept (a mechanical clockwork fixed solar system), this mode goes deeper: **you build the universe yourself** by mapping databases to cosmic scales — galaxy, star, planet, moon, and ring/asteroid belt. The result is a multi-scale 3D space you can fly through, from the cosmic (a field of galaxies) down to the intimate (the moons of a single planet).

Everything orbits. Everything moves. Size is meaningful. The universe feels real.

---

## UI Consistency — Same Shell as All Other Modes

The Orrery uses **exactly the same UI shell** as The Sphere, The City, The Mountain, and The Line. This is not negotiable — the panels, fonts, colors, and chrome must feel identical to those modes. Specifically:

- Same top-right control bar (mode switcher, sync button, theme toggle)
- Same **DatabaseTogglePanel** sliding in from the right (adapted for tier display)
- Same **NodeDetailsPanel** sliding in from the right on object selection
- Same **SettingsPanel**
- Same CSS custom properties (`var(--accent-warm)`, `var(--bg-primary)`, etc.) — never hardcoded colors
- Same font stack: Lora for display labels, DM Mono for stats/coordinates/data, Geist for UI chrome
- Same dark/light mode behavior via `data-theme` on root

The 3D canvas itself is always dark (deep space) regardless of theme — only the UI panels respect light/dark mode.

---

## Scale Hierarchy

The user assigns databases to each cosmic tier on first load. Once configured, the engine generates and renders the universe from those mappings.

| Tier | Cosmic Object | Database Maps To | Required? |
|---|---|---|---|
| 1 | Galaxy | One database — each record = one galaxy | **Required** |
| 2 | Star | One database — each record = one star within a galaxy | **Required** |
| 3 | Planet | One database — each record = one planet orbiting a star | **Required** |
| 4 | Moon | One database — each record = one moon orbiting a planet | **Required** |
| 5 | Ring / Asteroid Belt | One or more databases — each record = one particle in a ring or belt around a planet or in a belt around a star | Optional (multi-select) |

The relationship between tiers is driven by **Notion relation fields**. A star belongs to a galaxy because its record has a relation field pointing to a galaxy record. The engine discovers these links automatically from the graph data.

---

## First-Load Configuration Flow

On first visit (or if no config is saved), the user is presented with a **Universe Builder** overlay before entering the 3D view. This is a full-screen modal — same visual language as the rest of the app (dark background, accent-warm highlights, DM Mono font). It does **not** slide from the right — it overlays the entire viewport as a centered step-by-step wizard.

### Mandatory tiers (must complete all four before launching):

1. **Galaxy Database** — Select which database represents galaxies. Each record in this database will become a distinct galaxy in the universe. The dropdown lists all databases found in the graph, with record count shown.
2. **Star Database** — Select which database represents stars. Stars will be distributed inside galaxies based on their relation field pointing to a galaxy record.
3. **Planet Database** — Select which database represents planets. Planets orbit stars based on their relation field.
4. **Moon Database** — Select which database represents moons. Moons orbit planets based on their relation field.

### Optional tiers (can skip; universe launches without them):

5. **Ring / Asteroid Databases** — Multi-select. Each selected database contributes particles. User then sub-selects for each one: "wraps planets (rings)" or "belt around stars (asteroid belt)". Multiple databases can be added.

A prominent **"Launch Universe"** button activates only when all four mandatory tiers are filled. Skipping any required tier shows an inline validation message. The "rings" step shows a **"Skip — no rings"** option.

After any prior launch, the saved configuration is shown with pre-filled selections and the user can click **"Enter Universe"** immediately. A **"Reconfigure"** link lets them change mappings.

The configuration is saved to `data/config.json` under `orreryConfig` and persisted across sessions. A **"Reconfigure Universe"** button in the top control bar lets the user redo this at any time.

---

## Size Calculation

Size is computed per-object using two signals, combined:

```
rawSize = (connectionCount / maxConnectionCount) * 0.6
        + (recordAgeMs / maxAgeMs) * 0.4

finalSize = minSize + rawSize * (maxSize - minSize)
```

- **Connection count** = number of edges in the graph touching that node (more connections → larger)
- **Record age** = how old the record is relative to the oldest record in the same tier (older → larger)
- The 60/40 weighting slightly favors connectivity over age
- `minSize` and `maxSize` are tier-specific constants (moons are always smaller than planets, planets always smaller than stars, etc.) — so the hierarchy is visually unambiguous even for edge cases

There will be natural size variety within each tier. Some planets will be visibly massive, others tiny. Some galaxies will dwarf their neighbors. **This is intentional and desirable.** The universe should feel varied and real, not uniform.

Size extremes are not clamped aggressively — if a node has vastly more connections than its peers, it should look astronomically large relative to them. The data drives the drama.

---

## Galaxy Scale — The Universe View

### What you see on load:
A field of galaxies spread across deep space. Galaxies are separated by vast distances. The camera starts pulled back, looking at the galaxy field. Stars are not individually visible at this scale — galaxies appear as luminous clouds.

The camera is **purely observational** at all scale levels — no first-person walking. The user **drags the screen** to rotate/orbit the view, scrolls to zoom, and clicks to drill in.

### Galaxy Shapes (randomly assigned per galaxy, seeded from record ID for stability):
- **Spiral** — classic two-arm or four-arm spiral, stars arranged along curving arms
- **Barred spiral** — elongated central bar with arms extending from bar ends
- **Elliptical** — smooth oval cloud, stars distributed in an ellipsoidal density gradient
- **Irregular** — no defined shape, chaotic star distribution, clumpy and asymmetric
- **Ring galaxy** — sparse center with a distinct ring of stars around it
- **Lenticular** — disc-shaped but without spiral structure, like a compressed elliptical

Shape is seeded deterministically from the galaxy's record ID — the same galaxy always has the same shape across sessions.

### Galaxy color:
Each galaxy gets a base color derived from the database color assigned to the galaxy-tier database. Individual galaxy hue shifts slightly per record (seeded from record ID) so nearby galaxies look distinct. Color temperature: older galaxies skew warmer (golden/amber), newer galaxies skew cooler (blue-white).

### Galaxy rotation:
Each galaxy rotates very slowly on its own axis (the "up" axis of its disc plane). Rotation speed is proportional to the total number of star records within that galaxy — more records = slightly faster rotation. This gives denser galaxies a sense of greater mass and energy.

### Interaction:
- Camera slowly auto-orbits/drifts — the universe is never static
- Click a galaxy → camera flies into it (zoom-in transition, ~2s smooth lerp)
- While hovering a galaxy: name label appears, size stat tooltip
- Mouse drag → orbit camera around the universe center
- Scroll → zoom in/out

---

## Star Scale — Inside a Galaxy

### What you see after entering a galaxy:
Stars distributed according to the galaxy's shape (spiral arms, elliptical blob, etc.). Stars glow — warm yellow/white/blue/orange depending on their size (larger stars = hotter = bluer; smaller = cooler = more orange/red — follows stellar classification loosely). Planets are not individually visible at this scale.

### Star colors by size (approximate):
| Star size (relative) | Color |
|---|---|
| Very large | Blue-white (`#a8d8ff`) |
| Large | White-yellow (`#fff5cc`) |
| Medium | Yellow-orange (`#ffd580`) |
| Small | Orange-red (`#ff8c42`) |
| Tiny | Deep red (`#cc4400`) |

Stars pulse very gently (breathing glow animation, subtle scale oscillation, ~0.05 amplitude). Stars glow with a soft bloom/halo — they should look like actual stars, not flat dots.

### Orbital motion within a galaxy:
Stars orbit the galaxy center along their own paths. Stars closer to the galactic center orbit faster; outer stars orbit slower (approximating galactic rotation curves — inner fast, outer slow). All orbits are roughly coplanar with the galaxy disc plane, with small random inclination offsets per star (±10–20°) for visual depth. Orbit paths are slightly elliptical.

### Interaction:
- Click a star → camera flies into that star's solar system (zoom-in transition)
- Hover a star → name label + "X planets" count
- Back button (or press Escape) → camera pulls back to universe view
- Mouse drag → orbit camera around galaxy center
- Scroll → zoom in/out

---

## Planet Scale — Inside a Solar System

### What you see after selecting a star:
The star at the center, glowing and pulsing. Planets orbit it on clearly visible orbital rings (thin, low-opacity lines — same color as the planet, so each orbit is distinct). Moons are not individually visible unless you zoom close to a specific planet.

### Planet variety:
Each planet gets a visual type seeded from its record ID:
- **Rocky** — grey/brown/rust, irregular surface texture (bumpmapped sphere)
- **Gas giant** — banded stripes (Jupiter-like), large, smooth, may have visible ring disc
- **Ocean world** — deep blue, smooth, with white polar caps
- **Desert** — orange/tan, dry-looking, no ice
- **Ice giant** — pale blue/white, slightly translucent rim glow
- **Lava world** — dark with glowing orange cracks (emissive texture detail)
- **Jungle world** — deep green/teal with cloud wisps (rarer variant)

Planet size follows the size calculation above. Gas giants and large planets may have visible ring systems (from the ring databases). Visual type and size are independent — you can have a tiny gas giant or an enormous rocky world.

### Orbital mechanics:
- All planets orbit in the same plane (the ecliptic), with small random inclination per planet (±5–15°) for visual variety
- Orbital speed follows an approximation of Kepler's third law: closer planets orbit faster, outer planets orbit slower
- Orbital radius is proportional to planet index (1st, 2nd, 3rd planet from star) with small random offset per planet for natural spacing
- Orbits are slightly elliptical (eccentricity seeded from record ID, range 0.05–0.25) — not perfect circles
- All orbital motion uses delta-time so speed is frame-rate independent

### Asteroid belts:
If ring/asteroid databases are configured as "star-level belts," a visible asteroid belt appears between the inner and outer planets. Individual particles (small irregular meshes using `InstancedMesh`) slowly orbit the star as a group, with slight individual velocity variations so the belt shimmers and rotates. The belt plane is slightly tilted from the ecliptic for visual interest.

### Interaction:
- Click a planet → camera zooms in to that planet, moons become visible
- Hover a planet → name label + "X moons" count + visual type
- Back → returns to galaxy (star) view
- Mouse drag → orbit camera around the star
- Scroll → zoom in/out

---

## Moon Scale — Around a Planet

### What you see after selecting a planet:
The planet fills more of the screen. Moons orbit it visibly at varied distances. If the planet has ring databases assigned, a disc of ring particles wraps around the planet's equator. Moons range from small grey rocks to larger, more varied spheres depending on their size calculation. The parent star is visible in the background as a bright point light source.

### Moon variety (visual type seeded from record ID):
- **Crater-covered rocky moon** — grey, detailed surface
- **Smooth icy moon** — white/pale blue, clean sphere
- **Volcanic moon** — dark, orange-glow veins
- **Dusty moon** — tan/rust, matte surface
- **Tidally locked face** — one hemisphere slightly different color (lighter/darker side)

### Ring system:
If ring databases are assigned to this planet tier, ring particles are rendered as a flat disc of small instanced meshes — varying sizes, slightly transparent, catching the star's light from off-screen. Ring color is derived from the ring database's assigned color. The ring disc is tilted slightly relative to the planet's equator for realism.

### Interaction:
- Click a moon → detail panel slides in from the right (same `NodeDetailsPanel` component used across all modes)
- Connection arcs appear between the selected moon and any related nodes (may cross to other planets/stars)
- Hover a moon → name label
- Back → returns to planet's solar system view
- Mouse drag → orbit camera around the planet
- Scroll → zoom in/out

---

## Camera & Navigation

### Camera model:
- Purely **observational** — no first-person walking, no WASD movement
- At each scale level, the camera orbits around the focal point (universe center, galaxy center, star, planet)
- **Mouse drag** → rotate the camera around the focal point (orbit controls, like Three.js `OrbitControls`)
- **Scroll wheel** → zoom in/out (with min/max clamps per scale level)
- **Click** → select / drill down into next scale
- **Escape or Back button** → go up one scale level

### Auto-orbit:
When idle (no mouse interaction for 4+ seconds), the camera slowly auto-orbits the current focal point. Interrupted instantly on any user input. This keeps the view alive and prevents the "dead screen" look. Auto-orbit speed is gentle — barely perceptible drift.

### Transition animations:
- Scale transitions (universe → galaxy → solar system → planet) use a smooth 2-second camera lerp
- Optional brief "warp" particle effect or motion blur during zoom-in transition (subtle — don't overdo it)
- No hard cuts — everything is a smooth journey through space
- When drilling in, objects at the new scale fade in as the camera arrives (not instant pop-in)

### Navigation history:
The app tracks which galaxy → which star → which planet was selected, so pressing Escape or clicking breadcrumb segments restores the previous view correctly (camera returns to prior focal point at prior zoom level).

---

## UI & Panels

The Orrery uses the **exact same UI shell** as The Sphere, The City, The Mountain, and The Line — same visual language, same components where reusable, same CSS variables.

- **Top-right control bar** — mode switcher, sync button, settings
- **DatabaseTogglePanel** — slides in from right; in the Orrery this shows the tier configuration (which database is mapped to which tier) rather than a simple toggle list. Databases used in the configuration are shown with their tier label (Galaxy, Star, Planet, Moon, Ring). Non-orrery databases are listed below as inactive.
- **NodeDetailsPanel** — slides in from right when a node (moon, planet, or star) is selected. Same component, no changes needed.
- **SettingsPanel** — same settings panel used elsewhere (dark mode, sync controls, etc.)
- Theme: respects `data-theme` / CSS custom properties (`var(--accent-warm)`, etc.) exactly like other modes
- Fonts: Lora for labels, DM Mono for stats/coordinates, Geist for UI chrome

### Orrery-specific UI additions:
- **Scale breadcrumb** — top-left: `Universe → Andromeda Galaxy → Sol → Earth` — updates as you drill in. Each segment is clickable to navigate back to that level.
- **Orbital speed control** — bottom-center, small slider to scale all orbital speeds (0.1x to 5x). Default 1x. Sits unobtrusively at the bottom, same style as other bottom controls in the app.
- **Pause button** — freezes all orbital motion; useful for reading labels without things moving. Appears next to the speed slider.
- **"Reconfigure Universe" button** — in the top control bar, reopens the Universe Builder overlay.
- **Object info HUD** — when hovering any cosmic object, a small HUD (bottom-left, same style as the graph's info overlays) shows: Name, Database, Tier, Connection count, Record age, Size (relative to tier).

---

## Visual Aesthetic

The Orrery aesthetic is **real space**, not mechanical clockwork. Think NASA imagery meets a data visualization — photorealistic enough to feel like space, but clearly a data tool:

- **Deep space background:** Near-black (`#05060d`), with a procedurally scattered background star field (thousands of tiny white/blue points at varying opacity, size, and brightness). These background stars parallax-shift very slightly as the camera moves — giving a sense of true depth.
- **Nebula wisps:** Very subtle, low-opacity colored fog patches in the background (blues, purples, faint magentas, amber tones near dense galaxies) — purely decorative, adds depth and atmosphere. Rendered as large low-opacity plane meshes with soft radial gradient textures.
- **Stars:** Glowing spheres with a soft bloom/glow shader — no hard edges. Stars should look like they emit light, not just be colored balls.
- **Planets:** Phong-shaded spheres with per-type texture/color variations; slight atmospheric rim glow for gas giants and ocean worlds; emissive detail for lava worlds.
- **Orbital rings:** Thin, low-opacity lines in the planet/moon's assigned color — visible but not distracting. They help the user understand the orbital plane.
- **Labels:** White text, DM Mono, small — appear on hover, fade in/out smoothly with 200ms transition. Never overlap each other if possible.
- **Selection highlight:** Warm amber outline glow on selected objects (`var(--accent-warm)`).
- **Connection arcs:** Same glowing arc style used in The Sphere — animated dash lines between related nodes when a node is selected. These can span across scale (e.g., a planet might arc to a record in another database).

The universe should look **varied and alive**. No two galaxies should look alike. No two solar systems should feel identical. The visual variety — galaxy shapes, planet types, star colors, moon surfaces — is what makes the mode worth exploring.

The palette intentionally contrasts with The Sphere (which has a more abstract, graph-theory feel). The Orrery is immersive, spatial, and cinematic.

---

## Data Mapping Summary

| Cosmic Entity | Size | Color | Orbit Speed | Shape/Type |
|---|---|---|---|---|
| Galaxy | Connection count + age | Database color (with per-record hue shift) | Slow rotation: record count (more = faster) | Spiral / Barred / Elliptical / Irregular / Ring / Lenticular (seeded from record ID) |
| Star | Connection count + age | Stellar class by size (blue-white → deep red) | Galactic orbit: inner faster, outer slower | Glowing sphere with bloom + pulse |
| Planet | Connection count + age | Visual type by record ID | Kepler approx: inner fast, outer slow; slight ellipses | Rocky / Gas / Ocean / Desert / Ice / Lava / Jungle (seeded) |
| Moon | Connection count + age | Visual type by record ID | Proportional to distance from planet | Cratered / Icy / Volcanic / Dusty / Tidally locked (seeded) |
| Ring particles | N/A (instanced small meshes) | Ring database color | Group orbit + individual variation | Small irregular instanced meshes |
| Asteroid belt | N/A (instanced small meshes) | Belt database color | Slow group orbit around star | Mixed-size instanced irregular meshes |

---

## Key Differences from Existing Modes

| Feature | The Orrery | Other Modes |
|---|---|---|
| User configures the hierarchy | Yes — Universe Builder on first load | No — hierarchy is fixed |
| Multi-scale navigation | Yes — universe → galaxy → solar system → planet | No — single level |
| Continuous orbital animation | Yes — everything always moves | Mountain/Graph are static |
| Camera model | Observational orbit (drag to rotate, scroll to zoom, click to drill in) | City = first-person WASD; Graph = drag-rotate sphere |
| Procedurally varied shapes | Yes — 6 galaxy shapes, 7 planet types, 5 moon types | No |
| Scale indicator / breadcrumb | Yes | No |
| First-load configuration wizard | Yes — must map databases to tiers | No |
| Size reflects data meaning | Yes — connections + age → object scale | Partial in other modes |

---

## Files to Create

```
app/project-orrery/
  page.tsx                    # Server component — loads graph + config, renders OrreryScreen

components/
  ProjectOrreryScreen.tsx     # Main client component — same shell pattern as ProjectGraphScreen
  OrreryCanvas.tsx            # Three.js canvas — all 3D rendering
  OrreryUniverseBuilder.tsx   # First-load config overlay (tier → database mapping)
  OrreryBreadcrumb.tsx        # Scale indicator (Universe → Galaxy → Star → Planet)
  OrrerySpeedControl.tsx      # Orbital speed slider + pause button
  OrreryTierPanel.tsx         # DatabaseTogglePanel variant showing tier mappings (if existing panel is insufficient)

lib/
  orreryLayout.ts             # Pure functions: orbital radii, speeds, sizes, galaxy shapes
  orreryConfig.ts             # Config types + read/write helpers for orreryConfig in config.json
  orreryTypes.ts              # OrreryConfig, TierMapping, CosmicObject types

app/api/orrery-config/
  route.ts                    # GET + POST for orreryConfig in data/config.json

data/
  (no new files — orreryConfig stored inside existing config.json)
```

---

## Implementation Task List

### Phase 1 — Foundation & Config

- [ ] **1.1** Define `OrreryConfig` and `TierMapping` types in `lib/orreryTypes.ts` — galaxy/star/planet/moon/ring database IDs, tier assignments, ring sub-type (planet-rings vs star-belt)
- [ ] **1.2** Add `orreryConfig` optional field to `AppConfig` in `lib/types.ts`
- [ ] **1.3** Create `lib/orreryConfig.ts` — read/write helpers, validation that required tiers are filled
- [ ] **1.4** Create `app/api/orrery-config/route.ts` — GET and POST endpoint to read/write orrery config from `data/config.json`
- [ ] **1.5** Create `app/project-orrery/page.tsx` — server component matching pattern of `project-city/page.tsx`, passes `graphData`, `config`, and `databases` as props to `ProjectOrreryScreen`
- [ ] **1.6** Add the Orrery route to the mode navigation/switcher component so it appears in the top nav bar alongside other modes

### Phase 2 — Universe Builder Overlay

- [ ] **2.1** Create `OrreryUniverseBuilder.tsx` — full-screen modal overlay, shown when `orreryConfig` is null or "Reconfigure" is clicked
- [ ] **2.2** Implement step-by-step tier selection UI (Galaxy → Star → Planet → Moon) using dropdown selects populated from available databases in graph data, showing record count per database
- [ ] **2.3** Validate that all four mandatory tiers are selected before enabling "Launch Universe" button; show inline validation messages for unfilled tiers
- [ ] **2.4** Add ring/belt step as optional; each selected database gets a sub-toggle: "Planet rings" vs "Star asteroid belt"; include "Skip — no rings" option
- [ ] **2.5** On submit: POST config to API route, close overlay, trigger canvas render
- [ ] **2.6** If existing config present: pre-fill dropdowns with saved values and show "Enter Universe" as primary CTA; "Reconfigure" as secondary link
- [ ] **2.7** Style the overlay consistently with app UI shell — `var(--bg-primary)`, `var(--accent-warm)`, DM Mono font, same button styles as other panels

### Phase 3 — Layout Engine

- [ ] **3.1** Create `lib/orreryLayout.ts` with pure layout functions (no Three.js imports — only math/geometry)
- [ ] **3.2** Implement `computeSize(node, allNodesInTier, tierConstants)` — connection count + age weighted formula, clamped to tier min/max
- [ ] **3.3** Implement `assignGalaxyShape(galaxyId)` — seeded deterministic pick from 6 shape types, return shape descriptor used by renderer
- [ ] **3.4** Implement `distributeStarsInGalaxy(stars, galaxyShape)` — returns 3D positions for each star based on galaxy shape (spiral arms, ellipsoidal distribution, random for irregular, ring ring)
- [ ] **3.5** Implement `computeOrbitalParams(objects)` — returns orbital radius, angular speed, inclination offset, eccentricity per object; inner objects faster (Kepler approximation)
- [ ] **3.6** Implement `assignPlanetType(planetId)` — seeded deterministic pick from 7 planet visual types
- [ ] **3.7** Implement `assignMoonType(moonId)` — seeded deterministic pick from 5 moon visual types
- [ ] **3.8** Implement `assignStarColor(normalizedSize)` — returns hex color from stellar classification table (blue-white to deep red range)
- [ ] **3.9** Implement `assignGalaxyColor(baseColor, recordId)` — shifts hue slightly per record, adjusts temperature by age (older = warmer)
- [ ] **3.10** Implement `distributeGalaxies(galaxies)` — positions galaxies in universe space with sufficient separation, no clustering, uses stable seeded positions

### Phase 4 — Three.js Canvas (Universe Scale)

- [ ] **4.1** Create `OrreryCanvas.tsx` with basic Three.js scene setup (scene, PerspectiveCamera, WebGLRenderer, animation loop using `requestAnimationFrame` with delta time)
- [ ] **4.2** Implement deep space background: near-black clear color (`#05060d`) + procedural background star field (instanced `Points`, thousands of small dots at varying size/opacity/color temperature)
- [ ] **4.3** Add nebula wisp patches: large low-opacity `PlaneGeometry` meshes with radial gradient textures scattered in background (blues, purples, ambers)
- [ ] **4.4** Render galaxies as luminous cloud meshes using `Points` with shape-appropriate star distribution (spiral, elliptical, etc.); at universe scale these look like glowing clouds
- [ ] **4.5** Implement per-galaxy slow rotation animation around galaxy's "up" axis; rotation speed derived from record count within that galaxy
- [ ] **4.6** Implement auto-orbit camera (starts after 4s idle, stops instantly on any user interaction); gentle drift
- [ ] **4.7** Add `OrbitControls` (from Three.js examples) for mouse drag to rotate, scroll to zoom at universe scale
- [ ] **4.8** Implement raycasting for galaxy click — detect click on galaxy mesh, trigger zoom-in transition to galaxy scale
- [ ] **4.9** Implement hover detection for galaxies — show name label + size tooltip on hover
- [ ] **4.10** Add parallax background star shift — background star field shifts very slightly opposite to camera movement direction

### Phase 5 — Three.js Canvas (Galaxy Scale)

- [ ] **5.1** Implement galaxy drill-in camera transition (smooth 2s lerp to galaxy center, fade out universe objects, fade in star meshes)
- [ ] **5.2** Render individual stars as glowing spheres (`SphereGeometry` + `MeshStandardMaterial` with emissive property) with point light contribution or bloom post-processing
- [ ] **5.3** Apply stellar color by normalized size using `assignStarColor()` — blue-white for large, deep red for tiny
- [ ] **5.4** Implement star gentle pulse animation — slow scale oscillation (~0.05 amplitude, ~3–5s period, seeded phase offset per star)
- [ ] **5.5** Implement star orbital animation within galaxy — each star moves along its orbit path; inner stars faster, outer slower; delta-time based
- [ ] **5.6** Implement star hover labels (CSS overlay positioned by projecting 3D position to screen space) — "Name — X planets"
- [ ] **5.7** Implement star click → solar system drill-in transition
- [ ] **5.8** Implement back/Escape to return to universe scale

### Phase 6 — Three.js Canvas (Solar System Scale)

- [ ] **6.1** Implement solar system drill-in camera transition from galaxy scale
- [ ] **6.2** Render central star prominently (large glowing sphere with `PointLight`, strong bloom, pulsing glow)
- [ ] **6.3** Render orbital rings as thin `Line` circles for each planet — low opacity, colored to match planet, visible but not distracting
- [ ] **6.4** Render planets as `SphereGeometry` with per-type material: rocky (bumped), gas (banded stripes), ocean (blue + polar caps), desert (sandy), ice (pale translucent rim), lava (dark + emissive cracks), jungle (deep green)
- [ ] **6.5** Implement planet orbital animation: each planet advances along its elliptical orbit per frame using delta time; inner planets faster (Kepler approximation)
- [ ] **6.6** Implement asteroid belt rendering if belt databases configured: `InstancedMesh` of small irregular meshes orbiting star between inner/outer planets, slight per-particle speed variation so belt shimmers
- [ ] **6.7** Implement planet hover labels — "Name — X moons — [Planet Type]"
- [ ] **6.8** Implement planet click → planet drill-in transition
- [ ] **6.9** Implement back/Escape to return to galaxy scale

### Phase 7 — Three.js Canvas (Planet Scale)

- [ ] **7.1** Implement planet drill-in camera transition from solar system scale
- [ ] **7.2** Render planet prominently as large sphere with atmospheric rim glow (`ShaderMaterial` or rim-light trick with `MeshPhongMaterial` and back-face emissive)
- [ ] **7.3** Render moons as smaller spheres orbiting planet; per-type materials matching moon type (cratered, icy, volcanic, dusty)
- [ ] **7.4** Implement moon orbital animation — delta-time based, each moon at its own radius and speed; inner moons faster
- [ ] **7.5** Render planet ring system if ring databases assigned: `InstancedMesh` flat disc of small particles in ring plane; slight inclination offset; ring database color; semi-transparent
- [ ] **7.6** Implement moon hover labels — moon name
- [ ] **7.7** Implement moon click → open `NodeDetailsPanel` (reuse existing component), render connection arcs to related nodes in the same glowing animated-dash style as The Sphere
- [ ] **7.8** Implement connection arc rendering between selected moon and its related nodes (arcs may need to indicate cross-tier connections with a label)
- [ ] **7.9** Render parent star as a bright point of light in the background (distant, directional light source)
- [ ] **7.10** Implement back/Escape to return to solar system scale

### Phase 8 — UI Shell & Panels

- [ ] **8.1** Create `ProjectOrreryScreen.tsx` — client component matching pattern of `ProjectGraphScreen.tsx`; manages scale state, selected entities, and wires together all sub-components
- [ ] **8.2** Integrate `NodeDetailsPanel` — reuse existing component without modifications; pass selected moon/planet/star node data
- [ ] **8.3** Integrate or adapt `DatabaseTogglePanel` to show tier-to-database mapping (Galaxy → [DB name], Star → [DB name], etc.); if existing panel is too rigid, create `OrreryTierPanel.tsx` with the same slide-in-from-right behavior
- [ ] **8.4** Integrate `SettingsPanel` — reuse existing component without modifications
- [ ] **8.5** Create `OrreryBreadcrumb.tsx` — top-left breadcrumb showing full navigation path (Universe → Galaxy name → Star name → Planet name); each segment clickable to navigate back to that level; fade in/out as scale changes
- [ ] **8.6** Create `OrrerySpeedControl.tsx` — bottom-center; horizontal slider input (0.1x–5x, default 1x) + pause/play toggle button; passes speed multiplier to `OrreryCanvas` via callback prop or forwarded ref
- [ ] **8.7** Add "Reconfigure Universe" button to top control bar (opens `OrreryUniverseBuilder` overlay in reconfigure mode)
- [ ] **8.8** Implement object info HUD — bottom-left panel (same style as graph info overlays); shown on hover; displays: Name, Tier (Galaxy/Star/Planet/Moon), Database name, Connection count, Record age, Relative size
- [ ] **8.9** Add "Enter Orrery" route to the top nav mode switcher so users can navigate to `/project-orrery`

### Phase 9 — Navigation & State

- [ ] **9.1** Implement scale state machine in `ProjectOrreryScreen`: states = `universe | galaxy | solar-system | planet`; each state stores the selected entity (galaxy ID, star ID, planet ID)
- [ ] **9.2** Implement Escape key handler — go up one scale level from current state
- [ ] **9.3** Implement back navigation via breadcrumb clicks — clicking any breadcrumb segment navigates directly to that scale level
- [ ] **9.4** Persist selected navigation path in component state (galaxy → star → planet) so back navigation returns camera to correct focal point at correct zoom level
- [ ] **9.5** Ensure camera min/max zoom clamps reset correctly on each scale transition (universe scale = very far; planet scale = close-in)
- [ ] **9.6** Debounce hover detection (avoid label flicker when cursor moves between objects rapidly)

### Phase 10 — Polish & Performance

- [ ] **10.1** Add bloom/glow post-processing (`three/examples/jsm/postprocessing/EffectComposer`, `UnrealBloomPass`) for stars, galaxy cores, lava worlds, selection highlights
- [ ] **10.2** Verify all ring particles and asteroid belt particles use `InstancedMesh` — not individual mesh objects — for performance
- [ ] **10.3** Implement level-of-detail (LOD): at universe scale galaxies are `Points` clusters (cheap); individual star/planet meshes are only created after drilling into that galaxy/solar system
- [ ] **10.4** Verify all orbital animations use delta time (not frame count) — test at 30fps and 120fps to confirm consistent speed
- [ ] **10.5** Add `Suspense` / loading indicator for async data loads between scale transitions
- [ ] **10.6** Profile with 100+ nodes per tier — verify 60fps target maintained; reduce geometry complexity or LOD thresholds if needed
- [ ] **10.7** Verify CSS custom property variables apply correctly to all UI chrome (breadcrumb, HUD, speed control, panels)
- [ ] **10.8** Dispose Three.js geometries, materials, and textures when navigating between scales (prevent memory leaks on long sessions)
- [ ] **10.9** Add brief "warp" camera effect (motion blur or particle streak) during scale drill-in transitions for cinematic feel
- [ ] **10.10** Test keyboard navigation: Escape at each level, breadcrumb clicks, panel open/close, pause toggle

---

## Open Questions (Resolved)

| Question | Decision |
|---|---|
| What is the "sun"? | User-selected — the Star database defines stars; no single fixed sun |
| How is hierarchy determined? | Notion relation fields discovered from graph edges |
| Mechanical vs real-space aesthetic? | Real space — cinematic, not brass clockwork |
| Is pedestal/gimbal needed? | No — full space environment, no implied pedestal |
| Orbital speed basis? | Stars: by galactic radius. Planets: Kepler approximation. Moons: by planet distance |
| Can rings span multiple databases? | Yes — ring tier is multi-select |
| Camera model? | Observational orbit only — drag to rotate, scroll to zoom, click to drill in; no WASD |
| UI consistency? | Must match Sphere/City/Mountain/Timeline — same panels, same CSS vars, same fonts |
| Size extremes? | Not clamped aggressively — let the data create dramatic size differences |

---

*Document created: 2026-03-21*
*Document enhanced: 2026-03-22*
*Status: Active — ready for implementation*
