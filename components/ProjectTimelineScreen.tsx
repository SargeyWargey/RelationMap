"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

import { TimelineCanvas, personColor, type LineEngineApi } from "@/components/TimelineCanvas";
import { LinePeoplePanel } from "@/components/LinePeoplePanel";
import { LineOverview } from "@/components/LineOverview";
import { LineSources } from "@/components/LineSources";
import { NodeDetailsPanel } from "@/components/NodeDetailsPanel";
import { NodeSearch, nodeToDetail } from "@/components/NodeSearch";
import { useTheme } from "@/components/ThemeProvider";
import {
  buildLineModel,
  describeWhen,
  displayName,
  kindLabel,
  layoutLanes,
  relatedEvents,
  sortPeople,
  type LaneSort,
  type TickLevel,
} from "@/lib/lineModel";
import type { DatabaseFieldConfig, DatabaseSchema, GraphData, GraphNode, NodeDetail } from "@/lib/types";
import { setCodec, useStoredState } from "@/lib/useStoredState";

type Props = {
  initialGraph: GraphData;
  databaseColors: Record<string, string>;
  schemas: DatabaseSchema[];
  initialFieldConfig: Record<string, DatabaseFieldConfig>;
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

const LEVEL_NAME: Record<TickLevel, string> = { year: "years", quarter: "quarters", month: "months", week: "weeks", day: "days" };
const STATE_COLOR = { done: "#3fb771", active: "#4a90e2", blocked: "#e5534b", open: "var(--text-faint)" } as const;

export function ProjectTimelineScreen({ initialGraph, databaseColors, schemas, initialFieldConfig }: Props) {
  const { darkMode, toggleDarkMode } = useTheme();
  const apiRef = useRef<LineEngineApi | null>(null);

  // ── Config ──
  const [fieldConfig, setFieldConfig] = useState(initialFieldConfig);
  const [disabled, setDisabled, disabledLoaded] = useStoredState("line_disabled_sources", new Set<string>(), setCodec.parse, setCodec.serialize);
  const [sort, setSort, sortLoaded] = useStoredState<LaneSort>("line_sort", "activity", (s) => s as LaneSort, (s) => s);
  const [peopleCollapsed, setPeopleCollapsed] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);


  const saveFieldConfig = useCallback((next: Record<string, DatabaseFieldConfig>) => {
    setFieldConfig(next);
    fetch("/api/field-config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next) }).catch(() => {});
  }, []);
  const emptyCfg = (): DatabaseFieldConfig => ({ panelVisible: {}, sphereField: null, activeFilters: {} });

  // ── Graph → model ──
  const graph = useMemo(() => {
    const nodes = initialGraph.nodes
      .map((node) => ({ ...node, color: fieldConfig[node.databaseId]?.databaseColor ?? databaseColors[node.databaseId] ?? node.color }))
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
      });
    return { ...initialGraph, nodes };
  }, [initialGraph, fieldConfig, databaseColors]);

  const enabled = useMemo(() => new Set(schemas.map((s) => s.databaseId).filter((id) => !disabled.has(id))), [schemas, disabled]);
  const model = useMemo(() => buildLineModel(graph, schemas, fieldConfig, enabled), [graph, schemas, fieldConfig, enabled]);
  const order = useMemo(() => sortPeople(model, sort), [model, sort]);
  const lanes = useMemo(() => layoutLanes(model, order), [model, order]);

  const filteredDbs = useMemo(() => new Set(
    Object.entries(fieldConfig).filter(([, c]) => Object.values(c.activeFilters ?? {}).some((v) => v && v.length > 0)).map(([id]) => id),
  ), [fieldConfig]);

  // ── Navigation & selection ──
  const [focusLane, setFocusLane] = useState(-1);
  const [isolate, setIsolate] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [detail, setDetail] = useState<NodeDetail | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [viewLabel, setViewLabel] = useState<{ label: string; level: TickLevel } | null>(null);

  // Model rebuilt (sources / fields changed): drop stale indices
  const modelRef = useRef(model);
  useEffect(() => {
    if (modelRef.current === model) return;
    const prev = modelRef.current;
    modelRef.current = model;
    const prevSelId = selected !== null ? prev.events[selected]?.node.id : null;
    setSelected(prevSelId ? model.byNodeId.get(prevSelId) ?? null : null);
    const prevIsoKey = isolate !== null ? prev.people[isolate]?.key : null;
    setIsolate(prevIsoKey ? model.people.find((p) => p.key === prevIsoKey)?.index ?? null : null);
  }, [model, selected, isolate]);

  const related = useMemo(
    () => (selected !== null ? relatedEvents(model, initialGraph.edges, selected) : []),
    [model, initialGraph.edges, selected],
  );

  const select = useCallback((event: number | null) => {
    setSelected(event);
    const node = event !== null ? modelRef.current.events[event]?.node : null;
    if (!node) { setDetail(null); return; }
    setDetail(nodeToDetail(node));
    void fetch(`/api/node/${node.id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((full: NodeDetail | null) => { if (full) setDetail((cur) => (cur?.id === full.id ? { ...cur, ...full } : cur)); })
      .catch(() => {});
  }, []);

  const selectAndFocus = useCallback((event: number) => {
    select(event);
    apiRef.current?.focusEvent(event);
  }, [select]);

  const pickPerson = useCallback((p: number) => {
    setIsolate((cur) => {
      if (cur === p) { return null; }
      return p;
    });
    apiRef.current?.focusPerson(p, true);
  }, []);

  const handleViewLabel = useCallback((label: string, level: TickLevel) => setViewLabel({ label, level }), []);

  // ── Keyboard ──
  const stateRef = useRef({ selected, panelOpen, isolate, focusLane, model, sourcesOpen });
  stateRef.current = { selected, panelOpen, isolate, focusLane, model, sourcesOpen };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable) return;
      if (e.metaKey || e.ctrlKey) return;
      const api = apiRef.current;
      const s = stateRef.current;
      const k = e.key.toLowerCase();
      if (e.key === "Escape") {
        if (s.sourcesOpen) return;
        if (s.panelOpen) setPanelOpen(false);
        else if (s.selected !== null) { setSelected(null); setDetail(null); }
        else if (s.isolate !== null) setIsolate(null);
      } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        api?.stepLane(e.key === "ArrowUp" ? 1 : -1);
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        if (!api) return;
        const v = api.getView();
        api.setView(v.center + (v.t1 - v.t0) * (e.key === "ArrowRight" ? 0.25 : -0.25));
      } else if (e.key === "[" || e.key === "]") {
        // Step through the current lane's records in time order
        const lane = s.isolate ?? s.focusLane;
        if (lane < 0) return;
        const evs = [...s.model.people[lane].events].sort((a, b) => s.model.events[a].t0 - s.model.events[b].t0 || a - b);
        if (evs.length === 0) return;
        let pos = s.selected !== null ? evs.indexOf(s.selected) : -1;
        if (pos < 0) {
          const center = api?.getView().center ?? 0;
          pos = evs.findIndex((ev) => s.model.events[ev].t0 >= center) - (e.key === "]" ? 1 : 0);
        }
        const next = evs[Math.min(evs.length - 1, Math.max(0, pos + (e.key === "]" ? 1 : -1)))];
        selectAndFocus(next);
      } else if (k === "t") {
        api?.goToday();
      } else if (k === "f") {
        api?.fitAll();
      } else if (k === "z") {
        const lane = s.isolate ?? s.focusLane;
        if (lane >= 0) api?.focusPerson(lane, true);
      } else if (k === "q") {
        setPeopleCollapsed((v) => !v);
      } else if (k === "e") {
        if (s.panelOpen) setPanelOpen(false);
        else if (s.selected !== null) setPanelOpen(true);
      } else if (e.key === "+" || e.key === "=") {
        api?.zoomBy(1.6);
      } else if (e.key === "-" || e.key === "_") {
        api?.zoomBy(1 / 1.6);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectAndFocus]);

  // ── Search ──
  const searchNodes = useMemo(() => model.events.map((e) => e.node), [model]);
  const handleSearchPick = useCallback((node: GraphNode) => {
    const idx = model.byNodeId.get(node.id);
    if (idx !== undefined) selectAndFocus(idx);
  }, [model, selectAndFocus]);
  const handlePanelSelect = useCallback((d: NodeDetail) => {
    const idx = model.byNodeId.get(d.id);
    if (idx !== undefined) selectAndFocus(idx);
    else { setSelected(null); setDetail(d); }
  }, [model, selectAndFocus]);

  // ── Sources ──
  const toggleSource = useCallback((id: string) => {
    setDisabled((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);
  const setPeopleField = useCallback((id: string, field: string) => {
    saveFieldConfig({ ...fieldConfig, [id]: { ...(fieldConfig[id] ?? emptyCfg()), nameField: field } });
  }, [fieldConfig, saveFieldConfig]);
  const clearFilters = useCallback((id: string) => {
    saveFieldConfig({ ...fieldConfig, [id]: { ...(fieldConfig[id] ?? emptyCfg()), activeFilters: {} } });
  }, [fieldConfig, saveFieldConfig]);

  const selEvent = selected !== null ? model.events[selected] : null;
  const leftInset = peopleCollapsed ? 0 : 284;
  const rightInset = panelOpen ? 320 : 0;
  const rightOffset = panelOpen ? 332 : 24;
  const empty = model.events.length === 0;
  const lanePerson = isolate ?? focusLane;

  return (
    <div style={{ width: "100%", height: "100%", position: "relative", overflow: "clip", background: darkMode ? "#05060b" : "var(--bg-base)" }}>
      {!empty && disabledLoaded && sortLoaded && (
        <TimelineCanvas
          model={model}
          lanes={lanes}
          darkMode={darkMode}
          selectedEvent={selected}
          relatedEvents={related}
          isolatePerson={isolate}
          leftInset={leftInset}
          rightInset={rightInset}
          apiRef={apiRef}
          onSelect={select}
          onFocusLane={setFocusLane}
          onPickPerson={pickPerson}
          onViewLabel={handleViewLabel}
        />
      )}

      {empty && (
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10 }}>
          <div style={{ fontFamily: "'Lora', Georgia, serif", fontSize: 22, fontWeight: 600, color: "var(--text-muted)" }}>No one on the line yet</div>
          <div style={{ fontFamily: "'Geist', sans-serif", fontSize: 13, color: "var(--text-faint)", maxWidth: 420, textAlign: "center", lineHeight: 1.5 }}>
            The Line needs databases with a <b>people</b> field. Turn some on in <b>Sources</b>, or sync a workspace that has them.
          </div>
          <button type="button" data-sources-toggle onClick={() => setSourcesOpen(true)} style={{ ...chromeButton, marginTop: 6 }} onMouseEnter={hoverIn} onMouseLeave={hoverOut}>Open Sources</button>
        </div>
      )}

      {/* ── Top-left: wordmark + view range ── */}
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
            <img src="/UserIcon.png" alt="" style={{ width: 18, height: 18, objectFit: "contain" }} />
            <span style={{ fontFamily: "'Lora', Georgia, serif", fontSize: 16, fontWeight: 600, color: "var(--text-primary)", letterSpacing: "-0.01em" }}>The Line</span>
          </div>
        </Link>
        {!empty && viewLabel && (
          <div style={{
            display: "flex", alignItems: "center", gap: 8, height: 30, padding: "0 11px",
            background: "var(--panel-bg)", backdropFilter: "blur(14px)", border: "1px solid var(--border-default)", borderRadius: 9, boxShadow: "var(--shadow-sm)",
          }}>
            <span style={{ fontFamily: "'Geist', sans-serif", fontSize: 12, fontWeight: 500, color: "var(--text-primary)" }}>{viewLabel.label}</span>
            <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: "var(--text-faint)" }}>{LEVEL_NAME[viewLabel.level]}</span>
            {lanePerson >= 0 && model.people[lanePerson] && (
              <>
                <span style={{ width: 1, height: 12, background: "var(--border-default)" }} />
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: personColor(model.people[lanePerson].hue, darkMode) }} />
                <span style={{ fontFamily: "'Geist', sans-serif", fontSize: 12, color: "var(--text-secondary)" }}>{model.people[lanePerson].name}</span>
                {isolate !== null && (
                  <button
                    type="button"
                    onClick={() => setIsolate(null)}
                    title="Show everyone (Esc)"
                    style={{ border: "none", background: "var(--bg-overlay)", borderRadius: 5, height: 18, padding: "0 6px", cursor: "pointer", fontFamily: "'DM Mono', monospace", fontSize: 9.5, color: "var(--text-muted)" }}
                  >
                    isolated ×
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* ── People ── */}
      {!empty && (
        <LinePeoplePanel
          model={model}
          order={order}
          sort={sort}
          onSortChange={setSort}
          focusLane={focusLane}
          isolate={isolate}
          onPick={pickPerson}
          collapsed={peopleCollapsed}
          onToggleCollapsed={() => setPeopleCollapsed((v) => !v)}
          darkMode={darkMode}
        />
      )}

      {/* ── Top-right controls ── */}
      <div style={{ position: "absolute", top: 20, right: rightOffset, zIndex: 22, display: "flex", alignItems: "center", gap: 8, transition: "right 0.35s cubic-bezier(0.32, 0, 0.15, 1)" }} className="animate-fade-up">
        {!empty && <NodeSearch nodes={searchNodes} onPick={handleSearchPick} />}
        <div style={{ position: "relative" }}>
          <button
            type="button"
            data-sources-toggle
            onClick={() => setSourcesOpen((v) => !v)}
            title="Choose databases, people fields and dates"
            style={{ ...chromeButton, ...(sourcesOpen ? { background: "var(--bg-overlay)", color: "var(--text-primary)" } : {}) }}
            onMouseEnter={hoverIn}
            onMouseLeave={(e) => { if (!sourcesOpen) hoverOut(e); }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><ellipse cx="6" cy="3" rx="4.5" ry="1.8" stroke="currentColor" strokeWidth="1.1" /><path d="M1.5 3v6c0 1 2 1.8 4.5 1.8s4.5-.8 4.5-1.8V3M1.5 6c0 1 2 1.8 4.5 1.8s4.5-.8 4.5-1.8" stroke="currentColor" strokeWidth="1.1" /></svg>
            Sources
            <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: "var(--text-faint)" }}>{model.sources.filter((s) => !disabled.has(s.databaseId)).length}</span>
          </button>
          {sourcesOpen && (
            <LineSources
              sources={model.sources}
              disabled={disabled}
              filtered={filteredDbs}
              onToggle={toggleSource}
              onPeopleField={setPeopleField}
              onClearFilters={clearFilters}
              onClose={() => setSourcesOpen(false)}
            />
          )}
        </div>
        <button
          type="button"
          onClick={toggleDarkMode}
          title={darkMode ? "Switch to light mode" : "Switch to dark mode"}
          style={{ ...chromeButton, width: 28, padding: 0, fontSize: 14 }}
          onMouseEnter={hoverIn}
          onMouseLeave={hoverOut}
        >
          {darkMode ? "☀" : "◑"}
        </button>
      </div>

      {/* ── Selection card ── */}
      {selEvent && (
        <div
          key={selEvent.index}
          className="animate-fade-up"
          style={{
            position: "absolute", top: 64, right: rightOffset, zIndex: 20, width: 300,
            background: "var(--panel-bg)", backdropFilter: "blur(16px)", border: "1px solid var(--border-default)",
            borderRadius: 12, boxShadow: "var(--shadow-md)", padding: "12px 14px", transition: "right 0.35s cubic-bezier(0.32, 0, 0.15, 1)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: selEvent.node.color, flexShrink: 0 }} />
            <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 9.5, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {selEvent.node.databaseName} · {kindLabel(selEvent.kind)}
            </span>
            <button
              type="button"
              onClick={() => { setSelected(null); setDetail(null); }}
              title="Clear selection (Esc)"
              style={{ marginLeft: "auto", width: 20, height: 20, padding: 0, borderRadius: 5, border: "none", background: "transparent", color: "var(--text-faint)", cursor: "pointer", fontSize: 14, lineHeight: 1 }}
            >
              ×
            </button>
          </div>
          <div style={{ marginTop: 6, fontFamily: "'Lora', Georgia, serif", fontSize: 15, fontWeight: 600, color: "var(--text-primary)", lineHeight: 1.3 }}>
            {displayName(selEvent.node)}
          </div>
          <div style={{ marginTop: 5, fontFamily: "'DM Mono', monospace", fontSize: 10.5, color: selEvent.overdue ? "#e5534b" : "var(--text-muted)" }}>
            {describeWhen(selEvent, model.today)}
          </div>
          {selEvent.status && (
            <div style={{ marginTop: 6, display: "inline-flex", alignItems: "center", gap: 5, padding: "2px 8px", borderRadius: 999, background: "var(--bg-overlay)", fontFamily: "'Geist', sans-serif", fontSize: 11, color: "var(--text-secondary)" }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: STATE_COLOR[selEvent.state] }} />
              {selEvent.status}
            </div>
          )}
          {selEvent.detail && (
            <div style={{ marginTop: 8, fontFamily: "'Geist', sans-serif", fontSize: 11.5, lineHeight: 1.45, color: "var(--text-muted)", display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
              {selEvent.detail}
            </div>
          )}
          <div style={{ marginTop: 9, display: "flex", flexWrap: "wrap", gap: 5 }}>
            {selEvent.people.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => pickPerson(p)}
                title={`Fly to ${model.people[p].name}'s lane`}
                style={{
                  display: "flex", alignItems: "center", gap: 5, height: 22, padding: "0 8px 0 4px", borderRadius: 999, cursor: "pointer",
                  border: `1px solid ${p === isolate ? personColor(model.people[p].hue, darkMode) : "var(--border-default)"}`,
                  background: "transparent", fontFamily: "'Geist', sans-serif", fontSize: 11, color: "var(--text-secondary)",
                }}
              >
                <span style={{ width: 14, height: 14, borderRadius: "50%", background: personColor(model.people[p].hue, true) }} />
                {model.people[p].name}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
            <button type="button" onClick={() => setPanelOpen(true)} style={{ ...chromeButton, height: 26, boxShadow: "none", flex: 1 }} onMouseEnter={hoverIn} onMouseLeave={hoverOut}>
              Details <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 9.5, color: "var(--text-faint)" }}>E</span>
            </button>
            <button type="button" onClick={() => apiRef.current?.focusEvent(selEvent.index)} style={{ ...chromeButton, height: 26, boxShadow: "none", flex: 1 }} onMouseEnter={hoverIn} onMouseLeave={hoverOut}>
              Zoom to
            </button>
          </div>
          {related.length > 0 && (
            <div style={{ marginTop: 8, fontFamily: "'DM Mono', monospace", fontSize: 10, color: "var(--text-faint)" }}>
              {related.length} linked record{related.length === 1 ? "" : "s"} on the timeline
            </div>
          )}
        </div>
      )}

      {/* ── Bottom: overview + hints ── */}
      {!empty && (
        <>
          <div style={{ position: "absolute", bottom: 20, left: leftInset + 24, right: rightOffset, zIndex: 20, transition: "right 0.35s cubic-bezier(0.32, 0, 0.15, 1), left 0.35s cubic-bezier(0.32, 0, 0.15, 1)" }} className="animate-fade-up">
            <LineOverview model={model} apiRef={apiRef} darkMode={darkMode} />
          </div>
          <div
            style={{
              position: "absolute", bottom: 86, right: rightOffset, zIndex: 20, display: "flex", alignItems: "center", gap: 10,
              background: "var(--panel-bg)", backdropFilter: "blur(12px)", border: "1px solid var(--border-default)",
              borderRadius: 10, padding: "5px 12px", boxShadow: "var(--shadow-sm)", transition: "right 0.35s cubic-bezier(0.32, 0, 0.15, 1)",
            }}
            className="animate-fade-up"
          >
            {[["scroll", "zoom time"], ["drag", "pan"], ["↑ ↓", "lanes"], ["[ ]", "step records"], ["T", "today"], ["/", "search"]].map(([key, action]) => (
              <span key={key} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: "var(--text-primary)", background: "var(--bg-overlay)", border: "1px solid var(--border-default)", borderRadius: 4, padding: "1px 5px" }}>{key}</span>
                <span style={{ fontFamily: "'Geist', sans-serif", fontSize: 11, color: "var(--text-faint)" }}>{action}</span>
              </span>
            ))}
          </div>
        </>
      )}

      {/* ── Details panel + pull tab ── */}
      <NodeDetailsPanel
        detail={detail}
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        onSelectNode={handlePanelSelect}
        allNodes={graph.nodes}
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
          <polyline
            points={panelOpen ? "3,2 8,8 3,14" : "7,2 2,8 7,14"}
            stroke={!panelOpen && detail ? "var(--accent-warm)" : "var(--text-muted)"}
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  );
}
