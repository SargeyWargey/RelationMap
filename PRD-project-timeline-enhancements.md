# Project Timeline — Enhancement PRD

**Status:** Planning
**Date:** 2026-03-17
**Builds on:** PRD-project-user.md (original design)

---

## 0. Rename: Project User → Project Timeline

All instances of "Project User" are renamed to **"Project Timeline"** across:

- Screen title / wordmark
- Route: `/project-user` → `/project-timeline`
- File names: `UserCanvas.tsx` → `TimelineCanvas.tsx`, `ProjectUserScreen.tsx` → `ProjectTimelineScreen.tsx`, `app/project-user/` → `app/project-timeline/`, `lib/userLayout.ts` → `lib/timelineLayout.ts`
- `localStorage` key prefix: `user_` → `timeline_`
- Home screen tile title and subtitle
- All internal variable names, comments, and type names (e.g. `PersonEntry` stays, but `userLayout`, `UserCanvas`, etc. update)

---

## 1. Enhancement 1 — Date Labels Positioned Relative to Branch Direction

### 1.1 Goal

Each document card on the timeline has a thin vertical connector line running from the spine up (or down) to the card. The date label should appear **on the opposite side of the spine from the card** — tucked just below the spine when the card is above it, and just above the spine when the card is below it. The date never travels with the card; it stays near the spine, mirroring the card's position across it.

### 1.2 Layout Rules

```
Branch going UP (card is above spine):
  ┌─────────────────┐
  │   [Card Title]  │
  └────────┬────────┘
           │
   ────────┼──────────  spine
       [date]           ← date BELOW the spine (opposite side from card)


Branch going DOWN (card is below spine):
       [date]           ← date ABOVE the spine (opposite side from card)
   ────────┼──────────  spine
           │
  ┌────────┴────────┐
  │   [Card Title]  │
  └─────────────────┘
```

- Date format: `MMM YYYY` (e.g. `Jan 2025`). If the time spread is < 3 months, use `MMM D, YYYY`.
- Date label is rendered as an HTML overlay (same z-layer as card title labels, active panel only).
- Font: smaller than the card title, muted color (`--text-secondary`), not bold.
- Alignment: centered horizontally on the card's X center.
- Vertical offset: `~8px` gap between the card edge and the date text.

### 1.3 Implementation Notes

- Date label position is computed from the projected screen Y of the spine intersection point, then offset by `~8px` to the **opposite side of the spine from the card** (i.e. below the spine for above-spine cards, above the spine for below-spine cards).
- No change needed to the 3D geometry — this is purely an HTML overlay positioning change.

---

## 2. Enhancement 2 — Left-Justified Title at Connector Line Edge

### 2.1 Goal

The document card's title (node name / record name) should be **left-justified** and anchored to the **left edge of the connector line**, not centered on the card face. This creates a newspaper-column-style read: everything left-aligns to the spine's meeting point.

### 2.2 Layout Rules

```
  │                        ← connector line (vertical)
  ├────────────────────
  │  Title text here       ← title starts at the left edge of the line
  │  (wraps within card width if needed)
```

- The title's left edge is aligned with the **left edge of the connector line's X position** (which equals the card's `xPosition` on the time axis).
- Text wraps within the card width (`120 world units → ~120px` after projection).
- Title font: standard weight initially (not bold — see Enhancement 3 for styled sub-field).
- Vertical alignment within the card: top-aligned, with a small top padding (`~6px`).

### 2.3 CSS / Overlay Change

The existing centered `text-align: center` on card label overlays changes to `text-align: left`. The overlay container left-edge is pinned to the projected X of the connector line rather than the card center.

---

## 3. Enhancement 3 — Selectable Secondary Field (Sub-title + Description)

### 3.1 Goal

Users should be able to select **one additional text field** from a database's schema to display beneath the card title on the timeline. By default, all fields are hidden (only the title is shown). When a secondary field is configured, it renders below the title with distinct visual weight.

### 3.2 Visual Hierarchy Within a Card

```
  │  Project Alpha                   ← title (normal weight)
  │  ──────────────────
  │  Q2 infrastructure upgrade        ← secondary field value (bold / called out)
  │  Migrating all services to new    ← (if a third "description" field is added later)
  │  infra stack. ETA June 2025.
```

For this PRD, we are adding support for **one secondary field** (the bold/called-out line). A description field is noted as future scope.

- **Label style:** `font-weight: 600` (semi-bold), slightly larger than the date label, slightly smaller than the title, color matches the database accent color at reduced opacity (e.g. `0.85`).
- Truncates to 2 lines max within the card area. Long values are ellipsized.
- If the secondary field value is empty/null for a given record, the card renders with title only (no blank space reserved).

### 3.3 Configuration UI

In the `DatabaseTogglePanel`, below each database's existing controls, add a **"Detail Field"** dropdown:

| State | Display |
|---|---|
| Default | `(none — title only)` |
| Selected | Field name (e.g. `Description`, `Status`, `Owner`) |

- Only fields of type `title`, `rich_text`, `text`, `select`, `multi_select`, `formula` (text result), or `rollup` (text result) are shown as options.
- `people` and `relation` fields are excluded (complex rendering, out of scope).
- The setting is stored in `DatabaseFieldConfig` under a new key: `detailField: string | null`.
- On change: re-renders the active panel's HTML overlays immediately (no full Three.js rebuild needed — only overlay content updates).

### 3.4 Default State

- On first load (or when no `detailField` is configured): only the title renders on each card.
- The card geometry height does not change based on whether a detail field is shown — layout is fixed-height, content fits within it.

---

## 4. Enhancement 4 — Fix Flicker / Flash on Arrow Key Entry Animation

### 4.1 Problem

When pressing an arrow key to navigate to the next person, the new panel briefly flashes to zero opacity and then fades back in rather than smoothly rotating into view. The build-out animation to the left works well — the flash only happens at the snap/entry point.

### 4.2 Root Cause (Hypothesis)

Likely: the panel that rotates into the front-facing position is being re-initialized (opacity reset to 0) at the moment it crosses the "front" threshold, triggering the `animate-fade-up` or opacity tween from scratch. The cylinder rotation tween and the opacity assignment may be racing.

### 4.3 Fix Specification

- The opacity of each panel must be driven **continuously and solely** by the panel's current angular distance from the front-facing angle throughout the entire rotation tween — including mid-tween.
- Do NOT reset opacity to 0 at the start of a new navigation gesture. The opacity starts from wherever it currently is and transitions continuously.
- Remove any `opacity = 0` or fade-in initialization that runs at the moment a panel reaches the active index.
- The smooth opacity curve (see PRD §14.6) should run every animation frame during the rotation tween, not just at rest positions.

### 4.4 Acceptance Criteria

- Press Up/Down arrow: the panel smoothly rotates into view with a consistent opacity curve throughout. No flash, no jump to zero.
- The left-build-out animation (which already works well) is unchanged.

---

## 5. Enhancement 5 — Persistent Neighbor Name Bands (Always Visible)

### 5.1 Goal

When the active person's timeline is displayed, the **names and metadata for adjacent people** (the ones above and below in the carousel) should be persistently visible as horizontal bands at the top and bottom of the viewport. These are not hidden until hover — they are always shown.

As the user scrolls further from the active person, the bands for more-distant people fade out. The effect is: the closer a person is to the active one in the carousel, the more visible their name band.

### 5.2 What a Name Band Contains

Each name band is a thin horizontal strip (HTML overlay, not Three.js geometry) showing:

```
  ◉  Alice Smith          3 records
```

- **Avatar circle**: initials, color-hashed (same as existing person identifier).
- **Display name**: the person's name.
- **Record count**: `{n} records` (or `{n} record` for 1).
- No timeline content — just the identifier strip.

### 5.3 Layout

```
  ┌──────────────────────────────────────────────────┐
  │  ◉ Person C    2 records          (faded, far)   │  ← band at top (far)
  │  ◉ Person B    5 records          (visible)      │  ← band at top (adjacent)
  │                                                  │
  │  [Active person's full timeline]                 │
  │                                                  │
  │  ◉ Person D    7 records          (visible)      │  ← band at bottom (adjacent)
  │  ◉ Person E    1 record           (faded, far)   │  ← band at bottom (far)
  └──────────────────────────────────────────────────┘
```

- Adjacent bands (±1 from active): `opacity: 0.75`, full name + count visible.
- Second-tier bands (±2 from active): `opacity: 0.35`.
- Third-tier and beyond: `opacity: 0` (hidden).
- A soft vertical gradient vignette reinforces the fade effect toward the edges.

### 5.4 Fade During Navigation

When the user presses an arrow key or scrolls to navigate:
- The bands reposition to reflect the new active person's neighbors.
- The repositioning is animated in sync with the cylinder rotation tween (same 400ms, same easing).
- Bands slide vertically as the cylinder rotates — they follow the panel positions.

### 5.5 Implementation Notes

- Name bands are **HTML overlays** positioned absolutely over the Three.js canvas.
- Their Y positions are computed from the projected screen Y of each panel's spine center.
- They update every animation frame during rotation tweens.
- Clicking a name band navigates to that person (same as clicking in the Person Picker panel).
- On screens with very many people (N > 20), limit visible bands to ±3 from active.

---

## 6. Modified Files Summary

| File | Change |
|---|---|
| `components/UserCanvas.tsx` → `TimelineCanvas.tsx` | Rename + all 4 enhancements |
| `components/ProjectUserScreen.tsx` → `ProjectTimelineScreen.tsx` | Rename + wordmark update |
| `app/project-user/page.tsx` → `app/project-timeline/page.tsx` | Rename + route |
| `lib/userLayout.ts` → `lib/timelineLayout.ts` | Rename |
| `lib/types.ts` | Add `detailField?: string \| null` to `DatabaseFieldConfig` |
| `components/DatabaseTogglePanel.tsx` | Add "Detail Field" dropdown per database |
| `app/page.tsx` | Update `ModeTile` href, title, subtitle |

---

## 7. Out of Scope (This PRD)

- A third "description" sub-field below the bold detail field (noted, deferred).
- `people` / `relation` field types in the Detail Field selector.
- Side-by-side multi-person view.
- Virtual scrolling for N > 100 people.

---

## 8. Open Questions

| # | Question | Status |
|---|---|---|
| 1 | Should clicking a neighbor name band snap immediately or animate? | Assumed: animate (same as Person Picker) |
| 2 | Should the Detail Field setting be per-database or global? | Assumed: per-database (stored in `DatabaseFieldConfig`) |
| 3 | For Enh 2 (left-justified title): does the left edge pin to the connector line's X, or to the card's left edge? | Assumed: connector line X — confirm with user |
| 4 | For Enh 5: should name bands be interactive (clickable) on mobile / touch? | Open |

---

## 9. Implementation Task List

### Phase T0 — Rename
- [ ] Rename files: `UserCanvas` → `TimelineCanvas`, `ProjectUserScreen` → `ProjectTimelineScreen`, route, layout lib, localStorage prefix
- [ ] Update all imports and internal references
- [ ] Update `app/page.tsx` tile

### Phase T1 — Enh 1: Date Labels
- [ ] Compute date label position in screen space (spine-facing side of card)
- [ ] Render date overlay with `MMM YYYY` format
- [ ] Handle short time-spread case (`MMM D, YYYY`)

### Phase T2 — Enh 2: Left-Justified Title
- [ ] Change overlay container left-edge to pin to connector line X
- [ ] Set `text-align: left` on card title overlay

### Phase T3 — Enh 3: Detail Field
- [ ] Add `detailField?: string | null` to `DatabaseFieldConfig` in `lib/types.ts`
- [ ] Add "Detail Field" dropdown to `DatabaseTogglePanel` (filtered field types only)
- [ ] Render secondary field value in card overlay with bold styling
- [ ] Truncate to 2 lines, ellipsize overflow
- [ ] On field change: re-render overlays only (no Three.js rebuild)

### Phase T4 — Enh 4: Fix Entry Flash
- [ ] Audit opacity assignment logic — remove any `opacity = 0` reset at front-crossing
- [ ] Drive opacity continuously from angular distance every animation frame during tween
- [ ] Verify no flash on Up/Down arrow and scroll navigation

### Phase T5 — Enh 5: Neighbor Name Bands
- [ ] Create HTML overlay layer for name bands
- [ ] Compute band Y position from projected panel spine center each frame
- [ ] Render avatar + name + record count per band
- [ ] Set opacity by distance from active (0.75 / 0.35 / 0)
- [ ] Animate band positions in sync with cylinder rotation tween
- [ ] Wire band click → cylinder navigate
- [ ] Apply vignette gradient at top/bottom edges
- [ ] Cap at ±3 visible bands for large N
