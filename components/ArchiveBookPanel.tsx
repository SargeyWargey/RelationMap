"use client";

import type { ArchiveBook } from "@/lib/archiveLayout";
import type { GraphData } from "@/lib/types";

// ─── Types ────────────────────────────────────────────────────────────────────

type Props = {
  book:       ArchiveBook | null;
  graph:      GraphData;
  onClose:    () => void;
  onNavigate: (nodeId: string) => void;
};

// ─── Component ────────────────────────────────────────────────────────────────

export function ArchiveBookPanel({ book, graph, onClose, onNavigate }: Props) {
  // Panel always mounts; slide-in is driven by book !== null
  const open = book !== null;

  // Collect connected nodes from live graph edges
  const connectedNodes = (() => {
    if (!book) return [];
    const ids = new Set<string>();
    for (const edge of graph.edges) {
      if (edge.source === book.id) ids.add(edge.target);
      if (edge.target === book.id) ids.add(edge.source);
    }
    return graph.nodes.filter((n) => ids.has(n.id));
  })();

  const createdDate = book?.createdTime
    ? new Date(book.createdTime).toLocaleDateString(undefined, {
        year: "numeric", month: "short", day: "numeric",
      })
    : "—";

  // ── Shared style tokens ──────────────────────────────────────────────────────
  const BG     = "rgba(14, 7, 2, 0.96)";
  const BORDER = "rgba(255, 213, 158, 0.13)";
  const DIM    = "rgba(255, 213, 158, 0.48)";
  const BRIGHT = "#f0e8d8";
  const MONO   = "'DM Mono', 'Courier New', monospace";
  const SERIF  = "Lora, Georgia, serif";

  return (
    <div
      style={{
        position:        "absolute",
        top:             0,
        right:           0,
        width:           300,
        height:          "100%",
        background:      BG,
        backdropFilter:  "blur(14px)",
        borderLeft:      `1px solid ${BORDER}`,
        overflowY:       "auto",
        zIndex:          20,
        color:           BRIGHT,
        transform:       open ? "translateX(0)" : "translateX(100%)",
        transition:      "transform 0.22s ease",
        // Prevent clicks on panel from passing through to canvas
        pointerEvents:   open ? "all" : "none",
      }}
    >
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div
        style={{
          padding:      "20px 18px 16px",
          borderBottom: `1px solid ${BORDER}`,
          display:      "flex",
          alignItems:   "flex-start",
          gap:          10,
        }}
      >
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontSize:      10,
              letterSpacing: "0.12em",
              color:         DIM,
              textTransform: "uppercase",
              fontFamily:    MONO,
              marginBottom:  6,
            }}
          >
            {book?.databaseName ?? ""}
          </div>
          <div
            style={{
              fontSize:   17,
              fontWeight: 600,
              fontFamily: SERIF,
              lineHeight: 1.3,
              color:      BRIGHT,
            }}
          >
            {book?.name ?? ""}
          </div>
        </div>

        {/* Close button (T-32) */}
        <button
          onClick={onClose}
          aria-label="Close"
          style={{
            background:  "none",
            border:      "none",
            cursor:      "pointer",
            color:       DIM,
            fontSize:    22,
            lineHeight:  1,
            padding:     "0 4px",
            flexShrink:  0,
            marginTop:   -2,
          }}
        >
          ×
        </button>
      </div>

      {/* ── Meta ─────────────────────────────────────────────────────────── */}
      <div
        style={{
          padding:       "12px 18px",
          borderBottom:  `1px solid ${BORDER}`,
          fontSize:      12,
          color:         DIM,
          display:       "flex",
          flexDirection: "column",
          gap:           4,
          fontFamily:    MONO,
        }}
      >
        {book?.createdBy  && <span>by {book.createdBy}</span>}
        <span>created {createdDate}</span>
        <span>{book?.degree ?? 0} connection{(book?.degree ?? 0) !== 1 ? "s" : ""}</span>
      </div>

      {/* ── Field values ─────────────────────────────────────────────────── */}
      {book?.fieldValues && Object.keys(book.fieldValues).length > 0 && (
        <div
          style={{
            padding:      "14px 18px",
            borderBottom: `1px solid ${BORDER}`,
          }}
        >
          <div
            style={{
              fontSize:      10,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color:         DIM,
              fontFamily:    MONO,
              marginBottom:  12,
            }}
          >
            Fields
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {Object.entries(book.fieldValues).map(([key, val]) => {
              if (val === null || val === undefined) return null;
              const display = Array.isArray(val) ? val.join(", ") : val;
              if (!display) return null;
              return (
                <div key={key} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  <span style={{ fontSize: 10, color: DIM, fontFamily: MONO }}>{key}</span>
                  <span style={{ fontSize: 13, lineHeight: 1.45, color: BRIGHT }}>{display}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Notion URL (T-30) ────────────────────────────────────────────── */}
      {book?.notionUrl && (
        <div style={{ padding: "12px 18px", borderBottom: `1px solid ${BORDER}` }}>
          <a
            href={book.notionUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color:          "var(--accent-warm, #d97757)",
              fontSize:       13,
              textDecoration: "none",
              fontFamily:     MONO,
            }}
          >
            Open in Notion ↗
          </a>
        </div>
      )}

      {/* ── Connected nodes (T-31) ───────────────────────────────────────── */}
      {connectedNodes.length > 0 && (
        <div style={{ padding: "14px 18px" }}>
          <div
            style={{
              fontSize:      10,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color:         DIM,
              fontFamily:    MONO,
              marginBottom:  10,
            }}
          >
            Connected ({connectedNodes.length})
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {connectedNodes.map((n) => (
              <button
                key={n.id}
                onClick={() => onNavigate(n.id)}
                style={{
                  background:    "rgba(255,213,158,0.05)",
                  border:        `1px solid ${BORDER}`,
                  borderRadius:  4,
                  padding:       "8px 10px",
                  cursor:        "pointer",
                  textAlign:     "left",
                  color:         BRIGHT,
                  width:         "100%",
                  display:       "flex",
                  flexDirection: "column",
                  gap:           3,
                }}
              >
                <span style={{ fontSize: 13, fontFamily: SERIF, lineHeight: 1.3 }}>
                  {n.name}
                </span>
                <span style={{ fontSize: 10, color: DIM, fontFamily: MONO }}>
                  {n.databaseName}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
