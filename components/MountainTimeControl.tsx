"use client";

import { useEffect, useRef, useState } from "react";

import { formatClock } from "@/components/mountain/daycycle";

type Props = {
  tod: number;
  auto: boolean;
  secondsPerDay: number;
  onAutoChange: (auto: boolean) => void;
  onSpeedChange: (secondsPerDay: number) => void;
  /** Jump (animated, forward through dawn/dusk) or scrub (instant) to a time of day. */
  onSetTime: (tod: number, animate: boolean) => void;
};

export const DAY_SPEEDS: Array<[number, string]> = [[600, "10 min"], [180, "3 min"], [60, "1 min"], [15, "15 s"]];

const JUMPS: Array<[number, string, string]> = [
  [0.26, "Sunrise", "🌅"],
  [0.52, "Noon", "☀"],
  [0.74, "Sunset", "🌇"],
  [0.97, "Night", "☾"],
];

function phaseIcon(tod: number) {
  const h = tod * 24;
  if (h >= 6.5 && h < 17.5) return "☀";
  if ((h >= 5 && h < 6.5) || (h >= 17.5 && h < 19.5)) return "◐";
  return "☾";
}

/** Clock pill + popover: auto day/night cycle, its speed, quick jumps and a scrubber. */
export function MountainTimeControl({ tod, auto, secondsPerDay, onAutoChange, onSpeedChange, onSetTime }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const chip = (active: boolean): React.CSSProperties => ({
    flex: 1, height: 24, borderRadius: 6, border: "none", cursor: "pointer",
    background: active ? "var(--accent-warm)" : "var(--bg-overlay)",
    color: active ? "#fff" : "var(--text-muted)",
    fontFamily: "'Geist', sans-serif", fontSize: 11, fontWeight: 500,
  });

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Time of day"
        style={{
          height: 28, display: "flex", alignItems: "center", gap: 7, padding: "0 10px", borderRadius: 8,
          border: `1px solid ${auto ? "var(--accent-warm)" : "var(--border-default)"}`, background: "var(--panel-bg)",
          backdropFilter: "blur(12px)", boxShadow: "var(--shadow-sm)", cursor: "pointer", color: "var(--text-primary)",
        }}
      >
        <span style={{ fontSize: 13, lineHeight: 1 }}>{phaseIcon(tod)}</span>
        <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 11.5, fontVariantNumeric: "tabular-nums" }}>{formatClock(tod)}</span>
        {auto && <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--accent-warm)", animation: "mtn-pulse 1.6s ease-in-out infinite" }} />}
        <style>{"@keyframes mtn-pulse { 0%,100% { opacity: 1 } 50% { opacity: 0.3 } }"}</style>
      </button>
      {open && (
        <div
          className="animate-fade-up"
          style={{
            position: "absolute", top: 36, right: 0, width: 268, padding: 12, borderRadius: 12,
            background: "var(--panel-bg)", backdropFilter: "blur(20px) saturate(1.3)", border: "1px solid var(--border-default)", boxShadow: "var(--shadow-lg)",
            display: "flex", flexDirection: "column", gap: 10,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontFamily: "'Lora', Georgia, serif", fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>Time of day</span>
            <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 12, color: "var(--text-secondary)" }}>{formatClock(tod)}</span>
          </div>

          <input
            type="range" min={0} max={1} step={1 / 288} value={tod}
            onChange={(e) => onSetTime(parseFloat(e.target.value), false)}
            aria-label="Scrub time of day"
            style={{ width: "100%", accentColor: "var(--accent-warm)" }}
          />
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: -6, fontFamily: "'DM Mono', monospace", fontSize: 9, color: "var(--text-faint)" }}>
            <span>00</span><span>06</span><span>12</span><span>18</span><span>24</span>
          </div>

          <div style={{ display: "flex", gap: 4 }}>
            {JUMPS.map(([t, label, icon]) => (
              <button key={label} type="button" onClick={() => onSetTime(t, true)} title={`Go to ${label.toLowerCase()} (holds there)`} style={{ ...chip(false), display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 40, gap: 1 }}>
                <span style={{ fontSize: 13 }}>{icon}</span>
                <span style={{ fontSize: 10 }}>{label}</span>
              </button>
            ))}
          </div>

          <div style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
            <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}>
              <span style={{ fontFamily: "'Geist', sans-serif", fontSize: 12, fontWeight: 500, color: "var(--text-primary)" }}>Auto day/night cycle</span>
              <button
                type="button"
                onClick={() => onAutoChange(!auto)}
                aria-pressed={auto}
                style={{ width: 32, height: 18, borderRadius: 9, border: "none", padding: 0, cursor: "pointer", position: "relative", background: auto ? "var(--accent-warm)" : "var(--border-default)", transition: "background 0.15s" }}
              >
                <span style={{ position: "absolute", top: 2, left: auto ? 16 : 2, width: 14, height: 14, borderRadius: "50%", background: "#fff", transition: "left 0.15s", boxShadow: "0 1px 2px rgba(0,0,0,0.25)" }} />
              </button>
            </label>
            <div>
              <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9.5, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-faint)", marginBottom: 5 }}>One day lasts</div>
              <div style={{ display: "flex", gap: 4 }}>
                {DAY_SPEEDS.map(([spd, label]) => (
                  <button key={spd} type="button" onClick={() => { onSpeedChange(spd); onAutoChange(true); }} style={chip(auto && secondsPerDay === spd)}>{label}</button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
