"use client";

import { useMemo, useState } from "react";

import { personColor } from "@/components/TimelineCanvas";
import type { LaneSort, LineModel } from "@/lib/lineModel";

type Props = {
  model: LineModel;
  /** Person indices in lane order (front → back). */
  order: number[];
  sort: LaneSort;
  onSortChange: (sort: LaneSort) => void;
  focusLane: number;
  isolate: number | null;
  onPick: (person: number) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  darkMode: boolean;
};

const SORTS: Array<[LaneSort, string]> = [["activity", "Most active"], ["recent", "Recent"], ["name", "A–Z"]];
const BINS = 36;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

/** Left rail: every person as a lane, with an activity sparkline. Click flies to the lane. */
export function LinePeoplePanel({ model, order, sort, onSortChange, focusLane, isolate, onPick, collapsed, onToggleCollapsed, darkMode }: Props) {
  const [query, setQuery] = useState("");

  const sparks = useMemo(() => {
    const t0 = model.tMin, span = Math.max(1, model.tMax - model.tMin);
    const out = new Map<number, { path: string; todayX: number }>();
    for (const p of model.people) {
      const bins = new Float32Array(BINS);
      for (const e of p.events) {
        const ev = model.events[e];
        const a = Math.min(BINS - 1, Math.max(0, Math.floor(((ev.t0 - t0) / span) * BINS)));
        const b = Math.min(BINS - 1, Math.max(0, Math.floor(((ev.t1 - t0) / span) * BINS)));
        for (let i = a; i <= b; i++) bins[i] += 1 / (b - a + 1);
      }
      let max = 0;
      for (const v of bins) max = Math.max(max, v);
      const pts: string[] = [];
      for (let i = 0; i < BINS; i++) {
        const x = (i / (BINS - 1)) * 60;
        const y = 14 - (max > 0 ? Math.sqrt(bins[i] / max) : 0) * 12;
        pts.push(`${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`);
      }
      out.set(p.index, { path: pts.join(""), todayX: ((model.today - t0) / span) * 60 });
    }
    return out;
  }, [model]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? order.filter((p) => model.people[p].name.toLowerCase().includes(q)) : order;
  }, [order, query, model]);

  const legend = useMemo(() => model.sources.filter((s) => s.placed > 0), [model]);

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={onToggleCollapsed}
        title="Show people (Q)"
        style={{
          position: "absolute", bottom: 86, left: 24, zIndex: 20, height: 30, padding: "0 10px", borderRadius: 9,
          border: "1px solid var(--border-default)", background: "var(--panel-bg)", backdropFilter: "blur(14px)",
          boxShadow: "var(--shadow-sm)", cursor: "pointer", display: "flex", alignItems: "center", gap: 7,
          fontFamily: "'Geist', sans-serif", fontSize: 11.5, fontWeight: 500, color: "var(--text-muted)",
        }}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M1 3h10M1 6h10M1 9h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
        People
        <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: "var(--text-faint)" }}>{model.people.length}</span>
      </button>
    );
  }

  return (
    <div
      className="animate-fade-up"
      style={{
        position: "absolute", top: 66, left: 24, bottom: 96, width: 260, zIndex: 20,
        display: "flex", flexDirection: "column",
        background: "var(--panel-bg)", backdropFilter: "blur(18px) saturate(1.3)",
        border: "1px solid var(--border-default)", borderRadius: 12, boxShadow: "var(--shadow-md)", overflow: "hidden",
      }}
    >
      {/* Header */}
      <div style={{ padding: "10px 12px 8px", borderBottom: "1px solid var(--border-subtle)", display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontFamily: "'Lora', Georgia, serif", fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>People</span>
          <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: "var(--text-faint)" }}>
            {model.people.length} · {model.events.length.toLocaleString()} records
          </span>
          <button
            type="button"
            onClick={onToggleCollapsed}
            title="Hide (Q)"
            style={{ marginLeft: "auto", width: 22, height: 22, borderRadius: 6, border: "none", background: "transparent", color: "var(--text-faint)", cursor: "pointer", fontSize: 13, lineHeight: 1, padding: 0 }}
          >
            ‹
          </button>
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter" && rows[0] !== undefined) onPick(rows[0]);
            if (e.key === "Escape") { setQuery(""); (e.target as HTMLInputElement).blur(); }
          }}
          placeholder="Find a person…"
          spellCheck={false}
          style={{
            width: "100%", height: 26, borderRadius: 7, border: "1px solid var(--border-default)", background: "var(--bg-overlay)",
            padding: "0 9px", fontFamily: "'Geist', sans-serif", fontSize: 11.5, color: "var(--text-primary)", outline: "none", boxSizing: "border-box",
          }}
        />
        <div style={{ display: "flex", gap: 2, padding: 2, background: "var(--bg-overlay)", borderRadius: 7 }}>
          {SORTS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => onSortChange(key)}
              style={{
                flex: 1, height: 20, borderRadius: 5, border: "none", cursor: "pointer",
                background: sort === key ? "var(--panel-bg)" : "transparent",
                boxShadow: sort === key ? "var(--shadow-sm)" : "none",
                color: sort === key ? "var(--text-primary)" : "var(--text-faint)",
                fontFamily: "'Geist', sans-serif", fontSize: 10.5, fontWeight: 500,
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Rows */}
      <div style={{ flex: 1, overflowY: "auto", padding: "4px 0" }}>
        {rows.length === 0 && (
          <div style={{ padding: "18px 12px", textAlign: "center", fontFamily: "'DM Mono', monospace", fontSize: 11, color: "var(--text-faint)" }}>no one matches</div>
        )}
        {rows.map((pi) => {
          const p = model.people[pi];
          const active = pi === focusLane;
          const isolated = pi === isolate;
          const color = personColor(p.hue, darkMode);
          const spark = sparks.get(pi);
          return (
            <button
              key={pi}
              type="button"
              onClick={() => onPick(pi)}
              title={`${p.name} — ${p.events.length} records${p.overdue ? `, ${p.overdue} overdue` : ""}`}
              style={{
                width: "100%", display: "flex", alignItems: "center", gap: 9, padding: "6px 12px 6px 10px",
                border: "none", borderLeft: `2px solid ${isolated ? color : active ? "var(--border-strong)" : "transparent"}`,
                background: isolated ? "var(--bg-overlay)" : active ? "color-mix(in srgb, var(--bg-overlay) 55%, transparent)" : "transparent",
                cursor: "pointer", textAlign: "left", transition: "background 0.12s",
              }}
              onMouseEnter={(e) => { if (!isolated) (e.currentTarget as HTMLElement).style.background = "var(--bg-overlay)"; }}
              onMouseLeave={(e) => { if (!isolated) (e.currentTarget as HTMLElement).style.background = active ? "color-mix(in srgb, var(--bg-overlay) 55%, transparent)" : "transparent"; }}
            >
              <span style={{
                width: 22, height: 22, borderRadius: "50%", background: personColor(p.hue, true), flexShrink: 0,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontFamily: "'DM Mono', monospace", fontSize: 8.5, fontWeight: 500, color: "#fff",
              }}>
                {initials(p.name)}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{
                  display: "block", fontFamily: "'Geist', sans-serif", fontSize: 12, fontWeight: active || isolated ? 600 : 500,
                  color: active || isolated ? "var(--text-primary)" : "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {p.name}
                </span>
                <span style={{ display: "flex", gap: 6, fontFamily: "'DM Mono', monospace", fontSize: 9.5, color: "var(--text-faint)" }}>
                  <span>{p.events.length}</span>
                  {p.spans > 0 && <span>{p.spans} spans</span>}
                  {p.overdue > 0 && <span style={{ color: "#e5534b" }}>{p.overdue} overdue</span>}
                </span>
              </span>
              {spark && (
                <svg width="60" height="16" viewBox="0 0 60 16" style={{ flexShrink: 0, overflow: "visible" }}>
                  <line x1={spark.todayX} x2={spark.todayX} y1={0} y2={16} stroke="var(--accent-warm)" strokeWidth="1" opacity="0.55" />
                  <path d={spark.path} fill="none" stroke={color} strokeWidth="1.3" strokeLinejoin="round" opacity={active || isolated ? 1 : 0.75} />
                </svg>
              )}
            </button>
          );
        })}
      </div>

      {/* Legend */}
      <div style={{ padding: "8px 12px 10px", borderTop: "1px solid var(--border-subtle)", display: "flex", flexDirection: "column", gap: 7 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 10px" }}>
          {legend.map((s) => (
            <span key={s.databaseId} style={{ display: "flex", alignItems: "center", gap: 5, fontFamily: "'Geist', sans-serif", fontSize: 10.5, color: "var(--text-muted)" }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: s.color }} />
              {s.databaseName}
            </span>
          ))}
        </div>
        <div style={{ display: "flex", gap: "4px 10px", fontFamily: "'DM Mono', monospace", fontSize: 9.5, color: "var(--text-faint)", alignItems: "center", flexWrap: "wrap" }}>
          {(["done", "active", "open", "overdue", "span"] as const).map((k) => (
            <span key={k} style={{ display: "flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}>
              <LegendGlyph kind={k} /> {k}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function LegendGlyph({ kind }: { kind: "done" | "active" | "open" | "overdue" | "span" }) {
  const c = "var(--text-muted)";
  return (
    <svg width={kind === "span" ? 18 : 10} height="10" viewBox={kind === "span" ? "0 0 18 10" : "0 0 10 10"}>
      {kind === "done" && <circle cx="5" cy="5" r="4" fill={c} />}
      {kind === "active" && <><circle cx="5" cy="5" r="3.2" fill={c} /><circle cx="5" cy="5" r="4.6" fill="none" stroke={c} strokeWidth="0.8" opacity="0.6" /></>}
      {kind === "open" && <circle cx="5" cy="5" r="3.6" fill="none" stroke={c} strokeWidth="1.4" />}
      {kind === "overdue" && <><circle cx="5" cy="5" r="2.8" fill={c} /><circle cx="5" cy="5" r="4.4" fill="none" stroke="#e5534b" strokeWidth="1.1" /></>}
      {kind === "span" && <rect x="1" y="2.5" width="16" height="5" rx="2.5" fill={c} />}
    </svg>
  );
}
