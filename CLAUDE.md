# CLAUDE.md

## Project Overview

This is a TypeScript/React project built on **Next.js (App Router)**. Primary languages: TypeScript, CSS. The codebase is a multi-view data visualization engine that pulls from **Notion** and renders data in several 3D/spatial modes using **Three.js**.

**Visualization modes:**
- `/graph` — "The Sphere": 3D node graph (sphere, seven, horse shape layouts)
- `/project-city` — "The City": walkable first-person 3D city, databases = neighborhoods, records = buildings
- `/project-mountain` — "The Mountain": ridge/peak terrain, height = data freshness
- `/project-timeline` — "The Line": spiral cylinder with per-person timelines indexed by date
- `/project-user` — User-centric spatial layout

**Key directories:**
- `app/` — Next.js App Router pages + API routes
- `components/` — React components (screen wrappers, canvas renderers, UI panels)
- `lib/` — Layout algorithms, Notion sync, types, storage utils
- `data/` — Disk-persisted JSON (graph.json, config.json, nodes/, schemas/)
- `scripts/` — CLI sync entrypoint (`npm run sync`)

**Run commands:**
```bash
npm run dev    # dev server at localhost:3000
npm run build  # production build
npm run sync   # pull data from Notion → data/
npm run lint   # ESLint
```

**Environment variables** (`.env.local`, not in git):
```
NOTION_TOKEN=ntn_...
NOTION_ROOT_PAGE=https://...
```

## Architecture

- **Data flow:** Notion sync writes `data/graph.json` and `data/config.json`. Next.js Server Components load these from disk and pass them to Client Components as props.
- **State:** No Redux/Zustand. Theme via React Context (`ThemeProvider`); UI state is component-local. Config changes POST to API routes which write back to `data/config.json`.
- **3D canvases** render fullscreen; UI panels overlay via `position: absolute`. Selection uses Three.js raycasting.
- **Central types** live in `lib/types.ts` — import from there, don't redefine.
- **Path alias:** `@/*` maps to the project root.

## UI & Styling

When making UI/layout changes, use simple pixel-based values rather than complex calculations. Avoid over-engineering spacing, sizing, or positioning logic — prefer straightforward CSS values that are easy to adjust.

- Theme colors use CSS custom properties (`var(--accent-warm)`, etc.) defined in `app/globals.css`. Always use these variables rather than hardcoded colors.
- Light/dark mode switches via `data-theme` attribute on the root element — no component-level theme logic needed.
- No component library is used. UI is hand-crafted with inline styles or Tailwind.
- Custom fonts: "Lora" (display), "DM Mono" (mono), "Geist" (body) — configured in `tailwind.config.ts`.

## Code Changes

Before editing, confirm which specific pages/components are affected. Do not assume a component exists on a page without verifying via file search. When removing or adding elements across multiple pages, enumerate all affected files first.

When removing code, check that any variables declared in the removed block are not referenced elsewhere. Run a grep for the variable name before finalizing the removal.

Each visualization mode is **independent** — `CityCanvas`, `GraphCanvas`, `MountainCanvas`, `TimelineCanvas`, and `UserCanvas` do not share rendering logic. Changes to one canvas do not affect others.

## 3D & Visualization

When implementing spatial/3D features, confirm the coordinate system and layout approach with the user before writing code. Do not assume how items should be distributed in space.

- Each mode has its own layout algorithm in `lib/` (`cityLayout.ts`, `mountainLayout.ts`, `timelineLayout.ts`, `graph/layout.ts`). Layout logic is pure functions — keep it separate from rendering.
- Node positions use MD5-based deterministic placement (`stablePosition()` in `lib/graph/layout.ts`) so positions are stable across reloads.
- `CityCanvas` is the most complex component (~1000 lines): first-person camera, WASD movement, jump/gravity, collision, and web-swing mechanics.
- `GraphCanvas` manages sphere simulation with velocity/momentum, three shape layouts, raycasting selection, and edge rendering.
