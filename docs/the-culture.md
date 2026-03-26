PRD: The Culture — Temporal Network Growth Visualization
Overview
The Culture is a new visualization mode for RelationMap that renders knowledge/work records as a living, growing organism. Nodes appear at the center of a flat 2D plane (rendered as 3D spheres) when they were created, pushing older nodes outward as new ones arrive. A playable timeline at the bottom scrubs through the full history of all records. Node size reflects connection count and grows as relations accumulate. The result looks like a petri dish culture expanding over time.

Route: /project-culture
Nav label: "The Culture"

Goals
Show how a body of work grew over time — what was created when, what connected to what
Reveal which nodes became "hubs" (large, well-connected) vs. "satellites" (small, peripheral)
Allow playback at variable speed so the user can watch the entire history in seconds
Maintain visual and interaction consistency with the rest of the app, especially the graph mode
Data Requirements
createdTime field on GraphNode
The existing GraphNode type already includes createdTime: string (ISO 8601 timestamp from Notion). This is the primary temporal field.

Nodes without a createdTime (null/empty string) are excluded from this visualization entirely. They will not appear in the panel count or on the canvas.

Edge timestamps
Edges (GraphEdge) do not have timestamps. A relation "appears" in the visualization at the createdTime of the later of its two endpoint nodes. This is a reasonable proxy — a connection can only visually exist once both nodes exist.

Layout & Physics
Flat plane
All nodes live on Z=0. The camera looks straight down (top-down orthographic or very shallow perspective). No rotation controls — this is intentionally 2D.

Sphere appearance
Nodes are rendered as 3D-looking spheres using SVG radial gradients (highlight at top-left, shadow at bottom-right), consistent with the graph mode's aesthetic language but on a flat plane rather than a 3D globe.

Arrival animation
When a node first appears (during playback or when the timeline scrubs to its createdTime):

It materializes at the canvas center (or near-center with slight random jitter ±20px)
Scales from 0 → target radius over ~400ms with an ease-out curve
Immediately begins participating in the force simulation
Force-directed layout
Nodes repel each other using a force simulation (D3-force style, or hand-rolled):

Repulsion: All nodes repel. New nodes push existing nodes outward.
Center pull: A gentle gravity toward center (low strength) keeps the cluster from flying apart
Link attraction: Connected nodes attract each other (short, flexible springs)
Collision: Nodes cannot overlap (radius-based collision)
This means: earliest nodes start at center → get pushed outward as new nodes arrive → eventually settle at the periphery. Highly connected nodes pull their cluster toward the center of mass of their relations.

Node size

baseRadius = 8px
radius = baseRadius + sqrt(connectionCount) * 4
Connection count is cumulative at the current playback time — only edges whose both endpoints have appeared by the current timestamp are counted. Size updates live during playback.

Playback Controls
Timeline slider (bottom of screen)
Full-width horizontal scrubber
Left end = earliest createdTime across all visible nodes
Right end = latest createdTime (or current date)
Tick marks at month/year intervals (auto-scaled based on date range)
Current timestamp label displayed above the scrub handle
Draggable: scrubbing backward removes nodes that haven't been created yet (they fade out); scrubbing forward adds them
Play / Pause button
Left of the timeline
Keyboard shortcut: Space
When playing, time advances at the configured speed
Speed control
Dropdown or segmented control next to play button
Options: 0.5×, 1×, 2×, 5×, 10× (where 1× = 1 month per second)
Persisted to config.json under cultureConfig.playbackSpeed
Also accessible in Settings panel
Reset button
Returns timeline to start, clears all nodes from canvas
Database Selection Panel
Reuses DatabaseTogglePanel with one addition:

"Select All" toggle at the top of the panel:

A single row above the database list: ● All Databases with a toggle button
When enabled: enables all databases at once
When partially selected: shows an indeterminate state (half-filled dot)
When any individual database is toggled off, "Select All" returns to partial state
Mirrors the existing collapse/expand UX of the panel
The panel retains all existing functionality: draggable, collapsible, per-database color indicators, settings (⚙) per database.

Connection Lines
Thin lines between connected node pairs (SVG <line> elements)
Only drawn when both endpoints have "appeared" by the current playback time
Default: visible
Toggle in Settings panel: Show Relations (boolean, default on)
Line color: mid-opacity white in dark mode / mid-opacity dark in light mode
Lines do not animate when they first appear — they just render on the next frame
When a node is selected (clicked), its connection lines highlight orange (same as graph mode)
Settings Panel
Extends the existing SettingsPanel pattern with a new section for this mode:

Display section:

Show Relations — toggle (default: on)
Node Size Scale — slider (0.5× to 2×, default 1×)
Playback section:

Playback Speed — 0.5× / 1× / 2× / 5× / 10×
Time Unit Label — per second (informational, shows "1 month = 1s at 1×")
Node Selection & Detail Panel
Reuses NodeDetailsPanel exactly as-is. Click a node → right panel slides in with full node details, fields, and relations. Keyboard: E to close, arrow keys to navigate to connected nodes.

Home Screen Integration
Add "The Culture" as a new hexagonal tile on app/page.tsx home screen:

Label: "The Culture"
Subtitle: "Growth over time"
Icon: a new image (petri dish / bloom aesthetic) — placeholder can use an existing icon initially
File Plan
File	Action	Notes
app/project-culture/page.tsx	Create	Server component, loads graph.json + config.json, renders ProjectCultureScreen
components/ProjectCultureScreen.tsx	Create	Screen wrapper — state, filtering, database panel, settings panel
components/CultureCanvas.tsx	Create	Main canvas — force simulation, SVG rendering, timeline, playback
lib/cultureLayout.ts	Create	Force simulation logic (pure functions)
lib/types.ts	Edit	Add CultureConfig type, extend AppConfig
components/DatabaseTogglePanel.tsx	Edit	Add "Select All" toggle row
app/page.tsx	Edit	Add Culture tile to home screen
app/api/config/route.ts	Edit (if needed)	Ensure cultureConfig is saved/loaded
New Types

// lib/types.ts additions

interface CultureConfig {
  playbackSpeed: number;      // months per second (default: 1)
  showRelations: boolean;     // default: true
  nodeSizeScale: number;      // multiplier (default: 1)
}

// Extend AppConfig:
interface AppConfig {
  // ... existing fields ...
  cultureConfig?: CultureConfig;
}
Rendering Architecture
CultureCanvas is an SVG-based canvas component (consistent with GraphCanvas).

State:

currentTime: Date — the scrub position
isPlaying: boolean
nodes: CultureNode[] — nodes visible at currentTime (subset of all nodes with createdTime ≤ currentTime)
positions: Map<string, {x, y, vx, vy}> — force simulation state
selectedNode: string | null
Render loop:

requestAnimationFrame when playing
Each frame: advance currentTime by (Δms × playbackSpeed) / msPerMonth
Determine which nodes are now visible (binary search on sorted createdTime array)
Run N ticks of force simulation (N=3 per frame works well)
Re-render SVG
Force simulation (lib/cultureLayout.ts):


tick(nodes, edges, positions, config):
  for each node pair → apply repulsion force (1/distance²)
  for each edge → apply spring attraction
  for each node → apply weak center gravity
  apply collision detection (prevent overlap by radius)
  integrate velocities with damping (0.85)
  clamp positions to canvas bounds
Out of Scope (v1)
No 3D camera rotation (intentionally flat)
No "date" field from Notion record — using createdTime only in v1. User noted they'll ensure this field is populated in Notion. A future version could use a configurable date field per database.
No clustering by database in the layout — nodes mix freely
No node labels visible by default during playback (shown on hover/select only, for performance)
No export/screenshot feature
Open Questions for You
"Select All" behavior when new databases are added (after sync) — should "Select All" auto-enable newly synced databases, or preserve previous individual choices?

Force simulation persistence — when scrubbing backward in time (removing nodes), should the remaining nodes snap back toward center or keep their current positions? Snapping back feels more correct biologically but may be jarring.

Date field vs. createdTime — you mentioned wanting to use a configurable "date" field per database in the future. Should v1 expose a per-database "time field" selector in the Field Config panel, or is createdTime locked for v1?

Home screen icon — do you want to provide an image for the Culture tile, or use a placeholder/emoji-style SVG for now?

The name — "The Culture" is my top recommendation. Want to go with that, or prefer one of the others?