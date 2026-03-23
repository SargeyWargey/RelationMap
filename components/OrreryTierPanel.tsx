"use client";

import { useState, useMemo } from "react";
import type { GraphData } from "@/lib/types";
import type { OrreryConfig } from "@/lib/orreryTypes";

type Props = {
  orreryConfig: OrreryConfig;
  graphData: GraphData;
};

export function OrreryTierPanel({ orreryConfig, graphData }: Props) {
  const [open, setOpen] = useState(false);

  const dbIdToName = useMemo(() => {
    const map: Record<string, string> = {};
    for (const node of graphData.nodes) {
      if (!map[node.databaseId]) map[node.databaseId] = node.databaseName;
    }
    return map;
  }, [graphData.nodes]);

  const { galaxyDatabaseId, starDatabaseId, planetDatabaseId, moonDatabaseId, ringDatabases } = orreryConfig.tierMapping;

  const coreTiers = [
    { label: "Galaxy", dbId: galaxyDatabaseId },
    { label: "Star",   dbId: starDatabaseId },
    { label: "Planet", dbId: planetDatabaseId },
    { label: "Moon",   dbId: moonDatabaseId },
  ];

  return (
    <>
      {/* Toggle button */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Show tier mapping"
        style={{
          height: 28,
          padding: "0 12px",
          borderRadius: 8,
          border: `1px solid ${open ? "rgba(224,122,53,0.55)" : "rgba(255,255,255,0.15)"}`,
          background: open ? "rgba(224,122,53,0.09)" : "rgba(255,255,255,0.06)",
          backdropFilter: "blur(12px)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 5,
          fontSize: 11,
          fontFamily: "'Geist', sans-serif",
          fontWeight: 500,
          color: open ? "rgba(224,122,53,0.85)" : "rgba(255,255,255,0.5)",
          transition: "background 0.15s, color 0.15s, border-color 0.15s",
          whiteSpace: "nowrap",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.11)";
          (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.85)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.background = open ? "rgba(224,122,53,0.09)" : "rgba(255,255,255,0.06)";
          (e.currentTarget as HTMLElement).style.color = open ? "rgba(224,122,53,0.85)" : "rgba(255,255,255,0.5)";
        }}
      >
        🪐 Tiers
      </button>

      {/* Dropdown panel */}
      {open && (
        <div
          style={{
            position: "fixed",
            top: 56,
            right: 24,
            zIndex: 50,
            width: 270,
            background: "rgba(5,6,13,0.93)",
            backdropFilter: "blur(20px)",
            border: "1px solid rgba(255,255,255,0.11)",
            borderRadius: 14,
            boxShadow: "0 8px 32px rgba(0,0,0,0.45)",
            overflow: "hidden",
          }}
        >
          {/* Header */}
          <div style={{ padding: "13px 18px 10px", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
            <span style={{
              fontFamily: "'Geist', sans-serif",
              fontSize: 13,
              fontWeight: 600,
              color: "rgba(255,255,255,0.82)",
              letterSpacing: "-0.01em",
            }}>
              Tier Mapping
            </span>
          </div>

          {/* Core tiers */}
          <div style={{ padding: "8px 0 4px" }}>
            {coreTiers.map((tier) => (
              <div
                key={tier.label}
                style={{ padding: "5px 18px", display: "flex", alignItems: "center", gap: 12 }}
              >
                <span style={{
                  fontFamily: "'DM Mono', monospace",
                  fontSize: 9,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: "rgba(224,122,53,0.65)",
                  minWidth: 44,
                  flexShrink: 0,
                }}>
                  {tier.label}
                </span>
                <span style={{
                  fontFamily: "'Geist', sans-serif",
                  fontSize: 12,
                  color: "rgba(255,255,255,0.62)",
                  flex: 1,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}>
                  {dbIdToName[tier.dbId] ?? tier.dbId}
                </span>
              </div>
            ))}
          </div>

          {/* Ring/belt databases */}
          {ringDatabases.length > 0 && (
            <>
              <div style={{ height: 1, background: "rgba(255,255,255,0.06)", margin: "4px 18px" }} />
              <div style={{ padding: "4px 0 8px" }}>
                {ringDatabases.map((ring, i) => (
                  <div
                    key={i}
                    style={{ padding: "5px 18px", display: "flex", alignItems: "center", gap: 12 }}
                  >
                    <span style={{
                      fontFamily: "'DM Mono', monospace",
                      fontSize: 9,
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                      color: "rgba(120,180,255,0.65)",
                      minWidth: 44,
                      flexShrink: 0,
                    }}>
                      {ring.subType === "planet-rings" ? "Rings" : "Belt"}
                    </span>
                    <span style={{
                      fontFamily: "'Geist', sans-serif",
                      fontSize: 12,
                      color: "rgba(255,255,255,0.62)",
                      flex: 1,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}>
                      {dbIdToName[ring.databaseId] ?? ring.databaseId}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
