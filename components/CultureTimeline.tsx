"use client";

import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";

import type { CultureApi } from "@/components/CultureCanvas";
import { buildTicks, formatDay } from "@/lib/lineModel";
import type { CultureWorld } from "@/lib/cultureWorld";

export const SPEEDS: Array<{ label: string; mul: number }> = [
  { label: "½×", mul: 0.5 },
  { label: "1×", mul: 1 },
  { label: "2×", mul: 2 },
  { label: "5×", mul: 5 },
  { label: "10×", mul: 10 },
];
/** 1× plays ten days of history per second. */
export const DAYS_PER_SECOND = 10;

export type CultureStats = { alive: number; active: number; blocked: number; dormant: number; colonies: number };

type Props = {
  world: CultureWorld | null;
  /** The selected record's birth and finish, marked on the chart. */
  marks: { born: number; done: number | null; color: string } | null;
  /** In age stain the time axis doubles as the colour legend. */
  ageLegend: boolean;
  day: number;
  playing: boolean;
  speedMul: number;
  onSpeed: (mul: number) => void;
  apiRef: MutableRefObject<CultureApi | null>;
  left: number;
  right: number;
  stats: CultureStats;
  darkMode: boolean;
};

const CHART_H = 58;
const BASE_Y = 40;

function cssVar(name: string, fallback: string) {
  if (typeof document === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function IconButton({ title, onClick, children, primary = false }: { title: string; onClick: () => void; children: React.ReactNode; primary?: boolean }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      style={{
        width: primary ? 36 : 28, height: primary ? 36 : 28, borderRadius: primary ? 18 : 8, flexShrink: 0, padding: 0, cursor: "pointer",
        border: primary ? "none" : "1px solid var(--border-default)",
        background: primary ? "var(--accent-warm)" : "transparent",
        color: primary ? "#fff" : "var(--text-muted)",
        display: "flex", alignItems: "center", justifyContent: "center",
        boxShadow: primary ? "0 2px 10px rgba(218,119,86,0.35)" : "none",
        transition: "background 0.15s, color 0.15s, transform 0.1s",
      }}
      onMouseEnter={(e) => { if (!primary) { (e.currentTarget as HTMLElement).style.background = "var(--bg-overlay)"; (e.currentTarget as HTMLElement).style.color = "var(--text-primary)"; } }}
      onMouseLeave={(e) => { if (!primary) { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "var(--text-muted)"; } }}
    >
      {children}
    </button>
  );
}

/** Playback bar: a growth chart (births above the line, work finishing below) you can scrub. */
const VIRIDIS = ["#440154", "#3b528b", "#21918c", "#5ec962", "#fde725"];

export function CultureTimeline({ world, marks, ageLegend, day, playing, speedMul, onSpeed, apiRef, left, right, stats, darkMode }: Props) {
  const chartRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const veilRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState<{ x: number; bin: number } | null>(null);

  useEffect(() => {
    const el = chartRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.max(80, el.clientWidth)));
    ro.observe(el);
    setWidth(Math.max(80, el.clientWidth));
    return () => ro.disconnect();
  }, []);

  const ticks = useMemo(() => (world ? buildTicks(world.tMin, world.tMax, "month") : []), [world]);

  // Growth curve: everything ever born, and what's still alive, at the end of each week
  const curve = useMemo(() => {
    if (!world) return null;
    const { bins, binDays, t0 } = world.hist;
    const born = new Float64Array(bins), gone = new Float64Array(bins);
    for (const o of world.organisms) {
      born[Math.min(bins - 1, Math.max(0, Math.floor((o.born - t0) / binDays)))]++;
      if (o.dormantAt !== null) gone[Math.min(bins - 1, Math.max(0, Math.floor((o.dormantAt - t0) / binDays)))]++;
    }
    const total = new Float64Array(bins), alive = new Float64Array(bins);
    let tb = 0, tg = 0;
    for (let b = 0; b < bins; b++) { tb += born[b]; tg += gone[b]; total[b] = tb; alive[b] = tb - tg; }
    return { total, alive, max: Math.max(1, tb) };
  }, [world]);

  // Static chart: redraw when the culture, size or theme changes
  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !world) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(width * dpr);
    c.height = Math.round(CHART_H * dpr);
    const g = c.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, width, CHART_H);
    const { hist, species, tMin, tMax } = world;
    const S = species.length;
    const span = tMax - tMin || 1;
    const xOf = (t: number) => ((t - tMin) / span) * width;
    let maxB = 1, maxD = 1;
    for (let b = 0; b < hist.bins; b++) {
      let sum = 0;
      for (let s = 0; s < S; s++) sum += hist.births[b * S + s];
      maxB = Math.max(maxB, sum);
      maxD = Math.max(maxD, hist.dormant[b]);
    }
    const faint = cssVar("--text-faint", "#888");
    const border = cssVar("--border-subtle", "rgba(128,128,128,0.2)");
    // Month grid
    g.lineWidth = 1;
    for (const tk of ticks) {
      const x = Math.round(xOf(tk.t)) + 0.5;
      g.strokeStyle = border;
      g.beginPath(); g.moveTo(x, 2); g.lineTo(x, CHART_H - 12); g.stroke();
      g.fillStyle = faint;
      g.font = `${tk.major ? 600 : 400} 9px 'DM Mono', monospace`;
      g.fillText(tk.label, x + 3, CHART_H - 2);
    }
    // Births, stacked by species (sqrt scale so quiet weeks still show)
    const bw = width / hist.bins;
    for (let b = 0; b < hist.bins; b++) {
      let sum = 0;
      for (let s = 0; s < S; s++) sum += hist.births[b * S + s];
      if (!sum) continue;
      const h = Math.sqrt(sum / maxB) * (BASE_Y - 4);
      let y = BASE_Y;
      const x0 = xOf(hist.t0 + b * hist.binDays) + 0.6;
      const w = Math.max(1, Math.min(bw, xOf(hist.t0 + (b + 1) * hist.binDays) - x0) - 1.2);
      for (let s = 0; s < S; s++) {
        const n = hist.births[b * S + s];
        if (!n) continue;
        const sh = (n / sum) * h;
        g.fillStyle = species[s].color;
        g.globalAlpha = 0.85;
        g.fillRect(x0, y - sh, w, sh);
        y -= sh;
      }
      g.globalAlpha = 1;
    }
    // Baseline
    g.strokeStyle = cssVar("--border-default", "rgba(128,128,128,0.4)");
    g.beginPath(); g.moveTo(0, BASE_Y + 0.5); g.lineTo(width, BASE_Y + 0.5); g.stroke();
    // Dormancies below
    g.fillStyle = faint;
    g.globalAlpha = 0.75;
    for (let b = 0; b < hist.bins; b++) {
      const n = hist.dormant[b];
      if (!n) continue;
      const h = Math.sqrt(n / maxD) * 8;
      const x0 = xOf(hist.t0 + b * hist.binDays) + 0.6;
      g.fillRect(x0, BASE_Y + 2, Math.max(1, bw - 1.2), h);
    }
    g.globalAlpha = 1;
    // Growth curve over the bars
    if (curve) {
      const yOf = (v: number) => BASE_Y - 2 - (v / curve.max) * (BASE_Y - 6);
      const line = (vals: Float64Array, color: string, alpha: number, dash: number[]) => {
        g.beginPath();
        for (let b = 0; b < hist.bins; b++) {
          const x = Math.min(width, xOf(hist.t0 + (b + 1) * hist.binDays));
          if (b === 0) g.moveTo(xOf(hist.t0), yOf(0));
          g.lineTo(x, yOf(vals[b]));
        }
        g.strokeStyle = color;
        g.globalAlpha = alpha;
        g.lineWidth = 1.3;
        g.setLineDash(dash);
        g.stroke();
        g.setLineDash([]);
        g.globalAlpha = 1;
      };
      line(curve.total, cssVar("--text-secondary", "#999"), 0.55, [3, 2]);
      line(curve.alive, cssVar("--accent-warm", "#da7756"), 0.9, []);
      g.font = "500 8.5px 'DM Mono', monospace";
      g.textAlign = "right";
      g.fillStyle = cssVar("--text-muted", "#888");
      g.fillText("all born", width - 2, Math.max(8, yOf(curve.total[hist.bins - 1]) - 3));
      g.fillStyle = cssVar("--accent-warm", "#da7756");
      g.fillText("alive", width - 2, Math.min(BASE_Y - 3, yOf(curve.alive[hist.bins - 1]) + 10));
      g.textAlign = "left";
    }
    // Age stain: the time axis is the colour key
    if (ageLegend) {
      const grad = g.createLinearGradient(0, 0, width, 0);
      VIRIDIS.forEach((c, k) => grad.addColorStop(k / (VIRIDIS.length - 1), c));
      g.fillStyle = grad;
      g.fillRect(0, BASE_Y - 1, width, 3);
    }
  }, [world, width, ticks, darkMode, curve, ageLegend]);

  // Playhead follows the engine every frame
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const w = world, api = apiRef.current;
      if (!w || !api || !headRef.current || !veilRef.current) return;
      const x = ((api.getDay() - w.tMin) / (w.tMax - w.tMin || 1)) * width;
      headRef.current.style.transform = `translateX(${x}px)`;
      veilRef.current.style.left = `${x}px`;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [world, width, apiRef]);

  // Scrubbing
  const scrub = useRef<{ wasPlaying: boolean } | null>(null);
  const dayAt = (clientX: number) => {
    const el = chartRef.current;
    if (!el || !world) return 0;
    const r = el.getBoundingClientRect();
    return world.tMin + Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * (world.tMax - world.tMin);
  };

  const atEnd = !!world && day >= world.tMax - 0.01;
  const hoverInfo = (() => {
    if (!hover || !world) return null;
    const { hist, species } = world;
    const S = species.length;
    let births = 0;
    for (let s = 0; s < S; s++) births += hist.births[hover.bin * S + s];
    const t = hist.t0 + hover.bin * hist.binDays;
    return { label: `Week of ${formatDay(t, false)}`, births, dormant: hist.dormant[hover.bin] };
  })();

  return (
    <div
      className="animate-fade-up"
      style={{
        position: "absolute", left, right, bottom: 20, zIndex: 22, height: 92,
        display: "flex", alignItems: "stretch", gap: 14, padding: "10px 14px",
        background: "var(--panel-bg)", backdropFilter: "blur(16px) saturate(1.2)",
        border: "1px solid var(--border-default)", borderRadius: 14, boxShadow: "var(--shadow-md)",
        transition: "left 0.35s cubic-bezier(0.32, 0, 0.15, 1), right 0.35s cubic-bezier(0.32, 0, 0.15, 1)",
      }}
    >
      {/* Transport */}
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <IconButton primary title={playing ? "Pause (Space)" : atEnd ? "Replay from the first record (Space)" : "Play (Space)"} onClick={() => apiRef.current?.toggle()}>
            {playing ? (
              <svg width="12" height="14" viewBox="0 0 12 14"><rect x="1" y="1" width="3.5" height="12" rx="1" fill="currentColor" /><rect x="7.5" y="1" width="3.5" height="12" rx="1" fill="currentColor" /></svg>
            ) : (
              <svg width="13" height="14" viewBox="0 0 13 14"><path d="M2.5 1.5L11.5 7L2.5 12.5Z" fill="currentColor" strokeLinejoin="round" stroke="currentColor" strokeWidth="1.2" /></svg>
            )}
          </IconButton>
          <IconButton title="Back to the first record (Home)" onClick={() => world && apiRef.current?.seek(world.tMin)}>
            <svg width="12" height="12" viewBox="0 0 12 12"><rect x="1" y="1.5" width="1.6" height="9" rx="0.6" fill="currentColor" /><path d="M11 1.5L4 6L11 10.5Z" fill="currentColor" /></svg>
          </IconButton>
          <IconButton title="Time-lapse: the whole history in a few seconds (T)" onClick={() => apiRef.current?.timelapse()}>
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M10.6 4.2A4.6 4.6 0 1 0 11 7.3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /><path d="M11.2 1.6V4.6H8.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /><path d="M6.5 4.3V6.7L8 7.8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg>
          </IconButton>
        </div>
        <div style={{ display: "flex", gap: 2, padding: 2, borderRadius: 8, background: "var(--bg-overlay)" }}>
          {SPEEDS.map((s) => (
            <button
              key={s.mul}
              type="button"
              onClick={() => onSpeed(s.mul)}
              title={`${s.mul * DAYS_PER_SECOND} days of history per second`}
              style={{
                height: 20, padding: "0 6px", borderRadius: 6, border: "none", cursor: "pointer",
                background: speedMul === s.mul ? "var(--accent-warm)" : "transparent",
                color: speedMul === s.mul ? "#fff" : "var(--text-faint)",
                fontFamily: "'DM Mono', monospace", fontSize: 10, fontWeight: 500,
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Growth chart + playhead */}
      <div
        ref={chartRef}
        style={{ position: "relative", flex: 1, minWidth: 0, cursor: "ew-resize", touchAction: "none", alignSelf: "center", height: CHART_H }}
        onPointerDown={(e) => {
          if (!world) return;
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          scrub.current = { wasPlaying: apiRef.current?.isPlaying() ?? false };
          apiRef.current?.pause();
          apiRef.current?.seek(dayAt(e.clientX));
        }}
        onPointerMove={(e) => {
          if (world) {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            const x = e.clientX - r.left;
            const t = world.tMin + (x / r.width) * (world.tMax - world.tMin);
            setHover({ x, bin: Math.min(world.hist.bins - 1, Math.max(0, Math.floor((t - world.hist.t0) / world.hist.binDays))) });
          }
          if (scrub.current) apiRef.current?.seek(dayAt(e.clientX));
        }}
        onPointerUp={() => {
          if (scrub.current?.wasPlaying) apiRef.current?.play();
          scrub.current = null;
        }}
        onPointerLeave={() => setHover(null)}
      >
        <canvas ref={canvasRef} style={{ width: "100%", height: CHART_H, display: "block" }} />
        {world && marks && (
          <>
            {([[marks.born, "born", marks.color], ...(marks.done !== null ? [[marks.done, "done", "var(--text-muted)"]] : [])] as Array<[number, string, string]>).map(([t, label, color]) => {
              const x = ((t - world.tMin) / (world.tMax - world.tMin || 1)) * width;
              return (
                <div key={label} style={{ position: "absolute", left: x, top: 0, bottom: 12, width: 0, pointerEvents: "none", zIndex: 2 }}>
                  <div style={{ position: "absolute", left: -0.75, top: 9, bottom: 0, width: 1.5, background: color, opacity: 0.9 }} />
                  <div style={{ position: "absolute", left: -4, top: 4, width: 8, height: 8, transform: "rotate(45deg)", background: color, border: "1.5px solid var(--bg-surface)" }} />
                  <span style={{ position: "absolute", left: 6, top: -3, fontFamily: "'DM Mono', monospace", fontSize: 8.5, color: "var(--text-muted)", whiteSpace: "nowrap" }}>{label}</span>
                </div>
              );
            })}
          </>
        )}
        <div ref={veilRef} style={{ position: "absolute", top: 0, bottom: 12, right: 0, left: 0, background: "var(--panel-bg)", opacity: 0.62, pointerEvents: "none" }} />
        <div ref={headRef} style={{ position: "absolute", top: -4, bottom: 8, left: 0, width: 0, pointerEvents: "none" }}>
          <div style={{ position: "absolute", left: -1, top: 4, bottom: 0, width: 2, borderRadius: 1, background: "var(--accent-warm)" }} />
          <div style={{ position: "absolute", left: -5, top: 0, width: 10, height: 10, borderRadius: "50%", background: "var(--accent-warm)", border: "2px solid var(--bg-surface)", boxShadow: "0 0 10px rgba(218,119,86,0.6)" }} />
        </div>
        {hover && hoverInfo && !scrub.current && (
          <div style={{
            position: "absolute", bottom: CHART_H + 8, left: Math.min(Math.max(hover.x - 80, 0), width - 160), width: 160, pointerEvents: "none",
            padding: "6px 9px", borderRadius: 8, background: "var(--panel-bg)", border: "1px solid var(--border-default)", boxShadow: "var(--shadow-sm)",
          }}>
            <div style={{ fontFamily: "'Geist', sans-serif", fontSize: 11, fontWeight: 600, color: "var(--text-primary)" }}>{hoverInfo.label}</div>
            <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: "var(--text-muted)" }}>
              {hoverInfo.births} born · {hoverInfo.dormant} finished
            </div>
          </div>
        )}
      </div>

      {/* Now */}
      <div style={{ width: 168, flexShrink: 0, display: "flex", flexDirection: "column", justifyContent: "center", gap: 3, borderLeft: "1px solid var(--border-subtle)", paddingLeft: 14 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
          <span style={{ fontFamily: "'Lora', Georgia, serif", fontSize: 17, fontWeight: 600, color: "var(--text-primary)", letterSpacing: "-0.01em", whiteSpace: "nowrap" }}>
            {world ? formatDay(day) : "—"}
          </span>
          {atEnd && <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--accent-warm)" }}>today</span>}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "auto auto", columnGap: 10, rowGap: 1, fontFamily: "'DM Mono', monospace", fontSize: 10, color: "var(--text-muted)", whiteSpace: "nowrap" }}>
          <span><span style={{ color: "var(--text-secondary)" }}>{stats.alive.toLocaleString()}</span> alive</span>
          <span><span style={{ color: "#3fb771" }}>{stats.active.toLocaleString()}</span> active</span>
          <span>{stats.dormant.toLocaleString()} dormant</span>
          <span><span style={{ color: "#c9a227" }}>{stats.blocked.toLocaleString()}</span> blocked</span>
          <span>{stats.colonies} colonies</span>
        </div>
      </div>
    </div>
  );
}
