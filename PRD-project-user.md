# Project User — PRD

**Status:** Design — not yet implemented
**Date:** 2026-03-16
**Builds on:** Project City, Project Mountain (same graph data, DatabaseTogglePanel, NodeDetailsPanel)

---

## 1. What Is Project User?

Project User is a fourth view mode for the Data Visualizer home screen, alongside Project Graph, Project City, and Project Mountain. It renders the same Notion graph data as a **person-centric cylinder carousel**.

The key concept: every person parsed from the workspace data gets their own **horizontal timeline panel**. These panels are wrapped around the surface of a vertical cylinder. The camera is fixed in place; the cylinder rotates vertically (like a Ferris wheel) to bring each person's timeline panel into the forward-facing viewport. The person currently facing the camera is the "active" person — their timeline is fully visible and interactive. Panels above and below are partially visible, giving a sense of depth and continuity.

A record that appears under multiple people's names will show up on **each** of their timelines independently.

---

## 2. The Cylinder Carousel

### 2.1 Geometry

The cylinder's axis runs **horizontally** — the axis arrow points left-to-right (world X). Think of it as a horizontal axle that the cylinder spins around. Each timeline panel is a face on the cylinder's surface, oriented so that when it faces the camera (which is looking straight at the front of the cylinder, along world -Z), the panel's top/bottom align with world Y and the panel's left/right align with world X.

```
         axis (horizontal, world X)
              ←────────────────→
         ┌────────────────────────┐
  ↑   ╱  │  [Person B timeline]  │  ╲
  │ ╱    │                       │    ╲
  Y      │  [Person A timeline]  │  ← front (camera faces this)
  │ ╲    │                       │    ╱
  ↓   ╲  │  [Person C timeline]  │  ╱
         └────────────────────────┘
```

- The cylinder center is at world origin.
- The cylinder radius `R` is chosen so panels are comfortably large in viewport (roughly `R = 600` world units as a starting point — tunable).
- Each panel's width equals the cylinder's axial length (the full left-to-right span of the viewport).
- Each panel's height is `2π * R / N` where `N` is the total number of people — i.e. panels are evenly distributed around the circumference.

### 2.2 Camera

The camera is **fixed** — it does not move, orbit, or pan. It looks straight at the front face of the cylinder along world -Z.

```
Camera position: (0, 0, R + CAMERA_OFFSET)
Camera target:   (0, 0, 0)
Camera type:     THREE.PerspectiveCamera (slight FOV to show edges of active panel)
CAMERA_OFFSET:   ~200 world units in front of the cylinder surface
```

Because the camera never moves, all navigation happens by **rotating the cylinder**, not by moving the viewer.

### 2.3 Rotation (Scrolling Through People)

The cylinder rotates around its horizontal axis (world X) to advance or retreat through people:

- **Scroll up** (or swipe up): cylinder rotates so the next person rotates down into view (i.e. positive X-axis rotation).
- **Scroll down** (or swipe down): cylinder rotates so the previous person rotates up into view (negative X-axis rotation).
- **Snap behavior**: rotation always snaps to align a panel exactly with the camera facing direction. Each scroll event snaps to the next/previous person with an eased animation (`easeInOutCubic`, ~400ms).
- **Arrow key navigation**: Up/Down arrows advance/retreat one person.
- **Person picker**: selecting a name from the left panel immediately rotates the cylinder (shortest path) to that person's panel.

### 2.4 Cylinder Rotation Math

```
anglePerPanel = 2π / N          // angle between adjacent panels
panelAngle(i) = i * anglePerPanel

// Active person index `activeIdx` — cylinder rotation to bring panel i to front:
cylinderRotationX = -activeIdx * anglePerPanel

// World position of panel i's center on the cylinder surface:
panelY = R * sin(cylinderRotationX + panelAngle(i))
panelZ = R * cos(cylinderRotationX + panelAngle(i))
// Panel X remains the full axial width — unchanged by rotation
```

### 2.5 Visibility & Fading

- **Active panel** (at front): full opacity, full color.
- **Adjacent panels** (±1 from active): 60% opacity, slightly desaturated.
- **Further panels** (±2): 25% opacity.
- Panels behind the cylinder (facing away from camera) are hidden or culled.
- A soft vertical gradient vignette is applied to the top and bottom edges of the viewport to reinforce the carousel depth.

---

## 3. The Name Problem — Parsing People from Fields

People are not a first-class field type in the current data model. `GraphNode` has a `name` field and a `fieldValues` map, but a "person" could live in any text, people, select, or relation field depending on the Notion workspace setup.

### 3.1 Name Field Configuration

In the **Database Toggle Panel**, each database gets a new optional setting: **"Name Field"** — the field whose value(s) are treated as person names for Project User.

- The user picks a field from the database's schema.
- Any field type is valid: `title`, `rich_text`, `people`, `select`, `multi_select`, `relation`, or plain text.
- The default (if no field is configured) is the node's `name` (i.e. the Notion title field).
- This setting is stored in `DatabaseFieldConfig` under a new key: `nameField: string | null`.

### 3.2 Multi-Name Parsing

Some fields contain multiple names in a single value. The parser must handle:

| Format | Example raw value | Parsed names |
|---|---|---|
| Comma-separated | `"Alice Smith, Bob Jones"` | `["Alice Smith", "Bob Jones"]` |
| Array value | `["Alice Smith", "Bob Jones"]` | `["Alice Smith", "Bob Jones"]` |
| Single name | `"Alice Smith"` | `["Alice Smith"]` |
| Null / empty | `null` or `""` | *(node not indexed for this person)* |

Parsing rules:
1. If `fieldValues[nameField]` is an array (already split), use it directly.
2. If it is a string, split on `,` and trim each part.
3. Filter out empty strings after trim.
4. Each resulting token is a **person token** — a canonical name string.
5. A record with multiple names appears on **each** person's timeline independently.

### 3.3 Person Index

After parsing, build an in-memory **person index**:

```
personIndex: Map<string, PersonEntry>
  key: lowercased trimmed name ("alice smith")
  value: {
    displayName: string;         // first occurrence of original casing
    nodes: PersonNode[];         // all records across all databases for this person
  }
```

A `PersonNode` carries:
```typescript
type PersonNode = {
  nodeId:       string;
  nodeName:     string;
  databaseId:   string;
  databaseName: string;
  color:        string;
  createdTime:  string;   // after fallback resolution (see §5.2)
  notionUrl:    string;
};
```

---

## 4. Timeline Panel Layout

Each timeline panel on the cylinder surface contains:

### 4.1 Person Spine

A thick horizontal bar running the full width of the panel, vertically centered within the panel. The person's display name and avatar (initials circle, color-hashed) are anchored to the left end.

### 4.2 Document Cards (Branches)

Each record connected to this person appears as a **3D document card** — a shallow `BoxGeometry` — branching off the spine above or below:

- Cards alternate above/below the spine (even index above, odd index below) unless grouped by database (setting).
- Time runs **left = newest, right = oldest**.
- A thin vertical connector line links each card's base to the spine at the card's time position.

### 4.3 Card Geometry

```
width  = 120 world units  (constant)
height = 60 world units   (constant)
depth  = 8 world units    (shallow card)
```

- Face color: the database's assigned color.
- On hover: card lifts +Y, emissive glow.
- On click: card lifts further, `NodeDetailsPanel` opens.
- Stacking: records at nearly the same time position from the same database stack with a Z-offset (newest in front). Click front card to cycle stack.

### 4.4 Card Labels

Record name rendered as an HTML overlay positioned from the projected 3D card center (only for the active panel — adjacent panels show card geometry only, no label overlays, for performance).

### 4.5 Time Axis

Year/month tick marks below the spine. Tick density adjusts to the time spread of this person's records.

---

## 5. Time Axis Detail

### 5.1 Positioning Formula

```
timeRange = maxDate - minDate   (across all records for this person)
margin    = timeRange * 0.1

xPosition(node) =
  PANEL_LEFT_MARGIN +
  (maxDate - node.createdTime) / (timeRange + 2 * margin) * PANEL_USABLE_WIDTH
```

Newest left, oldest right. If a person has only one record, center it.

### 5.2 `createdTime` Fallback

Same three-tier fallback as City/Mountain:
1. Node's own `createdTime`.
2. Oldest connected neighbor's `createdTime`.
3. Default: **`2025-11-02T00:00:00Z`**.

---

## 6. Within-Panel Navigation (Active Panel Only)

Because the camera is fixed and the cylinder handles person navigation, within-panel navigation is handled differently for very wide timelines:

- **Horizontal pan**: drag left/right on the active panel's surface to scroll through time. This translates the panel's content (cards + spine) horizontally within the panel bounds, clamped to content edges.
- **Zoom**: scroll wheel while hovering the active panel zooms the time axis (expands/compresses horizontal spacing). Does NOT trigger cylinder rotation — use vertical scroll outside the active panel, or Up/Down arrows, to rotate the cylinder.
- **Scroll disambiguation**: vertical scroll on the active panel (when not zooming) rotates the cylinder. Horizontal scroll / drag pans within the panel.

---

## 7. Database Filter & Selection

Reuses the existing `DatabaseTogglePanel` with additions:

### 7.1 Database Toggle
Same as all other views — toggling a database on/off shows/hides its records on all timelines.

### 7.2 Name Field Selector (new)
Below each database toggle:
- Dropdown populated from the database's schema fields.
- Default: `(node title)`.
- Changing this field re-parses the person index, rebuilds all panels, and re-rotates to the previously active person (by name match if still present).

### 7.3 Group by Database
Settings toggle: **"Group branches by database"** (`user_group_by_database`, off by default).
- Off: cards alternate above/below by time order.
- On: each database claims a fixed side (seeded by database ID); all cards from that database appear on the same side.

---

## 8. Person Picker Panel

A left-side panel (same `Q` shortcut as other views) lists all people:

- Alphabetically sorted.
- Each row: avatar circle + display name + small database badge(s) showing which DB(s) they appear in + record count.
- Full-text search field at top.
- Clicking a person rotates the cylinder to their panel (shortest-path rotation, eased ~400ms).
- Active person row is highlighted.

---

## 9. UI Shell

`ProjectUserScreen` mirrors `ProjectMountainScreen`:

- Top-left wordmark: **"Project User"** + subtitle **"explore your people"**
- Left panel: `DatabaseTogglePanel` extended + person picker (same panel, Q to toggle)
- Right panel: `NodeDetailsPanel` (E to toggle)
- Settings dropdown:
  - "Database Labels" toggle (on by default, `user_database_labels`)
  - "Group by Database" toggle (off by default, `user_group_by_database`)
- Bottom stats bar: `{n} people · {m} records · last sync {time}`
- Scroll/arrow navigation hint overlay at bottom (fadeable): `[↑↓] navigate people   [drag] scroll timeline   [scroll] zoom`
- Route: `/project-user`
- `localStorage` key prefix: `user_`

---

## 10. Home Screen Tile

Add a fourth `ModeTile` on `app/page.tsx`:

```
href:        /project-user
title:       Project User
subtitle:    explore your people
description: See your Notion data organized around people — scroll through a
             vertical carousel of personal timelines for everyone in your workspace.
icon:        /UserIcon.png  (placeholder: use /PimaryIcon.png until ready)
```

---

## 11. New Files to Create

| File | Purpose |
|---|---|
| `lib/userLayout.ts` | Person index builder, name parser, time-axis layout per panel |
| `components/UserCanvas.tsx` | Three.js renderer: cylinder, panels, cards, spine, camera |
| `components/ProjectUserScreen.tsx` | Screen shell |
| `app/project-user/page.tsx` | Next.js route |
| `public/UserIcon.png` | Home screen tile icon (placeholder: PimaryIcon.png) |

---

## 12. Modified Files

| File | Change |
|---|---|
| `lib/types.ts` | Add `nameField?: string \| null` to `DatabaseFieldConfig` |
| `components/DatabaseTogglePanel.tsx` | Add "Name Field" selector per database |
| `app/page.tsx` | Add `ModeTile` for `/project-user` |

---

## 13. userLayout.ts — Key Types & Exports

```typescript
export type PersonEntry = {
  key:         string;        // lowercased canonical key
  displayName: string;
  panelIndex:  number;        // position on cylinder (alphabetical sort order)
  nodes:       PersonNode[];
};

export type PersonNode = {
  nodeId:       string;
  nodeName:     string;
  databaseId:   string;
  databaseName: string;
  color:        string;
  createdTime:  string;       // after fallback resolution
  notionUrl:    string;
  xPosition:    number;       // computed world X within the panel
  side:         "above" | "below";
  stackIndex:   number;       // 0 = front of stack
};

export function buildPersonIndex(
  data:        GraphData,
  fieldConfig: Record<string, DatabaseFieldConfig>,
  enabledDbs:  Set<string>
): Map<string, PersonEntry>;

export function layoutPersonPanel(
  entry:     PersonEntry,
  groupByDb: boolean
): PersonNode[];
```

---

## 14. UserCanvas.tsx — Rendering Notes

### 14.1 Cylinder & Panel Meshes

The cylinder is not a `THREE.CylinderGeometry` — it is a conceptual grouping. Each panel is a flat `THREE.PlaneGeometry` (or thin `BoxGeometry`) placed at its angular position on the cylinder surface:

```typescript
for (let i = 0; i < N; i++) {
  const angle = (2 * Math.PI / N) * i;
  // Position on cylinder surface (axis = world X, so rotation in Y-Z plane)
  const panelY = R * Math.sin(angle);
  const panelZ = R * Math.cos(angle);
  panel.position.set(0, panelY, panelZ);
  // Rotate the panel to face outward (tangent to cylinder surface)
  panel.rotation.x = angle;
}
```

The entire cylinder group rotates around world X to advance/retreat panels:
```typescript
cylinderGroup.rotation.x = -activeIdx * (2 * Math.PI / N);
```

### 14.2 Document Cards

Same as described in §4.3. Cards are children of their panel's scene group so they rotate with the cylinder automatically.

```typescript
const cardGeo = new THREE.BoxGeometry(120, 60, 8);
const mesh = new THREE.Mesh(cardGeo, new THREE.MeshStandardMaterial({
  color: node.color,
  roughness: 0.4,
  metalness: 0.1,
}));
// Position within panel local space:
mesh.position.set(node.xPosition, side === "above" ? BRANCH_HEIGHT : -BRANCH_HEIGHT, stackIndex * -4);
```

`BRANCH_HEIGHT` ≈ 80–120 world units from spine center.

### 14.3 Connector Lines

`THREE.Line` in panel local space from card bottom-center to spine surface at `xPosition`.

### 14.4 Camera (Fixed)

```typescript
const camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 10000);
camera.position.set(0, 0, R + 200);
camera.lookAt(0, 0, 0);
// Camera never moves. All navigation is cylinder rotation.
```

### 14.5 Cylinder Rotation Animation

On advance/retreat, tween `cylinderGroup.rotation.x` to target angle using `easeInOutCubic` over 400ms. Cancel any in-progress tween on new input.

### 14.6 Opacity / Fading

Set `material.opacity` per panel based on angular distance from the front-facing angle:
```
delta = abs(normalizedAngleDiff(panel.rotation, frontAngle))
opacity = delta === 0 ? 1.0 : delta === 1 ? 0.6 : delta === 2 ? 0.25 : 0
```

### 14.7 Vignette

A full-screen `THREE.Mesh` quad with a radial gradient shader (or a CSS overlay `div`) providing a top/bottom vignette to reinforce carousel depth.

### 14.8 Lighting

- `THREE.AmbientLight` — soft fill.
- `THREE.DirectionalLight` — from slightly above/right, simulating a single overhead source.
- The fixed camera means lighting is always consistent — no need to update light position on camera move.

---

## 15. Implementation Task List

### Phase U1 — Data Layer
- [ ] Add `nameField?: string | null` to `DatabaseFieldConfig` in `lib/types.ts`
- [ ] Implement `parseNamesFromFieldValue(value: string | string[] | null): string[]`
- [ ] Implement `buildPersonIndex(data, fieldConfig, enabledDbs)` — assigns `panelIndex` by alphabetical sort
- [ ] Implement `createdTime` three-tier fallback
- [ ] Implement `layoutPersonPanel(entry, groupByDb)` — assigns `xPosition`, `side`, `stackIndex`
- [ ] Implement time-axis tick generator per panel

### Phase U2 — DatabaseTogglePanel
- [ ] Add "Name Field" dropdown below each database toggle
- [ ] Populate from database schema; default "(node title)"
- [ ] Persist to `DatabaseFieldConfig.nameField`
- [ ] On change: rebuild person index, re-rotate to current person by name

### Phase U3 — Renderer (`UserCanvas.tsx`)
- [ ] Fixed `PerspectiveCamera` setup
- [ ] Build `cylinderGroup` — N panel scene groups at correct angular positions
- [ ] Per-panel: spine mesh, connector lines, card meshes, time axis ticks
- [ ] Cylinder rotation animation (tween, easeInOutCubic, 400ms)
- [ ] Opacity / fade per panel based on angular distance from front
- [ ] Top/bottom vignette overlay
- [ ] Raycasting for card hover + click (active panel only)
- [ ] Card hover lift tween
- [ ] Card click → `NodeDetailsPanel` open
- [ ] Stack click → cycle through stack
- [ ] HTML label overlays for active panel card names (projected from 3D)
- [ ] Time axis tick labels (HTML overlay, active panel only)
- [ ] Horizontal pan within active panel (drag on panel surface → translate panel content X)
- [ ] Zoom within active panel (scroll wheel → scale time axis spacing)
- [ ] Vertical scroll / Up-Down arrows → rotate cylinder
- [ ] Person picker panel: list with avatar, name, DB badges, record count, search
- [ ] Person picker click → rotate cylinder (shortest path) to that person
- [ ] Dark/light mode materials
- [ ] Ambient + directional lighting

### Phase U4 — Screen Shell (`ProjectUserScreen.tsx`)
- [ ] Clone ProjectMountainScreen → ProjectUserScreen
- [ ] Swap canvas → UserCanvas
- [ ] Wordmark: "Project User" / "explore your people"
- [ ] Settings: "Database Labels", "Group by Database"
- [ ] Stats bar: `{n} people · {m} records · last sync {time}`
- [ ] Navigation hint overlay (fadeable)
- [ ] localStorage prefix: `user_`

### Phase U5 — Route
- [ ] `app/project-user/page.tsx`

### Phase U6 — Home Screen Tile
- [ ] Placeholder icon in `/public`
- [ ] `ModeTile` in `app/page.tsx`

---

## 16. Open Questions

| # | Question | Status |
|---|---|---|
| 1 | If N (number of people) is very large (100+), should panels be smaller or should there be a max visible count with virtual scrolling? | Open |
| 2 | Should stacked cards collapse to a count badge or always show as a physical stack? | Open |
| 3 | What happens when no databases have a Name Field configured? | Empty state with prompt to configure in DB panel |
| 4 | Should there be a way to view multiple people side-by-side (parallel spines on one panel)? | Future — out of scope |
| 5 | Should the active panel's spine extend edge-to-edge of the panel or have padding? | Open — likely has horizontal padding (`PANEL_LEFT_MARGIN`) |

---

## 17. Things Reused Without Modification

| File | How It's Reused |
|---|---|
| `components/NodeDetailsPanel.tsx` | Exact reuse |
| `/api/graph`, `/api/schemas`, `/api/field-config` | Same API endpoints |
| Database color palette | Same assignment logic |
| `createdTime` three-tier fallback | Default `2025-11-02T00:00:00Z` |
| Dark/light mode CSS variables | Same system |
| Animation on entry (`animate-fade-up`) | Same |
| Empty state pattern | Same icon fade-in |
