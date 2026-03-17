import type { GraphData, GraphNode } from "./types";

// ─── Exported types & constants ───────────────────────────────────────────────

export type MountainRange = {
  databaseId:   string;
  databaseName: string;
  color:        string;
  centerX:      number;
  centerZ:      number;
  arcStart:     number;   // radians — where the crescent begins
  arcSpread:    number;   // radians — total arc width
  baseRadius:   number;   // distance from range center to arc midpoint
  ridgeHeight:  number;   // height of shared base at ridge crest
};

export type MountainNode = GraphNode & {
  cx:          number;   // world X — center of peak base
  cz:          number;   // world Z — center of peak base
  peakY:       number;   // Y of peak tip (ridgeHeight + coneHeight)
  coneHeight:  number;   // height of the cone above the ridge
  coneRadius:  number;   // base radius of the cone
  degree:      number;
  rangeIndex:  number;   // index into the ranges array
};

export const MOUNTAIN_CELL_SIZE = 4.0;   // spacing unit between peaks on arc
export const MIN_ALLEY          = 0.8;   // minimum gap between any two cone bases

// ─── Private constants ────────────────────────────────────────────────────────

const MIN_CONE_H        = 1.2;
const MAX_CONE_H        = 16.0;
const FRESHNESS_LAMBDA  = 0.008;   // same as city — half-life ≈ 87 days
const FALLBACK_DATE     = "2025-11-01T00:00:00Z";
const JITTER_FRACTION   = 0.28;    // ±28% of arc spacing
const ARC_SPREAD_MIN    = (100 * Math.PI) / 180;  // 100° in radians
const ARC_SPREAD_MAX    = (160 * Math.PI) / 180;  // 160° in radians
const OVERLAP_ITERS     = 4;

// Global crescent orientation — all ranges face the same direction
const GLOBAL_ARC_START  = (Math.PI * 5) / 4;  // ~225° — opens toward bottom-right
const GLOBAL_ARC_SPREAD = (130 * Math.PI) / 180;

// Gap between adjacent rings (world units) — smaller = tighter packing
const RING_GAP          = 2.0;

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

// ─── Main export ──────────────────────────────────────────────────────────────

export function computeMountainLayout(data: GraphData): {
  nodes:  MountainNode[];
  ranges: MountainRange[];
} {
  const { nodes, edges } = data;
  if (nodes.length === 0) return { nodes: [], ranges: [] };

  const now = Date.now();
  const nodeById = new Map<string, GraphNode>(nodes.map((n) => [n.id, n]));

  // ── Adjacency & degree ────────────────────────────────────────────────────
  const neighborMap = new Map<string, Set<string>>();
  for (const node of nodes) neighborMap.set(node.id, new Set());
  for (const edge of edges) {
    neighborMap.get(edge.source)?.add(edge.target);
    neighborMap.get(edge.target)?.add(edge.source);
  }

  const degreeMap = new Map<string, number>();
  for (const node of nodes) degreeMap.set(node.id, 0);
  for (const edge of edges) {
    degreeMap.set(edge.source, (degreeMap.get(edge.source) ?? 0) + 1);
    degreeMap.set(edge.target, (degreeMap.get(edge.target) ?? 0) + 1);
  }
  const maxDegree = Math.max(1, ...degreeMap.values());

  // ── Resolved createdTime (3-tier fallback, same as city) ──────────────────
  function resolveDate(node: GraphNode): string {
    if (node.createdTime) return node.createdTime;
    let oldest: string | null = null;
    for (const nid of neighborMap.get(node.id) ?? []) {
      const d = nodeById.get(nid)?.createdTime;
      if (d && (!oldest || d < oldest)) oldest = d;
    }
    return oldest ?? FALLBACK_DATE;
  }

  const resolvedDate = new Map<string, string>();
  for (const node of nodes) resolvedDate.set(node.id, resolveDate(node));

  // ── Raw freshness per node ────────────────────────────────────────────────
  const rawFreshness = new Map<string, number>();
  for (const node of nodes) {
    const neighbors = neighborMap.get(node.id) ?? new Set<string>();
    if (neighbors.size === 0) {
      rawFreshness.set(node.id, 0.5);
    } else {
      let sum = 0;
      for (const nid of neighbors) {
        const d = resolvedDate.get(nid) ?? FALLBACK_DATE;
        const ageDays = (now - new Date(d).getTime()) / 86_400_000;
        sum += Math.exp(-FRESHNESS_LAMBDA * ageDays);
      }
      rawFreshness.set(node.id, sum / neighbors.size);
    }
  }

  // Normalize freshness across all nodes → [0, 1]
  const allFresh = [...rawFreshness.values()];
  const fMin = Math.min(...allFresh);
  const fMax = Math.max(...allFresh);
  const fRange = fMax - fMin || 1;

  function normalizedFreshness(nodeId: string): number {
    return ((rawFreshness.get(nodeId) ?? 0.5) - fMin) / fRange;
  }

  function coneHeightFor(nodeId: string, degree: number): number {
    const nf = normalizedFreshness(nodeId);
    const nd = Math.sqrt(degree / maxDegree);
    const combined = 0.75 * nf + 0.25 * nd;
    return MIN_CONE_H + combined * (MAX_CONE_H - MIN_CONE_H);
  }

  function coneRadiusFor(degree: number): number {
    return 1 + 2 * Math.sqrt(degree / maxDegree);
  }

  // ── Group nodes by database ───────────────────────────────────────────────
  const dbGroups = new Map<string, GraphNode[]>();
  for (const node of nodes) {
    const arr = dbGroups.get(node.databaseId) ?? [];
    arr.push(node);
    dbGroups.set(node.databaseId, arr);
  }

  // ── Sort databases largest → smallest so biggest = outermost ring ─────────
  const sortedDbs = [...dbGroups.entries()].sort((a, b) => b[1].length - a[1].length);

  // ── Build ranges + place peaks ────────────────────────────────────────────
  // All ranges share the same global arc orientation and are centered at the
  // world origin. The largest database gets the outermost ring; each successive
  // database steps inward by RING_GAP + the ring's own arc width.

  const ranges: MountainRange[] = [];
  const mountainNodes: MountainNode[] = [];

  // Compute the arc half-width for a ring so we know how much radial space it
  // needs before placing the next ring inside it.
  function ringWidth(N: number): number {
    // Rough half-width of the arc strip in the radial direction:
    // each peak needs ~coneRadiusFor(avgDegree) of space; we use a fixed
    // conservative estimate of MOUNTAIN_CELL_SIZE * 0.8 per ring side.
    return MOUNTAIN_CELL_SIZE * 0.9;
  }

  // Walk from outermost ring inward, accumulating the current radius.
  // Start the outermost ring far enough out that the whole scene reads well.
  let currentRadius = 0;

  // First pass: compute radii for all rings so we can place from outside in.
  const ringRadii: number[] = [];
  for (let ri = 0; ri < sortedDbs.length; ri++) {
    const [, dbNodes] = sortedDbs[ri];
    const N = dbNodes.length;
    // Each ring's arc radius scales with its node count so more nodes = more arc length
    const arcRadius = Math.max(MOUNTAIN_CELL_SIZE * 1.2, Math.sqrt(N) * MOUNTAIN_CELL_SIZE * 0.7);
    if (ri === 0) {
      currentRadius = arcRadius;
    } else {
      // Step inward: previous ring width + gap + this ring's radius
      currentRadius = currentRadius - ringWidth(sortedDbs[ri - 1][1].length) - RING_GAP - arcRadius * 0.3;
      // Clamp so rings don't collapse to zero or go negative
      currentRadius = Math.max(currentRadius, arcRadius * 0.5);
    }
    ringRadii.push(Math.max(arcRadius * 0.4, currentRadius));
  }

  for (let ri = 0; ri < sortedDbs.length; ri++) {
    const [databaseId, dbNodes] = sortedDbs[ri];
    const rangeIndex = ranges.length;
    const representative = dbNodes[0];
    const color = representative.color;
    const databaseName = representative.databaseName;

    // Sort by degree descending: most-connected → crescent center
    const sorted = [...dbNodes].sort(
      (a, b) => (degreeMap.get(b.id) ?? 0) - (degreeMap.get(a.id) ?? 0),
    );

    const N = sorted.length;

    // All rings share the same global orientation
    const arcSpread = Math.min(
      ARC_SPREAD_MAX,
      Math.max(ARC_SPREAD_MIN, ARC_SPREAD_MIN + (ARC_SPREAD_MAX - ARC_SPREAD_MIN) * Math.sqrt(N / 20)),
    );
    const arcStart   = GLOBAL_ARC_START;
    const baseRadius = ringRadii[ri];

    // All rings share the same center (world origin)
    const centerX = 0;
    const centerZ = 0;

    // Place peaks along the arc
    const peakPositions: { cx: number; cz: number }[] = [];

    for (let i = 0; i < N; i++) {
      const node = sorted[i];
      const degree = degreeMap.get(node.id) ?? 0;
      const widthScale = coneRadiusFor(degree);

      let cx: number;
      let cz: number;

      if (N === 1) {
        // Single peak at arc midpoint
        const arcMid = arcStart + GLOBAL_ARC_SPREAD / 2;
        cx = centerX + baseRadius * Math.cos(arcMid);
        cz = centerZ + baseRadius * Math.sin(arcMid);
      } else {
        // Most-connected peak at crescent center, alternate left/right outward
        const arcMid = arcStart + arcSpread / 2;
        let arcOffset: number;
        if (i === 0) {
          arcOffset = 0;
        } else {
          const side = i % 2 === 1 ? 1 : -1;
          const step = Math.ceil(i / 2);
          arcOffset = side * step * (arcSpread / (N - 1));
        }
        const theta = arcMid + arcOffset;
        cx = centerX + baseRadius * Math.cos(theta);
        cz = centerZ + baseRadius * Math.sin(theta);
      }

      // Jitter — inversely scaled with cone radius so bigger peaks drift less
      const jRange = MOUNTAIN_CELL_SIZE * JITTER_FRACTION * (1 / widthScale);
      const jx = (hashFloat(node.id + "jx") - 0.5) * 2 * jRange;
      const jz = (hashFloat(node.id + "jz") - 0.5) * 2 * jRange;

      peakPositions.push({ cx: cx + jx, cz: cz + jz });
    }

    // Compute ridge height: 30% of tallest peak's cone height in this range
    const maxConeH = Math.max(...sorted.map((n) => coneHeightFor(n.id, degreeMap.get(n.id) ?? 0)));
    const ridgeHeight = maxConeH * 0.30;

    ranges.push({
      databaseId,
      databaseName,
      color,
      centerX,
      centerZ,
      arcStart,
      arcSpread,
      baseRadius,
      ridgeHeight,
    });

    for (let i = 0; i < N; i++) {
      const node = sorted[i];
      const degree = degreeMap.get(node.id) ?? 0;
      const coneH = coneHeightFor(node.id, degree);
      const coneR = coneRadiusFor(degree);
      const { cx, cz } = peakPositions[i];

      mountainNodes.push({
        ...node,
        cx,
        cz,
        peakY: coneH,
        coneHeight: coneH,
        coneRadius: coneR,
        degree,
        rangeIndex,
      });
    }
  }

  // ── Per-peak overlap prevention within the full scene ─────────────────────
  for (let iter = 0; iter < OVERLAP_ITERS; iter++) {
    for (let i = 0; i < mountainNodes.length; i++) {
      for (let j = i + 1; j < mountainNodes.length; j++) {
        const a = mountainNodes[i];
        const b = mountainNodes[j];
        const dx = b.cx - a.cx;
        const dz = b.cz - a.cz;
        const dist = Math.sqrt(dx * dx + dz * dz);
        const minDist = (a.coneRadius + b.coneRadius) / 2 + MIN_ALLEY;

        if (dist < minDist && dist > 0.001) {
          const push = (minDist - dist) * 0.5;
          const nx = dx / dist;
          const nz = dz / dist;
          mountainNodes[i].cx -= nx * push;
          mountainNodes[i].cz -= nz * push;
          mountainNodes[j].cx += nx * push;
          mountainNodes[j].cz += nz * push;
        }
      }
    }
  }

  return { nodes: mountainNodes, ranges };
}

// ─── Terrain height sampler ───────────────────────────────────────────────────
// Used by the hike camera to follow terrain elevation.
// Samples the ridge height at world (x, z) by finding the nearest range and
// computing the ridge falloff function at that point.

export function sampleTerrainHeight(
  x: number,
  z: number,
  ranges: MountainRange[],
): number {
  let maxH = 0;

  for (const range of ranges) {
    const dx = x - range.centerX;
    const dz = z - range.centerZ;
    const distFromCenter = Math.sqrt(dx * dx + dz * dz);

    // How far are we from the arc itself?
    const distFromArc = Math.abs(distFromCenter - range.baseRadius);

    // Influence radius around the arc: taper off beyond ~2× MOUNTAIN_CELL_SIZE
    const influenceRadius = MOUNTAIN_CELL_SIZE * 2.5;
    if (distFromArc > influenceRadius) continue;

    // Angle to this point — is it within the arc's angular span?
    const angle = Math.atan2(dz, dx);
    const arcMid = range.arcStart + range.arcSpread / 2;
    let angleDelta = Math.abs(angle - arcMid);
    // Wrap to [-π, π]
    if (angleDelta > Math.PI) angleDelta = 2 * Math.PI - angleDelta;

    const halfSpread = range.arcSpread / 2;
    // Angular falloff: 1 at arc midpoint, 0 at horns
    const angularT = Math.max(0, 1 - angleDelta / halfSpread);
    // Radial falloff: 1 at arc, 0 at influenceRadius
    const radialT = Math.max(0, 1 - distFromArc / influenceRadius);

    const h = range.ridgeHeight * Math.pow(Math.sin(Math.PI * angularT), 0.5) * radialT;
    if (h > maxH) maxH = h;
  }

  return maxH;
}
