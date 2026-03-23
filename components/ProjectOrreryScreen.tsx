"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import Link from "next/link";
import { useTheme } from "@/components/ThemeProvider";
import { OrreryUniverseBuilder } from "@/components/OrreryUniverseBuilder";
import { OrreryCanvas, type OrreryScale, type HoverInfo } from "@/components/OrreryCanvas";
import { OrreryBreadcrumb } from "@/components/OrreryBreadcrumb";
import { OrrerySpeedControl } from "@/components/OrrerySpeedControl";
import { OrreryTierPanel } from "@/components/OrreryTierPanel";
import { NodeDetailsPanel } from "@/components/NodeDetailsPanel";
import type { GraphData, NodeDetail } from "@/lib/types";
import type { OrreryConfig } from "@/lib/orreryTypes";

type Props = {
  initialGraph: GraphData | null;
  databaseColors: Record<string, string>;
  lastSyncAt?: string;
  orreryConfig: OrreryConfig | null;
};

const SCALE_DEPTH: Record<OrreryScale, number> = {
  universe: 0,
  galaxy: 1,
  "solar-system": 2,
  planet: 3,
};

type NavigationPath = {
  galaxyName?: string;
  starName?: string;
  planetName?: string;
};

export function ProjectOrreryScreen({ initialGraph, databaseColors: _databaseColors, lastSyncAt: _lastSyncAt, orreryConfig: initialOrreryConfig }: Props) {
  const { darkMode, toggleDarkMode } = useTheme();
  const [orreryConfig, setOrreryConfig] = useState<OrreryConfig | null>(initialOrreryConfig);
  const [showBuilder, setShowBuilder] = useState(!initialOrreryConfig);

  // Scale state + navigation path (9.1, 9.4)
  const [currentScale, setCurrentScale] = useState<OrreryScale>("universe");
  const [navPath, setNavPath] = useState<NavigationPath>({});

  // Speed / pause state (8.6)
  const [speedMultiplier, setSpeedMultiplier] = useState(1);
  const [paused, setPaused] = useState(false);

  // Node selection (8.2)
  const [selectedNode, setSelectedNode] = useState<NodeDetail | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);

  // Hover info for HUD (8.8)
  const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null);

  // Back navigation ref — OrreryCanvas populates this (9.3)
  const backRef = useRef<(() => void) | null>(null);

  // Pending multi-level back navigation (e.g. clicking "Universe" from planet level)
  const pendingBacks = useRef(0);

  function handleScaleChange(scale: OrreryScale, path: NavigationPath) {
    setCurrentScale(scale);
    setNavPath(path);
    // If we have pending backs queued (multi-level breadcrumb navigation), fire next one
    if (pendingBacks.current > 0) {
      pendingBacks.current -= 1;
      // Fire on next tick so the previous transition is fully registered
      setTimeout(() => backRef.current?.(), 100);
    }
  }

  function handleSelectNode(detail: NodeDetail | null) {
    setSelectedNode(detail);
    setPanelOpen(detail !== null);
  }

  function handleLaunch(config: OrreryConfig) {
    setOrreryConfig(config);
    setShowBuilder(false);
  }

  // Breadcrumb navigation — calculates how many goBack calls are needed (9.3)
  const handleNavigateTo = useCallback((targetScale: OrreryScale) => {
    const stepsNeeded = SCALE_DEPTH[currentScale] - SCALE_DEPTH[targetScale];
    if (stepsNeeded <= 0) return;
    pendingBacks.current = stepsNeeded - 1; // first back fires immediately; rest queued
    backRef.current?.();
  }, [currentScale]);

  // Escape key — go up one level (9.2 — also handled inside OrreryCanvas, but belt-and-suspenders)
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
      if (e.key === "Escape" && currentScale !== "universe" && !showBuilder) {
        pendingBacks.current = 0; // cancel any queued multi-step navigation
        backRef.current?.();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [currentScale, showBuilder]);

  const tierLabels: Record<OrreryScale, string> = {
    universe: "Universe",
    galaxy: "Galaxy",
    "solar-system": "Solar System",
    planet: "Planet",
  };

  return (
    <div style={{ width: "100%", height: "100%", position: "relative", overflow: "hidden", background: "#05060d" }}>

      {/* Universe Builder overlay */}
      {showBuilder && (
        <OrreryUniverseBuilder
          graphData={initialGraph}
          initialConfig={orreryConfig}
          onLaunch={handleLaunch}
          onClose={orreryConfig ? () => setShowBuilder(false) : undefined}
        />
      )}

      {/* Three.js canvas */}
      {!showBuilder && orreryConfig && initialGraph && (
        <div style={{ position: "absolute", inset: 0 }}>
          <OrreryCanvas
            graphData={initialGraph}
            orreryConfig={orreryConfig}
            speedMultiplier={speedMultiplier}
            paused={paused}
            onScaleChange={handleScaleChange}
            onSelectNode={handleSelectNode}
            onHover={setHoverInfo}
            backRef={backRef}
          />
        </div>
      )}

      {/* Fallback: no graph data */}
      {!showBuilder && (!orreryConfig || !initialGraph) && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,0.12)", fontFamily: "'DM Mono', monospace", fontSize: 13, letterSpacing: "0.05em" }}>
          No graph data — run sync first
        </div>
      )}

      {/* ── Top-left: wordmark OR breadcrumb ── */}
      {(showBuilder || currentScale === "universe") ? (
        /* Wordmark — shown at universe level and in builder */
        <div style={{ position: "absolute", top: 20, left: 24, zIndex: 20 }}>
          <Link href="/" style={{ textDecoration: "none" }}>
            <div
              style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2, cursor: "pointer", opacity: 1, transition: "opacity 0.15s" }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.opacity = "0.7"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.opacity = "1"; }}
            >
              <span style={{ fontFamily: "'Lora', Georgia, serif", fontSize: 18, fontWeight: 600, color: "rgba(255,255,255,0.85)", letterSpacing: "-0.01em", display: "flex", alignItems: "center", gap: 7 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/universe.png" alt="" style={{ width: 18, height: 18, objectFit: "contain" }} />
                The Universe
              </span>
              <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: "rgba(255,255,255,0.35)", fontWeight: 300 }}>
                living universe
              </span>
            </div>
          </Link>
        </div>
      ) : (
        /* Breadcrumb — shown when drilled into a scale (9.3) */
        <OrreryBreadcrumb
          scale={currentScale}
          galaxyName={navPath.galaxyName}
          starName={navPath.starName}
          planetName={navPath.planetName}
          onNavigateTo={handleNavigateTo}
        />
      )}

      {/* ── Top-right controls ── */}
      <div style={{ position: "absolute", top: 20, right: 24, zIndex: 20, display: "flex", alignItems: "center", gap: 8 }}>
        {/* Tier mapping panel — only when canvas is showing (8.3) */}
        {orreryConfig && initialGraph && !showBuilder && (
          <OrreryTierPanel orreryConfig={orreryConfig} graphData={initialGraph} />
        )}

        {/* Reconfigure button (8.7) */}
        {orreryConfig && !showBuilder && (
          <button
            type="button"
            onClick={() => setShowBuilder(true)}
            style={{ height: 28, padding: "0 12px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.06)", backdropFilter: "blur(12px)", cursor: "pointer", display: "flex", alignItems: "center", gap: 5, fontSize: 11, fontFamily: "'Geist', sans-serif", fontWeight: 500, color: "rgba(255,255,255,0.5)", transition: "background 0.15s, color 0.15s, border-color 0.15s", whiteSpace: "nowrap" }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.12)"; (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.85)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.06)"; (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.5)"; }}
          >
            ⚙ Reconfigure
          </button>
        )}

        {/* Dark mode toggle */}
        <button
          type="button"
          onClick={toggleDarkMode}
          title={darkMode ? "Switch to light mode" : "Switch to dark mode"}
          style={{ width: 28, height: 28, borderRadius: 8, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.06)", backdropFilter: "blur(12px)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, color: "rgba(255,255,255,0.5)", transition: "background 0.15s, color 0.15s" }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.12)"; (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.85)"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.06)"; (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.5)"; }}
        >
          {darkMode ? "☀" : "◑"}
        </button>
      </div>

      {/* ── Bottom-center: orbital speed control (8.6) ── */}
      {!showBuilder && orreryConfig && (
        <OrrerySpeedControl
          speed={speedMultiplier}
          paused={paused}
          onSpeedChange={setSpeedMultiplier}
          onPausedChange={setPaused}
        />
      )}

      {/* ── Bottom-left: hover info HUD (8.8) ── */}
      {!showBuilder && hoverInfo && (
        <div
          style={{
            position: "absolute",
            bottom: 20,
            left: 24,
            zIndex: 20,
            background: "rgba(5,6,13,0.82)",
            backdropFilter: "blur(14px)",
            border: "1px solid rgba(255,255,255,0.10)",
            borderRadius: 10,
            padding: "9px 14px",
            display: "flex",
            flexDirection: "column",
            gap: 5,
            maxWidth: 240,
            pointerEvents: "none",
          }}
        >
          {/* Name */}
          <span style={{ fontFamily: "'Lora', Georgia, serif", fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.88)", letterSpacing: "-0.01em", lineHeight: 1.2 }}>
            {hoverInfo.name}
          </span>

          {/* Tier + database */}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, letterSpacing: "0.08em", textTransform: "uppercase", color: "rgba(224,122,53,0.7)" }}>
              {hoverInfo.tier}
            </span>
            <span style={{ width: 1, height: 10, background: "rgba(255,255,255,0.12)", flexShrink: 0 }} />
            <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: "rgba(255,255,255,0.35)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {hoverInfo.databaseName}
            </span>
          </div>

          {/* Stats row */}
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: "rgba(255,255,255,0.28)", whiteSpace: "nowrap" }}>
              {hoverInfo.connectionCount} connection{hoverInfo.connectionCount !== 1 ? "s" : ""}
            </span>
            {hoverInfo.createdTime && (
              <>
                <span style={{ width: 1, height: 10, background: "rgba(255,255,255,0.10)", flexShrink: 0 }} />
                <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: "rgba(255,255,255,0.22)" }}>
                  {new Date(hoverInfo.createdTime).getFullYear()}
                </span>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Current scale label (shown when not hovering) ── */}
      {!showBuilder && orreryConfig && !hoverInfo && (
        <div style={{ position: "absolute", bottom: 20, left: 24, zIndex: 20, fontFamily: "'DM Mono', monospace", fontSize: 10, color: "rgba(255,255,255,0.22)", letterSpacing: "0.05em", pointerEvents: "none" }}>
          {tierLabels[currentScale]}
        </div>
      )}

      {/* NodeDetailsPanel — moon/planet/star selection (8.2) */}
      {!showBuilder && (
        <NodeDetailsPanel
          detail={selectedNode}
          open={panelOpen}
          onClose={() => { setPanelOpen(false); setSelectedNode(null); }}
          allNodes={initialGraph?.nodes ?? []}
          allEdges={initialGraph?.edges ?? []}
        />
      )}
    </div>
  );
}
