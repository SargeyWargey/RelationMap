"use client";

import { useState } from "react";
import Link from "next/link";
import { useTheme } from "@/components/ThemeProvider";
import { WorkspaceConfigModal } from "@/components/WorkspaceConfigModal";
import { ParallaxMountainBg } from "@/components/ParallaxMountainBg";

// ---------------------------------------------------------------------------
// Geometry helpers – flat-top hexagon
// A flat-top hex of "radius" r (center to vertex) has:
//   width  = 2r
//   height = r * sqrt(3)
// Points (cx, cy) are the 6 vertices starting from the right vertex and
// going clockwise.
// ---------------------------------------------------------------------------
function hexPoints(cx: number, cy: number, r: number): string {
  const s3 = Math.sqrt(3);
  return [
    [cx + r,       cy          ],
    [cx + r / 2,   cy + (r * s3) / 2],
    [cx - r / 2,   cy + (r * s3) / 2],
    [cx - r,       cy          ],
    [cx - r / 2,   cy - (r * s3) / 2],
    [cx + r / 2,   cy - (r * s3) / 2],
  ]
    .map(([x, y]) => `${x},${y}`)
    .join(" ");
}

// ---------------------------------------------------------------------------
// HexTile – SVG-backed hexagon container
// ---------------------------------------------------------------------------
interface HexTileProps {
  r: number;          // hex radius (center-to-vertex)
  children: React.ReactNode;
  href?: string;
  className?: string;
  glowRing?: boolean; // permanently orange border + orange glow
}

function HexTile({ r, children, href, className, glowRing }: HexTileProps) {
  const [hovered, setHovered] = useState(false);
  const s3 = Math.sqrt(3);
  const W = 2 * r;
  const H = r * s3;
  const cx = W / 2;
  const cy = H / 2;
  const strokeWidth = glowRing ? 2 : 1.5;

  const tile = (
    <div
      className={className}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: "relative",
        width: W,
        height: H,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        transition: "transform 0.22s cubic-bezier(0.34,1.56,0.64,1), filter 0.22s ease",
        transform: hovered && !glowRing ? "scale(1.03)" : "scale(1)",
        filter: glowRing
          ? "drop-shadow(0 4px 16px rgba(0,0,0,0.28)) drop-shadow(0 1px 4px rgba(0,0,0,0.16))"
          : hovered
            ? "drop-shadow(0 0 11px rgba(224,122,53,0.33)) drop-shadow(0 0 4px rgba(224,122,53,0.21)) drop-shadow(0 4px 12px rgba(0,0,0,0.18))"
            : "drop-shadow(0 2px 8px rgba(0,0,0,0.10)) drop-shadow(0 1px 2px rgba(0,0,0,0.07))",
        cursor: href ? "pointer" : "default",
        flexShrink: 0,
      }}
    >
      {/* SVG background shape */}
      <svg
        width={W}
        height={H}
        style={{ position: "absolute", inset: 0, display: "block", overflow: "visible" }}
        aria-hidden="true"
      >
        <defs>
          <filter id={`hex-glow-${r}`} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <polygon
          points={hexPoints(cx, cy, r - strokeWidth / 2)}
          fill="var(--bg-surface)"
          stroke={glowRing || (hovered && !glowRing) ? "var(--accent-warm)" : "var(--border-default)"}
          strokeWidth={strokeWidth}
          style={{ transition: "stroke 0.2s ease" }}
        />
      </svg>

      {/* Clipping mask so content stays inside the hex */}
      <svg
        width={W}
        height={H}
        style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
        aria-hidden="true"
      >
        <defs>
          <clipPath id={`hex-clip-${r}-${cx}-${cy}`}>
            <polygon points={hexPoints(cx, cy, r - strokeWidth)} />
          </clipPath>
        </defs>
      </svg>

      {/* Content */}
      <div
        style={{
          position: "relative",
          zIndex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          width: r * 1.1,
          textAlign: "center",
          padding: "0 8px",
          gap: 0,
        }}
      >
        {children}
      </div>
    </div>
  );

  if (href) {
    return (
      <Link href={href} style={{ textDecoration: "none", display: "block", flexShrink: 0 }}>
        {tile}
      </Link>
    );
  }
  return tile;
}

// ---------------------------------------------------------------------------
// Mode definitions
// ---------------------------------------------------------------------------
type ModeEntry = {
  href:       string;
  icon?:      string;
  iconNode?:  React.ReactNode;
  title:      string;
  subtitle:   string;
  description: string;
};

const MODES: ModeEntry[] = [
  {
    href: "/graph",
    icon: "/GraphIcon2.png",
    title: "The Sphere",
    subtitle: "notion graph",
    description: "Explore relationships between your Notion data as an interactive 3D graph.",
  },
  {
    href: "/project-city",
    icon: "/CityLightMode.png",
    title: "The City",
    subtitle: "navigate your data",
    description: "Stroll through your projects like city blocks — every database a neighborhood, every record a building.",
  },
  {
    href: "/project-mountain",
    icon: "/mountain.png",
    title: "The Mountain",
    subtitle: "explore your terrain",
    description: "See your Notion data as mountain ranges — each database a ridge, each record a peak.",
  },
  {
    href: "/project-timeline",
    icon: "/UserIcon.png",
    title: "The Line",
    subtitle: "explore your people",
    description: "See your Notion data through the lens of people — each person a timeline, each record a moment.",
  },
  {
    href:      "/project-archive",
    iconNode:  <span style={{ fontSize: 28, lineHeight: 1, display: "block", marginBottom: 2 }}>📚</span>,
    title:     "The Archive",
    subtitle:  "walk your knowledge",
    description: "Browse your Notion workspace as a candlelit 3D library — each database an aisle, each record a book.",
  },
];


// ---------------------------------------------------------------------------
// ModeHexContent – content inside a mode hexagon
// ---------------------------------------------------------------------------
function ModeHexContent({
  icon,
  iconNode,
  title,
  subtitle,
  description,
}: {
  icon?:      string;
  iconNode?:  React.ReactNode;
  title:      string;
  subtitle:   string;
  description: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, width: "100%" }}>
      {iconNode ? iconNode : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={icon}
          alt=""
          style={{ width: 36, height: 36, objectFit: "contain", marginBottom: 2 }}
        />
      )}
      <span
        style={{
          fontFamily: "'Lora', Georgia, serif",
          fontSize: 15,
          fontWeight: 600,
          color: "var(--text-primary)",
          letterSpacing: "-0.01em",
          lineHeight: 1.25,
        }}
      >
        {title}
      </span>
      <span
        style={{
          fontFamily: "'DM Mono', monospace",
          fontSize: 9,
          color: "var(--accent-warm)",
          fontWeight: 400,
          letterSpacing: "0.07em",
          textTransform: "uppercase",
        }}
      >
        {subtitle}
      </span>
      <p
        style={{
          margin: "4px 0 0",
          fontFamily: "'Geist', sans-serif",
          fontSize: 11,
          color: "var(--text-muted)",
          fontWeight: 300,
          lineHeight: 1.55,
          textAlign: "center",
        }}
      >
        {description}
      </p>
      <div
        style={{
          marginTop: 6,
          display: "flex",
          alignItems: "center",
          gap: 3,
          color: "var(--accent-warm)",
          fontFamily: "'Geist', sans-serif",
          fontSize: 11,
          fontWeight: 500,
        }}
      >
        <span>Open</span>
        <span style={{ fontSize: 12, lineHeight: 1 }}>→</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// HomePage
// ---------------------------------------------------------------------------
export default function HomePage() {
  const { darkMode, toggleDarkMode } = useTheme();
  const [configOpen, setConfigOpen] = useState(false);

  // All hexagons the same radius
  const r = 140;
  const s3 = Math.sqrt(3);
  const W = 2 * r;       // hex width  = 280px
  const H = r * s3;      // hex height ≈ 242px

  // Gap between hex edges
  const gap = 20;

  const vStep   = H + 2 * gap;      // vertical center-to-center
  const hOffset = W + gap - 50;     // horizontal center-to-center offset

  // 5-hex layout: logo top-center, Graph bottom-center, City left-mid,
  // Mountain right-mid, User below bottom-center
  const canvasW = 2 * hOffset + W + 40;
  const canvasH = 2 * vStep + H + 40;
  const cx = canvasW / 2;
  const topCY    = H / 2 + 20;
  const bottomCY = topCY + vStep;
  const sideCY   = (topCY + bottomCY) / 2;

  const hexCenters: [number, number][] = [
    [cx,           topCY              ],  // logo    (top center)
    [cx,           topCY + vStep      ],  // mode 0 — Graph    (center)
    [cx - hOffset, sideCY             ],  // mode 1 — City     (left mid)
    [cx + hOffset, sideCY             ],  // mode 2 — Mountain (right mid)
    [cx,           topCY + 2 * vStep  ],  // mode 3 — Line     (below center)
    [cx + hOffset, sideCY + vStep     ],  // mode 4 — Archive  (below Mountain)
  ];

  return (
    <main
      style={{
        width: "100vw",
        height: "100vh",
        overflow: "hidden",
        position: "relative",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--bg-surface)",
      }}
    >
      {/* Subtle mountain silhouette background */}
      <ParallaxMountainBg />

      {/* Top-right controls */}
      <div
        style={{
          position: "absolute",
          top: 20,
          right: 24,
          zIndex: 20,
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        {/* Configure workspaces button */}
        <button
          type="button"
          onClick={() => setConfigOpen(true)}
          title="Configure workspaces"
          style={{
            height: 28,
            padding: "0 12px",
            borderRadius: 8,
            border: "1px solid var(--border-default)",
            background: "var(--panel-bg)",
            backdropFilter: "blur(12px)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
            fontFamily: "'Geist', sans-serif",
            fontWeight: 500,
            color: "var(--text-muted)",
            transition: "background 0.15s, color 0.15s, border-color 0.15s",
            boxShadow: "var(--shadow-sm)",
            whiteSpace: "nowrap",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.background = "var(--bg-overlay)";
            (e.currentTarget as HTMLElement).style.color = "var(--text-primary)";
            (e.currentTarget as HTMLElement).style.borderColor = "var(--accent-warm)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.background = "var(--panel-bg)";
            (e.currentTarget as HTMLElement).style.color = "var(--text-muted)";
            (e.currentTarget as HTMLElement).style.borderColor = "var(--border-default)";
          }}
        >
          <span style={{ fontSize: 13 }}>⚙</span>
          Configure
        </button>

        {/* Dark mode toggle */}
        <button
          type="button"
          onClick={toggleDarkMode}
          title={darkMode ? "Switch to light mode" : "Switch to dark mode"}
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
            fontSize: 14,
            color: "var(--text-muted)",
            transition: "background 0.15s, color 0.15s",
            boxShadow: "var(--shadow-sm)",
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
          {darkMode ? "☀" : "◑"}
        </button>
      </div>

      {/* Honeycomb cluster */}
      <div
        className="animate-fade-up"
        style={{
          position: "relative",
          width: canvasW,
          height: canvasH,
          flexShrink: 0,
        }}
      >
        {/* ---- Logo hexagon (top center) ---- */}
        <div
          style={{
            position: "absolute",
            left: hexCenters[0][0] - W / 2,
            top: hexCenters[0][1] - H / 2,
          }}
        >
          <HexTile r={r} glowRing>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 10,
                width: r * 1.05,
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/PimaryIcon.png"
                alt="Data Visualizer Logo"
                style={{ width: 80, height: 80, objectFit: "contain" }}
              />
              <span
                style={{
                  fontFamily: "'Lora', Georgia, serif",
                  fontSize: 20,
                  fontWeight: 600,
                  color: "var(--text-primary)",
                  letterSpacing: "-0.02em",
                  lineHeight: 1.2,
                  textAlign: "center",
                }}
              >
                Data Visualizer
              </span>
              <span
                style={{
                  fontFamily: "'DM Mono', monospace",
                  fontSize: 10,
                  color: "var(--text-faint)",
                  fontWeight: 300,
                  letterSpacing: "0.03em",
                  textAlign: "center",
                }}
              >
                choose a mode to get started
              </span>
            </div>
          </HexTile>
        </div>

        {/* ---- Mode hexagons (2×2 grid below logo) ---- */}
        {MODES.map((mode, i) => {
          const [mx, my] = hexCenters[i + 1];
          return (
            <div
              key={mode.href}
              style={{
                position: "absolute",
                left: mx - W / 2,
                top: my - H / 2,
              }}
            >
              <HexTile r={r} href={mode.href}>
                <ModeHexContent
                  icon={mode.icon}
                  iconNode={mode.iconNode}
                  title={mode.title}
                  subtitle={mode.subtitle}
                  description={mode.description}
                />
              </HexTile>
            </div>
          );
        })}
      </div>

      {/* Workspace config modal */}
      {configOpen && <WorkspaceConfigModal onClose={() => setConfigOpen(false)} />}
    </main>
  );
}
