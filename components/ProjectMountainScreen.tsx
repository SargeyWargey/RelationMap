"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

import { MountainCanvas, type MountainApi, type MountainMode } from "@/components/MountainCanvas";
import { MountainMinimap } from "@/components/MountainMinimap";
import { MountainRangesPanel, type RangeSource } from "@/components/MountainRangesPanel";
import { MountainTimeControl } from "@/components/MountainTimeControl";
import { NodeDetailsPanel } from "@/components/NodeDetailsPanel";
import { NodeSearch, nodeToDetail } from "@/components/NodeSearch";
import { useTheme } from "@/components/ThemeProvider";
import { toMeters, type World } from "@/lib/mountainWorld";
import { setCodec, useStoredState } from "@/lib/useStoredState";
import type { DatabaseFieldConfig, GraphData, GraphNode, NodeDetail } from "@/lib/types";

type Props = {
  initialGraph: GraphData;
  databaseColors: Record<string, string>;
  fieldConfig: Record<string, DatabaseFieldConfig>;
};

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

function displayName(n: GraphNode) {
  const s = n.name?.trim();
  if (!s || /^[0-9a-f]{32}$/i.test(s) || s.replace(/-/g, "") === n.id.replace(/-/g, "")) return "Untitled";
  return s;
}

function Key({ k }: { k: string }) {
  return <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: "var(--text-primary)", background: "var(--bg-overlay)", border: "1px solid var(--border-default)", borderRadius: 4, padding: "1px 5px" }}>{k}</span>;
}

export function ProjectMountainScreen({ initialGraph, databaseColors, fieldConfig }: Props) {
  const { darkMode, toggleDarkMode } = useTheme();
  const apiRef = useRef<MountainApi | null>(null);

  // ── Sources (databases → ranges) ──
  const sources = useMemo<RangeSource[]>(() => {
    const by = new Map<string, RangeSource>();
    for (const n of initialGraph.nodes) {
      let s = by.get(n.databaseId);
      if (!s) {
        s = { databaseId: n.databaseId, name: n.databaseName, color: fieldConfig[n.databaseId]?.databaseColor ?? databaseColors[n.databaseId] ?? n.color, count: 0 };
        by.set(n.databaseId, s);
      }
      s.count++;
    }
    return [...by.values()].sort((a, b) => b.count - a.count);
  }, [initialGraph.nodes, fieldConfig, databaseColors]);

  // Databases with no relations at all would only be flat noise — hidden by default
  const defaultDisabled = useMemo(() => {
    const linked = new Set<string>();
    for (const e of initialGraph.edges) { linked.add(e.source); linked.add(e.target); }
    const out = new Set<string>();
    const any = new Map<string, boolean>();
    for (const n of initialGraph.nodes) if (linked.has(n.id)) any.set(n.databaseId, true);
    for (const s of sources) if (!any.get(s.databaseId) && s.count > 50) out.add(s.databaseId);
    return out;
  }, [initialGraph, sources]);

  const [disabled, setDisabled, disabledLoaded] = useStoredState("mountain_disabled_dbs", defaultDisabled, setCodec.parse, setCodec.serialize);
  // Draft selection in the Ranges panel — applied (and the land regenerated) in one go
  const [pending, setPending] = useState<Set<string>>(disabled);
  useEffect(() => { setPending(new Set(disabled)); }, [disabled]);
  const pendingChanges = useMemo(() => {
    let n = 0;
    for (const s of sources) if (pending.has(s.databaseId) !== disabled.has(s.databaseId)) n++;
    return n;
  }, [sources, pending, disabled]);

  const graph = useMemo(() => {
    const nodes = initialGraph.nodes
      .filter((n) => !disabled.has(n.databaseId))
      .filter((n) => {
        const cfg = fieldConfig[n.databaseId];
        if (!cfg) return true;
        for (const [field, opts] of Object.entries(cfg.activeFilters ?? {})) {
          if (!opts || opts.length === 0) continue;
          const val = n.fieldValues?.[field];
          if (val === null || val === undefined || val === "") return false;
          const vals = Array.isArray(val) ? val : [val];
          if (!opts.some((o) => vals.includes(o))) return false;
        }
        return true;
      })
      .map((n) => ({ ...n, color: fieldConfig[n.databaseId]?.databaseColor ?? databaseColors[n.databaseId] ?? n.color }));
    const ids = new Set(nodes.map((n) => n.id));
    return { ...initialGraph, nodes, edges: initialGraph.edges.filter((e) => ids.has(e.source) && ids.has(e.target)) };
  }, [initialGraph, disabled, fieldConfig, databaseColors]);

  // ── World generation (Web Worker) ──
  const [world, setWorld] = useState<World | null>(null);
  const [building, setBuilding] = useState(true);
  const workerRef = useRef<Worker | null>(null);
  const seqRef = useRef(0);
  useEffect(() => {
    const worker = new Worker(new URL("../lib/mountainWorld.worker.ts", import.meta.url));
    workerRef.current = worker;
    worker.onmessage = (e: MessageEvent<{ seq: number; world: World }>) => {
      if (e.data.seq !== seqRef.current) return;
      setWorld(e.data.world);
      setBuilding(false);
    };
    return () => { worker.terminate(); workerRef.current = null; };
  }, []);
  useEffect(() => {
    const worker = workerRef.current;
    if (!worker || !disabledLoaded) return;   // wait for the saved range selection
    const seq = ++seqRef.current;
    setBuilding(true);
    worker.postMessage({ seq, graph, edges: initialGraph.edges, resolution: 1025 });
  }, [graph, initialGraph.edges, disabledLoaded]);

  // ── Mode, selection, location ──
  const [mode, setMode] = useState<MountainMode>("map");
  const [selected, setSelected] = useState<number | null>(null);
  const [detail, setDetail] = useState<NodeDetail | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [location, setLocation] = useState<{ range: number; altitude: number; swimming: boolean; gliding: boolean }>({ range: -1, altitude: 0, swimming: false, gliding: false });
  const [rangesCollapsed, setRangesCollapsed] = useState(false);
  const [mapExpanded, setMapExpanded] = useState(false);
  const [toast, setToast] = useState<{ peak: number; key: number } | null>(null);
  const [tod, setTod] = useState(darkMode ? 0.955 : 0.54);
  const [cycle, setCycle] = useStoredState<{ auto: boolean; secondsPerDay: number }>("mountain_cycle", { auto: false, secondsPerDay: 180 }, JSON.parse, JSON.stringify);
  const setTimeOfDay = useCallback((t: number, animate: boolean) => {
    setCycle((c) => (c.auto ? { ...c, auto: false } : c));
    apiRef.current?.setTime(t, animate);
  }, []);
  const toggleDayNight = useCallback(() => {
    setCycle((c) => (c.auto ? { ...c, auto: false } : c));
    toggleDarkMode();
  }, [toggleDarkMode]);
  const [visited, setVisited] = useStoredState("mountain_summits", new Set<string>(), setCodec.parse, setCodec.serialize);

  // Keep the selection across world rebuilds
  const worldRef = useRef<World | null>(null);
  useEffect(() => {
    const prev = worldRef.current;
    worldRef.current = world;
    if (!prev || !world || selected === null) return;
    const id = prev.peaks[selected]?.node.id;
    setSelected(id ? world.byNodeId.get(id) ?? null : null);
  }, [world]); // eslint-disable-line react-hooks/exhaustive-deps

  const related = useMemo(() => (world && selected !== null ? world.neighbors[selected] ?? [] : []), [world, selected]);

  const select = useCallback((peak: number | null) => {
    setSelected(peak);
    const node = peak !== null ? worldRef.current?.peaks[peak]?.node : null;
    if (!node) { setDetail(null); return; }
    setDetail(nodeToDetail(node));
    void fetch(`/api/node/${node.id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((full: NodeDetail | null) => { if (full) setDetail((cur) => (cur?.id === full.id ? { ...cur, ...full } : cur)); })
      .catch(() => {});
  }, []);

  const pickPeak = useCallback((peak: number) => {
    select(peak);
    apiRef.current?.focusPeak(peak);
  }, [select]);

  const onSummit = useCallback((peak: number) => {
    const node = worldRef.current?.peaks[peak]?.node;
    if (!node) return;
    setVisited((prev) => {
      if (prev.has(node.id)) return prev;
      const next = new Set(prev);
      next.add(node.id);
      return next;
    });
    setToast({ peak, key: Date.now() });
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  // ── Keyboard ──
  const stateRef = useRef({ mode, selected, panelOpen });
  stateRef.current = { mode, selected, panelOpen };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const s = stateRef.current;
      const k = e.key.toLowerCase();
      if (e.key === "Escape") {
        if (s.panelOpen) setPanelOpen(false);
        else if (s.selected !== null) select(null);
        else if (s.mode === "hike") apiRef.current?.setMode("map");
      } else if (k === "h") {
        apiRef.current?.setMode(s.mode === "hike" ? "map" : "hike");
      } else if (k === "m") {
        setMapExpanded((v) => !v);
      } else if (k === "q") {
        setRangesCollapsed((v) => !v);
      } else if (k === "e") {
        if (s.panelOpen) setPanelOpen(false);
        else if (s.selected !== null) setPanelOpen(true);
      } else if (k === "f" && s.mode === "map") {
        apiRef.current?.fitAll();
      } else if (k === "t" && s.selected !== null) {
        apiRef.current?.hikeFrom(s.selected);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [select]);

  // ── Search ──
  const searchNodes = useMemo(() => world?.peaks.map((p) => p.node) ?? [], [world]);
  const onSearch = useCallback((node: GraphNode) => {
    const idx = world?.byNodeId.get(node.id);
    if (idx !== undefined) pickPeak(idx);
  }, [world, pickPeak]);
  const onPanelSelect = useCallback((d: NodeDetail) => {
    const idx = world?.byNodeId.get(d.id);
    if (idx !== undefined) pickPeak(idx);
    else { setSelected(null); setDetail(d); }
  }, [world, pickPeak]);

  const toggleSource = useCallback((id: string) => {
    setPending((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);
  const setAllSources = useCallback((on: boolean) => {
    setPending(on ? new Set() : new Set(sources.map((s) => s.databaseId)));
  }, [sources]);
  const applySources = useCallback(() => setDisabled(new Set(pending)), [pending]);
  const resetSources = useCallback(() => setPending(new Set(disabled)), [disabled]);

  const sel = world && selected !== null ? world.peaks[selected] : null;
  const selRange = sel && world ? world.ranges[sel.range] : null;
  const here = world && location.range >= 0 ? world.ranges[location.range] : null;
  const leftInset = rangesCollapsed ? 0 : 284;
  const rightInset = panelOpen ? 320 : 0;
  const rightOffset = panelOpen ? 332 : 24;
  const toastPeak = toast && world ? world.peaks[toast.peak] : null;

  return (
    <div style={{ width: "100%", height: "100%", position: "relative", overflow: "clip", background: darkMode ? "#02040b" : "#c3d6e4" }}>
      <MountainCanvas
        world={world}
        darkMode={darkMode}
        selectedPeak={selected}
        relatedPeaks={related}
        visited={visited}
        leftInset={leftInset}
        rightInset={rightInset}
        cycle={cycle}
        apiRef={apiRef}
        onTime={setTod}
        onSelect={select}
        onMode={setMode}
        onLocation={setLocation}
        onSummit={onSummit}
      />

      {/* Building overlay */}
      <div
        style={{
          position: "absolute", inset: 0, zIndex: 30, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none",
          opacity: building ? 1 : 0, transition: "opacity 0.6s ease",
          background: world ? "transparent" : darkMode ? "radial-gradient(ellipse at 50% 60%, #141c33, #02040b)" : "radial-gradient(ellipse at 50% 60%, #e6eef4, #b9cfe0)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", borderRadius: 999, background: "var(--panel-bg)", border: "1px solid var(--border-default)", boxShadow: "var(--shadow-md)", backdropFilter: "blur(14px)" }}>
          <span style={{ width: 10, height: 10, borderRadius: "50%", border: "2px solid var(--accent-warm)", borderTopColor: "transparent", animation: "spin 0.9s linear infinite" }} />
          <span style={{ fontFamily: "'Geist', sans-serif", fontSize: 12.5, color: "var(--text-secondary)" }}>{world ? "Reshaping the land…" : "Raising mountains…"}</span>
        </div>
        <style>{"@keyframes spin { to { transform: rotate(360deg); } }"}</style>
      </div>

      {/* ── Top-left: wordmark + location ── */}
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
            <img src="/mountain.png" alt="" style={{ width: 18, height: 18, objectFit: "contain" }} />
            <span style={{ fontFamily: "'Lora', Georgia, serif", fontSize: 16, fontWeight: 600, color: "var(--text-primary)", letterSpacing: "-0.01em" }}>The Mountain</span>
          </div>
        </Link>
        {world && (
          <div style={{
            display: "flex", alignItems: "center", gap: 8, height: 30, padding: "0 11px",
            background: "var(--panel-bg)", backdropFilter: "blur(14px)", border: "1px solid var(--border-default)", borderRadius: 9, boxShadow: "var(--shadow-sm)",
          }}>
            {here ? (
              <>
                <span style={{ width: 8, height: 8, borderRadius: 2, transform: "rotate(45deg)", background: here.color }} />
                <span style={{ fontFamily: "'Geist', sans-serif", fontSize: 12, fontWeight: 500, color: "var(--text-primary)" }}>{here.name} Range</span>
              </>
            ) : (
              <span style={{ fontFamily: "'Geist', sans-serif", fontSize: 12, color: "var(--text-secondary)" }}>{location.altitude < 2 ? "The coast" : "The valleys"}</span>
            )}
            {mode === "hike" && (
              <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 10.5, color: "var(--text-muted)" }}>
                ▲ {location.altitude.toLocaleString()} m{location.swimming ? " · swimming" : location.gliding ? " · gliding" : ""}
              </span>
            )}
          </div>
        )}
      </div>

      {/* ── Ranges ── */}
      <MountainRangesPanel
        world={world}
        sources={sources}
        disabled={pending}
        pendingChanges={pendingChanges}
        onApply={applySources}
        onReset={resetSources}
        onSetAll={setAllSources}
        onToggleSource={toggleSource}
        onFocusRange={(r) => apiRef.current?.focusRange(r)}
        onPickPeak={pickPeak}
        selectedPeak={selected}
        currentRange={location.range}
        visitedCount={world ? world.peaks.filter((p) => visited.has(p.node.id)).length : 0}
        collapsed={rangesCollapsed}
        onToggleCollapsed={() => setRangesCollapsed((v) => !v)}
        building={building}
      />

      {/* ── Minimap ── */}
      {world && (
        <div style={{ position: "absolute", left: 24, bottom: 20, zIndex: 21 }}>
          <MountainMinimap world={world} apiRef={apiRef} selectedPeak={selected} expanded={mapExpanded} onToggleExpanded={() => setMapExpanded((v) => !v)} />
        </div>
      )}

      {/* ── Top-right controls ── */}
      <div style={{ position: "absolute", top: 20, right: rightOffset, zIndex: 22, display: "flex", alignItems: "center", gap: 8, transition: "right 0.35s cubic-bezier(0.32, 0, 0.15, 1)" }} className="animate-fade-up">
        {world && <NodeSearch nodes={searchNodes} onPick={onSearch} />}
        <div style={{ display: "flex", padding: 2, gap: 2, borderRadius: 9, background: "var(--panel-bg)", border: "1px solid var(--border-default)", boxShadow: "var(--shadow-sm)", backdropFilter: "blur(12px)" }}>
          {(["map", "hike"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => apiRef.current?.setMode(m)}
              title={m === "map" ? "Map view (H)" : "Hike on foot (H)"}
              style={{
                height: 24, padding: "0 10px", borderRadius: 7, border: "none", cursor: "pointer",
                background: mode === m ? "var(--accent-warm)" : "transparent",
                color: mode === m ? "#fff" : "var(--text-muted)",
                fontFamily: "'Geist', sans-serif", fontSize: 11.5, fontWeight: 600,
              }}
            >
              {m === "map" ? "Map" : "Hike"}
            </button>
          ))}
        </div>
        <MountainTimeControl
          tod={tod}
          auto={cycle.auto}
          secondsPerDay={cycle.secondsPerDay}
          onAutoChange={(auto) => setCycle((c) => ({ ...c, auto }))}
          onSpeedChange={(secondsPerDay) => setCycle((c) => ({ ...c, secondsPerDay }))}
          onSetTime={setTimeOfDay}
        />
        <button
          type="button"
          onClick={toggleDayNight}
          title={darkMode ? "Sunrise — switch to day" : "Sunset — switch to night"}
          style={{ ...chromeButton, width: 28, padding: 0, fontSize: 14 }}
          onMouseEnter={hoverIn}
          onMouseLeave={hoverOut}
        >
          {darkMode ? "☀" : "☾"}
        </button>
      </div>

      {/* ── Selection card ── */}
      {sel && selRange && (
        <div
          key={sel.index}
          className="animate-fade-up"
          style={{
            position: "absolute", top: 64, right: rightOffset, zIndex: 20, width: 290,
            background: "var(--panel-bg)", backdropFilter: "blur(16px)", border: "1px solid var(--border-default)",
            borderRadius: 12, boxShadow: "var(--shadow-md)", padding: "12px 14px", transition: "right 0.35s cubic-bezier(0.32, 0, 0.15, 1)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, transform: "rotate(45deg)", background: selRange.color, flexShrink: 0 }} />
            <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 9.5, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)" }}>
              {selRange.name} range · {sel.rank === 0 ? "highest summit" : `#${sel.rank + 1} of ${selRange.peaks.length}`}
            </span>
            <button type="button" onClick={() => select(null)} title="Clear (Esc)" style={{ marginLeft: "auto", width: 20, height: 20, padding: 0, borderRadius: 5, border: "none", background: "transparent", color: "var(--text-faint)", cursor: "pointer", fontSize: 14 }}>×</button>
          </div>
          <div style={{ marginTop: 6, fontFamily: "'Lora', Georgia, serif", fontSize: 15, fontWeight: 600, color: "var(--text-primary)", lineHeight: 1.3 }}>
            {displayName(sel.node)}
          </div>
          <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
            {[
              ["Altitude", `${toMeters(sel.sy).toLocaleString()} m`],
              ["Connections", String(sel.degree)],
              ["Activity", sel.freshness > 0.6 ? "Active" : sel.freshness > 0.3 ? "Steady" : "Quiet"],
            ].map(([label, value]) => (
              <div key={label} style={{ padding: "5px 7px", borderRadius: 7, background: "var(--bg-overlay)" }}>
                <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 8.5, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-faint)" }}>{label}</div>
                <div style={{ fontFamily: "'Geist', sans-serif", fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>{value}</div>
              </div>
            ))}
          </div>
          {visited.has(sel.node.id) && (
            <div style={{ marginTop: 7, fontFamily: "'Geist', sans-serif", fontSize: 11, color: "#3fb771" }}>✓ You&apos;ve stood on this summit</div>
          )}
          <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
            <button type="button" onClick={() => setPanelOpen(true)} style={{ ...chromeButton, height: 26, boxShadow: "none", flex: 1 }} onMouseEnter={hoverIn} onMouseLeave={hoverOut}>
              Details <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 9.5, color: "var(--text-faint)" }}>E</span>
            </button>
            <button type="button" onClick={() => apiRef.current?.hikeFrom(sel.index)} style={{ ...chromeButton, height: 26, boxShadow: "none", flex: 1, color: "var(--accent-warm)" }} onMouseEnter={hoverIn} onMouseLeave={(e) => { hoverOut(e); (e.currentTarget as HTMLElement).style.color = "var(--accent-warm)"; }}>
              Hike it <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 9.5, color: "var(--text-faint)" }}>T</span>
            </button>
          </div>
          {related.length > 0 && (
            <div style={{ marginTop: 8, fontFamily: "'DM Mono', monospace", fontSize: 10, color: "var(--text-faint)" }}>
              {related.length} linked summit{related.length === 1 ? "" : "s"} · arcs show the way
            </div>
          )}
        </div>
      )}

      {/* ── Summit toast ── */}
      {toastPeak && world && (
        <div
          key={toast!.key}
          className="animate-fade-up"
          style={{
            position: "absolute", top: 70, left: "50%", transform: "translateX(-50%)", zIndex: 25,
            display: "flex", alignItems: "center", gap: 12, padding: "10px 16px 10px 12px", borderRadius: 14,
            background: "var(--panel-bg)", backdropFilter: "blur(16px)", border: "1px solid var(--border-default)", boxShadow: "var(--shadow-lg)",
          }}
        >
          <span style={{ fontSize: 22 }}>⛰</span>
          <div>
            <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9.5, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--accent-warm)" }}>Summit reached · {toMeters(toastPeak.sy).toLocaleString()} m</div>
            <div style={{ fontFamily: "'Lora', Georgia, serif", fontSize: 15, fontWeight: 600, color: "var(--text-primary)" }}>{displayName(toastPeak.node)}</div>
          </div>
          <button type="button" onClick={() => { select(toastPeak.index); setPanelOpen(true); }} style={{ ...chromeButton, height: 26, boxShadow: "none" }} onMouseEnter={hoverIn} onMouseLeave={hoverOut}>View</button>
        </div>
      )}

      {/* ── Hints ── */}
      {world && (
        <div
          style={{
            position: "absolute", bottom: 20, right: rightOffset, zIndex: 20, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", justifyContent: "flex-end", maxWidth: 640,
            background: "var(--panel-bg)", backdropFilter: "blur(12px)", border: "1px solid var(--border-default)",
            borderRadius: 10, padding: "6px 12px", boxShadow: "var(--shadow-sm)", transition: "right 0.35s cubic-bezier(0.32, 0, 0.15, 1)",
          }}
          className="animate-fade-up"
        >
          {(mode === "hike"
            ? [["W A S D", "walk"], ["drag", "look"], ["shift", "run"], ["space", "jump · hold to glide"], ["H", "map"]]
            : [["drag", "rotate"], ["right-drag", "pan"], ["scroll", "zoom"], ["double-click", "drop in & hike"], ["H", "hike"]]
          ).map(([k, label]) => (
            <span key={k} style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <Key k={k} />
              <span style={{ fontFamily: "'Geist', sans-serif", fontSize: 11, color: "var(--text-faint)" }}>{label}</span>
            </span>
          ))}
        </div>
      )}

      {/* ── Details ── */}
      <NodeDetailsPanel
        detail={detail}
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        onSelectNode={onPanelSelect}
        allNodes={graph.nodes}
        allEdges={initialGraph.edges}
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
