/**
 * The Universe — pure model builder (no Three.js).
 *
 * Turns the graph + tier mapping into one continuous, nested universe:
 * galaxies sit in universe space, star systems orbit their galaxy's core,
 * planets orbit stars and moons orbit planets. Every record gets exactly one
 * place: when a record relates to several parents it orbits the one it is most
 * linked to (other links are drawn as connection arcs), and records with no
 * parent at all gather in "Deep Space" regions so nothing disappears.
 *
 * Coordinates: Y is up, galaxies are spread across a gently flattened disc in
 * XZ. All positions are deterministic, seeded from record IDs.
 */

import type { GraphData, GraphNode } from "./types";
import type { RingSubType, TierMapping } from "./orreryTypes";
import {
  assignGalaxyColor,
  assignGalaxyShape,
  assignMoonType,
  assignPlanetType,
  assignStarColor,
  type GalaxyShape,
  type MoonType,
  type PlanetType,
} from "./orreryLayout";

// ─── Types ───────────────────────────────────────────────────────────────────

export type BodyTier = "galaxy" | "star" | "planet" | "moon";
export type RegionKind = "rogue-stars" | "rogue-planets" | "asteroid-field";

export type Vec3 = { x: number; y: number; z: number };

/**
 * Elliptical orbit around the parent body. Position at time t:
 *   E = phase + speed·t;  local = (a(cos E − e), y, b sin E)
 * then tilted by `incl` about X and turned by `node` about Y.
 */
export type Orbit = {
  a: number;
  b: number;
  e: number;
  y: number;
  incl: number;
  node: number;
  phase: number;
  speed: number;
};

export type Body = {
  index: number;
  id: string;
  tier: BodyTier;
  name: string;
  node: GraphNode | null;     // null for Deep Space region containers
  region: RegionKind | null;
  parent: number;             // -1 for top-level containers
  children: number[];
  radius: number;             // visual radius of the body itself
  extent: number;             // radius enclosing the body and its whole subsystem
  color: string;
  kind: GalaxyShape | PlanetType | MoonType | "star";
  size: number;               // 0..1 relative size within tier (connections + age)
  anchor: Vec3;               // top-level containers only: fixed universe position
  orbit: Orbit | null;        // everything below the top level
  /** Disc orientation of a container — children orbit in this plane. */
  plane: { incl: number; node: number };
  /** Rotation speed of a galaxy's dust (rad/s). */
  spin: number;
  rings: { inner: number; outer: number; count: number; color: string } | null;
  belt: { inner: number; outer: number; count: number; color: string } | null;
  degree: number;
  descendants: number;        // total records beneath this body
};

export type Universe = {
  bodies: Body[];
  roots: number[];
  byId: Map<string, number>;
  /** Graph neighbours that are also bodies, by body index. */
  neighbors: number[][];
  /** Aggregated links between top-level containers. */
  bridges: Array<{ a: number; b: number; count: number }>;
  extent: number;
  stats: {
    galaxies: number; stars: number; planets: number; moons: number;
    orphanStars: number; orphanPlanets: number; orphanMoons: number;
  };
};

// ─── Hash helpers ────────────────────────────────────────────────────────────

function hashFloat(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // final avalanche so similar strings decorrelate
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 0x100000000;
}

function hf(id: string, salt: string): number {
  return hashFloat(id + "\x00" + salt);
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const TAU = Math.PI * 2;

// ─── Orbit math (shared with the renderer) ───────────────────────────────────

export function orbitPosition(o: Orbit, t: number, out: Vec3): Vec3 {
  const E = o.phase + o.speed * t;
  const lx = o.a * (Math.cos(E) - o.e);
  const ly = o.y;
  const lz = o.b * Math.sin(E);
  // tilt about X
  const ci = Math.cos(o.incl), si = Math.sin(o.incl);
  const y1 = ly * ci - lz * si;
  const z1 = ly * si + lz * ci;
  // turn about Y
  const cn = Math.cos(o.node), sn = Math.sin(o.node);
  out.x = lx * cn + z1 * sn;
  out.y = y1;
  out.z = -lx * sn + z1 * cn;
  return out;
}

// ─── Galaxy shape sampler (unit radius) ──────────────────────────────────────

/** A point inside a unit-radius galaxy of the given shape: x,z in the disc, y thickness. */
export function sampleGalaxyShape(shape: GalaxyShape, galaxySeed: string, pointSeed: string): Vec3 {
  const t1 = hf(pointSeed, "t1"), t2 = hf(pointSeed, "t2"), t3 = hf(pointSeed, "t3");
  const t4 = hf(pointSeed, "t4"), t5 = hf(pointSeed, "t5");
  const arms = hf(galaxySeed, "arms") < 0.5 ? 2 : 4;
  const wind = 2.2 + hf(galaxySeed, "wind") * 2.4;
  let x = 0, y = 0, z = 0;
  switch (shape) {
    case "spiral": {
      const arm = Math.floor(t1 * arms);
      const r = Math.pow(t2, 0.7) * 0.95 + 0.04;
      const theta = (arm / arms) * TAU + wind * r + (t3 - 0.5) * 0.55 * (1.1 - r);
      x = r * Math.cos(theta); z = r * Math.sin(theta);
      y = (t5 - 0.5) * 0.06 * (1.2 - r);
      break;
    }
    case "barred-spiral": {
      if (t1 < 0.3) {
        x = (t2 - 0.5) * 0.8; z = (t3 - 0.5) * 0.12; y = (t4 - 0.5) * 0.05;
      } else {
        const arm = t1 < 0.65 ? 0 : 1;
        const r = 0.35 + t2 * 0.62;
        const theta = arm * Math.PI + wind * 0.7 * (r - 0.35) + (t3 - 0.5) * 0.45;
        x = r * Math.cos(theta); z = r * Math.sin(theta); y = (t4 - 0.5) * 0.05;
      }
      break;
    }
    case "elliptical": {
      const r = Math.pow(t1, 1.6) * 0.95;
      const u = t2 * 2 - 1, th = t3 * TAU, s = Math.sqrt(1 - u * u);
      x = r * s * Math.cos(th); z = r * s * Math.sin(th) * 0.75; y = r * u * 0.45;
      break;
    }
    case "irregular": {
      const clumps = 3 + Math.floor(hf(galaxySeed, "clumps") * 4);
      const c = Math.floor(t1 * clumps);
      const cx = (hf(galaxySeed, `cx${c}`) - 0.5) * 1.1;
      const cz = (hf(galaxySeed, `cz${c}`) - 0.5) * 1.1;
      const cs = 0.18 + hf(galaxySeed, `cs${c}`) * 0.22;
      const r = Math.sqrt(t2) * cs, th = t3 * TAU;
      x = cx + r * Math.cos(th); z = cz + r * Math.sin(th); y = (t4 - 0.5) * 0.12;
      break;
    }
    case "ring": {
      const rr = 0.62 + hf(galaxySeed, "ring") * 0.2;
      const r = t1 < 0.15 ? Math.sqrt(t2) * 0.18 : rr + (t2 - 0.5) * 0.22;
      const th = t3 * TAU;
      x = r * Math.cos(th); z = r * Math.sin(th); y = (t4 - 0.5) * 0.06;
      break;
    }
    case "lenticular": {
      const r = Math.sqrt(t1) * 0.92, th = t2 * TAU;
      x = r * Math.cos(th); z = r * Math.sin(th); y = (t3 - 0.5) * 0.04 * (1.1 - r);
      break;
    }
  }
  return { x, y, z };
}

// ─── Relationship indexing ───────────────────────────────────────────────────

type LinkIndex = {
  /** child id → (parent id → edge count) for a given tier pair */
  parentsOf: (childDb: string, parentDb: string) => Map<string, Map<string, number>>;
  degree: Map<string, number>;
};

function indexLinks(graph: GraphData): LinkIndex {
  const dbOf = new Map(graph.nodes.map((n) => [n.id, n.databaseId]));
  const degree = new Map<string, number>();
  // (childDb|parentDb) → child → parent → count
  const pairs = new Map<string, Map<string, Map<string, number>>>();
  const add = (child: string, parent: string) => {
    const key = `${dbOf.get(child)}|${dbOf.get(parent)}`;
    let byChild = pairs.get(key);
    if (!byChild) { byChild = new Map(); pairs.set(key, byChild); }
    let ps = byChild.get(child);
    if (!ps) { ps = new Map(); byChild.set(child, ps); }
    ps.set(parent, (ps.get(parent) ?? 0) + 1);
  };
  for (const e of graph.edges) {
    if (!dbOf.has(e.source) || !dbOf.has(e.target) || e.source === e.target) continue;
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
    add(e.source, e.target);
    add(e.target, e.source);
  }
  return {
    parentsOf: (childDb, parentDb) => pairs.get(`${childDb}|${parentDb}`) ?? new Map(),
    degree,
  };
}

/** Most-linked parent wins; ties go to the better-connected parent, then id. */
function primaryParent(cands: Map<string, number> | undefined, valid: Set<string>, degree: Map<string, number>): string | null {
  if (!cands) return null;
  let best: string | null = null, bestCount = -1, bestDeg = -1;
  for (const [pid, count] of cands) {
    if (!valid.has(pid)) continue;
    const deg = degree.get(pid) ?? 0;
    if (count > bestCount || (count === bestCount && (deg > bestDeg || (deg === bestDeg && best !== null && pid < best)))) {
      best = pid; bestCount = count; bestDeg = deg;
    }
  }
  return best;
}

// ─── Mapping analysis (for the builder) ──────────────────────────────────────

export type TierHealth = { dbId: string; count: number; placed: number };
export type MappingHealth = {
  galaxy: TierHealth & { withStars: number };
  star: TierHealth | null;
  planet: TierHealth | null;
  moon: TierHealth | null;
  ring: Array<TierHealth & { subType: RingSubType }>;
};

export function analyzeMapping(graph: GraphData, m: Partial<TierMapping>): MappingHealth {
  const links = indexLinks(graph);
  const idsOf = (db?: string) => new Set(db ? graph.nodes.filter((n) => n.databaseId === db).map((n) => n.id) : []);
  const tier = (childDb: string | undefined, parentDb: string | undefined): TierHealth | null => {
    if (!childDb) return null;
    const ids = idsOf(childDb);
    if (!parentDb) return { dbId: childDb, count: ids.size, placed: 0 };
    const parents = links.parentsOf(childDb, parentDb);
    let placed = 0;
    for (const id of ids) if (parents.has(id)) placed++;
    return { dbId: childDb, count: ids.size, placed };
  };
  const gIds = idsOf(m.galaxyDatabaseId);
  const starParents = m.starDatabaseId && m.galaxyDatabaseId ? links.parentsOf(m.starDatabaseId, m.galaxyDatabaseId) : new Map();
  const withStars = new Set<string>();
  for (const ps of starParents.values()) for (const g of ps.keys()) withStars.add(g);
  const ring = (m.ringDatabases ?? []).filter((r) => r.databaseId).map((r) => {
    const parentDb = r.subType === "planet-rings" ? m.planetDatabaseId : m.starDatabaseId;
    return { ...(tier(r.databaseId, parentDb) ?? { dbId: r.databaseId, count: 0, placed: 0 }), subType: r.subType };
  });
  return {
    galaxy: { dbId: m.galaxyDatabaseId ?? "", count: gIds.size, placed: gIds.size, withStars: withStars.size },
    star: tier(m.starDatabaseId, m.galaxyDatabaseId),
    planet: tier(m.planetDatabaseId, m.starDatabaseId),
    moon: m.planetDatabaseId ? tier(m.moonDatabaseId, m.planetDatabaseId) : null,
    ring,
  };
}

/** How many records of `child` link to at least one record of `parent`, for any pair. */
export function linkCoverage(graph: GraphData): (childDb: string, parentDb: string) => number {
  const links = indexLinks(graph);
  const cache = new Map<string, number>();
  return (c, p) => {
    if (!c || !p || c === p) return 0;
    const key = `${c}|${p}`;
    let v = cache.get(key);
    if (v === undefined) { v = links.parentsOf(c, p).size; cache.set(key, v); }
    return v;
  };
}

/**
 * Picks the database chain that places the most records into a sensible
 * hierarchy (each tier mostly linked to the one above, tiers growing in size).
 */
export function suggestMapping(graph: GraphData): TierMapping | null {
  const links = indexLinks(graph);
  const counts = new Map<string, number>();
  for (const n of graph.nodes) counts.set(n.databaseId, (counts.get(n.databaseId) ?? 0) + 1);
  const dbs = [...counts.keys()];
  const cov = (c: string, p: string) => (c && p ? links.parentsOf(c, p).size : 0);
  let best: { score: number; m: TierMapping } | null = null;
  for (const G of dbs) {
    const nG = counts.get(G)!;
    if (nG < 2 || nG > 300) continue;
    for (const S of dbs) {
      if (S === G) continue;
      const nS = counts.get(S)!;
      const s1 = cov(S, G);
      if (s1 < 3) continue;
      for (const P of [...dbs, ""]) {
        if (P === G || P === S) continue;
        const nP = P ? counts.get(P)! : 0;
        const s2 = cov(P, S);
        if (P && s2 < 3) continue;
        for (const M of [...dbs, ""]) {
          if (M && (!P || M === G || M === S || M === P)) continue;
          const nM = M ? counts.get(M)! : 0;
          const s3 = cov(M, P);
          if (M && s3 < 3) continue;
          const frac = s1 / nS + (P ? s2 / nP : 0) + (M ? s3 / nM : 0);
          let score = s1 + s2 + s3 + 300 * frac;
          if (nG > nS) score -= 500;
          if (P && nP < nS * 0.5) score -= 200;
          if (M && nM < nP * 0.5) score -= 200;
          if (!best || score > best.score) {
            best = { score, m: { galaxyDatabaseId: G, starDatabaseId: S, planetDatabaseId: P, moonDatabaseId: M, ringDatabases: [] } };
          }
        }
      }
    }
  }
  return best?.m ?? null;
}

// ─── Universe builder ────────────────────────────────────────────────────────

const STAR_R   = [0.35, 1.1] as const;
const PLANET_R = [0.07, 0.30] as const;
const MOON_R   = [0.02, 0.065] as const;

const MOON_SPEED   = 0.55;  // rad/s, innermost moon
const PLANET_SPEED = 0.22;  // rad/s, innermost planet
const STAR_SPEED   = 0.012; // rad/s at mid-galaxy

const REGION_NAMES: Record<RegionKind, string> = {
  "rogue-stars": "Rogue Cluster",
  "rogue-planets": "The Wanderers",
  "asteroid-field": "Asteroid Field",
};

function parseMs(s: string | undefined): number | null {
  if (!s) return null;
  const t = new Date(s).getTime();
  return Number.isNaN(t) ? null : t;
}

/** 0..1 size score within a tier: 60% connections, 40% age (older = larger). */
function sizeScores(nodes: GraphNode[], degree: Map<string, number>): Map<string, number> {
  const out = new Map<string, number>();
  if (nodes.length === 0) return out;
  const now = Date.now();
  let maxDeg = 1, oldest = Infinity, newest = -Infinity;
  for (const n of nodes) {
    maxDeg = Math.max(maxDeg, degree.get(n.id) ?? 0);
    const t = parseMs(n.createdTime) ?? now;
    oldest = Math.min(oldest, t); newest = Math.max(newest, t);
  }
  const span = newest - oldest || 1;
  for (const n of nodes) {
    const conn = Math.sqrt((degree.get(n.id) ?? 0) / maxDeg);
    const age = (newest - (parseMs(n.createdTime) ?? now)) / span;
    out.set(n.id, Math.min(1, conn * 0.6 + age * 0.4));
  }
  return out;
}

export function buildUniverse(graph: GraphData, mapping: TierMapping): Universe {
  const links = indexLinks(graph);
  const { degree } = links;
  const nodesOf = (db: string) => (db ? graph.nodes.filter((n) => n.databaseId === db) : []);
  const galaxyNodes = nodesOf(mapping.galaxyDatabaseId);
  const starNodes = nodesOf(mapping.starDatabaseId);
  const planetNodes = nodesOf(mapping.planetDatabaseId);
  const moonNodes = mapping.planetDatabaseId ? nodesOf(mapping.moonDatabaseId) : [];

  const gSet = new Set(galaxyNodes.map((n) => n.id));
  const sSet = new Set(starNodes.map((n) => n.id));
  const pSet = new Set(planetNodes.map((n) => n.id));

  // Primary parents
  const starParent = new Map<string, string | null>();
  const sp = links.parentsOf(mapping.starDatabaseId, mapping.galaxyDatabaseId);
  for (const n of starNodes) starParent.set(n.id, primaryParent(sp.get(n.id), gSet, degree));
  const planetParent = new Map<string, string | null>();
  const pp = links.parentsOf(mapping.planetDatabaseId, mapping.starDatabaseId);
  for (const n of planetNodes) planetParent.set(n.id, primaryParent(pp.get(n.id), sSet, degree));
  const moonParent = new Map<string, string | null>();
  const mp = links.parentsOf(mapping.moonDatabaseId, mapping.planetDatabaseId);
  for (const n of moonNodes) moonParent.set(n.id, primaryParent(mp.get(n.id), pSet, degree));

  // Ring / belt particle counts per host
  const ringCount = new Map<string, { count: number; color: string }>();
  const beltCount = new Map<string, { count: number; color: string }>();
  for (const r of mapping.ringDatabases ?? []) {
    const hostDb = r.subType === "planet-rings" ? mapping.planetDatabaseId : mapping.starDatabaseId;
    if (!hostDb || !r.databaseId) continue;
    const hostSet = r.subType === "planet-rings" ? pSet : sSet;
    const target = r.subType === "planet-rings" ? ringCount : beltCount;
    const parents = links.parentsOf(r.databaseId, hostDb);
    const color = graph.nodes.find((n) => n.databaseId === r.databaseId)?.color ?? "#c8b090";
    for (const cands of parents.values()) {
      const host = primaryParent(cands, hostSet, degree);
      if (!host) continue;
      const cur = target.get(host) ?? { count: 0, color };
      cur.count++;
      target.set(host, cur);
    }
  }

  const starSize = sizeScores(starNodes, degree);
  const planetSize = sizeScores(planetNodes, degree);
  const moonSize = sizeScores(moonNodes, degree);
  const galaxySize = sizeScores(galaxyNodes, degree);

  const bodies: Body[] = [];
  const byId = new Map<string, number>();
  const blank = (): Omit<Body, "index" | "id" | "tier" | "name" | "node" | "region" | "parent" | "color" | "kind"> => ({
    children: [], radius: 0, extent: 0, size: 0, anchor: { x: 0, y: 0, z: 0 }, orbit: null,
    plane: { incl: 0, node: 0 }, spin: 0, rings: null, belt: null, degree: 0, descendants: 0,
  });
  const addBody = (b: Omit<Body, "index">): number => {
    const index = bodies.length;
    bodies.push({ ...b, index });
    if (b.node) byId.set(b.node.id, index);
    if (b.parent >= 0) bodies[b.parent].children.push(index);
    return index;
  };

  const childrenOf = <T>(parents: Map<string, string | null>, parentId: string | null, pool: T[], idOf: (t: T) => string) =>
    pool.filter((x) => parents.get(idOf(x)) === parentId);

  // ── Moons around a planet (or loose in the asteroid field) ──
  const layoutMoons = (planetIdx: number, moons: GraphNode[], innerR: number, planeSeed: string) => {
    // Biggest moons ride closest
    const sorted = [...moons].sort((a, b) => (moonSize.get(b.id) ?? 0) - (moonSize.get(a.id) ?? 0) || a.id.localeCompare(b.id));
    const pr = bodies[planetIdx].radius;
    const tilt = (hf(planeSeed, "mtilt") - 0.5) * 0.5;
    const node0 = hf(planeSeed, "mnode") * TAU;
    let maxR = innerR;
    sorted.forEach((m, i) => {
      const s = moonSize.get(m.id) ?? 0;
      const r = lerp(MOON_R[0], MOON_R[1], s);
      const a = innerR + pr * 1.45 * Math.sqrt(i) + r;
      const e = 0.01 + hf(m.id, "e") * 0.08;
      const orbit: Orbit = {
        a, b: a * Math.sqrt(1 - e * e), e, y: 0,
        incl: tilt + (hf(m.id, "incl") - 0.5) * 0.45,
        node: node0 + (hf(m.id, "node") - 0.5) * 0.9,
        phase: hf(m.id, "phase") * TAU,
        speed: MOON_SPEED * Math.pow(innerR / a, 1.5),
      };
      addBody({
        ...blank(), id: m.id, tier: "moon", name: m.name, node: m, region: null, parent: planetIdx,
        color: m.color, kind: assignMoonType(m.id), size: s, radius: r, extent: r, orbit,
        degree: degree.get(m.id) ?? 0,
      });
      maxR = Math.max(maxR, a * (1 + e) + r);
    });
    return maxR;
  };

  // ── Planet with its moons; returns body index (orbit filled in by caller) ──
  const buildPlanet = (p: GraphNode, parent: number): number => {
    const s = planetSize.get(p.id) ?? 0;
    const pr = lerp(PLANET_R[0], PLANET_R[1], s);
    const idx = addBody({
      ...blank(), id: p.id, tier: "planet", name: p.name, node: p, region: null, parent,
      color: p.color, kind: assignPlanetType(p.id), size: s, radius: pr, extent: pr,
      degree: degree.get(p.id) ?? 0,
    });
    const ring = ringCount.get(p.id);
    let inner = pr * 2.4;
    if (ring) {
      const outer = pr * (1.9 + Math.min(1.2, ring.count / 40));
      bodies[idx].rings = { inner: pr * 1.35, outer, count: ring.count, color: ring.color };
      inner = Math.max(inner, outer + pr * 0.5);
    }
    const moons = childrenOf(moonParent, p.id, moonNodes, (n) => n.id);
    const ext = moons.length > 0 ? layoutMoons(idx, moons, inner, p.id) : (bodies[idx].rings?.outer ?? pr);
    bodies[idx].extent = Math.max(pr, ext);
    bodies[idx].descendants = moons.length;
    return idx;
  };

  // ── Star system ──
  const buildStar = (st: GraphNode, parent: number): number => {
    const s = starSize.get(st.id) ?? 0;
    const sr = lerp(STAR_R[0], STAR_R[1], s);
    const idx = addBody({
      ...blank(), id: st.id, tier: "star", name: st.name, node: st, region: null, parent,
      color: assignStarColor(s), kind: "star", size: s, radius: sr, extent: sr * 2,
      degree: degree.get(st.id) ?? 0,
      plane: { incl: (hf(st.id, "ptilt") - 0.5) * 0.35, node: hf(st.id, "pnode") * TAU },
    });
    // Oldest planets ride the innermost orbits
    const planets = childrenOf(planetParent, st.id, planetNodes, (n) => n.id)
      .sort((a, b) => (parseMs(a.createdTime) ?? 0) - (parseMs(b.createdTime) ?? 0) || a.id.localeCompare(b.id));
    let prevA = 0, prevExt = 0, firstA = 0, desc = 0;
    planets.forEach((p, i) => {
      const pi = buildPlanet(p, idx);
      const ext = bodies[pi].extent;
      const a = i === 0 ? sr * 3 + ext + 0.4 : prevA + prevExt + ext + 0.45 + 0.2 * (prevExt + ext);
      if (i === 0) firstA = a;
      const e = hf(p.id, "e") * 0.06;
      bodies[pi].orbit = {
        a, b: a * Math.sqrt(1 - e * e), e, y: 0,
        incl: bodies[idx].plane.incl + (hf(p.id, "incl") - 0.5) * 0.12,
        node: bodies[idx].plane.node,
        phase: hf(p.id, "phase") * TAU,
        speed: PLANET_SPEED * Math.pow(firstA / a, 1.5),
      };
      prevA = a; prevExt = ext;
      desc += 1 + bodies[pi].descendants;
    });
    let extent = Math.max(sr * 2, prevA * 1.07 + prevExt);
    const belt = beltCount.get(st.id);
    if (belt) {
      const inner = extent + 0.6;
      const outer = inner + 1 + Math.min(6, belt.count * 0.05);
      bodies[idx].belt = { inner, outer, count: belt.count, color: belt.color };
      extent = outer;
    }
    bodies[idx].extent = extent;
    bodies[idx].descendants = desc;
    return idx;
  };

  // ── Spread children across a container disc, then push overlapping systems apart ──
  const arrangeInDisc = (containerIdx: number, kids: number[], shape: GalaxyShape, seed: string, minR: number) => {
    const c = bodies[containerIdx];
    let area = 0;
    for (const k of kids) area += (bodies[k].extent + 1) ** 2;
    const R = Math.max(minR, 2.3 * Math.sqrt(area));
    const pos = kids.map((k) => {
      const p = sampleGalaxyShape(shape, seed, bodies[k].id);
      return { x: p.x * R, y: p.y * R * 0.6, z: p.z * R };
    });
    for (let iter = 0; iter < 10; iter++) {
      for (let i = 0; i < kids.length; i++) {
        for (let j = i + 1; j < kids.length; j++) {
          const dx = pos[j].x - pos[i].x, dz = pos[j].z - pos[i].z;
          const d = Math.hypot(dx, dz) || 1e-3;
          const min = bodies[kids[i]].extent + bodies[kids[j]].extent + 1.2;
          if (d < min) {
            const push = (min - d) / 2, nx = dx / d, nz = dz / d;
            pos[i].x -= nx * push; pos[i].z -= nz * push;
            pos[j].x += nx * push; pos[j].z += nz * push;
          }
        }
      }
    }
    let extent = R;
    kids.forEach((k, i) => {
      const r = Math.max(0.5, Math.hypot(pos[i].x, pos[i].z));
      bodies[k].orbit = {
        a: r, b: r, e: 0, y: pos[i].y,
        incl: c.plane.incl, node: c.plane.node,
        phase: Math.atan2(pos[i].z, pos[i].x),
        speed: STAR_SPEED * Math.sqrt((R * 0.5) / Math.max(r, R * 0.08)),
      };
      extent = Math.max(extent, r + bodies[k].extent);
    });
    c.extent = extent;
    c.spin = STAR_SPEED * 0.8;
  };

  // ── Galaxies ──
  const roots: number[] = [];
  const parseAll = galaxyNodes.map((n) => parseMs(n.createdTime) ?? Date.now());
  const gOld = Math.min(...parseAll, Date.now()), gNew = Math.max(...parseAll, 0);
  for (const g of galaxyNodes) {
    const normAge = (gNew - (parseMs(g.createdTime) ?? gNew)) / (gNew - gOld || 1);
    const gi = addBody({
      ...blank(), id: g.id, tier: "galaxy", name: g.name, node: g, region: null, parent: -1,
      color: assignGalaxyColor(g.color, g.id, normAge), kind: assignGalaxyShape(g.id),
      size: galaxySize.get(g.id) ?? 0, degree: degree.get(g.id) ?? 0,
      plane: { incl: 0.12 + hf(g.id, "tilt") * 0.5, node: hf(g.id, "gnode") * TAU },
    });
    roots.push(gi);
    const stars = childrenOf(starParent, g.id, starNodes, (n) => n.id);
    const kids = stars.map((st) => buildStar(st, gi));
    const minR = 9 + (galaxySize.get(g.id) ?? 0) * 8;
    arrangeInDisc(gi, kids, bodies[gi].kind as GalaxyShape, g.id, minR);
    bodies[gi].radius = bodies[gi].extent;
    bodies[gi].descendants = kids.reduce((s, k) => s + 1 + bodies[k].descendants, 0);
  }

  // ── Deep Space regions for records without a parent ──
  const makeRegion = (kind: RegionKind, shape: GalaxyShape, color: string): number => {
    const idx = addBody({
      ...blank(), id: `__region:${kind}`, tier: "galaxy", name: REGION_NAMES[kind], node: null, region: kind,
      parent: -1, color, kind: shape, size: 0.5,
      plane: { incl: 0.25 + hf(kind, "tilt") * 0.3, node: hf(kind, "node") * TAU },
    });
    roots.push(idx);
    return idx;
  };

  const rogueStars = starNodes.filter((n) => !starParent.get(n.id));
  if (rogueStars.length > 0) {
    const ri = makeRegion("rogue-stars", "irregular", "#8d7bd6");
    const kids = rogueStars.map((st) => buildStar(st, ri));
    arrangeInDisc(ri, kids, "irregular", "rogue-stars", 20);
    bodies[ri].radius = bodies[ri].extent;
    bodies[ri].descendants = kids.reduce((s, k) => s + 1 + bodies[k].descendants, 0);
  }
  const roguePlanets = planetNodes.filter((n) => !planetParent.get(n.id));
  if (roguePlanets.length > 0) {
    const ri = makeRegion("rogue-planets", "lenticular", "#5fa3b8");
    const kids = roguePlanets.map((p) => buildPlanet(p, ri));
    arrangeInDisc(ri, kids, "lenticular", "rogue-planets", 14);
    bodies[ri].radius = bodies[ri].extent;
    bodies[ri].descendants = kids.reduce((s, k) => s + 1 + bodies[k].descendants, 0);
  }
  const looseMoons = moonNodes.filter((n) => !moonParent.get(n.id));
  if (looseMoons.length > 0) {
    const ri = makeRegion("asteroid-field", "ring", "#a8957c");
    const R = 8 + Math.sqrt(looseMoons.length) * 1.3;
    const plane = bodies[ri].plane;
    for (const m of looseMoons) {
      const s = moonSize.get(m.id) ?? 0;
      const r = lerp(MOON_R[0], MOON_R[1], s) * 2.2;
      const a = R * (0.62 + hf(m.id, "fr") * 0.38);
      addBody({
        ...blank(), id: m.id, tier: "moon", name: m.name, node: m, region: null, parent: ri,
        color: m.color, kind: assignMoonType(m.id), size: s, radius: r, extent: r,
        degree: degree.get(m.id) ?? 0,
        orbit: {
          a, b: a, e: 0, y: (hf(m.id, "fy") - 0.5) * R * 0.08,
          incl: plane.incl, node: plane.node, phase: hf(m.id, "fp") * TAU,
          speed: STAR_SPEED * 3 * Math.pow(R / a, 1.5),
        },
      });
    }
    bodies[ri].extent = bodies[ri].radius = R * 1.05;
    bodies[ri].spin = STAR_SPEED * 2;
    bodies[ri].descendants = looseMoons.length;
  }

  // ── Place top-level containers: golden-angle spiral, biggest near the core ──
  const order = [...roots].sort((a, b) => {
    const ra = bodies[a].region ? 1 : 0, rb = bodies[b].region ? 1 : 0;
    return ra - rb || bodies[b].extent - bodies[a].extent || bodies[a].id.localeCompare(bodies[b].id);
  });
  const placed: number[] = [];
  const GOLDEN = Math.PI * (3 - Math.sqrt(5));
  let rCursor = 0;
  order.forEach((bi, k) => {
    const b = bodies[bi];
    const angle = k * GOLDEN + hf(b.id, "ang") * 0.3;
    let r = k === 0 ? 0 : Math.max(rCursor * 0.92, b.extent);
    // Regions live out on the rim
    if (b.region) r = Math.max(r, rCursor + b.extent * 1.5);
    const y = (hf(b.id, "y") - 0.5) * Math.min(60, b.extent * 1.2);
    for (let guard = 0; guard < 4000; guard++) {
      const x = Math.cos(angle) * r, z = Math.sin(angle) * r;
      let ok = true;
      for (const pi of placed) {
        const p = bodies[pi];
        const d = Math.hypot(p.anchor.x - x, p.anchor.z - z);
        if (d < p.extent + b.extent + 6 + 0.25 * (p.extent + b.extent)) { ok = false; break; }
      }
      if (ok) { b.anchor = { x, y, z }; break; }
      r += Math.max(1.5, b.extent * 0.12);
    }
    rCursor = Math.max(rCursor, Math.hypot(b.anchor.x, b.anchor.z));
    placed.push(bi);
  });
  let extent = 50;
  for (const bi of roots) extent = Math.max(extent, Math.hypot(bodies[bi].anchor.x, bodies[bi].anchor.z) + bodies[bi].extent);

  // ── Neighbours & bridges ──
  const neighbors: number[][] = bodies.map(() => []);
  const seen = new Set<string>();
  const rootOf = (i: number) => { let c = i; while (bodies[c].parent >= 0) c = bodies[c].parent; return c; };
  const bridgeCount = new Map<string, number>();
  for (const e of graph.edges) {
    const a = byId.get(e.source), b = byId.get(e.target);
    if (a === undefined || b === undefined || a === b) continue;
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (seen.has(key)) continue;
    seen.add(key);
    neighbors[a].push(b);
    neighbors[b].push(a);
    const ra = rootOf(a), rb = rootOf(b);
    if (ra !== rb) {
      const bk = ra < rb ? `${ra}:${rb}` : `${rb}:${ra}`;
      bridgeCount.set(bk, (bridgeCount.get(bk) ?? 0) + 1);
    }
  }
  const bridges = [...bridgeCount.entries()].map(([k, count]) => {
    const [a, b] = k.split(":").map(Number);
    return { a, b, count };
  });

  return {
    bodies, roots, byId, neighbors, bridges, extent,
    stats: {
      galaxies: galaxyNodes.length, stars: starNodes.length, planets: planetNodes.length, moons: moonNodes.length,
      orphanStars: rogueStars.length, orphanPlanets: roguePlanets.length, orphanMoons: looseMoons.length,
    },
  };
}

/** World position of any body at simulation time t (recursive through parents). */
export function bodyWorldPosition(u: Universe, index: number, t: number, out: Vec3, tmp: Vec3 = { x: 0, y: 0, z: 0 }): Vec3 {
  const b = u.bodies[index];
  if (b.parent < 0) {
    out.x = b.anchor.x; out.y = b.anchor.y; out.z = b.anchor.z;
    return out;
  }
  bodyWorldPosition(u, b.parent, t, out, tmp);
  orbitPosition(b.orbit!, t, tmp);
  out.x += tmp.x; out.y += tmp.y; out.z += tmp.z;
  return out;
}
