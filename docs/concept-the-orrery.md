# Concept: The Orrery
### A Mechanical Solar System Visualization — Baseline Brief

---

## The Idea

An orrery is a mechanical clockwork model of the solar system. In RelationMap, the entire Notion workspace becomes a living, rotating mechanical model:

- The **most connected node** (or the Notion root page) is the **Sun** at the center
- Each **database** is a **planet** orbiting the sun at its own radius and speed
- Each **node (record)** within a database is a **moon** orbiting its planet
- The whole thing slowly rotates — you observe it from outside, like looking at a brass astronomical instrument

---

## Core Data Mapping

| Data | Visual |
|---|---|
| Root node / most connected node | Sun (warm glowing sphere at center) |
| Database | Planet (distinct size, database color, orbital ring) |
| Node (record) | Moon orbiting its database planet |
| Connection degree | Moon size (larger = more connected) |
| Data freshness | Orbital speed (faster = more recently updated) |
| Edge/relation | Glowing arc drawn between moons when selected |
| Node name | Label visible on hover |

---

## Visual Aesthetic

- Brass and dark enamel mechanical look — gears, orbital rings, armillary rings
- Warm amber glow on the sun; cool blue-white on distant moons
- Deep space background (dark, subtle star field — different from The Sphere because this is a *model*, not a real space environment)
- Orbital paths as thin glowing rings (database color, low opacity)
- The whole model sits on an implied pedestal or gimbal (optional visual anchor)
- Perfectly fits the warm palette — brass is orange/gold, matches `var(--accent-warm)`

---

## Interaction Model

- **Observe mode (default):** Camera orbits slowly around the whole orrery; you watch it spin
- **Click to focus:** Click a planet → camera moves in to orbit that planet, moons become prominent
- **Click a moon:** Select a node → detail panel slides in, connection arcs appear to related moons (may cross to other planets)
- **Speed control:** Scrub or slider to speed up / slow down the orbital animation
- **Pause:** Freeze time to examine static positions
- No first-person mode — this is purely an observational/contemplative view

---

## Key Differences from Existing Modes

- The only mode where **the visualization animates continuously** (always in motion)
- The only **purely observational** mode — no walking, no scrolling, just watching
- Time is encoded as **orbital speed**, not as a linear axis
- Hierarchy is explicit: Sun → Planet → Moon (three clear tiers)
- The mechanical/orrery aesthetic is completely distinct from the organic/geological/urban modes

---

## Why It Works for This Data

Notion workspaces have a natural hierarchy: workspace → databases → records. An orrery expresses exactly that — gravitational centers with orbiting bodies. The most important thing (most connected hub or root) becomes the literal gravitational center. The system feels alive and purposeful rather than static.

---

## Scope When Picked Up

**Minimal viable version:**
1. Sun mesh at origin
2. Database planets on orbital rings at increasing radii
3. Moons orbiting planets (position computed from orbital angle, updated each frame)
4. Camera auto-orbits the full model
5. Click to select moon → detail panel + connection arcs

**Stretch goals:**
- Orbital rings styled as brass armillary rings with 3D thickness
- Glow and lens flare on the sun
- Planet size scales with database node count
- Orbital inclination (slight tilt per planet for visual variety)
- Time scrubber UI to control animation speed
- Zoom into a planet's moon system (sub-orrery view)

---

## Files to Create (When Starting)

```
app/project-orrery/
  page.tsx

components/
  OrreryCanvas.tsx
  OrreryDetailPanel.tsx

lib/
  orreryLayout.ts    # Compute orbital radii, speeds, moon angles
```

---

## Open Questions (For When Picked Up)

1. What is the "sun"? Most connected node globally, or the Notion root page, or a fixed concept?
2. Should orbital speed be proportional to freshness or to something else (update frequency, degree)?
3. Should planets have moons on orbital rings, or just scattered around the planet loosely?
4. Is the pedestal/gimbal visual anchor important or too decorative?

---

*Document created: 2026-03-21*
*Status: Parked — baseline for future pickup*
