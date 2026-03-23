"use client";

import type { OrreryScale } from "@/components/OrreryCanvas";

type Props = {
  scale: OrreryScale;
  galaxyName?: string;
  starName?: string;
  planetName?: string;
  onNavigateTo: (targetScale: OrreryScale) => void;
};

const SCALE_DEPTH: Record<OrreryScale, number> = {
  universe: 0,
  galaxy: 1,
  "solar-system": 2,
  planet: 3,
};

export function OrreryBreadcrumb({ scale, galaxyName, starName, planetName, onNavigateTo }: Props) {
  if (scale === "universe") return null;

  type Segment = { label: string; targetScale: OrreryScale | null };

  const segments: Segment[] = [{ label: "Universe", targetScale: "universe" }];

  if (SCALE_DEPTH[scale] >= 1) {
    segments.push({ label: galaxyName ?? "Galaxy", targetScale: SCALE_DEPTH[scale] > 1 ? "galaxy" : null });
  }
  if (SCALE_DEPTH[scale] >= 2) {
    segments.push({ label: starName ?? "Star", targetScale: SCALE_DEPTH[scale] > 2 ? "solar-system" : null });
  }
  if (SCALE_DEPTH[scale] >= 3) {
    segments.push({ label: planetName ?? "Planet", targetScale: null });
  }

  return (
    <div
      style={{
        position: "absolute",
        top: 20,
        left: 24,
        zIndex: 20,
        display: "flex",
        alignItems: "center",
        gap: 2,
        fontFamily: "'DM Mono', monospace",
        fontSize: 10,
        letterSpacing: "0.05em",
      }}
    >
      {segments.map((seg, i) => (
        <span key={i} style={{ display: "flex", alignItems: "center", gap: 2 }}>
          {i > 0 && (
            <span style={{ color: "rgba(255,255,255,0.18)", fontSize: 9, padding: "0 2px" }}>→</span>
          )}
          {seg.targetScale !== null ? (
            <button
              type="button"
              onClick={() => onNavigateTo(seg.targetScale!)}
              style={{
                background: "none",
                border: "none",
                padding: "2px 5px",
                cursor: "pointer",
                fontFamily: "inherit",
                fontSize: "inherit",
                letterSpacing: "inherit",
                color: "rgba(255,255,255,0.38)",
                borderRadius: 4,
                transition: "color 0.15s, background 0.15s",
              }}
              onMouseEnter={(e) => {
                const el = e.currentTarget as HTMLElement;
                el.style.color = "rgba(255,255,255,0.85)";
                el.style.background = "rgba(255,255,255,0.07)";
              }}
              onMouseLeave={(e) => {
                const el = e.currentTarget as HTMLElement;
                el.style.color = "rgba(255,255,255,0.38)";
                el.style.background = "none";
              }}
            >
              {seg.label}
            </button>
          ) : (
            <span style={{ color: "rgba(255,255,255,0.72)", padding: "2px 5px" }}>
              {seg.label}
            </span>
          )}
        </span>
      ))}
    </div>
  );
}
