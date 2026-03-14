"use client";

import type { DatabaseField, DatabaseFieldConfig, DatabaseSchema } from "@/lib/types";

// Notion color name → CSS color
const NOTION_COLORS: Record<string, string> = {
  default: "#9ca3af",
  gray: "#9ca3af",
  brown: "#a37764",
  orange: "#f97316",
  yellow: "#eab308",
  green: "#22c55e",
  blue: "#3b82f6",
  purple: "#a855f7",
  pink: "#ec4899",
  red: "#ef4444",
};

function notionColor(name: string): string {
  return NOTION_COLORS[name] ?? NOTION_COLORS.default;
}

const FILTERABLE_TYPES = new Set(["select", "multi_select", "status"]);
const TEXT_TYPES = new Set(["rich_text", "title"]);
const SKIP_PANEL_TYPES = new Set(["relation", "formula", "rollup", "title"]);

function buildDefaultConfig(schema: DatabaseSchema): DatabaseFieldConfig {
  const panelVisible: Record<string, boolean> = {};
  let sphereField: string | null = null;

  for (const field of schema.fields) {
    if (SKIP_PANEL_TYPES.has(field.type)) continue;
    panelVisible[field.name] = true;
    if (!sphereField && field.name.toLowerCase() === "description" && TEXT_TYPES.has(field.type)) {
      sphereField = field.name;
    }
  }

  return { panelVisible, sphereField, activeFilters: {} };
}

type Props = {
  schema: DatabaseSchema;
  config: DatabaseFieldConfig | null;
  anchorLeft: number;
  anchorTop: number;
  onClose: () => void;
  onChange: (cfg: DatabaseFieldConfig) => void;
};

export function FieldConfigPanel({ schema, config, anchorLeft, anchorTop, onClose, onChange }: Props) {
  const cfg = config ?? buildDefaultConfig(schema);

  function toggleFilter(fieldName: string, optionName: string) {
    const current = cfg.activeFilters[fieldName] ?? [];
    const next = current.includes(optionName)
      ? current.filter((v) => v !== optionName)
      : [...current, optionName];
    onChange({ ...cfg, activeFilters: { ...cfg.activeFilters, [fieldName]: next } });
  }

  function togglePanelVisible(fieldName: string) {
    onChange({
      ...cfg,
      panelVisible: { ...cfg.panelVisible, [fieldName]: !(cfg.panelVisible[fieldName] ?? true) },
    });
  }

  function setSphereField(fieldName: string) {
    onChange({ ...cfg, sphereField: cfg.sphereField === fieldName ? null : fieldName });
  }

  const displayFields = schema.fields.filter(
    (f) => !SKIP_PANEL_TYPES.has(f.type) && f.type !== "created_by" && f.type !== "last_edited_by"
  );

  return (
    <div
      style={{
        position: "fixed",
        left: anchorLeft,
        top: anchorTop,
        zIndex: 21,
        width: 280,
        maxHeight: "80vh",
        overflowY: "auto",
        background: "var(--panel-bg)",
        backdropFilter: "blur(14px)",
        border: "1px solid var(--border-default)",
        borderRadius: 12,
        boxShadow: "var(--shadow-md)",
        userSelect: "none",
      }}
      className="animate-fade-up"
    >
      {/* Header */}
      <div style={{
        padding: "9px 12px 8px",
        borderBottom: "1px solid var(--border-subtle)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}>
        <span style={{
          fontFamily: "'DM Mono', monospace",
          fontSize: 10,
          fontWeight: 500,
          letterSpacing: "0.07em",
          color: "var(--text-faint)",
          textTransform: "uppercase",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          maxWidth: 200,
        }}>
          {schema.databaseName} — Fields
        </span>
        <button
          type="button"
          onClick={onClose}
          style={{
            flexShrink: 0,
            width: 20,
            height: 20,
            background: "transparent",
            border: "none",
            cursor: "pointer",
            color: "var(--text-faint)",
            fontSize: 14,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 4,
            padding: 0,
            transition: "color 0.15s",
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--text-primary)"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--text-faint)"; }}
          aria-label="Close"
        >
          ✕
        </button>
      </div>

      {/* Legend row */}
      <div style={{
        padding: "5px 12px 4px",
        display: "flex",
        justifyContent: "flex-end",
        gap: 8,
        borderBottom: "1px solid var(--border-subtle)",
      }}>
        <span style={{ fontFamily: "'Geist', sans-serif", fontSize: 10, color: "var(--text-faint)" }} title="Show in side panel">👁</span>
        <span style={{ fontFamily: "'Geist', sans-serif", fontSize: 10, color: "var(--text-faint)" }} title="Show in sphere center">💠</span>
      </div>

      {/* Fields */}
      <div style={{ padding: "4px 0 6px" }}>
        {displayFields.map((field, idx) => {
          const isFilterable = FILTERABLE_TYPES.has(field.type);
          const isText = TEXT_TYPES.has(field.type);
          const panelOn = cfg.panelVisible[field.name] ?? true;
          const isSphere = cfg.sphereField === field.name;
          const activeFilters = cfg.activeFilters[field.name] ?? [];

          return (
            <div key={field.id}>
              {idx > 0 && (
                <div style={{ height: 1, background: "var(--border-subtle)", margin: "2px 12px" }} />
              )}

              {/* Field row */}
              <div style={{
                display: "flex",
                alignItems: "center",
                padding: "5px 12px",
                gap: 8,
              }}>
                {/* Field name + type */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{
                    fontFamily: "'Geist', sans-serif",
                    fontSize: 12,
                    color: "var(--text-secondary)",
                    display: "block",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}>
                    {field.name}
                  </span>
                  <span style={{
                    fontFamily: "'DM Mono', monospace",
                    fontSize: 9,
                    color: "var(--text-faint)",
                  }}>
                    {field.type}
                  </span>
                </div>

                {/* Eye toggle */}
                <button
                  type="button"
                  title={panelOn ? "Hide from side panel" : "Show in side panel"}
                  onClick={() => togglePanelVisible(field.name)}
                  style={{
                    flexShrink: 0,
                    width: 22,
                    height: 22,
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    fontSize: 13,
                    opacity: panelOn ? 1 : 0.3,
                    transition: "opacity 0.15s",
                    padding: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  👁
                </button>

                {/* Sphere radio — only for text fields */}
                {isText ? (
                  <button
                    type="button"
                    title={isSphere ? "Remove sphere center" : "Show in sphere center"}
                    onClick={() => setSphereField(field.name)}
                    style={{
                      flexShrink: 0,
                      width: 22,
                      height: 22,
                      background: "transparent",
                      border: "none",
                      cursor: "pointer",
                      fontSize: 13,
                      opacity: isSphere ? 1 : 0.3,
                      transition: "opacity 0.15s",
                      padding: 0,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    💠
                  </button>
                ) : (
                  <span style={{ width: 22, flexShrink: 0 }} />
                )}
              </div>

              {/* Filter pills for select/multi_select/status */}
              {isFilterable && field.options && field.options.length > 0 && (
                <div style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 4,
                  padding: "0 12px 6px",
                }}>
                  {field.options.map((opt) => {
                    const active = activeFilters.includes(opt.name);
                    const color = notionColor(opt.color);
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => toggleFilter(field.name, opt.name)}
                        style={{
                          padding: "2px 8px",
                          borderRadius: 20,
                          border: `1px solid ${active ? color : "var(--border-default)"}`,
                          background: active ? `${color}22` : "transparent",
                          color: active ? color : "var(--text-faint)",
                          fontFamily: "'Geist', sans-serif",
                          fontSize: 10,
                          cursor: "pointer",
                          transition: "all 0.15s",
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                        }}
                      >
                        <span style={{
                          width: 6,
                          height: 6,
                          borderRadius: "50%",
                          background: color,
                          flexShrink: 0,
                        }} />
                        {opt.name}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        {displayFields.length === 0 && (
          <div style={{ padding: "10px 12px", fontFamily: "'Geist', sans-serif", fontSize: 11, color: "var(--text-faint)" }}>
            No configurable fields found.
          </div>
        )}
      </div>
    </div>
  );
}
