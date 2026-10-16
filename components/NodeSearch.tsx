"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { GraphNode } from "@/lib/types";

type Props = {
  nodes: GraphNode[];
  onPick: (node: GraphNode) => void;
  /** Disable the "/" and ⌘K shortcuts (e.g. while pointer-locked in street view). */
  shortcutsDisabled?: boolean;
};

const MAX_RESULTS = 8;

function score(name: string, q: string): number {
  const n = name.toLowerCase();
  if (n === q) return 0;
  if (n.startsWith(q)) return 1;
  if (n.includes(` ${q}`) || n.includes(`-${q}`) || n.includes(`(${q}`)) return 2;
  if (n.includes(q)) return 3;
  return -1;
}

/**
 * Compact node finder. Collapsed it's a 28px icon button matching the other
 * top-bar controls; "/" or ⌘K expands it into an input with a result list.
 */
export function NodeSearch({ nodes, onPick, shortcutsDisabled = false }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const scored: Array<{ node: GraphNode; s: number }> = [];
    for (const node of nodes) {
      const s = score(node.name, q);
      if (s >= 0) scored.push({ node, s });
    }
    scored.sort((a, b) => a.s - b.s || a.node.name.length - b.node.name.length);
    return scored.slice(0, MAX_RESULTS).map((r) => r.node);
  }, [nodes, query]);

  useEffect(() => { setActive(0); }, [query]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Global shortcuts
  useEffect(() => {
    if (shortcutsDisabled) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shortcutsDisabled]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function close() {
    setOpen(false);
    setQuery("");
  }

  function pick(node: GraphNode) {
    onPick(node);
    close();
  }

  return (
    <div ref={rootRef} style={{ position: "relative" }}>
      {open ? (
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Escape") close();
            else if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(results.length - 1, a + 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
            else if (e.key === "Enter" && results[active]) pick(results[active]);
          }}
          placeholder={`Search ${nodes.length.toLocaleString()} nodes…`}
          spellCheck={false}
          style={{
            width: 260,
            height: 28,
            borderRadius: 8,
            border: "1px solid var(--accent-warm)",
            background: "var(--panel-bg)",
            backdropFilter: "blur(12px)",
            boxShadow: "var(--shadow-sm)",
            padding: "0 10px",
            fontFamily: "'DM Mono', monospace",
            fontSize: 11,
            color: "var(--text-primary)",
            outline: "none",
          }}
        />
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          title="Search nodes  ( / )"
          aria-label="Search nodes"
          style={{
            width: 28,
            height: 28,
            borderRadius: 8,
            border: "1px solid var(--border-default)",
            background: "var(--panel-bg)",
            backdropFilter: "blur(12px)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--text-muted)",
            boxShadow: "var(--shadow-sm)",
            transition: "background 0.15s, color 0.15s",
            padding: 0,
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.background = "var(--bg-overlay)";
            (e.currentTarget as HTMLElement).style.color = "var(--text-primary)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.background = "var(--panel-bg)";
            (e.currentTarget as HTMLElement).style.color = "var(--text-muted)";
          }}
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="7" cy="7" r="4.75" stroke="currentColor" strokeWidth="1.6" />
            <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      )}

      {open && results.length > 0 && (
        <div
          style={{
            position: "absolute",
            top: 34,
            right: 0,
            width: 320,
            background: "var(--panel-bg)",
            backdropFilter: "blur(20px) saturate(1.4)",
            border: "1px solid var(--border-default)",
            borderRadius: 10,
            boxShadow: "var(--shadow-md)",
            padding: 4,
            zIndex: 40,
          }}
        >
          {results.map((node, i) => (
            <button
              key={node.id}
              type="button"
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(node)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 9,
                width: "100%",
                padding: "7px 10px",
                border: "none",
                borderRadius: 7,
                background: i === active ? "var(--bg-overlay)" : "transparent",
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: node.color, flexShrink: 0 }} />
              <span style={{
                flex: 1,
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontFamily: "'Geist', sans-serif",
                fontSize: 12,
                color: "var(--text-primary)",
              }}>
                {node.name}
              </span>
              <span style={{
                flexShrink: 0,
                maxWidth: 110,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontFamily: "'DM Mono', monospace",
                fontSize: 10,
                color: "var(--text-faint)",
              }}>
                {node.databaseName}
              </span>
            </button>
          ))}
        </div>
      )}
      {open && query.trim() && results.length === 0 && (
        <div style={{
          position: "absolute", top: 34, right: 0, width: 260,
          background: "var(--panel-bg)", border: "1px solid var(--border-default)", borderRadius: 10,
          padding: "8px 12px", fontFamily: "'DM Mono', monospace", fontSize: 11, color: "var(--text-faint)",
          boxShadow: "var(--shadow-sm)",
        }}>
          No matches
        </div>
      )}
    </div>
  );
}

export function nodeToDetail(node: GraphNode) {
  return {
    id: node.id,
    name: node.name,
    createdBy: node.createdBy,
    createdTime: node.createdTime,
    databaseName: node.databaseName,
    databaseId: node.databaseId,
    notionUrl: node.notionUrl,
    fieldValues: node.fieldValues,
  };
}
