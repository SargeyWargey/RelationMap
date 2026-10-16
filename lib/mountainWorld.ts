import type { GraphData, GraphNode } from "./types";

/**
 * The Mountain — a walkable landscape generated from the graph.
 *
 * Pure world generation: every database becomes a massif, every record a
 * peak inside it (taller = more connected + more recently active). The result
 * is a single heightfield (with baked normals, sun shadow, ambient occlusion
 * and a region map), forest scatter and summit positions. Rendering lives in
 * MountainCanvas; nothing here touches the DOM or three.js.
 *
 * Coordinates: X/Z is the ground plane, Y is up. Sea level is y = 0.
 */

// ─── Noise ────────────────────────────────────────────────────────────────────

function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
  return h >>> 0;
}

const PERM = new Uint8Array(512);
const GRAD_X = new Float32Array(512);
const GRAD_Y = new Float32Array(512);
{
  const rand = mulberry32(1337);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) {
    PERM[i] = p[i & 255];
    const a = (PERM[i] / 256) * Math.PI * 2;
    GRAD_X[i] = Math.cos(a); GRAD_Y[i] = Math.sin(a);
  }
}

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;

/** 2D simplex noise in [-1, 1]. */
export function simplex2(x: number, y: number): number {
  const s = (x + y) * F2;
  const i = Math.floor(x + s), j = Math.floor(y + s);
  const t = (i + j) * G2;
  const x0 = x - (i - t), y0 = y - (j - t);
  const i1 = x0 > y0 ? 1 : 0, j1 = x0 > y0 ? 0 : 1;
  const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
  const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
  const ii = i & 255, jj = j & 255;
  let n = 0;
  let t0 = 0.5 - x0 * x0 - y0 * y0;
  if (t0 > 0) { const g = PERM[ii + PERM[jj]]; t0 *= t0; n += t0 * t0 * (GRAD_X[g] * x0 + GRAD_Y[g] * y0); }
  let t1 = 0.5 - x1 * x1 - y1 * y1;
  if (t1 > 0) { const g = PERM[ii + i1 + PERM[jj + j1]]; t1 *= t1; n += t1 * t1 * (GRAD_X[g] * x1 + GRAD_Y[g] * y1); }
  let t2 = 0.5 - x2 * x2 - y2 * y2;
  if (t2 > 0) { const g = PERM[ii + 1 + PERM[jj + 1]]; t2 *= t2; n += t2 * t2 * (GRAD_X[g] * x2 + GRAD_Y[g] * y2); }
  return 70 * n;
}

function fbm(x: number, y: number, octaves: number): number {
  let a = 0.5, f = 1, s = 0;
  for (let o = 0; o < octaves; o++) { s += a * simplex2(x * f, y * f); f *= 2.03; a *= 0.5; }
  return s;
}

/** Ridged multifractal in ~[0, 1]: sharp crests, eroded gullies. */
function ridged(x: number, y: number, octaves: number): number {
  let a = 0.5, f = 1, s = 0, w = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    let n = 1 - Math.abs(simplex2(x * f + o * 17.3, y * f - o * 9.1));
    n *= n;
    n *= w;
    w = Math.min(1, Math.max(0, n * 1.6));
    s += n * a; norm += a;
    f *= 2.07; a *= 0.52;
  }
  return s / norm;
}

function smoothstep(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Polynomial smooth max — merges neighbouring peaks into saddles instead of creases. */
function smax(a: number, b: number, k: number) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.max(a, b) + h * h * k * 0.25;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type Peak = {
  index: number;
  node: GraphNode;
  range: number;
  degree: number;
  /** 0..1 recent activity of the record and its neighbours. */
  freshness: number;
  /** 0..1 combined importance (drives height). */
  score: number;
  /** Designed height above the surrounding land, world units. */
  height: number;
  radius: number;
  /** Placement centre. */
  x: number;
  z: number;
  /** Actual summit on the generated terrain (highest point near the centre). */
  sx: number;
  sy: number;
  sz: number;
  /** Rank by height within its range (0 = the range's highest summit). */
  rank: number;
};

export type Range = {
  index: number;
  databaseId: string;
  name: string;
  color: string;
  cx: number;
  cz: number;
  radius: number;
  /** Long-axis orientation of the massif, radians. */
  angle: number;
  peaks: number[];
  /** Index of the highest summit. */
  summit: number;
};

export type World = {
  /** Heightfield resolution (N × N samples). */
  N: number;
  minX: number;
  minZ: number;
  size: number;
  cell: number;
  heights: Float32Array;
  /** RGBA8 per sample: normal (xyz → 0..255) + sun visibility in alpha. */
  normalShadow: Uint8Array;
  /** RGBA8 per sample: ambient occlusion, range index + 1 (0 = none), range weight, forest density. */
  ao: Uint8Array;
  maxHeight: number;
  /** Fixed sun used for the minimap's relief shading. */
  sun: [number, number, number];
  /**
   * Horizon map for a moving sun/moon: for each half-resolution sample, the
   * elevation angle of the skyline in 8 compass directions (0..π/2 → 0..255),
   * as two consecutive RGBA8 images (directions 0–3, then 4–7).
   */
  horizon: Uint8Array;
  horizonN: number;
  peaks: Peak[];
  ranges: Range[];
  /** Trees: x, y, z, scale, tint — 5 floats each. */
  trees: Float32Array;
  byNodeId: Map<string, number>;
  /** Relations between peaks on the map (peak index pairs). */
  links: Array<[number, number]>;
  neighbors: number[][];
};

// ─── Tunables ─────────────────────────────────────────────────────────────────

const H_MIN = 12;
const H_MAX = 345;
/** Footprint is sized from a gentler curve than height, so big summits are steep and dramatic. */
const R_BASE = 14;
const R_SPAN = 216;
const VALLEY_GAP = 70;
const SHORE = 200;
const FRESH_DAYS = 120;
export const SNOW_LINE = 205;
export const TREE_LINE = 105;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

// ─── Build ────────────────────────────────────────────────────────────────────

export type WorldOptions = {
  /** Heightfield resolution; 1025 by default (1024 cells = 16 render chunks of 64). */
  resolution?: number;
  now?: number;
};

export function buildWorld(
  graph: GraphData,
  /** All edges in the workspace (degree counts every relation, even to hidden databases). */
  allEdges: GraphData["edges"],
  opts: WorldOptions = {},
): World {
  const now = opts.now ?? Date.now();
  const nodes = graph.nodes;

  // ── Degree & freshness ──
  const degree = new Map<string, number>();
  const nbrs = new Map<string, string[]>();
  for (const e of allEdges) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
    let a = nbrs.get(e.source); if (!a) { a = []; nbrs.set(e.source, a); } a.push(e.target);
    let b = nbrs.get(e.target); if (!b) { b = []; nbrs.set(e.target, b); } b.push(e.source);
  }
  const created = new Map<string, number>();
  for (const n of nodes) created.set(n.id, Date.parse(n.createdTime) || now);
  const recency = (ms: number) => Math.exp(-Math.max(0, now - ms) / 86_400_000 / FRESH_DAYS);
  let maxDeg = 1;
  for (const n of nodes) maxDeg = Math.max(maxDeg, degree.get(n.id) ?? 0);

  // ── Ranges ──
  const byDb = new Map<string, GraphNode[]>();
  for (const n of nodes) {
    let l = byDb.get(n.databaseId);
    if (!l) { l = []; byDb.set(n.databaseId, l); }
    l.push(n);
  }
  const dbOrder = [...byDb.keys()].sort((a, b) => byDb.get(b)!.length - byDb.get(a)!.length || a.localeCompare(b));

  const peaks: Peak[] = [];
  const ranges: Range[] = [];
  for (const dbId of dbOrder) {
    const list = byDb.get(dbId)!;
    const ri = ranges.length;
    const local: Peak[] = list.map((node) => {
      const deg = degree.get(node.id) ?? 0;
      const own = recency(created.get(node.id) ?? now);
      const ns = nbrs.get(node.id) ?? [];
      let nf = 0;
      for (const id of ns) nf += recency(created.get(id) ?? now);
      const fresh = ns.length ? 0.45 * own + 0.55 * (nf / ns.length) : own * 0.7;
      const score = Math.min(1, 0.72 * (Math.log1p(deg) / Math.log1p(maxDeg)) + 0.28 * fresh);
      const height = H_MIN + (H_MAX - H_MIN) * Math.pow(score, 1.3);
      return {
        index: 0, node, range: ri, degree: deg, freshness: fresh, score, height,
        radius: (12 + 0.85 * (R_BASE + R_SPAN * Math.pow(score, 1.35))) * 1.2, x: 0, z: 0, sx: 0, sy: 0, sz: 0, rank: 0,
      };
    });
    local.sort((a, b) => b.height - a.height || a.node.id.localeCompare(b.node.id));
    local.forEach((p, k) => { p.rank = k; });

    // Elongated golden spiral: the tallest summit in the middle, the range trailing off along its spine
    const seed = hashString(dbId);
    const rand = mulberry32(seed);
    const angle = rand() * Math.PI;
    const stretch = 1.2 + Math.min(0.45, local.length / 700);
    const ca = Math.cos(angle), sa = Math.sin(angle);
    let area = 0;
    local.forEach((p, k) => {
      const footprint = p.radius * 0.42;
      area += Math.PI * footprint * footprint;
      const r = k === 0 ? 0 : Math.sqrt(area / Math.PI) * 0.9;
      const th = k * GOLDEN + rand() * 0.5;
      let lx = Math.cos(th) * r * stretch, lz = Math.sin(th) * r / stretch;
      lx += (rand() - 0.5) * p.radius * 0.3; lz += (rand() - 0.5) * p.radius * 0.3;
      p.x = lx * ca - lz * sa;
      p.z = lx * sa + lz * ca;
    });
    relax(local, 0.34, 6);
    let radius = 0;
    for (const p of local) radius = Math.max(radius, Math.hypot(p.x, p.z) + p.radius * 0.75);
    const range: Range = {
      index: ri, databaseId: dbId, name: list[0].databaseName, color: list[0].color,
      cx: 0, cz: 0, radius: Math.max(60, radius), angle, peaks: [], summit: -1,
    };
    for (const p of local) { p.index = peaks.length; peaks.push(p); range.peaks.push(p.index); }
    range.summit = range.peaks[0];
    ranges.push(range);
  }

  // ── Place ranges: biggest at the centre, others beside their most-related neighbour ──
  const dbOfNode = new Map<string, number>();
  for (const p of peaks) dbOfNode.set(p.node.id, p.range);
  const affinity = new Map<string, number>();
  for (const e of allEdges) {
    const a = dbOfNode.get(e.source), b = dbOfNode.get(e.target);
    if (a === undefined || b === undefined || a === b) continue;
    const k = a < b ? `${a}:${b}` : `${b}:${a}`;
    affinity.set(k, (affinity.get(k) ?? 0) + 1);
  }
  const aff = (a: number, b: number) => affinity.get(a < b ? `${a}:${b}` : `${b}:${a}`) ?? 0;
  const placed: Range[] = [];
  for (const r of ranges) {
    if (placed.length === 0) { r.cx = 0; r.cz = 0; placed.push(r); continue; }
    let anchor = placed[0], best = -1;
    for (const q of placed) { const a = aff(r.index, q.index); if (a > best) { best = a; anchor = q; } }
    let found = false;
    for (let pad = 0; pad < 40 && !found; pad++) {
      const dist = anchor.radius + r.radius + VALLEY_GAP + pad * 40;
      let bestPos: [number, number] | null = null, bestScore = Infinity;
      for (let s = 0; s < 48; s++) {
        const th = (s / 48) * Math.PI * 2 + hashString(r.databaseId) * 1e-9;
        const x = anchor.cx + Math.cos(th) * dist, z = anchor.cz + Math.sin(th) * dist;
        if (placed.some((q) => Math.hypot(q.cx - x, q.cz - z) < q.radius + r.radius + VALLEY_GAP)) continue;
        const score = Math.hypot(x, z);
        if (score < bestScore) { bestScore = score; bestPos = [x, z]; }
      }
      if (bestPos) { r.cx = bestPos[0]; r.cz = bestPos[1]; found = true; }
    }
    placed.push(r);
  }
  for (const r of ranges) for (const i of r.peaks) { peaks[i].x += r.cx; peaks[i].z += r.cz; }

  // ── Grid ──
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const r of ranges) {
    minX = Math.min(minX, r.cx - r.radius); maxX = Math.max(maxX, r.cx + r.radius);
    minZ = Math.min(minZ, r.cz - r.radius); maxZ = Math.max(maxZ, r.cz + r.radius);
  }
  if (!Number.isFinite(minX)) { minX = minZ = -200; maxX = maxZ = 200; }
  const margin = SHORE + 220;
  const size = Math.max(maxX - minX, maxZ - minZ) + margin * 2;
  minX = (minX + maxX) / 2 - size / 2;
  minZ = (minZ + maxZ) / 2 - size / 2;
  const N = opts.resolution ?? 1025;
  const cell = size / (N - 1);
  const heights = new Float32Array(N * N);
  const regionIdx = new Uint8Array(N * N);
  const regionW = new Float32Array(N * N);

  // Mountains (stamped with smooth max) — core cone + broad shoulder per peak
  const mountain = new Float32Array(N * N);
  for (const p of peaks) {
    const reach = p.radius * 1.9;
    const i0 = Math.max(0, Math.floor((p.x - reach - minX) / cell)), i1 = Math.min(N - 1, Math.ceil((p.x + reach - minX) / cell));
    const j0 = Math.max(0, Math.floor((p.z - reach - minZ) / cell)), j1 = Math.min(N - 1, Math.ceil((p.z + reach - minZ) / cell));
    const k = Math.max(6, p.height * 0.22);
    const rr = p.range + 1;
    for (let j = j0; j <= j1; j++) {
      const z = minZ + j * cell;
      for (let i = i0; i <= i1; i++) {
        const x = minX + i * cell;
        const idx = j * N + i;
        // Warp the distance so peaks aren't perfect cones
        const dx = x - p.x, dz = z - p.z;
        const d = Math.sqrt(dx * dx + dz * dz);
        const t = d / p.radius;
        if (t > 1.9) continue;
        let shape = 0;
        if (t < 1) {
          const c = 1 - t;
          shape = p.height * (0.62 * Math.pow(c, 1.75) + 0.38 * Math.exp(-3.2 * t * t));
        }
        const shoulder = p.height * 0.24 * Math.exp(-(t * t) * 0.9) * (1 - smoothstep(1.4, 1.9, t));
        const v = Math.max(shape, shoulder);
        mountain[idx] = mountain[idx] === 0 ? v : smax(mountain[idx], v, k);
        const w = 1 - smoothstep(0.5, 1.9, t);
        if (w > regionW[idx] || regionIdx[idx] === 0) {
          if (w > regionW[idx]) { regionW[idx] = w; regionIdx[idx] = rr; }
        }
      }
    }
  }

  // Massifs: one broad elongated uplift per range so its peaks rise from a shared mountain body
  const massif = new Float32Array(N * N);
  for (const r of ranges) {
    const ca = Math.cos(r.angle), sa = Math.sin(r.angle);
    let a = 1, b = 1;
    for (const i of r.peaks) {
      const p = peaks[i];
      const dx = p.x - r.cx, dz = p.z - r.cz;
      const u = dx * ca + dz * sa, v = -dx * sa + dz * ca;
      a = Math.max(a, Math.abs(u) + p.radius * 0.55);
      b = Math.max(b, Math.abs(v) + p.radius * 0.55);
    }
    const hm = Math.min(220, 40 + 28 * Math.log2(r.peaks.length + 1), b * 0.6);
    const reach = Math.max(a, b) * 1.05;
    const i0 = Math.max(0, Math.floor((r.cx - reach - minX) / cell)), i1 = Math.min(N - 1, Math.ceil((r.cx + reach - minX) / cell));
    const j0 = Math.max(0, Math.floor((r.cz - reach - minZ) / cell)), j1 = Math.min(N - 1, Math.ceil((r.cz + reach - minZ) / cell));
    for (let j = j0; j <= j1; j++) {
      const dz = minZ + j * cell - r.cz;
      for (let i = i0; i <= i1; i++) {
        const dx = minX + i * cell - r.cx;
        const u = (dx * ca + dz * sa) / a, v = (-dx * sa + dz * ca) / b;
        const e = Math.sqrt(u * u + v * v);
        if (e >= 1) continue;
        // Dome with a sharper central spine along the long axis
        const dome = Math.pow(1 - smoothstep(0, 1, e), 1.25);
        const spine = Math.exp(-(v * v) / 0.05) * (1 - u * u);
        const val = hm * (0.75 * dome + 0.35 * spine * dome);
        const idx = j * N + i;
        if (val > massif[idx]) massif[idx] = val;
      }
    }
  }

  // Land, valleys, lakes, ocean + ridged erosion on the mountains.
  // Low-frequency fields are evaluated on a coarse grid and upsampled.
  let maxHeight = 0;
  const C = Math.ceil(N / 4) + 1;
  const cCell = size / (C - 1);
  const coarseBase = new Float32Array(C * C);
  const coarseWX = new Float32Array(C * C), coarseWZ = new Float32Array(C * C);
  const coarseForest = new Float32Array(C * C);
  for (let j = 0; j < C; j++) {
    const z = minZ + j * cCell;
    for (let i = 0; i < C; i++) {
      const x = minX + i * cCell;
      const k = j * C + i;
      const wx = x + fbm(x * 0.0021 + 3.1, z * 0.0021, 2) * 70;
      const wz = z + fbm(x * 0.0021, z * 0.0021 - 7.7, 2) * 70;
      let d = Infinity;
      for (const r of ranges) d = Math.min(d, Math.hypot(wx - r.cx, wz - r.cz) - r.radius);
      const lowland = fbm(wx * 0.0042, wz * 0.0042, 4);
      let base = 7 + 9 * (1 - smoothstep(0, 180, d)) + lowland * 9;
      base -= 46 * smoothstep(SHORE * 0.45, SHORE + 120, d);                       // ocean around the island
      const lake = smoothstep(0.32, 0.55, fbm(wx * 0.006 + 40, wz * 0.006, 3)) * smoothstep(20, 90, d);
      base -= lake * 20;                                                           // valley lakes
      coarseBase[k] = base;
      coarseWX[k] = wx - x; coarseWZ[k] = wz - z;
      coarseForest[k] = smoothstep(-0.05, 0.35, fbm(x * 0.008 - 11, z * 0.008 + 5, 3));
    }
  }
  const scaleC = cell / cCell;
  for (let j = 0; j < N; j++) {
    const z = minZ + j * cell;
    for (let i = 0; i < N; i++) {
      const x = minX + i * cell;
      const idx = j * N + i;
      const ci = i * scaleC, cj = j * scaleC;
      let m = mountain[idx] * 0.85 + massif[idx];
      if (m > 0) {
        const wx = x + bilinear(coarseWX, C, ci, cj), wz = z + bilinear(coarseWZ, C, ci, cj);
        const rg = ridged(wx * 0.0105, wz * 0.0105, 5);
        m *= 0.66 + 0.5 * rg;
        m += simplex2(x * 0.05, z * 0.05) * Math.min(2.5, m * 0.05);
      }
      const h = bilinear(coarseBase, C, ci, cj) + m + simplex2(x * 0.03, z * 0.03) * 1.1;
      heights[idx] = h;
      if (h > maxHeight) maxHeight = h;
    }
  }

  // Light thermal erosion: soften the steepest steps
  thermalErode(heights, N, cell, 2);

  const sample = (x: number, z: number) => bilinear(heights, N, (x - minX) / cell, (z - minZ) / cell);

  // ── Summits: highest terrain near each placement centre ──
  for (const p of peaks) {
    let bx = p.x, bz = p.z, by = sample(p.x, p.z);
    const search = Math.max(cell * 2, p.radius * 0.35);
    const step = Math.max(cell, search / 8);
    for (let dz = -search; dz <= search; dz += step) for (let dx = -search; dx <= search; dx += step) {
      const y = sample(p.x + dx, p.z + dz);
      if (y > by) { by = y; bx = p.x + dx; bz = p.z + dz; }
    }
    p.sx = bx; p.sy = by; p.sz = bz;
  }

  // ── Normals, sun shadow, AO ──
  const sun: [number, number, number] = normalize3(-0.52, 0.5, -0.36);
  const normalShadow = new Uint8Array(N * N * 4);
  const ao = new Uint8Array(N * N * 4);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const idx = j * N + i;
      const hl = heights[j * N + Math.max(0, i - 1)], hr = heights[j * N + Math.min(N - 1, i + 1)];
      const hd = heights[Math.max(0, j - 1) * N + i], hu = heights[Math.min(N - 1, j + 1) * N + i];
      const [nx, ny, nz] = normalize3(hl - hr, 2 * cell, hd - hu);
      normalShadow[idx * 4] = Math.round((nx * 0.5 + 0.5) * 255);
      normalShadow[idx * 4 + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      normalShadow[idx * 4 + 2] = Math.round((nz * 0.5 + 0.5) * 255);
    }
  }
  bakeShadow(heights, N, cell, sun, normalShadow);
  bakeAO(heights, N, cell, ao);
  const { data: horizon, M: horizonN } = bakeHorizon(heights, N, cell, maxHeight);

  // Region + forest density
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const idx = j * N + i;
      ao[idx * 4 + 1] = regionIdx[idx];
      ao[idx * 4 + 2] = Math.round(Math.min(1, regionW[idx]) * 255);
      ao[idx * 4 + 3] = Math.round(bilinear(coarseForest, C, i * scaleC, j * scaleC) * 255);
    }
  }

  // ── Trees ──
  const trees: number[] = [];
  {
    const rand = mulberry32(99);
    const spacing = Math.max(6.5, size / 520);
    for (let z = minZ + spacing; z < minZ + size - spacing; z += spacing) {
      for (let x = minX + spacing; x < minX + size - spacing; x += spacing) {
        const px = x + (rand() - 0.5) * spacing * 0.9, pz = z + (rand() - 0.5) * spacing * 0.9;
        const gi = Math.round((px - minX) / cell), gj = Math.round((pz - minZ) / cell);
        if (gi < 0 || gj < 0 || gi >= N || gj >= N) continue;
        const idx = gj * N + gi;
        const h = sample(px, pz);
        if (h < 2.2 || h > TREE_LINE + fbm(px * 0.02, pz * 0.02, 2) * 14) continue;
        const ny = normalShadow[idx * 4 + 1] / 255 * 2 - 1;
        if (ny < 0.8) continue;
        const forest = ao[idx * 4 + 3] / 255;
        const alt = 1 - smoothstep(TREE_LINE * 0.6, TREE_LINE, h);
        if (rand() > forest * 0.95 * (0.35 + 0.65 * alt)) continue;
        const scale = 0.8 + rand() * 0.7 + (1 - alt) * -0.25;
        trees.push(px, h - 0.3, pz, scale, rand());
      }
    }
  }

  // ── Links between peaks ──
  const byNodeId = new Map<string, number>();
  for (const p of peaks) byNodeId.set(p.node.id, p.index);
  const links: Array<[number, number]> = [];
  const neighbors: number[][] = peaks.map(() => []);
  const seen = new Set<string>();
  for (const e of allEdges) {
    const a = byNodeId.get(e.source), b = byNodeId.get(e.target);
    if (a === undefined || b === undefined || a === b) continue;
    const k = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (seen.has(k)) continue;
    seen.add(k);
    links.push([a, b]);
    neighbors[a].push(b);
    neighbors[b].push(a);
  }

  return {
    N, minX, minZ, size, cell, heights, normalShadow, ao, maxHeight, sun, horizon, horizonN,
    peaks, ranges, trees: new Float32Array(trees), byNodeId, links, neighbors,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalize3(x: number, y: number, z: number): [number, number, number] {
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}

function relax(ps: Peak[], factor: number, iters: number) {
  const cellSize = 60;
  for (let it = 0; it < iters; it++) {
    const grid = new Map<string, number[]>();
    ps.forEach((p, i) => {
      const k = `${Math.floor(p.x / cellSize)},${Math.floor(p.z / cellSize)}`;
      let l = grid.get(k); if (!l) { l = []; grid.set(k, l); } l.push(i);
    });
    for (let i = 0; i < ps.length; i++) {
      const a = ps[i];
      const cx = Math.floor(a.x / cellSize), cz = Math.floor(a.z / cellSize);
      const reach = Math.ceil((a.radius * 2 * factor) / cellSize) + 1;
      for (let gz = cz - reach; gz <= cz + reach; gz++) for (let gx = cx - reach; gx <= cx + reach; gx++) {
        for (const j of grid.get(`${gx},${gz}`) ?? []) {
          if (j <= i) continue;
          const b = ps[j];
          const dx = b.x - a.x, dz = b.z - a.z;
          const d = Math.hypot(dx, dz) || 0.01;
          const min = (a.radius + b.radius) * factor;
          if (d >= min) continue;
          const push = (min - d) / 2;
          // The taller peak moves less
          const wa = b.height / (a.height + b.height), wb = 1 - wa;
          const ux = dx / d, uz = dz / d;
          if (i !== 0) { a.x -= ux * push * wa * 2; a.z -= uz * push * wa * 2; }
          b.x += ux * push * wb * 2; b.z += uz * push * wb * 2;
        }
      }
    }
  }
}

function thermalErode(h: Float32Array, N: number, cell: number, iters: number) {
  const talus = cell * 1.15;
  const tmp = new Float32Array(h.length);
  for (let it = 0; it < iters; it++) {
    tmp.set(h);
    for (let j = 1; j < N - 1; j++) {
      for (let i = 1; i < N - 1; i++) {
        const idx = j * N + i;
        const c = tmp[idx];
        let moved = 0;
        for (const o of [-1, 1, -N, N]) {
          const d = c - tmp[idx + o];
          if (d > talus) { const m = (d - talus) * 0.12; h[idx + o] += m; moved += m; }
        }
        h[idx] -= moved;
      }
    }
  }
}

function bakeShadow(h: Float32Array, N: number, cell: number, sun: [number, number, number], out: Uint8Array) {
  const horiz = Math.hypot(sun[0], sun[2]);
  const dx = sun[0] / horiz, dz = sun[2] / horiz;
  const tanE = sun[1] / horiz;
  const step = 2;
  const maxSteps = 110;
  // Half resolution, then spread to the 2×2 block
  const M = Math.ceil(N / 2);
  const half = new Float32Array(M * M);
  for (let hj = 0; hj < M; hj++) {
    for (let hi = 0; hi < M; hi++) {
      const i = Math.min(N - 1, hi * 2), j = Math.min(N - 1, hj * 2);
      const h0 = h[j * N + i] + 0.5;
      let vis = 1;
      for (let s = 1; s <= maxSteps; s++) {
        const t = s * step;
        const fi = i + dx * t, fj = j + dz * t;
        if (fi < 0 || fj < 0 || fi > N - 1 || fj > N - 1) break;
        const ray = h0 + t * cell * tanE;
        const hs = bilinear(h, N, fi, fj);
        if (hs > ray) { vis = 0; break; }
        // Penumbra: how close the terrain comes to the ray, relative to distance
        vis = Math.min(vis, ((ray - hs) / (t * cell)) * 9);
        if (ray > 700) break;
      }
      half[hj * M + hi] = Math.max(0, Math.min(1, vis));
    }
  }
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    out[(j * N + i) * 4 + 3] = Math.round(bilinear(half, M, i / 2, j / 2) * 255);
  }
}

/** Horizon elevation in 8 azimuths (azimuth k = k/8 · 2π measured from +x toward +z). */
export const HORIZON_DIRS = 8;
function bakeHorizon(h: Float32Array, N: number, cell: number, maxHeight: number): { data: Uint8Array; M: number } {
  const M = Math.ceil(N / 2);
  const data = new Uint8Array(M * M * 8);
  const half = M * M * 4;
  for (let d = 0; d < HORIZON_DIRS; d++) {
    const az = (d / HORIZON_DIRS) * Math.PI * 2;
    const dx = Math.cos(az), dz = Math.sin(az);
    const base = d < 4 ? 0 : half;
    const ch = d % 4;
    for (let hj = 0; hj < M; hj++) {
      for (let hi = 0; hi < M; hi++) {
        const i = Math.min(N - 1, hi * 2), j = Math.min(N - 1, hj * 2);
        const h0 = h[j * N + i] + 0.6;
        let maxTan = 0;
        let t = 1.2, step = 1.2;
        while (t < 280) {
          const fi = i + dx * t, fj = j + dz * t;
          if (fi < 0 || fj < 0 || fi > N - 1 || fj > N - 1) break;
          const dist = t * cell;
          const tn = (bilinear(h, N, fi, fj) - h0) / dist;
          if (tn > maxTan) maxTan = tn;
          if ((maxHeight - h0) / dist <= maxTan) break;   // nothing further can rise above the skyline
          t += step;
          step = Math.min(6, step * 1.07);
        }
        data[base + (hj * M + hi) * 4 + ch] = Math.round((Math.atan(maxTan) / (Math.PI / 2)) * 255);
      }
    }
  }
  return { data, M };
}

function bakeAO(h: Float32Array, N: number, cell: number, out: Uint8Array) {
  // Cavity: compare each sample with a wide blurred neighbourhood
  const blur = boxBlur(h, N, Math.max(2, Math.round(14 / cell)));
  for (let k = 0; k < N * N; k++) {
    const cav = blur[k] - h[k];               // >0 in hollows
    const v = 1 - Math.max(0, Math.min(0.6, cav / 30));
    out[k * 4] = Math.round(v * 255);
  }
}

function boxBlur(src: Float32Array, N: number, r: number): Float32Array {
  const a = new Float32Array(N * N), b = new Float32Array(N * N);
  for (let j = 0; j < N; j++) {
    let s = 0; const row = j * N;
    for (let i = -r; i <= r; i++) s += src[row + Math.min(N - 1, Math.max(0, i))];
    for (let i = 0; i < N; i++) {
      a[row + i] = s / (2 * r + 1);
      s += src[row + Math.min(N - 1, i + r + 1)] - src[row + Math.max(0, i - r)];
    }
  }
  for (let i = 0; i < N; i++) {
    let s = 0;
    for (let j = -r; j <= r; j++) s += a[Math.min(N - 1, Math.max(0, j)) * N + i];
    for (let j = 0; j < N; j++) {
      b[j * N + i] = s / (2 * r + 1);
      s += a[Math.min(N - 1, j + r + 1) * N + i] - a[Math.max(0, j - r) * N + i];
    }
  }
  return b;
}

function bilinear(h: Float32Array, N: number, fi: number, fj: number): number {
  const i = Math.max(0, Math.min(N - 2, Math.floor(fi))), j = Math.max(0, Math.min(N - 2, Math.floor(fj)));
  const u = Math.max(0, Math.min(1, fi - i)), v = Math.max(0, Math.min(1, fj - j));
  const a = h[j * N + i], b = h[j * N + i + 1], c = h[(j + 1) * N + i], d = h[(j + 1) * N + i + 1];
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

/** Heightfield (before surface detail) at world (x, z). */
export function baseHeightAt(w: World, x: number, z: number): number {
  return bilinear(w.heights, w.N, (x - w.minX) / w.cell, (z - w.minZ) / w.cell);
}

/** Terrain height at world (x, z) — matches the rendered surface (heightfield + detail displacement). */
export function heightAt(w: World, x: number, z: number): number {
  const hb = baseHeightAt(w, x, z);
  return hb + detailAt(x, z, hb);
}

// ─── Surface detail (shared with the GPU) ─────────────────────────────────────
// A tileable noise texture generated here and uploaded as-is, so the vertex
// shader's displacement and the CPU's heightAt agree to within rounding.

export const NOISE_SIZE = 256;
let noiseData: Uint8Array | null = null;

export function detailNoise(): Uint8Array {
  if (noiseData) return noiseData;
  const size = NOISE_SIZE;
  const data = new Uint8Array(size * size * 4);
  const lattice = (period: number, seed: number) => {
    const v = new Float32Array(period * period);
    let s = seed;
    for (let i = 0; i < v.length; i++) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; v[i] = s / 4294967296; }
    return v;
  };
  const sample = (lat: Float32Array, period: number, x: number, y: number) => {
    const fx = (x / size) * period, fy = (y / size) * period;
    const i = Math.floor(fx), j = Math.floor(fy);
    const u = fx - i, w = fy - j;
    const su = u * u * (3 - 2 * u), sw = w * w * (3 - 2 * w);
    const at = (a: number, b: number) => lat[(((b % period) + period) % period) * period + (((a % period) + period) % period)];
    return (at(i, j) * (1 - su) + at(i + 1, j) * su) * (1 - sw) + (at(i, j + 1) * (1 - su) + at(i + 1, j + 1) * su) * sw;
  };
  const chans = [
    [[8, 11], [16, 12], [32, 13], [64, 14]],
    [[16, 21], [32, 22], [64, 23], [128, 24]],
    [[4, 31], [8, 32], [16, 33], [32, 34]],
    [[8, 41], [16, 42], [32, 43]],
  ].map((octs) => octs.map(([p, sd]) => ({ p, lat: lattice(p, sd) })));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    for (let c = 0; c < 4; c++) {
      let v = 0, a = 0.5, n = 0;
      for (const o of chans[c]) { v += sample(o.lat, o.p, x, y) * a; n += a; a *= 0.5; }
      v /= n;
      if (c === 3) v = 1 - Math.abs(v * 2 - 1);
      data[(y * size + x) * 4 + c] = Math.round(Math.min(1, Math.max(0, (v - 0.5) * 1.6 + 0.5)) * 255);
    }
  }
  noiseData = data;
  return data;
}

/** GPU-style bilinear sample (texel centres, repeat wrap) of one noise channel at uv. */
function noiseSample(ch: number, u: number, v: number): number {
  const d = detailNoise();
  const S = NOISE_SIZE;
  const fx = u * S - 0.5, fy = v * S - 0.5;
  const i = Math.floor(fx), j = Math.floor(fy);
  const tx = fx - i, ty = fy - j;
  const i0 = ((i % S) + S) % S, j0 = ((j % S) + S) % S, i1 = (i0 + 1) % S, j1 = (j0 + 1) % S;
  const a = d[(j0 * S + i0) * 4 + ch], b = d[(j0 * S + i1) * 4 + ch], c = d[(j1 * S + i0) * 4 + ch], e = d[(j1 * S + i1) * 4 + ch];
  return ((a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + e * tx) * ty) / 255;
}

export const DETAIL_F1 = 0.045;
export const DETAIL_A1 = 5.0;
export const DETAIL_F2 = 0.17;
export const DETAIL_A2 = 1.4;

/** Surface relief added on top of the heightfield (stronger on the mountains). */
export function detailAt(x: number, z: number, hb: number): number {
  const amp = 0.3 + 0.7 * smoothstep(3, 50, hb);
  return ((noiseSample(0, x * DETAIL_F1, z * DETAIL_F1) - 0.5) * DETAIL_A1 + (noiseSample(1, x * DETAIL_F2, z * DETAIL_F2) - 0.5) * DETAIL_A2) * amp;
}

/** Surface normal at (x, z) from the heightfield. */
export function normalAt(w: World, x: number, z: number): [number, number, number] {
  const e = w.cell;
  const hl = heightAt(w, x - e, z), hr = heightAt(w, x + e, z);
  const hd = heightAt(w, x, z - e), hu = heightAt(w, x, z + e);
  return normalize3(hl - hr, 2 * e, hd - hu);
}

/** March a ray against the terrain. Returns the hit point or null. */
export function raycastTerrain(
  w: World,
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  maxDist = 6000,
): [number, number, number] | null {
  let t = 0;
  let step = Math.max(1, w.cell * 0.75);
  let prevAbove = oy - heightAt(w, ox, oz);
  if (prevAbove < 0) return [ox, heightAt(w, ox, oz), oz];
  while (t < maxDist) {
    const nt = t + step;
    const x = ox + dx * nt, y = oy + dy * nt, z = oz + dz * nt;
    if (x < w.minX || z < w.minZ || x > w.minX + w.size || z > w.minZ + w.size) {
      if (dy >= 0) return null;
      // Outside the map: intersect sea level
      const ts = -oy / dy;
      return ts > 0 ? [ox + dx * ts, 0, oz + dz * ts] : null;
    }
    const above = y - heightAt(w, x, z);
    if (above < 0) {
      // Refine by bisection
      let a = t, b = nt;
      for (let k = 0; k < 10; k++) {
        const m = (a + b) / 2;
        const ab = oy + dy * m - heightAt(w, ox + dx * m, oz + dz * m);
        if (ab < 0) b = m; else a = m;
      }
      return [ox + dx * b, oy + dy * b, oz + dz * b];
    }
    prevAbove = above;
    t = nt;
    // Larger steps when far above the ground
    step = Math.max(w.cell * 0.75, Math.min(40, above * 0.5));
  }
  return null;
}

/** Peak whose mountain covers (x, z): nearest summit, weighted by size. */
export function peakAtPoint(w: World, x: number, z: number): number {
  let best = -1, bestD = Infinity;
  for (const p of w.peaks) {
    const d = Math.hypot(p.x - x, p.z - z) / p.radius;
    if (d < bestD) { bestD = d; best = p.index; }
  }
  return bestD < 1.05 ? best : -1;
}

/** Which range the point is in (by region map), or -1. */
export function rangeAtPoint(w: World, x: number, z: number): number {
  const i = Math.round((x - w.minX) / w.cell), j = Math.round((z - w.minZ) / w.cell);
  if (i < 0 || j < 0 || i >= w.N || j >= w.N) return -1;
  const idx = j * w.N + i;
  return w.ao[idx * 4 + 2] > 40 ? w.ao[idx * 4 + 1] - 1 : -1;
}

/** Convert world units to a display altitude ("m"). */
export function toMeters(y: number): number {
  return Math.round(y * 12);
}
