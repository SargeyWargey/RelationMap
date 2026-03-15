# PRD: Flyover Mode

**Status:** Draft
**Date:** 2026-03-15

---

## Overview

Flyover Mode is a cinematic, automated camera tour that navigates the city from a selected "hub" node through all of its connections in chronological order. It is designed to feel like a slow, smooth aerial pass over a real city — giving users a spatial understanding of a node's relationship network without any manual input.

---

## Problem

The current overhead and street-view modes require the user to actively navigate. There is no passive, narrative way to explore a node's connections. Users who want to get a feel for how a central node relates to everything around it have to manually orbit or walk between buildings.

---

## Goals

1. Let users trigger a cinematic camera tour of a selected node's connection network.
2. Keep the experience smooth, slow, and visually grounded in the existing city metaphor.
3. Give users control over how labels appear during the tour.
4. Never interrupt the tour by revisiting a node already seen.

---

## Non-Goals

- This is not a "free-roam" cinematic mode — the path is always driven by a node's connection graph.
- This does not replace street view or overhead mode; it is a third peer mode.
- No audio or voiceover.
- No path-editing UI (for this version).

---

## Entry & Exit Points

### Entry
- A **Flyover** toggle button is added to the bottom-right control bar, immediately adjacent to the existing **Street View** toggle. It follows the same visual style: a small pill toggle + label ("flyover").
- Flyover mode requires a node to be selected first. If no node is selected when the user activates the toggle, the toggle does nothing (or shows a brief tooltip: "Select a node to begin flyover").
- When activated, the currently selected node becomes the **hub** — the starting point of the tour.

### Exit
- Clicking the **Flyover** toggle again exits the mode.
- The camera smoothly returns to its previous overhead position (same save/restore logic used by street view today in `overheadPos` / `overheadTarget`).
- Pressing `Escape` also exits.
- The tour ends naturally when all connections have been visited; at that point the mode deactivates automatically and the camera returns to the overhead position.
- Selecting a different node while flyover is active exits the current tour and starts a new one from the newly selected node.

---

## Camera Behavior

### Tour Sequence

1. **Start:** Camera transitions from its current position to a cinematic orbit position above the hub node.
2. **Visit hub:** Camera orbits/rotates around the hub briefly, keeping it centered in frame.
3. **Fly to connections:** For each connection, the camera sweeps from the current node to the next.
4. **End:** After the final connection, the tour ends and flyover mode deactivates.

### Connection Ordering

Connections are sorted as follows:

1. Edges with a `createdTime` value are sorted **most recent first** (descending by `createdTime`).
2. Edges without a `createdTime` are sorted **alphabetically by the connected node's name**, appended after the dated group.
3. Each node is visited **at most once**. If a connection was already visited earlier in the tour (e.g., it is a shared connection of multiple nodes), skip it.

> This ordering applies to the direct connections of the **hub node only**. The tour does not recursively follow connections-of-connections — it visits the hub and all of its immediate neighbors.

### Camera Position Per Node

At each node the camera adopts a position that:

- Is **above and offset** from the building — not directly overhead, but at a low angle that feels like a low-altitude flyover. A good starting target: `height = buildingHeight * 2.5 + 4` world units above ground, positioned `buildingWidth * 2` units back along a direction that keeps the **previous node** slightly in frame.
- **Orbits the building slowly** while paused at it (a gentle yaw rotation at maybe 15–20°/sec), keeping the building roughly centered.
- Keeps both the **current node** and the **next node** loosely in frame during the transition flight (use a `lookAt` target that linearly interpolates between the two building positions during the transition).

### Transition Flight

- Each flight between two nodes should use a **cubic Bezier or SLERP camera path** — not a straight line — so the camera arcs upward slightly in the middle of the journey (like a plane taking off and landing).
- The arc height should scale with the distance between nodes: longer distances = higher arc.
- Duration: approximately **3–5 seconds per transition**, depending on distance. A reasonable default is `clamp(distance / 8, 3, 6)` seconds.
- The orbit pause at each node should last approximately **2–3 seconds** before the next transition begins.
- All motion uses **ease-in-out** timing — no abrupt starts or stops.

### OrbitControls Interaction

- OrbitControls are **disabled** during flyover mode (same as street view).
- Mouse drag / scroll wheel does nothing.
- Clicking a building during flyover selects it and restarts the tour from that node.

---

## Label Settings

### New Setting Group in the Settings Panel (⚙)

A new section titled **"Flyover Labels"** is added to the existing settings dropdown in `ProjectCityScreen`, below the existing "Building Labels" and "Click Labels" sections. It contains a **three-way selector** (not a toggle) with these options:

| Option | Behavior |
|---|---|
| **None** | No labels are shown during flyover. |
| **Overhead** | SVG callout-style labels (same system as existing click labels) appear per-building, but with approach-triggered fade. |
| **Center** | The existing Three.js sprite labels rendered at the center/mid-height of the building are used. |

The selector should be visually consistent with the existing panel — `DM Mono` font, same sizing, three small pill/chip buttons in a row rather than a toggle.

### Overhead Label Fade Behavior (when "Overhead" is selected)

The label overlay system already renders all selected-node labels every frame via `updateOverheadLabels`. In flyover mode, this is narrowed to a **single label at a time**, fading based on camera proximity:

- **Approaching:** The label for the **next node** begins fading **in** once the camera is within a configurable radius (e.g., 60% of the way through the transition flight).
- **Departing:** The label for the **current node** begins fading **out** when the camera begins moving away (i.e., when the next transition starts).
- At any given moment, **at most two labels** may be visible simultaneously during a crossfade.
- Labels use CSS-style `opacity` on the SVG elements — no new infrastructure required.

> Implementation note: the fade progress can be derived from the normalized `t` parameter of the current in-flight Bezier. `t > 0.6` → fade in next label; `t < 0.4` → fade out current label. During the orbit-pause phase, only the current node's label is visible at full opacity.

### Center Label Behavior (when "Center" is selected)

- The existing `labelSprites` system is reused.
- Only the **current node being visited** has its sprite visible and at full opacity.
- All other sprites are hidden.
- Fade in as the camera arrives; fade out as it departs — same `t`-based logic as above.

---

## State Changes

### New fields on `SceneState` (in `CityCanvas.tsx`)

```
flyoverActive: boolean
flyoverQueue: string[]          // ordered list of node IDs to visit
flyoverQueueIndex: number       // current position in the queue
flyoverT: number                // normalized [0,1] progress within current transition
flyoverPhase: 'orbit' | 'fly'   // currently orbiting a node or flying to next
flyoverOrbitElapsed: number     // seconds spent in current orbit phase
flyoverLabelMode: 'none' | 'overhead' | 'center'
```

### New props on `CityCanvas`

```
flyover?: boolean
flyoverLabelMode?: 'none' | 'overhead' | 'center'
onExitFlyover?: () => void
```

### New state in `ProjectCityScreen`

```
flyover: boolean
flyoverLabelMode: 'none' | 'overhead' | 'center'   // persisted to localStorage
```

---

## Controls Hint Bar

When flyover mode is active, the controls hint bar (bottom-right) updates to:

| Key | Action |
|---|---|
| `esc` | exit flyover |
| `click` | select & restart |

---

## Settings Persistence

`flyoverLabelMode` should be persisted to `localStorage` so the user's preference survives page refreshes.

---

## Resolved Design Decisions

### No-connection nodes
If the hub has zero edges, the tour still activates. The camera flies to the hub, orbits it for the full orbit-pause duration, then exits flyover mode naturally. No error message — the behavior itself communicates that there is nothing further to visit.

### Mid-flight node click (reroute)
If the user clicks a node that is **not** already in the current tour queue while the camera is in flight:
- The current in-flight transition completes its arc to wherever it was heading (no abrupt cut).
- At the moment the camera arrives at that waypoint, the tour queue is **replaced** with a new queue rooted at the clicked node.
- The camera then transitions from its current position to the new hub using the standard flight curve — so the handoff looks like one continuous journey rather than a teleport.

If the user clicks a node that **is** already in the queue, skip ahead to it: complete the current arc, then jump the queue index to that node.

### Orbit direction (shortest-turn rule)
The orbit direction at each node is determined by the position of the **next node** in the queue:
- Project both the current and next node onto the horizontal plane.
- Compute the signed angle from the camera's current yaw to the bearing toward the next node.
- Rotate in whichever direction minimizes that angular delta (i.e., always take the short way around).
- This means the camera naturally "turns toward" the next destination as it orbits, making the departure feel intentional.
- For the final node in the queue (no next node), default to a counter-clockwise orbit.

---

## Speed & Timing Controls

All timing parameters are exposed as user-adjustable sliders in the ⚙ settings panel under a new **"Flyover Speed"** section. Default values are listed; ranges are chosen to keep the experience always feeling deliberate rather than frantic.

| Setting | Default | Range | Description |
|---|---|---|---|
| **Flight speed** | `1.0×` | `0.25×` – `3.0×` | Global multiplier applied to all computed flight durations. At `1.0×`, duration = `clamp(distance / 8, 3, 6)` seconds. |
| **Orbit duration** | `2.5 s` | `0.5 s` – `8 s` | How long the camera orbits each node before beginning the next flight. |
| **Arc height** | `1.0×` | `0.25×` – `2.5×` | Multiplier on the Bezier control-point lift. Higher = more dramatic arc over longer flights. |

These three sliders replace the previously hardcoded constants. All values are persisted to `localStorage` alongside `flyoverLabelMode`.

### Slider UI
The sliders use the same `DM Mono` panel aesthetic as the rest of the settings dropdown. Each row shows the label on the left and the current value (formatted as `0.5×` or `3 s`) on the right, with the slider spanning the full panel width below. Slider thumb and track follow `var(--text-faint)` / `var(--border-default)` color tokens.
