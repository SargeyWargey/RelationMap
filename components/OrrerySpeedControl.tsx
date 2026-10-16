"use client";

type Props = {
  speed: number;
  paused: boolean;
  onSpeedChange: (speed: number) => void;
  onPausedChange: (paused: boolean) => void;
};

const SPEEDS = [0.25, 1, 4, 16];

/** Pause + time-warp control for all orbital motion. */
export function OrrerySpeedControl({ speed, paused, onSpeedChange, onPausedChange }: Props) {
  return (
    <div
      style={{
        display: "flex", alignItems: "center", gap: 4, height: 32, padding: "0 4px",
        background: "var(--panel-bg)", backdropFilter: "blur(14px)",
        border: "1px solid var(--border-default)", borderRadius: 10, boxShadow: "var(--shadow-sm)",
      }}
    >
      <button
        type="button"
        onClick={() => onPausedChange(!paused)}
        title={paused ? "Resume orbits (space)" : "Pause orbits (space)"}
        aria-label={paused ? "Resume" : "Pause"}
        style={{
          width: 26, height: 24, borderRadius: 7, border: "none", cursor: "pointer",
          background: paused ? "var(--accent-warm)" : "var(--bg-overlay)",
          color: paused ? "#fff" : "var(--text-muted)",
          display: "flex", alignItems: "center", justifyContent: "center", padding: 0,
          transition: "background 0.15s, color 0.15s",
        }}
      >
        {paused ? (
          <svg width="10" height="10" viewBox="0 0 10 10"><path d="M2.5 1.2v7.6L8.6 5Z" fill="currentColor" /></svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10"><rect x="2" y="1.5" width="2" height="7" rx="0.6" fill="currentColor" /><rect x="6" y="1.5" width="2" height="7" rx="0.6" fill="currentColor" /></svg>
        )}
      </button>
      <span style={{ width: 1, height: 14, background: "var(--border-default)", margin: "0 3px" }} />
      {SPEEDS.map((s) => {
        const active = !paused && Math.abs(speed - s) < 1e-6;
        return (
          <button
            key={s}
            type="button"
            onClick={() => { onSpeedChange(s); onPausedChange(false); }}
            title={`Time ×${s}`}
            style={{
              height: 24, minWidth: 38, padding: "0 7px", borderRadius: 7, border: "none", cursor: "pointer",
              background: active ? "var(--bg-overlay)" : "transparent",
              color: active ? "var(--text-primary)" : "var(--text-faint)",
              fontFamily: "'DM Mono', monospace", fontSize: 11, fontWeight: active ? 500 : 400,
              transition: "background 0.12s, color 0.12s",
            }}
          >
            {s < 1 ? "¼" : s}×
          </button>
        );
      })}
    </div>
  );
}
