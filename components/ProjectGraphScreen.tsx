"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import Link from "next/link";

import { GraphCanvas, type ShapeLayout } from "@/components/GraphCanvas";
import { ParallaxMountainBg } from "@/components/ParallaxMountainBg";
import { DatabaseTogglePanel } from "@/components/DatabaseTogglePanel";
import { NodeDetailsPanel } from "@/components/NodeDetailsPanel";
import { SettingsPanel } from "@/components/SettingsPanel";
import { useTheme } from "@/components/ThemeProvider";
import { useLastSyncLabel } from "@/lib/useLastSyncLabel";
import type { DatabaseFieldConfig, DatabaseSchema, GraphData, NodeDetail } from "@/lib/types";

type Props = {
  initialGraph: GraphData;
  databaseColors: Record<string, string>;
  lastSyncAt?: string;
};

export function ProjectGraphScreen({ initialGraph, databaseColors, lastSyncAt }: Props) {
  const [selectedDetail, setSelectedDetail] = useState<NodeDetail | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [shape, setShape] = useState<ShapeLayout>("sphere");

  // Canvas opacity — fades in when a database is first selected, matches City/Mountain pattern
  const [canvasOpacity, setCanvasOpacity] = useState(0);
  const wasEmptyRef = useRef(true);

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

  // Deep highlight mode — shows full connection web with opacity decay
  const [deepHighlight, setDeepHighlight] = useState(false);

  // Center text visibility + opacity
  const [showCenterText, setShowCenterText] = useState(true);
  const [centerTextOpacity, setCenterTextOpacity] = useState(0.25);

  // Dark mode — managed by ThemeProvider
  const { darkMode, toggleDarkMode } = useTheme();

  // Database toggles — all off by default for fast load
  const allDatabaseIds = useMemo(
    () => Array.from(new Set(initialGraph.nodes.map((n) => n.databaseId))),
    [initialGraph.nodes],
  );
  const [enabledDbs, setEnabledDbs] = useState<Set<string>>(() => new Set());

  function toggleDb(id: string) {
    setEnabledDbs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // Fade canvas in/out matching City/Mountain pattern
  useEffect(() => {
    const isEmpty = enabledDbs.size === 0;
    if (wasEmptyRef.current && !isEmpty) {
      wasEmptyRef.current = false;
      setCanvasOpacity(1);
    }
    if (!wasEmptyRef.current && isEmpty) {
      wasEmptyRef.current = true;
      setCanvasOpacity(0);
    }
  }, [enabledDbs.size]);

  const coloredGraph = useMemo(() => {
    const nodes = initialGraph.nodes.map((node) => ({
      ...node,
      color: fieldConfig[node.databaseId]?.databaseColor ?? databaseColors[node.databaseId] ?? node.color,
    }));
    return { ...initialGraph, nodes };
  }, [initialGraph, fieldConfig, databaseColors]);

  // Filtered graph — enabled databases + active field filters
  const filteredGraph = useMemo(() => {
    if (enabledDbs.size === 0) return { ...coloredGraph, nodes: [], edges: [] };
    const nodes = coloredGraph.nodes.filter((n) => {
      if (!enabledDbs.has(n.databaseId)) return false;
      const cfg = fieldConfig[n.databaseId];
      if (!cfg) return true;
      for (const [fieldName, selectedOptions] of Object.entries(cfg.activeFilters)) {
        if (!selectedOptions || selectedOptions.length === 0) continue;
        const val = n.fieldValues?.[fieldName];
        if (val === null || val === undefined || val === "") return false;
        const nodeValues = Array.isArray(val) ? val : [val];
        const hasMatch = selectedOptions.some((opt) => nodeValues.includes(opt));
        if (!hasMatch) return false;
      }
      return true;
    });
    const nodeIds = new Set(nodes.map((n) => n.id));
    const edges = initialGraph.edges.filter(
      (e) => nodeIds.has(e.source) && nodeIds.has(e.target),
    );
    return { ...coloredGraph, nodes, edges };
  }, [coloredGraph, initialGraph.edges, enabledDbs, fieldConfig]);

  // Compute sphere center text from config + selected node's fieldValues
  const sphereCenterText = useMemo(() => {
    if (!selectedDetail) return null;
    const cfg = fieldConfig[selectedDetail.databaseId];
    if (!cfg?.sphereField) return selectedDetail.description ?? null;
    const val = selectedDetail.fieldValues?.[cfg.sphereField];
    if (!val) return null;
    return Array.isArray(val) ? val.join(", ") : val;
  }, [selectedDetail, fieldConfig]);

  const handleSelectNode = useCallback((detail: NodeDetail | null) => {
    setSelectedDetail(detail);
  }, []);

  const handleClose = useCallback(() => {
    setPanelOpen(false);
    setTimeout(() => setSelectedDetail(null), 350);
  }, []);

  // Database panel collapsed state
  const [dbPanelCollapsed, setDbPanelCollapsed] = useState(false);

  // Flash trigger for database panel glow
  const [dbPanelFlashTrigger, setDbPanelFlashTrigger] = useState(0);
  const handleBackgroundClick = useCallback(() => {
    if (enabledDbs.size === 0) setDbPanelFlashTrigger((v) => v + 1);
  }, [enabledDbs.size]);

  // Refs for stale-closure-free keyboard shortcuts
  const panelOpenRef = useRef(panelOpen);
  const selectedDetailRef = useRef(selectedDetail);
  useEffect(() => { panelOpenRef.current = panelOpen; }, [panelOpen]);
  useEffect(() => { selectedDetailRef.current = selectedDetail; }, [selectedDetail]);

  // Global keyboard shortcuts: Q = toggle database panel, E = toggle details panel
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
      if (e.key.toLowerCase() === "q") {
        setDbPanelCollapsed((v) => !v);
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

  const syncLabel = useLastSyncLabel(lastSyncAt);

  // Build id→name and id→color lookups from the graph nodes
  const dbIdToName = useMemo(() => {
    const map: Record<string, string> = {};
    for (const node of initialGraph.nodes) {
      if (!map[node.databaseId]) map[node.databaseId] = node.databaseName;
    }
    return map;
  }, [initialGraph.nodes]);

  const dbIdToColor = useMemo(() => {
    const map: Record<string, string> = {};
    for (const node of coloredGraph.nodes) {
      if (!map[node.databaseId]) map[node.databaseId] = node.color;
    }
    return map;
  }, [coloredGraph.nodes]);

  return (
    <div style={{ width: "100%", height: "100%", position: "relative", overflow: "hidden" }}>
      {/* Parallax mountain background — visible when no database is selected */}
      <ParallaxMountainBg
        visible={enabledDbs.size === 0}
        showPrompt={enabledDbs.size === 0}
        onBackgroundClick={enabledDbs.size === 0 ? handleBackgroundClick : undefined}
      />

      {/* Full-screen graph */}
      <div style={{ position: "absolute", inset: 0, opacity: canvasOpacity, transition: "opacity 2s ease", pointerEvents: canvasOpacity === 0 ? "none" : "auto" }}>
        <GraphCanvas
          graph={filteredGraph}
          onSelectNode={handleSelectNode}
          selectedNodeId={selectedDetail?.id ?? null}
          sphereCenterText={showCenterText ? sphereCenterText : null}
          centerTextOpacity={centerTextOpacity}
          shape={shape}
          deepHighlight={deepHighlight}
          panelOpen={panelOpen}
        />
      </div>

      {/* Floating top-left wordmark — click to return home */}
      <div
        style={{
          position: "absolute",
          top: 20,
          left: 24,
          zIndex: 20,
        }}
        className="animate-fade-up"
      >
        <Link href="/" style={{ textDecoration: "none" }}>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-end",
              gap: 2,
              cursor: "pointer",
              opacity: 1,
              transition: "opacity 0.15s",
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.opacity = "0.7"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.opacity = "1"; }}
          >
            <span style={{
              fontFamily: "'Lora', Georgia, serif",
              fontSize: 20,
              fontWeight: 600,
              color: "var(--text-primary)",
              letterSpacing: "-0.01em",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/GraphIcon2.png" alt="Graph" style={{ width: 17, height: 17, objectFit: "contain" }} />
              Project Graph
            </span>
            <span style={{
              fontFamily: "'DM Mono', monospace",
              fontSize: 11,
              color: "var(--text-faint)",
              fontWeight: 300,
            }}>
              notion graph
            </span>
          </div>
        </Link>
      </div>

      <div
        style={{
          position: "absolute",
          top: 20,
          right: panelOpen ? 332 : 24,
          zIndex: 20,
          display: "flex",
          alignItems: "center",
          gap: 12,
          transition: "right 0.35s cubic-bezier(0.32, 0, 0.15, 1)",
        }}
        className="animate-fade-up"
      >
        {/* Dark mode toggle */}
        <button
          type="button"
          onClick={toggleDarkMode}
          title={darkMode ? "Switch to light mode" : "Switch to dark mode"}
          style={{
            width: 28,
            height: 28,
            borderRadius: 8,
            border: "1px solid var(--border-default)",
            background: "var(--panel-bg)",
            backdropFilter: "blur(12px)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 14,
            color: "var(--text-muted)",
            transition: "background 0.15s, color 0.15s, border-color 0.15s",
            boxShadow: "var(--shadow-sm)",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.background = "var(--bg-overlay)";
            (e.currentTarget as HTMLElement).style.color = "var(--text-primary)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.background = "var(--panel-bg)";
            (e.currentTarget as HTMLElement).style.color = "var(--text-muted)";
          }}
        >
          {darkMode ? "☀" : "◑"}
        </button>
      </div>

      {/* Floating bottom-left stats bar */}
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
        <span style={{
          fontFamily: "'DM Mono', monospace",
          fontSize: 11,
          color: "var(--text-muted)",
          fontWeight: 400,
        }}>
          {filteredGraph.nodes.length} / {initialGraph.nodes.length} nodes · {filteredGraph.edges.length} edges
        </span>
        <span style={{
          width: 1,
          height: 12,
          background: "var(--border-default)",
          display: "inline-block",
        }} />
        <span style={{
          fontFamily: "'DM Mono', monospace",
          fontSize: 11,
          color: "var(--text-faint)",
          fontWeight: 300,
        }}>
          synced {syncLabel}
        </span>
      </div>

      {/* Floating controls hint + settings */}
      <div
        style={{
          position: "absolute",
          bottom: 20,
          right: panelOpen ? 332 : 24,
          zIndex: 20,
          display: "flex",
          alignItems: "center",
          gap: 10,
          transition: "right 0.35s cubic-bezier(0.32, 0, 0.15, 1)",
        }}
        className="animate-fade-up"
      >
        {/* Settings panel trigger */}
        <SettingsPanel
          shape={shape}
          onShapeChange={setShape}
          deepHighlight={deepHighlight}
          onDeepHighlightChange={setDeepHighlight}
          showCenterText={showCenterText}
          onShowCenterTextChange={setShowCenterText}
          centerTextOpacity={centerTextOpacity}
          onCenterTextOpacityChange={setCenterTextOpacity}
        />

        {/* Controls hint bar */}
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          background: "var(--panel-bg)",
          backdropFilter: "blur(12px)",
          border: "1px solid var(--border-default)",
          borderRadius: 10,
          padding: "6px 14px",
          boxShadow: "var(--shadow-sm)",
        }}>
          {[
            ["scroll", "zoom"],
            ["drag", "rotate"],
            ["click", "select"],
          ].map(([key, action]) => (
            <span key={key} style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{
                fontFamily: "'DM Mono', monospace",
                fontSize: 10,
                color: "var(--text-primary)",
                background: "var(--bg-overlay)",
                border: "1px solid var(--border-default)",
                borderRadius: 4,
                padding: "1px 6px",
                fontWeight: 500,
              }}>{key}</span>
              <span style={{
                fontFamily: "'Geist', sans-serif",
                fontSize: 11,
                color: "var(--text-faint)",
              }}>{action}</span>
            </span>
          ))}
        </div>
      </div>


      {/* Database toggle panel */}
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
      />

      {/* Sliding details panel */}
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

      {/* Panel toggle tab — always visible on right-center edge */}
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
          width: 20,
          height: 56,
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
          transition: "right 0.35s cubic-bezier(0.32, 0, 0.15, 1), background 0.15s",
          padding: 0,
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.background = "var(--bg-overlay)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.background = "var(--panel-bg)";
        }}
      >
        <svg
          width="10"
          height="16"
          viewBox="0 0 10 16"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          style={{ flexShrink: 0 }}
        >
          <polyline
            points={panelOpen ? "3,2 8,8 3,14" : "7,2 2,8 7,14"}
            stroke={
              !panelOpen && selectedDetail !== null
                ? "#f97316"
                : "var(--text-muted)"
            }
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ transition: "stroke 0.2s" }}
          />
        </svg>
      </button>
    </div>
  );
}
