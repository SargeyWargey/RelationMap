"use client";

import { useState } from "react";

import { toMeters, type World } from "@/lib/mountainWorld";

export type RangeSource = { databaseId: string; name: string; color: string; count: number };

type Props = {
  world: World | null;
  sources: RangeSource[];
  /** Draft selection: databases toggled off (not yet applied). */
  disabled: Set<string>;
  /** How many toggles differ from the land currently shown. */
  pendingChanges: number;
  onApply: () => void;
  onReset: () => void;
  onSetAll: (on: boolean) => void;
  onToggleSource: (databaseId: string) => void;
  onFocusRange: (range: number) => void;
  onPickPeak: (peak: number) => void;
  selectedPeak: number | null;
  currentRange: number;
  visitedCount: number;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  building: boolean;
};

function displayName(name: string, id: string) {
  const n = name?.trim();
  if (!n || /^[0-9a-f]{32}$/i.test(n) || n.replace(/-/g, "") === id.replace(/-/g, "")) return "Untitled";
  return n;
}

/** Left rail: every database as a mountain range — jump to it, browse its summits, or hide it. */
export function MountainRangesPanel({
  world, sources, disabled, pendingChanges, onApply, onReset, onSetAll, onToggleSource, onFocusRange, onPickPeak, selectedPeak, currentRange, visitedCount,
  collapsed, onToggleCollapsed, building,
}: Props) {
  const [open, setOpen] = useState<string | null>(null);

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={onToggleCollapsed}
        title="Show ranges (Q)"
        style={{
          position: "absolute", top: 66, left: 24, zIndex: 20, height: 30, padding: "0 10px", borderRadius: 9,
          border: "1px solid var(--border-default)", background: "var(--panel-bg)", backdropFilter: "blur(14px)",
          boxShadow: "var(--shadow-sm)", cursor: "pointer", display: "flex", alignItems: "center", gap: 7,
          fontFamily: "'Geist', sans-serif", fontSize: 11.5, fontWeight: 500, color: "var(--text-muted)",
        }}
      >
        <svg width="13" height="11" viewBox="0 0 13 11" fill="none"><path d="M1 10L4.5 3.5L7 7.5L9 4.5L12 10Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" /></svg>
        Ranges
        <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: "var(--text-faint)" }}>{world?.ranges.length ?? 0}</span>
      </button>
    );
  }

  const rangeByDb = new Map(world?.ranges.map((r) => [r.databaseId, r]) ?? []);
  const total = world?.peaks.length ?? 0;

  return (
    <div
      className="animate-fade-up"
      style={{
        position: "absolute", top: 66, left: 24, bottom: 238, width: 260, zIndex: 20,
        display: "flex", flexDirection: "column",
        background: "var(--panel-bg)", backdropFilter: "blur(18px) saturate(1.3)",
        border: "1px solid var(--border-default)", borderRadius: 12, boxShadow: "var(--shadow-md)", overflow: "hidden",
      }}
    >
      <div style={{ padding: "10px 12px 9px", borderBottom: "1px solid var(--border-subtle)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontFamily: "'Lora', Georgia, serif", fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>Ranges</span>
          <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: "var(--text-faint)" }}>{total.toLocaleString()} peaks</span>
          <button
            type="button"
            onClick={onToggleCollapsed}
            title="Hide (Q)"
            style={{ marginLeft: "auto", width: 22, height: 22, borderRadius: 6, border: "none", background: "transparent", color: "var(--text-faint)", cursor: "pointer", fontSize: 13, padding: 0 }}
          >
            ‹
          </button>
        </div>
        <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ flex: 1, height: 4, borderRadius: 2, background: "var(--bg-overlay)", overflow: "hidden" }}>
            <div style={{ width: `${total ? Math.min(100, (visitedCount / total) * 100) : 0}%`, minWidth: visitedCount ? 3 : 0, height: "100%", background: "var(--accent-warm)", transition: "width 0.4s" }} />
          </div>
          <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 9.5, color: "var(--text-muted)" }} title="Summits you've reached on foot">
            {visitedCount} summited
          </span>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", borderBottom: "1px solid var(--border-subtle)" }}>
        <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 9.5, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-faint)" }}>Show</span>
        {(["All", "None"] as const).map((label) => (
          <button
            key={label}
            type="button"
            onClick={() => onSetAll(label === "All")}
            style={{ height: 20, padding: "0 8px", borderRadius: 5, border: "1px solid var(--border-default)", background: "transparent", cursor: "pointer", fontFamily: "'Geist', sans-serif", fontSize: 10.5, color: "var(--text-muted)" }}
          >
            {label}
          </button>
        ))}
        {building && <span style={{ marginLeft: "auto", fontFamily: "'Geist', sans-serif", fontSize: 10.5, color: "var(--text-faint)" }}>regenerating…</span>}
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "4px 0" }}>
        {sources.map((s) => {
          const r = rangeByDb.get(s.databaseId);
          const on = !disabled.has(s.databaseId);
          const top = r && world ? world.peaks[r.summit] : null;
          const isOpen = open === s.databaseId && !!r;
          const here = r && r.index === currentRange;
          return (
            <div key={s.databaseId} style={{ borderLeft: `2px solid ${here ? s.color : "transparent"}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px 6px 10px", opacity: on ? 1 : 0.5 }}>
                <button
                  type="button"
                  onClick={() => onToggleSource(s.databaseId)}
                  title={on ? "Remove this range (then Apply)" : "Raise this range (then Apply)"}
                  aria-pressed={on}
                  style={{
                    width: 14, height: 14, borderRadius: 4, flexShrink: 0, cursor: "pointer", padding: 0,
                    border: `1.5px solid ${s.color}`, background: on ? s.color : "transparent",
                  }}
                />
                <button
                  type="button"
                  onClick={() => { if (r) { onFocusRange(r.index); setOpen(isOpen ? null : s.databaseId); } }}
                  disabled={!r}
                  style={{ flex: 1, minWidth: 0, border: "none", background: "none", padding: 0, textAlign: "left", cursor: r ? "pointer" : "default" }}
                >
                  <span style={{ display: "block", fontFamily: "'Geist', sans-serif", fontSize: 12, fontWeight: 500, color: here ? "var(--text-primary)" : "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {s.name}
                  </span>
                  <span style={{ display: "block", fontFamily: "'DM Mono', monospace", fontSize: 9.5, color: "var(--text-faint)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {on && !r ? `${s.count} records · will rise` : on ? (top ? `${s.count} peaks · ▲ ${toMeters(top.sy).toLocaleString()} m` : `${s.count} peaks`) : r ? `${s.count} peaks · will be removed` : `hidden · ${s.count} records`}
                  </span>
                </button>
                {r && (
                  <button
                    type="button"
                    onClick={() => setOpen(isOpen ? null : s.databaseId)}
                    title="Highest summits"
                    style={{ width: 18, height: 18, border: "none", background: "none", color: "var(--text-faint)", cursor: "pointer", padding: 0, fontSize: 10, transform: isOpen ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}
                  >
                    ▸
                  </button>
                )}
              </div>
              {isOpen && r && world && (
                <div style={{ padding: "0 10px 6px 32px", display: "flex", flexDirection: "column", gap: 1 }}>
                  {r.peaks.slice(0, 10).map((pi) => {
                    const p = world.peaks[pi];
                    const sel = pi === selectedPeak;
                    return (
                      <button
                        key={pi}
                        type="button"
                        onClick={() => onPickPeak(pi)}
                        style={{
                          display: "flex", alignItems: "center", gap: 6, padding: "3px 6px", borderRadius: 6, border: "none", cursor: "pointer", textAlign: "left",
                          background: sel ? "var(--bg-overlay)" : "transparent",
                        }}
                        onMouseEnter={(e) => { if (!sel) (e.currentTarget as HTMLElement).style.background = "var(--bg-overlay)"; }}
                        onMouseLeave={(e) => { if (!sel) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                      >
                        <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: "var(--text-faint)", width: 14 }}>{p.rank + 1}</span>
                        <span style={{ flex: 1, minWidth: 0, fontFamily: "'Geist', sans-serif", fontSize: 11, color: sel ? "var(--text-primary)" : "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {displayName(p.node.name, p.node.id)}
                        </span>
                        <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: "var(--text-faint)" }}>{toMeters(p.sy).toLocaleString()}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {pendingChanges > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 10px", borderTop: "1px solid var(--border-subtle)", background: "var(--bg-overlay)" }}>
          <span style={{ flex: 1, fontFamily: "'Geist', sans-serif", fontSize: 11, color: "var(--text-secondary)" }}>
            {pendingChanges} change{pendingChanges === 1 ? "" : "s"}
          </span>
          <button
            type="button"
            onClick={onReset}
            style={{ height: 24, padding: "0 9px", borderRadius: 6, border: "1px solid var(--border-default)", background: "transparent", cursor: "pointer", fontFamily: "'Geist', sans-serif", fontSize: 11, color: "var(--text-muted)" }}
          >
            Reset
          </button>
          <button
            type="button"
            onClick={onApply}
            style={{ height: 24, padding: "0 11px", borderRadius: 6, border: "none", background: "var(--accent-warm)", cursor: "pointer", fontFamily: "'Geist', sans-serif", fontSize: 11, fontWeight: 600, color: "#fff" }}
          >
            Apply &amp; reshape
          </button>
        </div>
      )}
    </div>
  );
}
