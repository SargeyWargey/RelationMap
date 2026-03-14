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
}: Props) {
  // Default position: bottom-left, above the floating stats bar
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const panelRef = useRef<HTMLDivElement>(null);
  const [openSubPanelDbId, setOpenSubPanelDbId] = useState<string | null>(null);

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

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    // Only drag on header
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    setDragging(true);
    dragOffset.current = {
      x: e.clientX - (pos?.x ?? 0),
      y: e.clientY - (pos?.y ?? 0),
    };
  }, [pos]);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      setPos({
        x: Math.max(0, Math.min(window.innerWidth - 200, e.clientX - dragOffset.current.x)),
        y: Math.max(0, Math.min(window.innerHeight - 80, e.clientY - dragOffset.current.y)),
      });
    };
    const onUp = () => setDragging(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragging]);

  if (allDatabaseIds.length === 0 || pos === null) return null;

  const enabledCount = allDatabaseIds.filter((id) => enabledDbs.has(id)).length;
  const schemaMap = Object.fromEntries(schemas.map((s) => [s.databaseId, s]));

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
        }}
        className="animate-fade-up"
      >
        {/* Header — drag handle */}
        <div
          onMouseDown={onMouseDown}
          style={{
            padding: "9px 14px 8px",
            borderBottom: "1px solid var(--border-subtle)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            cursor: dragging ? "grabbing" : "grab",
          }}
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
            {enabledCount}/{allDatabaseIds.length}
          </span>
        </div>

        {/* Database rows */}
        <div style={{ padding: "5px 0" }}>
          {allDatabaseIds.map((id) => {
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
