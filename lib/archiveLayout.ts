import type { GraphData, GraphNode, GraphEdge } from "./types";

// ─── Exported types ────────────────────────────────────────────────────────────

export type ArchiveAisle = {
  databaseId:   string;
  databaseName: string;
  color:        string;
  col:          number;   // column index in grid (0-based)
  row:          number;   // row index in grid (0-based)
  originX:      number;   // world X of aisle origin (left edge)
  originZ:      number;   // world Z of aisle origin (front edge)
  nodeCount:    number;
};

export type ArchiveBook = GraphNode & {
  aisle:        ArchiveAisle;
  shelfSide:    "left" | "right";  // which shelf face the book is on
  bookX:        number;            // world X center of book
  bookY:        number;            // world Y center of book (base of shelf)
  bookZ:        number;            // world Z center of book
  bookWidth:    number;            // fixed 0.8
  bookHeight:   number;            // 1.5–4.0, from freshness
  bookDepth:    number;            // 0.3–2.5, from degree
  tiltZ:        number;            // random tilt in radians (±2°)
  degree:       number;
  freshness:    number;            // normalized [0, 1]
};

// ─── Constants ────────────────────────────────────────────────────────────────

const AISLE_COLS        = 3;       // aisles per row
const AISLE_LENGTH      = 40;      // Z depth of each aisle (shelf length)
const SHELF_HEIGHT      = 5;       // total shelf height in units
const WALKWAY_WIDTH     = 4;       // gap between the two facing shelves
const SHELF_THICKNESS   = 0.4;     // depth of the shelf wall itself
const AISLE_PITCH_X     = WALKWAY_WIDTH + SHELF_THICKNESS * 2 + 10; // X spacing between aisles
const AISLE_PITCH_Z     = AISLE_LENGTH + 8;                         // Z spacing between rows
const ENTRANCE_Z_OFFSET = 12;      // world Z of first aisle row origin

const BOOK_WIDTH   = 0.8;
const BOOK_GAP     = 0.05;
const MIN_BOOK_H   = 1.5;
const MAX_BOOK_H   = 4.0;
const MIN_BOOK_D   = 0.3;
const MAX_BOOK_D   = 2.5;

const FRESHNESS_LAMBDA = 0.008;    // exponential decay — half-life ≈ 87 days
const FALLBACK_DATE    = "2025-11-01T00:00:00Z";
const MAX_TILT         = (2 * Math.PI) / 180;  // ±2 degrees

// ─── Utilities ────────────────────────────────────────────────────────────────

/** Deterministic float [0,1] from any string. */
function hashFloat(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 0xffffffff;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function computeArchiveLayout(data: GraphData): {
  books:  ArchiveBook[];
  aisles: ArchiveAisle[];
} {
  const { nodes, edges } = data;
  if (nodes.length === 0) return { books: [], aisles: [] };

  const now = Date.now();

  // ── Degree map ─────────────────────────────────────────────────────────────
  const degreeMap = new Map<string, number>();
  for (const node of nodes) degreeMap.set(node.id, 0);
  for (const edge of edges) {
    degreeMap.set(edge.source, (degreeMap.get(edge.source) ?? 0) + 1);
    degreeMap.set(edge.target, (degreeMap.get(edge.target) ?? 0) + 1);
  }

  // ── Group nodes by database ────────────────────────────────────────────────
  const byDatabase = new Map<string, GraphNode[]>();
  for (const node of nodes) {
    if (!byDatabase.has(node.databaseId)) byDatabase.set(node.databaseId, []);
    byDatabase.get(node.databaseId)!.push(node);
  }

  // Sort each group freshest-first (newest createdTime first)
  for (const group of byDatabase.values()) {
    group.sort((a, b) => {
      const ta = a.createdTime ? new Date(a.createdTime).getTime() : 0;
      const tb = b.createdTime ? new Date(b.createdTime).getTime() : 0;
      return tb - ta;
    });
  }

  // ── Per-database degree normalization ──────────────────────────────────────
  const dbMaxDegree = new Map<string, number>();
  for (const [dbId, group] of byDatabase) {
    const max = Math.max(1, ...group.map((n) => degreeMap.get(n.id) ?? 0));
    dbMaxDegree.set(dbId, max);
  }

  // ── Global freshness normalization ─────────────────────────────────────────
  const rawFreshnessMap = new Map<string, number>();
  for (const node of nodes) {
    const ageDays = node.createdTime
      ? (now - new Date(node.createdTime).getTime()) / 86_400_000
      : (now - new Date(FALLBACK_DATE).getTime()) / 86_400_000;
    rawFreshnessMap.set(node.id, Math.exp(-FRESHNESS_LAMBDA * ageDays));
  }
  const allRaw = [...rawFreshnessMap.values()];
  const minRaw = Math.min(...allRaw);
  const maxRaw = Math.max(...allRaw);
  const rangeRaw = maxRaw - minRaw || 1;

  // ── Build aisles ───────────────────────────────────────────────────────────
  const sortedDbs = [...byDatabase.keys()];
  const aisles: ArchiveAisle[] = [];

  for (let i = 0; i < sortedDbs.length; i++) {
    const dbId = sortedDbs[i];
    const group = byDatabase.get(dbId)!;
    const col = i % AISLE_COLS;
    const row = Math.floor(i / AISLE_COLS);

    const originX = col * AISLE_PITCH_X;
    const originZ = ENTRANCE_Z_OFFSET + row * AISLE_PITCH_Z;

    aisles.push({
      databaseId:   dbId,
      databaseName: group[0].databaseName,
      color:        group[0].color,
      col,
      row,
      originX,
      originZ,
      nodeCount:    group.length,
    });
  }

  // ── Pack books along shelves ───────────────────────────────────────────────
  const books: ArchiveBook[] = [];

  for (const aisle of aisles) {
    const group = byDatabase.get(aisle.databaseId)!;
    const maxDeg = dbMaxDegree.get(aisle.databaseId) ?? 1;

    // Split nodes between left and right shelf
    const leftNodes  = group.filter((_, i) => i % 2 === 0);
    const rightNodes = group.filter((_, i) => i % 2 === 1);

    const packShelf = (shelfNodes: GraphNode[], side: "left" | "right") => {
      // Left shelf: books face right (spine at negative X side of shelf)
      // Right shelf: books face left (spine at positive X side)
      const shelfZ = aisle.originZ; // front of aisle
      let cumZ = shelfZ + BOOK_GAP;

      // X center of the two shelves:
      //   left shelf  center: aisle.originX - WALKWAY_WIDTH/2 - SHELF_THICKNESS/2
      //   right shelf center: aisle.originX + WALKWAY_WIDTH/2 + SHELF_THICKNESS/2
      const bookX = side === "left"
        ? aisle.originX - WALKWAY_WIDTH / 2 - SHELF_THICKNESS / 2
        : aisle.originX + WALKWAY_WIDTH / 2 + SHELF_THICKNESS / 2;

      for (const node of shelfNodes) {
        const deg = degreeMap.get(node.id) ?? 0;
        const normDeg = Math.sqrt(deg / maxDeg);

        const rawF = rawFreshnessMap.get(node.id) ?? 0;
        const normF = (rawF - minRaw) / rangeRaw;

        const bookDepth  = lerp(MIN_BOOK_D, MAX_BOOK_D, normDeg);
        const bookHeight = lerp(MIN_BOOK_H, MAX_BOOK_H, normF);
        const bookY      = bookHeight / 2;  // center Y, books rest on floor

        const tiltZ = (hashFloat(node.id + "tilt") - 0.5) * 2 * MAX_TILT;

        books.push({
          ...node,
          aisle,
          shelfSide:  side,
          bookX,
          bookY,
          bookZ:      cumZ + bookDepth / 2,
          bookWidth:  BOOK_WIDTH,
          bookHeight,
          bookDepth,
          tiltZ,
          degree:     deg,
          freshness:  normF,
        });

        cumZ += bookDepth + BOOK_GAP;
        // Stop if we've exceeded the shelf length
        if (cumZ > shelfZ + AISLE_LENGTH - BOOK_GAP) break;
      }
    };

    packShelf(leftNodes,  "left");
    packShelf(rightNodes, "right");
  }

  return { books, aisles };
}

// ─── Layout verification (T-03) ───────────────────────────────────────────────

export function verifyArchiveLayout(books: ArchiveBook[], nodes: { id: string }[]): void {
  const bookIds = new Set(books.map((b) => b.id));
  const missing = nodes.filter((n) => !bookIds.has(n.id));
  if (missing.length > 0) {
    console.warn(`[ArchiveLayout] ${missing.length} nodes have no book (shelf may be full):`,
      missing.map((n) => n.id).slice(0, 10));
  }
  const bounds = books.reduce(
    (acc, b) => ({
      minX: Math.min(acc.minX, b.bookX),
      maxX: Math.max(acc.maxX, b.bookX),
      minZ: Math.min(acc.minZ, b.bookZ),
      maxZ: Math.max(acc.maxZ, b.bookZ),
    }),
    { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity }
  );
  console.log(`[ArchiveLayout] ${books.length}/${nodes.length} books placed. Bounds:`, bounds);
}

// ─── Shelf geometry helpers (used by ArchiveCanvas) ───────────────────────────

export const ARCHIVE = {
  AISLE_LENGTH,
  SHELF_HEIGHT,
  WALKWAY_WIDTH,
  SHELF_THICKNESS,
  AISLE_PITCH_X,
  AISLE_PITCH_Z,
  ENTRANCE_Z_OFFSET,
  BOOK_WIDTH,
} as const;
