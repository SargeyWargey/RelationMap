# PRD: Home Screen & Project City Mode

**Status:** Implemented (Phase 1 + 2 complete)
**Date:** 2026-03-14
**Scope:** Major feature — app-level navigation restructure + new Project City mode shell

---

## Overview

The app currently launches directly into the graph visualization ("Project Ground Control"). This PRD introduces a **Home/Splash Screen** that lets users choose between two distinct modes, plus a new **Project City** mode shell. The existing graph mode continues to function as-is; data (Notion sync, config, schemas) is shared across both modes.

---

## Goals

- Add a branded splash/home screen as the app entry point
- Two mode tiles: **Project Ground Control** (existing graph) and **Project City** (new, TBD visualization)
- Clicking the app title in the top-left of either mode returns to the home screen
- Maintain identical theme (light/dark), color scheme, and Notion data sync across both modes
- Project City launches to an intentionally blank canvas (visualization to be defined in a follow-up)

---

## Current Architecture (Relevant Context)

| Concern | Current Implementation |
|---|---|
| Entry point | `app/page.tsx` — server component, loads graph data, renders `<GraphScreen />` directly |
| Routing | Single-page, no routes beyond the root |
| App name | "Project Ground Control" (displayed top-left in `GraphScreen.tsx`) |
| Theme | Managed in `GraphScreen.tsx` via `localStorage` + `data-theme` attribute |
| Notion data | Cached in `data/graph.json`, `data/nodes/`, `data/schemas/`, `data/config.json` |
| Branding | Bean icon (`/bean.png`), text "Project Ground Control" + subtitle "notion graph" |

---

## Proposed Changes

### 1. Routing Structure

Introduce Next.js App Router routes:

```
/                   → Home screen (new — mode selector)
/graph              → Project Ground Control (existing graph mode)
/project-city       → Project City mode (new — blank shell)
```

- `app/page.tsx` becomes the home screen
- `app/graph/page.tsx` wraps the existing `<GraphScreen />`
- `app/project-city/page.tsx` is a new blank mode page

### 2. Home Screen (`/`)

**Layout:**
- Full-viewport page matching existing app background color (respects light/dark)
- Centered vertically and horizontally
- App logo/bean icon at top center (reuse `/bean.png`)
- App family name or tagline (e.g., "RelationCity") as a subtitle beneath the logo
- Two large tiles side by side (or stacked on mobile), each:
  - Mode name as large heading
  - Short one-line description
  - Subtle icon or illustration placeholder
  - Hover state with elevation/glow using existing accent color (`--accent`)
  - Click navigates to the respective route

**Tile 1 — Project Ground Control**
- Name: "Project Ground Control"
- Subtitle: "notion graph"
- Navigates to `/graph`

**Tile 2 — Project City**
- Name: "Project City"
- Subtitle: "project visualization" (placeholder — update when defined)
- Navigates to `/project-city`

**Theme toggle:** present on the home screen (top-right, same as existing)

**Design notes:**
- Reuse all existing CSS variables — no new color values
- Tiles use `--panel-bg`, `--border`, `--accent` for hover
- Typography matches existing font stack

### 3. Back Navigation (Title Click)

In **both** mode pages, the top-left app title/branding area becomes a clickable link back to `/`.

- Current: `GraphScreen.tsx` renders a `<div>` with "Project Ground Control" + subtitle
- Change: wrap in a Next.js `<Link href="/">` with subtle pointer cursor
- No other visual change — same styling, same position
- Apply the same pattern to `ProjectCityScreen` when built

### 4. Project City Mode Shell (`/project-city`)

**For this phase:** intentionally minimal.

- New component: `components/ProjectCityScreen.tsx`
- Renders the same chrome as GraphScreen (top-left title with back link, dark mode toggle top-right, same background)
- Center of screen: empty canvas area (no graph, no nodes)
- Optionally: a subtle placeholder message like "Coming soon" or just blank
- The DatabaseTogglePanel and NodeDetailsPanel are **not** included in this phase
- Notion data is **not** loaded or displayed yet

**Design principle:** the shell must look like a legitimate page in the same app family — same fonts, colors, chrome — so it doesn't feel broken.

### 5. Shared Theme State

Currently, dark mode state lives inside `GraphScreen`. With a home screen now in the picture:

- Theme initialization (reading `localStorage`) moves to `app/layout.tsx` or a thin `ThemeProvider` client component
- Both mode pages and the home screen share the same theme state without re-reading `localStorage` on every navigation
- The `data-theme` attribute is set on `<html>` in layout, not per-page

---

## Task Breakdown

### Phase 1 — Routing & Navigation Shell

- [ ] **T1** — Create `app/graph/page.tsx`: move existing `app/page.tsx` logic (graph data load + `<GraphScreen />`) here
- [ ] **T2** — Update `app/layout.tsx`: add `ThemeProvider` client component that reads `localStorage` and applies `data-theme` to `<html>` on first mount; remove theme init from `GraphScreen`
- [ ] **T3** — Update `GraphScreen.tsx`: remove theme state management (delegate to ThemeProvider); convert top-left title `<div>` to `<Link href="/">`
- [ ] **T4** — Create `app/project-city/page.tsx` + `components/ProjectCityScreen.tsx`: blank shell with matching chrome (title as back link, dark mode toggle)
- [ ] **T5** — Create `app/page.tsx` (new home screen): two-tile layout, theme-aware, links to `/graph` and `/project-city`

### Phase 2 — Polish

- [ ] **T6** — Add hover animations to home screen tiles (CSS transition, no libraries)
- [ ] **T7** — Verify light/dark theme consistency across all three pages
- [ ] **T8** — Test mobile/responsive layout for home screen tiles (stack vertically below ~640px)

---

## Out of Scope (This Phase)

- Project City graph/visualization implementation (follow-up PRD)
- Any changes to Notion sync, field config, or data model
- Authentication or multi-user concerns
- Any changes to GraphScreen internals beyond the title back-link and theme delegation

---

## Decisions

1. **App family name:** "Data Visualizer" — shown as the umbrella heading on the home screen above the tiles.
2. **Project City subtitle/description:** "navigate your data" (subtitle) / "A new way to visualize and navigate your projects. Coming soon." (tile description).
3. **Tile layout:** Side-by-side on desktop, stacked vertically on mobile (<640px breakpoint). Equal width (260px each).
4. **Dark mode toggle on home screen:** Same ☀/◑ symbols top-right — consistent across all pages.

---

## Files Affected

| File | Change |
|---|---|
| `app/page.tsx` | Replaced — becomes home screen |
| `app/graph/page.tsx` | New — moved from `app/page.tsx` |
| `app/project-city/page.tsx` | New |
| `app/layout.tsx` | Add ThemeProvider |
| `components/GraphScreen.tsx` | Remove theme init, title → Link |
| `components/ProjectCityScreen.tsx` | New |
| `components/ThemeProvider.tsx` | New (thin client component) |
