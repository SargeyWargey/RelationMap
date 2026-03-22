"use client";

import { useMemo } from "react";
import type { ArchiveAisle } from "@/lib/archiveLayout";
import { ARCHIVE } from "@/lib/archiveLayout";

// ─── Types ────────────────────────────────────────────────────────────────────

type Props = {
  aisles:     ArchiveAisle[];
  cameraPos:  { x: number; z: number };
  onNavigate: (x: number, z: number) => void;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const MAP_W = 280;
const MAP_H = 240;
const PAD   = 14;

// ─── Component ────────────────────────────────────────────────────────────────

export function ArchiveOverheadMap({ aisles, cameraPos, onNavigate }: Props) {
  const bounds = useMemo(() => {
    if (aisles.length === 0) return { minX: -10, maxX: 60, minZ: 0, maxZ: 80 };
    const xs = aisles.map((a) => a.originX);
    const zs = aisles.map((a) => a.originZ);
    return {
      minX: Math.min(...xs) - 8,
      maxX: Math.max(...xs) + 8,
      minZ: -2,
      maxZ: Math.max(...zs) + ARCHIVE.AISLE_LENGTH + 8,
    };
  }, [aisles]);

  const worldW = bounds.maxX - bounds.minX;
  const worldD = bounds.maxZ - bounds.minZ;
  const drawW  = MAP_W - PAD * 2;
  const drawH  = MAP_H - PAD * 2;

  const toSx = (wx: number) => PAD + ((wx - bounds.minX) / worldW) * drawW;
  const toSy = (wz: number) => PAD + ((wz - bounds.minZ) / worldD) * drawH;

  // Aisle geometry in SVG pixels
  const aisleHalfPx  = ((ARCHIVE.WALKWAY_WIDTH / 2 + ARCHIVE.SHELF_THICKNESS) / worldW) * drawW;
  const aisleDepthPx = (ARCHIVE.AISLE_LENGTH / worldD) * drawH;

  function handleClick(e: React.MouseEvent<SVGSVGElement>) {
    const rect   = e.currentTarget.getBoundingClientRect();
    const sx     = e.clientX - rect.left;
    const sy     = e.clientY - rect.top;
    const worldX = bounds.minX + ((sx - PAD) / drawW) * worldW;
    const worldZ = bounds.minZ + ((sy - PAD) / drawH) * worldD;
    onNavigate(worldX, worldZ);
  }

  const MONO = "'DM Mono', 'Courier New', monospace";

  return (
    <div
      style={{
        position:      "absolute",
        bottom:        72,
        left:          18,
        background:    "rgba(14, 7, 2, 0.92)",
        border:        "1px solid rgba(255, 213, 158, 0.18)",
        borderRadius:  4,
        overflow:      "hidden",
        pointerEvents: "auto",
        zIndex:        10,
      }}
    >
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div
        style={{
          padding:       "7px 12px",
          borderBottom:  "1px solid rgba(255, 213, 158, 0.12)",
          fontSize:      10,
          letterSpacing: "0.12em",
          textTransform: "uppercase" as const,
          color:         "rgba(255, 213, 158, 0.48)",
          fontFamily:    MONO,
        }}
      >
        Floor Plan — Click to Navigate
      </div>

      {/* ── SVG map (T-39 / T-40 / T-41) ──────────────────────────────────── */}
      <svg
        width={MAP_W}
        height={MAP_H}
        onClick={handleClick}
        style={{ display: "block", cursor: "crosshair" }}
      >
        {/* Map background */}
        <rect x={0} y={0} width={MAP_W} height={MAP_H} fill="rgba(8,4,1,0.7)" />

        {/* Entrance zone */}
        <rect
          x={PAD}
          y={toSy(bounds.minZ)}
          width={drawW}
          height={Math.max(0, toSy(ARCHIVE.ENTRANCE_Z_OFFSET) - toSy(bounds.minZ))}
          fill="rgba(255,213,158,0.04)"
          stroke="none"
        />
        <text
          x={PAD + drawW / 2}
          y={toSy(bounds.minZ + ARCHIVE.ENTRANCE_Z_OFFSET / 2)}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={7}
          fontFamily={MONO}
          fill="rgba(255,213,158,0.25)"
          style={{ pointerEvents: "none" }}
        >
          ENTRANCE
        </text>

        {/* Aisles */}
        {aisles.map((aisle) => {
          const cx = toSx(aisle.originX);
          const y1 = toSy(aisle.originZ);
          const x1 = cx - aisleHalfPx;
          const w  = aisleHalfPx * 2;
          const h  = aisleDepthPx;
          const c  = aisle.color || "#888888";
          return (
            <g key={aisle.databaseId}>
              <rect
                x={x1} y={y1} width={w} height={h}
                fill={c} fillOpacity={0.18}
                stroke={c} strokeOpacity={0.55} strokeWidth={1}
              />
              {/* Walkway centre-line */}
              <line
                x1={cx} y1={y1} x2={cx} y2={y1 + h}
                stroke={c} strokeOpacity={0.15} strokeWidth={1}
                style={{ pointerEvents: "none" }}
              />
              <text
                x={cx} y={y1 + h / 2}
                textAnchor="middle" dominantBaseline="middle"
                fontSize={7} fontFamily={MONO}
                fill={c} fillOpacity={0.85}
                style={{ pointerEvents: "none" }}
              >
                {aisle.databaseName.length > 9
                  ? aisle.databaseName.slice(0, 8) + "…"
                  : aisle.databaseName}
              </text>
            </g>
          );
        })}

        {/* Player dot (T-40) */}
        <circle
          cx={toSx(cameraPos.x)}
          cy={toSy(cameraPos.z)}
          r={4}
          fill="#ffd59e"
          stroke="rgba(255,255,255,0.9)"
          strokeWidth={1.5}
          style={{ pointerEvents: "none" }}
        />
      </svg>
    </div>
  );
}
