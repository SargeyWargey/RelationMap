"use client";

import { useEffect, useMemo, useRef, type MutableRefObject } from "react";

import type { MountainApi } from "@/components/MountainCanvas";
import type { World } from "@/lib/mountainWorld";

type Props = {
  world: World;
  apiRef: MutableRefObject<MountainApi | null>;
  selectedPeak: number | null;
  expanded: boolean;
  onToggleExpanded: () => void;
};

const RES = 320;

function hex(c: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(c.trim());
  if (!m) return [128, 128, 128];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Shaded-relief map of the island. Click anywhere to travel there. */
export function MountainMinimap({ world, apiRef, selectedPeak, expanded, onToggleExpanded }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const size = expanded ? 440 : 196;

  // Relief image, rendered once per world
  const relief = useMemo(() => {
    if (typeof document === "undefined") return null;
    const c = document.createElement("canvas");
    c.width = c.height = RES;
    const ctx = c.getContext("2d")!;
    const img = ctx.createImageData(RES, RES);
    const N = world.N;
    const rc = world.ranges.map((r) => hex(r.color));
    const sun = world.sun;
    for (let y = 0; y < RES; y++) for (let x = 0; x < RES; x++) {
      const i = Math.min(N - 1, Math.round((x / (RES - 1)) * (N - 1)));
      const j = Math.min(N - 1, Math.round((y / (RES - 1)) * (N - 1)));
      const k = j * N + i;
      const h = world.heights[k];
      const nx = world.normalShadow[k * 4] / 127.5 - 1, ny = world.normalShadow[k * 4 + 1] / 127.5 - 1, nz = world.normalShadow[k * 4 + 2] / 127.5 - 1;
      const shadow = world.normalShadow[k * 4 + 3] / 255;
      const lit = Math.max(0, nx * sun[0] + ny * sun[1] + nz * sun[2]) * (0.45 + 0.55 * shadow);
      const shade = 0.42 + 0.8 * lit;
      let r: number, g: number, b: number;
      if (h < 0) {
        const d = Math.min(1, -h / 30);
        r = 34 - 20 * d; g = 98 - 50 * d; b = 128 - 40 * d;
      } else {
        const t = Math.min(1, h / 160);
        // Hypsometric tint: lowland green → tan → rock → snow
        if (t < 0.25) { r = 88 + t * 160; g = 118 + t * 60; b = 62 + t * 40; }
        else if (t < 0.55) { r = 128 + (t - 0.25) * 60; g = 128 - (t - 0.25) * 30; b = 96 - (t - 0.25) * 20; }
        else if (t < 0.8) { r = 138; g = 128; b = 118; }
        else { const s = (t - 0.8) / 0.2; r = 138 + 110 * s; g = 128 + 120 * s; b = 118 + 130 * s; }
        r *= shade; g *= shade; b *= shade;
        const ri = world.ao[k * 4 + 1] - 1;
        if (ri >= 0) {
          const wgt = (world.ao[k * 4 + 2] / 255) * 0.22;
          r = r * (1 - wgt) + rc[ri][0] * wgt; g = g * (1 - wgt) + rc[ri][1] * wgt; b = b * (1 - wgt) + rc[ri][2] * wgt;
        }
      }
      const o = (y * RES + x) * 4;
      img.data[o] = Math.min(255, r); img.data[o + 1] = Math.min(255, g); img.data[o + 2] = Math.min(255, b); img.data[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }, [world]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !relief) return;
    const ctx = canvas.getContext("2d")!;
    const dpr = Math.min(2, window.devicePixelRatio);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    let raf = 0;
    let lastKey = "";
    const toPx = (x: number, z: number): [number, number] => [((x - world.minX) / world.size) * size, ((z - world.minZ) / world.size) * size];
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const pose = apiRef.current?.getPose();
      if (!pose) return;
      const key = `${size}:${pose.mode}:${pose.hx.toFixed(0)}:${pose.hz.toFixed(0)}:${pose.cx.toFixed(0)}:${pose.cz.toFixed(0)}:${pose.cyaw.toFixed(2)}:${pose.viewR.toFixed(0)}:${selectedPeak}`;
      if (key === lastKey) return;
      lastKey = key;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);
      ctx.drawImage(relief, 0, 0, size, size);

      // Range names (expanded map)
      if (expanded) {
        ctx.font = "600 11px Lora, Georgia, serif";
        ctx.textAlign = "center";
        for (const r of world.ranges) {
          if (r.peaks.length < 5) continue;
          const [x, y] = toPx(r.cx, r.cz);
          ctx.fillStyle = "rgba(0,0,0,0.55)";
          ctx.fillText(r.name, x + 1, y + 1);
          ctx.fillStyle = "#fff";
          ctx.fillText(r.name, x, y);
        }
      }

      // View cone / camera footprint
      const [cx, cz] = toPx(pose.cx, pose.cz);
      const fwdX = Math.sin(pose.cyaw), fwdZ = Math.cos(pose.cyaw);
      const reach = (pose.viewR / world.size) * size;
      ctx.fillStyle = "rgba(255,255,255,0.14)";
      ctx.strokeStyle = "rgba(255,255,255,0.5)";
      ctx.lineWidth = 1;
      if (pose.mode === "map") {
        ctx.beginPath();
        ctx.arc(cx, cz, Math.max(4, reach * 0.5), 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
      } else {
        const a = Math.atan2(fwdZ, fwdX);
        ctx.beginPath();
        ctx.moveTo(cx, cz);
        ctx.arc(cx, cz, Math.max(16, reach), a - 0.45, a + 0.45);
        ctx.closePath();
        ctx.fill();
      }

      // Selected summit
      if (selectedPeak !== null && world.peaks[selectedPeak]) {
        const p = world.peaks[selectedPeak];
        const [x, y] = toPx(p.sx, p.sz);
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--accent-warm").trim() || "#d97757";
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 1.5;
        ctx.fillRect(-4, -4, 8, 8);
        ctx.strokeRect(-4, -4, 8, 8);
        ctx.restore();
      }

      // Hiker arrow
      const [hx, hz] = toPx(pose.hx, pose.hz);
      ctx.save();
      ctx.translate(hx, hz);
      ctx.rotate(-pose.hyaw); // facing (−sin yaw, −cos yaw) in x/z
      ctx.beginPath();
      ctx.moveTo(0, -7); ctx.lineTo(5, 5); ctx.lineTo(0, 2.5); ctx.lineTo(-5, 5); ctx.closePath();
      ctx.fillStyle = "#fff";
      ctx.strokeStyle = "rgba(0,0,0,0.6)";
      ctx.lineWidth = 1.2;
      ctx.fill(); ctx.stroke();
      ctx.restore();
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [world, relief, apiRef, selectedPeak, size, expanded]);

  return (
    <div
      style={{
        position: "relative", width: size, height: size, borderRadius: 14, overflow: "hidden",
        border: "1px solid var(--border-default)", boxShadow: "var(--shadow-md)", background: "#0b2433",
        transition: "width 0.3s cubic-bezier(0.32, 0, 0.15, 1), height 0.3s cubic-bezier(0.32, 0, 0.15, 1)",
      }}
    >
      <canvas
        ref={canvasRef}
        style={{ width: size, height: size, display: "block", cursor: "crosshair" }}
        title="Click to travel here"
        onClick={(e) => {
          const r = (e.target as HTMLCanvasElement).getBoundingClientRect();
          const x = world.minX + ((e.clientX - r.left) / r.width) * world.size;
          const z = world.minZ + ((e.clientY - r.top) / r.height) * world.size;
          apiRef.current?.travelTo(x, z);
        }}
      />
      <button
        type="button"
        onClick={onToggleExpanded}
        title={expanded ? "Shrink map (M)" : "Expand map (M)"}
        style={{
          position: "absolute", top: 6, right: 6, width: 22, height: 22, borderRadius: 6, border: "none", cursor: "pointer",
          background: "rgba(8,10,18,0.55)", color: "#fff", fontSize: 11, display: "flex", alignItems: "center", justifyContent: "center", padding: 0,
        }}
      >
        {expanded ? "↙" : "↗"}
      </button>
      <span style={{ position: "absolute", top: 8, left: 9, fontFamily: "'DM Mono', monospace", fontSize: 9, letterSpacing: "0.12em", color: "rgba(255,255,255,0.75)", textShadow: "0 1px 2px rgba(0,0,0,0.7)", pointerEvents: "none" }}>
        N ↑
      </span>
    </div>
  );
}
