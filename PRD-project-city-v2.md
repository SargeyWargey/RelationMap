# Project City — Enhanced Design Spec (v2)

**Status:** Design — not yet implemented
**Date:** 2026-03-14
**Builds on:** PRD-project-city.md (Phase 1 complete)

---

## 1. Overview of Changes from v1

v1 gave us a working city with uniform grid layout, height = total degree, and orbit camera. v2 rethinks the layout and building semantics to be genuinely meaningful, adds organic city feel, and introduces a first-person street mode.

The core shift: buildings should tell a story about **vitality over time**, not just connectivity count.

---

## 2. Revised Building Semantics

### 2.1 Width = Number of Connections (Degree)

How many edges a node has determines its footprint. A well-connected node earns a wider building — it has more real estate in the city because it touches more things.

- **Minimum width:** 1× base unit (1 connection or zero)
- **Maximum width:** 3× base unit (most-connected node in the dataset)
- **Scale:** Square root of degree, normalized to [1, 3] range

  ```
  widthScale = 1 + 2 * sqrt(degree / maxDegree)
  ```

  Square root is important — without it, the single most-connected node (Projects) would dominate everything and every other building would be tiny. Square root compresses the high end and spreads the middle.

- **Footprint is square:** A 2× building takes a 2×2 cell. Alley width stays constant regardless of building size so wider buildings push their neighbors farther out automatically.

### 2.2 Height = Activity Freshness (Recency of Connected Nodes)

Height no longer measures raw connection count — it measures how recently-created the connected nodes are. This encodes vitality:

- A project with lots of new documents and connections linking to it is **tall** — it's actively growing
- A project with only old stale connections is **short and wide** — established but quieter
- A brand-new node with no connections gets a **medium baseline height**

**Formula:**

```
For each connected neighbor, compute recency:
  recency(neighbor) = e^(-λ * ageInDays(neighbor))
  where λ = 0.003  (half-life ≈ 231 days, ~8 months)

freshness(node) = mean(recency of all neighbors)
               = 1.0 if node has no connections (neutral baseline)

height = MIN_H + freshness * (MAX_H - MIN_H)
  MIN_H = 0.5
  MAX_H = 8.0
```

λ = 0.003 means a node connected to things created 8 months ago has half the freshness of one connected to things created yesterday. After ~2 years the recency approaches near-zero.

**Missing `createdTime` fallback (three-tier):**

Not all Notion records may have `createdTime` populated. Resolution order:

1. Use the node's own `createdTime` if present
2. If missing, find the oldest `createdTime` among that node's directly connected neighbors and use that
3. If no connected neighbor has a `createdTime` either, default to **2025-11-01T00:00:00Z**

This means an undated node is treated as being roughly as old as the oldest thing it's connected to — which is a reasonable proxy. If it's completely isolated with no dates anywhere nearby, it lands in the "Midtown" cohort (November 2025 sits between the expected Old Town and New Town boundaries for most datasets).

**What this looks like in the city:**
- New thriving areas: tall narrow-to-medium buildings clustered together
- Old established areas: short wide buildings, like a flatter older district
- Abandoned projects: short and narrow — not much width (few connections), not much height (stale)

**Why this is better than raw connection count for height:**
The current v1 height just rewards whoever has the most connections, which is almost always a single database like Projects. Freshness distributes height across time, so a new database that's growing fast will have tall buildings even if it doesn't have many connections yet.

---

## 3. Revised Layout: Age-Cohort Clustering

Instead of one spiral from a single center, the city is divided into **district clusters** based on node age. This creates the "old town / new town" feel without any manual tagging.

### 3.1 Age Bucketing

Nodes are bucketed into age cohorts based on their `createdTime`:

| Cohort | Age Range | Character |
|--------|-----------|-----------|
| **New Town** | < 6 months old | Tall, active buildings rising fast |
| **Midtown** | 6–18 months old | Mix of heights — some still active, some settling |
| **Old Town** | > 18 months old | Wider, shorter — established and quieter |

These thresholds should be recalibrated to the actual data distribution if needed (e.g., if all data is < 3 months old, compress the buckets accordingly). Compute the 33rd and 66th percentile of `createdTime` and use those as bucket boundaries so each cohort always has roughly equal numbers of nodes.

### 3.2 Cluster Positioning

Each cohort gets a **cluster center** in world space. The three cluster centers are positioned far enough apart that the districts read as clearly separate, but not so far that the city feels empty.

- Cluster centers are placed at a distance proportional to `sqrt(nodesInCohort) * CELL_SIZE * 0.7` from each other
- Positions are seeded-random (not on a regular grid) so they don't line up perfectly
- The seed is a hash of the database IDs so layout is deterministic across reloads

Within each cluster, nodes are arranged in the same spiral pattern as v1, but centered on the cluster center instead of the world origin.

### 3.3 Jitter

Every building gets a **seeded random positional offset** applied after grid placement:

```
jitter = seededRandom(nodeId) * CELL_SIZE * 0.3
```

Jitter range scales inversely with building footprint: wider buildings jitter less (they have less room to move). This stops large buildings from encroaching on neighbors while small buildings can wander more freely.

The jitter seed is derived from the node ID so it's always the same for the same node — the city looks the same every time you load it.

### 3.4 Overlap Prevention Pass

After jitter is applied, run a simple sweep: any two buildings whose footprints (including their minimum alley gap) would overlap get nudged apart along the axis of their collision. Minimum alley gap = 0.6 world units regardless of building size.

### 3.5 Overall City Shape

The combination of three spread-out clusters with irregular jitter naturally produces a non-square city footprint — it should look like a scattered archipelago of dense clusters rather than a tidy grid. No extra shaping is needed; the cluster system produces this organically.

---

## 4. Street System

Streets are one of the most impactful visual improvements and become essential for the first-person mode.

### 4.1 What Gets Drawn

- **Major streets:** Wider lines running between clusters (connects old town to new town)
- **Local streets:** Narrower lines running through each cluster along the primary grid axes
- **Lane markings:** Dashed lines down the center of each street (white in dark mode, light gray in light mode)

### 4.2 How Streets Are Generated

Streets aren't manually placed — they emerge from the layout:

1. After all buildings are placed, compute the **Voronoi gaps** between buildings (or more simply: scan the grid and mark any cell that has no building as potential street space)
2. Main corridors are the largest contiguous open strips — these become main streets
3. Draw lines along the centerline of these corridors
4. Add dashed center-lane markings at a fixed interval (e.g., every 0.5 world units)

For v2, a simpler approximation is fine:
- Draw a regular grid of street lines at the CELL_SIZE interval across each cluster's bounding area
- Skip any street segment that would be blocked by a wide building's footprint
- This naturally produces a block-like street grid per cluster, with the main inter-cluster gaps serving as highways

### 4.3 Street Visual Style

| Element | Dark Mode | Light Mode |
|---------|-----------|------------|
| Street surface | Slightly lighter than ground (`#151520`) | Slightly darker than ground (`#d8d4cc`) |
| Lane markings | `rgba(255,255,255,0.25)` dashed | `rgba(0,0,0,0.15)` dashed |
| Street width | ~0.8× alley width | same |

Streets sit at Y = 0.005 (just above ground plane, just below the connection lines at Y = 0.01).

---

## 5. First-Person Street Mode

A toggle switches between the current overhead orbit camera and a first-person walking/driving view.

### 5.1 Activation

- A button in the bottom-right UI bar (next to the controls hint): **"Street View"**
- Clicking it:
  1. Requests pointer lock on the canvas (`canvas.requestPointerLock()`)
  2. Transitions the camera from current position down to street level (Y = 1.8, eye height)
  3. Positions the camera on the nearest street (not inside a building)
  4. Shows WASD hint overlay
- Pressing **Escape** exits first-person mode (releases pointer lock) and flies camera back up to overview

### 5.2 Movement

| Input | Action |
|-------|--------|
| `W` | Move forward |
| `S` | Move backward |
| `A` | Strafe left |
| `D` | Strafe right |
| Mouse move | Look left/right/up/down (pointer lock) |
| `Shift` | Move faster (sprint) |

Movement speed: ~5 world units/second walking, ~15 sprint.

Camera stays at a fixed Y height (1.8) — no jumping, no flying up. This keeps it grounded on the streets.

No collision detection in v2 — you can walk through buildings. This is intentional for v2 simplicity; collision can be added in v3.

### 5.3 Camera Transition

When toggling in:
- Animate camera from current overview position down to (nearestStreetX, 1.8, nearestStreetZ) over 800ms
- Use an easing curve (ease-in-out)
- During transition, disable controls so user can't interrupt it

When toggling out:
- Animate camera back up to the last overhead position over 800ms
- Re-enable orbit controls

### 5.4 HUD in First-Person Mode

Small overlay in top-left (replacing the wordmark area temporarily):
```
[WASD] move   [mouse] look   [ESC] exit street view
```
The node details panel and database toggle panel remain accessible.

---

## 6. Summary of All Building → Data Mappings

| Visual Property | Data Source | Formula |
|----------------|-------------|---------|
| **Height** | Recency of connected nodes | Exponential decay avg of neighbor ages, λ=0.003 |
| **Base width** | Number of connections (degree) | `1 + 2 * sqrt(degree / maxDegree)`, capped at 3× |
| **Color (edges + fill)** | Database type | Same as v1 — `node.color` |
| **Cluster placement** | Node age (`createdTime`) | 3 age cohorts, each forms its own district |
| **Jitter** | Node ID (seeded) | ±30% of cell size, less for wider buildings |

---

## 7. Open Questions / Decisions

| # | Question | Current assumption |
|---|----------|--------------------|
| 1 | What if a node has zero connections? | Freshness = 0.5 (neutral baseline height). For the age cohort, apply the three-tier createdTime fallback: own date → oldest connected neighbor's date → 2025-11-01 |
| 2 | Should the age buckets (< 6mo, 6–18mo, > 18mo) be fixed or computed from data quantiles? | Compute from 33rd/66th percentile so each cohort always has roughly equal nodes |
| 3 | Should inter-cluster "highways" have a different visual treatment than local streets? | Yes — wider, slightly brighter lines |
| 4 | Collision detection in first-person? | No for v2, revisit in v3 |
| 5 | Should first-person speed be adjustable? | No for v2 |
| 6 | Should buildings cast shadows on streets? | Would be visually great — requires `renderer.shadowMap.enabled = true` and shadow-capable materials. Worth doing. |
| 7 | What happens to the node details panel in first-person? | Keep it accessible — clicking a building (raycast still works) shows the panel |

---

## 8. Implementation Phases

### Phase 2A — Revised Building Semantics
- Update `cityLayout.ts`:
  - Width from degree (square root scaled)
  - Height from freshness (exponential decay of neighbor ages)
  - Layout math accounts for variable-size building footprints

### Phase 2B — Age-Cohort Clustering
- Bucket nodes into 3 age cohorts
- Place each cohort's cluster in world space
- Apply seeded jitter
- Overlap prevention pass

### Phase 2C — Street System
- Generate street grid from cluster bounding areas
- Draw streets with lane markings as Three.js geometry
- Street surface plane segments

### Phase 2D — First-Person Mode
- Pointer lock + WASD controls
- Camera transition animation
- HUD overlay
- Toggle button in UI

---

## 9. Things That Stay the Same from v1

- Database color palette
- DatabaseTogglePanel (enable/disable databases)
- NodeDetailsPanel (click building → side panel)
- Connection lines at ground level on selection (center-base to center-base)
- Highlight/dim behavior on selection
- Orbit controls in overhead mode
- Dark mode toggle
