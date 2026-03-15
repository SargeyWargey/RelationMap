# PRD: Project City — 3D Data Cityscape Visualization

**Status:** Draft
**Date:** 2026-03-14
**Replaces placeholder in:** `components/ProjectCityScreen.tsx`

---

## 1. Overview

Project City is an alternate visualization mode that renders your Notion graph as a 3D cityscape. Every node becomes a building — a transparent cube or rectangular prism rising from a flat ground plane. The taller the building, the more connections that node has. Related nodes cluster near each other. The result is a navigable miniature city you can pan, rotate, and zoom like Google Maps in 3D.

This mode lives at `/project-city` and shares the same data pipeline (`GraphData`, `GraphNode`, `GraphEdge`) and color system as the existing Graph view.

---

## 2. Goals

| Goal | Measure |
|------|---------|
| Make connectivity legible at a glance via building height | Tallest buildings = most connected nodes |
| Spatially cluster related nodes | Nodes sharing edges placed in proximity |
| Zero visual clutter in the default view | No connection lines rendered unless a node is selected |
| Smooth 3D camera navigation | Pan, orbit, zoom all feel responsive |
| Visual consistency with Graph view | Same database color palette |

---

## 3. Non-Goals

- No physics simulation / force-directed layout (layout is computed once, statically)
- No animated node movement after initial placement
- No labels on connection lines (edges are just highlight lines when visible)
- No support for the existing sphere/horse/seven shape layouts — this is its own mode

---

## 4. Data Model (unchanged)

Reuses the existing types from `lib/types.ts`:

```
GraphNode  { id, name, databaseId, color, ... }
GraphEdge  { id, source, target, relationName }
GraphData  { nodes[], edges[] }
```

New derived data computed at layout time:

```ts
type CityNode = GraphNode & {
  cx: number;       // world X position (center of building base)
  cz: number;       // world Z position (center of building base)
  height: number;   // building height in world units
  degree: number;   // number of edges connected to this node
};
```

---

## 5. Visual Design

### 5.1 Buildings

- **Base:** Square footprint, uniform size. Suggested world unit: `1.0 × 1.0`.
- **Height:** Scaled proportionally to the node's connection count (degree).
  - Minimum height: `0.3` (isolated or single-connection nodes)
  - Maximum height: `8.0` (most connected node in the dataset)
  - Formula: `height = MIN_H + (degree / maxDegree) * (MAX_H - MIN_H)`
- **Style:** Wireframe edges rendered in the node's database color (solid, full opacity). Faces filled with the same color at low transparency (`~10–15% opacity`). This gives the classic "holographic city block" look.
- **No roof detail** — flat top, simple box.

### 5.2 Ground Plane

- Flat infinite-feeling plane rendered beneath all buildings.
- Dark mode: near-black (`#0a0a0f`) with a subtle grid.
- Light mode: off-white (`#f2f0eb`) with a subtle grid.
- Grid lines: very faint, spaced to match the building footprint unit.

### 5.3 Color Scheme

- Each database retains its assigned color (same source as Graph view: `node.color`).
- Edges (wireframe lines) use the database color at full opacity.
- Face fill uses the database color at ~12% opacity.
- When a node is selected: its building edges go to 100% opacity + brighten. Unrelated buildings dim to ~20% opacity. Connected buildings highlight to ~80% opacity.
- Connection lines between selected node and its neighbors: thin bright lines drawn at ground level, from the center-bottom of the selected building to the center-bottom of each connected building (Y = 0, XZ plane only). Colored neutral (`white` in dark mode, `charcoal` in light mode).

### 5.4 Labels

- Each building shows its node name as a billboard text label floating just above the roofline.
- Font: `DM Mono`, small (10–12px equivalent in world space).
- Default: visible only above a zoom threshold (labels fade in as you zoom in).
- Selected node: label always shown, slightly larger.

---

## 6. Layout Algorithm

The layout is computed once when the graph data loads. No live physics.

### 6.1 Strategy: Force-Relaxed Grid

A grid-based placement with force relaxation to cluster related nodes:

1. **Initial placement:** Assign each node to a grid cell. Sort nodes by degree (most connected first) and place them from center outward (spiral order) so well-connected nodes occupy the "downtown" area.

2. **Clustering pass (optional refinement):** Run ~50 iterations of a simple 2D force:
   - Attraction between nodes that share an edge (pull toward each other)
   - Repulsion between all node pairs (keep separation)
   - Grid-snap at end to prevent fractional positions

3. **No-overlap guarantee:** After placement, enforce that no two buildings share the same grid cell. Use a simple collision resolution pass (shift conflicting nodes to nearest free cell).

4. **Spacing:** Each building occupies a `1×1` cell. Alley width between buildings: `0.5` units on each side → effective cell size is `2×2` (1 building + 0.5 gap on each side).

### 6.2 Centering

After all nodes are placed, translate the entire layout so the centroid is at world origin `(0, 0)`.

---

## 7. Camera & Controls

### 7.1 Camera Type

Perspective camera with configurable FOV (~60°). Initial position: elevated and slightly tilted looking toward city center — roughly `(0, 20, 30)` looking at `(0, 0, 0)`.

### 7.2 Controls (Google Maps 3D style)

| Action | Input |
|--------|-------|
| **Orbit / Rotate** | Left-click drag (rotate around the target point) |
| **Pan** | Right-click drag OR middle-click drag (translate camera + target on the ground plane) |
| **Zoom** | Scroll wheel (dolly in/out) |
| **Tilt reset** | Double-click on ground |
| **Focus node** | Click a building (camera smoothly moves to frame that building) |

Constraints:
- Min elevation angle: 5° above horizon (can't go underground)
- Max elevation angle: 89° (bird's-eye view allowed)
- Min zoom distance: 2 units (can get very close to a building)
- Max zoom distance: 200 units (can zoom far out to see whole city)

### 7.3 Smooth Transitions

When clicking a node to select it, the camera eases toward a good viewing position for that building over ~600ms.

---

## 8. Interaction Model

### 8.1 Default State (no selection)

- All buildings rendered with their database color (wireframe + transparent fill).
- No connection lines visible.
- Hovering a building: slight brightness increase on that building's edges.
- Cursor: default pointer over ground, pointer over buildings.

### 8.2 Node Selected

Triggered by clicking a building.

1. Selected building: full brightness, slightly enlarged wireframe (or emissive glow on edges).
2. Connected buildings: highlighted color, moderate opacity.
3. All other buildings: dimmed to ~20% opacity.
4. Connection lines: drawn between selected node and all directly connected nodes. Lines run at ground level — from the XZ center of the selected building's base to the XZ center of each connected building's base (Y = 0). Thin (`1–2px`), colored neutral (white/light gray in dark mode).
5. A Node Details Panel slides in (same component as Graph view: `NodeDetailsPanel`).
6. Clicking ground or pressing Escape: deselects, restores all buildings to default state.

### 8.3 Database Toggles

Same database enable/disable panel as Graph view. Toggling a database removes/adds those buildings from the scene. Layout recomputes for the active set.

---

## 9. Rendering Architecture

### 9.1 Technology: Three.js

The existing Graph view uses raw canvas + custom quaternion math. Project City has significantly more geometry complexity (box geometry, transparency, edge wireframes, camera orbiting). **Recommend adding Three.js** for this feature.

- Package: `three` + `@types/three`
- No React wrapper library (react-three-fiber) needed — mount Three.js directly into a `<canvas>` ref inside the component, similar to how `GraphCanvas.tsx` works today.

### 9.2 Scene Structure

```
Scene
├── DirectionalLight (subtle, from above)
├── AmbientLight (low intensity)
├── GroundPlane (PlaneGeometry, large, receives shadows)
├── GridHelper (matches alley spacing)
└── CityGroup
    └── BuildingGroup[n] (one per node)
        ├── BoxGeometry (faces — transparent fill)
        └── EdgesGeometry (wireframe edges — solid color)
```

### 9.3 Materials

- **Face material:** `MeshBasicMaterial` with `transparent: true`, `opacity: 0.12`, `color: nodeColor`, `side: THREE.DoubleSide`
- **Edge material:** `LineBasicMaterial` with `color: nodeColor`, `linewidth: 1` (note: linewidth >1 requires `LineSegments2` from Three.js examples for WebGL2)
- **Connection lines:** `Line` objects added to scene on selection, removed on deselection

### 9.4 Labels

- `CSS2DRenderer` from Three.js for DOM-based labels (avoids texture baking complexity).
- Labels are `<div>` elements positioned in 3D space.
- Font: `DM Mono`, size 11px.

---

## 10. Component Structure

```
app/project-city/page.tsx          — existing page (no change needed)
components/ProjectCityScreen.tsx   — shell (UI chrome, panels, data fetch)
components/CityCanvas.tsx          — NEW: Three.js scene + camera + interaction
lib/cityLayout.ts                  — NEW: layout algorithm (grid + force relaxation)
lib/cityTypes.ts                   — NEW: CityNode type and layout output types
```

`ProjectCityScreen` handles the same data flow as `GraphScreen`:
- Database toggles
- Field config / filters
- Node selection → `NodeDetailsPanel`
- Dark mode

`CityCanvas` receives `graph: GraphData` and `selectedNodeId` as props, owns the Three.js lifecycle (init, resize, animate, dispose).

`cityLayout.ts` is a pure function: `(nodes, edges) => CityNode[]` — no Three.js dependency, easily testable.

---

## 11. Performance Considerations

- **Instanced meshes:** If node count exceeds ~200, use `InstancedMesh` for the box faces to reduce draw calls.
- **Frustum culling:** Three.js handles this automatically.
- **Label throttling:** CSS2DRenderer can get expensive with many labels — only render labels for visible buildings within a distance threshold.
- **Layout caching:** Cache the computed `CityNode[]` layout keyed by the set of active node IDs. Avoid recomputing on every render.

---

## 12. UI Chrome (inherited from Graph view)

These elements carry over unchanged:

- Top-left: RelationCity wordmark + "Project City" label, click to go home
- Top-right: Dark mode toggle
- Left panel: Database toggles (same `DatabaseTogglePanel`)
- Right panel: Node details (`NodeDetailsPanel`, slides in on selection)
- Bottom or top: "Last synced" timestamp

New elements:
- Bottom-right: Minimap (optional, v2) — small top-down orthographic view showing the full city footprint with camera viewport indicator.

---

## 13. Open Questions

| # | Question | Default assumption |
|---|----------|--------------------|
| 1 | Should height encode degree or some other metric (e.g. a user-selectable field)? | Degree (connection count) for v1; make it configurable in v2 |
| 2 | Should connection lines appear at ground level (streets) or arc above buildings? | Straight lines slightly elevated above ground plane |
| 3 | Should clusters be visually delineated (e.g. faint district zones)? | No, v1 keeps it simple |
| 4 | Should the camera auto-fit the whole city on load? | Yes, fit-all on initial load |
| 5 | Should database filter toggles trigger an animated add/remove of buildings? | Instant removal v1, animate v2 |
| 6 | Maximum recommended node count before performance degrades? | Target smooth performance up to 500 nodes |

---

## 14. Acceptance Criteria

- [ ] Every active node renders as a 3D box on the ground plane with correct height proportional to its degree
- [ ] No two buildings overlap
- [ ] Alley spacing is visually consistent between all buildings
- [ ] Buildings use the same database color as Graph view
- [ ] Camera supports orbit, pan, zoom with the constraints defined in §7.2
- [ ] Default view shows zero connection lines
- [ ] Clicking a building highlights it, dims others, and shows connections to neighbors
- [ ] `NodeDetailsPanel` opens correctly on selection
- [ ] Clicking ground or pressing Escape deselects
- [ ] Database toggle panel works (enable/disable databases → buildings appear/disappear)
- [ ] Dark mode toggle works
- [ ] Scene is responsive (canvas resizes with window)
- [ ] No Three.js memory leaks on component unmount (geometries, materials, renderers disposed)

---

## 15. Implementation Phases

### Phase 1 — Static City (no interaction)
- Add Three.js dependency
- `cityLayout.ts`: pure grid layout, no force relaxation
- `CityCanvas.tsx`: render buildings + ground plane + camera orbit
- Basic camera controls (orbit + zoom only)

### Phase 2 — Interaction & Polish
- Node click → selection, highlight, connection lines
- `NodeDetailsPanel` integration
- Camera ease-to-node on selection
- Labels via CSS2DRenderer
- Pan control
- Force relaxation in layout

### Phase 3 — Performance & Features
- Instanced meshes for large graphs
- Label distance culling
- Database toggle animations
- Configurable height metric
- Minimap (optional)
