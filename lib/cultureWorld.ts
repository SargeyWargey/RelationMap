import { parseDay, todayDay } from "./lineModel";
import type { DatabaseSchema, GraphData, GraphNode } from "./types";

/**
 * The Culture — your records as a living petri dish.
 *
 * Pure layout. Records are grouped into colonies of related work (Louvain
 * communities over the full relation graph, so colonies stay put when species
 * are hidden); unlinked records form one single-species colony per database.
 * Inside a colony records are placed in birth order, each budding off the
 * linked record it is most attached to, so a colony grows outward from its
 * founder with the newest work at the rim. Colonies are then packed into the
 * dish beside the colonies they share links with.
 *
 * Units: an unlinked organism has radius 1. Time: wall-clock days (lineModel).
 */

// ─── Species ──────────────────────────────────────────────────────────────────

export const MORPH = {
  coccus: 0, bacillus: 1, virus: 2, diatom: 3, amoeba: 4,
  spirillum: 5, paramecium: 6, volvox: 7, radiolarian: 8, vibrio: 9,
} as const;
export const MORPH_COUNT = 10;
export const MORPH_NAMES = ["Coccus", "Bacillus", "Virus", "Diatom", "Amoeba", "Spirillum", "Paramecium", "Volvox", "Radiolarian", "Vibrio"];

/** Database name → body plan. First match wins; databases that match nothing get the least-used plan. */
const MORPH_RULES: Array<[RegExp, number]> = [
  [/question|finding|risk|bug|incident|issue|problem/i, MORPH.spirillum],
  [/e-?mail|message|meeting|announcement|newsletter|memo/i, MORPH.vibrio],
  [/team|people|person|member|staff|employee|user|contact|owner/i, MORPH.amoeba],
  [/department|division|\borg\b|organi[sz]ation|region|\bunit/i, MORPH.volvox],
  [/task|backlog|ticket|to-?do|story|stories|action item/i, MORPH.bacillus],
  [/doc|glossary|wiki|knowledge|article|note|polic|guide|handbook/i, MORPH.diatom],
  [/application|\bapps?\b|system|software|platform|tool|integration/i, MORPH.radiolarian],
  [/sprint|week|timeline|calendar|schedule|milestone|phase|iteration/i, MORPH.paramecium],
  [/project|initiative|epic|program/i, MORPH.virus],
  [/stand|store|location|site|shop|branch|restaurant|vendor|supplier|partner/i, MORPH.coccus],
];

/**
 * Body plan per database, decided over every database in the graph (largest
 * first) so a species keeps its look when others are hidden.
 */
export function speciesMorphs(nodes: Array<Pick<GraphNode, "databaseId" | "databaseName">>): Map<string, number> {
  const counts = new Map<string, { name: string; n: number }>();
  for (const n of nodes) {
    const c = counts.get(n.databaseId);
    if (c) c.n++; else counts.set(n.databaseId, { name: n.databaseName, n: 1 });
  }
  const order = [...counts.entries()].sort((a, b) => b[1].n - a[1].n || (a[0] < b[0] ? -1 : 1));
  const use = new Array(MORPH_COUNT).fill(0);
  const out = new Map<string, number>();
  for (const [id, { name }] of order) {
    let morph = MORPH_RULES.find(([re]) => re.test(name))?.[1] ?? -1;
    if (morph < 0) {
      morph = 0;
      for (let m = 1; m < MORPH_COUNT; m++) if (use[m] < use[morph]) morph = m;
    }
    use[morph]++;
    out.set(id, morph);
  }
  return out;
}

export type Species = {
  index: number;
  databaseId: string;
  name: string;
  color: string;
  morph: number;
  /** Organisms of this species in the dish. */
  count: number;
};

// ─── Lifecycle ────────────────────────────────────────────────────────────────

export type LifeState = "open" | "active" | "blocked" | "done";

const DONE_STATUS = /\b(done|completed?|deployed|published|answered|sent|signed|resolved|closed|shipped|finished|archived?)\b/i;
const BLOCKED_STATUS = /block|on hold|\bhold\b|cancel|stuck/i;
const ACTIVE_STATUS = /progress|testing|review|approved for deploy|\bactive\b|doing|working/i;
const DONE_FIELD = /^(completed|completed date|date completed|done date|deployed date|closed date|resolved date|date sent|sent date|published date)$/i;
const START_FIELD = /^(start|start date|started|in progress time|kickoff)$/i;

function fieldText(v: string | string[] | null | undefined): string | null {
  if (v == null) return null;
  const s = Array.isArray(v) ? v.filter(Boolean).join(", ") : v;
  return s && s !== "No content" ? s : null;
}

function pickStatusField(schema: DatabaseSchema | undefined): string | null {
  if (!schema) return null;
  const status = schema.fields.filter((f) => f.type === "status");
  if (status.length) return (status.find((f) => /^status$/i.test(f.name.trim())) ?? status[0]).name;
  return schema.fields.find((f) => f.type === "select" && /^(status|stage|state)$/i.test(f.name.trim()))?.name ?? null;
}

/** The date field matching `re` that is filled in on the most records. */
function pickDateField(schema: DatabaseSchema | undefined, nodes: GraphNode[], re: RegExp): string | null {
  if (!schema) return null;
  let best: string | null = null, bestN = 0;
  for (const f of schema.fields) {
    if (f.type !== "date" || !re.test(f.name.trim())) continue;
    let n = 0;
    for (const node of nodes) if (fieldText(node.fieldValues?.[f.name])) n++;
    if (n > bestN) { best = f.name; bestN = n; }
  }
  return best;
}

// ─── World types ──────────────────────────────────────────────────────────────

export type Organism = {
  index: number;
  node: GraphNode;
  species: number;
  colony: number;
  /** Creation, wall-clock days. */
  born: number;
  /** Final position and body radius (world units). */
  x: number;
  y: number;
  r: number;
  /** Body orientation, radians. */
  angle: number;
  /** Links to other organisms in the dish. */
  degree: number;
  /** Where it buds from: a linked colony-mate, the nearest colony-mate, or (founders) a linked cell in another colony. -1 = a spore. */
  origin: number;
  /** True when `origin` is a real link (not just the nearest cell). */
  originLinked: boolean;
  status: string | null;
  /** Where the work stands today. */
  state: LifeState;
  /** Day it became active (start date, else birth) — when state is active, or done with a start date. */
  activeFrom: number | null;
  /** Day it went dormant (done). Null while still alive today. */
  dormantAt: number | null;
  /** False when it's done but has no completion date — it goes dormant "today". */
  dormantKnown: boolean;
  /** Sorted days its links formed — degree at time t is the count ≤ t. */
  linkTimes: number[];
  /** Stable 0..1 hash for animation variety. */
  seed: number;
};

export type Filament = {
  a: number;
  b: number;
  /** Day both ends exist. */
  formed: number;
  /** Bridges two colonies. */
  cross: boolean;
  /** Relations between the pair. */
  weight: number;
};

export type Colony = {
  index: number;
  name: string;
  /** Biggest member. */
  hub: number;
  /** Organism indices, in birth order. */
  members: number[];
  cx: number;
  cy: number;
  radius: number;
  founded: number;
  /** Members per species. */
  bySpecies: number[];
  /** A single-species colony of unlinked records. */
  free: boolean;
};

export type CultureWorld = {
  organisms: Organism[];
  filaments: Filament[];
  colonies: Colony[];
  species: Species[];
  neighbors: number[][];
  byNodeId: Map<string, number>;
  dishRadius: number;
  /** Timeline bounds, wall-clock days; tMax is today. */
  tMin: number;
  tMax: number;
  /** Weekly histogram: births per bin per species (bin * S + s), and dormancies with a known date. */
  hist: { t0: number; binDays: number; bins: number; births: Uint16Array; dormant: Uint16Array };
  /** Done records with no completion date — they turn dormant at today. */
  undatedDone: number;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

export const BASE_R = 1;
const GAP = 0.5;

/** Body radius for a link count. */
export function radiusFor(degree: number): number {
  return BASE_R * Math.min(7.5, 1 + 0.34 * Math.sqrt(degree));
}

/** Links an organism has formed by day t. */
export function degreeAt(o: Organism, t: number): number {
  const a = o.linkTimes;
  let lo = 0, hi = a.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] <= t) lo = m + 1; else hi = m; }
  return lo;
}

/** Display name: Notion's raw ids and blanks read as "Untitled". */
export function organismName(node: { id: string; name: string }): string {
  const s = node.name?.trim();
  if (!s || /^[0-9a-f]{32}$/i.test(s) || s.replace(/-/g, "") === node.id.replace(/-/g, "")) return "Untitled";
  return s;
}

// ─── Communities (Louvain, multi-level) ──────────────────────────────────────

type WAdj = Array<Map<number, number>>;

function louvainLevel(adj: WAdj, gamma: number): number[] {
  const n = adj.length;
  const comm = Array.from({ length: n }, (_, i) => i);
  const k = adj.map((m) => { let s = 0; for (const w of m.values()) s += w; return s; });
  const tot = k.slice();
  const total = k.reduce((s, x) => s + x, 0) || 1;
  const w = new Map<number, number>();
  for (let pass = 0; pass < 24; pass++) {
    let moved = false;
    for (let i = 0; i < n; i++) {
      if (k[i] === 0) continue;
      const ci = comm[i];
      w.clear();
      for (const [j, wij] of adj[i]) if (j !== i) w.set(comm[j], (w.get(comm[j]) ?? 0) + wij);
      tot[ci] -= k[i];
      let best = ci, bestGain = (w.get(ci) ?? 0) - (gamma * tot[ci] * k[i]) / total;
      for (const [c, wic] of w) {
        const gain = wic - (gamma * tot[c] * k[i]) / total;
        if (gain > bestGain + 1e-12) { bestGain = gain; best = c; }
      }
      tot[best] += k[i];
      if (best !== ci) { comm[i] = best; moved = true; }
    }
    if (!moved) break;
  }
  return comm;
}

function louvain(adj: WAdj, gamma: number): number[] {
  let membership = Array.from({ length: adj.length }, (_, i) => i);
  let cur = adj;
  for (let level = 0; level < 8; level++) {
    const comm = louvainLevel(cur, gamma);
    const ids = new Map<number, number>();
    for (const c of comm) if (!ids.has(c)) ids.set(c, ids.size);
    if (ids.size === cur.length) break;
    membership = membership.map((c) => ids.get(comm[c])!);
    const agg: WAdj = Array.from({ length: ids.size }, () => new Map());
    cur.forEach((m, i) => {
      const a = ids.get(comm[i])!;
      for (const [j, wt] of m) { const b = ids.get(comm[j])!; agg[a].set(b, (agg[a].get(b) ?? 0) + wt); }
    });
    cur = agg;
  }
  return membership;
}

// ─── Packing grid ─────────────────────────────────────────────────────────────

class CircleGrid {
  private cells = new Map<number, number[]>();
  readonly xs: number[] = [];
  readonly ys: number[] = [];
  readonly rs: number[] = [];
  constructor(private cell: number) {}
  private key(ix: number, iy: number) { return (ix + 50000) * 100003 + (iy + 50000); }
  add(x: number, y: number, r: number): number {
    const id = this.xs.length;
    this.xs.push(x); this.ys.push(y); this.rs.push(r);
    const c = this.cell;
    for (let ix = Math.floor((x - r) / c); ix <= Math.floor((x + r) / c); ix++) {
      for (let iy = Math.floor((y - r) / c); iy <= Math.floor((y + r) / c); iy++) {
        const k = this.key(ix, iy);
        const list = this.cells.get(k);
        if (list) list.push(id); else this.cells.set(k, [id]);
      }
    }
    return id;
  }
  /** No circle within `gap` of (x, y, r). */
  free(x: number, y: number, r: number, gap: number): boolean {
    const c = this.cell, reach = r + gap;
    for (let ix = Math.floor((x - reach) / c); ix <= Math.floor((x + reach) / c); ix++) {
      for (let iy = Math.floor((y - reach) / c); iy <= Math.floor((y + reach) / c); iy++) {
        const list = this.cells.get(this.key(ix, iy));
        if (!list) continue;
        for (const j of list) {
          const dx = this.xs[j] - x, dy = this.ys[j] - y, rr = this.rs[j] + reach;
          if (dx * dx + dy * dy < rr * rr) return false;
        }
      }
    }
    return true;
  }
  /** Nearest placed circle to (x, y) within `maxD`, or -1. */
  nearest(x: number, y: number, maxD: number): number {
    const c = this.cell;
    let best = -1, bestD = maxD * maxD;
    for (let ix = Math.floor((x - maxD) / c); ix <= Math.floor((x + maxD) / c); ix++) {
      for (let iy = Math.floor((y - maxD) / c); iy <= Math.floor((y + maxD) / c); iy++) {
        const list = this.cells.get(this.key(ix, iy));
        if (!list) continue;
        for (const j of list) {
          const dx = this.xs[j] - x, dy = this.ys[j] - y, d = dx * dx + dy * dy;
          if (d < bestD) { bestD = d; best = j; }
        }
      }
    }
    return best;
  }
}

// ─── Build ────────────────────────────────────────────────────────────────────

export type BuildOptions = {
  /** Databases to culture; null = all. */
  enabled: Set<string> | null;
  /** Records excluded by field filters. */
  hidden?: Set<string>;
  schemas: DatabaseSchema[];
  colors: Record<string, string>;
  now?: Date;
};

const MIN_COLONY = 4;
const RESOLUTION = 1.5;

export function buildCulture(graph: GraphData, opts: BuildOptions): CultureWorld {
  const today = todayDay(opts.now ?? new Date());
  const schemaById = new Map(opts.schemas.map((s) => [s.databaseId, s]));

  // ── All dated records + the full relation graph (colonies come from this) ──
  const all = graph.nodes.filter((n) => parseDay(n.createdTime) !== null);
  const allIdx = new Map(all.map((n, i) => [n.id, i]));
  const fullAdj: WAdj = all.map(() => new Map());
  for (const e of graph.edges) {
    const a = allIdx.get(e.source), b = allIdx.get(e.target);
    if (a === undefined || b === undefined || a === b) continue;
    fullAdj[a].set(b, (fullAdj[a].get(b) ?? 0) + 1);
    fullAdj[b].set(a, (fullAdj[b].get(a) ?? 0) + 1);
  }
  // Deterministic: visit in id order
  const order = all.map((_, i) => i).sort((a, b) => (all[a].id < all[b].id ? -1 : 1));
  const remap = new Map(order.map((i, k) => [i, k]));
  const sortedAdj: WAdj = order.map((i) => {
    const m = new Map<number, number>();
    for (const [j, w] of fullAdj[i]) m.set(remap.get(j)!, w);
    return m;
  });
  const commSorted = louvain(sortedAdj, RESOLUTION);
  const community = new Array<number>(all.length);
  order.forEach((i, k) => { community[i] = commSorted[k]; });
  const commSize = new Map<number, number>();
  for (let i = 0; i < all.length; i++) if (fullAdj[i].size > 0) commSize.set(community[i], (commSize.get(community[i]) ?? 0) + 1);

  // ── Included organisms ──
  const included = all.filter((n) => (!opts.enabled || opts.enabled.has(n.databaseId)) && !opts.hidden?.has(n.id));

  // Species
  const speciesByDb = new Map<string, Species>();
  const dbCounts = new Map<string, number>();
  for (const n of included) dbCounts.set(n.databaseId, (dbCounts.get(n.databaseId) ?? 0) + 1);
  const dbOrder = [...dbCounts.keys()].sort((a, b) => dbCounts.get(b)! - dbCounts.get(a)! || (a < b ? -1 : 1));
  const morphs = speciesMorphs(graph.nodes);
  const species: Species[] = [];
  for (const dbId of dbOrder) {
    const sample = included.find((n) => n.databaseId === dbId)!;
    const name = sample.databaseName;
    const s: Species = { index: species.length, databaseId: dbId, name, color: opts.colors[dbId] ?? sample.color ?? "#999999", morph: morphs.get(dbId) ?? 0, count: dbCounts.get(dbId)! };
    species.push(s);
    speciesByDb.set(dbId, s);
  }

  // Lifecycle fields per database
  const nodesByDb = new Map<string, GraphNode[]>();
  for (const n of included) {
    const list = nodesByDb.get(n.databaseId);
    if (list) list.push(n); else nodesByDb.set(n.databaseId, [n]);
  }
  const fields = new Map<string, { status: string | null; done: string | null; start: string | null }>();
  for (const [dbId, nodes] of nodesByDb) {
    const schema = schemaById.get(dbId);
    fields.set(dbId, { status: pickStatusField(schema), done: pickDateField(schema, nodes, DONE_FIELD), start: pickDateField(schema, nodes, START_FIELD) });
  }

  // Organisms (unplaced), in birth order
  const sorted = included
    .map((node) => ({ node, born: parseDay(node.createdTime)! }))
    .sort((a, b) => a.born - b.born || (a.node.id < b.node.id ? -1 : 1));
  const organisms: Organism[] = sorted.map(({ node, born }, index) => {
    const f = fields.get(node.databaseId)!;
    const fv = node.fieldValues ?? {};
    const status = fieldText(f.status ? fv[f.status] : (fv.Status ?? fv.status ?? null));
    const doneDay = parseDay(fieldText(f.done ? fv[f.done] : null));
    const startDay = parseDay(fieldText(f.start ? fv[f.start] : null));
    let state: LifeState = "open";
    if (doneDay !== null || (status && DONE_STATUS.test(status))) state = "done";
    else if (status && BLOCKED_STATUS.test(status)) state = "blocked";
    else if (status && ACTIVE_STATUS.test(status)) state = "active";
    let dormantAt: number | null = null;
    let dormantKnown = false;
    if (state === "done") {
      if (doneDay !== null && doneDay <= today) { dormantAt = Math.max(born + 0.25, doneDay); dormantKnown = true; }
      else dormantAt = today;
    }
    let activeFrom: number | null = null;
    if (state === "active") activeFrom = startDay !== null && startDay > born && startDay < today ? startDay : born;
    else if (state === "done" && startDay !== null && dormantAt !== null && startDay > born && startDay < dormantAt) activeFrom = startDay;
    return {
      index, node, species: speciesByDb.get(node.databaseId)!.index, colony: -1, born,
      x: 0, y: 0, r: 1, angle: hash01(node.id + "a") * Math.PI * 2, degree: 0,
      origin: -1, originLinked: false, status, state, activeFrom, dormantAt, dormantKnown,
      linkTimes: [], seed: hash01(node.id),
    };
  });
  const byNodeId = new Map(organisms.map((o) => [o.node.id, o.index]));

  // Filaments + neighbors among included organisms
  const neighbors: number[][] = organisms.map(() => []);
  const filaments: Filament[] = [];
  const pairIndex = new Map<string, number>();
  for (const e of graph.edges) {
    const a = byNodeId.get(e.source), b = byNodeId.get(e.target);
    if (a === undefined || b === undefined || a === b) continue;
    const lo = Math.min(a, b), hi = Math.max(a, b);
    const key = `${lo}:${hi}`;
    const existing = pairIndex.get(key);
    if (existing !== undefined) { filaments[existing].weight++; continue; }
    pairIndex.set(key, filaments.length);
    filaments.push({ a: lo, b: hi, formed: Math.max(organisms[lo].born, organisms[hi].born), cross: false, weight: 1 });
    neighbors[lo].push(hi);
    neighbors[hi].push(lo);
  }
  for (const f of filaments) {
    organisms[f.a].linkTimes.push(f.formed);
    organisms[f.b].linkTimes.push(f.formed);
  }
  for (const o of organisms) {
    o.linkTimes.sort((x, y) => x - y);
    o.degree = o.linkTimes.length;
    o.r = radiusFor(o.degree);
  }

  // ── Colonies: communities big enough to stand alone; the rest are free-living per species ──
  const colonyOfComm = new Map<number, number>();
  const freeOfSpecies = new Map<number, number>();
  const colonies: Colony[] = [];
  const newColony = (free: boolean): Colony => {
    const c: Colony = { index: colonies.length, name: "", hub: -1, members: [], cx: 0, cy: 0, radius: 0, founded: 0, bySpecies: new Array(species.length).fill(0), free };
    colonies.push(c);
    return c;
  };
  for (const o of organisms) {
    const i = allIdx.get(o.node.id)!;
    const comm = community[i];
    const linked = fullAdj[i].size > 0 && (commSize.get(comm) ?? 0) >= MIN_COLONY;
    let c: Colony;
    if (linked) {
      const ci = colonyOfComm.get(comm);
      if (ci === undefined) { c = newColony(false); colonyOfComm.set(comm, c.index); } else c = colonies[ci];
    } else {
      const ci = freeOfSpecies.get(o.species);
      if (ci === undefined) { c = newColony(true); freeOfSpecies.set(o.species, c.index); } else c = colonies[ci];
    }
    o.colony = c.index;
    c.members.push(o.index);
    c.bySpecies[o.species]++;
  }
  for (const c of colonies) {
    c.founded = organisms[c.members[0]].born;
    let hub = c.members[0];
    for (const m of c.members) if (organisms[m].degree > organisms[hub].degree) hub = m;
    c.hub = hub;
    if (c.free) {
      const sp = species[organisms[c.members[0]].species];
      c.name = c.members.length === sp.count ? sp.name : `${sp.name} · unlinked`;
    } else {
      c.name = organismName(organisms[hub].node);
    }
  }
  for (const f of filaments) f.cross = organisms[f.a].colony !== organisms[f.b].colony;

  // ── Grow each colony in birth order ──
  for (const c of colonies) growColony(c, organisms, neighbors);

  // Founders migrate in from a linked colony that already existed
  for (const c of colonies) {
    const founder = organisms[c.members[0]];
    let best = -1;
    for (const nb of neighbors[founder.index]) {
      const o = organisms[nb];
      if (o.colony !== c.index && o.born < founder.born && (best < 0 || o.born < organisms[best].born)) best = nb;
    }
    if (best >= 0) { founder.origin = best; founder.originLinked = true; }
  }

  // ── Pack colonies into the dish ──
  const dishRadius = packColonies(colonies, organisms, filaments);

  // ── Timeline ──
  const tMin = organisms.length ? Math.floor(organisms[0].born) - 3 : today - 30;
  const tMax = Math.max(today, tMin + 7);
  const binDays = 7;
  const bins = Math.max(1, Math.ceil((tMax - tMin) / binDays));
  const births = new Uint16Array(bins * Math.max(1, species.length));
  const dormant = new Uint16Array(bins);
  let undatedDone = 0;
  for (const o of organisms) {
    const b = Math.min(bins - 1, Math.max(0, Math.floor((o.born - tMin) / binDays)));
    births[b * species.length + o.species]++;
    if (o.dormantAt !== null) {
      if (o.dormantKnown) dormant[Math.min(bins - 1, Math.max(0, Math.floor((o.dormantAt - tMin) / binDays)))]++;
      else undatedDone++;
    }
  }

  return {
    organisms, filaments, colonies, species, neighbors, byNodeId, dishRadius,
    tMin, tMax, hist: { t0: tMin, binDays, bins, births, dormant }, undatedDone,
  };
}

const GOLDEN = Math.PI * (3 - Math.sqrt(5));
/** Sunflower spacing that packs radius-1 cells with GAP between them. */
const SUNFLOWER = (2 * BASE_R + GAP) * 0.56;

/** Place a colony's members around its founder, each budding off its strongest placed link. */
function growColony(c: Colony, organisms: Organism[], neighbors: number[][]) {
  const grid = new CircleGrid(4);
  const slot = new Map<number, number>(); // organism → grid id
  // Cells with nothing placed to bud from fill the next free sunflower slot,
  // so the colony accretes outward from its founder (oldest at the core).
  let sun = 1;
  const nextSunflowerSlot = (r: number): [number, number] => {
    for (let guard = 0; guard < 200000; guard++, sun++) {
      const d = SUNFLOWER * Math.sqrt(sun), a = sun * GOLDEN;
      const x = Math.cos(a) * d, y = Math.sin(a) * d;
      if (grid.free(x, y, r, GAP)) { sun++; return [x, y]; }
    }
    return [0, 0];
  };
  for (let k = 0; k < c.members.length; k++) {
    const o = organisms[c.members[k]];
    if (k === 0) {
      o.x = 0; o.y = 0;
      slot.set(o.index, grid.add(0, 0, o.r));
      continue;
    }
    // Strongest already-placed link in this colony
    let parent = -1;
    for (const nb of neighbors[o.index]) {
      const p = organisms[nb];
      if (p.colony !== c.index || !slot.has(nb)) continue;
      if (parent < 0 || p.degree > organisms[parent].degree || (p.degree === organisms[parent].degree && p.born < organisms[parent].born)) parent = nb;
    }
    let placed: [number, number] | null = null;
    if (parent >= 0) {
      const p = organisms[parent];
      const away = Math.hypot(p.x, p.y) > 0.5 ? Math.atan2(p.y, p.x) : o.seed * Math.PI * 2;
      const pref = away + (hash01(o.node.id + "p") - 0.5) * 1.6;
      placed = ringSearch(grid, p.x, p.y, p.r, o.r, pref, 26);
      if (placed) { o.origin = parent; o.originLinked = true; }
    }
    if (!placed) placed = nextSunflowerSlot(o.r);
    o.x = placed[0]; o.y = placed[1];
    if (!o.originLinked) {
      const near = grid.nearest(o.x, o.y, o.r * 2 + 30);
      if (near >= 0) {
        // grid ids are in placement order == c.members order
        o.origin = c.members[near];
      }
    }
    slot.set(o.index, grid.add(o.x, o.y, o.r));
  }
  // Recentre on the bounding box and measure
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const m of c.members) {
    const o = organisms[m];
    x0 = Math.min(x0, o.x - o.r); x1 = Math.max(x1, o.x + o.r);
    y0 = Math.min(y0, o.y - o.r); y1 = Math.max(y1, o.y + o.r);
  }
  const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
  let radius = 0;
  for (const m of c.members) {
    const o = organisms[m];
    o.x -= mx; o.y -= my;
    radius = Math.max(radius, Math.hypot(o.x, o.y) + o.r);
  }
  c.radius = radius;
}

/** First free spot on rings around (cx, cy), trying angles nearest `pref` first. */
function ringSearch(grid: CircleGrid, cx: number, cy: number, pr: number, r: number, pref: number, maxRings: number): [number, number] | null {
  for (let ring = 0; ring < maxRings; ring++) {
    const d = pr + r + GAP + ring * (r * 0.8 + GAP);
    if (d < 1e-6) {
      if (grid.free(cx, cy, r, GAP)) return [cx, cy];
      continue;
    }
    const step = Math.min(Math.PI, ((2 * r + GAP) / d) * 0.85);
    const n = Math.ceil(Math.PI / step);
    for (let k = 0; k <= n; k++) {
      for (let s = k === 0 ? 1 : -1; s <= 1; s += 2) {
        const a = pref + s * k * step;
        const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d;
        if (grid.free(x, y, r, GAP)) return [x, y];
      }
    }
  }
  return null;
}

/** Place colonies beside their most related placed neighbour (largest first), then relax. Returns the dish radius. */
function packColonies(colonies: Colony[], organisms: Organism[], filaments: Filament[]): number {
  const n = colonies.length;
  if (n === 0) return 60;
  const affinity: Array<Map<number, number>> = colonies.map(() => new Map());
  for (const f of filaments) {
    if (!f.cross) continue;
    const a = organisms[f.a].colony, b = organisms[f.b].colony;
    affinity[a].set(b, (affinity[a].get(b) ?? 0) + f.weight);
    affinity[b].set(a, (affinity[b].get(a) ?? 0) + f.weight);
  }
  const gapFor = (c: Colony) => 5 + c.radius * 0.06;
  const order = colonies.map((c) => c.index).sort((a, b) => colonies[b].members.length - colonies[a].members.length || a - b);
  const placed: number[] = [];
  const px = new Float64Array(n), py = new Float64Array(n);
  const fits = (i: number, x: number, y: number) => {
    for (const j of placed) {
      const d = Math.hypot(px[j] - x, py[j] - y);
      if (d < colonies[i].radius + colonies[j].radius + Math.max(gapFor(colonies[i]), gapFor(colonies[j]))) return false;
    }
    return true;
  };
  const cost = (i: number, x: number, y: number) => {
    let s = Math.hypot(x, y) * 0.35;
    for (const [j, w] of affinity[i]) if (placed.includes(j)) s += Math.hypot(px[j] - x, py[j] - y) * Math.min(4, Math.sqrt(w));
    return s;
  };
  for (const i of order) {
    const c = colonies[i];
    if (placed.length === 0) { px[i] = 0; py[i] = 0; placed.push(i); continue; }
    let best: [number, number] | null = null, bestCost = Infinity;
    // Candidates: around each placed colony, touching it
    for (const j of placed) {
      const d = colonies[j].radius + c.radius + Math.max(gapFor(c), gapFor(colonies[j])) + 0.5;
      for (let k = 0; k < 36; k++) {
        const a = (k / 36) * Math.PI * 2 + i * 0.37;
        const x = px[j] + Math.cos(a) * d, y = py[j] + Math.sin(a) * d;
        if (!fits(i, x, y)) continue;
        const cst = cost(i, x, y);
        if (cst < bestCost) { bestCost = cst; best = [x, y]; }
      }
    }
    if (!best) {
      // Spiral outward until it fits
      for (let k = 1; k < 4000 && !best; k++) {
        const a = k * 2.39996, d = 4 * Math.sqrt(k) * (1 + c.radius * 0.05);
        if (fits(i, Math.cos(a) * d, Math.sin(a) * d)) best = [Math.cos(a) * d, Math.sin(a) * d];
      }
    }
    px[i] = best ? best[0] : 0;
    py[i] = best ? best[1] : 0;
    placed.push(i);
  }

  // Relax: related colonies drift together, overlaps push apart, everything settles toward the middle
  const vx = new Float64Array(n), vy = new Float64Array(n);
  for (let it = 0; it < 220; it++) {
    vx.fill(0); vy.fill(0);
    for (let i = 0; i < n; i++) {
      for (const [j, w] of affinity[i]) {
        if (j <= i) continue;
        const dx = px[j] - px[i], dy = py[j] - py[i], d = Math.hypot(dx, dy) || 1;
        const rest = colonies[i].radius + colonies[j].radius + 6;
        if (d <= rest) continue;
        const f = Math.min(1.5, (d - rest) * 0.004 * Math.min(4, Math.sqrt(w)));
        vx[i] += (dx / d) * f; vy[i] += (dy / d) * f;
        vx[j] -= (dx / d) * f; vy[j] -= (dy / d) * f;
      }
      vx[i] -= px[i] * 0.003; vy[i] -= py[i] * 0.003;
    }
    for (let i = 0; i < n; i++) { px[i] += vx[i]; py[i] += vy[i]; }
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const dx = px[j] - px[i], dy = py[j] - py[i], d = Math.hypot(dx, dy) || 0.01;
          const min = colonies[i].radius + colonies[j].radius + Math.max(gapFor(colonies[i]), gapFor(colonies[j]));
          if (d >= min) continue;
          const push = (min - d) / 2, wi = colonies[j].radius / (colonies[i].radius + colonies[j].radius);
          px[i] -= (dx / d) * push * 2 * wi; py[i] -= (dy / d) * push * 2 * wi;
          px[j] += (dx / d) * push * 2 * (1 - wi); py[j] += (dy / d) * push * 2 * (1 - wi);
        }
      }
    }
  }

  // Centre the culture on (nearly) its smallest enclosing circle: start at the
  // centroid and keep stepping toward whichever colony sticks out furthest
  let mx = 0, my = 0, wsum = 0;
  for (let i = 0; i < n; i++) { const w = colonies[i].members.length; mx += px[i] * w; my += py[i] * w; wsum += w; }
  mx /= wsum || 1; my /= wsum || 1;
  for (let k = 1; k <= 400; k++) {
    let far = 0, fd = -Infinity;
    for (let i = 0; i < n; i++) {
      const d = Math.hypot(px[i] - mx, py[i] - my) + colonies[i].radius;
      if (d > fd) { fd = d; far = i; }
    }
    const dx = px[far] - mx, dy = py[far] - my, dl = Math.hypot(dx, dy) || 1;
    // the furthest edge point of that colony
    const ex = px[far] + (dx / dl) * colonies[far].radius, ey = py[far] + (dy / dl) * colonies[far].radius;
    mx += (ex - mx) / (k + 1) * 0.5;
    my += (ey - my) / (k + 1) * 0.5;
  }
  let dish = 0;
  for (const c of colonies) {
    c.cx = px[c.index] - mx;
    c.cy = py[c.index] - my;
    dish = Math.max(dish, Math.hypot(c.cx, c.cy) + c.radius);
    for (const m of c.members) { organisms[m].x += c.cx; organisms[m].y += c.cy; }
  }
  return dish + 14;
}

// ─── Worker transport ─────────────────────────────────────────────────────────
// Organisms cross the worker boundary with an index into graph.nodes instead of
// the node itself, so records aren't cloned back and forth.

export type PackedOrganism = Omit<Organism, "node"> & { nodeIndex: number };
export type PackedWorld = Omit<CultureWorld, "organisms" | "byNodeId"> & { organisms: PackedOrganism[] };

export type CultureWorkerRequest =
  | { type: "graph"; graph: GraphData; schemas: DatabaseSchema[] }
  | { type: "build"; seq: number; enabled: string[] | null; hidden: string[]; colors: Record<string, string>; now: number };

export type CultureWorkerResponse = { seq: number; world: PackedWorld; ms: number };

export function packCulture(world: CultureWorld, nodeIndex: Map<string, number>): PackedWorld {
  const { organisms, byNodeId: _unused, ...rest } = world;
  void _unused;
  return { ...rest, organisms: organisms.map(({ node, ...o }) => ({ ...o, nodeIndex: nodeIndex.get(node.id)! })) };
}

export function hydrateCulture(packed: PackedWorld, nodes: GraphNode[]): CultureWorld {
  const organisms: Organism[] = packed.organisms.map(({ nodeIndex, ...o }) => ({ ...o, node: nodes[nodeIndex] }));
  return { ...packed, organisms, byNodeId: new Map(organisms.map((o) => [o.node.id, o.index])) };
}
