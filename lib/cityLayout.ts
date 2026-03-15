import type { GraphData, GraphNode } from "./types";

// ─── Exported types & constants ───────────────────────────────────────────────

export type CityNode = GraphNode & {
  cx: number;                  // world X — center of building base
  cz: number;                  // world Z — center of building base
  height: number;              // building height in world units
  widthScale: number;          // footprint multiplier: 1.0 – 5.0
  degree: number;
  cohort: 0 | 1 | 2;          // age district: 0=New Town, 1=Midtown, 2=Old Town
  resolvedCreatedTime: string; // actual date used after fallback
};

export const BUILDING_BASE = 1.0;   // base footprint unit (1 × 1)
export const CELL_SIZE     = 4.0;   // grid cell size (fits 3× building + alleys)
export const MIN_ALLEY     = 0.6;   // minimum gap between any two buildings

// ─── Private constants ────────────────────────────────────────────────────────

const MIN_H             = 1.2;   // always visible — never too flat
const MAX_H             = 16.0;
const FRESHNESS_LAMBDA  = 0.008;  // exponential decay — half-life ≈ 87 days (more contrast)
const FALLBACK_DATE     = "2025-11-01T00:00:00Z";
const JITTER_FRACTION   = 0.28;   // jitter = ±28% of CELL_SIZE, scaled by width
const OVERLAP_ITERS     = 4;

// ─── Utilities ────────────────────────────────────────────────────────────────

/** Deterministic float in [0, 1] from any string. */
function hashFloat(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 0xffffffff;
}

/** Generates square-spiral grid coordinates starting at (0, 0) outward. */
function* spiralCoords(): Generator<[number, number]> {
  let x = 0, z = 0;
  yield [x, z];
  let step = 1;
  while (true) {
    for (let i = 0; i < step; i++) { x++; yield [x, z]; }
    for (let i = 0; i < step; i++) { z++; yield [x, z]; }
    step++;
    for (let i = 0; i < step; i++) { x--; yield [x, z]; }
    for (let i = 0; i < step; i++) { z--; yield [x, z]; }
    step++;
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function computeCityLayout(data: GraphData): CityNode[] {
  const { nodes, edges } = data;
  if (nodes.length === 0) return [];

  const now = Date.now();
  const nodeById = new Map<string, GraphNode>(nodes.map((n) => [n.id, n]));

  // ── Adjacency ──────────────────────────────────────────────────────────────
  const neighborMap = new Map<string, Set<string>>();
  for (const node of nodes) neighborMap.set(node.id, new Set());
  for (const edge of edges) {
    neighborMap.get(edge.source)?.add(edge.target);
    neighborMap.get(edge.target)?.add(edge.source);
  }

  // ── Degree ─────────────────────────────────────────────────────────────────
  const degreeMap = new Map<string, number>();
  for (const node of nodes) degreeMap.set(node.id, 0);
  for (const edge of edges) {
    degreeMap.set(edge.source, (degreeMap.get(edge.source) ?? 0) + 1);
    degreeMap.set(edge.target, (degreeMap.get(edge.target) ?? 0) + 1);
  }
  const maxDegree = Math.max(1, ...degreeMap.values());

  // ── Resolved createdTime (3-tier fallback) ─────────────────────────────────
  function resolveDate(node: GraphNode): string {
    if (node.createdTime) return node.createdTime;

    // Oldest dated neighbor
    let oldest: string | null = null;
    for (const nid of neighborMap.get(node.id) ?? []) {
      const d = nodeById.get(nid)?.createdTime;
      if (d && (!oldest || d < oldest)) oldest = d;
    }
    return oldest ?? FALLBACK_DATE;
  }

  const resolvedDate = new Map<string, string>();
  for (const node of nodes) resolvedDate.set(node.id, resolveDate(node));

  // ── Age cohorts — percentile-based so cohorts are always even-ish ──────────
  const timestamps = [...resolvedDate.values()]
    .map((d) => new Date(d).getTime())
    .sort((a, b) => a - b);

  const p33 = timestamps[Math.floor(timestamps.length * 0.33)];
  const p66 = timestamps[Math.floor(timestamps.length * 0.66)];

  function getCohort(node: GraphNode): 0 | 1 | 2 {
    const t = new Date(resolvedDate.get(node.id)!).getTime();
    if (t >= p66) return 0; // New Town  (youngest)
    if (t >= p33) return 1; // Midtown
    return 2;               // Old Town  (oldest)
  }

  const cohorts: [GraphNode[], GraphNode[], GraphNode[]] = [[], [], []];
  for (const node of nodes) cohorts[getCohort(node)].push(node);

  // ── Cluster center positions ───────────────────────────────────────────────
  // Spread at irregular angles; distance scales with cohort size so bigger
  // clusters don't crowd each other.
  // Roughly 120° apart so all three cluster pairs are equidistant.
  // Small irregularity (±10°) keeps it from looking mechanical.
  const CLUSTER_ANGLES = [0.2, 2.3, 4.4]; // radians
  const clusterCenters: [number, number][] = cohorts.map((cohort, i) => {
    // Shrunk multiplier so cluster edges nearly touch (jitter does the rest).
    const dist = Math.sqrt(Math.max(cohort.length, 1)) * CELL_SIZE * 0.62;
    return [Math.cos(CLUSTER_ANGLES[i]) * dist, Math.sin(CLUSTER_ANGLES[i]) * dist];
  });

  // ── Pass 1: place buildings, compute raw freshness ────────────────────────
  // Height is finalised in pass 2 after normalising freshness across all nodes.
  type RawNode = Omit<CityNode, "height"> & { rawFreshness: number };
  const rawNodes: RawNode[] = [];

  for (let c = 0; c < 3; c++) {
    const cohort = cohorts[c];
    const [cx, cz] = clusterCenters[c];

    // Most-connected nodes go to the center of each cluster (their own downtown)
    const sorted = [...cohort].sort(
      (a, b) => (degreeMap.get(b.id) ?? 0) - (degreeMap.get(a.id) ?? 0),
    );

    const spiral = spiralCoords();

    for (const node of sorted) {
      const [gx, gz] = spiral.next().value as [number, number];
      const degree = degreeMap.get(node.id) ?? 0;

      // Width — sqrt-scaled degree, range [1, 5]
      const widthScale = 1 + 4 * Math.sqrt(degree / maxDegree);

      // Raw freshness — exponential decay avg of neighbor creation ages.
      // Isolated nodes get a neutral 0.5 placeholder; normalization below
      // will remap it within the real distribution.
      const neighbors = neighborMap.get(node.id) ?? new Set<string>();
      let rawFreshness = 0.5;
      if (neighbors.size > 0) {
        let sum = 0;
        for (const nid of neighbors) {
          const d = resolvedDate.get(nid) ?? FALLBACK_DATE;
          const ageDays = (now - new Date(d).getTime()) / 86_400_000;
          sum += Math.exp(-FRESHNESS_LAMBDA * ageDays);
        }
        rawFreshness = sum / neighbors.size;
      }

      // Jitter — wider buildings move less
      const jRange = CELL_SIZE * JITTER_FRACTION * (1 / widthScale);
      const jx = (hashFloat(node.id + "jx") - 0.5) * 2 * jRange;
      const jz = (hashFloat(node.id + "jz") - 0.5) * 2 * jRange;

      rawNodes.push({
        ...node,
        cx: cx + gx * CELL_SIZE + jx,
        cz: cz + gz * CELL_SIZE + jz,
        rawFreshness,
        widthScale,
        degree,
        cohort: c as 0 | 1 | 2,
        resolvedCreatedTime: resolvedDate.get(node.id)!,
      });
    }
  }

  // ── Pass 2: normalize freshness → [0, 1] then map to [MIN_H, MAX_H] ───────
  // Height = 75% freshness + 25% connections (sqrt-scaled), so highly-connected
  // nodes get a modest extra boost while recency stays the dominant driver.
  const allFreshness = rawNodes.map((n) => n.rawFreshness);
  const fMin = Math.min(...allFreshness);
  const fMax = Math.max(...allFreshness);
  const fRange = fMax - fMin || 1; // guard against all-same freshness

  const cityNodes: CityNode[] = rawNodes.map(({ rawFreshness, ...rest }) => {
    const normFreshness = (rawFreshness - fMin) / fRange;
    const normDegree    = Math.sqrt((rest.degree ?? 0) / maxDegree);
    const combined      = 0.75 * normFreshness + 0.25 * normDegree;
    return { ...rest, height: MIN_H + combined * (MAX_H - MIN_H) };
  });

  // ── Overlap prevention — push apart buildings that are too close ───────────
  for (let iter = 0; iter < OVERLAP_ITERS; iter++) {
    for (let i = 0; i < cityNodes.length; i++) {
      for (let j = i + 1; j < cityNodes.length; j++) {
        const a = cityNodes[i];
        const b = cityNodes[j];
        const dx = b.cx - a.cx;
        const dz = b.cz - a.cz;
        const dist = Math.sqrt(dx * dx + dz * dz);
        const minDist =
          ((a.widthScale + b.widthScale) * BUILDING_BASE) / 2 + MIN_ALLEY;

        if (dist < minDist && dist > 0.001) {
          const push = (minDist - dist) * 0.5;
          const nx = dx / dist;
          const nz = dz / dist;
          cityNodes[i].cx -= nx * push;
          cityNodes[i].cz -= nz * push;
          cityNodes[j].cx += nx * push;
          cityNodes[j].cz += nz * push;
        }
      }
    }
  }

  return cityNodes;
}
