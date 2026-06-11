# RelationCity Design Document

## Overview

RelationCity is a local-first Next.js application that ingests structured content from one or more Notion workspaces and renders that content through several interactive visualization modes. The system treats Notion as the source of truth, performs an explicit sync into local JSON artifacts, and serves those artifacts through lightweight API routes and server-rendered pages.

The product is not a generic CRUD app. Its core value is alternative spatial metaphors over the same underlying graph:

- `The Sphere`: a general-purpose graph view.
- `The City`: databases as neighborhoods and records as buildings.
- `The Mountain`: databases as mountain ranges and records as peaks.
- `The Line`: people-centric timelines built from configured person fields.
- `The Archive`: a navigable library metaphor.
- `The Universe`: an orrery/cosmic hierarchy built from configured database tiers.

At a technical level, the application is a hybrid of:

- App Router pages for initial loading.
- Client-side React screens for interaction and UI state.
- Three.js-powered canvases for immersive scenes.
- File-backed persistence for cached graph data and app configuration.
- Direct Notion API integration for data ingestion.

## Goals

- Provide a fast local exploration experience over Notion data.
- Decouple expensive or rate-limited Notion reads from interactive browsing.
- Reuse one synced graph across multiple visual metaphors.
- Allow workspace-level and database-level configuration without introducing a full backend database.
- Preserve a local-first, low-ops deployment model.

## Non-Goals

- Real-time bidirectional editing back into Notion.
- Multi-user concurrent server-side state management.
- Strong access control beyond possession of local config and the running app.
- Large-scale distributed sync or background job orchestration.

## Product Shape

### Home Screen

`app/page.tsx` is a client-rendered launcher that presents the six available modes as stylized hex tiles. It also hosts workspace configuration entry points and theme-aware presentation. This page is the navigation shell rather than a dashboard with business logic.

### Visualization Modes

Each mode receives the same synced `GraphData` base model, then applies a mode-specific layout and interaction model:

- Graph mode uses graph nodes and edges directly.
- City and Mountain mode group by database and expose alternate camera/navigation systems.
- Timeline mode reinterprets records through person extraction and temporal positioning.
- Archive mode converts records into books placed on shelves.
- Orrery mode maps selected databases into explicit hierarchical celestial tiers.

This is the central architectural idea in the repo: one canonical synced dataset, many derived scene models.

## High-Level Architecture

```text
Notion API
  -> sync pipeline (`lib/notion/sync.ts`)
  -> local JSON artifacts in `data/`
  -> server pages / API routes
  -> client screens
  -> Three.js / React rendering
```

### Runtime Layers

1. Ingestion layer
   - Pulls databases and pages from Notion.
   - Extracts schemas, node details, field values, and edges.

2. Persistence layer
   - Writes graph/config/schema/detail JSON into the local filesystem.
   - Uses atomic file writes to reduce corruption risk.

3. API layer
   - Exposes thin JSON endpoints around local artifacts and config mutations.

4. Page layer
   - Server components load graph/config and pass them into screen components.

5. Experience layer
   - Client components manage UI state, filters, panels, keyboard shortcuts, local preferences, and scene behavior.

## Technology Stack

- Next.js 16 App Router
- React 19
- TypeScript
- Three.js
- Tailwind CSS available, but much of the UI is implemented with inline styles
- Local JSON files under `data/`
- Direct fetch-based Notion API client
- `tsx` for the sync script runner

## Repository Structure

### Application

- `app/`
  - Route pages for the launcher and each visualization mode.
  - API routes for graph access, node lookup, sync, config, schemas, settings, field config, and orrery config.

### Components

- `components/`
  - Screen-level orchestration components such as `ProjectCityScreen.tsx`.
  - Three.js-backed canvas components such as `CityCanvas.tsx`, `MountainCanvas.tsx`, `GraphCanvas.tsx`, `OrreryCanvas.tsx`, and `ArchiveCanvas.tsx`.
  - Shared panels and controls like `NodeDetailsPanel.tsx`, `DatabaseTogglePanel.tsx`, `FieldConfigPanel.tsx`, and `WorkspaceConfigModal.tsx`.

### Libraries

- `lib/`
  - Shared types and config constants.
  - Notion sync and API client.
  - Local storage helpers.
  - Layout algorithms per mode.

### Data

- `data/`
  - `graph.json`: canonical synced graph.
  - `nodes/`: per-node detail payloads.
  - `schemas/`: per-database schema snapshots.
  - `config.json`: app configuration, workspace settings, database color overrides, field config, and orrery config.

### Scripts

- `scripts/run-sync.ts`
  - CLI entry point to run a sync outside the web UI.

## Canonical Data Model

The app is organized around a shared graph model defined in `lib/types.ts`.

### GraphData

- `generatedAt`: sync timestamp.
- `nodes`: normalized records from Notion pages.
- `edges`: relations derived from Notion relation properties.
- `warnings`: sync/runtime warnings surfaced to the UI.

### GraphNode

A node stores both graph-level and view-agnostic metadata:

- record identity
- database identity and database name
- display color
- Notion URL
- creator and created time
- stable 2D seed coordinates
- extracted field values for filtering and mode-specific rendering

### NodeDetail

Per-node detail records are stored separately in `data/nodes/<id>.json`. This keeps the main graph payload compact while allowing the details panel to request richer node metadata on demand.

### DatabaseSchema

Each Notion database schema is materialized into a snapshot that captures:

- database id and name
- field ids, names, and types
- select-like option metadata where available

These schema snapshots drive field configuration and filtering in the UI.

### AppConfig

`config.json` combines several concerns:

- database color overrides
- last sync time
- legacy single-workspace settings
- multi-workspace settings
- field configuration per database
- orrery configuration

This file acts as the local control plane for the application.

## Sync and Ingestion Design

The sync pipeline in `lib/notion/sync.ts` is the most important backend module.

### Inputs

The sync reads configuration from:

- saved config in `data/config.json`
- environment fallback from `.env.local`

Supported settings:

- `NOTION_TOKEN`
- `NOTION_ROOT_PAGE`
- saved workspace token/root pages

### Discovery Strategy

The sync starts from one or more configured root pages and recursively scans block children to locate child databases. Discovery is breadth-first with:

- deduplication by database id
- a bounded traversal depth
- graceful handling of inaccessible branches

### Database Extraction

For each discovered database, the sync:

1. fetches database metadata
2. extracts schema information
3. chooses a display color using config override or fallback palette
4. queries all pages in the database with cursor-based pagination

### Page Normalization

Each Notion page becomes:

- a `GraphNode` in the main graph
- a `NodeDetail` artifact in `data/nodes`

Normalization includes:

- title extraction
- created-by extraction
- created-time capture
- description extraction from a `Description` rich text field when present
- field value extraction for supported scalar and list-like property types
- relation extraction for edge building

### Edge Extraction

Edges are derived only from Notion `relation` properties. Each relation produces a directed edge entry with:

- source node id
- target node id
- relation property name

The UI often treats this practically as a connected graph, but the stored representation remains explicit and simple.

### Position Seeding

The base graph uses deterministic coordinates from `lib/graph/layout.ts`, where an MD5 digest of the node id is mapped into stable x/y coordinates. This provides layout consistency across syncs without requiring a persistent layout database.

### Outputs

A sync produces:

- `data/graph.json`
- `data/nodes/*.json`
- `data/schemas/*.json`
- updated values in `data/config.json` where applicable

### Failure Handling

The sync is intentionally tolerant:

- missing credentials produce an empty graph with warnings instead of throwing
- inaccessible databases are skipped with warnings
- individual query failures do not necessarily abort the entire sync

This matches the app’s exploratory use case, but it also means partial sync success is a normal operating mode.

## Local Persistence Design

The persistence layer is intentionally simple.

### Storage Helpers

`lib/storage.ts` provides:

- recursive directory creation
- JSON reads with null-on-failure semantics
- atomic JSON writes via temp file + rename

### Why JSON Files

This design keeps the app easy to run locally:

- no Postgres or SQLite dependency
- easy inspection and debugging
- straightforward backup and reset behavior
- good fit for a single-user desktop-style workflow

### Tradeoffs

- no transactional coordination across multiple files
- no indexing for large data sets
- no concurrency control for multiple writers
- growing sync cost as workspace size grows

For the current product shape, this is a pragmatic choice rather than a long-term scale solution.

## API Design

The API routes are thin wrappers over local data and config.

### Read Endpoints

- `GET /api/graph`
  - returns `graph.json`, triggering sync if the graph does not exist yet
- `GET /api/node/:id`
  - returns a node detail file
- `GET /api/config`
  - returns app config
- `GET /api/settings`
  - returns workspace settings plus current sync warnings
- `GET /api/schemas`
  - aggregates all schema JSON files
- `GET /api/field-config`
  - returns per-database field configuration
- `GET /api/orrery-config`
  - returns saved orrery tier mapping

### Write Endpoints

- `POST /api/sync`
  - executes a sync and returns summary counts
- `POST /api/settings`
  - saves workspace configuration
- `POST /api/field-config`
  - saves the field configuration map
- `POST /api/orrery-config`
  - validates and saves the orrery mapping

### API Characteristics

- no authentication layer
- no versioning
- request validation is minimal and route-specific
- most routes assume trusted local usage

This is acceptable for a local app, but it should be called out explicitly because the same design is not safe for a public multi-user deployment.

## Page and Rendering Model

Each visualization route follows the same server-side pattern:

1. read `graph.json`
2. run sync if graph data is absent
3. read `config.json`
4. render a full-screen client screen with `initialGraph` and config props

This gives each page a fast warm-start once artifacts exist, while still allowing first-run usability.

### Benefits

- initial graph is available at first render
- client screens do not need to own first-load sync logic
- mode routes stay thin and consistent

### Drawbacks

- first request can block on sync
- no streaming or background hydration path for large workspaces
- duplicated page bootstrapping logic across route files

## Client Screen Architecture

Screen components such as `ProjectCityScreen.tsx`, `ProjectMountainScreen.tsx`, `ProjectGraphScreen.tsx`, `ProjectTimelineScreen.tsx`, and `ProjectOrreryScreen.tsx` own interaction state and compose the mode-specific canvas with shared controls.

### Shared Screen Pattern

Most screens implement the same structure:

- receive `initialGraph`, database colors, and optional last sync timestamp
- fetch schemas and field config client-side
- maintain enabled database selection state
- derive a colored graph
- derive a filtered graph using field filters
- manage node selection and a details panel
- expose keyboard shortcuts
- persist some presentation settings in `localStorage`

### Shared Interaction Concepts

- database enable/disable toggles
- details panel open/close behavior
- theme toggle via `ThemeProvider`
- empty-state prompt before any database is enabled
- mode-specific canvas opacity transitions

This repeated pattern gives the product coherence, but it also introduces duplication that could be consolidated into shared hooks.

## Visualization Mode Design

### The Sphere

Purpose:
- default graph exploration mode

Implementation notes:
- uses `GraphCanvas`
- supports alternate graph shapes
- can surface a configurable center text derived from selected node field values
- includes deep highlight behavior for showing extended graph connectivity

### The City

Purpose:
- spatial urban metaphor for databases and records

Implementation notes:
- uses `CityCanvas`
- supports first-person mode, flyover mode, fit-to-scene, labels, web/connectors, and several localStorage-backed tuning settings
- starts from an empty-state background and fades into the scene when databases are selected

### The Mountain

Purpose:
- terrain metaphor emphasizing grouped record clusters as ranges and peaks

Implementation notes:
- uses `MountainCanvas`
- mirrors much of the City screen architecture
- adds range labels and flyover-specific tuning

### The Line

Purpose:
- people-centric record exploration

Implementation notes:
- uses `TimelineCanvas`
- builds a person index from configured people/name fields and graph relationships
- supports person selection, grouping, and time-axis generation
- only meaningfully works when database field config identifies how a record maps to people

This mode is more configuration-sensitive than the others because the source graph is not inherently person-centric.

### The Archive

Purpose:
- immersive library metaphor with books, aisles, and first-person navigation

Implementation notes:
- `ArchiveCanvas` owns both scene rendering and associated overlays
- uses `computeArchiveLayout` from `lib/archiveLayout.ts`
- includes pointer-lock first-person navigation, overhead map behavior, book pull-out animation, signage, and scene theming

Unlike the other modes, Archive is less separated into screen plus canvas plus panels and more of a tightly integrated scene shell.

### The Universe

Purpose:
- explicit hierarchy-based visualization instead of generic graph projection

Implementation notes:
- depends on `OrreryConfig`
- `OrreryUniverseBuilder` is used to map databases to tier roles
- `OrreryCanvas` drives scale-based navigation from universe to galaxy to solar system to planet
- breadcrumb-based reverse navigation and speed controls are built into the experience

This mode is the most semantically opinionated. It requires the user to tell the system which databases represent galaxies, stars, planets, moons, and optional rings.

## Configuration Design

### Workspace Configuration

The app supports multi-workspace configuration in `app/api/settings/route.ts`.

Behavior:

- modern format uses `workspaces[]` and `activeWorkspaceId`
- legacy top-level `notionToken` and `rootPages` are still supported
- route logic mirrors the active workspace back into legacy fields for sync compatibility

This is a transitional design that prioritizes backward compatibility.

### Field Configuration

Per-database field configuration supports:

- panel visibility
- selected sphere field
- active filters
- optional database color override
- timeline-specific name field
- timeline-specific detail field

This is a key extensibility mechanism because it lets the same raw graph be interpreted differently without changing the sync format.

### Theme Configuration

Theme state is client-side only:

- stored in `localStorage`
- applied via `data-theme` on the document element
- consumed through CSS variables and component logic

### Orrery Configuration

Orrery configuration stores explicit tier mapping:

- galaxy database
- star database
- planet database
- moon database
- optional ring databases with subtype metadata

This is persisted inside `config.json`.

## Layout and Derived Model Design

The application separates canonical data from view-specific derived layouts.

### Base Graph Layout

- deterministic hash-based coordinate seed from node id
- simple and stable
- not force-directed

### Timeline Layout

`lib/timelineLayout.ts` performs substantial derived modeling:

- parses names from field values
- groups records into person entries
- resolves missing created times through neighbors or fallback date
- computes x positions by time or even spacing depending on density
- assigns records above/below the spine
- generates axis ticks

This is a good example of the repo’s general pattern: preserve the synced source graph, then compute richer semantics locally for a specific mode.

### Other Layout Modules

Additional layout libraries exist for:

- city
- mountain
- archive
- user/timeline
- orrery

The architecture favors mode-specific layout code over one abstract universal spatial model.

## Interaction and UX Conventions

The project has several recurring UX patterns:

- full-screen immersive scenes
- floating corner controls
- keyboard shortcuts such as `Q` for database panel and `E` for details
- mode-specific localStorage preferences
- separate background/empty state before a database subset is enabled
- details panels loaded independently from the main graph

These patterns are consistent enough that new modes should follow them unless there is a strong reason not to.

## Security and Privacy Considerations

### Current Model

This app assumes trusted local usage.

Implications:

- Notion credentials can exist in `.env.local` or local config artifacts.
- API routes do not enforce authentication.
- Data is written unencrypted to local JSON files.

### Risks

- running this as a hosted public service would expose serious security gaps
- local file persistence can leak sensitive workspace content if the machine is shared or compromised
- tokens in config files increase blast radius compared to environment-only storage

### Recommendation

Document clearly that the current architecture is suitable for local or otherwise trusted deployments only.

## Performance Characteristics

### What Helps Performance

- local cached graph instead of live Notion requests during browsing
- server page preload from filesystem
- per-node detail files instead of shipping all detail payloads in the main graph
- deterministic layout seeding with minimal computation
- mode-specific filtering before rendering

### Likely Bottlenecks

- initial sync latency on large workspaces
- heavy client-side Three.js scenes
- large in-memory graph copies during filtering and recoloring
- repeated per-screen fetching of schemas and field config
- lack of pagination or chunking in graph transport

### Observed Scaling Constraint

The architecture is optimized for personal or moderate-sized workspaces, not very large enterprise datasets.

## Reliability Characteristics

### Strengths

- local-first cached data avoids dependency on live Notion availability during browsing
- atomic writes reduce risk of partially written JSON artifacts
- tolerant sync produces warnings instead of hard failure in many cases

### Weaknesses

- multiple artifact files can drift if a sync is interrupted mid-run
- no checksum/version marker to guarantee cross-file consistency
- no explicit schema migration framework for `config.json`
- read failures are often collapsed into `null`, which can hide root causes

## Design Tradeoffs

### Why the Current Design Works

- fast to iterate on
- easy to understand
- easy to run without infrastructure
- well matched to a highly visual exploratory prototype/product

### What It Sacrifices

- backend rigor
- strong typed contracts across persisted artifacts
- reuse across screen implementations
- hosting readiness
- observability

This is a reasonable trade for the current stage, but the trade should stay explicit.

## Key Gaps and Risks

### 1. Backend/data concerns are under-abstracted

Sync, file persistence, and config concerns are practical but tightly coupled. `config.json` now acts as credentials store, workspace registry, visualization config store, and orrery settings store.

### 2. Screen orchestration is repetitive

Graph, City, Mountain, and Timeline screens share substantial logic for:

- loading schemas
- loading field config
- maintaining enabled databases
- recoloring nodes
- applying filters
- panel handling
- keyboard shortcuts

This duplication raises maintenance cost and makes behavior drift likely.

### 3. Validation is shallow

Most API routes trust the client heavily. Invalid payloads can be written into config with limited normalization or structural guarantees.

### 4. First-load sync can be too expensive

Server pages run sync if `graph.json` is missing. That keeps first-run simple but also couples route latency to Notion availability and workspace size.

### 5. Security posture is local-only

The system is not safe to expose broadly in its current shape.

## Recommended Near-Term Improvements

### Architecture

- Extract a shared `useGraphScreenState` hook for the repeated screen orchestration logic.
- Separate `config.json` into at least:
  - workspace credentials/settings
  - visualization preferences
  - sync metadata
- Add a sync manifest with artifact version and sync status.

### Reliability

- Write all sync outputs into a staging directory and swap them into place only after successful completion.
- Add structured error logging around sync failures and JSON parsing failures.
- Add lightweight runtime validation for config and API payloads.

### Performance

- Cache `/api/schemas` and `/api/field-config` client-side or preload them server-side.
- Consider lazy loading heavier modes or scene-specific bundles.
- Add graph size metrics to the sync response and UI to make scaling problems visible.

### Security

- Prefer environment-based token storage over persisted token storage where possible.
- Add an explicit warning in setup docs that the app is designed for trusted environments only.

### Product

- Clarify which modes require extra configuration and surface setup guidance inline.
- Standardize mode bootstrapping, settings placement, and keyboard shortcut docs.

## Recommended Longer-Term Direction

If the project moves from local exploratory tool toward a more durable product, the likely next architectural step is:

1. keep Notion sync as a separate ingestion stage
2. move artifacts from ad hoc JSON files into a small local database such as SQLite
3. formalize derived models and schema/version migrations
4. centralize shared screen state and scene contracts
5. decide whether the app remains local-first or becomes a hosted multi-user product

That decision matters because the current architecture is strong for local-first use and weak for hosted use.

## Operational Notes

### Local Setup

Current developer flow:

1. install dependencies
2. create `.env.local`
3. run `npm run sync`
4. run `npm run dev`

### Sync Execution

Sync can be triggered:

- from the CLI via `npm run sync`
- from the web app through `POST /api/sync`
- implicitly on first page load if `graph.json` does not exist

### Cron/Scheduling

`node-cron` exists in dependencies and the repo has documentation around local cron behavior, but scheduled sync is not the primary operating model in the currently inspected code. The core assumption remains explicit manual or route-triggered sync.

## Proposed Engineering Principles for Future Work

- Treat `GraphData` as the canonical normalized core.
- Keep mode-specific semantics in derived layout/model layers.
- Preserve local-first operation as a first-class constraint unless the product direction changes.
- Reduce duplicated screen orchestration before adding more modes.
- Make configuration safer and more explicit before expanding deployment scenarios.

## File Reference Summary

Key implementation files:

- `app/page.tsx`
- `app/graph/page.tsx`
- `app/project-city/page.tsx`
- `app/project-mountain/page.tsx`
- `app/project-timeline/page.tsx`
- `app/project-archive/page.tsx`
- `app/project-orrery/page.tsx`
- `app/api/sync/route.ts`
- `app/api/settings/route.ts`
- `app/api/field-config/route.ts`
- `app/api/orrery-config/route.ts`
- `lib/notion/sync.ts`
- `lib/notion/client.ts`
- `lib/storage.ts`
- `lib/types.ts`
- `lib/timelineLayout.ts`
- `lib/graph/layout.ts`
- `components/ProjectGraphScreen.tsx`
- `components/ProjectCityScreen.tsx`
- `components/ProjectMountainScreen.tsx`
- `components/ProjectTimelineScreen.tsx`
- `components/ProjectOrreryScreen.tsx`
- `components/ArchiveCanvas.tsx`

## Conclusion

RelationCity is architecturally coherent around one strong idea: sync once from Notion, then reinterpret that normalized graph through multiple immersive metaphors. The current implementation is well suited to local-first exploration and rapid iteration. Its main limitations are not conceptual; they are around repetition, validation, artifact consistency, and the fact that the security model assumes a trusted environment. Those are solvable problems, but they should be addressed deliberately before the project grows much further.
