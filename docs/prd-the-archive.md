# PRD: The Archive
### A 3D Library Visualization Mode for RelationMap

---

## Overview

**Codename:** The Archive
**Route:** `/project-archive`
**Tagline:** Walk through your knowledge base as a candlelit library.

The Archive renders your Notion workspace as a first-person, explorable 3D library. Each database becomes a named wing or aisle; each record becomes a book on the shelf. The physical properties of each book — height, thickness, color, glow — encode the underlying data. Users navigate on foot through organized knowledge, discovering connections between books as glowing threads of light.

This is the only mode in RelationMap that directly mirrors what Notion *is* — a structured knowledge base — through a physical architectural metaphor.

---

## Goals

- Provide a spatially intuitive way to browse Notion records organized by database
- Make density, freshness, and connectivity immediately readable without reading labels
- Extend the established first-person navigation pattern (City, Mountain) into an intimate interior space
- Deliver a visually cohesive aesthetic: warm amber candlelight, dark wood shelves, soft book-spine glow

---

## Non-Goals

- Not a replacement for The City — City is exterior/civic, Archive is interior/intimate
- Not a graph view — connections are secondary, discoverable only on selection
- No editing or writing back to Notion from this view
- No multiplayer or shared state

---

## Data Mapping

| Data Field | Visual Encoding |
|---|---|
| Database name | Aisle/wing label + section divider |
| Database color | Book spine color (with warm tint overlay) |
| Node name | Book spine title text (vertical) |
| Connection degree | Book thickness (spine depth: 0.5cm–4cm) |
| Data freshness (created time) | Book height (taller = more recent) |
| Field values (Status, Owner, etc.) | Shown in floating "open book" panel on selection |
| Connections (edges) | Glowing threads between selected book and its neighbors |
| Created by | Author label on book spine (small, below title) |

---

## Visual Design

### Palette & Atmosphere
- Background: Near-black (`#1A1A1A`) for dark mode; warm parchment (`#F0EBE0`) for light
- Ambient light: warm amber point lights every ~8 units along shelf tops
- Book spine glow: each database color, 20% emissive, subtle pulse on hover
- Connection threads: `var(--accent-warm)` orange, semi-transparent, bezier curves
- Floor: dark wood plank texture (Three.js procedural or simple tiled geometry)
- Ceiling: coffered, slightly out of focus (depth of field effect optional)

### Typography
- Book spine titles: Lora (serif), rotated 90°, size proportional to book height
- Section headers: DM Mono, uppercase, mounted above each aisle entrance
- Open-book panel: Geist body text, Lora headings

### Shelf Layout
- Shelves are 5 units tall, 40 units long, double-sided (books face both directions)
- Each aisle: two parallel shelves with ~4 unit walkway between
- Aisles arranged in a grid (3 columns × N rows based on database count)
- Grand entrance hall at origin: open space with index/directory kiosk
- Each database gets its own labeled aisle — excess databases wrap to new rows

### Book Geometry
- Books are `BoxGeometry`: width = 0.8 (fixed), height = 1.5–4.0 (freshness), depth = 0.3–2.5 (degree)
- Spine face: colored material with title label (Canvas texture)
- Top/bottom/sides: slightly darker wood texture
- Books are packed tightly with 0.05 unit gap between them
- Slight random tilt (±2°) for organic feel

### Camera & Movement
- First-person camera, eye height 1.6 units
- WASD movement, mouse look (pointer lock)
- Sprint: Shift key (2× speed)
- No jump, no gravity — smooth floor-level navigation
- Collision: cannot pass through shelf geometry
- Optional: overhead map view (Tab key toggle) for library navigation

---

## Interaction Design

### Navigation
| Input | Action |
|---|---|
| WASD | Move forward/back/strafe |
| Mouse | Look direction (pointer lock) |
| Shift | Sprint (2× speed) |
| Tab | Toggle overhead map view |
| Escape | Release pointer lock / close panel |
| Click | Select book (opens detail panel) |
| Hover | Book highlights, title brightens |

### Book Selection
1. Hover: spine brightens, cursor changes to pointer
2. Click: book animates forward 0.5 units off shelf ("pulled out")
3. Panel slides in from right: open-book UI showing all Notion field values
4. Connected books: glowing threads appear from selected book to all related books (across aisles if needed)
5. Click away or Escape: book returns to shelf, panel closes

### Directory Kiosk (Entrance Hall)
- Central podium at library entrance
- Lists all databases (aisles) with node count and color swatch
- Click a database name → camera smoothly navigates to that aisle entrance
- Search field: type a node name → camera navigates to that book, highlights it

### Open-Book Detail Panel
- Slides in from right (same interaction pattern as other modes)
- Shows: Node name (heading), database, all field values, Notion URL link
- "Connected to" section: list of linked nodes, click to navigate to them
- Close button top-right

---

## Technical Architecture

### New Files

```
app/project-archive/
  page.tsx                  # Server component — loads graph.json, passes to client
  layout.tsx                # (optional) metadata

components/
  ArchiveCanvas.tsx          # Main Three.js canvas — ~800-1200 lines expected
  ArchiveBookPanel.tsx       # Right-side detail panel (selected node)
  ArchiveDirectoryKiosk.tsx  # Entrance hall search/navigation UI
  ArchiveOverheadMap.tsx     # Optional top-down minimap overlay

lib/
  archiveLayout.ts           # Pure layout function: nodes → shelf positions
```

### Modified Files

```
app/page.tsx (or nav component)  # Add Archive to navigation links
components/NavBar.tsx            # Add /project-archive link + icon
```

### Key Dependencies
- Three.js (already installed) — geometry, materials, lighting, raycasting
- React (existing pattern) — UI panels overlay canvas
- No new npm packages required

---

## Layout Algorithm (`archiveLayout.ts`)

```typescript
// Input: GraphNode[], GraphEdge[]
// Output: Map<nodeId, { x, y, z, aisle, shelfIndex, bookIndex }>

function computeArchiveLayout(nodes: GraphNode[], edges: GraphEdge[]) {
  // 1. Group nodes by databaseId
  // 2. Sort each group by createdTime DESC (freshest first, at aisle entrance)
  // 3. Assign aisle positions in grid:
  //    - Aisle width = 4 units (walkway)
  //    - Aisle depth = 40 units (shelf length)
  //    - Aisle rows wrap at 3 columns
  // 4. Pack books along shelf within aisle:
  //    - bookDepth = lerp(0.3, 2.5, normalizedDegree)
  //    - bookHeight = lerp(1.5, 4.0, normalizedFreshness)
  //    - x = cumulativeWidth + bookDepth/2 + 0.05 padding
  // 5. Return flat map of positions
}
```

### Degree Normalization
- Per-database normalization (not global) so thin databases aren't all flat
- Clamp to [0, 1] range, apply sqrt scaling (same as City pattern)

### Freshness Normalization
- Same exponential decay formula as Mountain mode (`mountainLayout.ts`)
- Reuse existing `computeFreshness()` utility

---

## ArchiveCanvas.tsx — Component Structure

```
ArchiveCanvas
├── Scene setup
│   ├── PerspectiveCamera (FOV 75, near 0.1, far 200)
│   ├── AmbientLight (warm, low intensity)
│   ├── PointLights (amber, along shelf tops, instanced)
│   └── Fog (warm, density 0.02, for depth atmosphere)
├── Geometry
│   ├── Floor (PlaneGeometry, wood-colored material)
│   ├── Ceiling (PlaneGeometry, darker)
│   ├── Shelves (BoxGeometry per shelf unit, repeated)
│   ├── Books (InstancedMesh for performance — one mesh per database)
│   └── Section signs (SpriteText or Canvas texture above aisles)
├── Interaction
│   ├── PointerLock controls
│   ├── Raycaster (book hover + click)
│   ├── Collision detection (AABB vs shelf bounds)
│   └── Smooth camera transitions (for kiosk navigation)
├── Selection state
│   ├── Selected book → pull-out animation (lerp)
│   ├── Connected edges → THREE.Line with bezier points
│   └── Neighbor highlights (emissive pulse)
└── UI overlays (React portals)
    ├── ArchiveBookPanel (right panel)
    ├── ArchiveDirectoryKiosk (entrance)
    └── ArchiveOverheadMap (Tab toggle)
```

### Performance Notes
- Use `InstancedMesh` for books — potentially 500–2000 nodes, instancing is essential
- Canvas textures for book spine labels — generate once, cache by node ID
- Frustum culling enabled (Three.js default) — books behind camera not rendered
- LOD: beyond 30 units, omit spine text rendering

---

## Navigation Entry Point

Add to the main navigation alongside existing modes:

```tsx
{ href: '/project-archive', label: 'The Archive', icon: BookIcon }
```

Include in the mode switcher component (same pattern as existing mode nav).

---

## Task List

### Phase 1: Foundation & Layout

- [ ] **T-01** Create `app/project-archive/page.tsx` — server component loading `graph.json`, passing data to client canvas
- [ ] **T-02** Create `lib/archiveLayout.ts` — pure layout function grouping nodes by database, packing books along shelves, computing aisle grid positions
- [ ] **T-03** Write unit tests / console verification for layout output (node count, position bounds, no overlaps)
- [ ] **T-04** Create `components/ArchiveCanvas.tsx` skeleton — Three.js scene setup, camera, basic lighting, render loop
- [ ] **T-05** Render floor and ceiling geometry with appropriate materials
- [ ] **T-06** Render shelf geometry (BoxGeometry per aisle, per shelf unit) in correct grid positions

### Phase 2: Books

- [ ] **T-07** Implement `InstancedMesh` for books — one mesh per database color group
- [ ] **T-08** Set per-instance transform from layout output (position, scale for height/depth)
- [ ] **T-09** Generate Canvas-texture book spine labels (node name, author/createdBy) — cache by node ID
- [ ] **T-10** Apply spine texture to correct face of each book instance
- [ ] **T-11** Add slight random tilt (±2°) per book using seeded random (same seed as node ID for stability)
- [ ] **T-12** Add emissive glow to book spines (20% database color)

### Phase 3: Lighting & Atmosphere

- [ ] **T-13** Add warm ambient light (low intensity)
- [ ] **T-14** Add instanced PointLights along shelf tops (amber, every 8 units)
- [ ] **T-15** Add distance fog (warm tint, density 0.02)
- [ ] **T-16** Add section signs above aisle entrances (Canvas texture labels, database name)
- [ ] **T-17** Light/dark mode switching — update materials and fog color on theme change

### Phase 4: First-Person Navigation

- [ ] **T-18** Implement PointerLock controls (click canvas to lock, Escape to unlock)
- [ ] **T-19** WASD movement with configurable speed (default 5 units/s)
- [ ] **T-20** Shift-to-sprint (2× speed)
- [ ] **T-21** AABB collision detection against shelf geometry bounds (prevent passing through)
- [ ] **T-22** Clamp camera Y to floor level (no flying)
- [ ] **T-23** Add Tab key to toggle overhead map view (camera smoothly transitions up to top-down)

### Phase 5: Selection & Detail Panel

- [ ] **T-24** Implement raycasting for book hover (highlight on hover — emissive pulse)
- [ ] **T-25** Implement raycasting for book click — identify which node was selected
- [ ] **T-26** Animate selected book forward off shelf (lerp 0.5 units toward camera, 300ms)
- [ ] **T-27** Render connection edges (THREE.Line, bezier, `var(--accent-warm)`) from selected book to all connected books
- [ ] **T-28** Highlight neighbor books (emissive pulse on connected nodes)
- [ ] **T-29** Create `components/ArchiveBookPanel.tsx` — right-side slide-in panel with full node field values
- [ ] **T-30** Add Notion URL link in panel (opens in new tab)
- [ ] **T-31** "Connected to" section in panel — clickable list, clicking navigates camera to that book
- [ ] **T-32** Deselect on click-away or Escape — animate book back to shelf, close panel, clear edges

### Phase 6: Directory Kiosk

- [ ] **T-33** Create entrance hall geometry (open area at library origin, podium mesh)
- [ ] **T-34** Create `components/ArchiveDirectoryKiosk.tsx` — UI panel listing all databases with count + color swatch
- [ ] **T-35** Click database in kiosk → smooth camera transition to that aisle entrance
- [ ] **T-36** Search field in kiosk — filter by node name, navigate to matching book on select
- [ ] **T-37** Kiosk visible only near entrance (fade out as user walks away)

### Phase 7: Overhead Map

- [ ] **T-38** Create `components/ArchiveOverheadMap.tsx` — top-down minimap overlay (Tab toggle)
- [ ] **T-39** Render aisle footprints as colored rectangles labeled with database names
- [ ] **T-40** Show player position dot on map
- [ ] **T-41** Click location on overhead map → navigate camera to that position
- [ ] **T-42** Smooth transition between first-person and overhead view

### Phase 8: Navigation Integration

- [ ] **T-43** Add `/project-archive` route to main navigation bar with Archive/book icon
- [ ] **T-44** Add to mode switcher component (same UI pattern as existing modes)
- [ ] **T-45** Ensure data loading pattern matches other pages (server component → client canvas props)

### Phase 9: Polish & Performance

- [ ] **T-46** LOD: suppress spine label rendering for books > 30 units from camera
- [ ] **T-47** Frustum culling verification — confirm distant aisles not bottlenecking render
- [ ] **T-48** Animate camera smoothly on first load (dolly in from entrance)
- [ ] **T-49** Add subtle ambient particle dust (floating motes in amber light — optional, toggle off on low perf)
- [ ] **T-50** Light/dark mode full pass — verify all materials, fog, and UI panels respond correctly
- [ ] **T-51** Mobile/touch fallback (graceful degradation — static view if no pointer lock)
- [ ] **T-52** Performance budget check: target 60fps with 1000+ book instances

### Phase 10: QA

- [ ] **T-53** Test with real `data/graph.json` — verify all databases get aisles, all nodes get books
- [ ] **T-54** Test edge cases: databases with 1 node, databases with 100+ nodes, nodes with 0 connections
- [ ] **T-55** Test selection with nodes that have connections across multiple databases
- [ ] **T-56** Test light/dark mode switch mid-session
- [ ] **T-57** Test `npm run build` passes with no type errors

---

## Success Criteria

- All nodes in `graph.json` are rendered as books — none missing
- First-person navigation feels smooth at 60fps with real data
- Book selection, detail panel, and connection threads work correctly
- Light/dark mode switch updates the scene without reload
- The visual atmosphere reads as a warm, candlelit library — not a generic 3D box viewer
- `npm run build` and `npm run lint` pass with zero errors

---

## Open Questions

1. Should the library have a fixed floor plan or dynamically scale the aisle grid based on database count?
2. Should the entrance kiosk persist as a floating HUD or only appear when the player is near the entrance?
3. Should freshness-based height use the same exponential decay as Mountain, or a linear scale (more readable in this context)?
4. Is ambient audio (page turns, ambient library sounds) in scope?

---

*Document created: 2026-03-21*
*Status: Ready for implementation*
