"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import Link from "next/link";

import { CultureCanvas } from "@/components/CultureCanvas";
import { ParallaxMountainBg } from "@/components/ParallaxMountainBg";
import { DatabaseTogglePanel } from "@/components/DatabaseTogglePanel";
import { NodeDetailsPanel } from "@/components/NodeDetailsPanel";
import { useTheme } from "@/components/ThemeProvider";
import { useLastSyncLabel } from "@/lib/useLastSyncLabel";
import type {
  AppConfig,
  CultureConfig,
  DatabaseFieldConfig,
  DatabaseSchema,
  GraphData,
  NodeDetail,
} from "@/lib/types";

const DEFAULT_CULTURE_CONFIG: CultureConfig = {
  playbackSpeed: 1,  // 1× = 10 days per second (comfortable pace)
  showRelations: true,
  nodeSizeScale: 1,
};

type Props = {
  initialGraph: GraphData;
  databaseColors: Record<string, string>;
  lastSyncAt?: string;
  initialCultureConfig?: CultureConfig;
};

export function ProjectCultureScreen({
  initialGraph,
  databaseColors,
  lastSyncAt,
  initialCultureConfig,
}: Props) {
  const { darkMode, toggleDarkMode } = useTheme();
  const syncLabel = useLastSyncLabel(lastSyncAt);

  // Schemas + field config
  const [schemas, setSchemas] = useState<DatabaseSchema[]>([]);
  const [fieldConfig, setFieldConfig] = useState<Record<string, DatabaseFieldConfig>>({});

  useEffect(() => {
    fetch("/api/schemas").then((r) => r.json()).then(setSchemas).catch(() => {});
    fetch("/api/field-config").then((r) => r.json()).then(setFieldConfig).catch(() => {});
  }, []);

  function handleFieldConfigChange(dbId: string, cfg: DatabaseFieldConfig) {
    const next = { ...fieldConfig, [dbId]: cfg };
    setFieldConfig(next);
    fetch("/api/field-config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(next),
    }).catch(() => {});
  }

  // Culture config (showRelations, nodeSizeScale, playbackSpeed)
  const [cultureConfig, setCultureConfig] = useState<CultureConfig>(
    initialCultureConfig ?? DEFAULT_CULTURE_CONFIG,
  );

  function saveCultureConfig(next: CultureConfig) {
    setCultureConfig(next);
    fetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cultureConfig: next } satisfies Partial<AppConfig>),
    }).catch(() => {});
  }

  // Selected node / details panel
  const [selectedDetail, setSelectedDetail] = useState<NodeDetail | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);

  const handleSelectNode = useCallback((detail: NodeDetail | null) => {
    setSelectedDetail(detail);
    if (detail) setPanelOpen(true);
  }, []);

  const handleClose = useCallback(() => {
    setPanelOpen(false);
    setTimeout(() => setSelectedDetail(null), 350);
  }, []);

  // Database colors (merged with fieldConfig overrides)
  const coloredGraph = useMemo(() => {
    const nodes = initialGraph.nodes.map((n) => ({
      ...n,
      color: fieldConfig[n.databaseId]?.databaseColor ?? databaseColors[n.databaseId] ?? n.color,
    }));
    return { ...initialGraph, nodes };
  }, [initialGraph, fieldConfig, databaseColors]);

  // All database IDs from the graph
  const allDatabaseIds = useMemo(
    () => Array.from(new Set(initialGraph.nodes.map((n) => n.databaseId))),
    [initialGraph.nodes],
  );

  // Databases that have NO nodes with a createdTime — they can't be used in Culture mode
  const disabledDbs = useMemo(() => {
    const disabled = new Set<string>();
    for (const dbId of allDatabaseIds) {
      const hasTime = initialGraph.nodes.some(
        (n) => n.databaseId === dbId && !!n.createdTime,
      );
      if (!hasTime) disabled.add(dbId);
    }
    return disabled;
  }, [allDatabaseIds, initialGraph.nodes]);

  // Enabled databases (only selectable ones — auto-exclude disabled)
  const [enabledDbs, setEnabledDbs] = useState<Set<string>>(() => new Set());

  function toggleDb(id: string) {
    if (disabledDbs.has(id)) return;
    setEnabledDbs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // Selectable database IDs (not disabled)
  const selectableDbs = useMemo(
    () => allDatabaseIds.filter((id) => !disabledDbs.has(id)),
    [allDatabaseIds, disabledDbs],
  );

  // Select All state: true=all, false=none, null=partial
  const selectAllState: boolean | null = useMemo(() => {
    if (selectableDbs.length === 0) return false;
    const enabledCount = selectableDbs.filter((id) => enabledDbs.has(id)).length;
    if (enabledCount === 0) return false;
    if (enabledCount === selectableDbs.length) return true;
    return null; // partial
  }, [selectableDbs, enabledDbs]);

  function handleSelectAll() {
    if (selectAllState === true) {
      // Deselect all
      setEnabledDbs(new Set());
    } else {
      // Select all selectable
      setEnabledDbs(new Set(selectableDbs));
    }
  }

  // Filtered graph for the canvas
  const filteredGraph = useMemo(() => {
    if (enabledDbs.size === 0) return { ...coloredGraph, nodes: [], edges: [] };
    const nodes = coloredGraph.nodes.filter((n) => enabledDbs.has(n.databaseId) && !!n.createdTime);
    const nodeIds = new Set(nodes.map((n) => n.id));
    const edges = initialGraph.edges.filter(
      (e) => nodeIds.has(e.source) && nodeIds.has(e.target),
    );
    return { ...coloredGraph, nodes, edges };
  }, [coloredGraph, initialGraph.edges, enabledDbs]);

  // Playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const [seekTo, setSeekTo] = useState<Date | null>(null);

  // DB panel collapsed state
  const [dbPanelCollapsed, setDbPanelCollapsed] = useState(false);
  const [dbPanelFlashTrigger, setDbPanelFlashTrigger] = useState(0);

  const handleBackgroundClick = useCallback(() => {
    if (enabledDbs.size === 0) setDbPanelFlashTrigger((v) => v + 1);
  }, [enabledDbs.size]);

  // Keyboard shortcuts
  const panelOpenRef = useRef(panelOpen);
  const selectedDetailRef = useRef(selectedDetail);
  useEffect(() => { panelOpenRef.current = panelOpen; }, [panelOpen]);
  useEffect(() => { selectedDetailRef.current = selectedDetail; }, [selectedDetail]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
      if (e.key.toLowerCase() === "q") {
        setDbPanelCollapsed((v) => !v);
      } else if (e.key === " ") {
        e.preventDefault();
        setIsPlaying((v) => !v);
      } else if (e.key.toLowerCase() === "e") {
        if (panelOpenRef.current) {
          handleClose();
        } else if (selectedDetailRef.current) {
          setPanelOpen(true);
        }
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [handleClose]);

  // dbIdToName + dbIdToColor for panel
  const dbIdToName = useMemo(() => {
    const map: Record<string, string> = {};
    for (const n of initialGraph.nodes) {
      if (!map[n.databaseId]) map[n.databaseId] = n.databaseName;
    }
    return map;
  }, [initialGraph.nodes]);

  const dbIdToColor = useMemo(() => {
    const map: Record<string, string> = {};
    for (const n of coloredGraph.nodes) {
      if (!map[n.databaseId]) map[n.databaseId] = n.color;
    }
    return map;
  }, [coloredGraph.nodes]);

  const canvasVisible = enabledDbs.size > 0;

  return (
    <div style={{ width: "100%", height: "100%", position: "relative", overflow: "hidden" }}>
      {/* Background */}
      <ParallaxMountainBg
        visible={!canvasVisible}
        showPrompt={!canvasVisible}
        onBackgroundClick={!canvasVisible ? handleBackgroundClick : undefined}
      />

      {/* Canvas */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: canvasVisible ? 1 : 0,
          transition: "opacity 1.5s ease",
          pointerEvents: canvasVisible ? "auto" : "none",
        }}
      >
        <CultureCanvas
          graph={filteredGraph}
          showRelations={cultureConfig.showRelations}
          nodeSizeScale={cultureConfig.nodeSizeScale}
          onSelectNode={handleSelectNode}
          selectedNodeId={selectedDetail?.id ?? null}
          isPlaying={isPlaying}
          onPlayPause={setIsPlaying}
          playbackSpeed={cultureConfig.playbackSpeed}
          onSpeedChange={(v) => saveCultureConfig({ ...cultureConfig, playbackSpeed: v })}
          seekTo={seekTo}
          panelOpen={panelOpen}
        />
      </div>

      {/* Top-left wordmark */}
      <div style={{ position: "absolute", top: 20, left: 24, zIndex: 20 }} className="animate-fade-up">
        <Link href="/" style={{ textDecoration: "none" }}>
          <div
            style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2, cursor: "pointer", opacity: 1, transition: "opacity 0.15s" }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.opacity = "0.7"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.opacity = "1"; }}
          >
            <span style={{ fontFamily: "'Lora', Georgia, serif", fontSize: 20, fontWeight: 600, color: "var(--text-primary)", letterSpacing: "-0.01em", display: "flex", alignItems: "center", gap: 8 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/Culture.png" alt="Culture" style={{ width: 17, height: 17, objectFit: "contain" }} />
              The Culture
            </span>
            <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: "var(--text-faint)", fontWeight: 300 }}>
              growth over time
            </span>
          </div>
        </Link>
      </div>

      {/* Top-right controls */}
      <div
        style={{
          position: "absolute",
          top: 20,
          right: panelOpen ? 332 : 24,
          zIndex: 20,
          display: "flex",
          alignItems: "center",
          gap: 12,
          transition: "right 0.35s cubic-bezier(0.32,0,0.15,1)",
        }}
        className="animate-fade-up"
      >
        {/* Settings panel */}
        <CultureSettingsPanel
          showRelations={cultureConfig.showRelations}
          onShowRelationsChange={(v) => saveCultureConfig({ ...cultureConfig, showRelations: v })}
          nodeSizeScale={cultureConfig.nodeSizeScale}
          onNodeSizeScaleChange={(v) => saveCultureConfig({ ...cultureConfig, nodeSizeScale: v })}
        />

        {/* Dark mode toggle */}
        <button
          type="button"
          onClick={toggleDarkMode}
          title={darkMode ? "Switch to light mode" : "Switch to dark mode"}
          style={{
            width: 28, height: 28, borderRadius: 8,
            border: "1px solid var(--border-default)",
            background: "var(--panel-bg)", backdropFilter: "blur(12px)",
            cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 14, color: "var(--text-muted)",
            transition: "background 0.15s, color 0.15s",
            boxShadow: "var(--shadow-sm)",
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--bg-overlay)"; (e.currentTarget as HTMLElement).style.color = "var(--text-primary)"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--panel-bg)"; (e.currentTarget as HTMLElement).style.color = "var(--text-muted)"; }}
        >
          {darkMode ? "☀" : "◑"}
        </button>
      </div>

      {/* Bottom-left stats */}
      <div
        style={{
          position: "absolute",
          bottom: 20,
          left: 24,
          zIndex: 20,
          display: "flex",
          alignItems: "center",
          gap: 16,
          background: "var(--panel-bg)",
          backdropFilter: "blur(12px)",
          border: "1px solid var(--border-default)",
          borderRadius: 10,
          padding: "6px 14px",
          boxShadow: "var(--shadow-sm)",
        }}
        className="animate-fade-up"
      >
        <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: "var(--text-muted)", fontWeight: 400 }}>
          {filteredGraph.nodes.length} / {initialGraph.nodes.length} nodes · {filteredGraph.edges.length} edges
        </span>
        <span style={{ width: 1, height: 12, background: "var(--border-default)", display: "inline-block" }} />
        <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: "var(--text-faint)", fontWeight: 300 }}>
          synced {syncLabel}
        </span>
      </div>

      {/* Database panel */}
      <DatabaseTogglePanel
        allDatabaseIds={allDatabaseIds}
        dbIdToName={dbIdToName}
        databaseColors={dbIdToColor}
        enabledDbs={enabledDbs}
        onToggle={toggleDb}
        schemas={schemas}
        fieldConfig={fieldConfig}
        onFieldConfigChange={handleFieldConfigChange}
        collapsed={dbPanelCollapsed}
        onToggleCollapsed={() => setDbPanelCollapsed((v) => !v)}
        flashTrigger={dbPanelFlashTrigger}
        disabledDbs={disabledDbs}
        selectAllState={selectAllState}
        onSelectAll={handleSelectAll}
      />

      {/* Details panel */}
      <NodeDetailsPanel
        detail={selectedDetail}
        open={panelOpen}
        onClose={handleClose}
        onSelectNode={handleSelectNode}
        allNodes={filteredGraph.nodes}
        allEdges={filteredGraph.edges}
        enabledDbs={enabledDbs}
        schemas={schemas}
        fieldConfig={fieldConfig}
      />

      {/* Panel toggle tab */}
      <button
        type="button"
        onClick={() => setPanelOpen((v) => !v)}
        title={panelOpen ? "Collapse panel" : "Expand panel"}
        style={{
          position: "absolute",
          top: "50%",
          right: panelOpen ? 320 : 0,
          transform: "translateY(-50%)",
          zIndex: 50,
          width: 20, height: 56,
          background: "var(--panel-bg)",
          backdropFilter: "blur(12px)",
          border: "1px solid var(--panel-border)",
          borderRight: "none",
          borderRadius: "6px 0 0 6px",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "var(--shadow-panel)",
          transition: "right 0.35s cubic-bezier(0.32,0,0.15,1), background 0.15s",
          padding: 0,
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--bg-overlay)"; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--panel-bg)"; }}
      >
        <svg width="10" height="16" viewBox="0 0 10 16" fill="none" style={{ flexShrink: 0 }}>
          <polyline
            points={panelOpen ? "3,2 8,8 3,14" : "7,2 2,8 7,14"}
            stroke={!panelOpen && selectedDetail !== null ? "#f97316" : "var(--text-muted)"}
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            style={{ transition: "stroke 0.2s" }}
          />
        </svg>
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CultureSettingsPanel
// ─────────────────────────────────────────────────────────────────────────────

function CultureSettingsPanel({
  showRelations,
  onShowRelationsChange,
  nodeSizeScale,
  onNodeSizeScaleChange,
}: {
  showRelations: boolean;
  onShowRelationsChange: (v: boolean) => void;
  nodeSizeScale: number;
  onNodeSizeScaleChange: (v: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Settings"
        style={{
          width: 28, height: 28, borderRadius: 8,
          border: `1px solid ${open ? "var(--accent-warm)" : "var(--border-default)"}`,
          background: open ? "var(--bg-overlay)" : "var(--panel-bg)",
          backdropFilter: "blur(12px)",
          cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 14, color: open ? "var(--text-primary)" : "var(--text-muted)",
          transition: "background 0.15s, color 0.15s, border-color 0.15s",
          boxShadow: "var(--shadow-sm)",
        }}
      >
        ⚙
      </button>

      {open && (
        <div
          ref={panelRef}
          style={{
            position: "fixed",
            top: 56,
            right: 24,
            zIndex: 50,
            width: 300,
            background: "var(--panel-bg)",
            backdropFilter: "blur(20px)",
            border: "1px solid var(--border-default)",
            borderRadius: 14,
            boxShadow: "var(--shadow-lg)",
            padding: "20px 0 12px",
          }}
        >
          <div style={{ padding: "0 20px 14px", borderBottom: "1px solid var(--border-subtle)" }}>
            <span style={{ fontFamily: "'Geist', sans-serif", fontSize: 13, fontWeight: 600, color: "var(--text-primary)", letterSpacing: "-0.01em" }}>
              Settings
            </span>
          </div>

          <div style={{ padding: "14px 20px" }}>
            <p style={{ margin: "0 0 10px", fontFamily: "'DM Mono', monospace", fontSize: 10, fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-faint)" }}>
              Display
            </p>

            {/* Show Relations toggle */}
            <button
              type="button"
              onClick={() => onShowRelationsChange(!showRelations)}
              style={{
                display: "flex", alignItems: "flex-start", gap: 12,
                width: "100%", background: showRelations ? "var(--bg-overlay)" : "transparent",
                border: `1px solid ${showRelations ? "var(--border-default)" : "transparent"}`,
                borderRadius: 8, padding: "8px 10px", cursor: "pointer", textAlign: "left",
                transition: "background 0.12s, border-color 0.12s",
              }}
            >
              <div style={{
                flexShrink: 0, marginTop: 2,
                width: 28, height: 16, borderRadius: 8,
                border: `1.5px solid ${showRelations ? "var(--accent-warm)" : "var(--border-default)"}`,
                background: showRelations ? "var(--accent-warm)" : "transparent",
                display: "flex", alignItems: "center", justifyContent: "center",
                transition: "background 0.12s, border-color 0.12s",
              }}>
                {showRelations && <span style={{ color: "#fff", fontSize: 10, fontWeight: 700 }}>✓</span>}
              </div>
              <div>
                <p style={{ margin: 0, fontFamily: "'Geist', sans-serif", fontSize: 12, fontWeight: 500, color: "var(--text-primary)" }}>
                  Show Relations
                </p>
                <p style={{ margin: "3px 0 0", fontFamily: "'Geist', sans-serif", fontSize: 11, color: "var(--text-faint)", lineHeight: 1.45 }}>
                  Draw connection lines between related nodes.
                </p>
              </div>
            </button>

            {/* Node Size Scale */}
            <div style={{ marginTop: 12, padding: "8px 10px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <p style={{ margin: 0, fontFamily: "'Geist', sans-serif", fontSize: 12, fontWeight: 500, color: "var(--text-primary)" }}>
                  Node Size Scale
                </p>
                <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: "var(--text-faint)" }}>
                  {nodeSizeScale.toFixed(1)}×
                </span>
              </div>
              <input
                type="range"
                min={50}
                max={200}
                value={Math.round(nodeSizeScale * 100)}
                onChange={(e) => onNodeSizeScaleChange(Number(e.target.value) / 100)}
                style={{ width: "100%", accentColor: "var(--accent-warm)", cursor: "pointer" }}
              />
            </div>
          </div>

          <div style={{ padding: "0 20px", borderTop: "1px solid var(--border-subtle)", marginTop: 4, paddingTop: 12 }}>
            <p style={{ margin: "0 0 6px", fontFamily: "'DM Mono', monospace", fontSize: 10, fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-faint)" }}>
              Controls
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              {[["Space", "play / pause"], ["Q", "toggle DB panel"], ["E", "toggle details"]].map(([key, action]) => (
                <div key={key} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: "var(--text-primary)", background: "var(--bg-overlay)", border: "1px solid var(--border-default)", borderRadius: 4, padding: "1px 6px", fontWeight: 500 }}>{key}</span>
                  <span style={{ fontFamily: "'Geist', sans-serif", fontSize: 11, color: "var(--text-faint)" }}>{action}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
