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

// Field types used by Project Timeline to extract person names (people type only)
const NAME_FIELD_TYPES = new Set(["people"]);

// Field types eligible for the Detail Field selector
const DETAIL_FIELD_TYPES = new Set(["title", "rich_text", "select", "multi_select", "formula", "rollup"]);
const DATABASE_COLOR_OPTIONS = [
  "#0D9488",
  "#F97316",
  "#2563EB",
  "#DC2626",
  "#7C3AED",
  "#16A34A",
  "#EA580C",
  "#4F46E5",
  "#BE123C",
  "#0891B2",
  "#14B8A6",
  "#FB7185",
  "#EAB308",
  "#84CC16",
  "#06B6D4",
  "#8B5CF6",
  "#F43F5E",
  "#22C55E",
  "#F59E0B",
  "#6366F1",
];

function buildDefaultConfig(schema: DatabaseSchema, databaseColor?: string): DatabaseFieldConfig {
  const panelVisible: Record<string, boolean> = {};
  let sphereField: string | null = null;

  for (const field of schema.fields) {
    if (SKIP_PANEL_TYPES.has(field.type)) continue;
    panelVisible[field.name] = true;
    if (!sphereField && field.name.toLowerCase() === "description" && TEXT_TYPES.has(field.type)) {
      sphereField = field.name;
    }
  }

  return { panelVisible, sphereField, activeFilters: {}, databaseColor };
}

type Props = {
  schema: DatabaseSchema;
  config: DatabaseFieldConfig | null;
  defaultColor: string;
  anchorLeft: number;
  anchorTop: number;
  onClose: () => void;
  onChange: (cfg: DatabaseFieldConfig) => void;
};

function EyeIcon({ active }: { active: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M1.25 8C2.86 5.32 5.22 4 8 4s5.14 1.32 6.75 4c-1.61 2.68-3.97 4-6.75 4S2.86 10.68 1.25 8Z"
        stroke="currentColor"
        strokeWidth="1.35"
      />
      <circle cx="8" cy="8" r="2.1" fill="currentColor" opacity={active ? 0.9 : 0.45} />
    </svg>
  );
}

function CenterTextIcon({ active }: { active: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="5.3" stroke="currentColor" strokeWidth="1.35" opacity={0.85} />
      <circle cx="8" cy="8" r="2.2" fill="currentColor" opacity={active ? 0.9 : 0.45} />
    </svg>
  );
}

export function FieldConfigPanel({ schema, config, defaultColor, anchorLeft, anchorTop, onClose, onChange }: Props) {
  const cfg = config ?? buildDefaultConfig(schema, defaultColor);
  const selectedDatabaseColor = cfg.databaseColor ?? defaultColor;

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

  function setDatabaseColor(color: string) {
    onChange({ ...cfg, databaseColor: color });
  }

  function setNameField(fieldName: string | null) {
    onChange({ ...cfg, nameField: fieldName });
  }

  function setDetailField(fieldName: string | null) {
    onChange({ ...cfg, detailField: fieldName });
  }

  const nameFieldOptions = schema.fields.filter((f) => NAME_FIELD_TYPES.has(f.type));
  const currentNameField = cfg.nameField ?? null;
  const detailFieldOptions = schema.fields.filter((f) => DETAIL_FIELD_TYPES.has(f.type));
  const currentDetailField = cfg.detailField ?? null;

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

      <div style={{
        padding: "10px 12px 8px",
        borderBottom: "1px solid var(--border-subtle)",
      }}>
        <div style={{
          fontFamily: "'DM Mono', monospace",
          fontSize: 9,
          color: "var(--text-faint)",
          letterSpacing: "0.07em",
          textTransform: "uppercase",
          marginBottom: 8,
        }}>
          Database Color
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {DATABASE_COLOR_OPTIONS.map((color) => {
            const active = selectedDatabaseColor.toLowerCase() === color.toLowerCase();
            return (
              <button
                key={color}
                type="button"
                title={`Set database color to ${color}`}
                aria-label={`Set database color to ${color}`}
                onClick={() => setDatabaseColor(color)}
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: "50%",
                  border: active ? "2px solid var(--text-primary)" : "1px solid color-mix(in srgb, var(--border-default) 75%, transparent)",
                  background: color,
                  boxShadow: active ? `0 0 0 2px ${color}33` : "none",
                  cursor: "pointer",
                  padding: 0,
                  transition: "transform 0.15s, box-shadow 0.15s, border-color 0.15s",
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.transform = "scale(1.08)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.transform = "scale(1)"; }}
              />
            );
          })}
        </div>
      </div>

      {/* Name Field — used by Project User to extract person names */}
      {nameFieldOptions.length > 0 && (
        <div style={{
          padding: "10px 12px 10px",
          borderBottom: "1px solid var(--border-subtle)",
        }}>
          <div style={{
            fontFamily: "'DM Mono', monospace",
            fontSize: 9,
            color: "var(--text-faint)",
            letterSpacing: "0.07em",
            textTransform: "uppercase",
            marginBottom: 7,
          }}>
            Name Field
            <span style={{
              marginLeft: 6,
              fontFamily: "'Geist', sans-serif",
              fontSize: 9,
              color: "var(--text-faint)",
              textTransform: "none",
              letterSpacing: 0,
              opacity: 0.7,
            }}>
              (Project User)
            </span>
          </div>
          {/* "(node title)" default option */}
          <button
            type="button"
            onClick={() => setNameField(null)}
            style={{
              display: "block",
              width: "100%",
              textAlign: "left",
              padding: "4px 8px",
              marginBottom: 2,
              borderRadius: 5,
              border: currentNameField === null
                ? "1px solid var(--border-default)"
                : "1px solid transparent",
              background: currentNameField === null ? "var(--bg-overlay)" : "transparent",
              cursor: "pointer",
              fontFamily: "'Geist', sans-serif",
              fontSize: 11,
              color: currentNameField === null ? "var(--text-secondary)" : "var(--text-faint)",
              transition: "background 0.12s, border-color 0.12s, color 0.12s",
            }}
            onMouseEnter={(e) => {
              if (currentNameField !== null) {
                (e.currentTarget as HTMLElement).style.background = "var(--bg-overlay)";
                (e.currentTarget as HTMLElement).style.color = "var(--text-secondary)";
              }
            }}
            onMouseLeave={(e) => {
              if (currentNameField !== null) {
                (e.currentTarget as HTMLElement).style.background = "transparent";
                (e.currentTarget as HTMLElement).style.color = "var(--text-faint)";
              }
            }}
          >
            <span style={{ opacity: 0.55, marginRight: 4 }}>—</span>
            node title
          </button>

          {/* One button per eligible field */}
          {nameFieldOptions.map((field) => {
            const active = currentNameField === field.name;
            return (
              <button
                key={field.id}
                type="button"
                onClick={() => setNameField(field.name)}
                title={`Use "${field.name}" (${field.type}) as person name field`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  width: "100%",
                  textAlign: "left",
                  padding: "4px 8px",
                  marginBottom: 2,
                  borderRadius: 5,
                  border: active
                    ? "1px solid var(--border-default)"
                    : "1px solid transparent",
                  background: active ? "var(--bg-overlay)" : "transparent",
                  cursor: "pointer",
                  transition: "background 0.12s, border-color 0.12s",
                }}
                onMouseEnter={(e) => {
                  if (!active) (e.currentTarget as HTMLElement).style.background = "var(--bg-overlay)";
                }}
                onMouseLeave={(e) => {
                  if (!active) (e.currentTarget as HTMLElement).style.background = "transparent";
                }}
              >
                <span style={{
                  fontFamily: "'Geist', sans-serif",
                  fontSize: 11,
                  color: active ? "var(--text-secondary)" : "var(--text-faint)",
                  flex: 1,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  transition: "color 0.12s",
                }}>
                  {field.name}
                </span>
                <span style={{
                  fontFamily: "'DM Mono', monospace",
                  fontSize: 9,
                  color: "var(--text-faint)",
                  flexShrink: 0,
                  opacity: 0.7,
                }}>
                  {field.type}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Detail Field — secondary text shown below card title on the timeline */}
      {detailFieldOptions.length > 0 && (
        <div style={{
          padding: "10px 12px 10px",
          borderBottom: "1px solid var(--border-subtle)",
        }}>
          <div style={{
            fontFamily: "'DM Mono', monospace",
            fontSize: 9,
            color: "var(--text-faint)",
            letterSpacing: "0.07em",
            textTransform: "uppercase",
            marginBottom: 7,
          }}>
            Detail Field
            <span style={{
              marginLeft: 6,
              fontFamily: "'Geist', sans-serif",
              fontSize: 9,
              color: "var(--text-faint)",
              textTransform: "none",
              letterSpacing: 0,
              opacity: 0.7,
            }}>
              (timeline card)
            </span>
          </div>

          {/* "(none)" default option */}
          <button
            type="button"
            onClick={() => setDetailField(null)}
            style={{
              display: "block",
              width: "100%",
              textAlign: "left",
              padding: "4px 8px",
              marginBottom: 2,
              borderRadius: 5,
              border: currentDetailField === null
                ? "1px solid var(--border-default)"
                : "1px solid transparent",
              background: currentDetailField === null ? "var(--bg-overlay)" : "transparent",
              cursor: "pointer",
              fontFamily: "'Geist', sans-serif",
              fontSize: 11,
              color: currentDetailField === null ? "var(--text-secondary)" : "var(--text-faint)",
              transition: "background 0.12s, border-color 0.12s, color 0.12s",
            }}
            onMouseEnter={(e) => {
              if (currentDetailField !== null) {
                (e.currentTarget as HTMLElement).style.background = "var(--bg-overlay)";
                (e.currentTarget as HTMLElement).style.color = "var(--text-secondary)";
              }
            }}
            onMouseLeave={(e) => {
              if (currentDetailField !== null) {
                (e.currentTarget as HTMLElement).style.background = "transparent";
                (e.currentTarget as HTMLElement).style.color = "var(--text-faint)";
              }
            }}
          >
            <span style={{ opacity: 0.55, marginRight: 4 }}>—</span>
            none (title only)
          </button>

          {detailFieldOptions.map((field) => {
            const active = currentDetailField === field.name;
            return (
              <button
                key={field.id}
                type="button"
                onClick={() => setDetailField(field.name)}
                title={`Show "${field.name}" (${field.type}) below card title`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  width: "100%",
                  textAlign: "left",
                  padding: "4px 8px",
                  marginBottom: 2,
                  borderRadius: 5,
                  border: active ? "1px solid var(--border-default)" : "1px solid transparent",
                  background: active ? "var(--bg-overlay)" : "transparent",
                  cursor: "pointer",
                  transition: "background 0.12s, border-color 0.12s",
                }}
                onMouseEnter={(e) => {
                  if (!active) (e.currentTarget as HTMLElement).style.background = "var(--bg-overlay)";
                }}
                onMouseLeave={(e) => {
                  if (!active) (e.currentTarget as HTMLElement).style.background = "transparent";
                }}
              >
                <span style={{
                  fontFamily: "'Geist', sans-serif",
                  fontSize: 11,
                  color: active ? "var(--text-secondary)" : "var(--text-faint)",
                  flex: 1,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  transition: "color 0.12s",
                }}>
                  {field.name}
                </span>
                <span style={{
                  fontFamily: "'DM Mono', monospace",
                  fontSize: 9,
                  color: "var(--text-faint)",
                  flexShrink: 0,
                  opacity: 0.7,
                }}>
                  {field.type}
                </span>
              </button>
            );
          })}
        </div>
      )}

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
                    color: panelOn ? "var(--text-primary)" : "var(--text-faint)",
                    opacity: panelOn ? 1 : 0.45,
                    transition: "opacity 0.15s, color 0.15s",
                    padding: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <EyeIcon active={panelOn} />
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
                      color: isSphere ? "var(--text-primary)" : "var(--text-faint)",
                      opacity: isSphere ? 1 : 0.45,
                      transition: "opacity 0.15s, color 0.15s",
                      padding: 0,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <CenterTextIcon active={isSphere} />
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
