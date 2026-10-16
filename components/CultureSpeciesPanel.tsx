"use client";

import { CultureGlyph } from "@/components/CultureGlyph";
import { MORPH_NAMES, type CultureWorld } from "@/lib/cultureWorld";
import { formatDay } from "@/lib/lineModel";

export type SpeciesSource = { databaseId: string; name: string; color: string; count: number; morph: number };
export type PanelTab = "species" | "colonies";

type Props = {
  world: CultureWorld | null;
  sources: SpeciesSource[];
  disabled: Set<string>;
  onToggle: (databaseId: string) => void;
  onSetAll: (on: boolean) => void;
  /** Per database at the playhead. */
  live: Map<string, { alive: number; dormant: number }>;
  /** Visible members per colony at the playhead. */
  colonyLive: number[];
  onFocusColony: (colony: number) => void;
  onHighlight: (h: { species?: number; colony?: number } | null) => void;
  selectedColony: number | null;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  building: boolean;
  tab: PanelTab;
  onTab: (t: PanelTab) => void;
  bottom: number;
};

const mono: React.CSSProperties = { fontFamily: "'DM Mono', monospace" };

function LifeIcon({ kind }: { kind: "alive" | "active" | "blocked" | "dormant" }) {
  const c = kind === "active" ? "#3fb771" : kind === "blocked" ? "#c9a227" : kind === "dormant" ? "var(--text-faint)" : "var(--text-secondary)";
  return (
    <svg width="12" height="12" viewBox="-6 -6 12 12" style={{ flexShrink: 0 }}>
      {kind === "active" && <circle r={5.4} fill="none" stroke={c} strokeWidth={0.9} opacity={0.5} />}
      {kind === "dormant" ? (
        <>
          <circle r={3.8} fill="none" stroke={c} strokeWidth={1.6} />
          <circle r={1.6} fill={c} opacity={0.5} />
        </>
      ) : kind === "blocked" ? (
        <path d="M-3.8 0 L-2.6 -2.8 L0 -3.9 L2.9 -2.6 L3.7 0.2 L2.5 3 L-0.2 3.8 L-2.9 2.7 Z" fill={c} fillOpacity={0.45} stroke={c} strokeWidth={1} />
      ) : (
        <circle r={3.6} fill={c} fillOpacity={0.45} stroke={c} strokeWidth={1.1} />
      )}
    </svg>
  );
}

/** Left rail: every database as a species you can culture or hide, and every colony in the dish. */
export function CultureSpeciesPanel({
  world, sources, disabled, onToggle, onSetAll, live, colonyLive, onFocusColony, onHighlight, selectedColony,
  collapsed, onToggleCollapsed, building, tab, onTab, bottom,
}: Props) {
  if (collapsed) {
    return (
      <button
        type="button"
        onClick={onToggleCollapsed}
        title="Show species (Q)"
        style={{
          position: "absolute", top: 66, left: 24, zIndex: 20, height: 30, padding: "0 10px", borderRadius: 9,
          border: "1px solid var(--border-default)", background: "var(--panel-bg)", backdropFilter: "blur(14px)",
          boxShadow: "var(--shadow-sm)", cursor: "pointer", display: "flex", alignItems: "center", gap: 7,
          fontFamily: "'Geist', sans-serif", fontSize: 11.5, fontWeight: 500, color: "var(--text-muted)",
        }}
      >
        <CultureGlyph morph={2} color="var(--accent-warm)" size={14} />
        Species
        <span style={{ ...mono, fontSize: 10, color: "var(--text-faint)" }}>{sources.length - disabled.size}</span>
      </button>
    );
  }

  const speciesIndex = new Map(world?.species.map((s) => [s.databaseId, s.index]) ?? []);
  const shown = sources.filter((s) => !disabled.has(s.databaseId)).length;
  const coloniesSorted = world
    ? world.colonies
        .map((c) => c.index)
        .sort((a, b) => (colonyLive[b] ?? 0) - (colonyLive[a] ?? 0) || world.colonies[b].members.length - world.colonies[a].members.length)
    : [];

  return (
    <div
      className="animate-fade-up"
      onMouseLeave={() => onHighlight(null)}
      style={{
        position: "absolute", top: 66, left: 24, bottom, width: 268, zIndex: 20,
        display: "flex", flexDirection: "column",
        background: "var(--panel-bg)", backdropFilter: "blur(18px) saturate(1.3)",
        border: "1px solid var(--border-default)", borderRadius: 12, boxShadow: "var(--shadow-md)", overflow: "hidden",
      }}
    >
      {/* Tabs */}
      <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "8px 8px 7px 10px", borderBottom: "1px solid var(--border-subtle)" }}>
        {(["species", "colonies"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => onTab(t)}
            style={{
              height: 26, padding: "0 10px", borderRadius: 7, border: "none", cursor: "pointer",
              background: tab === t ? "var(--bg-overlay)" : "transparent",
              fontFamily: "'Lora', Georgia, serif", fontSize: 13.5, fontWeight: 600,
              color: tab === t ? "var(--text-primary)" : "var(--text-faint)",
            }}
          >
            {t === "species" ? "Species" : "Colonies"}
            <span style={{ ...mono, fontSize: 9.5, fontWeight: 400, marginLeft: 5, color: "var(--text-faint)" }}>
              {t === "species" ? `${shown}/${sources.length}` : world?.colonies.length ?? 0}
            </span>
          </button>
        ))}
        <button
          type="button"
          onClick={onToggleCollapsed}
          title="Hide (Q)"
          style={{ marginLeft: "auto", width: 22, height: 22, borderRadius: 6, border: "none", background: "transparent", color: "var(--text-faint)", cursor: "pointer", fontSize: 13, padding: 0 }}
        >
          ‹
        </button>
      </div>

      {tab === "species" ? (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", borderBottom: "1px solid var(--border-subtle)" }}>
            <span style={{ ...mono, fontSize: 9.5, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-faint)" }}>Culture</span>
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
            {building && <span style={{ marginLeft: "auto", fontFamily: "'Geist', sans-serif", fontSize: 10.5, color: "var(--text-faint)" }}>regrowing…</span>}
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: "4px 0" }}>
            {sources.map((s) => {
              const on = !disabled.has(s.databaseId);
              const lv = live.get(s.databaseId);
              const si = speciesIndex.get(s.databaseId);
              const sub = !on
                ? `hidden · ${s.count.toLocaleString()} records`
                : !lv || si === undefined
                  ? `${s.count.toLocaleString()} records · growing…`
                  : lv.alive + lv.dormant === 0
                    ? "not born yet"
                    : `${lv.alive.toLocaleString()} alive${lv.dormant ? ` · ${lv.dormant.toLocaleString()} dormant` : ""}`;
              return (
                <div
                  key={s.databaseId}
                  onMouseEnter={() => onHighlight(on && si !== undefined ? { species: si } : null)}
                  style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 10px", opacity: on ? 1 : 0.5 }}
                >
                  <button
                    type="button"
                    onClick={() => onToggle(s.databaseId)}
                    title={on ? "Remove from the dish" : "Add to the dish"}
                    aria-pressed={on}
                    style={{ width: 14, height: 14, borderRadius: 4, flexShrink: 0, cursor: "pointer", padding: 0, border: `1.5px solid ${s.color}`, background: on ? s.color : "transparent" }}
                  />
                  <CultureGlyph morph={s.morph} color={s.color} size={22} dim={!on} />
                  <div style={{ flex: 1, minWidth: 0 }} title={`${s.name} — ${MORPH_NAMES[s.morph]}`}>
                    <div style={{ fontFamily: "'Geist', sans-serif", fontSize: 12, fontWeight: 500, color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {s.name}
                    </div>
                    <div style={{ ...mono, fontSize: 9.5, color: "var(--text-faint)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {sub}
                    </div>
                  </div>
                  <span style={{ ...mono, fontSize: 8.5, letterSpacing: "0.04em", color: "var(--text-faint)", flexShrink: 0 }}>{MORPH_NAMES[s.morph].toLowerCase()}</span>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <div style={{ flex: 1, overflowY: "auto", padding: "4px 0" }}>
          {world && coloniesSorted.map((ci) => {
            const c = world.colonies[ci];
            const n = colonyLive[ci] ?? 0;
            const total = c.members.length;
            const here = ci === selectedColony;
            return (
              <button
                key={ci}
                type="button"
                onClick={() => onFocusColony(ci)}
                onMouseEnter={() => onHighlight({ colony: ci })}
                style={{
                  display: "flex", alignItems: "center", gap: 9, width: "100%", padding: "6px 10px 6px 8px", border: "none", cursor: "pointer", textAlign: "left",
                  background: here ? "var(--bg-overlay)" : "transparent", borderLeft: `2px solid ${here ? "var(--accent-warm)" : "transparent"}`,
                  opacity: n === 0 ? 0.45 : 1,
                }}
                onMouseOver={(e) => { if (!here) (e.currentTarget as HTMLElement).style.background = "var(--bg-overlay)"; }}
                onMouseOut={(e) => { if (!here) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
              >
                {/* Species mix */}
                <div style={{ width: 30, height: 30, borderRadius: "50%", flexShrink: 0, position: "relative", overflow: "hidden", border: "1px solid var(--border-subtle)" }}>
                  <svg width="30" height="30" viewBox="-15 -15 30 30">
                    {(() => {
                      let a0 = -Math.PI / 2;
                      return c.bySpecies.map((cnt, si) => {
                        if (!cnt) return null;
                        const frac = cnt / total;
                        const a1 = a0 + frac * Math.PI * 2;
                        const large = frac > 0.5 ? 1 : 0;
                        const d = frac >= 0.999
                          ? "M0 -14 A14 14 0 1 1 -0.01 -14 Z"
                          : `M0 0 L${Math.cos(a0) * 14} ${Math.sin(a0) * 14} A14 14 0 ${large} 1 ${Math.cos(a1) * 14} ${Math.sin(a1) * 14} Z`;
                        a0 = a1;
                        return <path key={si} d={d} fill={world.species[si].color} opacity={0.8} />;
                      });
                    })()}
                    <circle r={6} fill="var(--panel-bg)" />
                  </svg>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: "'Geist', sans-serif", fontSize: 12, fontWeight: 500, color: here ? "var(--text-primary)" : "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {c.name}
                  </div>
                  <div style={{ ...mono, fontSize: 9.5, color: "var(--text-faint)", whiteSpace: "nowrap" }}>
                    {n === 0 ? `founded ${formatDay(c.founded, false)}` : `${n.toLocaleString()}${n < total ? ` of ${total.toLocaleString()}` : ""} cells · since ${formatDay(c.founded, false)}`}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Lifecycle legend */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "7px 12px", borderTop: "1px solid var(--border-subtle)" }}>
        {([["alive", "alive"], ["active", "active"], ["blocked", "blocked"], ["dormant", "done"]] as const).map(([k, label]) => (
          <span key={k} style={{ display: "flex", alignItems: "center", gap: 4, fontFamily: "'Geist', sans-serif", fontSize: 10.5, color: "var(--text-faint)" }}>
            <LifeIcon kind={k} />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
