import type { DatabaseFieldConfig, DatabaseSchema, GraphData, GraphNode } from "./types";

/**
 * The Line — everyone on one shared timeline.
 *
 * Pure data layer: resolves which people field and which date fields place
 * each record, builds one lane per person, and packs date spans into
 * non-overlapping tracks. All times are "wall-clock days": local calendar
 * date/time expressed as fractional days since EPOCH (UTC arithmetic), so
 * month/week boundaries line up with what the user sees in Notion.
 */

// ─── Time ─────────────────────────────────────────────────────────────────────

const EPOCH_MS = Date.UTC(2020, 0, 1);
const DAY_MS = 86_400_000;

/** Wall-clock days since EPOCH → a Date whose UTC fields carry the wall-clock time. */
export function dayToDate(day: number): Date {
  return new Date(EPOCH_MS + day * DAY_MS);
}

export function dateToDay(utcFields: Date): number {
  return (utcFields.getTime() - EPOCH_MS) / DAY_MS;
}

/** Parse a Notion date value ("2026-10-12" or full ISO) into wall-clock days. */
export function parseDay(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (m) return (Date.UTC(+m[1], +m[2] - 1, +m[3]) - EPOCH_MS) / DAY_MS;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return null;
  const d = new Date(ms);
  const wall = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes());
  return (wall - EPOCH_MS) / DAY_MS;
}

export function todayDay(now = new Date()): number {
  const wall = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes());
  return (wall - EPOCH_MS) / DAY_MS;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatDay(day: number, withYear = true): string {
  const d = dayToDate(day);
  const s = `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
  return withYear ? `${s}, ${d.getUTCFullYear()}` : s;
}

export function formatSpan(t0: number, t1: number): string {
  const a = dayToDate(t0), b = dayToDate(t1);
  const sameYear = a.getUTCFullYear() === b.getUTCFullYear();
  return `${formatDay(t0, !sameYear)} → ${formatDay(t1)}`;
}

// ─── Field resolution ─────────────────────────────────────────────────────────

const PEOPLE_PREFERENCE = [
  /^owner(s|\(s\))?$/i, /^assigned to$/i, /^assignees?$/i, /^author$/i, /^resource$/i,
  /^reviewer$/i, /^worker$/i, /^lead$/i, /^dri$/i,
];
/** People fields that list permissions or watchers rather than who did the work. */
const PEOPLE_NOISE = /can update|watcher|approved by|subscriber|follower|cc\b/i;

const START_FIELD = /^(start|start date|started|in progress time|kickoff)$/i;
const END_FIELD = /^(end|end date|end-date|finish|finish date)$/i;
const DONE_FIELD = /^(completed|completed date|date completed|done date|deployed date|closed date|resolved date)$/i;
const DUE_FIELD = /^(due|due date|deadline|target date|target deploy date|must have date)$/i;
const POINT_FIELD = /^(date|dates|date sent|review date|sign-off date|effective date|report date|meeting date)$/i;

const DONE_STATUS = /done|complete|deployed|published|answered|sent|signed|resolved|closed|shipped|finished/i;
const BLOCKED_STATUS = /block|hold|cancel/i;
const ACTIVE_STATUS = /progress|testing|review|approved for deploy|active|doing/i;

export type DateRule = {
  start: string | null;
  end: string | null;
  done: string | null;
  due: string | null;
  point: string | null;
};

export type LineSource = {
  databaseId: string;
  databaseName: string;
  color: string;
  /** People fields available in this database (type "people"). */
  peopleFields: string[];
  /** The field actually used (configured, else best guess). */
  peopleField: string | null;
  /** True when the configured field no longer exists and we fell back. */
  peopleFieldStale: boolean;
  dates: DateRule;
  detailField: string | null;
  /** Records in this database (after filters) / records that landed on a lane. */
  total: number;
  placed: number;
};

function pickPeopleField(fields: string[]): string | null {
  for (const re of PEOPLE_PREFERENCE) {
    const hit = fields.find((f) => re.test(f));
    if (hit) return hit;
  }
  return fields.find((f) => !PEOPLE_NOISE.test(f)) ?? null;
}

/** For each role, the matching date field that is filled in on the most records. */
function pickDateRule(schema: DatabaseSchema, nodes: GraphNode[]): DateRule {
  const dateFields = schema.fields.filter((f) => f.type === "date").map((f) => f.name);
  const coverage = new Map<string, number>();
  for (const f of dateFields) coverage.set(f, nodes.reduce((n, node) => n + (node.fieldValues?.[f] ? 1 : 0), 0));
  const find = (re: RegExp) => {
    let best: string | null = null, bestN = 0;
    for (const f of dateFields) {
      const n = coverage.get(f) ?? 0;
      if (re.test(f.trim()) && n > bestN) { best = f; bestN = n; }
    }
    return best;
  };
  return { start: find(START_FIELD), end: find(END_FIELD), done: find(DONE_FIELD), due: find(DUE_FIELD), point: find(POINT_FIELD) };
}

/** Human summary of how a database's records are placed, e.g. "Start date → End date · else Due". */
export function describeDateRule(r: DateRule): string {
  const parts: string[] = [];
  const close = r.end ?? r.done;
  if (r.start && close) parts.push(`${r.start} → ${close}`);
  if (r.done) parts.push(r.done);
  if (r.due) parts.push(r.due);
  if (r.start) parts.push(r.start);
  if (r.point) parts.push(r.point);
  parts.push("created");
  return parts.join(" · else ");
}

// ─── Model types ──────────────────────────────────────────────────────────────

export type EventKind = "span" | "done" | "due" | "start" | "date" | "created";
export type EventState = "done" | "active" | "blocked" | "open";

export type LineEvent = {
  index: number;
  node: GraphNode;
  kind: EventKind;
  /** Wall-clock days. Points have t0 === t1. */
  t0: number;
  t1: number;
  /** A span still running (no end date, in progress) — drawn up to today. */
  ongoing: boolean;
  state: EventState;
  status: string | null;
  overdue: boolean;
  detail: string | null;
  /** Lanes (person indices) this record appears on. */
  people: number[];
};

export type LinePerson = {
  index: number;
  key: string;
  name: string;
  /** Person accent (hsl) — stable per name. */
  hue: number;
  events: number[];
  spans: number;
  first: number;
  last: number;
  byDb: Record<string, number>;
  done: number;
  overdue: number;
};

export type LineModel = {
  events: LineEvent[];
  people: LinePerson[];
  sources: LineSource[];
  tMin: number;
  tMax: number;
  today: number;
  /** Records → event index, for search / details navigation. */
  byNodeId: Map<string, number>;
};

// ─── Build ────────────────────────────────────────────────────────────────────

function hashHue(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12;
  return (h >>> 0) % 360;
}

/** Unresolved Notion users sync as their raw id — not a person we can name. */
const RAW_ID = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

function names(value: string | string[] | null | undefined): string[] {
  if (value == null) return [];
  const raw = Array.isArray(value) ? value : [value];
  return raw.flatMap((v) => v.split(",")).map((s) => s.trim()).filter((s) => s && !RAW_ID.test(s));
}

/** The window holding the bulk (5th–95th percentile) of a person's activity. */
export function personWindow(model: LineModel, person: number): [number, number] {
  const p = model.people[person];
  const ts = p.events.flatMap((e) => [model.events[e].t0, model.events[e].t1]).sort((a, b) => a - b);
  if (ts.length === 0) return [model.today - 30, model.today + 30];
  const a = ts[Math.floor((ts.length - 1) * 0.05)], b = ts[Math.ceil((ts.length - 1) * 0.95)];
  return [a, Math.max(b, a + 7)];
}

function fieldText(v: string | string[] | null | undefined): string | null {
  if (v == null) return null;
  const s = Array.isArray(v) ? v.filter(Boolean).join(", ") : v;
  return s && s !== "No content" ? s : null;
}

function resolveState(status: string | null, hasDone: boolean): EventState {
  if (hasDone || (status && DONE_STATUS.test(status))) return "done";
  if (status && BLOCKED_STATUS.test(status)) return "blocked";
  if (status && ACTIVE_STATUS.test(status)) return "active";
  return "open";
}

export function buildLineModel(
  graph: GraphData,
  schemas: DatabaseSchema[],
  fieldConfig: Record<string, DatabaseFieldConfig>,
  enabled: Set<string> | null,
  now = new Date(),
): LineModel {
  const today = todayDay(now);
  const schemaById = new Map(schemas.map((s) => [s.databaseId, s]));

  // Sources: every database with at least one people field
  const sources: LineSource[] = [];
  const sourceById = new Map<string, LineSource>();
  const totals = new Map<string, number>();
  const nodesByDb = new Map<string, GraphNode[]>();
  for (const n of graph.nodes) {
    totals.set(n.databaseId, (totals.get(n.databaseId) ?? 0) + 1);
    let list = nodesByDb.get(n.databaseId);
    if (!list) { list = []; nodesByDb.set(n.databaseId, list); }
    list.push(n);
  }
  for (const schema of schemas) {
    const peopleFields = schema.fields.filter((f) => f.type === "people").map((f) => f.name);
    if (peopleFields.length === 0 || !totals.get(schema.databaseId)) continue;
    const cfg = fieldConfig[schema.databaseId];
    const configured = cfg?.nameField ?? null;
    const valid = configured && peopleFields.includes(configured) ? configured : null;
    const color = graph.nodes.find((n) => n.databaseId === schema.databaseId)?.color ?? "#888888";
    const detailField = cfg?.detailField && schema.fields.some((f) => f.name === cfg.detailField) ? cfg.detailField : null;
    const src: LineSource = {
      databaseId: schema.databaseId,
      databaseName: schema.databaseName,
      color,
      peopleFields,
      peopleField: valid ?? pickPeopleField(peopleFields),
      peopleFieldStale: !!configured && !valid,
      dates: pickDateRule(schema, nodesByDb.get(schema.databaseId) ?? []),
      detailField,
      total: 0,
      placed: 0,
    };
    sources.push(src);
    sourceById.set(src.databaseId, src);
  }
  sources.sort((a, b) => (totals.get(b.databaseId) ?? 0) - (totals.get(a.databaseId) ?? 0));

  const events: LineEvent[] = [];
  const personByKey = new Map<string, LinePerson>();
  const people: LinePerson[] = [];
  let tMin = Infinity, tMax = -Infinity;

  for (const node of graph.nodes) {
    const src = sourceById.get(node.databaseId);
    if (!src) continue;
    src.total++;
    if (enabled && !enabled.has(src.databaseId)) continue;
    if (!src.peopleField) continue;
    const who = names(node.fieldValues?.[src.peopleField]);
    if (who.length === 0) continue;

    const fv = node.fieldValues ?? {};
    const r = src.dates;
    const start = parseDay(fieldText(r.start ? fv[r.start] : null));
    const end = parseDay(fieldText(r.end ? fv[r.end] : null));
    const done = parseDay(fieldText(r.done ? fv[r.done] : null));
    const due = parseDay(fieldText(r.due ? fv[r.due] : null));
    const point = parseDay(fieldText(r.point ? fv[r.point] : null));
    const status = fieldText(fv.Status ?? fv.status ?? null);
    const state = resolveState(status, done !== null);

    let kind: EventKind, t0: number, t1: number, ongoing = false;
    const close = end ?? done;
    if (start !== null && close !== null) {
      kind = "span"; t0 = Math.min(start, close); t1 = Math.max(start, close);
    } else if (start !== null && state === "active" && today > start) {
      kind = "span"; t0 = start; t1 = today; ongoing = true;
    } else if (done !== null) {
      kind = "done"; t0 = t1 = done;
    } else if (due !== null) {
      kind = "due"; t0 = t1 = due;
    } else if (start !== null) {
      kind = "start"; t0 = t1 = start;
    } else if (point !== null) {
      kind = "date"; t0 = t1 = point;
    } else {
      const c = parseDay(node.createdTime);
      if (c === null) continue;
      kind = "created"; t0 = t1 = c;
    }
    if (kind === "span" && t1 - t0 < 0.5) { kind = "date"; t1 = t0; }

    const overdue = state !== "done" && ((due !== null && due < today) || (end !== null && end < today && kind === "span"));
    const ev: LineEvent = {
      index: events.length, node, kind, t0, t1, ongoing, state, status, overdue,
      detail: src.detailField ? fieldText(fv[src.detailField]) : null,
      people: [],
    };

    const seen = new Set<string>();
    for (const name of who) {
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      let p = personByKey.get(key);
      if (!p) {
        p = { index: people.length, key, name, hue: hashHue(key), events: [], spans: 0, first: Infinity, last: -Infinity, byDb: {}, done: 0, overdue: 0 };
        personByKey.set(key, p);
        people.push(p);
      }
      p.events.push(ev.index);
      if (kind === "span") p.spans++;
      if (state === "done") p.done++;
      if (overdue) p.overdue++;
      p.first = Math.min(p.first, t0);
      p.last = Math.max(p.last, t1);
      p.byDb[node.databaseId] = (p.byDb[node.databaseId] ?? 0) + 1;
      ev.people.push(p.index);
    }
    events.push(ev);
    src.placed++;
    tMin = Math.min(tMin, t0);
    tMax = Math.max(tMax, t1);
  }

  if (!Number.isFinite(tMin)) { tMin = today - 30; tMax = today + 30; }
  const byNodeId = new Map(events.map((e) => [e.node.id, e.index]));
  return { events, people, sources, tMin, tMax, today, byNodeId };
}

// ─── Lane layout ──────────────────────────────────────────────────────────────

export type LaneSort = "activity" | "name" | "recent" | "earliest";

/** Depth units (world Z) between consecutive lanes, before span tracks. */
export const LANE_GAP = 5.5;
/** Depth of one span track (spans are painted on the ground just behind the lane line). */
export const TRACK_DEPTH = 1.15;
export const MAX_TRACKS = 6;

export type LaneLayout = {
  /** Person indices front → back. */
  order: number[];
  /** Per person: lane line Z (front lane = 0, further lanes negative). */
  laneZ: Float64Array;
  /** Per person: number of span tracks behind the lane line. */
  tracks: Int32Array;
  /** Per (event, person) span instance: track index. Keyed `${event}:${person}`. */
  spanTrack: Map<string, number>;
  /** Z of the back-most lane. */
  depth: number;
};

export function sortPeople(model: LineModel, sort: LaneSort): number[] {
  const order = model.people.map((p) => p.index);
  const by = {
    activity: (a: LinePerson, b: LinePerson) => b.events.length - a.events.length || a.name.localeCompare(b.name),
    name: (a: LinePerson, b: LinePerson) => a.name.localeCompare(b.name),
    recent: (a: LinePerson, b: LinePerson) => b.last - a.last || b.events.length - a.events.length,
    earliest: (a: LinePerson, b: LinePerson) => a.first - b.first || b.events.length - a.events.length,
  }[sort];
  return order.sort((a, b) => by(model.people[a], model.people[b]));
}

export function layoutLanes(model: LineModel, order: number[]): LaneLayout {
  const P = model.people.length;
  const laneZ = new Float64Array(P);
  const tracks = new Int32Array(P);
  const spanTrack = new Map<string, number>();

  for (const p of model.people) {
    const spans = p.events.filter((e) => model.events[e].kind === "span")
      .sort((a, b) => model.events[a].t0 - model.events[b].t0 || model.events[b].t1 - model.events[a].t1);
    const ends: number[] = [];
    for (const e of spans) {
      const ev = model.events[e];
      let t = ends.findIndex((end) => end <= ev.t0 - 0.5);
      if (t < 0) {
        if (ends.length < MAX_TRACKS) t = ends.length;
        else t = ends.indexOf(Math.min(...ends)); // overflow: share the track that frees up first
      }
      ends[t] = Math.max(ends[t] ?? -Infinity, ev.t1);
      spanTrack.set(`${e}:${p.index}`, t);
    }
    tracks[p.index] = ends.length;
  }

  // Each lane owns the band behind its line (spans on the ground, columns standing on the line)
  let z = 0;
  order.forEach((pi, k) => {
    if (k > 0) z -= LANE_GAP + tracks[order[k - 1]] * TRACK_DEPTH;
    laneZ[pi] = z;
  });
  const last = order[order.length - 1];
  return { order, laneZ, tracks, spanTrack, depth: z - (last !== undefined ? tracks[last] * TRACK_DEPTH : 0) };
}

/**
 * Stack point events into columns. Points of one person that fall into the
 * same time bucket form a column (the lane's activity histogram); the bucket
 * width follows the zoom so columns re-bin as you zoom. Returns per
 * (point instance) the column centre time and the stack slot.
 */
export function stackPoints(
  instances: Array<{ event: number; person: number; t: number }>,
  bucketDays: number,
): { center: Float32Array; slot: Float32Array; count: Float32Array } {
  const n = instances.length;
  const center = new Float32Array(n);
  const slot = new Float32Array(n);
  const count = new Float32Array(n);
  const groups = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    const it = instances[i];
    const b = bucketDays > 0 ? Math.floor(it.t / bucketDays) : it.t;
    const k = `${it.person}:${b}`;
    let g = groups.get(k);
    if (!g) { g = []; groups.set(k, g); }
    g.push(i);
  }
  for (const g of groups.values()) {
    g.sort((a, b) => instances[a].t - instances[b].t || instances[a].event - instances[b].event);
    const c = bucketDays > 0 ? (Math.floor(instances[g[0]].t / bucketDays) + 0.5) * bucketDays : instances[g[0]].t;
    g.forEach((idx, k) => { center[idx] = bucketDays > 0 ? c : instances[idx].t; slot[idx] = k; count[idx] = g.length; });
  }
  return { center, slot, count };
}

// ─── Time ticks ───────────────────────────────────────────────────────────────

export type TickLevel = "year" | "quarter" | "month" | "week" | "day";
export type Tick = { t: number; major: boolean; label: string };

/** Pick the tick level for a zoom expressed as pixels per day. */
export function tickLevel(pxPerDay: number): TickLevel {
  if (pxPerDay > 34) return "day";
  if (pxPerDay > 7) return "week";
  if (pxPerDay > 1.6) return "month";
  if (pxPerDay > 0.5) return "quarter";
  return "year";
}

/** Calendar ticks covering [t0, t1] at the given level; majors mark the next level up. */
export function buildTicks(t0: number, t1: number, level: TickLevel): Tick[] {
  const out: Tick[] = [];
  const a = dayToDate(t0);
  const y0 = a.getUTCFullYear(), m0 = a.getUTCMonth();
  const push = (d: Date, major: boolean, label: string) => out.push({ t: dateToDay(d), major, label });
  if (level === "year" || level === "quarter" || level === "month") {
    const step = level === "year" ? 12 : level === "quarter" ? 3 : 1;
    let y = y0, m = level === "month" ? m0 : Math.floor(m0 / step) * step;
    if (level === "year") m = 0;
    for (let guard = 0; guard < 2000; guard++) {
      const d = new Date(Date.UTC(y, m, 1));
      if (dateToDay(d) > t1) break;
      const major = m === 0;
      const label = level === "year" ? String(y)
        : level === "quarter" ? (m === 0 ? String(y) : `Q${m / 3 + 1}`)
        : (m === 0 ? `${MONTHS[m]} ${y}` : MONTHS[m]);
      push(d, major, label);
      m += step;
      if (m >= 12) { m -= 12; y++; }
    }
    return out;
  }
  // week / day: walk days from t0
  const start = Math.floor(t0);
  for (let t = start; t <= t1 && out.length < 4000; t++) {
    const d = dayToDate(t);
    const dom = d.getUTCDate();
    const dow = d.getUTCDay();
    if (level === "week" && dow !== 1 && dom !== 1) continue;
    const major = dom === 1;
    const label = major ? `${MONTHS[d.getUTCMonth()]}${d.getUTCMonth() === 0 ? ` ${d.getUTCFullYear()}` : ""}` : String(dom);
    out.push({ t, major, label });
  }
  return out;
}

/** Activity histogram across the whole model, for the overview strip. */
export function activityHistogram(model: LineModel, bins: number): { counts: Float32Array; t0: number; t1: number } {
  const pad = Math.max(7, (model.tMax - model.tMin) * 0.04);
  const t0 = model.tMin - pad, t1 = model.tMax + pad;
  const counts = new Float32Array(bins);
  const w = (t1 - t0) / bins;
  for (const e of model.events) {
    if (e.kind === "span") {
      const a = Math.max(0, Math.floor((e.t0 - t0) / w)), b = Math.min(bins - 1, Math.floor((e.t1 - t0) / w));
      const share = 1 / Math.max(1, b - a + 1);
      for (let i = a; i <= b; i++) counts[i] += share * 2;
    } else {
      const i = Math.min(bins - 1, Math.max(0, Math.floor((e.t0 - t0) / w)));
      counts[i] += 1;
    }
  }
  return { counts, t0, t1 };
}

// ─── Descriptions & relations ─────────────────────────────────────────────────

/** Record title for display — untitled Notion pages sync with their id as the name. */
export function displayName(node: { id: string; name: string }): string {
  const n = node.name?.trim();
  if (!n || /^[0-9a-f]{32}$/i.test(n) || n.replace(/-/g, "") === node.id.replace(/-/g, "")) return "Untitled";
  return n;
}

const KIND_LABEL: Record<EventKind, string> = {
  span: "Span", done: "Completed", due: "Due", start: "Starts", date: "Dated", created: "Created",
};

export function kindLabel(kind: EventKind): string {
  return KIND_LABEL[kind];
}

/** "Oct 1 → Nov 14, 2026 · 44 days", "Due Oct 3, 2026 · 11 days overdue", … */
export function describeWhen(ev: LineEvent, today: number): string {
  if (ev.kind === "span") {
    const days = Math.max(1, Math.round(ev.t1 - ev.t0));
    return `${formatSpan(ev.t0, ev.t1)}${ev.ongoing ? " (ongoing)" : ""} · ${days} day${days === 1 ? "" : "s"}`;
  }
  const base = `${KIND_LABEL[ev.kind]} ${formatDay(ev.t0)}`;
  if (ev.kind === "created") return `${base} · no date set`;
  if (ev.overdue) {
    const late = Math.max(1, Math.round(today - ev.t0));
    return `${base} · ${late} day${late === 1 ? "" : "s"} overdue`;
  }
  return base;
}

/** Events linked to `event` through graph relations (both directions), on the timeline. */
export function relatedEvents(model: LineModel, edges: GraphData["edges"], event: number): number[] {
  const id = model.events[event]?.node.id;
  if (!id) return [];
  const out = new Set<number>();
  for (const e of edges) {
    const other = e.source === id ? e.target : e.target === id ? e.source : null;
    if (!other) continue;
    const idx = model.byNodeId.get(other);
    if (idx !== undefined && idx !== event) out.add(idx);
  }
  return [...out];
}
