"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { Body, BodyTier, Universe } from "@/lib/orreryUniverse";

// ─── Tier glyphs (shared by Atlas, breadcrumb and builder) ────────────────────

export function TierGlyph({ tier, color = "currentColor", size = 14, region = false }: {
  tier: BodyTier | "universe"; color?: string; size?: number; region?: boolean;
}) {
  const common = { width: size, height: size, viewBox: "0 0 16 16", fill: "none", "aria-hidden": true } as const;
  if (region) {
    return (
      <svg {...common}>
        <circle cx="8" cy="8" r="5.5" stroke={color} strokeWidth="1.3" strokeDasharray="1.6 1.8" />
        <circle cx="8" cy="8" r="1.4" fill={color} />
      </svg>
    );
  }
  switch (tier) {
    case "universe":
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="6" stroke={color} strokeWidth="1.2" opacity="0.6" />
          <circle cx="5" cy="6" r="1.1" fill={color} />
          <circle cx="10.5" cy="5" r="0.8" fill={color} />
          <circle cx="9.5" cy="10.5" r="1.3" fill={color} />
        </svg>
      );
    case "galaxy":
      return (
        <svg {...common}>
          <path d="M8 8c0-1.6 1.6-2.4 2.9-1.5 1.7 1.2 1 4.1-1.2 4.8C6.9 12.2 4 10.4 4 7.4 4 4.6 6.6 2.6 9.4 3" stroke={color} strokeWidth="1.4" strokeLinecap="round" />
          <circle cx="8" cy="8" r="1.2" fill={color} />
        </svg>
      );
    case "star":
      return (
        <svg {...common}>
          <path d="M8 1.8 9.3 6.7 14.2 8 9.3 9.3 8 14.2 6.7 9.3 1.8 8 6.7 6.7Z" fill={color} />
        </svg>
      );
    case "planet":
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="3.8" fill={color} />
          <ellipse cx="8" cy="8" rx="7" ry="2.3" stroke={color} strokeWidth="1.1" transform="rotate(-18 8 8)" opacity="0.8" />
        </svg>
      );
    case "moon":
      return (
        <svg {...common}>
          <path d="M10.8 2.9A5.6 5.6 0 1 0 13.1 11 4.6 4.6 0 0 1 10.8 2.9Z" fill={color} />
        </svg>
      );
  }
}

/** Display colour for a body in UI chrome (galaxies/stars have their own; worlds use a type tint). */
export function bodyUiColor(b: Body): string {
  if (b.tier === "planet") return "#7fb2e6";
  if (b.tier === "moon") return "#b9b2a8";
  return b.color;
}

// ─── Atlas ────────────────────────────────────────────────────────────────────

type Props = {
  universe: Universe;
  focusIndex: number;
  selectedIndex: number | null;
  onNavigate: (index: number) => void;
  onHover: (index: number | null) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
};

const PAGE = 60;

function sortChildren(u: Universe, ids: number[]): number[] {
  return [...ids].sort((a, b) => {
    const A = u.bodies[a], B = u.bodies[b];
    return (A.region ? 1 : 0) - (B.region ? 1 : 0) || B.descendants - A.descendants || B.size - A.size || A.name.localeCompare(B.name);
  });
}

export function OrreryAtlas({ universe: u, focusIndex, selectedIndex, onNavigate, onHover, collapsed, onToggleCollapsed }: Props) {
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  const [limits, setLimits] = useState<Map<number, number>>(() => new Map());
  const rowRefs = useRef(new Map<number, HTMLDivElement>());
  const scrollRef = useRef<HTMLDivElement>(null);

  const sortedRoots = useMemo(() => sortChildren(u, u.roots), [u]);
  const galaxies = sortedRoots.filter((i) => !u.bodies[i].region);
  const regions = sortedRoots.filter((i) => u.bodies[i].region);

  // Keep the path to the focus / selection open
  const active = selectedIndex ?? (focusIndex >= 0 ? focusIndex : null);
  useEffect(() => {
    if (active === null) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      let p = u.bodies[active].parent;
      while (p >= 0) { next.add(p); p = u.bodies[p].parent; }
      return next;
    });
    // Reveal the row if it sits past the paging limit
    const parent = u.bodies[active].parent;
    if (parent >= 0) {
      const pos = sortChildren(u, u.bodies[parent].children).indexOf(active);
      setLimits((prev) => {
        if (pos < (prev.get(parent) ?? PAGE)) return prev;
        const next = new Map(prev);
        next.set(parent, pos + PAGE);
        return next;
      });
    }
    const t = setTimeout(() => {
      rowRefs.current.get(active)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }, 60);
    return () => clearTimeout(t);
  }, [active, u]);

  const pathSet = useMemo(() => {
    const s = new Set<number>();
    let p = active ?? -1;
    while (p >= 0) { s.add(p); p = u.bodies[p].parent; }
    return s;
  }, [active, u]);

  function toggle(i: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  }

  function renderRow(i: number, depth: number): React.ReactNode {
    const b = u.bodies[i];
    const open = expanded.has(i);
    const isActive = i === active;
    const onPath = pathSet.has(i) && !isActive;
    const kids = open ? sortChildren(u, b.children) : [];
    const limit = limits.get(i) ?? PAGE;
    return (
      <div key={i}>
        <div
          ref={(el) => { if (el) rowRefs.current.set(i, el); else rowRefs.current.delete(i); }}
          onMouseEnter={() => onHover(i)}
          onMouseLeave={() => onHover(null)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            height: 26,
            padding: `0 10px 0 ${8 + depth * 14}px`,
            cursor: "pointer",
            background: isActive ? "color-mix(in srgb, var(--accent-warm) 16%, transparent)" : "transparent",
            borderLeft: `2px solid ${isActive ? "var(--accent-warm)" : "transparent"}`,
            transition: "background 0.12s",
          }}
          onMouseOver={(e) => { if (!isActive) (e.currentTarget as HTMLElement).style.background = "var(--bg-overlay)"; }}
          onMouseOut={(e) => { if (!isActive) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
        >
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); if (b.children.length) toggle(i); }}
            aria-label={open ? "Collapse" : "Expand"}
            style={{
              width: 14, height: 14, padding: 0, border: "none", background: "transparent",
              color: "var(--text-faint)", cursor: b.children.length ? "pointer" : "default",
              display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
              visibility: b.children.length ? "visible" : "hidden",
            }}
          >
            <svg width="8" height="8" viewBox="0 0 8 8" style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>
              <path d="M2.5 1 5.5 4 2.5 7" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <div onClick={() => onNavigate(i)} style={{ display: "flex", alignItems: "center", gap: 7, flex: 1, minWidth: 0 }}>
            <span style={{ display: "flex", flexShrink: 0 }}>
              <TierGlyph tier={b.tier} region={!!b.region} color={bodyUiColor(b)} size={12} />
            </span>
            <span style={{
              flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              fontFamily: "'Geist', sans-serif", fontSize: 12,
              fontWeight: isActive || onPath ? 500 : 400,
              color: isActive ? "var(--text-primary)" : onPath ? "var(--text-primary)" : "var(--text-secondary)",
            }}>
              {b.name}
            </span>
            {b.children.length > 0 && (
              <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: "var(--text-faint)", flexShrink: 0 }}>
                {b.children.length}
              </span>
            )}
          </div>
        </div>
        {open && kids.slice(0, limit).map((k) => renderRow(k, depth + 1))}
        {open && kids.length > limit && (
          <button
            type="button"
            onClick={() => setLimits((prev) => new Map(prev).set(i, limit + PAGE * 2))}
            style={{
              display: "block", width: "100%", textAlign: "left", height: 24,
              padding: `0 10px 0 ${30 + (depth + 1) * 14}px`, border: "none", background: "transparent",
              fontFamily: "'DM Mono', monospace", fontSize: 10, color: "var(--accent-warm)", cursor: "pointer",
            }}
          >
            + {(kids.length - limit).toLocaleString()} more
          </button>
        )}
      </div>
    );
  }

  const s = u.stats;
  const deep = s.orphanStars + s.orphanPlanets + s.orphanMoons;

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={onToggleCollapsed}
        title="Open atlas (Q)"
        style={{
          position: "absolute", top: 112, left: 24, zIndex: 20,
          display: "flex", alignItems: "center", gap: 8, height: 30, padding: "0 12px",
          borderRadius: 10, border: "1px solid var(--border-default)", background: "var(--panel-bg)",
          backdropFilter: "blur(14px)", boxShadow: "var(--shadow-sm)", cursor: "pointer",
          fontFamily: "'DM Mono', monospace", fontSize: 11, color: "var(--text-muted)",
        }}
      >
        <TierGlyph tier="galaxy" size={12} color="var(--accent-warm)" />
        atlas
        <span style={{ color: "var(--text-faint)" }}>{u.roots.length}</span>
      </button>
    );
  }

  return (
    <div
      style={{
        position: "absolute", top: 112, left: 24, bottom: 76, zIndex: 20, width: 272,
        display: "flex", flexDirection: "column",
        background: "var(--panel-bg)", backdropFilter: "blur(16px) saturate(1.3)",
        border: "1px solid var(--border-default)", borderRadius: 12, boxShadow: "var(--shadow-md)",
        overflow: "hidden",
      }}
      className="animate-fade-up"
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "11px 12px 9px 14px", borderBottom: "1px solid var(--border-subtle)" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-faint)" }}>
            Atlas
          </span>
          <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: "var(--text-muted)" }}>
            {s.galaxies.toLocaleString()} galaxies · {s.stars.toLocaleString()} stars
            {s.planets > 0 ? ` · ${s.planets.toLocaleString()} planets` : ""}
            {s.moons > 0 ? ` · ${s.moons.toLocaleString()} moons` : ""}
          </span>
        </div>
        <button
          type="button"
          onClick={onToggleCollapsed}
          title="Collapse (Q)"
          style={{
            width: 22, height: 22, borderRadius: 6, border: "1px solid var(--border-subtle)", background: "transparent",
            color: "var(--text-faint)", cursor: "pointer", fontSize: 12, lineHeight: 1, padding: 0,
          }}
        >
          ‹
        </button>
      </div>

      <div ref={scrollRef} style={{ overflowY: "auto", flex: 1, padding: "4px 0 8px" }}>
        <div
          onClick={() => onNavigate(-1)}
          onMouseEnter={() => onHover(null)}
          style={{
            display: "flex", alignItems: "center", gap: 7, height: 28, padding: "0 12px 0 14px", cursor: "pointer",
            background: active === null && focusIndex === -1 ? "color-mix(in srgb, var(--accent-warm) 16%, transparent)" : "transparent",
            borderLeft: `2px solid ${active === null && focusIndex === -1 ? "var(--accent-warm)" : "transparent"}`,
          }}
        >
          <TierGlyph tier="universe" size={13} color="var(--accent-warm)" />
          <span style={{ fontFamily: "'Lora', Georgia, serif", fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>
            Whole universe
          </span>
        </div>

        {galaxies.map((i) => renderRow(i, 0))}

        {regions.length > 0 && (
          <>
            <div style={{
              margin: "10px 14px 4px", paddingTop: 10, borderTop: "1px solid var(--border-subtle)",
              display: "flex", justifyContent: "space-between", alignItems: "baseline",
            }}>
              <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-faint)" }}>
                Deep space
              </span>
              <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: "var(--text-faint)" }}>
                {deep.toLocaleString()} unlinked
              </span>
            </div>
            {regions.map((i) => renderRow(i, 0))}
          </>
        )}
      </div>
    </div>
  );
}
