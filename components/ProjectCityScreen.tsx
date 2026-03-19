"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import Link from "next/link";

import { CityCanvas } from "@/components/CityCanvas";
import { ParallaxMountainBg } from "@/components/ParallaxMountainBg";
import { DatabaseTogglePanel } from "@/components/DatabaseTogglePanel";
import { NodeDetailsPanel } from "@/components/NodeDetailsPanel";
import { useTheme } from "@/components/ThemeProvider";
import { useLastSyncLabel } from "@/lib/useLastSyncLabel";
import type { DatabaseFieldConfig, DatabaseSchema, GraphData, NodeDetail } from "@/lib/types";

type Props = {
  initialGraph: GraphData;
  databaseColors: Record<string, string>;
  lastSyncAt?: string;
};

function FitViewIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M6 2H2V6M10 2H14V6M14 10V14H10M6 14H2V10"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M2 6L5 3M14 6L11 3M14 10L11 13M2 10L5 13"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ProjectCityScreen({ initialGraph, databaseColors, lastSyncAt }: Props) {
  const { darkMode, toggleDarkMode } = useTheme();

  // Icon / canvas fade state
  const [showIcon, setShowIcon] = useState(true);
  const [iconOpacity, setIconOpacity] = useState(1);
  const [canvasOpacity, setCanvasOpacity] = useState(0);
  const wasEmptyRef = useRef(true);

  const [selectedDetail, setSelectedDetail] = useState<NodeDetail | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [firstPerson, setFirstPerson] = useState(false);
  const [flyover, setFlyover] = useState(false);
  const [fitSceneTrigger, setFitSceneTrigger] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showLabelsFP, setShowLabelsFP] = useState(true);
  const [showLabelsOverhead, setShowLabelsOverhead] = useState(false);
  const [showClickLabels, setShowClickLabels] = useState(true);
  const [flyoverLabelMode, setFlyoverLabelMode] = useState<'none' | 'overhead' | 'center'>(() => {
    if (typeof window !== 'undefined') {
      const v = localStorage.getItem('city_flyover_label_mode');
      if (v === 'overhead' || v === 'center') return v;
    }
    return 'none';
  });
  const [flyoverSpeedMult, setFlyoverSpeedMult] = useState(() => {
    if (typeof window !== 'undefined') {
      const v = parseFloat(localStorage.getItem('city_flyover_speed') ?? '');
      if (!isNaN(v)) return v;
    }
    return 1.0;
  });
  const [flyoverArcHeightMult, setFlyoverArcHeightMult] = useState(() => {
    if (typeof window !== 'undefined') {
      const v = parseFloat(localStorage.getItem('city_flyover_arc') ?? '');
      if (!isNaN(v)) return v;
    }
    return 1.0;
  });
  const [flyoverCameraHeightOffset, setFlyoverCameraHeightOffset] = useState(() => {
    if (typeof window !== 'undefined') {
      const v = parseFloat(localStorage.getItem('city_flyover_cam_height') ?? '');
      if (!isNaN(v)) return v;
    }
    return 1.5;
  });
  const [jumpEnabled, setJumpEnabled] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('city_jump_enabled') !== 'false';
    }
    return true;
  });
  const [webEnabled, setWebEnabled] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('city_web_enabled') === 'true';
    }
    return false;
  });
  const [showConnectors, setShowConnectors] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('city_show_connectors') !== 'false';
    }
    return true;
  });

  // Schemas + field config
  const [schemas, setSchemas] = useState<DatabaseSchema[]>([]);
  const [fieldConfig, setFieldConfig] = useState<Record<string, DatabaseFieldConfig>>({});

  useEffect(() => {
    fetch("/api/schemas").then((r) => r.json()).then(setSchemas).catch(() => {});
    fetch("/api/field-config").then((r) => r.json()).then(setFieldConfig).catch(() => {});
  }, []);

  useEffect(() => { localStorage.setItem('city_flyover_label_mode', flyoverLabelMode); }, [flyoverLabelMode]);
  useEffect(() => { localStorage.setItem('city_flyover_speed', String(flyoverSpeedMult)); }, [flyoverSpeedMult]);
  useEffect(() => { localStorage.setItem('city_flyover_arc', String(flyoverArcHeightMult)); }, [flyoverArcHeightMult]);
  useEffect(() => { localStorage.setItem('city_flyover_cam_height', String(flyoverCameraHeightOffset)); }, [flyoverCameraHeightOffset]);
  useEffect(() => { localStorage.setItem('city_jump_enabled', String(jumpEnabled)); }, [jumpEnabled]);
  useEffect(() => { localStorage.setItem('city_web_enabled', String(webEnabled)); }, [webEnabled]);
  useEffect(() => { localStorage.setItem('city_show_connectors', String(showConnectors)); }, [showConnectors]);

  function handleFieldConfigChange(dbId: string, cfg: DatabaseFieldConfig) {
    const next = { ...fieldConfig, [dbId]: cfg };
    setFieldConfig(next);
    fetch("/api/field-config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(next),
    }).catch(() => {});
  }

  // Database toggles — all off by default
  const allDatabaseIds = useMemo(
    () => Array.from(new Set(initialGraph.nodes.map((n) => n.databaseId))),
    [initialGraph.nodes],
  );
  const [enabledDbs, setEnabledDbs] = useState<Set<string>>(() => new Set());

  function toggleDb(id: string) {
    setEnabledDbs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const coloredGraph = useMemo(() => {
    const nodes = initialGraph.nodes.map((node) => ({
      ...node,
      color: fieldConfig[node.databaseId]?.databaseColor ?? databaseColors[node.databaseId] ?? node.color,
    }));
    return { ...initialGraph, nodes };
  }, [initialGraph, fieldConfig, databaseColors]);

  // Filtered graph
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

  // Fade icon out / canvas in when databases are toggled
  useEffect(() => {
    const isEmpty = enabledDbs.size === 0;
    if (wasEmptyRef.current && !isEmpty) {
      // empty → has nodes
      wasEmptyRef.current = false;
      setCanvasOpacity(1);
      setIconOpacity(0);
      const timer = setTimeout(() => setShowIcon(false), 2000);
      return () => clearTimeout(timer);
    }
    if (!wasEmptyRef.current && isEmpty) {
      // has nodes → empty
      wasEmptyRef.current = true;
      setCanvasOpacity(0);
      setIconOpacity(0);
      setShowIcon(true);
      requestAnimationFrame(() => setIconOpacity(1));
    }
  }, [enabledDbs.size]);

  const handleSelectNode = useCallback((detail: NodeDetail | null) => {
    setSelectedDetail(detail);
  }, []);

  const handleClose = useCallback(() => {
    setPanelOpen(false);
    setTimeout(() => setSelectedDetail(null), 350);
  }, []);

  const handleFitScene = useCallback(() => {
    setFirstPerson(false);
    setFlyover(false);
    setFitSceneTrigger((v) => v + 1);
  }, []);

  const canToggleFlyover = !!selectedDetail || flyover;

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

  return (
    <div style={{ width: "100%", height: "100%", position: "relative", overflow: "hidden" }}>

      {/* Parallax mountain background — visible when no database is selected */}
      <ParallaxMountainBg
        visible={enabledDbs.size === 0}
        showPrompt={enabledDbs.size === 0}
        onBackgroundClick={enabledDbs.size === 0 ? handleBackgroundClick : undefined}
      />

      {/* Full-screen 3D city */}
      <div style={{ position: "absolute", inset: 0, opacity: canvasOpacity, transition: "opacity 2s ease", pointerEvents: canvasOpacity === 0 ? "none" : "auto" }}>
        <CityCanvas
          graph={filteredGraph}
          onSelectNode={handleSelectNode}
          selectedNodeId={selectedDetail?.id ?? null}
          darkMode={darkMode}
          firstPerson={firstPerson}
          onExitFirstPerson={() => setFirstPerson(false)}
          showLabelsFP={showLabelsFP}
          showLabelsOverhead={showLabelsOverhead}
          showClickLabels={showClickLabels}
          flyover={flyover}
          flyoverLabelMode={flyoverLabelMode}
          flyoverSpeedMult={flyoverSpeedMult}
          flyoverArcHeightMult={flyoverArcHeightMult}
          flyoverCameraHeightOffset={flyoverCameraHeightOffset}
          onExitFlyover={() => setFlyover(false)}
          fitSceneTrigger={fitSceneTrigger}
          jumpEnabled={jumpEnabled}
          webEnabled={webEnabled}
          showConnectors={showConnectors}
        />
      </div>

      {/* Top-left wordmark */}
      <div
        style={{ position: "absolute", top: 20, left: 24, zIndex: 20 }}
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
              <img src="/CityLightMode.png" alt="City" style={{ width: 24, height: 24, objectFit: "contain" }} />
              Project City
            </span>
            <span style={{
              fontFamily: "'DM Mono', monospace",
              fontSize: 11,
              color: "var(--text-faint)",
              fontWeight: 300,
            }}>
              navigate your data
            </span>
          </div>
        </Link>
      </div>

      {/* Top-right controls: settings + dark mode */}
      <div
        style={{
          position: "absolute",
          top: 20,
          right: panelOpen ? 332 : 24,
          zIndex: 20,
          display: "flex",
          alignItems: "center",
          gap: 8,
          transition: "right 0.35s cubic-bezier(0.32, 0, 0.15, 1)",
        }}
        className="animate-fade-up"
      >
        <button
          type="button"
          onClick={handleFitScene}
          title="Fit all buildings in view"
          disabled={filteredGraph.nodes.length === 0}
          style={{
            width: 28,
            height: 28,
            borderRadius: 8,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: filteredGraph.nodes.length === 0 ? "var(--text-faint)" : "var(--text-muted)",
            background: "var(--panel-bg)",
            backdropFilter: "blur(12px)",
            border: "1px solid var(--border-default)",
            cursor: filteredGraph.nodes.length === 0 ? "default" : "pointer",
            boxShadow: "var(--shadow-sm)",
            opacity: filteredGraph.nodes.length === 0 ? 0.5 : 1,
            transition: "background 0.15s, color 0.15s, border-color 0.15s, opacity 0.15s",
            padding: 0,
          }}
          onMouseEnter={(e) => {
            if (filteredGraph.nodes.length === 0) return;
            (e.currentTarget as HTMLElement).style.background = "var(--bg-overlay)";
            (e.currentTarget as HTMLElement).style.color = "var(--accent-warm)";
            (e.currentTarget as HTMLElement).style.borderColor = "var(--accent-warm)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.background = "var(--panel-bg)";
            (e.currentTarget as HTMLElement).style.color = filteredGraph.nodes.length === 0 ? "var(--text-faint)" : "var(--text-muted)";
            (e.currentTarget as HTMLElement).style.borderColor = "var(--border-default)";
          }}
          aria-label="Fit all buildings in view"
        >
          <FitViewIcon />
        </button>

        {/* Settings button */}
        <div style={{ position: "relative" }}>
          <button
            type="button"
            onClick={() => setSettingsOpen((v) => !v)}
            title="Settings"
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              border: `1px solid ${settingsOpen ? "var(--text-faint)" : "var(--border-default)"}`,
              background: settingsOpen ? "var(--bg-overlay)" : "var(--panel-bg)",
              backdropFilter: "blur(12px)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 14,
              color: settingsOpen ? "var(--text-primary)" : "var(--text-muted)",
              transition: "background 0.15s, color 0.15s, border-color 0.15s",
              boxShadow: "var(--shadow-sm)",
            }}
            onMouseEnter={(e) => {
              if (!settingsOpen) {
                (e.currentTarget as HTMLElement).style.background = "var(--bg-overlay)";
                (e.currentTarget as HTMLElement).style.color = "var(--text-primary)";
              }
            }}
            onMouseLeave={(e) => {
              if (!settingsOpen) {
                (e.currentTarget as HTMLElement).style.background = "var(--panel-bg)";
                (e.currentTarget as HTMLElement).style.color = "var(--text-muted)";
              }
            }}
          >
            ⚙
          </button>

          {/* Settings dropdown */}
          {settingsOpen && (
            <div
              style={{
                position: "absolute",
                top: 36,
                right: 0,
                width: 230,
                background: "var(--panel-bg)",
                backdropFilter: "blur(20px) saturate(1.4)",
                border: "1px solid var(--border-default)",
                borderRadius: 10,
                boxShadow: "var(--shadow-sm)",
                padding: "10px 14px",
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              <span style={{
                fontFamily: "'DM Mono', monospace",
                fontSize: 10,
                color: "var(--text-faint)",
                fontWeight: 400,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
              }}>
                Street View
              </span>

              {/* Jump toggle */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: "var(--text-muted)" }}>Jump (space)</span>
                <button
                  type="button"
                  onClick={() => setJumpEnabled((v) => !v)}
                  style={{
                    width: 32, height: 17, borderRadius: 9, border: "none",
                    background: jumpEnabled ? "var(--text-faint)" : "var(--border-default)",
                    cursor: "pointer", position: "relative", transition: "background 0.15s", flexShrink: 0, padding: 0,
                  }}
                >
                  <div style={{
                    position: "absolute", top: 2, left: jumpEnabled ? 17 : 3,
                    width: 13, height: 13, borderRadius: "50%",
                    background: jumpEnabled ? "var(--text-primary)" : "var(--text-faint)",
                    transition: "left 0.15s, background 0.15s",
                  }} />
                </button>
              </div>

              {/* Web swing toggle */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: "var(--text-muted)" }}>Web swing (right-click)</span>
                <button
                  type="button"
                  onClick={() => setWebEnabled((v) => !v)}
                  style={{
                    width: 32, height: 17, borderRadius: 9, border: "none",
                    background: webEnabled ? "var(--text-faint)" : "var(--border-default)",
                    cursor: "pointer", position: "relative", transition: "background 0.15s", flexShrink: 0, padding: 0,
                  }}
                >
                  <div style={{
                    position: "absolute", top: 2, left: webEnabled ? 17 : 3,
                    width: 13, height: 13, borderRadius: "50%",
                    background: webEnabled ? "var(--text-primary)" : "var(--text-faint)",
                    transition: "left 0.15s, background 0.15s",
                  }} />
                </button>
              </div>

              {/* Connector lines toggle */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: "var(--text-muted)" }}>Connector lines</span>
                <button
                  type="button"
                  onClick={() => setShowConnectors((v) => !v)}
                  style={{
                    width: 32, height: 17, borderRadius: 9, border: "none",
                    background: showConnectors ? "var(--text-faint)" : "var(--border-default)",
                    cursor: "pointer", position: "relative", transition: "background 0.15s", flexShrink: 0, padding: 0,
                  }}
                >
                  <div style={{
                    position: "absolute", top: 2, left: showConnectors ? 17 : 3,
                    width: 13, height: 13, borderRadius: "50%",
                    background: showConnectors ? "var(--text-primary)" : "var(--text-faint)",
                    transition: "left 0.15s, background 0.15s",
                  }} />
                </button>
              </div>

              <span style={{
                fontFamily: "'DM Mono', monospace",
                fontSize: 10,
                color: "var(--text-faint)",
                fontWeight: 400,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
              }}>
                Building Labels
              </span>

              {/* Street view labels toggle */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{
                  fontFamily: "'DM Mono', monospace",
                  fontSize: 11,
                  color: "var(--text-muted)",
                }}>Street view</span>
                <button
                  type="button"
                  onClick={() => setShowLabelsFP((v) => !v)}
                  style={{
                    width: 32,
                    height: 17,
                    borderRadius: 9,
                    border: "none",
                    background: showLabelsFP ? "var(--text-faint)" : "var(--border-default)",
                    cursor: "pointer",
                    position: "relative",
                    transition: "background 0.15s",
                    flexShrink: 0,
                    padding: 0,
                  }}
                >
                  <div style={{
                    position: "absolute",
                    top: 2,
                    left: showLabelsFP ? 17 : 3,
                    width: 13,
                    height: 13,
                    borderRadius: "50%",
                    background: showLabelsFP ? "var(--text-primary)" : "var(--text-faint)",
                    transition: "left 0.15s, background 0.15s",
                  }} />
                </button>
              </div>

              {/* Overhead labels toggle */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{
                  fontFamily: "'DM Mono', monospace",
                  fontSize: 11,
                  color: "var(--text-muted)",
                }}>Overhead view</span>
                <button
                  type="button"
                  onClick={() => setShowLabelsOverhead((v) => !v)}
                  style={{
                    width: 32,
                    height: 17,
                    borderRadius: 9,
                    border: "none",
                    background: showLabelsOverhead ? "var(--text-faint)" : "var(--border-default)",
                    cursor: "pointer",
                    position: "relative",
                    transition: "background 0.15s",
                    flexShrink: 0,
                    padding: 0,
                  }}
                >
                  <div style={{
                    position: "absolute",
                    top: 2,
                    left: showLabelsOverhead ? 17 : 3,
                    width: 13,
                    height: 13,
                    borderRadius: "50%",
                    background: showLabelsOverhead ? "var(--text-primary)" : "var(--text-faint)",
                    transition: "left 0.15s, background 0.15s",
                  }} />
                </button>
              </div>

              <span style={{
                fontFamily: "'DM Mono', monospace",
                fontSize: 10,
                color: "var(--text-faint)",
                fontWeight: 400,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                marginTop: 2,
              }}>
                Click Labels
              </span>

              {/* Click-to-label toggle */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: "var(--text-muted)" }}>Show on click</span>
                <button
                  type="button"
                  onClick={() => setShowClickLabels((v) => !v)}
                  style={{
                    width: 32, height: 17, borderRadius: 9, border: "none",
                    background: showClickLabels ? "var(--text-faint)" : "var(--border-default)",
                    cursor: "pointer", position: "relative", transition: "background 0.15s", flexShrink: 0, padding: 0,
                  }}
                >
                  <div style={{
                    position: "absolute", top: 2, left: showClickLabels ? 17 : 3,
                    width: 13, height: 13, borderRadius: "50%",
                    background: showClickLabels ? "var(--text-primary)" : "var(--text-faint)",
                    transition: "left 0.15s, background 0.15s",
                  }} />
                </button>
              </div>

              <span style={{
                fontFamily: "'DM Mono', monospace", fontSize: 10, color: "var(--text-faint)",
                fontWeight: 400, textTransform: "uppercase", letterSpacing: "0.08em", marginTop: 2,
              }}>Flyover Labels</span>

              {/* Flyover label mode — three-way selector */}
              <div style={{ display: "flex", gap: 4 }}>
                {(['none', 'overhead', 'center'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setFlyoverLabelMode(mode)}
                    style={{
                      flex: 1,
                      fontFamily: "'DM Mono', monospace",
                      fontSize: 10,
                      padding: "3px 0",
                      borderRadius: 5,
                      border: `1px solid ${flyoverLabelMode === mode ? "var(--text-faint)" : "var(--border-default)"}`,
                      background: flyoverLabelMode === mode ? "var(--bg-overlay)" : "transparent",
                      color: flyoverLabelMode === mode ? "var(--text-primary)" : "var(--text-faint)",
                      cursor: "pointer",
                      transition: "background 0.15s, color 0.15s, border-color 0.15s",
                      letterSpacing: "0.03em",
                    }}
                  >
                    {mode}
                  </button>
                ))}
              </div>

              <span style={{
                fontFamily: "'DM Mono', monospace", fontSize: 10, color: "var(--text-faint)",
                fontWeight: 400, textTransform: "uppercase", letterSpacing: "0.08em", marginTop: 2,
              }}>Flyover Speed</span>

              {/* Flight speed */}
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                  <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: "var(--text-muted)" }}>Camera speed</span>
                  <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: "var(--text-faint)" }}>{flyoverSpeedMult.toFixed(2)}×</span>
                </div>
                <input type="range" min="0.25" max="3.0" step="0.05" value={flyoverSpeedMult}
                  onChange={(e) => setFlyoverSpeedMult(parseFloat(e.target.value))}
                  style={{ width: "100%", accentColor: "var(--text-faint)" }}
                />
              </div>

              {/* Orbit radius */}
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                  <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: "var(--text-muted)" }}>Orbit radius</span>
                  <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: "var(--text-faint)" }}>{flyoverArcHeightMult.toFixed(2)}×</span>
                </div>
                <input type="range" min="0.25" max="2.5" step="0.05" value={flyoverArcHeightMult}
                  onChange={(e) => setFlyoverArcHeightMult(parseFloat(e.target.value))}
                  style={{ width: "100%", accentColor: "var(--text-faint)" }}
                />
              </div>

              {/* Camera height */}
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                  <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: "var(--text-muted)" }}>Camera height</span>
                  <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: "var(--text-faint)" }}>
                    {flyoverCameraHeightOffset >= 0 ? "+" : ""}{flyoverCameraHeightOffset.toFixed(2)}×
                  </span>
                </div>
                <input type="range" min="-0.8" max="3.0" step="0.05" value={flyoverCameraHeightOffset}
                  onChange={(e) => setFlyoverCameraHeightOffset(parseFloat(e.target.value))}
                  style={{ width: "100%", accentColor: "var(--text-faint)" }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Dark mode button */}
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

      {/* Bottom-left stats bar */}
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
        <span style={{ width: 1, height: 12, background: "var(--border-default)", display: "inline-block" }} />
        <span style={{
          fontFamily: "'DM Mono', monospace",
          fontSize: 11,
          color: "var(--text-faint)",
          fontWeight: 300,
        }}>
          synced {syncLabel}
        </span>
      </div>

      {/* Bottom-right: street view toggle + controls hint */}
      <div
        style={{
          position: "absolute",
          bottom: 20,
          right: panelOpen ? 332 : 24,
          zIndex: 20,
          display: "flex",
          alignItems: "center",
          gap: 8,
          transition: "right 0.35s cubic-bezier(0.32, 0, 0.15, 1)",
        }}
        className="animate-fade-up"
      >
        {/* Street View toggle */}
        <button
          type="button"
          onClick={() => { setFirstPerson((v) => !v); setFlyover(false); }}
          title={firstPerson ? "Exit street view" : "Enter street view"}
          style={{
            fontFamily: "'DM Mono', monospace",
            fontSize: 11,
            color: firstPerson ? "var(--accent-warm)" : "var(--text-muted)",
            background: firstPerson ? "var(--bg-overlay)" : "var(--panel-bg)",
            backdropFilter: "blur(12px)",
            border: `1px solid ${firstPerson ? "var(--accent-warm)" : "var(--border-default)"}`,
            borderRadius: 8,
            padding: "5px 10px",
            cursor: "pointer",
            boxShadow: "var(--shadow-sm)",
            display: "flex",
            alignItems: "center",
            letterSpacing: "0.03em",
            transition: "background 0.2s, color 0.2s, border-color 0.2s",
          }}
          onMouseEnter={(e) => {
            if (firstPerson) return;
            (e.currentTarget as HTMLElement).style.background = "var(--bg-overlay)";
            (e.currentTarget as HTMLElement).style.color = "var(--text-primary)";
          }}
          onMouseLeave={(e) => {
            if (firstPerson) return;
            (e.currentTarget as HTMLElement).style.background = "var(--panel-bg)";
            (e.currentTarget as HTMLElement).style.color = "var(--text-muted)";
          }}
        >
          street view
        </button>

        {/* Flyover toggle */}
        <button
          type="button"
          onClick={() => {
            if (!canToggleFlyover) return; // no-op if nothing selected
            setFlyover((v) => !v);
            setFirstPerson(false);
          }}
          title={flyover ? "Exit flyover" : selectedDetail ? "Start flyover from selected node" : "Select a node to begin flyover"}
          style={{
            fontFamily: "'DM Mono', monospace",
            fontSize: 11,
            color: flyover ? "var(--accent-warm)" : "var(--text-muted)",
            background: flyover ? "var(--bg-overlay)" : "var(--panel-bg)",
            backdropFilter: "blur(12px)",
            border: `1px solid ${flyover ? "var(--accent-warm)" : "var(--border-default)"}`,
            borderRadius: 8,
            padding: "5px 10px",
            cursor: canToggleFlyover ? "pointer" : "default",
            boxShadow: "var(--shadow-sm)",
            display: "flex",
            alignItems: "center",
            letterSpacing: "0.03em",
            opacity: canToggleFlyover ? 1 : 0.5,
            transition: "opacity 0.15s, background 0.2s, color 0.2s, border-color 0.2s",
          }}
          onMouseEnter={(e) => {
            if (flyover || !canToggleFlyover) return;
            (e.currentTarget as HTMLElement).style.background = "var(--bg-overlay)";
            (e.currentTarget as HTMLElement).style.color = "var(--text-primary)";
          }}
          onMouseLeave={(e) => {
            if (flyover) return;
            (e.currentTarget as HTMLElement).style.background = "var(--panel-bg)";
            (e.currentTarget as HTMLElement).style.color = "var(--text-muted)";
          }}
        >
          flyover
        </button>

        {/* Controls hint — changes based on mode */}
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
          {(firstPerson
            ? [["W A S D", "move"], ["mouse", "look"], ["shift", "sprint"]]
            : flyover
              ? [["esc", "exit flyover"], ["click", "select & restart"]]
              : [["drag", "orbit"], ["right-drag", "pan"], ["scroll", "zoom"], ["click", "select"]]
          ).map(([key, label]) => (
            <span key={key} style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{
                fontFamily: "'DM Mono', monospace",
                fontSize: 10,
                color: "var(--text-faint)",
                background: "var(--bg-overlay)",
                border: "1px solid var(--border-default)",
                borderRadius: 4,
                padding: "1px 5px",
              }}>{key}</span>
              <span style={{
                fontFamily: "'DM Mono', monospace",
                fontSize: 10,
                color: "var(--text-faint)",
                fontWeight: 300,
              }}>{label}</span>
            </span>
          ))}
        </div>
      </div>

      {/* First-person HUD hint */}
      {firstPerson && (
        <div style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          pointerEvents: "none",
          zIndex: 10,
        }}>
          {/* Crosshair */}
          <div style={{
            width: 16, height: 16,
            position: "relative",
          }}>
            <div style={{ position: "absolute", top: "50%", left: 0, right: 0, height: 1, background: "rgba(255,255,255,0.5)", transform: "translateY(-50%)" }} />
            <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: "rgba(255,255,255,0.5)", transform: "translateX(-50%)" }} />
          </div>
        </div>
      )}

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

      {/* Side pull-tab — always visible at right edge, opens/closes the details panel */}
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

      {/* Node details panel */}
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
    </div>
  );
}
