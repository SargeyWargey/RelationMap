"use client";

import { useEffect, useMemo, useRef, type MutableRefObject } from "react";

import type { LineEngineApi } from "@/components/TimelineCanvas";
import { activityHistogram, dayToDate, type LineModel } from "@/lib/lineModel";

type Props = {
  model: LineModel;
  apiRef: MutableRefObject<LineEngineApi | null>;
  darkMode: boolean;
};

const BINS = 220;
const MONTHS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

/**
 * Bottom strip: activity across the whole timeline with the current view as a
 * draggable window. Click to jump, drag the window to scrub, scroll to zoom.
 */
export function LineOverview({ model, apiRef, darkMode }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hist = useMemo(() => activityHistogram(model, BINS), [model]);
  const dragRef = useRef<{ offset: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let lastKey = "";
    const css = getComputedStyle(document.documentElement);
    const accent = css.getPropertyValue("--accent-warm").trim() || "#d97757";
    const ink = darkMode ? "255,255,255" : "45,37,32";

    let max = 0;
    for (const v of hist.counts) max = Math.max(max, v);

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const api = apiRef.current;
      const v = api?.getView();
      const w = canvas.clientWidth, h = canvas.clientHeight;
      const key = `${w}x${h}:${v?.t0.toFixed(3)}:${v?.t1.toFixed(3)}`;
      if (key === lastKey) return;
      lastKey = key;
      const dpr = Math.min(2, window.devicePixelRatio);
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const span = hist.t1 - hist.t0;
      const xOf = (t: number) => ((t - hist.t0) / span) * w;
      const base = h - 14;

      // Month / year ticks
      ctx.font = "9px 'DM Mono', monospace";
      ctx.textBaseline = "alphabetic";
      const a = dayToDate(hist.t0);
      let y = a.getUTCFullYear(), m = a.getUTCMonth() + 1;
      if (m > 11) { m = 0; y++; }
      const monthPx = (30.4 / span) * w;
      for (let guard = 0; guard < 400; guard++) {
        const t = (Date.UTC(y, m, 1) - Date.UTC(2020, 0, 1)) / 86_400_000;
        if (t > hist.t1) break;
        const x = xOf(t);
        const major = m === 0;
        ctx.fillStyle = `rgba(${ink},${major ? 0.22 : 0.08})`;
        ctx.fillRect(Math.round(x), 4, 1, base - 4);
        if (major) {
          ctx.fillStyle = `rgba(${ink},0.6)`;
          ctx.fillText(String(y), x + 3, h - 3);
        } else if (monthPx > 14) {
          ctx.fillStyle = `rgba(${ink},0.32)`;
          ctx.fillText(MONTHS[m], x + 2, h - 3);
        }
        m++;
        if (m > 11) { m = 0; y++; }
      }

      // Histogram
      const bw = w / BINS;
      ctx.fillStyle = `rgba(${ink},${darkMode ? 0.32 : 0.26})`;
      for (let i = 0; i < BINS; i++) {
        const c = hist.counts[i];
        if (c <= 0) continue;
        const bh = Math.max(1, Math.sqrt(c / max) * (base - 8));
        ctx.fillRect(i * bw + 0.5, base - bh, Math.max(1, bw - 1), bh);
      }

      // Today
      const tx = xOf(model.today);
      ctx.fillStyle = accent;
      ctx.fillRect(Math.round(tx) - 0.5, 2, 1.5, base);

      // View window
      if (v) {
        const x0 = Math.max(0, xOf(v.t0)), x1 = Math.min(w, xOf(v.t1));
        ctx.fillStyle = darkMode ? "rgba(255,255,255,0.08)" : "rgba(45,37,32,0.07)";
        ctx.fillRect(x0, 1, Math.max(2, x1 - x0), base);
        ctx.strokeStyle = accent;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x0 + 0.75, 1.75, Math.max(2, x1 - x0) - 1.5, base - 1.5);
        // Shade outside
        ctx.fillStyle = darkMode ? "rgba(0,0,0,0.25)" : "rgba(247,243,237,0.45)";
        ctx.fillRect(0, 0, x0, base + 1);
        ctx.fillRect(x1, 0, w - x1, base + 1);
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [hist, model, apiRef, darkMode]);

  const tAt = (clientX: number) => {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    return hist.t0 + ((clientX - r.left) / r.width) * (hist.t1 - hist.t0);
  };

  const btn: React.CSSProperties = {
    height: 24, minWidth: 24, padding: "0 7px", borderRadius: 6, border: "none", cursor: "pointer", background: "transparent",
    color: "var(--text-muted)", fontFamily: "'Geist', sans-serif", fontSize: 11, fontWeight: 500,
    display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
  };
  const hov = (e: React.MouseEvent, on: boolean) => {
    (e.currentTarget as HTMLElement).style.background = on ? "var(--bg-overlay)" : "transparent";
    (e.currentTarget as HTMLElement).style.color = on ? "var(--text-primary)" : "var(--text-muted)";
  };

  return (
    <div
      style={{
        display: "flex", alignItems: "center", gap: 6, height: 56, padding: "0 6px 0 10px",
        background: "var(--panel-bg)", backdropFilter: "blur(16px)", border: "1px solid var(--border-default)",
        borderRadius: 12, boxShadow: "var(--shadow-md)",
      }}
    >
      <canvas
        ref={canvasRef}
        style={{ flex: 1, height: 44, minWidth: 0, cursor: "pointer", touchAction: "none", display: "block" }}
        onPointerDown={(e) => {
          const api = apiRef.current;
          if (!api) return;
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          const t = tAt(e.clientX);
          const v = api.getView();
          if (t >= v.t0 && t <= v.t1) dragRef.current = { offset: v.center - t };
          else { api.setView(t); dragRef.current = { offset: 0 }; }
        }}
        onPointerMove={(e) => {
          const api = apiRef.current;
          if (!api || !dragRef.current) return;
          api.setView(tAt(e.clientX) + dragRef.current.offset, undefined, false);
        }}
        onPointerUp={() => { dragRef.current = null; }}
        onWheel={(e) => { apiRef.current?.zoomBy(Math.exp(-e.deltaY * 0.002)); }}
      />
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <div style={{ display: "flex", gap: 2 }}>
          <button type="button" title="Zoom out (−)" style={btn} onClick={() => apiRef.current?.zoomBy(1 / 1.8)} onMouseEnter={(e) => hov(e, true)} onMouseLeave={(e) => hov(e, false)}>−</button>
          <button type="button" title="Zoom in (+)" style={btn} onClick={() => apiRef.current?.zoomBy(1.8)} onMouseEnter={(e) => hov(e, true)} onMouseLeave={(e) => hov(e, false)}>+</button>
        </div>
        <div style={{ display: "flex", gap: 2 }}>
          <button type="button" title="Jump to today (T)" style={btn} onClick={() => apiRef.current?.goToday()} onMouseEnter={(e) => hov(e, true)} onMouseLeave={(e) => hov(e, false)}>Today</button>
          <button type="button" title="Fit everything (F)" style={btn} onClick={() => apiRef.current?.fitAll()} onMouseEnter={(e) => hov(e, true)} onMouseLeave={(e) => hov(e, false)}>Fit</button>
        </div>
      </div>
    </div>
  );
}
