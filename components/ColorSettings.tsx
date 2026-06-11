"use client";

import { useState } from "react";

type Props = {
  databaseColors: Record<string, string>;
};

// Keyboard focus ring for inline-styled controls — brand focus state
// (2px accent outline, offset 2; applies only to :focus-visible, not mouse clicks)
const focusRing = {
  onFocus: (e: { currentTarget: HTMLElement }) => {
    if (e.currentTarget.matches(":focus-visible")) {
      e.currentTarget.style.outline = "2px solid var(--accent-warm)";
      e.currentTarget.style.outlineOffset = "2px";
    }
  },
  onBlur: (e: { currentTarget: HTMLElement }) => {
    e.currentTarget.style.outline = "";
    e.currentTarget.style.outlineOffset = "";
  },
};

export function ColorSettings({ databaseColors }: Props) {
  const [expanded, setExpanded] = useState(false);
  const entries = Object.entries(databaseColors);

  return (
    <div style={{
      position: "absolute",
      top: 20,
      left: "50%",
      transform: "translateX(-50%)",
      zIndex: 20,
    }}>
      <div style={{
        background: "var(--panel-bg)",
        backdropFilter: "blur(12px)",
        border: "1px solid var(--border-default)",
        borderRadius: 10,
        boxShadow: "var(--shadow-md)",
        overflow: "hidden",
        minWidth: 200,
      }}>
        <button
          type="button" {...focusRing}
          onClick={() => setExpanded((v) => !v)}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            width: "100%",
            padding: "8px 14px",
            background: "transparent",
            border: "none",
            cursor: "pointer",
            gap: 24,
            color: "var(--text-secondary)",
            fontFamily: "'DM Mono', monospace",
            fontSize: 11,
            fontWeight: 500,
            letterSpacing: "0.05em",
          }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {entries.slice(0, 4).map(([name, color]) => (
              <span
                key={name}
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: color,
                  flexShrink: 0,
                }}
              />
            ))}
            <span style={{ color: "var(--text-muted)" }}>
              {entries.length} databases
            </span>
          </span>
          <span style={{ fontSize: 9, color: "var(--text-faint)", transform: expanded ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>▼</span>
        </button>

        {expanded && entries.length > 0 && (
          <div style={{
            borderTop: "1px solid var(--border-subtle)",
            padding: "8px 0",
          }}>
            {entries.map(([name, color]) => (
              <div
                key={name}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 9,
                  padding: "4px 14px",
                }}
              >
                <span style={{
                  width: 9,
                  height: 9,
                  borderRadius: "50%",
                  background: color,
                  flexShrink: 0,
                  boxShadow: `0 0 6px ${color}66`,
                }} />
                <span style={{
                  fontFamily: "'Geist', sans-serif",
                  fontSize: 12,
                  color: "var(--text-secondary)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  maxWidth: 160,
                }}>
                  {name}
                </span>
              </div>
            ))}
          </div>
        )}

        {expanded && entries.length === 0 && (
          <div style={{
            borderTop: "1px solid var(--border-subtle)",
            padding: "10px 14px",
            fontFamily: "'Geist', sans-serif",
            fontSize: 12,
            color: "var(--text-faint)",
          }}>
            No databases synced yet
          </div>
        )}
      </div>
    </div>
  );
}
