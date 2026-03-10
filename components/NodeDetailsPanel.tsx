import { useState, useEffect, useRef, useCallback } from "react";
import type { GraphEdge, GraphNode, NodeDetail } from "@/lib/types";

type Props = {
  detail: NodeDetail | null;
  open: boolean;
  onClose: () => void;
  onSelectNode?: (detail: NodeDetail) => void;
  allNodes?: GraphNode[];
  allEdges?: GraphEdge[];
  enabledDbs?: Set<string>;
};

const MIN_WIDTH = 260;
const MAX_WIDTH = 600;

export function NodeDetailsPanel({ detail, open, onClose, onSelectNode, allNodes = [], allEdges = [], enabledDbs }: Props) {
  const [expandedDb, setExpandedDb] = useState<string | null>(null);
  const [width, setWidth] = useState(320);
  const dragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  useEffect(() => {
    setExpandedDb(null);
  }, [detail?.id]);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    dragging.current = true;
    startX.current = e.clientX;
    startWidth.current = width;
    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";

    const onMouseMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const delta = startX.current - ev.clientX;
      setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth.current + delta)));
    };
    const onMouseUp = () => {
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }, [width]);

  function toggleDb(dbName: string) {
    setExpandedDb((prev) => (prev === dbName ? null : dbName));
  }

  const createdDate = detail
    ? new Date(detail.createdTime).toLocaleDateString(undefined, {
        weekday: "short",
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : null;

  const createdTime = detail
    ? new Date(detail.createdTime).toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      })
    : null;

  // Build node lookup
  const nodeMap = new Map(allNodes.map((n) => [n.id, n]));

  // Find all edges connected to this node where both endpoints are in enabled dbs
  const connectedNodes: { node: GraphNode; relationName: string }[] = [];
  if (detail) {
    for (const edge of allEdges) {
      let neighborId: string | null = null;
      if (edge.source === detail.id) neighborId = edge.target;
      else if (edge.target === detail.id) neighborId = edge.source;
      if (!neighborId) continue;
      const neighbor = nodeMap.get(neighborId);
      if (!neighbor) continue;
      if (enabledDbs && !enabledDbs.has(neighbor.databaseId)) continue;
      connectedNodes.push({ node: neighbor, relationName: edge.relationName });
    }
  }

  // Group by databaseName
  const connectionsByDb = new Map<string, { node: GraphNode; relationName: string }[]>();
  for (const conn of connectedNodes) {
    const key = conn.node.databaseName;
    if (!connectionsByDb.has(key)) connectionsByDb.set(key, []);
    connectionsByDb.get(key)!.push(conn);
  }

  return (
    <aside
      style={{
        position: "absolute",
        top: 0,
        right: 0,
        bottom: 0,
        width,
        zIndex: 40,
        transform: open ? "translateX(0)" : `translateX(${width + 20}px)`,
        transition: "transform 0.35s cubic-bezier(0.32, 0, 0.15, 1)",
        display: "flex",
        flexDirection: "column",
        background: "var(--panel-bg)",
        backdropFilter: "blur(20px) saturate(1.4)",
        borderLeft: "1px solid var(--panel-border)",
        boxShadow: "var(--shadow-panel)",
      }}
    >
      {/* Resize handle */}
      <div
        onMouseDown={onMouseDown}
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: 5,
          cursor: "ew-resize",
          zIndex: 10,
        }}
      />

      {/* Header */}
      <div style={{
        padding: "20px 20px 16px",
        borderBottom: "1px solid var(--border-subtle)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 12,
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontFamily: "'DM Mono', monospace",
            fontSize: 10,
            fontWeight: 400,
            color: "var(--text-faint)",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            marginBottom: 6,
          }}>
            Page Details
          </div>
          {detail ? (
            <h2 style={{
              margin: 0,
              fontFamily: "'Lora', Georgia, serif",
              fontSize: 18,
              fontWeight: 600,
              color: "var(--text-primary)",
              lineHeight: 1.3,
              wordBreak: "break-word",
            }}>
              {detail.name}
            </h2>
          ) : (
            <div style={{
              height: 22,
              width: "70%",
              background: "var(--bg-overlay)",
              borderRadius: 4,
            }} />
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          style={{
            flexShrink: 0,
            width: 28,
            height: 28,
            border: "1px solid var(--border-default)",
            borderRadius: 7,
            background: "var(--bg-surface)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--text-muted)",
            fontSize: 14,
            transition: "background 0.15s, color 0.15s",
            marginTop: 2,
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = "var(--bg-overlay)";
            (e.currentTarget as HTMLButtonElement).style.color = "var(--accent-warm)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = "var(--bg-surface)";
            (e.currentTarget as HTMLButtonElement).style.color = "var(--text-muted)";
          }}
          aria-label="Close panel"
        >
          ✕
        </button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
        {detail ? (
          <>
            <dl style={{ margin: 0 }}>
              {[
                { label: "Database", value: detail.databaseName },
                { label: "Date", value: createdDate },
                { label: "Time", value: createdTime },
              ].map(({ label, value }) => (
                <div
                  key={label}
                  style={{
                    marginBottom: 12,
                    paddingBottom: 12,
                    borderBottom: "1px solid var(--border-subtle)",
                  }}
                >
                  <dt style={{
                    fontFamily: "'DM Mono', monospace",
                    fontSize: 10,
                    fontWeight: 500,
                    color: "var(--text-faint)",
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    marginBottom: 3,
                  }}>
                    {label}
                  </dt>
                  <dd style={{
                    margin: 0,
                    fontFamily: "'Geist', sans-serif",
                    fontSize: 13,
                    fontWeight: 400,
                    color: "var(--text-primary)",
                    lineHeight: 1.5,
                  }}>
                    {value ?? "—"}
                  </dd>
                </div>
              ))}
            </dl>

            {/* Connections section */}
            <div style={{ marginTop: 4 }}>
              <div style={{
                fontFamily: "'DM Mono', monospace",
                fontSize: 10,
                fontWeight: 500,
                color: "var(--text-faint)",
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                marginBottom: 10,
              }}>
                Connections{connectedNodes.length > 0 ? ` · ${connectedNodes.length}` : ""}
              </div>

              {connectionsByDb.size === 0 ? (
                <div style={{
                  fontFamily: "'Geist', sans-serif",
                  fontSize: 12,
                  color: "var(--text-faint)",
                  fontStyle: "italic",
                }}>
                  No visible connections
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  {Array.from(connectionsByDb.entries()).map(([dbName, conns]) => {
                    const color = conns[0].node.color;
                    const isExpanded = expandedDb === dbName;
                    return (
                      <div key={dbName}>
                        {/* Accordion header — clickable db row */}
                        <button
                          type="button"
                          onClick={() => toggleDb(dbName)}
                          style={{
                            width: "100%",
                            display: "flex",
                            alignItems: "center",
                            gap: 7,
                            padding: "6px 8px",
                            borderRadius: isExpanded ? "7px 7px 0 0" : 7,
                            background: isExpanded ? "var(--bg-overlay)" : "transparent",
                            border: isExpanded ? "1px solid var(--border-subtle)" : "1px solid transparent",
                            borderBottom: isExpanded ? "none" : undefined,
                            cursor: "pointer",
                            textAlign: "left",
                            transition: "background 0.12s",
                          }}
                          onMouseEnter={(e) => {
                            if (!isExpanded) (e.currentTarget as HTMLElement).style.background = "var(--bg-overlay)";
                          }}
                          onMouseLeave={(e) => {
                            if (!isExpanded) (e.currentTarget as HTMLElement).style.background = "transparent";
                          }}
                        >
                          <span style={{
                            width: 8,
                            height: 8,
                            borderRadius: "50%",
                            background: color,
                            flexShrink: 0,
                            display: "inline-block",
                          }} />
                          <span style={{
                            flex: 1,
                            fontFamily: "'DM Mono', monospace",
                            fontSize: 10,
                            fontWeight: 500,
                            color: "var(--text-muted)",
                            letterSpacing: "0.06em",
                            textTransform: "uppercase",
                          }}>
                            {dbName}
                          </span>
                          <span style={{
                            fontFamily: "'DM Mono', monospace",
                            fontSize: 9,
                            color: "var(--text-faint)",
                            marginRight: 2,
                          }}>
                            {conns.length}
                          </span>
                          <svg
                            width="10" height="10" viewBox="0 0 10 10" fill="none"
                            style={{
                              flexShrink: 0,
                              color: "var(--text-faint)",
                              transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
                              transition: "transform 0.15s",
                            }}
                          >
                            <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </button>

                        {/* Expanded connection rows */}
                        {isExpanded && (
                          <div style={{
                            border: "1px solid var(--border-subtle)",
                            borderTop: "none",
                            borderRadius: "0 0 7px 7px",
                            overflow: "hidden",
                            marginBottom: 2,
                          }}>
                            {conns.map(({ node, relationName }, i) => (
                              <button
                                key={`${node.id}-${relationName}-${i}`}
                                type="button"
                                onClick={() => onSelectNode?.({
                                  id: node.id,
                                  name: node.name,
                                  createdBy: node.createdBy,
                                  createdTime: node.createdTime,
                                  databaseName: node.databaseName,
                                  notionUrl: node.notionUrl,
                                })}
                                style={{
                                  width: "100%",
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 8,
                                  padding: "6px 8px",
                                  background: "var(--bg-overlay)",
                                  border: "none",
                                  borderTop: i > 0 ? "1px solid var(--border-subtle)" : "none",
                                  cursor: "pointer",
                                  textAlign: "left",
                                  transition: "background 0.1s",
                                }}
                                onMouseEnter={(e) => {
                                  (e.currentTarget as HTMLElement).style.background = "var(--bg-surface)";
                                }}
                                onMouseLeave={(e) => {
                                  (e.currentTarget as HTMLElement).style.background = "var(--bg-overlay)";
                                }}
                              >
                                <span style={{
                                  flex: 1,
                                  fontFamily: "'Geist', sans-serif",
                                  fontSize: 12,
                                  color: "var(--text-primary)",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                }}>
                                  {node.name}
                                </span>
                                <span style={{
                                  flexShrink: 0,
                                  fontFamily: "'DM Mono', monospace",
                                  fontSize: 9,
                                  color: "var(--text-faint)",
                                  background: "var(--bg-surface)",
                                  border: "1px solid var(--border-subtle)",
                                  borderRadius: 4,
                                  padding: "1px 5px",
                                  letterSpacing: "0.04em",
                                  maxWidth: 90,
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                }}>
                                  {relationName}
                                </span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        ) : (
          <div style={{ color: "var(--text-faint)", fontSize: 13, fontFamily: "'Geist', sans-serif", textAlign: "center", marginTop: 40 }}>
            Select a node to view details
          </div>
        )}
      </div>

      {/* Footer CTA */}
      {detail && (
        <div style={{
          padding: "16px 20px",
          borderTop: "1px solid var(--border-subtle)",
        }}>
          <a
            href={detail.notionUrl}
            target="_blank"
            rel="noreferrer"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              width: "100%",
              padding: "10px 16px",
              background: "var(--accent-warm)",
              color: "#fff",
              borderRadius: 10,
              fontSize: 13,
              fontWeight: 500,
              fontFamily: "'Geist', sans-serif",
              textDecoration: "none",
              letterSpacing: "0.01em",
              transition: "background 0.15s, transform 0.1s",
              boxShadow: "0 2px 8px rgba(217, 119, 87, 0.35)",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLAnchorElement).style.background = "var(--accent-rust)";
              (e.currentTarget as HTMLAnchorElement).style.transform = "translateY(-1px)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLAnchorElement).style.background = "var(--accent-warm)";
              (e.currentTarget as HTMLAnchorElement).style.transform = "translateY(0)";
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
            Open in Notion
          </a>

          {/* Notion icon hint */}
          <p style={{
            margin: "10px 0 0",
            textAlign: "center",
            fontFamily: "'DM Mono', monospace",
            fontSize: 10,
            color: "var(--text-faint)",
          }}>
            Opens in your browser
          </p>
        </div>
      )}
    </aside>
  );
}
