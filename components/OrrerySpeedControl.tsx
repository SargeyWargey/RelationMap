"use client";

type Props = {
  speed: number;
  paused: boolean;
  onSpeedChange: (speed: number) => void;
  onPausedChange: (paused: boolean) => void;
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

export function OrrerySpeedControl({ speed, paused, onSpeedChange, onPausedChange }: Props) {
  return (
    <div
      style={{
        position: "absolute",
        bottom: 20,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 20,
        display: "flex",
        alignItems: "center",
        gap: 10,
        background: "rgba(5,6,13,0.78)",
        backdropFilter: "blur(14px)",
        border: "1px solid rgba(255,255,255,0.10)",
        borderRadius: 10,
        padding: "5px 14px",
        userSelect: "none",
      }}
    >
      {/* Pause / play toggle */}
      <button
        type="button" {...focusRing}
        onClick={() => onPausedChange(!paused)}
        title={paused ? "Resume orbital motion" : "Pause orbital motion"}
        style={{
          width: 22,
          height: 22,
          borderRadius: 6,
          border: `1px solid ${paused ? "var(--accent-warm-glow, rgba(217,119,87,0.35))" : "rgba(255,255,255,0.13)"}`,
          background: paused ? "var(--accent-warm-soft, rgba(217,119,87,0.18))" : "rgba(255,255,255,0.05)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 9,
          color: paused ? "var(--accent-warm)" : "rgba(255,255,255,0.45)",
          transition: "background 0.15s, color 0.15s, border-color 0.15s",
          flexShrink: 0,
          padding: 0,
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.10)";
          (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.85)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.background = paused ? "var(--accent-warm-soft, rgba(217,119,87,0.18))" : "rgba(255,255,255,0.05)";
          (e.currentTarget as HTMLElement).style.color = paused ? "var(--accent-warm)" : "rgba(255,255,255,0.45)";
        }}
      >
        {paused ? "▶" : "⏸"}
      </button>

      {/* Speed slider */}
      <input
        type="range"
        min={0.1}
        max={5}
        step={0.1}
        value={speed}
        onChange={(e) => onSpeedChange(Number(e.target.value))}
        style={{
          width: 76,
          accentColor: "var(--accent-warm)",
          cursor: "pointer",
        }}
      />

      {/* Speed readout */}
      <span
        style={{
          fontFamily: "'DM Mono', monospace",
          fontSize: 9,
          color: "rgba(255,255,255,0.28)",
          letterSpacing: "0.05em",
          whiteSpace: "nowrap",
          minWidth: 24,
        }}
      >
        {speed.toFixed(1)}×
      </span>

      {/* Label */}
      <span
        style={{
          fontFamily: "'DM Mono', monospace",
          fontSize: 9,
          color: "rgba(255,255,255,0.18)",
          letterSpacing: "0.04em",
          whiteSpace: "nowrap",
        }}
      >
        orbital speed
      </span>
    </div>
  );
}
