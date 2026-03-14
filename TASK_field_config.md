# Task: Per-Database Field Configuration — Filtering, Visibility & Sphere Display

## Overview

Enhance the RelationMap tool so that after sync, every field (property) from each Notion database is pulled in with its type and options. Users can then:

1. **Filter** nodes by select / multi-select field values (hide nodes that don't match)
2. **Toggle side-panel visibility** per field (eye icon — show/hide a field in the details panel)
3. **Toggle sphere-center display** per text field (second eye icon — choose which text field shows in the center of the sphere when a node is selected)

The entry point is a small right-pointing caret (`›`) next to each database name in the existing DatabaseTogglePanel. Clicking it slides open a sub-panel that lists that database's fields with the controls above.

---

## Current State

| Area | What exists today |
|---|---|
| Sync | Pulls title, rich_text "description", relation fields |
| DatabaseTogglePanel | Show/hide entire databases, color dot, count |
| NodeDetailsPanel | Shows name, database, date/time, description, connections |
| Sphere center | Shows `description` field text when selected node has one |
| Config | `AppConfig` stores colors, token, root pages — no field config |

---

## What Needs to Be Built

### Phase 1 — Sync: Pull & Store Database Schemas

**Goal:** During sync, extract the full property schema for every database and store per-page property values for filterable/displayable fields.

#### 1a. New types (`lib/types.ts`)

```typescript
// One option entry for select / multi_select
type FieldOption = {
  id: string;
  name: string;
  color: string; // Notion color name, e.g. "green", "red"
};

// Schema for a single property on a database
type DatabaseField = {
  id: string;          // Notion property ID
  name: string;        // Property name (e.g. "Status", "Tags")
  type: NotionFieldType;
  options?: FieldOption[]; // populated for select / multi_select / status
};

type NotionFieldType =
  | "title" | "rich_text" | "select" | "multi_select"
  | "status" | "number" | "date" | "checkbox"
  | "people" | "email" | "phone_number" | "url"
  | "relation" | "formula" | "rollup" | "files"
  | "created_time" | "created_by" | "last_edited_time" | "last_edited_by"
  | string; // forward-compat catch-all

// Schema for one database — stored in /data/schemas/{databaseId}.json
type DatabaseSchema = {
  databaseId: string;
  databaseName: string;
  fields: DatabaseField[];
};

// Per-page property values for filterable/displayable fields
// Stored inside the NodeDetail file
type NodeFieldValues = Record<
  string, // property name
  string | string[] | null // rendered value(s) — null if missing
>;
```

**Add to `NodeDetail`:**
```typescript
type NodeDetail = {
  ...existing fields...
  fieldValues?: NodeFieldValues; // all non-relation, non-title property values
};
```

**Add to `AppConfig`:**
```typescript
type AppConfig = {
  ...existing fields...
  fieldConfig?: Record<string, DatabaseFieldConfig>; // keyed by databaseId
};

type DatabaseFieldConfig = {
  // Fields shown in the side panel (default: all except relation/formula/rollup)
  panelVisible: Record<string, boolean>; // fieldName -> visible
  // The ONE text field shown in the sphere center (default: "description" if exists)
  sphereField: string | null; // fieldName, or null
  // Active filter selections per select/multi_select/status field
  // Empty array = all values shown (no filter)
  activeFilters: Record<string, string[]>; // fieldName -> selected option names
};
```

#### 1b. Sync changes (`lib/notion/sync.ts`)

- After fetching `dbInfo`, extract `dbInfo.properties` to build `DatabaseSchema`
- Save to `/data/schemas/{databaseId}.json`
- When processing each page, extract field values for all non-relation, non-title properties:
  - `rich_text` → `plain_text` joined
  - `select` → `name`
  - `multi_select` → array of `name`
  - `status` → `name`
  - `number` → string representation
  - `checkbox` → `"Yes"` / `"No"`
  - `date` → ISO string
  - `people` → array of names
  - `url`, `email`, `phone_number` → raw string
  - Everything else → skip / null
- Store these values in the node's detail JSON (`fieldValues`)

#### 1c. New config path (`lib/config.ts`)

```typescript
export const SCHEMAS_DIR = path.join(DATA_DIR, "schemas");
```

#### 1d. New API routes

- `GET /api/schemas` — returns all `DatabaseSchema` objects (reads from `/data/schemas/`)
- `GET /api/field-config` — returns `AppConfig.fieldConfig`
- `POST /api/field-config` — saves updated `fieldConfig` back to `config.json`

---

### Phase 2 — DatabaseTogglePanel: Caret & Field Sub-Panel

**Goal:** Add a `›` caret to each database row. Clicking it opens a slide-in sub-panel anchored to the right of the DatabaseTogglePanel, showing all fields for that database.

#### UI Layout

```
┌─────────────────────┐  ┌─────────────────────────────────────────┐
│  Databases      3/5 │  │  Projects — Fields                    ✕ │
├─────────────────────┤  ├─────────────────────────────────────────┤
│ ● Projects       ›  │  │  Status                 select          │
│ ● Glossary       ›  │  │    ● Not Started  ◉ In Progress ● Done │
│ ● Documents      ›  │  │    ● Blocked                            │
│ ● Resources      ›  │  │  ─────────────────────────────────────  │
│ ○ Archive        ›  │  │  Tags             multi_select          │
└─────────────────────┘  │    ◉ Frontend  ◉ Backend  ● Design     │
                         │  ─────────────────────────────────────  │
                         │  Description      rich_text    👁 💠    │
                         │  Notes            rich_text    👁 💠    │
                         │  Due Date         date         👁       │
                         │  Owner            people       👁       │
                         └─────────────────────────────────────────┘
```

**Legend:**
- `👁` = visible in side panel (toggle on/off)
- `💠` = shown in sphere center (radio — only one per database)
- Colored pills for select/multi_select options (click to toggle filter active/inactive)

#### Behavior Details

- **Caret click** → opens field sub-panel, closes any other open sub-panel
- **Sub-panel position** → slides in from the right of the DatabaseTogglePanel (or appears to the right, overlapping the sphere)
- **Sub-panel close** → `✕` button, or clicking a different database's caret
- **Filterable types**: `select`, `multi_select`, `status`
  - Show option pills. Active = highlighted with Notion color. Inactive = grayed out.
  - When no options selected = show all nodes (no filter applied). This is the default.
  - Deselecting all re-enables everything (same as "no filter")
  - Selecting one or more = only show nodes where that field matches one of the selected options
- **Panel-visible eye** (`👁`): appears on all non-relation, non-title, non-formula fields
  - Default: ON for most fields (at minimum: name, database, date, description if present)
  - Toggling OFF hides that field from the NodeDetailsPanel for this database
- **Sphere-field radio** (`💠`): appears only on `rich_text` fields (and `title` optionally)
  - Only one can be active per database at a time (radio behavior)
  - Default: the field named "description" if it exists, otherwise none
  - When active, that field's text shows in the center of the sphere when a node from this database is selected

---

### Phase 3 — NodeDetailsPanel: Respect Field Config

**Goal:** Show/hide fields in the side panel based on per-database `panelVisible` config.

- When `fieldConfig` is loaded, filter the displayed fields to only those with `panelVisible[fieldName] === true`
- For `fieldValues` entries: display them in the panel body below the existing metadata fields
- Preserve hardcoded fields (name, database, date/time) unless explicitly hidden
- Field display order: hardcoded fields first, then `fieldValues` in schema order

---

### Phase 4 — GraphCanvas / GraphScreen: Sphere Center Driven by Config

**Goal:** Replace the hardcoded "show description if present" logic with config-driven sphere field selection.

- Read `fieldConfig[databaseId].sphereField` for the selected node's database
- Use that field name to look up the value from `selectedDetail.fieldValues`
- If no sphere field is configured (or value is empty), show nothing in center
- Pass the computed text string down to `GraphCanvas` as `sphereCenterText`

---

### Phase 5 — Node Filtering by Field Values

**Goal:** Filter visible nodes based on active filter selections.

- `GraphScreen` loads `fieldConfig` (from API or state)
- For each enabled database, check `fieldConfig[dbId].activeFilters`
- A node passes filter if for every field with active selections, the node's `fieldValues[fieldName]` includes at least one of the selected option names
- Filtered nodes are excluded from `filteredGraph` (same as toggling a database off)
- Edges are also filtered to only include nodes that pass

---

## Data Flow Diagram

```
Notion API
    │
    ▼
runSync()
    ├── DatabaseSchema[] → /data/schemas/{dbId}.json
    ├── GraphNode[] + GraphEdge[] → /data/graph.json
    └── NodeDetail (with fieldValues) → /data/nodes/{id}.json
         │
         ▼
GET /api/schemas      → DatabaseSchema[]
GET /api/field-config → DatabaseFieldConfig per dbId
POST /api/field-config ← user changes (filters, visibility, sphere field)
         │
         ▼
GraphScreen
    ├── fieldConfig state (loaded from API, updated via field sub-panel)
    ├── filteredGraph (nodes filtered by enabledDbs AND activeFilters)
    ├── selectedDetail (NodeDetail with fieldValues)
    └── sphereCenterText (derived from fieldConfig + selectedDetail.fieldValues)
         │
    ┌────┴──────────────────────────────────────────┐
    ▼                                               ▼
GraphCanvas                               NodeDetailsPanel
  sphereCenterText overlay                  fieldValues + panelVisible config
         │
    ┌────┴──────────────────┐
    ▼                       ▼
DatabaseTogglePanel    Field Sub-Panel
  [db name]  ›           Fields list
                          - filter pills (select/multi)
                          - 👁 panel visibility
                          - 💠 sphere field (radio)
```

---

## Files to Create / Modify

| File | Action | What Changes |
|---|---|---|
| `lib/types.ts` | Modify | Add `DatabaseField`, `DatabaseSchema`, `DatabaseFieldConfig`, `NodeFieldValues`; extend `NodeDetail`, `AppConfig` |
| `lib/config.ts` | Modify | Add `SCHEMAS_DIR` constant |
| `lib/notion/sync.ts` | Modify | Extract schema from dbInfo.properties; extract fieldValues per page; write schemas |
| `lib/storage.ts` | No change | Already has readJsonFile/writeJsonAtomic |
| `app/api/schemas/route.ts` | Create | GET — return all database schemas |
| `app/api/field-config/route.ts` | Create | GET + POST — read/write fieldConfig in config.json |
| `components/DatabaseTogglePanel.tsx` | Modify | Add caret button per row; manage open sub-panel state |
| `components/FieldConfigPanel.tsx` | Create | New component — the field sub-panel with filters, eye toggles, sphere radio |
| `components/NodeDetailsPanel.tsx` | Modify | Consume fieldValues + panelVisible to show/hide fields |
| `components/GraphScreen.tsx` | Modify | Load schemas + fieldConfig; compute sphereCenterText; apply activeFilters to filteredGraph |
| `components/GraphCanvas.tsx` | Modify | Replace `selectedDetail.description` logic with `sphereCenterText` prop |

---

## Open Questions / Decisions to Make Before Starting

1. **Sub-panel position**: Should the field sub-panel slide out to the right of the DatabaseTogglePanel (pinned to it), or should it be a fixed-width panel on the far left edge of the screen (like a second column)?

2. **Filter semantics for multi-select**: If a node has tags `[Frontend, Backend]` and the user selects only `Frontend` as active — does the node show? Suggested: yes (OR logic within a field, AND logic across fields).

3. **Default sphere field**: Should it default to the field literally named "description", or should the user explicitly pick one? Suggested: auto-default to "description" if it exists, otherwise none.

4. **Config persistence**: Field config (filters, visibility, sphere field) is saved to `data/config.json` via `POST /api/field-config`. Should filter state also be in localStorage for instant restore? Suggested: server-side only for now.

5. **Notion color mapping**: Notion returns color names like `"green"`, `"red"`, `"blue"` etc. Should we map these to hex values, or use a predefined CSS variable palette?

6. **Performance**: With 5000+ nodes and per-node `fieldValues`, the node JSON files grow. Is that acceptable, or should fieldValues be stored in a separate lookup file per database?

---

## Suggested Implementation Order

1. **Phase 1** (sync + types + API routes) — foundation, no UI yet, run a sync to populate data
2. **Phase 4** (sphere center config) — quick win, replaces existing hardcoded logic
3. **Phase 2** (DatabaseTogglePanel caret + FieldConfigPanel) — core new UI
4. **Phase 3** (NodeDetailsPanel field values + visibility) — side panel enhancement
5. **Phase 5** (node filtering) — most complex, depends on all prior phases
