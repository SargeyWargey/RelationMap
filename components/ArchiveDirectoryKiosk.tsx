"use client";

import { useState, useMemo } from "react";
import type { ArchiveAisle, ArchiveBook } from "@/lib/archiveLayout";

// ─── Types ────────────────────────────────────────────────────────────────────

type Props = {
  aisles:          ArchiveAisle[];
  books:           ArchiveBook[];
  nearEntrance:    boolean;
  onNavigateAisle: (aisle: ArchiveAisle) => void;
  onNavigateBook:  (nodeId: string) => void;
};

// ─── Component ────────────────────────────────────────────────────────────────

export function ArchiveDirectoryKiosk({
  aisles,
  books,
  nearEntrance,
  onNavigateAisle,
  onNavigateBook,
}: Props) {
  const [query, setQuery] = useState("");

  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return books.filter((b) => b.name.toLowerCase().includes(q)).slice(0, 8);
  }, [query, books]);

  const BG     = "rgba(14, 7, 2, 0.94)";
  const BORDER = "rgba(255, 213, 158, 0.15)";
  const DIM    = "rgba(255, 213, 158, 0.48)";
  const BRIGHT = "#f0e8d8";
  const MONO   = "'DM Mono', 'Courier New', monospace";
  const SERIF  = "Lora, Georgia, serif";

  return (
    <div
      style={{
        position:       "absolute",
        bottom:         24,
        left:           18,
        width:          256,
        maxHeight:      440,
        background:     BG,
        backdropFilter: "blur(10px)",
        border:         `1px solid ${BORDER}`,
        borderRadius:   4,
        overflowY:      "auto",
        color:          BRIGHT,
        fontFamily:     MONO,
        opacity:        nearEntrance ? 1 : 0,
        transition:     "opacity 0.5s ease",
        pointerEvents:  nearEntrance ? "auto" : "none",
        zIndex:         10,
      }}
    >
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div
        style={{
          padding:       "9px 14px",
          borderBottom:  `1px solid ${BORDER}`,
          fontSize:      10,
          letterSpacing: "0.12em",
          textTransform: "uppercase" as const,
          color:         DIM,
        }}
      >
        Directory
      </div>

      {/* ── Search (T-36) ──────────────────────────────────────────────────── */}
      <div style={{ padding: "10px 12px", borderBottom: `1px solid ${BORDER}` }}>
        <input
          type="text"
          placeholder="Search nodes…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{
            width:        "100%",
            background:   "rgba(255,213,158,0.06)",
            border:       `1px solid ${BORDER}`,
            borderRadius: 3,
            padding:      "5px 8px",
            color:        BRIGHT,
            fontSize:     12,
            fontFamily:   MONO,
            outline:      "none",
            boxSizing:    "border-box" as const,
          }}
        />

        {searchResults.length > 0 && (
          <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 2 }}>
            {searchResults.map((b) => (
              <button
                key={b.id}
                onClick={() => { onNavigateBook(b.id); setQuery(""); }}
                style={{
                  background:    "rgba(255,213,158,0.05)",
                  border:        `1px solid ${BORDER}`,
                  borderRadius:  3,
                  padding:       "5px 8px",
                  cursor:        "pointer",
                  textAlign:     "left",
                  color:         BRIGHT,
                  width:         "100%",
                  display:       "flex",
                  flexDirection: "column",
                  gap:           2,
                }}
              >
                <span style={{ fontSize: 12, fontFamily: SERIF }}>{b.name}</span>
                <span style={{ fontSize: 9, color: DIM }}>{b.databaseName}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Aisle list (T-34 / T-35) ───────────────────────────────────────── */}
      <div style={{ padding: "8px 12px 12px" }}>
        <div
          style={{
            fontSize:      10,
            color:         DIM,
            marginBottom:  8,
            letterSpacing: "0.08em",
            textTransform: "uppercase" as const,
          }}
        >
          Aisles
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {aisles.map((aisle) => (
            <button
              key={aisle.databaseId}
              onClick={() => onNavigateAisle(aisle)}
              style={{
                display:      "flex",
                alignItems:   "center",
                gap:          8,
                background:   "transparent",
                border:       "none",
                borderRadius: 3,
                padding:      "4px 4px",
                cursor:       "pointer",
                textAlign:    "left",
                width:        "100%",
                color:        BRIGHT,
              }}
            >
              {/* Color swatch */}
              <div
                style={{
                  width:        10,
                  height:       10,
                  borderRadius: 2,
                  background:   aisle.color || "#888888",
                  flexShrink:   0,
                }}
              />
              <span style={{ fontSize: 12, flex: 1, fontFamily: SERIF, lineHeight: 1.3 }}>
                {aisle.databaseName}
              </span>
              <span style={{ fontSize: 10, color: DIM, flexShrink: 0 }}>
                {aisle.nodeCount}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
