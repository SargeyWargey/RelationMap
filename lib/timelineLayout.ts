import type { GraphData, GraphNode, DatabaseFieldConfig } from "./types";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Fallback createdTime when no date can be resolved (matches project default). */
const FALLBACK_DATE = "2025-11-02T00:00:00Z";

/**
 * Panel usable width in world units. Cards are placed within [0, PANEL_WIDTH].
 * Left/right margins are applied via PANEL_MARGIN.
 */
export const PANEL_WIDTH       = 2400;
export const PANEL_MARGIN      = 120;   // horizontal padding on each side of the spine
export const BRANCH_HEIGHT     = 160;   // Y distance from spine center to card center
export const MIN_NODE_SPACING  = 220;   // world units minimum gap between node xPositions

/** If a person has more than this many nodes, use even spacing instead of time-proportional. */
const EVEN_SPACING_THRESHOLD = 15;

// ─── Exported types ───────────────────────────────────────────────────────────

export type PersonNode = {
  nodeId:       string;
  nodeName:     string;
  databaseId:   string;
  databaseName: string;
  color:        string;
  createdTime:  string;   // after fallback resolution
  notionUrl:    string;
  xPosition:    number;   // world X within panel local space
  side:         "above" | "below";
  stackIndex:   number;   // 0 = front of stack; >0 = stacked behind (Z offset)
  branchHeight: number;   // Y distance from spine to card center (may be staggered)
  fieldValues?: import("./types").NodeFieldValues;  // raw field values for detail field rendering
};

export type PersonEntry = {
  key:          string;        // lowercased canonical key
  displayName:  string;        // first-seen original casing
  panelIndex:   number;        // position on cylinder (alphabetical sort order)
  nodes:        PersonNode[];  // laid-out records for this person
  effectiveWidth: number;      // total world-unit width needed to display all nodes
};

export type TimeAxisTick = {
  xPosition: number;   // world X within panel
  label:     string;   // e.g. "Jan 2026" or "2025"
};

// ─── Name parsing ─────────────────────────────────────────────────────────────

/**
 * Parse a raw field value into an array of trimmed person name tokens.
 *
 * Handles:
 *   - null / undefined → []
 *   - string array     → trimmed, filtered
 *   - comma-separated string → split, trimmed, filtered
 *   - single name string    → [name]
 */
export function parseNamesFromFieldValue(
  value: string | string[] | null | undefined
): string[] {
  if (value == null) return [];

  if (Array.isArray(value)) {
    return value
      .flatMap((v) => v.split(","))
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  // String: split on comma
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// ─── Private helpers ──────────────────────────────────────────────────────────

/**
 * Build a neighbor map (nodeId → Set<nodeId>) from the edge list.
 */
function buildNeighborMap(data: GraphData): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const node of data.nodes) map.set(node.id, new Set());
  for (const edge of data.edges) {
    map.get(edge.source)?.add(edge.target);
    map.get(edge.target)?.add(edge.source);
  }
  return map;
}

/**
 * Three-tier createdTime fallback:
 *   1. Node's own createdTime
 *   2. Oldest connected neighbor's createdTime
 *   3. FALLBACK_DATE
 */
function resolveCreatedTime(
  node:        GraphNode,
  nodeById:    Map<string, GraphNode>,
  neighborMap: Map<string, Set<string>>
): string {
  if (node.createdTime) return node.createdTime;

  let oldest: string | null = null;
  for (const nid of neighborMap.get(node.id) ?? []) {
    const d = nodeById.get(nid)?.createdTime;
    if (d && (!oldest || d < oldest)) oldest = d;
  }
  return oldest ?? FALLBACK_DATE;
}

// ─── Time-axis layout ─────────────────────────────────────────────────────────

/**
 * Map a resolved ISO date string to a world X position within the panel.
 *
 * Newest → left (small X), Oldest → right (large X).
 * If only one record, center it.
 */
function computeXPositions(
  nodes: Array<{ createdTime: string }>
): { xMap: Map<number, number>; effectiveWidth: number } {
  const xMap = new Map<number, number>();
  if (nodes.length === 0) return { xMap, effectiveWidth: PANEL_WIDTH };

  const n = nodes.length;

  // Always ensure at least MIN_NODE_SPACING per node
  const minWidthForSpacing = PANEL_MARGIN * 2 + n * MIN_NODE_SPACING;

  if (n === 1) {
    const w = Math.max(PANEL_WIDTH, minWidthForSpacing);
    xMap.set(0, PANEL_MARGIN + (w - PANEL_MARGIN * 2) / 2);
    return { xMap, effectiveWidth: w };
  }

  if (n > EVEN_SPACING_THRESHOLD) {
    // Even spacing: sort nodes newest→oldest, assign evenly spaced positions left→right
    const sortedIdxs = nodes
      .map((node, i) => ({ i, ts: new Date(node.createdTime).getTime() }))
      .sort((a, b) => b.ts - a.ts); // newest first = leftmost

    // Width: each node gets MIN_NODE_SPACING, plus margins
    const effectiveWidth = Math.max(PANEL_WIDTH, minWidthForSpacing);
    const usable = effectiveWidth - PANEL_MARGIN * 2;
    const step = usable / (n - 1);

    sortedIdxs.forEach(({ i }, sortPos) => {
      xMap.set(i, PANEL_MARGIN + sortPos * step);
    });

    return { xMap, effectiveWidth };
  }

  // Time-proportional spacing for ≤ EVEN_SPACING_THRESHOLD nodes
  const timestamps = nodes.map((n) => new Date(n.createdTime).getTime());
  const maxTs = Math.max(...timestamps);
  const minTs = Math.min(...timestamps);
  const range = maxTs - minTs;
  const margin = range * 0.1;
  const effectiveRange = range + 2 * margin;

  // Use at least PANEL_WIDTH, expand if nodes would overlap
  const effectiveWidth = Math.max(PANEL_WIDTH, minWidthForSpacing);
  const usable = effectiveWidth - PANEL_MARGIN * 2;

  for (let i = 0; i < nodes.length; i++) {
    const ts = timestamps[i];
    const ratio = effectiveRange > 0 ? (maxTs + margin - ts) / effectiveRange : 0.5;
    xMap.set(i, PANEL_MARGIN + ratio * usable);
  }

  return { xMap, effectiveWidth };
}

/**
 * Generate year/month tick marks for a set of PersonNodes.
 * Returns ticks with world X positions matching the node x-position scale.
 */
export function generateTimeAxisTicks(nodes: PersonNode[], effectiveWidth?: number): TimeAxisTick[] {
  if (nodes.length === 0) return [];

  const timestamps = nodes.map((n) => new Date(n.createdTime).getTime());
  const maxTs = Math.max(...timestamps);
  const minTs = Math.min(...timestamps);
  const rangeMs = maxTs - minTs;

  const DAY_MS   = 86_400_000;
  const MONTH_MS = 30 * DAY_MS;
  const YEAR_MS  = 365 * DAY_MS;

  type Granularity = "year" | "month" | "week";
  let granularity: Granularity = "month";
  if (rangeMs > 3 * YEAR_MS)  granularity = "year";
  else if (rangeMs < 3 * MONTH_MS) granularity = "week";

  const panelW = effectiveWidth ?? PANEL_WIDTH;
  const usable = panelW - PANEL_MARGIN * 2;
  const marginMs = rangeMs * 0.1;
  const effectiveRange = rangeMs + 2 * marginMs;

  function tsToX(ts: number): number {
    if (effectiveRange <= 0) return PANEL_MARGIN + usable / 2;
    const ratio = (maxTs + marginMs - ts) / effectiveRange;
    return PANEL_MARGIN + ratio * usable;
  }

  const ticks: TimeAxisTick[] = [];
  const start = new Date(minTs - marginMs);
  const end   = new Date(maxTs + marginMs);

  if (granularity === "year") {
    for (let y = start.getFullYear(); y <= end.getFullYear(); y++) {
      const ts = new Date(y, 0, 1).getTime();
      ticks.push({ xPosition: tsToX(ts), label: String(y) });
    }
  } else if (granularity === "month") {
    let d = new Date(start.getFullYear(), start.getMonth(), 1);
    while (d.getTime() <= end.getTime()) {
      ticks.push({
        xPosition: tsToX(d.getTime()),
        label: d.toLocaleDateString("en-US", { month: "short", year: "numeric" }),
      });
      d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    }
  } else {
    const WEEK_MS = 7 * DAY_MS;
    let ts = Math.floor(start.getTime() / WEEK_MS) * WEEK_MS;
    while (ts <= end.getTime()) {
      const d = new Date(ts);
      ticks.push({
        xPosition: tsToX(ts),
        label: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      });
      ts += WEEK_MS;
    }
  }

  return ticks;
}

// ─── Panel layout ─────────────────────────────────────────────────────────────

/**
 * Assign xPosition, side, and stackIndex to each PersonNode.
 *
 * Side assignment:
 *   - groupByDb=false: alternate above/below by time-sorted order index
 *   - groupByDb=true:  each database gets a fixed side (seeded by databaseId)
 *
 * Stack detection: nodes whose xPositions are within STACK_SNAP world units of
 * each other AND share the same databaseId are stacked. Within a stack, they
 * are ordered newest-front (stackIndex 0) to oldest-back.
 */
const STACK_SNAP = 30; // world units — nodes closer than this on same DB stack

export function layoutPersonPanel(
  rawNodes:   PersonNode[],
  groupByDb:  boolean,
  effectiveWidth: number = PANEL_WIDTH
): PersonNode[] {
  if (rawNodes.length === 0) return [];

  // Sort by createdTime descending (newest first) for side alternation
  const sorted = [...rawNodes].sort(
    (a, b) => new Date(b.createdTime).getTime() - new Date(a.createdTime).getTime()
  );

  // Deterministic side for groupByDb mode — hash databaseId to 0/1
  function dbSide(databaseId: string): "above" | "below" {
    let h = 2166136261;
    for (let i = 0; i < databaseId.length; i++) {
      h ^= databaseId.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0) % 2 === 0 ? "above" : "below";
  }

  // Assign sides
  const withSides = sorted.map((node, i): PersonNode => ({
    ...node,
    side: groupByDb ? dbSide(node.databaseId) : i % 2 === 0 ? "above" : "below",
  }));

  // Enforce minimum horizontal spacing between nodes to prevent label overlap
  // Sort by xPosition, then iteratively push nodes apart
  const spaced = [...withSides].sort((a, b) => a.xPosition - b.xPosition);
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 1; i < spaced.length; i++) {
      const gap = spaced[i].xPosition - spaced[i - 1].xPosition;
      if (gap < MIN_NODE_SPACING) {
        const push = (MIN_NODE_SPACING - gap) / 2;
        spaced[i - 1] = { ...spaced[i - 1], xPosition: spaced[i - 1].xPosition - push };
        spaced[i]     = { ...spaced[i],     xPosition: spaced[i].xPosition     + push };
      }
    }
    // Clamp to panel bounds (use effectiveWidth so wide timelines aren't squished)
    for (let i = 0; i < spaced.length; i++) {
      spaced[i] = { ...spaced[i], xPosition: Math.max(PANEL_MARGIN, Math.min(effectiveWidth - PANEL_MARGIN, spaced[i].xPosition)) };
    }
  }
  // Re-map spacing back to withSides order by nodeId
  const spacedById = new Map(spaced.map(n => [n.nodeId + n.databaseId, n.xPosition]));
  const withSpacing = withSides.map(n => ({ ...n, xPosition: spacedById.get(n.nodeId + n.databaseId) ?? n.xPosition }));

  // Assign staggered branch heights to prevent label collision on same side
  const withBranch = withSpacing.map((node, i): PersonNode => {
    const sameGroup = withSpacing.filter(
      (o, j) => j !== i && o.side === node.side && Math.abs(o.xPosition - node.xPosition) < MIN_NODE_SPACING * 2
    );
    const stagger = sameGroup.length > 0 ? (i % 2 === 0 ? 1.0 : 1.55) : 1.0;
    return { ...node, branchHeight: BRANCH_HEIGHT * stagger };
  });

  // Stack detection — group by databaseId, then find close-X neighbours
  // We process per-database to match PRD stacking rule
  const byDb = new Map<string, PersonNode[]>();
  for (const node of withBranch) {
    if (!byDb.has(node.databaseId)) byDb.set(node.databaseId, []);
    byDb.get(node.databaseId)!.push(node);
  }

  const result: PersonNode[] = [];

  for (const dbNodes of byDb.values()) {
    // Sort by xPosition ascending (left = newest already, so this groups clusters)
    const sorted2 = [...dbNodes].sort((a, b) => a.xPosition - b.xPosition);

    // Greedy clustering: assign stackIndex within each cluster
    const visited = new Set<number>();
    for (let i = 0; i < sorted2.length; i++) {
      if (visited.has(i)) continue;
      visited.add(i);
      const cluster: PersonNode[] = [{ ...sorted2[i], stackIndex: 0 }];
      let si = 1;
      for (let j = i + 1; j < sorted2.length; j++) {
        if (Math.abs(sorted2[j].xPosition - sorted2[i].xPosition) <= STACK_SNAP) {
          visited.add(j);
          cluster.push({ ...sorted2[j], stackIndex: si++ });
        }
      }
      result.push(...cluster);
    }
  }

  return result;
}

// ─── Main exports ─────────────────────────────────────────────────────────────

/**
 * Build a PersonEntry map from all graph data.
 *
 * Steps:
 *   1. For each enabled database, determine which field holds person names.
 *   2. Parse names from each node's chosen field (handles comma-separated + arrays).
 *   3. Each node is registered under every person name it contains.
 *   4. Resolve createdTime via 3-tier fallback for each node.
 *   5. Compute xPosition for each person's node list.
 *   6. Assign panelIndex by alphabetical sort of displayName.
 *
 * Returns: Map keyed by lowercased canonical name.
 */
export function buildPersonIndex(
  data:        GraphData,
  fieldConfig: Record<string, DatabaseFieldConfig>,
  enabledDbs:  Set<string>
): Map<string, PersonEntry> {
  const { nodes } = data;

  const nodeById    = new Map<string, GraphNode>(nodes.map((n) => [n.id, n]));
  const neighborMap = buildNeighborMap(data);

  // Precompute resolved dates for all nodes (used for fallback)
  const resolvedDates = new Map<string, string>();
  for (const node of nodes) {
    resolvedDates.set(node.id, resolveCreatedTime(node, nodeById, neighborMap));
  }

  // Raw index: personKey → list of raw PersonNode (no layout yet)
  const rawIndex = new Map<string, { displayName: string; rawNodes: Omit<PersonNode, "xPosition" | "side" | "stackIndex" | "branchHeight">[] }>();

  for (const node of nodes) {
    if (!enabledDbs.has(node.databaseId)) continue;

    const cfg       = fieldConfig[node.databaseId];
    const nameField = cfg?.nameField ?? null;  // null → use node.name

    let names: string[];
    if (!nameField) {
      // Default: use the node's own title
      names = parseNamesFromFieldValue(node.name);
    } else {
      const rawValue = node.fieldValues?.[nameField] ?? null;
      names = parseNamesFromFieldValue(rawValue);
    }

    if (names.length === 0) continue;

    const createdTime = resolvedDates.get(node.id)!;

    for (const name of names) {
      const key = name.toLowerCase().trim();
      if (!key) continue;

      if (!rawIndex.has(key)) {
        rawIndex.set(key, { displayName: name, rawNodes: [] });
      }
      const entry = rawIndex.get(key)!;

      entry.rawNodes.push({
        nodeId:       node.id,
        nodeName:     node.name,
        databaseId:   node.databaseId,
        databaseName: node.databaseName,
        color:        node.color,
        createdTime,
        notionUrl:    node.notionUrl,
        fieldValues:  node.fieldValues,
      });
    }
  }

  // Sort person keys alphabetically for consistent panelIndex assignment
  const sortedKeys = [...rawIndex.keys()].sort((a, b) => a.localeCompare(b));

  const personIndex = new Map<string, PersonEntry>();

  for (let panelIndex = 0; panelIndex < sortedKeys.length; panelIndex++) {
    const key   = sortedKeys[panelIndex];
    const entry = rawIndex.get(key)!;

    // Compute xPositions for this person's nodes (newest left, oldest right)
    const { xMap, effectiveWidth } = computeXPositions(entry.rawNodes);

    // Build PersonNode array with xPositions (side + stackIndex + branchHeight filled in later by layoutPersonPanel)
    const nodesWithX: PersonNode[] = entry.rawNodes.map((n, i) => ({
      ...n,
      xPosition:    xMap.get(i) ?? PANEL_MARGIN,
      side:         "above" as const,
      stackIndex:   0,
      branchHeight: BRANCH_HEIGHT,
    }));

    personIndex.set(key, {
      key,
      displayName:    entry.displayName,
      panelIndex,
      nodes:          nodesWithX,
      effectiveWidth,
    });
  }

  return personIndex;
}
