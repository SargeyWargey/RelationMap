"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import Link from "next/link";

import { TimelineCanvas } from "@/components/TimelineCanvas";
import { DatabaseTogglePanel } from "@/components/DatabaseTogglePanel";
import { NodeDetailsPanel } from "@/components/NodeDetailsPanel";
import { useTheme } from "@/components/ThemeProvider";
import { useLastSyncLabel } from "@/lib/useLastSyncLabel";
import { buildPersonIndex } from "@/lib/timelineLayout";
import type { DatabaseFieldConfig, DatabaseSchema, GraphData, NodeDetail } from "@/lib/types";

type Props = {
  initialGraph: GraphData;
  databaseColors: Record<string, string>;
  lastSyncAt?: string;
};

export function ProjectTimelineScreen({ initialGraph, databaseColors, lastSyncAt }: Props) {
  const { darkMode, toggleDarkMode } = useTheme();

  const [selectedDetail, setSelectedDetail]   = useState<NodeDetail | null>(null);
  const [panelOpen, setPanelOpen]             = useState(false);
  const [settingsOpen, setSettingsOpen]       = useState(false);
  const [dbPanelCollapsed, setDbPanelCollapsed] = useState(false);
  const [dbPanelFlashTrigger, setDbPanelFlashTrigger] = useState(0);

  // Person picker state
  const [pickerOpen, setPickerOpen]           = useState(true);
  const [pickerSearch, setPickerSearch]       = useState("");
  const [activePersonKey, setActivePersonKey] = useState<string | null>(null);

  // Settings toggles (persisted with user_ prefix)
  const [showDbLabels, setShowDbLabels] = useState(() => {
    if (typeof window !== "undefined") {
      const v = localStorage.getItem("timeline_db_labels");
      if (v === "false") return false;
    }
    return true;
  });
  const [groupByDb, setGroupByDb] = useState(() => {
    if (typeof window !== "undefined") {
      const v = localStorage.getItem("timeline_group_by_db");
      if (v === "true") return true;
    }
    return false;
  });

  useEffect(() => { localStorage.setItem("timeline_db_labels",    String(showDbLabels)); }, [showDbLabels]);
  useEffect(() => { localStorage.setItem("timeline_group_by_db",  String(groupByDb)); },  [groupByDb]);

  // Schemas + field config
  const [schemas, setSchemas]         = useState<DatabaseSchema[]>([]);
  const [fieldConfig, setFieldConfig] = useState<Record<string, DatabaseFieldConfig>>({});

  // Only show databases that have at least one "people" type field
  const peopleDbIds = useMemo(() => {
    const ids = new Set<string>();
    for (const schema of schemas) {
      if (schema.fields.some((f) => f.type === "people")) {
        ids.add(schema.databaseId);
      }
    }
    return ids;
  }, [schemas]);

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

  // Database toggles
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

  const coloredGraph = useMemo(() => {
    const nodes = initialGraph.nodes.map((node) => ({
      ...node,
      color: fieldConfig[node.databaseId]?.databaseColor ?? databaseColors[node.databaseId] ?? node.color,
    }));
    return { ...initialGraph, nodes };
  }, [initialGraph, fieldConfig, databaseColors]);

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
    const edges   = initialGraph.edges.filter(
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

  // Person index for the picker list
  const personIndex = useMemo(
    () => buildPersonIndex(filteredGraph, fieldConfig, enabledDbs),
    [filteredGraph, fieldConfig, enabledDbs],
  );
  const sortedPersonKeys = useMemo(
    () => [...personIndex.keys()].sort((a, b) => a.localeCompare(b)),
    [personIndex],
  );

  const filteredPersonKeys = useMemo(() => {
    const q = pickerSearch.toLowerCase().trim();
    if (!q) return sortedPersonKeys;
    return sortedPersonKeys.filter((k) => {
      const entry = personIndex.get(k);
      return entry?.displayName.toLowerCase().includes(q);
    });
  }, [sortedPersonKeys, personIndex, pickerSearch]);

  // Stats
  const totalRecords = useMemo(
    () => [...personIndex.values()].reduce((sum, e) => sum + e.nodes.length, 0),
    [personIndex],
  );

  const handleSelectNode = useCallback((detail: NodeDetail | null) => {
    setSelectedDetail(detail);
  }, []);

  const handleClose = useCallback(() => {
    setPanelOpen(false);
    setTimeout(() => setSelectedDetail(null), 350);
  }, []);

  const handleBackgroundClick = useCallback(() => {
    if (enabledDbs.size === 0) setDbPanelFlashTrigger((v) => v + 1);
  }, [enabledDbs.size]);

  // Keyboard shortcuts
  const panelOpenRef       = useRef(panelOpen);
  const selectedDetailRef  = useRef(selectedDetail);
  useEffect(() => { panelOpenRef.current = panelOpen; },       [panelOpen]);
  useEffect(() => { selectedDetailRef.current = selectedDetail; }, [selectedDetail]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
      if (e.key.toLowerCase() === "q") {
        setDbPanelCollapsed((v) => !v);
      } else if (e.key.toLowerCase() === "p") {
        setPickerOpen((v) => !v);
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

      {/* Empty state background */}
      {enabledDbs.size === 0 && (
        <div
          onClick={handleBackgroundClick}
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            background: darkMode ? "var(--bg-base)" : "var(--bg-base)",
            cursor: "default",
            zIndex: 1,
          }}
        >
          <div style={{
            fontFamily: "'Lora', Georgia, serif",
            fontSize: 22,
            fontWeight: 600,
            color: "var(--text-faint)",
            marginBottom: 10,
          }}>
            select a database to begin
          </div>
          <div style={{
            fontFamily: "'DM Mono', monospace",
            fontSize: 11,
            color: "var(--text-faint)",
            opacity: 0.6,
          }}>
            configure a name field in each database to map records to people
          </div>
        </div>
      )}

      {/* Full-screen 3D canvas */}
      {enabledDbs.size > 0 && (
        <div style={{ position: "absolute", inset: 0 }}>
          <TimelineCanvas
            graph={filteredGraph}
            fieldConfig={fieldConfig}
            enabledDbs={enabledDbs}
            groupByDb={groupByDb}
            showDbLabels={showDbLabels}
            darkMode={darkMode}
            activePersonKey={activePersonKey}
            onSelectNode={handleSelectNode}
            onActivePersonChange={(key) => setActivePersonKey(key)}
            onAutoCollapse={() => setDbPanelCollapsed(true)}
          />
        </div>
      )}

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
              alignItems: "flex-start",
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
              <img src="/UserIcon.png" alt="User" style={{ width: 24, height: 24, objectFit: "contain" }} />
              Project Timeline
            </span>
            <span style={{
              fontFamily: "'DM Mono', monospace",
              fontSize: 11,
              color: "var(--text-faint)",
              fontWeight: 300,
            }}>
              explore your people
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
          gap: 8,
          transition: "right 0.35s cubic-bezier(0.32, 0, 0.15, 1)",
        }}
        className="animate-fade-up"
      >
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

          {settingsOpen && (
            <div
              style={{
                position: "absolute",
                top: 36,
                right: 0,
                width: 210,
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
                Display
              </span>

              {/* Database Labels toggle */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: "var(--text-muted)" }}>
                  Database labels
                </span>
                <button
                  type="button"
                  onClick={() => setShowDbLabels((v) => !v)}
                  style={{
                    width: 32, height: 17, borderRadius: 9, border: "none",
                    background: showDbLabels ? "var(--text-faint)" : "var(--border-default)",
                    cursor: "pointer", position: "relative", transition: "background 0.15s",
                    flexShrink: 0, padding: 0,
                  }}
                >
                  <div style={{
                    position: "absolute", top: 2,
                    left: showDbLabels ? 17 : 3,
                    width: 13, height: 13, borderRadius: "50%",
                    background: showDbLabels ? "var(--text-primary)" : "var(--text-faint)",
                    transition: "left 0.15s, background 0.15s",
                  }} />
                </button>
              </div>

              {/* Group by Database toggle */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: "var(--text-muted)" }}>
                  Group by database
                </span>
                <button
                  type="button"
                  onClick={() => setGroupByDb((v) => !v)}
                  style={{
                    width: 32, height: 17, borderRadius: 9, border: "none",
                    background: groupByDb ? "var(--text-faint)" : "var(--border-default)",
                    cursor: "pointer", position: "relative", transition: "background 0.15s",
                    flexShrink: 0, padding: 0,
                  }}
                >
                  <div style={{
                    position: "absolute", top: 2,
                    left: groupByDb ? 17 : 3,
                    width: 13, height: 13, borderRadius: "50%",
                    background: groupByDb ? "var(--text-primary)" : "var(--text-faint)",
                    transition: "left 0.15s, background 0.15s",
                  }} />
                </button>
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

      {/* Person picker panel — left side */}
      {enabledDbs.size > 0 && (
        <div
          style={{
            position: "absolute",
            top: 70,
            left: pickerOpen ? (dbPanelCollapsed ? 56 : 212) : 0,
            zIndex: 20,
            transition: "left 0.35s cubic-bezier(0.32, 0, 0.15, 1)",
          }}
        >
          {/* Toggle tab */}
          <button
            type="button"
            onClick={() => setPickerOpen((v) => !v)}
            title={pickerOpen ? "Collapse person list" : "Expand person list (P)"}
            style={{
              position: "absolute",
              top: 0,
              right: pickerOpen ? -20 : 0,
              width: 20,
              height: 56,
              background: "var(--panel-bg)",
              backdropFilter: "blur(12px)",
              border: "1px solid var(--panel-border)",
              borderLeft: pickerOpen ? "none" : undefined,
              borderRight: pickerOpen ? undefined : "none",
              borderRadius: pickerOpen ? "0 6px 6px 0" : "6px 0 0 6px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "var(--shadow-panel)",
              transition: "right 0.35s cubic-bezier(0.32, 0, 0.15, 1), background 0.15s",
              padding: 0,
              zIndex: 1,
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--bg-overlay)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--panel-bg)"; }}
          >
            <svg width="10" height="16" viewBox="0 0 10 16" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
              <polyline
                points={pickerOpen ? "7,2 2,8 7,14" : "3,2 8,8 3,14"}
                stroke="var(--text-muted)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>

          {pickerOpen && (
            <div
              style={{
                width: 200,
                maxHeight: "calc(100vh - 160px)",
                display: "flex",
                flexDirection: "column",
                background: "var(--panel-bg)",
                backdropFilter: "blur(20px) saturate(1.4)",
                border: "1px solid var(--panel-border)",
                borderRadius: "0 8px 8px 0",
                boxShadow: "var(--shadow-panel)",
                overflow: "hidden",
              }}
            >
              {/* Search */}
              <div style={{ padding: "10px 12px 8px", borderBottom: "1px solid var(--border-default)" }}>
                <input
                  type="text"
                  placeholder="search people…"
                  value={pickerSearch}
                  onChange={(e) => setPickerSearch(e.target.value)}
                  style={{
                    width: "100%",
                    fontFamily: "'DM Mono', monospace",
                    fontSize: 11,
                    color: "var(--text-primary)",
                    background: "var(--bg-overlay)",
                    border: "1px solid var(--border-default)",
                    borderRadius: 6,
                    padding: "5px 8px",
                    outline: "none",
                    boxSizing: "border-box",
                  }}
                />
              </div>

              {/* Person list */}
              <div style={{ overflowY: "auto", flex: 1 }}>
                {filteredPersonKeys.length === 0 ? (
                  <div style={{
                    padding: "16px 12px",
                    fontFamily: "'DM Mono', monospace",
                    fontSize: 11,
                    color: "var(--text-faint)",
                    textAlign: "center",
                  }}>
                    no people found
                  </div>
                ) : (
                  filteredPersonKeys.map((key) => {
                    const entry    = personIndex.get(key)!;
                    const isActive = key === activePersonKey;
                    // Avatar color — simple hue from key hash
                    const hue   = Math.round(
                      ((() => {
                        let h = 2166136261;
                        for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
                        return (h >>> 0) / 0xffffffff;
                      })()) * 360
                    );
                    const color = `hsl(${hue}, 45%, 52%)`;
                    const parts = entry.displayName.trim().split(/\s+/);
                    const inits = parts.length >= 2
                      ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
                      : entry.displayName.slice(0, 2).toUpperCase();

                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => { setActivePersonKey(key); setPickerOpen(false); setDbPanelCollapsed(true); }}
                        style={{
                          width: "100%",
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          padding: "7px 12px",
                          background: isActive ? "var(--bg-overlay)" : "transparent",
                          border: "none",
                          borderLeft: `2px solid ${isActive ? "var(--accent-warm)" : "transparent"}`,
                          cursor: "pointer",
                          textAlign: "left",
                          transition: "background 0.12s, border-color 0.12s",
                        }}
                        onMouseEnter={(e) => {
                          if (!isActive) (e.currentTarget as HTMLElement).style.background = "var(--bg-overlay)";
                        }}
                        onMouseLeave={(e) => {
                          if (!isActive) (e.currentTarget as HTMLElement).style.background = "transparent";
                        }}
                      >
                        {/* Avatar */}
                        <div style={{
                          width: 24,
                          height: 24,
                          borderRadius: "50%",
                          background: color,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontFamily: "'DM Mono', monospace",
                          fontSize: 9,
                          fontWeight: 500,
                          color: "#fff",
                          flexShrink: 0,
                        }}>
                          {inits}
                        </div>

                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{
                            fontFamily: "'DM Mono', monospace",
                            fontSize: 11,
                            fontWeight: isActive ? 500 : 400,
                            color: isActive ? "var(--text-primary)" : "var(--text-muted)",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}>
                            {entry.displayName}
                          </div>
                          <div style={{
                            fontFamily: "'DM Mono', monospace",
                            fontSize: 9,
                            color: "var(--text-faint)",
                            fontWeight: 300,
                          }}>
                            {entry.nodes.length} record{entry.nodes.length !== 1 ? "s" : ""}
                          </div>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>
      )}

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
          {sortedPersonKeys.length} people · {totalRecords} records
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

      {/* Bottom-right controls hint */}
      <div
        style={{
          position: "absolute",
          bottom: 20,
          right: panelOpen ? 332 : 24,
          zIndex: 20,
          transition: "right 0.35s cubic-bezier(0.32, 0, 0.15, 1)",
        }}
        className="animate-fade-up"
      >
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
            ["↑ ↓ / scroll", "change person"],
            ["← → scroll", "pan timeline"],
            ["click", "select record"],
            ["P", "person list"],
          ].map(([key, label]) => (
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

      {/* Database toggle panel — only shows databases with a "people" field */}
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
        filterDbIds={peopleDbIds.size > 0 ? peopleDbIds : undefined}
      />

      {/* Side pull-tab (node details) */}
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
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--bg-overlay)"; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--panel-bg)"; }}
      >
        <svg width="10" height="16" viewBox="0 0 10 16" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
          <polyline
            points={panelOpen ? "3,2 8,8 3,14" : "7,2 2,8 7,14"}
            stroke={!panelOpen && selectedDetail !== null ? "#f97316" : "var(--text-muted)"}
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
