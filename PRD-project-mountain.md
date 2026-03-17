# Project Mountain — PRD

**Status:** Design — not yet implemented
**Date:** 2026-03-15
**Builds on:** Project City (CityCanvas, cityLayout.ts, ProjectCityScreen.tsx)

---

## 1. What Is Project Mountain?

Project Mountain is a third view mode for the Data Visualizer home screen, alongside Project Graph and Project City. It renders the same Notion graph data as a **3D mountain landscape** rather than a city skyline.

The key visual metaphor shift:

| Project City | Project Mountain |
|---|---|
| Each node = a building with its own footprint | Each node = a peak belonging to a shared mountain range |
| Databases form cohort districts | Databases form distinct mountain ranges |
| Buildings stand apart from each other | Peaks share a continuous ridge baseline |
| Height = activity freshness | Peak height = activity freshness (same formula) |
| Width = connection degree | Ridge spread = connection degree (same formula) |

The result is an organic, geological landscape where **each Notion database is its own mountain range**, and **each record within that database is a distinct peak** rising from a shared base.

---

## 2. Core Visual Concept

### 2.1 One Mountain Range Per Database

Every enabled database gets exactly one mountain range. The ranges are arranged across the terrain so they don't overlap — each is its own geographic feature.

Within a range, all nodes (records) from that database share a **common crescent-shaped base ridge**. The crescent stretches along a curve so the peaks feel like they're erupting from the same geological formation, not standing on individual pedestals.

### 2.2 Crescent Layout Within a Range

Peaks within each range are placed along a **curved arc** (a partial circle / crescent shape) rather than on a straight line or grid:

```
Arc formula for node i in a range of N nodes:
  θ_i = arcStart + i * arcSpread / (N - 1)  (spread across the arc)
  r    = baseRadius (scales with sqrt(N) so bigger ranges have wider arcs)
  x_i  = rangeCenterX + r * cos(θ_i)
  z_i  = rangeCenterZ + r * sin(θ_i)
```

- **`arcSpread`**: ~100–160° of arc (not a full circle). When viewed top-down, the range looks like a gentle curve — not a straight line, not a full ring. The concave side of the arc faces inward. This is what gives each range the feel of a natural ridgeline rather than a row of separate peaks.
- **`arcStart`**: seeded-random per database ID so different ranges face different directions. All ranges follow the same crescent-curve shape, just oriented differently — creating natural terrain variety across the full landscape.
- Peaks are sorted by degree before placement: most-connected nodes go near the center of the crescent (the "summit ridge"), least-connected go to the horns

### 2.3 Jitter

Every peak gets a **seeded positional jitter** after arc placement:

```
jitterX = (seededRandom(nodeId + "jx") - 0.5) * jitterMagnitude
jitterZ = (seededRandom(nodeId + "jz") - 0.5) * jitterMagnitude
jitterMagnitude = arcSpacing * 0.35
```

Jitter scales inversely with widthScale (taller, more important peaks drift less). This breaks the mechanical regularity and makes the crescent look like a natural ridge rather than a perfect arc.

### 2.4 The Shared Base — Continuous Ridge Geometry

The defining visual difference from the city: **peaks share a raised base ridge** rather than resting on flat ground.

The base is rendered as a **smooth terrain mesh** that connects all the peaks in a range — imagine a spine of rock that the individual summits grow from:

- Base height at the ridge center: ~30% of the tallest peak in that range
- Base tapers smoothly to ground level at the edges (toward the ends of the crescent horns)
- Lateral taper: at the sides of each peak, the ridge slopes down to meet adjacent peaks or taper off
- The base mesh is colored the same hue as the database color, slightly desaturated and darker than the peaks

This is the geometry that makes it feel like a mountain range rather than a row of separate pyramids.

### 2.5 Peak Shape

Each peak is rendered as a **low-poly cone or irregular pyramid**:

- Geometry: `THREE.ConeGeometry(radius, height, 5–7 sides)` — the low poly count (pentagon or hexagon base) gives peaks a natural, faceted feel
- The cone sits on the shared base ridge, its base center at (cx, ridgeHeightAtX, cz)
- A small random Y-rotation (seeded) per peak so facets don't all align
- Color: same as the database `node.color`, with slight per-peak luminance variation (±8%) seeded from node ID so peaks in the same range look naturally lit from the same source

### 2.6 Range Arrangement in World Space

Ranges are placed across the world terrain using a **force-spread layout**:

- Each range gets an initial position based on a seeded hash of its database ID
- A repulsion pass spreads ranges apart so they don't overlap (similar to the city's overlap prevention)
- Range bounding radius = `sqrt(nodesInRange) * MOUNTAIN_CELL_SIZE * 0.7`
- After placement, ranges should have natural separation, like mountain ranges visible across a valley

---

## 3. Data → Visual Mappings

| Visual Property | Data Source | Formula |
|---|---|---|
| **Peak height** | Freshness of connected nodes | Same as city: exponential decay avg, λ=0.008, normalized to [MIN_H, MAX_H] |
| **Cone base radius** | Number of connections (degree) | `1 + 2 * sqrt(degree / maxDegree)` — same sqrt scaling as city width |
| **Arc position in crescent** | Sort rank by degree within database | Most-connected near crescent center, least-connected at horns |
| **Jitter** | Node ID (seeded) | ±35% of arc spacing, inversely scaled with widthScale |
| **Peak color** | Database type | Same palette: `node.color` with ±8% luminance variation |
| **Ridge base color** | Database type | Same hue, 60% saturation, 50% brightness of peak color |
| **Range position** | Database ID (seeded) | Force-spread across terrain |

### 3.1 Height Semantics (same as city)

```
For each connected neighbor:
  recency(neighbor) = e^(-0.008 * ageInDays(neighbor))

freshness(node) = mean(recency of all neighbors)
               = 0.5 if no connections (neutral baseline)

// Normalize across all nodes in scene, then:
height = MIN_H + normalizedFreshness * (MAX_H - MIN_H)
  MIN_H = 1.2
  MAX_H = 16.0
```

Three-tier `createdTime` fallback (identical to city):
1. Node's own `createdTime`
2. Oldest connected neighbor's `createdTime`
3. Default: `2025-11-01T00:00:00Z`

---

## 4. Camera Modes (Matching City)

Project Mountain inherits all camera modes from the city:

| Mode | Description |
|---|---|
| **Overhead orbit** | Default. Drag to orbit, scroll to zoom, right-drag to pan. |
| **Hike** | First-person WASD + mouse-look. Camera starts at ground level (Y=1.8) but the terrain is not flat — the hike mode should follow the ridge topography, rising and falling as you move over ridges and between ranges. You can look up and see surrounding peaks. |
| **Flyover** | Cinematic arc camera flying between selected peaks — arcing over and between mountain summits, giving a true aerial view of the ranges. |

All mode transitions, animations, and control mechanics are identical to Project City with the following renamed labels:
- "street view" button → **"hike"**
- HUD hint overlay: `[WASD] move   [mouse] look   [ESC] exit hike`

The hike camera height should follow simplified terrain elevation — sample the ridge height at the current (x, z) position and set camera Y = sampledRidgeHeight + 1.8. This means walking over a ridge will naturally arc the player upward and back down, and from the top of a ridge you can see other ranges in the distance.

---

## 5. Labels

Labels work identically to the city:

- **Overhead labels**: off by default, toggle in settings
- **Hike labels**: on by default in first-person, toggle in settings
- **Click labels**: node name appears above peak when clicked
- **Flyover labels**: none / overhead / center modes, same as city
- **Range labels**: database name floats above each mountain range at ~1.5× the tallest peak's height. Always billboard-facing. Toggle on/off in settings (on by default). These are distinct from node-level peak labels.
- Label position for peaks: centered above the peak tip

---

## 6. UI Shell (Matches City)

The ProjectMountainScreen component mirrors ProjectCityScreen nearly 1:1:

- Top-left wordmark: "Project Mountain" + subtitle "explore your terrain"
- Same database toggle panel (DatabaseTogglePanel — reused directly)
- Same node details panel (NodeDetailsPanel — reused directly)
- Settings dropdown: same structure as city but with mountain-specific additions (see below)
- Same bottom stats bar (nodes / edges / sync time)
- Same bottom-right controls: **"hike"** button (was "street view"), flyover, controls hint
- Same keyboard shortcuts: Q = database panel, E = details panel
- Same empty state fade (placeholder: use existing `/PimaryIcon.png` or `/CityLightMode.png` until MountainIcon.png is ready)
- Route: `/project-mountain`

**Settings dropdown additions vs city:**
- Settings label "Building Labels" → **"Peak Labels"**
- "Street view" toggle → **"Hike"** toggle
- New toggle: **"Range Labels"** — show/hide the per-database floating name labels (on by default)
- `localStorage` key prefix: `mountain_` (e.g. `mountain_flyover_speed`, `mountain_range_labels`)

---

## 7. Home Screen Tile

Add a third `ModeTile` on `app/page.tsx`:

```
href:        /project-mountain
title:       Project Mountain
subtitle:    explore your terrain
description: See your Notion data as mountain ranges — each database a ridge,
             each record a peak.
icon:        /MountainIcon.png  (placeholder: use /PimaryIcon.png until ready)
```

The `MountainIcon.png` will be provided externally by the user and dropped into `/public`. Use `/PimaryIcon.png` as a placeholder in all UI until then.

The tiles grid on the home screen flexes horizontally; with three tiles it should still read cleanly. On mobile (≤640px) they already stack vertically.

---

## 8. New Files to Create

| File | Purpose |
|---|---|
| `lib/mountainLayout.ts` | Layout engine: crescent placement, ridge geometry data, peak positions |
| `components/MountainCanvas.tsx` | Three.js renderer: cone peaks, ridge mesh, labels, camera modes |
| `components/ProjectMountainScreen.tsx` | Screen shell (mirrors ProjectCityScreen) |
| `app/project-mountain/page.tsx` | Next.js route (mirrors app/project-city/page.tsx) |
| `public/MountainIcon.png` | Home screen tile icon (to be designed) |

---

## 9. Reused Without Modification

These existing files are used as-is, no changes needed:

| File | How It's Reused |
|---|---|
| `components/DatabaseTogglePanel.tsx` | Exact reuse |
| `components/NodeDetailsPanel.tsx` | Exact reuse |
| `lib/types.ts` | GraphData, GraphNode, NodeDetail — no new types needed |
| `/api/graph`, `/api/schemas`, `/api/field-config` | Same API endpoints |

---

## 10. mountainLayout.ts — Key Types & Exports

```typescript
export type MountainRange = {
  databaseId:   string;
  databaseName: string;
  color:        string;
  centerX:      number;
  centerZ:      number;
  arcStart:     number;   // radians — where the crescent begins
  arcSpread:    number;   // radians — total arc width (~100–160°)
  baseRadius:   number;   // distance from range center to arc
  ridgeHeight:  number;   // height of shared base at ridge crest
};

export type MountainNode = GraphNode & {
  cx:           number;   // world X — center of peak base
  cz:           number;   // world Z — center of peak base
  peakY:        number;   // Y of peak tip (= ridgeHeight + coneHeight)
  coneHeight:   number;   // height of the cone above the ridge
  coneRadius:   number;   // base radius of the cone
  degree:       number;
  rangeIndex:   number;   // which range this peak belongs to
};

export function computeMountainLayout(data: GraphData): {
  nodes:  MountainNode[];
  ranges: MountainRange[];
};
```

---

## 11. MountainCanvas.tsx — Rendering Notes

### 11.1 Ridge Mesh Construction

For each `MountainRange`, build a terrain strip mesh:

1. Sample M points along the crescent arc (M ≈ max(nodeCount * 2, 12))
2. For each sample point, compute ridge height using a smooth falloff from the ridge center:
   ```
   ridgeHeightAt(t) = ridgeHeight * sin(π * t)^0.5
   // t = normalized position along arc [0, 1]
   // 0 at horns, 1 at midpoint
   ```
3. Build a `BufferGeometry` strip: each arc sample contributes two vertices — one at the base (Y=0) and one at ridge height. Connect strips with triangle faces.
4. Apply `MeshStandardMaterial` with the range's ridge base color.

### 11.2 Peak Cones

For each `MountainNode`:
```typescript
const geo = new THREE.ConeGeometry(
  node.coneRadius,        // base radius
  node.coneHeight,        // height
  6,                      // radialSegments — hexagonal base
  1,                      // heightSegments
);
// Random Y rotation (seeded from node.id)
const mesh = new THREE.Mesh(geo, material);
mesh.position.set(node.cx, node.peakY - node.coneHeight / 2, node.cz);
```

Highlight behavior (on click):
- Selected peak: full color, emissive glow
- Non-selected peaks in same range: dim to 40% opacity
- Peaks in other ranges: dim to 20% opacity
- Ridge mesh follows same dimming as its peaks

### 11.3 Ground Plane

Same as the city: a large flat `PlaneGeometry` at Y=0, matching dark/light mode colors.

### 11.4 Connection Lines

On peak selection, draw lines from the selected peak's tip to each connected peer's tip (rather than base-to-base as in the city — tip-to-tip looks more natural for mountain peaks). Same color and opacity as the city's connection lines.

---

## 12. Implementation Task List

### Phase M1 — Layout Engine (`lib/mountainLayout.ts`)
- [ ] Group nodes by `databaseId` into ranges
- [ ] Assign a seeded `arcStart` and `arcSpread` per database
- [ ] Compute `baseRadius` proportional to `sqrt(nodeCount)`
- [ ] Sort nodes by degree within each range (most-connected to crescent center)
- [ ] Place node positions along arc + apply seeded jitter
- [ ] Compute `ridgeHeight` per range (30% of max peak height in range)
- [ ] Compute `coneHeight` per node using same freshness formula as city
- [ ] Compute `coneRadius` per node using same degree formula as city
- [ ] Force-spread range centers so ranges don't overlap
- [ ] Overlap prevention pass for individual peaks within ranges
- [ ] Export `computeMountainLayout(data)` returning `{ nodes, ranges }`

### Phase M2 — Renderer (`components/MountainCanvas.tsx`)
- [ ] Scaffold component from CityCanvas (copy, then adapt)
- [ ] Replace city building geometry with cone + ridge strip geometry
- [ ] Build `MountainRange` ridge mesh per range (with `castShadow` + `receiveShadow`)
- [ ] Build `MountainNode` cone mesh per node (with `castShadow` + `receiveShadow`)
- [ ] Enable `renderer.shadowMap.enabled = true` + directional light with shadow
- [ ] Apply seeded Y-rotation per cone
- [ ] Per-peak luminance variation (±8%)
- [ ] Raycasting for click selection (target cone meshes)
- [ ] Highlight / dim logic on selection
- [ ] Connection lines tip-to-tip on selection
- [ ] Peak labels (billboard sprites above peak tip)
- [ ] Range labels (database name billboard at 1.5× tallest peak, toggled by `showRangeLabels`)
- [ ] Ground plane (receives shadows)
- [ ] Orbit controls (overhead mode)
- [ ] Hike mode: WASD + mouse-look, camera Y follows `sampleTerrainHeight(x, z) + 1.8`
- [ ] `sampleTerrainHeight(x, z)`: sample ridge meshes to get elevation at any world XZ position
- [ ] Flyover arc camera (arcs over and between summits)
- [ ] Fit-scene camera framing
- [ ] Dark/light mode material switching
- [ ] Flyover label modes (none / overhead / center)

### Phase M3 — Screen Shell (`components/ProjectMountainScreen.tsx`)
- [ ] Clone ProjectCityScreen.tsx → ProjectMountainScreen.tsx
- [ ] Swap CityCanvas → MountainCanvas
- [ ] Update wordmark text ("Project Mountain") and icon (placeholder: PimaryIcon.png)
- [ ] Rename "Street View" button → "Hike"
- [ ] Update settings label "Building Labels" → "Peak Labels"
- [ ] Add "Range Labels" toggle to settings (on by default, `mountain_range_labels` in localStorage)
- [ ] localStorage key prefix: `mountain_` (vs `city_`)
- [ ] Wire up all existing panels (DatabaseTogglePanel, NodeDetailsPanel)
- [ ] Update HUD hint: `[WASD] move   [mouse] look   [ESC] exit hike`

### Phase M4 — Route (`app/project-mountain/page.tsx`)
- [ ] Clone app/project-city/page.tsx → app/project-mountain/page.tsx
- [ ] Swap ProjectCityScreen → ProjectMountainScreen

### Phase M5 — Home Screen Tile
- [ ] Add MountainIcon.png to `/public`
- [ ] Add ModeTile for `/project-mountain` in `app/page.tsx`

---

## 13. Open Questions — Resolved

| # | Question | Decision |
|---|---|---|
| 1 | Should "street view" be renamed in the mountain context? | **Yes — renamed to "Hike".** Camera follows terrain elevation so you physically walk over ridges and can see other ranges in the distance. |
| 2 | Should the ridge mesh cast/receive shadows? | **Yes** — enable `renderer.shadowMap` and shadow-capable materials. Proceed assuming acceptable performance; fall back to no-shadow if framerate degrades. |
| 3 | How many `radialSegments` on the cone? | **6 (hexagonal base)** — provides a natural, crystalline, faceted mountain look. |
| 4 | Should connection lines go peak-tip to peak-tip or base to base? | **Tip to tip** — feels like sight-lines between summits. |
| 5 | Should ranges be labeled? | **Yes, with a toggle.** Range name floats at ~1.5× tallest peak height, billboard-facing, on by default. Toggle in settings under "Range Labels". |
| 6 | Should the crescent face a fixed direction or random? | **Random per database (seeded arcStart)** — all ranges follow the same crescent curve shape but face different directions, creating natural terrain variety when viewed top-down. |
| 7 | What if a database has only 1 node? | **Single isolated peak** at range center. Slightly smaller than average — no crescent geometry needed for one node. |
| 8 | What icon to use for the home tile? | **User will supply `MountainIcon.png`** and drop it into `/public`. Use `/PimaryIcon.png` as placeholder until then. |

---

## 14. Things That Are Identical to the City

- Database color palette and per-database color assignment
- DatabaseTogglePanel behavior and API
- NodeDetailsPanel behavior and API
- Freshness / height formula (λ=0.008, MIN_H=1.2, MAX_H=16.0)
- Width/radius degree formula (`1 + 2 * sqrt(degree / maxDegree)`)
- Three-tier `createdTime` fallback
- Flyover camera arc logic
- WASD first-person controls
- Label billboard system
- Dark/light mode CSS variables
- Stats bar (nodes / edges / sync)
- Settings dropdown structure
- Keyboard shortcuts (Q, E)
- Animation on entry (`animate-fade-up`)
- Empty state (icon fades in when no databases enabled)
