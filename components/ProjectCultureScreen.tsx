"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

import { CultureCanvas, type CultureApi, type CultureSettings, type CultureStain } from "@/components/CultureCanvas";
import { CultureGlyph } from "@/components/CultureGlyph";
import { CultureSpeciesPanel, type PanelTab, type SpeciesSource } from "@/components/CultureSpeciesPanel";
import { CultureTimeline, DAYS_PER_SECOND, SPEEDS, type CultureStats } from "@/components/CultureTimeline";
import { NodeDetailsPanel } from "@/components/NodeDetailsPanel";
import { NodeSearch, nodeToDetail } from "@/components/NodeSearch";
import { useTheme } from "@/components/ThemeProvider";
import {
  degreeAt,
  hydrateCulture,
  MORPH_NAMES,
  organismName,
  speciesMorphs,
  type CultureWorkerRequest,
  type CultureWorkerResponse,
  type CultureWorld,
} from "@/lib/cultureWorld";
import { formatDay } from "@/lib/lineModel";
import { setCodec, useStoredState } from "@/lib/useStoredState";
import type { CultureConfig, DatabaseFieldConfig, DatabaseSchema, GraphData, GraphNode, NodeDetail } from "@/lib/types";

type Props = {
  initialGraph: GraphData;
  databaseColors: Record<string, string>;
  fieldConfig: Record<string, DatabaseFieldConfig>;
  schemas: DatabaseSchema[];
  initialCultureConfig?: CultureConfig;
};

type ScreenSettings = CultureSettings & { timelapse: boolean };
const DEFAULT_SETTINGS: ScreenSettings = { filaments: true, sizeScale: 1, stain: "species", labels: true, timelapse: true };

const chromeButton: React.CSSProperties = {
  height: 28, borderRadius: 8, border: "1px solid var(--border-default)", background: "var(--panel-bg)",
  backdropFilter: "blur(12px)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
  gap: 6, color: "var(--text-muted)", boxShadow: "var(--shadow-sm)", transition: "background 0.15s, color 0.15s",
  fontFamily: "'Geist', sans-serif", fontSize: 11.5, fontWeight: 500, padding: "0 10px",
};
function hoverIn(e: React.MouseEvent) {
  (e.currentTarget as HTMLElement).style.background = "var(--bg-overlay)";
  (e.currentTarget as HTMLElement).style.color = "var(--text-primary)";
}
function hoverOut(e: React.MouseEvent) {
  (e.currentTarget as HTMLElement).style.background = "var(--panel-bg)";
  (e.currentTarget as HTMLElement).style.color = "var(--text-muted)";
}

function Key({ k }: { k: string }) {
  return <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: "var(--text-primary)", background: "var(--bg-overlay)", border: "1px solid var(--border-default)", borderRadius: 4, padding: "1px 5px" }}>{k}</span>;
}

function parseSettings(raw: string): ScreenSettings {
  const v = JSON.parse(raw) as Partial<ScreenSettings> & { amber?: boolean };
  const stain: CultureStain = v.stain === "age" || v.stain === "amber" || v.stain === "species" ? v.stain : v.amber ? "amber" : "species";
  const { amber: _legacy, ...rest } = v;
  void _legacy;
  return { ...DEFAULT_SETTINGS, ...rest, stain };
}

export function ProjectCultureScreen({ initialGraph, databaseColors, fieldConfig, schemas, initialCultureConfig }: Props) {
  const { darkMode, toggleDarkMode } = useTheme();
  const apiRef = useRef<CultureApi | null>(null);

  // ── Species (databases) ──
  const colors = useMemo(() => {
    const out: Record<string, string> = {};
    for (const n of initialGraph.nodes) {
      if (!out[n.databaseId]) out[n.databaseId] = fieldConfig[n.databaseId]?.databaseColor ?? databaseColors[n.databaseId] ?? n.color;
    }
    return out;
  }, [initialGraph.nodes, fieldConfig, databaseColors]);

  const sources = useMemo<SpeciesSource[]>(() => {
    const morphs = speciesMorphs(initialGraph.nodes);
    const by = new Map<string, SpeciesSource>();
    for (const n of initialGraph.nodes) {
      let s = by.get(n.databaseId);
      if (!s) {
        s = { databaseId: n.databaseId, name: n.databaseName, color: colors[n.databaseId], count: 0, morph: morphs.get(n.databaseId) ?? 0 };
        by.set(n.databaseId, s);
      }
      s.count++;
    }
    return [...by.values()].sort((a, b) => b.count - a.count);
  }, [initialGraph.nodes, colors]);

  // Big databases with no relations at all are one featureless colony — hidden until asked for
  const defaultDisabled = useMemo(() => {
    const linked = new Set<string>();
    for (const e of initialGraph.edges) { linked.add(e.source); linked.add(e.target); }
    const any = new Set<string>();
    for (const n of initialGraph.nodes) if (linked.has(n.id)) any.add(n.databaseId);
    return new Set(sources.filter((s) => !any.has(s.databaseId) && s.count > 50).map((s) => s.databaseId));
  }, [initialGraph, sources]);

  const [disabled, setDisabled, disabledLoaded] = useStoredState("culture_disabled_dbs", defaultDisabled, setCodec.parse, setCodec.serialize);
  const [settings, setSettings, settingsLoaded] = useStoredState<ScreenSettings>("culture_settings", DEFAULT_SETTINGS, parseSettings, JSON.stringify);
  const [speedMul, setSpeedMul] = useStoredState<number>("culture_speed", initialCultureConfig?.playbackSpeed ?? 1, (r) => Number(r) || 1, String);
  const [hintSeen, setHintSeen] = useStoredState<boolean>("culture_hint_seen", false, (r) => r === "1", (v) => (v ? "1" : "0"));

  // Records hidden by the per-database field filters
  const hidden = useMemo(() => {
    const out: string[] = [];
    for (const n of initialGraph.nodes) {
      const cfg = fieldConfig[n.databaseId];
      if (!cfg) continue;
      for (const [field, opts] of Object.entries(cfg.activeFilters ?? {})) {
        if (!opts || opts.length === 0) continue;
        const val = n.fieldValues?.[field];
        const vals = val === null || val === undefined || val === "" ? [] : Array.isArray(val) ? val : [val];
        if (!opts.some((o) => vals.includes(o))) { out.push(n.id); break; }
      }
    }
    return out;
  }, [initialGraph.nodes, fieldConfig]);

  // ── Grow the culture in a worker ──
  const [world, setWorld] = useState<CultureWorld | null>(null);
  const [building, setBuilding] = useState(true);
  const workerRef = useRef<Worker | null>(null);
  const seqRef = useRef(0);
  const nowRef = useRef(Date.now());
  useEffect(() => {
    const worker = new Worker(new URL("../lib/cultureWorld.worker.ts", import.meta.url));
    workerRef.current = worker;
    worker.postMessage({ type: "graph", graph: initialGraph, schemas } satisfies CultureWorkerRequest);
    worker.onmessage = (e: MessageEvent<CultureWorkerResponse>) => {
      if (e.data.seq !== seqRef.current) return;
      setWorld(hydrateCulture(e.data.world, initialGraph.nodes));
      setBuilding(false);
    };
    worker.onerror = (e) => {
      console.error("The Culture: growing the dish failed", e.message);
      setBuilding(false);
    };
    return () => { worker.terminate(); workerRef.current = null; };
  }, [initialGraph, schemas]);
  useEffect(() => {
    if (!disabledLoaded || !settingsLoaded) return;   // wait for the saved choices
    const enabled = sources.filter((s) => !disabled.has(s.databaseId)).map((s) => s.databaseId);
    const seq = ++seqRef.current;
    setBuilding(true);
    // Coalesce quick toggles into one regrowth
    const t = setTimeout(() => {
      workerRef.current?.postMessage({ type: "build", seq, enabled, hidden, colors, now: nowRef.current } satisfies CultureWorkerRequest);
    }, world ? 180 : 0);
    return () => clearTimeout(t);
  }, [sources, disabled, hidden, colors, disabledLoaded, settingsLoaded, initialGraph, schemas]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Playhead ──
  const [day, setDay] = useState(0);
  const [playing, setPlaying] = useState(false);
  const onTime = useCallback((d: number, p: boolean) => { setDay(d); setPlaying(p); }, []);

  // ── Selection ──
  const [selected, setSelected] = useState<number | null>(null);
  const [detail, setDetail] = useState<NodeDetail | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [highlight, setHighlight] = useState<{ species?: number; colony?: number } | null>(null);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [tab, setTab] = useState<PanelTab>("species");
  const [settingsOpen, setSettingsOpen] = useState(false);

  const worldRef = useRef<CultureWorld | null>(null);
  useEffect(() => {
    const prev = worldRef.current;
    worldRef.current = world;
    setHighlight(null);
    if (!prev || !world || selected === null) return;
    const id = prev.organisms[selected]?.node.id;
    setSelected(id ? world.byNodeId.get(id) ?? null : null);
  }, [world]); // eslint-disable-line react-hooks/exhaustive-deps

  const select = useCallback((i: number | null) => {
    setSelected(i);
    const node = i !== null ? worldRef.current?.organisms[i]?.node : null;
    if (!node) { setDetail(null); return; }
    setDetail(nodeToDetail(node));
    void fetch(`/api/node/${node.id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((full: NodeDetail | null) => { if (full) setDetail((cur) => (cur?.id === full.id ? { ...cur, ...full } : cur)); })
      .catch(() => {});
  }, []);

  const pick = useCallback((i: number) => {
    select(i);
    const w = worldRef.current;
    const api = apiRef.current;
    if (!w || !api) return;
    // Not born yet at the playhead? Jump to its birth so it's there to see.
    if (w.organisms[i].born > api.getDay()) api.seek(Math.min(w.tMax, w.organisms[i].born + 0.5));
    api.focusOrganism(i);
  }, [select]);

  // ── Live counts at the playhead ──
  const live = useMemo(() => {
    const perDb = new Map<string, { alive: number; dormant: number }>();
    const colonyLive: number[] = world ? new Array(world.colonies.length).fill(0) : [];
    const stats: CultureStats = { alive: 0, active: 0, blocked: 0, dormant: 0, colonies: 0 };
    if (!world) return { perDb, colonyLive, stats };
    for (const s of world.species) perDb.set(s.databaseId, { alive: 0, dormant: 0 });
    for (const o of world.organisms) {
      if (o.born > day) continue;
      colonyLive[o.colony]++;
      const rec = perDb.get(o.node.databaseId)!;
      if (o.dormantAt !== null && day >= o.dormantAt) { stats.dormant++; rec.dormant++; continue; }
      stats.alive++; rec.alive++;
      if (o.state === "blocked") stats.blocked++;
      else if (o.activeFrom !== null && day >= o.activeFrom) stats.active++;
    }
    stats.colonies = colonyLive.filter((n) => n > 0).length;
    return { perDb, colonyLive, stats };
  }, [world, day]);

  // ── Moments worth calling out during playback: colonies founded, blooms ──
  type Moment = { day: number; kind: "colony" | "bloom"; title: string; sub: string; colony: number; color: string; weight: number };
  const moments = useMemo<Moment[]>(() => {
    if (!world) return [];
    const out: Moment[] = [];
    for (const c of world.colonies) {
      if (c.free || c.members.length < 25) continue;
      const hub = world.organisms[c.hub];
      out.push({ day: c.founded, kind: "colony", title: c.name, sub: `new colony · ${c.members.length} cells by today`, colony: c.index, color: world.species[hub.species].color, weight: c.members.length });
    }
    const perDay = new Map<string, { n: number; species: number; day: number; colony: number }>();
    for (const o of world.organisms) {
      const key = `${o.species}:${Math.floor(o.born)}`;
      const rec = perDay.get(key);
      if (rec) rec.n++; else perDay.set(key, { n: 1, species: o.species, day: Math.floor(o.born), colony: o.colony });
    }
    for (const r of perDay.values()) {
      if (r.n < 30) continue;
      const sp = world.species[r.species];
      out.push({ day: r.day, kind: "bloom", title: `${r.n.toLocaleString()} ${sp.name}`, sub: `bloom · ${formatDay(r.day, false)}`, colony: r.colony, color: sp.color, weight: r.n });
    }
    return out.sort((a, b) => a.day - b.day);
  }, [world]);
  const [moment, setMoment] = useState<{ m: Moment; key: number } | null>(null);
  const lastDayRef = useRef(0);
  const momentAtRef = useRef(0);
  useEffect(() => {
    const prev = lastDayRef.current;
    lastDayRef.current = day;
    if (!playing || day <= prev || day - prev > 40) return;
    let best: Moment | null = null;
    for (const m of moments) {
      if (m.day <= prev) continue;
      if (m.day > day) break;
      if (!best || m.weight > best.weight) best = m;
    }
    if (!best) return;
    const now = performance.now();
    // Don't let a fast time-lapse turn this into a strobe
    if (moment && now - momentAtRef.current < 1400 && best.weight <= moment.m.weight) return;
    momentAtRef.current = now;
    setMoment({ m: best, key: now });
  }, [day, playing, moments]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!moment) return;
    const t = setTimeout(() => setMoment(null), 3600);
    return () => clearTimeout(t);
  }, [moment]);

  // ── Keyboard ──
  const stateRef = useRef({ selected, panelOpen, world });
  stateRef.current = { selected, panelOpen, world };
  const speedRef = useRef(speedMul);
  speedRef.current = speedMul;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const s = stateRef.current;
      const api = apiRef.current;
      if (!api) return;
      const k = e.key.toLowerCase();
      if (e.key === " ") { e.preventDefault(); api.toggle(); }
      else if (e.key === "ArrowRight") { e.preventDefault(); api.step(e.shiftKey ? 30 : 7); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); api.step(e.shiftKey ? -30 : -7); }
      else if (e.key === "Home") { if (s.world) api.seek(s.world.tMin); }
      else if (e.key === "End") { if (s.world) api.seek(s.world.tMax); }
      else if (e.key === "Escape") {
        if (s.panelOpen) setPanelOpen(false);
        else if (s.selected !== null) select(null);
      }
      else if (k === "f") api.fitAll();
      else if (k === "t") api.timelapse();
      else if (k === "q") setLeftCollapsed((v) => !v);
      else if (k === "e") { if (s.panelOpen) setPanelOpen(false); else if (s.selected !== null) setPanelOpen(true); }
      else if (k === "c" && s.selected !== null) api.focusOrganism(s.selected);
      else if (e.key === "[" || e.key === "]") {
        const k = SPEEDS.findIndex((x) => x.mul === speedRef.current);
        const next = SPEEDS[Math.min(SPEEDS.length - 1, Math.max(0, (k < 0 ? 1 : k) + (e.key === "]" ? 1 : -1)))];
        setSpeedMul(next.mul);
      }
      else if (e.key === "=" || e.key === "+") api.zoomBy(1.5);
      else if (e.key === "-" || e.key === "_") api.zoomBy(1 / 1.5);
      else return;
      setHintSeen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [select, setHintSeen, setSpeedMul]);

  // ── Search / details navigation ──
  const searchNodes = useMemo(() => world?.organisms.map((o) => o.node) ?? [], [world]);
  const onSearch = useCallback((node: GraphNode) => {
    const i = worldRef.current?.byNodeId.get(node.id);
    if (i !== undefined) pick(i);
  }, [pick]);
  const onPanelSelect = useCallback((d: NodeDetail) => {
    const i = worldRef.current?.byNodeId.get(d.id);
    if (i !== undefined) pick(i);
    else { setSelected(null); setDetail(d); }
  }, [pick]);

  const toggleSource = useCallback((id: string) => {
    setDisabled((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, [setDisabled]);
  const setAllSources = useCallback((on: boolean) => {
    setDisabled(on ? new Set() : new Set(sources.map((s) => s.databaseId)));
  }, [setDisabled, sources]);

  const sel = world && selected !== null ? world.organisms[selected] : null;
  const selSpecies = sel && world ? world.species[sel.species] : null;
  const selColony = sel && world ? world.colonies[sel.colony] : null;
  const includedNodes = searchNodes;
  const leftInset = leftCollapsed ? 0 : 292;
  const rightInset = panelOpen ? 320 : 0;
  const rightOffset = panelOpen ? 332 : 24;
  const timelineH = 92 + 20;
  const insets = useMemo(() => ({ left: leftInset, right: rightInset, top: 60, bottom: timelineH + 8 }), [leftInset, rightInset, timelineH]);
  const canvasSettings = useMemo<CultureSettings>(() => ({ filaments: settings.filaments, sizeScale: settings.sizeScale, stain: settings.stain, labels: settings.labels }), [settings]);
  const empty = !!world && world.organisms.length === 0;

  // Hint: first visit only
  const [hintVisible, setHintVisible] = useState(false);
  useEffect(() => {
    if (hintSeen || !world) return;
    const show = setTimeout(() => setHintVisible(true), 1200);
    const hide = setTimeout(() => { setHintVisible(false); setHintSeen(true); }, 12000);
    return () => { clearTimeout(show); clearTimeout(hide); };
  }, [hintSeen, world, setHintSeen]);

  // Selection card facts at the playhead
  const selFacts = (() => {
    if (!sel) return null;
    const born = sel.born <= day;
    const links = born ? degreeAt(sel, day) : 0;
    let state = "Open", stateColor = "var(--text-primary)";
    if (!born) { state = "Not born yet"; stateColor = "var(--text-faint)"; }
    else if (sel.dormantAt !== null && day >= sel.dormantAt) { state = "Dormant"; stateColor = "var(--text-muted)"; }
    else if (sel.state === "blocked") { state = "Blocked"; stateColor = "#c9a227"; }
    else if (sel.activeFrom !== null && day >= sel.activeFrom) { state = "Active"; stateColor = "#3fb771"; }
    return { born, links, state, stateColor };
  })();

  return (
    <div style={{ width: "100%", height: "100%", position: "relative", overflow: "clip", background: darkMode ? "#040302" : "#cdc4b4" }}>
      <CultureCanvas
        world={world}
        darkMode={darkMode}
        selected={selected}
        highlight={highlight}
        settings={canvasSettings}
        insets={insets}
        speed={speedMul * DAYS_PER_SECOND}
        timelapse={settings.timelapse}
        apiRef={apiRef}
        onSelect={select}
        onTime={onTime}
      />

      {/* First growth */}
      <div
        style={{
          position: "absolute", inset: 0, zIndex: 30, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none",
          opacity: building && !world ? 1 : 0, transition: "opacity 0.6s ease",
          background: darkMode ? "radial-gradient(ellipse at 50% 55%, #1f130a, #040302)" : "radial-gradient(ellipse at 50% 55%, #f1e6cc, #cdc4b4)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", borderRadius: 999, background: "var(--panel-bg)", border: "1px solid var(--border-default)", boxShadow: "var(--shadow-md)", backdropFilter: "blur(14px)" }}>
          <span style={{ width: 10, height: 10, borderRadius: "50%", border: "2px solid var(--accent-warm)", borderTopColor: "transparent", animation: "spin 0.9s linear infinite" }} />
          <span style={{ fontFamily: "'Geist', sans-serif", fontSize: 12.5, color: "var(--text-secondary)" }}>Inoculating the dish…</span>
        </div>
        <style>{"@keyframes spin { to { transform: rotate(360deg); } }"}</style>
      </div>

      {empty && (
        <div style={{ position: "absolute", left: leftInset, right: rightInset, top: 0, bottom: timelineH, zIndex: 15, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
          <div style={{ padding: "14px 18px", borderRadius: 14, background: "var(--panel-bg)", border: "1px solid var(--border-default)", boxShadow: "var(--shadow-md)", textAlign: "center" }}>
            <div style={{ fontFamily: "'Lora', Georgia, serif", fontSize: 15, fontWeight: 600, color: "var(--text-primary)" }}>The dish is empty</div>
            <div style={{ marginTop: 4, fontFamily: "'Geist', sans-serif", fontSize: 12, color: "var(--text-muted)" }}>Pick some species on the left to culture them.</div>
          </div>
        </div>
      )}

      {/* ── Top-left: wordmark ── */}
      <div style={{ position: "absolute", top: 20, left: 24, zIndex: 21, display: "flex", alignItems: "center", gap: 8 }} className="animate-fade-up">
        <Link href="/" style={{ textDecoration: "none" }}>
          <div
            style={{
              display: "flex", alignItems: "center", gap: 8, height: 34, padding: "0 12px 0 10px",
              background: "var(--panel-bg)", backdropFilter: "blur(14px)", border: "1px solid var(--border-default)",
              borderRadius: 10, boxShadow: "var(--shadow-sm)", transition: "opacity 0.15s",
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.opacity = "0.8"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.opacity = "1"; }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/Culture.png" alt="" style={{ width: 18, height: 18, objectFit: "contain" }} />
            <span style={{ fontFamily: "'Lora', Georgia, serif", fontSize: 16, fontWeight: 600, color: "var(--text-primary)", letterSpacing: "-0.01em" }}>The Culture</span>
          </div>
        </Link>
        {world && (
          <div style={{
            display: "flex", alignItems: "center", gap: 8, height: 30, padding: "0 11px",
            background: "var(--panel-bg)", backdropFilter: "blur(14px)", border: "1px solid var(--border-default)", borderRadius: 9, boxShadow: "var(--shadow-sm)",
            fontFamily: "'DM Mono', monospace", fontSize: 10.5, color: "var(--text-muted)",
          }}>
            {world.organisms.length.toLocaleString()} organisms · {world.colonies.length} colonies
          </div>
        )}
      </div>

      {/* ── Left: species & colonies ── */}
      <CultureSpeciesPanel
        world={world}
        sources={sources}
        disabled={disabled}
        onToggle={toggleSource}
        onSetAll={setAllSources}
        live={live.perDb}
        colonyLive={live.colonyLive}
        onFocusColony={(c) => apiRef.current?.focusColony(c)}
        onHighlight={setHighlight}
        selectedColony={sel ? sel.colony : null}
        collapsed={leftCollapsed}
        onToggleCollapsed={() => setLeftCollapsed((v) => !v)}
        building={building}
        tab={tab}
        onTab={setTab}
        bottom={timelineH + 12}
      />

      {/* ── Top-right controls ── */}
      <div style={{ position: "absolute", top: 20, right: rightOffset, zIndex: 22, display: "flex", alignItems: "center", gap: 8, transition: "right 0.35s cubic-bezier(0.32, 0, 0.15, 1)" }} className="animate-fade-up">
        {world && <NodeSearch nodes={searchNodes} onPick={onSearch} />}
        <button type="button" onClick={() => apiRef.current?.fitAll()} title="See the whole dish (F)" style={{ ...chromeButton, width: 28, padding: 0 }} onMouseEnter={hoverIn} onMouseLeave={hoverOut}>
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><circle cx="6.5" cy="6.5" r="4" stroke="currentColor" strokeWidth="1.3" /><path d="M1 3.5V1H3.5M9.5 1H12V3.5M12 9.5V12H9.5M3.5 12H1V9.5" stroke="currentColor" strokeWidth="1.2" /></svg>
        </button>
        <div style={{ position: "relative" }}>
          <button type="button" onClick={() => setSettingsOpen((v) => !v)} title="Settings" style={{ ...chromeButton, width: 28, padding: 0, fontSize: 14, borderColor: settingsOpen ? "var(--accent-warm)" : "var(--border-default)" }} onMouseEnter={hoverIn} onMouseLeave={hoverOut}>
            ⚙
          </button>
          {settingsOpen && (
            <CultureSettingsPopover settings={settings} onChange={setSettings} onClose={() => setSettingsOpen(false)} />
          )}
        </div>
        <button type="button" onClick={toggleDarkMode} title={darkMode ? "Bright-field (light)" : "Dark-field (dark)"} style={{ ...chromeButton, width: 28, padding: 0, fontSize: 14 }} onMouseEnter={hoverIn} onMouseLeave={hoverOut}>
          {darkMode ? "☀" : "◑"}
        </button>
      </div>

      {/* ── Selection card ── */}
      {sel && selSpecies && selColony && selFacts && (
        <div
          key={sel.index}
          className="animate-fade-up"
          style={{
            position: "absolute", top: 64, right: rightOffset, zIndex: 20, width: 292,
            background: "var(--panel-bg)", backdropFilter: "blur(16px)", border: "1px solid var(--border-default)",
            borderRadius: 12, boxShadow: "var(--shadow-md)", padding: "12px 14px", transition: "right 0.35s cubic-bezier(0.32, 0, 0.15, 1)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <CultureGlyph morph={selSpecies.morph} color={selSpecies.color} size={18} />
            <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 9.5, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {selSpecies.name} · {MORPH_NAMES[selSpecies.morph].toLowerCase()}
            </span>
            <button type="button" onClick={() => select(null)} title="Clear (Esc)" style={{ marginLeft: "auto", width: 20, height: 20, padding: 0, borderRadius: 5, border: "none", background: "transparent", color: "var(--text-faint)", cursor: "pointer", fontSize: 14, flexShrink: 0 }}>×</button>
          </div>
          <div style={{ marginTop: 6, fontFamily: "'Lora', Georgia, serif", fontSize: 15, fontWeight: 600, color: "var(--text-primary)", lineHeight: 1.3 }}>
            {organismName(sel.node)}
          </div>
          {selColony.members.length > 1 && (
            <button
              type="button"
              onClick={() => apiRef.current?.focusColony(sel.colony)}
              style={{ marginTop: 3, padding: 0, border: "none", background: "none", cursor: "pointer", fontFamily: "'Geist', sans-serif", fontSize: 11.5, color: "var(--text-muted)", textAlign: "left" }}
              title="Show the whole colony"
            >
              in the <span style={{ color: "var(--text-secondary)", fontWeight: 500 }}>{selColony.name}</span> colony · {selColony.members.length} cells
            </button>
          )}
          <div style={{ marginTop: 9, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
            {[
              ["Born", formatDay(sel.born, false)],
              ["Links", selFacts.born && selFacts.links < sel.degree ? `${selFacts.links} of ${sel.degree}` : String(sel.degree)],
              ["State", selFacts.state],
            ].map(([label, value], k) => (
              <div key={label} style={{ padding: "5px 7px", borderRadius: 7, background: "var(--bg-overlay)", minWidth: 0 }}>
                <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 8.5, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-faint)" }}>{label}</div>
                <div style={{ fontFamily: "'Geist', sans-serif", fontSize: 12, fontWeight: 600, color: k === 2 ? selFacts.stateColor : "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{value}</div>
              </div>
            ))}
          </div>
          {(sel.status || sel.dormantAt !== null) && (
            <div style={{ marginTop: 7, fontFamily: "'Geist', sans-serif", fontSize: 11, color: "var(--text-muted)", lineHeight: 1.45 }}>
              {sel.status && <>Status <span style={{ color: "var(--text-secondary)" }}>{sel.status}</span></>}
              {sel.dormantAt !== null && (
                <>{sel.status ? " · " : ""}{sel.dormantKnown ? `finished ${formatDay(sel.dormantAt, false)}` : "finished (date not recorded)"}</>
              )}
            </div>
          )}
          {!selFacts.born && (
            <button type="button" onClick={() => apiRef.current?.seek(sel.born + 0.5, true)} style={{ ...chromeButton, height: 26, boxShadow: "none", width: "100%", marginTop: 9, color: "var(--accent-warm)" }} onMouseEnter={hoverIn} onMouseLeave={(e) => { hoverOut(e); (e.currentTarget as HTMLElement).style.color = "var(--accent-warm)"; }}>
              Jump to its birth · {formatDay(sel.born, false)}
            </button>
          )}
          <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
            <button type="button" onClick={() => setPanelOpen(true)} style={{ ...chromeButton, height: 26, boxShadow: "none", flex: 1 }} onMouseEnter={hoverIn} onMouseLeave={hoverOut}>
              Details <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 9.5, color: "var(--text-faint)" }}>E</span>
            </button>
            <button type="button" onClick={() => apiRef.current?.focusOrganism(sel.index)} style={{ ...chromeButton, height: 26, boxShadow: "none", flex: 1 }} onMouseEnter={hoverIn} onMouseLeave={hoverOut}>
              Zoom in <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 9.5, color: "var(--text-faint)" }}>C</span>
            </button>
          </div>
        </div>
      )}

      {/* ── Playback moments ── */}
      {moment && (
        <button
          key={moment.key}
          type="button"
          onClick={() => { apiRef.current?.focusColony(moment.m.colony); setMoment(null); }}
          className="animate-fade-up"
          title="Show this colony"
          style={{
            position: "absolute", top: 70, left: `calc(${leftInset}px + (100% - ${leftInset + rightInset}px) / 2)`, transform: "translateX(-50%)", zIndex: 24,
            display: "flex", alignItems: "center", gap: 10, padding: "8px 14px 8px 10px", borderRadius: 999, cursor: "pointer",
            background: "var(--panel-bg)", backdropFilter: "blur(16px)", border: "1px solid var(--border-default)", boxShadow: "var(--shadow-md)",
            maxWidth: 460,
          }}
        >
          <span style={{ width: 22, height: 22, borderRadius: "50%", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg-overlay)" }}>
            {moment.m.kind === "colony" ? (
              <svg width="14" height="14" viewBox="-7 -7 14 14"><circle r="2.6" fill={moment.m.color} /><circle r="5.6" fill="none" stroke={moment.m.color} strokeWidth="1" strokeDasharray="1.6 1.4" /></svg>
            ) : (
              <svg width="14" height="14" viewBox="-7 -7 14 14">{[0, 1, 2, 3, 4, 5].map((k) => <circle key={k} cx={Math.round(Math.cos(k * 1.047) * 45) / 10} cy={Math.round(Math.sin(k * 1.047) * 45) / 10} r="1.6" fill={moment.m.color} />)}<circle r="2" fill={moment.m.color} /></svg>
            )}
          </span>
          <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", minWidth: 0 }}>
            <span style={{ fontFamily: "'Lora', Georgia, serif", fontSize: 13.5, fontWeight: 600, color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 400 }}>{moment.m.title}</span>
            <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 9.5, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-muted)" }}>{moment.m.sub}</span>
          </span>
        </button>
      )}

      {/* ── First-visit hint ── */}
      <div
        style={{
          position: "absolute", top: 20, left: "50%", transform: `translate(-50%, ${hintVisible ? 0 : -8}px)`, zIndex: 21,
          opacity: hintVisible ? 1 : 0, transition: "opacity 0.4s, transform 0.4s", pointerEvents: "none",
          display: "flex", alignItems: "center", gap: 10, padding: "7px 12px", borderRadius: 10,
          background: "var(--panel-bg)", backdropFilter: "blur(14px)", border: "1px solid var(--border-default)", boxShadow: "var(--shadow-sm)",
        }}
      >
        {[["space", "play"], ["scroll", "zoom"], ["drag", "move"], ["click", "a cell"], ["T", "time-lapse"]].map(([k, label]) => (
          <span key={k} style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <Key k={k} />
            <span style={{ fontFamily: "'Geist', sans-serif", fontSize: 11, color: "var(--text-faint)" }}>{label}</span>
          </span>
        ))}
      </div>

      {/* ── Timeline ── */}
      <CultureTimeline
        world={world}
        marks={sel && selSpecies ? { born: sel.born, done: sel.dormantKnown ? sel.dormantAt : null, color: selSpecies.color } : null}
        ageLegend={settings.stain === "age"}
        day={day}
        playing={playing}
        speedMul={speedMul}
        onSpeed={setSpeedMul}
        apiRef={apiRef}
        left={leftInset ? leftInset + 0 : 24}
        right={rightOffset}
        stats={live.stats}
        darkMode={darkMode}
      />

      {/* ── Details ── */}
      <NodeDetailsPanel
        detail={detail}
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        onSelectNode={onPanelSelect}
        allNodes={includedNodes}
        allEdges={initialGraph.edges}
        schemas={schemas}
        fieldConfig={fieldConfig}
      />
      <button
        type="button"
        onClick={() => setPanelOpen((v) => !v)}
        title={panelOpen ? "Collapse panel (E)" : "Expand panel (E)"}
        style={{
          position: "absolute", top: "50%", right: panelOpen ? 320 : 0, transform: "translateY(-50%)", zIndex: 50,
          width: 20, height: 56, background: "var(--panel-bg)", backdropFilter: "blur(12px)",
          border: "1px solid var(--panel-border)", borderRight: "none", borderRadius: "6px 0 0 6px", cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "var(--shadow-panel)",
          transition: "right 0.35s cubic-bezier(0.32, 0, 0.15, 1), background 0.15s", padding: 0,
        }}
      >
        <svg width="10" height="16" viewBox="0 0 10 16" fill="none">
          <polyline points={panelOpen ? "3,2 8,8 3,14" : "7,2 2,8 7,14"} stroke={!panelOpen && detail ? "var(--accent-warm)" : "var(--text-muted)"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  );
}

// ─── Settings ─────────────────────────────────────────────────────────────────

function Toggle({ on, label, hint, onClick }: { on: boolean; label: string; hint: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      style={{ display: "flex", alignItems: "flex-start", gap: 10, width: "100%", background: "transparent", border: "none", borderRadius: 8, padding: "7px 8px", cursor: "pointer", textAlign: "left" }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--bg-overlay)"; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
    >
      <span style={{ flexShrink: 0, marginTop: 1, width: 26, height: 15, borderRadius: 8, background: on ? "var(--accent-warm)" : "var(--border-default)", position: "relative", transition: "background 0.15s" }}>
        <span style={{ position: "absolute", top: 2, left: on ? 13 : 2, width: 11, height: 11, borderRadius: "50%", background: "#fff", transition: "left 0.15s", boxShadow: "0 1px 2px rgba(0,0,0,0.25)" }} />
      </span>
      <span>
        <span style={{ display: "block", fontFamily: "'Geist', sans-serif", fontSize: 12, fontWeight: 500, color: "var(--text-primary)" }}>{label}</span>
        <span style={{ display: "block", marginTop: 2, fontFamily: "'Geist', sans-serif", fontSize: 11, color: "var(--text-faint)", lineHeight: 1.4 }}>{hint}</span>
      </span>
    </button>
  );
}

function CultureSettingsPopover({ settings, onChange, onClose }: { settings: ScreenSettings; onChange: (s: ScreenSettings) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const btn = (e.target as HTMLElement).closest("button[title='Settings']");
      if (ref.current && !ref.current.contains(e.target as Node) && !btn) onClose();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [onClose]);
  const set = (patch: Partial<ScreenSettings>) => onChange({ ...settings, ...patch });
  return (
    <div
      ref={ref}
      className="animate-fade-up"
      style={{
        position: "absolute", top: 36, right: 0, zIndex: 40, width: 290, padding: "10px 8px",
        background: "var(--panel-bg)", backdropFilter: "blur(20px)", border: "1px solid var(--border-default)", borderRadius: 14, boxShadow: "var(--shadow-lg)",
      }}
    >
      <div style={{ padding: "2px 8px 8px", fontFamily: "'DM Mono', monospace", fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-faint)" }}>The dish</div>
      <Toggle on={settings.filaments} label="Filaments" hint="Draw every link between organisms. Off: only the hovered or selected one's." onClick={() => set({ filaments: !settings.filaments })} />
      <Toggle on={settings.labels} label="Labels" hint="Name colonies, and cells once you zoom in." onClick={() => set({ labels: !settings.labels })} />
      <div style={{ padding: "7px 8px" }}>
        <div style={{ fontFamily: "'Geist', sans-serif", fontSize: 12, fontWeight: 500, color: "var(--text-primary)" }}>Stain</div>
        <div style={{ marginTop: 6, display: "flex", gap: 2, padding: 2, borderRadius: 8, background: "var(--bg-overlay)" }}>
          {([["species", "Species"], ["age", "Age"], ["amber", "Amber"]] as const).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => set({ stain: k })}
              aria-pressed={settings.stain === k}
              style={{
                flex: 1, height: 24, borderRadius: 6, border: "none", cursor: "pointer",
                background: settings.stain === k ? "var(--accent-warm)" : "transparent",
                color: settings.stain === k ? "#fff" : "var(--text-muted)",
                fontFamily: "'Geist', sans-serif", fontSize: 11.5, fontWeight: 600,
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div style={{ marginTop: 5, fontFamily: "'Geist', sans-serif", fontSize: 11, color: "var(--text-faint)", lineHeight: 1.4 }}>
          {settings.stain === "species" ? "Each database in its own colour." : settings.stain === "age" ? "Oldest records violet, newest yellow, so you can see where each colony grew." : "Everything glows amber, like the culture on the home screen. Body shapes still tell species apart."}
        </div>
      </div>
      <Toggle on={settings.timelapse} label="Time-lapse on open" hint="Grow the whole history in a few seconds when the page opens." onClick={() => set({ timelapse: !settings.timelapse })} />
      <div style={{ padding: "8px 8px 4px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <span style={{ fontFamily: "'Geist', sans-serif", fontSize: 12, fontWeight: 500, color: "var(--text-primary)" }}>Organism size</span>
          <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 10.5, color: "var(--text-faint)" }}>{settings.sizeScale.toFixed(1)}×</span>
        </div>
        <input
          type="range"
          min={60}
          max={160}
          value={Math.round(settings.sizeScale * 100)}
          onChange={(e) => set({ sizeScale: Number(e.target.value) / 100 })}
          aria-label="Organism size"
          style={{ width: "100%", accentColor: "var(--accent-warm)", cursor: "pointer" }}
        />
      </div>
      <div style={{ margin: "6px 8px 0", paddingTop: 9, borderTop: "1px solid var(--border-subtle)", display: "grid", gridTemplateColumns: "auto 1fr", gap: "5px 10px", alignItems: "center" }}>
        {[["Space", "play / pause"], ["← →", "a week (⇧ a month)"], ["[ ]", "slower · faster"], ["Home End", "first record · today"], ["T", "time-lapse"], ["F", "whole dish"], ["C", "zoom to selected"], ["Q", "species panel"], ["E", "details"], ["/", "search"]].map(([k, label]) => (
          <span key={k} style={{ display: "contents" }}>
            <span style={{ justifySelf: "start" }}><Key k={k} /></span>
            <span style={{ fontFamily: "'Geist', sans-serif", fontSize: 11, color: "var(--text-faint)" }}>{label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
