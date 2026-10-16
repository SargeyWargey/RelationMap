"use client";

import { TierGlyph, bodyUiColor } from "@/components/OrreryAtlas";
import type { Universe } from "@/lib/orreryUniverse";

type Props = {
  universe: Universe;
  /** Currently focused body (-1 = whole universe). */
  focusIndex: number;
  onNavigate: (index: number) => void;
};

/** Universe › Galaxy › Star › Planet — every segment flies back to that level. */
export function OrreryBreadcrumb({ universe: u, focusIndex, onNavigate }: Props) {
  const path: number[] = [];
  let p = focusIndex;
  while (p >= 0) { path.unshift(p); p = u.bodies[p].parent; }

  const segments = [{ index: -1, label: "Universe" }, ...path.map((i) => ({ index: i, label: u.bodies[i].name }))];

  return (
    <nav
      aria-label="Location"
      style={{
        display: "flex", alignItems: "center", gap: 2, height: 30, padding: "0 6px",
        maxWidth: "min(720px, calc(100vw - 420px))",
        background: "var(--panel-bg)", backdropFilter: "blur(14px)",
        border: "1px solid var(--border-default)", borderRadius: 10, boxShadow: "var(--shadow-sm)",
        overflow: "hidden",
      }}
    >
      {segments.map((seg, k) => {
        const last = k === segments.length - 1;
        const body = seg.index >= 0 ? u.bodies[seg.index] : null;
        return (
          <div key={seg.index} style={{ display: "flex", alignItems: "center", gap: 2, minWidth: 0, flexShrink: last ? 1 : 2 }}>
            {k > 0 && <span style={{ color: "var(--text-faint)", fontSize: 11, padding: "0 2px", flexShrink: 0 }}>›</span>}
            <button
              type="button"
              onClick={() => onNavigate(seg.index)}
              disabled={last}
              title={last ? seg.label : `Fly to ${seg.label}`}
              style={{
                display: "flex", alignItems: "center", gap: 6, minWidth: 0, height: 22, padding: "0 7px",
                borderRadius: 6, border: "none", cursor: last ? "default" : "pointer",
                background: last ? "var(--bg-overlay)" : "transparent",
                color: last ? "var(--text-primary)" : "var(--text-muted)",
                fontFamily: "'Geist', sans-serif", fontSize: 12, fontWeight: last ? 500 : 400,
                transition: "background 0.12s, color 0.12s",
              }}
              onMouseEnter={(e) => { if (!last) { (e.currentTarget as HTMLElement).style.background = "var(--bg-overlay)"; (e.currentTarget as HTMLElement).style.color = "var(--text-primary)"; } }}
              onMouseLeave={(e) => { if (!last) { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "var(--text-muted)"; } }}
            >
              <span style={{ display: "flex", flexShrink: 0 }}>
                <TierGlyph
                  tier={body ? body.tier : "universe"}
                  region={!!body?.region}
                  color={body ? bodyUiColor(body) : "var(--accent-warm)"}
                  size={11}
                />
              </span>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 200 }}>{seg.label}</span>
            </button>
          </div>
        );
      })}
    </nav>
  );
}
