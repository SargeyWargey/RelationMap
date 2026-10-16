"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

import { useTheme } from "@/components/ThemeProvider";
import { OrreryUniverseBuilder } from "@/components/OrreryUniverseBuilder";
import { OrreryCanvas, describeBody } from "@/components/OrreryCanvas";
import { OrreryAtlas, TierGlyph, bodyUiColor } from "@/components/OrreryAtlas";
import { OrreryBreadcrumb } from "@/components/OrreryBreadcrumb";
import { OrrerySpeedControl } from "@/components/OrrerySpeedControl";
import { NodeDetailsPanel } from "@/components/NodeDetailsPanel";
import { NodeSearch, nodeToDetail } from "@/components/NodeSearch";
import { buildUniverse } from "@/lib/orreryUniverse";
import type { GraphData, GraphNode, NodeDetail } from "@/lib/types";
import type { OrreryConfig } from "@/lib/orreryTypes";

type Props = {
  initialGraph: GraphData | null;
  databaseColors: Record<string, string>;
  lastSyncAt?: string;
  orreryConfig: OrreryConfig | null;
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

export function ProjectOrreryScreen({ initialGraph, orreryConfig: initialOrreryConfig }: Props) {
  const { darkMode, toggleDarkMode } = useTheme();
  const [orreryConfig, setOrreryConfig] = useState<OrreryConfig | null>(initialOrreryConfig);
  const [showBuilder, setShowBuilder] = useState(!initialOrreryConfig);

  const universe = useMemo(
    () => (orreryConfig && initialGraph ? buildUniverse(initialGraph, orreryConfig.tierMapping) : null),
    [orreryConfig, initialGraph],
  );

  // Navigation
  const [focusIndex, setFocusIndex] = useState(-1);
  const lastRealFocus = useRef(-1);
  const [focusRequest, setFocusRequest] = useState<{ index: number; seq: number } | null>(null);
  const flyTo = useCallback((index: number) => {
    setFocusRequest((prev) => ({ index, seq: (prev?.seq ?? 0) + 1 }));
  }, []);
  const handleFocusChange = useCallback((index: number) => {
    setFocusIndex(index);
    if (index >= -1) lastRealFocus.current = index;
  }, []);

  // Selection + details
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [detail, setDetail] = useState<NodeDetail | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState<number | null>(null);

  const select = useCallback((index: number | null) => {
    setSelectedIndex(index);
    const node = index !== null && universe ? universe.bodies[index]?.node : null;
    if (!node) { setDetail(null); return; }
    setDetail(nodeToDetail(node));
    // Enrich with the full record (description etc.)
    void fetch(`/api/node/${node.id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((full: NodeDetail | null) => { if (full) setDetail((cur) => (cur?.id === full.id ? { ...cur, ...full } : cur)); })
      .catch(() => {});
  }, [universe]);

  const selectAndFly = useCallback((index: number) => {
    if (index >= 0) select(index); else select(null);
    flyTo(index);
  }, [flyTo, select]);

  // Reset navigation when the universe is rebuilt
  useEffect(() => {
    setFocusIndex(-1);
    lastRealFocus.current = -1;
    setSelectedIndex(null);
    setDetail(null);
  }, [universe]);

  // Time
  const [speed, setSpeed] = useState(1);
  const [paused, setPaused] = useState(false);

  // Atlas
  const [atlasCollapsed, setAtlasCollapsed] = useState(false);

  // Keyboard
  const stateRef = useRef({ focusIndex, selectedIndex, panelOpen, showBuilder, universe });
  stateRef.current = { focusIndex, selectedIndex, panelOpen, showBuilder, universe };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable) return;
      const s = stateRef.current;
      if (s.showBuilder || !s.universe) return;
      const u = s.universe;
      const k = e.key.toLowerCase();
      if (e.key === "Escape") {
        if (s.panelOpen) { setPanelOpen(false); return; }
        const cur = s.focusIndex === -2 ? lastRealFocus.current : s.focusIndex;
        const up = s.focusIndex === -2 ? cur : cur >= 0 ? u.bodies[cur].parent : -1;
        setSelectedIndex(null);
        setDetail(null);
        flyTo(up);
      } else if (e.key === " ") {
        e.preventDefault();
        setPaused((v) => !v);
      } else if (k === "q") {
        setAtlasCollapsed((v) => !v);
      } else if (k === "e") {
        if (s.panelOpen) setPanelOpen(false);
        else if (s.selectedIndex !== null) setPanelOpen(true);
      } else if (e.key === "[" || e.key === "]") {
        // Step through siblings of the current selection / focus
        const cur = s.selectedIndex ?? (s.focusIndex >= 0 ? s.focusIndex : -1);
        const siblings = cur >= 0 && u.bodies[cur].parent >= 0 ? u.bodies[u.bodies[cur].parent].children : u.roots;
        if (siblings.length === 0) return;
        const pos = cur >= 0 ? siblings.indexOf(cur) : -1;
        const next = siblings[(pos + (e.key === "]" ? 1 : -1) + siblings.length) % siblings.length];
        selectAndFly(next);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flyTo, selectAndFly]);

  const searchNodes = useMemo(
    () => (universe ? universe.bodies.flatMap((b) => (b.node ? [b.node] : [])) : []),
    [universe],
  );
  const handleSearchPick = useCallback((node: GraphNode) => {
    const idx = universe?.byId.get(node.id);
    if (idx !== undefined) selectAndFly(idx);
  }, [universe, selectAndFly]);

  const handlePanelSelect = useCallback((d: NodeDetail) => {
    const idx = universe?.byId.get(d.id);
    if (idx !== undefined) selectAndFly(idx);
    else { setSelectedIndex(null); setDetail(d); }
  }, [universe, selectAndFly]);

  function handleLaunch(config: OrreryConfig) {
    setOrreryConfig(config);
    setShowBuilder(false);
  }

  const selectedBody = selectedIndex !== null && universe ? universe.bodies[selectedIndex] : null;
  const rightOffset = panelOpen ? 332 : 24;

  return (
    <div style={{ width: "100%", height: "100%", position: "relative", overflow: "hidden", background: "#05060d" }}>

      {universe && !showBuilder && (
        <OrreryCanvas
          universe={universe}
          focusRequest={focusRequest}
          selectedIndex={selectedIndex}
          highlightIndex={highlightIndex}
          speed={speed}
          paused={paused}
          onFocusChange={handleFocusChange}
          onSelect={select}
        />
      )}

      {!showBuilder && !universe && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,0.3)", fontFamily: "'DM Mono', monospace", fontSize: 13 }}>
          No graph data — run sync first
        </div>
      )}

      {showBuilder && (
        <OrreryUniverseBuilder
          graphData={initialGraph}
          initialConfig={orreryConfig}
          onLaunch={handleLaunch}
          onClose={orreryConfig ? () => setShowBuilder(false) : undefined}
        />
      )}

      {/* ── Top-left: wordmark + location ── */}
      <div style={{ position: "absolute", top: 20, left: 24, zIndex: 20, display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-start" }} className="animate-fade-up">
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
            <img src="/universe.png" alt="" style={{ width: 18, height: 18, objectFit: "contain" }} />
            <span style={{ fontFamily: "'Lora', Georgia, serif", fontSize: 16, fontWeight: 600, color: "var(--text-primary)", letterSpacing: "-0.01em" }}>
              The Universe
            </span>
          </div>
        </Link>
        {universe && !showBuilder && (
          <OrreryBreadcrumb
            universe={universe}
            focusIndex={focusIndex === -2 ? lastRealFocus.current : focusIndex}
            onNavigate={(i) => selectAndFly(i)}
          />
        )}
      </div>

      {/* ── Atlas ── */}
      {universe && !showBuilder && (
        <OrreryAtlas
          universe={universe}
          focusIndex={focusIndex}
          selectedIndex={selectedIndex}
          onNavigate={selectAndFly}
          onHover={setHighlightIndex}
          collapsed={atlasCollapsed}
          onToggleCollapsed={() => setAtlasCollapsed((v) => !v)}
        />
      )}

      {/* ── Top-right controls ── */}
      <div style={{ position: "absolute", top: 20, right: rightOffset, zIndex: 20, display: "flex", alignItems: "center", gap: 8, transition: "right 0.35s cubic-bezier(0.32, 0, 0.15, 1)" }} className="animate-fade-up">
        {universe && !showBuilder && <NodeSearch nodes={searchNodes} onPick={handleSearchPick} />}
        {orreryConfig && !showBuilder && (
          <button type="button" onClick={() => setShowBuilder(true)} title="Remap databases to tiers" style={chromeButton} onMouseEnter={hoverIn} onMouseLeave={hoverOut}>
            <TierGlyph tier="galaxy" size={12} />
            Builder
          </button>
        )}
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
      {universe && !showBuilder && selectedBody && (
        <div
          key={selectedBody.index}
          className="animate-fade-up"
          style={{
            position: "absolute", top: 64, right: rightOffset, zIndex: 20, width: 280,
            background: "var(--panel-bg)", backdropFilter: "blur(16px)", border: "1px solid var(--border-default)",
            borderRadius: 12, boxShadow: "var(--shadow-md)", padding: "12px 14px",
            transition: "right 0.35s cubic-bezier(0.32, 0, 0.15, 1)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <TierGlyph tier={selectedBody.tier} region={!!selectedBody.region} color={bodyUiColor(selectedBody)} size={14} />
            <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--accent-warm)" }}>
              {selectedBody.region ? "deep space" : selectedBody.tier}
            </span>
            <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 9.5, color: "var(--text-faint)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {selectedBody.node?.databaseName}
            </span>
            <button
              type="button"
              onClick={() => { setSelectedIndex(null); setDetail(null); }}
              title="Clear selection"
              style={{ marginLeft: "auto", width: 20, height: 20, padding: 0, borderRadius: 5, border: "none", background: "transparent", color: "var(--text-faint)", cursor: "pointer", fontSize: 14, lineHeight: 1 }}
            >
              ×
            </button>
          </div>
          <div style={{ marginTop: 6, fontFamily: "'Lora', Georgia, serif", fontSize: 15, fontWeight: 600, color: "var(--text-primary)", lineHeight: 1.3 }}>
            {selectedBody.name}
          </div>
          <div style={{ marginTop: 4, fontFamily: "'DM Mono', monospace", fontSize: 10.5, color: "var(--text-muted)" }}>
            {describeBody(selectedBody, universe)}
            {selectedBody.node ? ` · ${universe.neighbors[selectedBody.index].length} links` : ""}
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
            {selectedBody.node && (
              <button type="button" onClick={() => setPanelOpen(true)} style={{ ...chromeButton, height: 26, boxShadow: "none", flex: 1 }} onMouseEnter={hoverIn} onMouseLeave={hoverOut}>
                Details <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 9.5, color: "var(--text-faint)" }}>E</span>
              </button>
            )}
            {selectedBody.parent >= 0 && (
              <button type="button" onClick={() => selectAndFly(selectedBody.parent)} style={{ ...chromeButton, height: 26, boxShadow: "none", flex: 1 }} onMouseEnter={hoverIn} onMouseLeave={hoverOut}>
                Up to {universe.bodies[selectedBody.parent].tier === "galaxy" && universe.bodies[selectedBody.parent].region ? "region" : universe.bodies[selectedBody.parent].tier}
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Bottom: time control + hints ── */}
      {universe && !showBuilder && (
        <>
          <div style={{ position: "absolute", bottom: 20, left: "50%", transform: "translateX(-50%)", zIndex: 20 }} className="animate-fade-up">
            <OrrerySpeedControl speed={speed} paused={paused} onSpeedChange={setSpeed} onPausedChange={setPaused} />
          </div>
          <div
            style={{
              position: "absolute", bottom: 20, right: rightOffset, zIndex: 20, display: "flex", alignItems: "center", gap: 10,
              background: "var(--panel-bg)", backdropFilter: "blur(12px)", border: "1px solid var(--border-default)",
              borderRadius: 10, padding: "6px 12px", boxShadow: "var(--shadow-sm)", transition: "right 0.35s cubic-bezier(0.32, 0, 0.15, 1)",
            }}
            className="animate-fade-up"
          >
            {[["drag", "orbit"], ["scroll", "zoom"], ["click", "fly"], ["esc", "up"]].map(([key, action]) => (
              <span key={key} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: "var(--text-primary)", background: "var(--bg-overlay)", border: "1px solid var(--border-default)", borderRadius: 4, padding: "1px 5px" }}>{key}</span>
                <span style={{ fontFamily: "'Geist', sans-serif", fontSize: 11, color: "var(--text-faint)" }}>{action}</span>
              </span>
            ))}
          </div>
        </>
      )}

      {/* ── Details panel + pull tab ── */}
      {!showBuilder && universe && (
        <>
          <NodeDetailsPanel
            detail={detail}
            open={panelOpen}
            onClose={() => setPanelOpen(false)}
            onSelectNode={handlePanelSelect}
            allNodes={initialGraph?.nodes ?? []}
            allEdges={initialGraph?.edges ?? []}
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
        </>
      )}
    </div>
  );
}
