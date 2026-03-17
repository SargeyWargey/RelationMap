"use client";

import { useState, useRef, useCallback, useEffect } from "react";

import { FieldConfigPanel } from "@/components/FieldConfigPanel";
import type { DatabaseFieldConfig, DatabaseSchema } from "@/lib/types";

type Props = {
  allDatabaseIds: string[];
  dbIdToName: Record<string, string>;
  databaseColors: Record<string, string>;
  enabledDbs: Set<string>;
  onToggle: (id: string) => void;
  schemas?: DatabaseSchema[];
  fieldConfig?: Record<string, DatabaseFieldConfig>;
  onFieldConfigChange?: (dbId: string, cfg: DatabaseFieldConfig) => void;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  /** Increment to trigger two orange glow pulses on the panel */
  flashTrigger?: number;
  /** If provided, only show these database IDs in the panel */
  filterDbIds?: Set<string>;
};

export function DatabaseTogglePanel({
  allDatabaseIds,
  dbIdToName,
  databaseColors,
  enabledDbs,
  onToggle,
  schemas = [],
  fieldConfig = {},
  onFieldConfigChange,
  collapsed = false,
  onToggleCollapsed,
  flashTrigger = 0,
  filterDbIds,
}: Props) {
  // flashStep: 0=off, odd=glow-on, even(>0)=glow-off — two pulses
  const [flashStep, setFlashStep] = useState(0);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const hasDragged = useRef(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const [openSubPanelDbId, setOpenSubPanelDbId] = useState<string | null>(null);
  const prevExpandedPos = useRef<{ x: number; y: number } | null>(null);
  const posRef = useRef(pos);
  const collapsedRef = useRef(collapsed);

  // Keep posRef current so the collapsed effect can read latest pos
  useEffect(() => { posRef.current = pos; }, [pos]);

  // Flash two orange glow pulses when flashTrigger increments
  useEffect(() => {
    if (flashTrigger === 0) return;
    setFlashStep(1);
    const steps = [
      setTimeout(() => setFlashStep(0), 1500),
    ];
    return () => steps.forEach(clearTimeout);
  }, [flashTrigger]);

  // Initialize position once we know window size
  useEffect(() => {
    const leftMargin = 24;
    const bottomMargin = 20;
    const statusBarHeight = 48;
    const gapAboveStatusBar = 36;
    const estimatedRowHeight = 29;
    const estimatedPanelHeight = 58 + allDatabaseIds.length * estimatedRowHeight;
    const maxY = Math.max(0, window.innerHeight - 80);
    const targetY = window.innerHeight
      - bottomMargin
      - statusBarHeight
      - gapAboveStatusBar
      - estimatedPanelHeight;

    setPos({
      x: leftMargin,
      y: Math.max(0, Math.min(maxY, targetY)),
    });
  }, [allDatabaseIds.length]);

  // Animate to/from collapsed position when collapsed prop changes
  useEffect(() => {
    const wasCollapsed = collapsedRef.current;
    collapsedRef.current = collapsed;
    if (wasCollapsed === collapsed) return;

    if (collapsed) {
      // Save current expanded position before moving
      if (posRef.current !== null) {
        prevExpandedPos.current = { ...posRef.current };
      }
      // Move to bottom-left above the stats bar
      // Stats bar: bottom=20, height≈34px. Add 8px gap. Pill height≈34px.
      const collapsedY = window.innerHeight - 20 - 34 - 8 - 34;
      setPos({ x: 24, y: Math.max(4, collapsedY) });
    } else {
      // Restore previous expanded position
      if (prevExpandedPos.current) {
        setPos(prevExpandedPos.current);
      }
    }
  }, [collapsed]);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (collapsed) return;
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    hasDragged.current = false;
    setDragging(true);
    dragOffset.current = {
      x: e.clientX - (pos?.x ?? 0),
      y: e.clientY - (pos?.y ?? 0),
    };
  }, [pos, collapsed]);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      hasDragged.current = true;
      setPos({
        x: Math.max(0, Math.min(window.innerWidth - 200, e.clientX - dragOffset.current.x)),
        y: Math.max(0, Math.min(window.innerHeight - 80, e.clientY - dragOffset.current.y)),
      });
    };
    const onUp = () => {
      setDragging(false);
      // If no drag movement happened, treat as a click → collapse
      if (!hasDragged.current) {
        onToggleCollapsed?.();
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragging, onToggleCollapsed]);

  const visibleIds = filterDbIds
    ? allDatabaseIds.filter((id) => filterDbIds.has(id))
    : allDatabaseIds;

  if (visibleIds.length === 0 || pos === null) return null;

  const enabledCount = visibleIds.filter((id) => enabledDbs.has(id)).length;
  const schemaMap = Object.fromEntries(schemas.map((s) => [s.databaseId, s]));

  const glowOn = flashStep === 1;
  const glowStyle = {
    outline: glowOn ? "1px solid rgba(224,122,53,0.45)" : "1px solid transparent",
    filter: glowOn
      ? "drop-shadow(0 0 10px rgba(224,122,53,0.28)) drop-shadow(0 0 4px rgba(224,122,53,0.18))"
      : "none",
    transition: glowOn
      ? "outline 0.3s ease, filter 0.3s ease"
      : "outline 1.2s ease, filter 1.2s ease",
  };

  // Collapsed pill — same visual style as the bottom stats bar
  if (collapsed) {
    return (
      <div
        style={{
          position: "fixed",
          left: pos.x,
          top: pos.y,
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
          cursor: "pointer",
          userSelect: "none",
          transition: "left 0.3s cubic-bezier(0.32, 0, 0.15, 1), top 0.3s cubic-bezier(0.32, 0, 0.15, 1)",
          ...glowStyle,
        }}
        onClick={onToggleCollapsed}
        title="Expand databases panel"
      >
        <span style={{
          fontFamily: "'DM Mono', monospace",
          fontSize: 11,
          color: "var(--text-muted)",
          fontWeight: 400,
        }}>
          databases
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
          color: enabledCount > 0 ? "var(--accent-gold)" : "var(--text-faint)",
          fontWeight: 300,
        }}>
          {enabledCount}/{visibleIds.length}
        </span>
      </div>
    );
  }

  return (
    <>
      <div
        ref={panelRef}
        style={{
          position: "fixed",
          left: pos.x,
          top: pos.y,
          zIndex: 20,
          width: 188,
          background: "var(--panel-bg)",
          backdropFilter: "blur(14px)",
          border: "1px solid var(--border-default)",
          borderRadius: 12,
          boxShadow: "var(--shadow-md)",
          overflow: "hidden",
          userSelect: "none",
          transition: "left 0.3s cubic-bezier(0.32, 0, 0.15, 1), top 0.3s cubic-bezier(0.32, 0, 0.15, 1)",
          ...glowStyle,
        }}
        className="animate-fade-up"
      >
        {/* Header — drag handle + click to collapse */}
        <div
          onMouseDown={onMouseDown}
          style={{
            padding: "9px 14px 8px",
            borderBottom: "1px solid var(--border-subtle)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            cursor: dragging ? "grabbing" : "pointer",
          }}
          title="Drag to move · click to collapse"
        >
          <span
            className={enabledCount === 0 ? "animate-text-flash" : undefined}
            style={{
              fontFamily: "'DM Mono', monospace",
              fontSize: 10,
              fontWeight: 500,
              letterSpacing: "0.07em",
              color: "var(--text-faint)",
              textTransform: "uppercase",
            }}
          >
            Databases
          </span>
          <span style={{
            fontFamily: "'DM Mono', monospace",
            fontSize: 10,
            color: enabledCount > 0 ? "var(--accent-gold)" : "var(--text-faint)",
            fontWeight: 400,
          }}>
            {enabledCount}/{visibleIds.length}
          </span>
        </div>

        {/* Database rows */}
        <div style={{ padding: "5px 0" }}>
          {visibleIds.map((id) => {
            const enabled = enabledDbs.has(id);
            const name = dbIdToName[id] ?? id;
            const color = databaseColors[id] ?? "#888";
            const hasSchema = !!schemaMap[id];
            const isSubOpen = openSubPanelDbId === id;

            return (
              <div
                key={id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  width: "100%",
                }}
              >
                <button
                  type="button"
                  onClick={() => onToggle(id)}
                  title={name}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 9,
                    flex: 1,
                    padding: "6px 8px 6px 14px",
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    textAlign: "left",
                    transition: "background 0.12s",
                    minWidth: 0,
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.background = "var(--bg-overlay)";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.background = "transparent";
                  }}
                >
                  <span style={{
                    flexShrink: 0,
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: enabled ? color : "var(--border-default)",
                    boxShadow: enabled ? `0 0 6px ${color}99` : "none",
                    transition: "background 0.2s, box-shadow 0.2s",
                  }} />
                  <span style={{
                    fontFamily: "'Geist', sans-serif",
                    fontSize: 12,
                    color: enabled ? "var(--text-secondary)" : "var(--text-faint)",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    transition: "color 0.2s",
                    opacity: enabled ? 1 : 0.5,
                  }}>
                    {name}
                  </span>
                </button>

                {hasSchema && (
                  <button
                    type="button"
                    title="Configure fields"
                    onClick={() => setOpenSubPanelDbId(isSubOpen ? null : id)}
                    style={{
                      flexShrink: 0,
                      width: 24,
                      height: 24,
                      marginRight: 6,
                      background: isSubOpen ? "var(--bg-overlay)" : "transparent",
                      border: isSubOpen ? "1px solid var(--border-default)" : "1px solid transparent",
                      borderRadius: 5,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: isSubOpen ? "var(--text-secondary)" : "var(--text-faint)",
                      fontSize: 13,
                      transition: "color 0.15s, background 0.15s, border-color 0.15s",
                      transform: isSubOpen ? "rotate(90deg)" : "none",
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.color = "var(--text-secondary)";
                      (e.currentTarget as HTMLElement).style.background = "var(--bg-overlay)";
                    }}
                    onMouseLeave={(e) => {
                      if (!isSubOpen) {
                        (e.currentTarget as HTMLElement).style.color = "var(--text-faint)";
                        (e.currentTarget as HTMLElement).style.background = "transparent";
                      }
                    }}
                  >
                    ›
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer hint */}
        <div style={{
          padding: "5px 14px 8px",
          borderTop: "1px solid var(--border-subtle)",
        }}>
          <span
            className={enabledCount === 0 ? "animate-text-flash" : undefined}
            style={{
              fontFamily: "'Geist', sans-serif",
              fontSize: 10,
              color: "var(--text-faint)",
              lineHeight: 1.4,
            }}
          >
            {enabledCount === 0
              ? "Click to load a database"
              : "Click to toggle visibility"}
          </span>
        </div>
      </div>

      {/* Field config sub-panel */}
      {openSubPanelDbId && schemaMap[openSubPanelDbId] && (
        <FieldConfigPanel
          schema={schemaMap[openSubPanelDbId]}
          config={fieldConfig[openSubPanelDbId] ?? null}
          defaultColor={databaseColors[openSubPanelDbId] ?? "#888888"}
          anchorLeft={pos.x + 196}
          anchorTop={pos.y}
          onClose={() => setOpenSubPanelDbId(null)}
          onChange={(cfg) => {
            onFieldConfigChange?.(openSubPanelDbId, cfg);
          }}
        />
      )}
    </>
  );
}
