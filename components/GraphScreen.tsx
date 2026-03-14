"use client";

import { useState, useMemo, useCallback, useEffect } from "react";

import { GraphCanvas, type ShapeLayout } from "@/components/GraphCanvas";
import { DatabaseTogglePanel } from "@/components/DatabaseTogglePanel";
import { NodeDetailsPanel } from "@/components/NodeDetailsPanel";
import { SettingsPanel } from "@/components/SettingsPanel";
import type { DatabaseFieldConfig, DatabaseSchema, GraphData, NodeDetail } from "@/lib/types";

type Props = {
  initialGraph: GraphData;
  databaseColors: Record<string, string>;
  lastSyncAt?: string;
  warnings?: string[];
};

export function GraphScreen({ initialGraph, lastSyncAt, warnings }: Props) {
  const [selectedDetail, setSelectedDetail] = useState<NodeDetail | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [shape, setShape] = useState<ShapeLayout>("sphere");

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

  // Dark mode — persisted in localStorage
  const [darkMode, setDarkMode] = useState<boolean>(false);

  useEffect(() => {
    // Hydrate from localStorage after mount to avoid SSR mismatch
    const stored = localStorage.getItem("theme");
    if (stored === "dark") setDarkMode(true);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", darkMode ? "dark" : "light");
    localStorage.setItem("theme", darkMode ? "dark" : "light");
  }, [darkMode]);

  // Warnings are dismissible
  const [warningsDismissed, setWarningsDismissed] = useState(false);

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

  // Filtered graph — enabled databases + active field filters
  const filteredGraph = useMemo(() => {
    if (enabledDbs.size === 0) return { ...initialGraph, nodes: [], edges: [] };
    const nodes = initialGraph.nodes.filter((n) => {
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
    return { ...initialGraph, nodes, edges };
  }, [initialGraph, enabledDbs, fieldConfig]);

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
    setPanelOpen(detail !== null);
  }, []);

  const handleClose = useCallback(() => {
    setPanelOpen(false);
    setTimeout(() => setSelectedDetail(null), 350);
  }, []);

  const syncLabel = lastSyncAt ? new Date(lastSyncAt).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit"
  }) : "Never";

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
    for (const node of initialGraph.nodes) {
      if (!map[node.databaseId]) map[node.databaseId] = node.color;
    }
    return map;
  }, [initialGraph.nodes]);

  return (
    <div style={{ width: "100%", height: "100%", position: "relative", overflow: "hidden" }}>
      {/* Full-screen graph */}
      <GraphCanvas
        graph={filteredGraph}
        onSelectNode={handleSelectNode}
        selectedNodeId={selectedDetail?.id ?? null}
        sphereCenterText={sphereCenterText}
        shape={shape}
        deepHighlight={deepHighlight}
        panelOpen={panelOpen}
      />

      {/* Floating top-left wordmark */}
      <div
        style={{
          position: "absolute",
          top: 20,
          left: 24,
          zIndex: 20,
        }}
        className="animate-fade-up"
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            gap: 2,
            pointerEvents: "none",
          }}
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
            <img src="/bean.png" alt="Bean" style={{ width: 24, height: 24, objectFit: "contain" }} />
            Project Ground Control
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
        {/* Settings panel */}
        <SettingsPanel
          shape={shape}
          onShapeChange={setShape}
          deepHighlight={deepHighlight}
          onDeepHighlightChange={setDeepHighlight}
        />

        {/* Dark mode toggle */}
        <button
          type="button"
          onClick={() => setDarkMode((d) => !d)}
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

      {/* Floating controls hint */}
      <div
        style={{
          position: "absolute",
          bottom: 20,
          right: panelOpen ? 332 : 24,
          zIndex: 20,
          display: "flex",
          alignItems: "center",
          gap: 10,
          background: "var(--panel-bg)",
          backdropFilter: "blur(12px)",
          border: "1px solid var(--border-default)",
          borderRadius: 10,
          padding: "6px 14px",
          boxShadow: "var(--shadow-sm)",
          transition: "right 0.35s cubic-bezier(0.32, 0, 0.15, 1)",
        }}
        className="animate-fade-up"
      >
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

      {/* Warnings toast — dismissible */}
      {warnings && warnings.length > 0 && !warningsDismissed && (
        <div
          style={{
            position: "absolute",
            top: 20,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 30,
            background: "rgba(196, 146, 58, 0.12)",
            border: "1px solid rgba(196, 146, 58, 0.4)",
            borderRadius: 10,
            padding: "8px 12px 8px 16px",
            backdropFilter: "blur(12px)",
            maxWidth: 480,
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
          }}
          className="animate-fade-up"
        >
          <div style={{ flex: 1 }}>
            {warnings.map((w) => (
              <p key={w} style={{
                margin: 0,
                fontFamily: "'Geist', sans-serif",
                fontSize: 12,
                color: "var(--accent-gold)",
              }}>{w}</p>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setWarningsDismissed(true)}
            style={{
              flexShrink: 0,
              width: 20,
              height: 20,
              background: "transparent",
              border: "none",
              cursor: "pointer",
              color: "rgba(196, 146, 58, 0.7)",
              fontSize: 14,
              lineHeight: "1",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 4,
              padding: 0,
              marginTop: 1,
              transition: "color 0.15s",
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--accent-gold)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "rgba(196, 146, 58, 0.7)"; }}
            aria-label="Dismiss warnings"
          >
            ×
          </button>
        </div>
      )}

      {/* Database toggle panel — right side */}
      <DatabaseTogglePanel
        allDatabaseIds={allDatabaseIds}
        dbIdToName={dbIdToName}
        databaseColors={dbIdToColor}
        enabledDbs={enabledDbs}
        onToggle={toggleDb}
        schemas={schemas}
        fieldConfig={fieldConfig}
        onFieldConfigChange={handleFieldConfigChange}
      />

      {/* Sliding details panel */}
      <NodeDetailsPanel
        detail={selectedDetail}
        open={panelOpen}
        onClose={handleClose}
        onSelectNode={handleSelectNode}
        allNodes={initialGraph.nodes}
        allEdges={initialGraph.edges}
        enabledDbs={enabledDbs}
        schemas={schemas}
        fieldConfig={fieldConfig}
      />
    </div>
  );
}
