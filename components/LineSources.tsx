"use client";

import { useEffect, useRef } from "react";

import { describeDateRule, type LineSource } from "@/lib/lineModel";

type Props = {
  sources: LineSource[];
  disabled: Set<string>;
  /** Databases with active field filters (set elsewhere in the app). */
  filtered: Set<string>;
  onToggle: (databaseId: string) => void;
  onPeopleField: (databaseId: string, field: string) => void;
  onClearFilters: (databaseId: string) => void;
  onClose: () => void;
};

/** Popover: which databases feed the timeline, who they belong to, and which dates place them. */
export function LineSources({ sources, disabled, filtered, onToggle, onPeopleField, onClearFilters, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) && !(e.target as HTMLElement).closest("[data-sources-toggle]")) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey, true);
    return () => { document.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onKey, true); };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="animate-fade-up"
      style={{
        position: "absolute", top: 36, right: 0, width: 360, maxHeight: "calc(100vh - 140px)", overflowY: "auto",
        background: "var(--panel-bg)", backdropFilter: "blur(20px) saturate(1.4)", border: "1px solid var(--border-default)",
        borderRadius: 12, boxShadow: "var(--shadow-lg)", padding: "12px 0 6px",
      }}
    >
      <div style={{ padding: "0 14px 8px", display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontFamily: "'Lora', Georgia, serif", fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>Sources</span>
        <span style={{ fontFamily: "'Geist', sans-serif", fontSize: 11, color: "var(--text-faint)" }}>databases with a people field</span>
      </div>
      {sources.map((s) => {
        const on = !disabled.has(s.databaseId);
        return (
          <div key={s.databaseId} style={{ padding: "8px 14px", borderTop: "1px solid var(--border-subtle)", opacity: on ? 1 : 0.55 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button
                type="button"
                onClick={() => onToggle(s.databaseId)}
                aria-pressed={on}
                title={on ? "Hide from the timeline" : "Show on the timeline"}
                style={{
                  width: 28, height: 16, borderRadius: 9, border: "none", padding: 0, cursor: "pointer", position: "relative", flexShrink: 0,
                  background: on ? s.color : "var(--border-default)", transition: "background 0.15s",
                }}
              >
                <span style={{ position: "absolute", top: 2, left: on ? 14 : 2, width: 12, height: 12, borderRadius: "50%", background: "#fff", transition: "left 0.15s", boxShadow: "0 1px 2px rgba(0,0,0,0.25)" }} />
              </button>
              <span style={{ fontFamily: "'Geist', sans-serif", fontSize: 12.5, fontWeight: 500, color: "var(--text-primary)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {s.databaseName}
              </span>
              <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: "var(--text-faint)" }} title="records placed on a lane / records in the database">
                {on ? `${s.placed.toLocaleString()} / ${s.total.toLocaleString()}` : `${s.total.toLocaleString()}`}
              </span>
            </div>
            {on && (
              <div style={{ marginTop: 6, marginLeft: 36, display: "flex", flexDirection: "column", gap: 4 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: "'Geist', sans-serif", fontSize: 11, color: "var(--text-muted)" }}>
                  <span style={{ width: 44, color: "var(--text-faint)" }}>People</span>
                  {s.peopleFields.length > 1 ? (
                    <select
                      value={s.peopleField ?? ""}
                      onChange={(e) => onPeopleField(s.databaseId, e.target.value)}
                      style={{
                        flex: 1, height: 22, borderRadius: 6, border: "1px solid var(--border-default)", background: "var(--bg-overlay)",
                        color: "var(--text-primary)", fontFamily: "'Geist', sans-serif", fontSize: 11, padding: "0 4px",
                      }}
                    >
                      {s.peopleFields.map((f) => <option key={f} value={f}>{f}</option>)}
                    </select>
                  ) : (
                    <span style={{ color: "var(--text-secondary)" }}>{s.peopleField}</span>
                  )}
                </label>
                {s.peopleFieldStale && (
                  <span style={{ marginLeft: 50, fontFamily: "'Geist', sans-serif", fontSize: 10.5, color: "var(--accent-warm)" }}>
                    Saved field no longer exists — using “{s.peopleField}”
                  </span>
                )}
                <div style={{ display: "flex", gap: 6, fontFamily: "'Geist', sans-serif", fontSize: 11 }}>
                  <span style={{ width: 44, flexShrink: 0, color: "var(--text-faint)" }}>Dates</span>
                  <span style={{ color: "var(--text-muted)", lineHeight: 1.4 }}>{describeDateRule(s.dates)}</span>
                </div>
                {filtered.has(s.databaseId) && (
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 50, fontFamily: "'Geist', sans-serif", fontSize: 10.5, color: "var(--text-faint)" }}>
                    Field filters active
                    <button
                      type="button"
                      onClick={() => onClearFilters(s.databaseId)}
                      style={{ border: "none", background: "none", padding: 0, cursor: "pointer", color: "var(--accent-warm)", fontSize: 10.5, fontFamily: "'Geist', sans-serif" }}
                    >
                      clear
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
