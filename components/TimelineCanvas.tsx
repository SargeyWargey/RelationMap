"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";

import type { GraphData, DatabaseFieldConfig, NodeDetail } from "@/lib/types";
import {
  buildPersonIndex,
  layoutPersonPanel,
  generateTimeAxisTicks,
  type PersonEntry,
  type PersonNode,
  PANEL_WIDTH,
  PANEL_MARGIN,
} from "@/lib/timelineLayout";

// ─── Layout constants ─────────────────────────────────────────────────────────

const PANEL_HEIGHT      = 480;   // SVG viewBox height per panel
const SPINE_Y           = PANEL_HEIGHT / 2;  // spine at vertical center
const NAME_BAR_H        = 64;    // approx pixel height of PersonNameBar (for positioning)
const NODE_R            = 8;     // radius of node circle on spine
const NODE_STROKE       = 2.5;

// Grow animation
const GROW_DURATION_MS  = 5000;  // spine + nodes grow-in time (uniform regardless of length)
const LABEL_DELAY_MS    = 1200;  // labels start appearing after spine starts

// Left offset: leave some room for position dots; content shifted left
const LEFT_INSET = 60;

const PANEL_SCROLL_MARGIN = 0.30; // keep active node this fraction from right edge

// Easing
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hashFloat(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 0xffffffff;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function avatarColor(key: string): string {
  const hue = Math.round(hashFloat(key) * 360);
  return `hsl(${hue}, 45%, 52%)`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", year: "numeric" });
  } catch {
    return "";
  }
}

// ─── Props ────────────────────────────────────────────────────────────────────

type Props = {
  graph:                GraphData;
  fieldConfig:          Record<string, DatabaseFieldConfig>;
  enabledDbs:           Set<string>;
  groupByDb:            boolean;
  showDbLabels:         boolean;
  darkMode:             boolean;
  activePersonKey:      string | null;
  onSelectNode:         (detail: NodeDetail | null) => void;
  onActivePersonChange: (key: string) => void;
  onAutoCollapse?:      () => void;  // called when user navigates, so parent can collapse DB panel
};

// ─── TimelinePanel ────────────────────────────────────────────────────────────
// Renders a single person's SVG timeline. Grow-in is driven by `growProgress`
// (0 → 1 over GROW_DURATION_MS) and `labelProgress` (0 → 1, starts after delay).

type TimelinePanelProps = {
  entry:             PersonEntry;
  groupByDb:         boolean;
  showDbLabels:      boolean;
  darkMode:          boolean;
  growProgress:      number;   // 0–1: how far the spine has grown
  labelProgress:     number;   // 0–1: how far labels have faded in
  scrollOffsetX:     number;   // world units to pan the SVG viewport horizontally
  selectedNodeIdx:   number;   // index into laidOut-sorted array for selection ring
  onNodeClick:       (node: PersonNode, sortedIdx: number) => void;
  fieldConfig:       Record<string, import("@/lib/types").DatabaseFieldConfig>;
};

function TimelinePanel({
  entry,
  groupByDb,
  showDbLabels,
  darkMode,
  growProgress,
  labelProgress,
  scrollOffsetX,
  selectedNodeIdx,
  onNodeClick,
  fieldConfig,
}: TimelinePanelProps) {
  const laidOut = useMemo(
    () => layoutPersonPanel(entry.nodes, groupByDb, entry.effectiveWidth),
    [entry, groupByDb],
  );
  const ticks = useMemo(() => generateTimeAxisTicks(laidOut, entry.effectiveWidth), [laidOut, entry.effectiveWidth]);

  const spineColor  = darkMode ? "#dddddd" : "#888888";
  const textPrimary = darkMode ? "#ececec" : "#2d2520";
  const textFaint   = darkMode ? "#5a5a5a" : "#b3a494";
  const bgSurface   = darkMode ? "#222222" : "#f2ede6";

  // Use entry's computed width so all nodes have room
  const totalWidth = entry.effectiveWidth;
  // viewBox pans by scrollOffsetX, always shows PANEL_WIDTH world units at a time
  const viewBox = `${scrollOffsetX} 0 ${PANEL_WIDTH} ${PANEL_HEIGHT}`;
  const spineY  = SPINE_Y;

  // Spine grows at a fixed speed: always covers PANEL_WIDTH world units in GROW_DURATION_MS,
  // so all timelines draw at the same pixels-per-second rate regardless of total length.
  const spineEndX = PANEL_MARGIN + PANEL_WIDTH * easeOutCubic(growProgress);

  // Clip ID unique per entry to avoid conflicts
  const clipId = `timeline-clip-${entry.key.replace(/[^a-z0-9]/g, "")}`;

  return (
    <svg
      viewBox={viewBox}
      width={PANEL_WIDTH}
      height={PANEL_HEIGHT}
      style={{ display: "block", overflow: "visible" }}
      aria-label={`Timeline for ${entry.displayName}`}
    >
      <defs>
        <clipPath id={clipId}>
          <rect x={scrollOffsetX} y={0} width={PANEL_WIDTH} height={PANEL_HEIGHT} />
        </clipPath>
      </defs>
      {/* All content clipped to viewport */}
      <g clipPath={`url(#${clipId})`}>

      {/* ── Spine ── */}
      <line
        x1={PANEL_MARGIN}
        y1={spineY}
        x2={spineEndX}
        y2={spineY}
        stroke={spineColor}
        strokeWidth={2}
        strokeLinecap="round"
        opacity={0.6}
      />

      {/* ── Time axis ticks (marks only, no labels — dates shown on cards) ── */}
      {growProgress > 0.15 && ticks.map((tick) => {
        if (tick.xPosition > spineEndX) return null;
        const tickOpacity = labelProgress * 0.4;
        return (
          <line
            key={tick.label}
            x1={tick.xPosition}
            y1={spineY - 5}
            x2={tick.xPosition}
            y2={spineY + 5}
            stroke={spineColor}
            strokeWidth={1}
            opacity={tickOpacity}
          />
        );
      })}

      {/* ── Nodes + branches ── */}
      {laidOut.map((node, idx) => {
        // Don't render nodes beyond the grown spine
        if (node.xPosition > spineEndX + NODE_R) return null;

        // Cull nodes outside the visible viewport window (with padding for labels)
        const viewLeft  = scrollOffsetX - 200;
        const viewRight = scrollOffsetX + PANEL_WIDTH + 200;
        if (node.xPosition < viewLeft || node.xPosition > viewRight) return null;

        // Node appears as soon as spine reaches it
        const nodeRevealT = spineEndX > 0
          ? Math.max(0, Math.min(1, (spineEndX - node.xPosition) / (totalWidth * 0.04)))
          : 0;
        const nodeOpacity = easeOutCubic(nodeRevealT);

        const sideSign   = node.side === "above" ? -1 : 1;
        const branchTopY = spineY + sideSign * (NODE_R + 2);
        const branchEndY = spineY + sideSign * node.branchHeight;

        // Parse color — handle hex or fallback
        let nodeColor = node.color ?? "#888888";
        if (!nodeColor.startsWith("#")) nodeColor = "#888888";

        const labelOpacity  = labelProgress * nodeOpacity;
        const isSelected    = idx === selectedNodeIdx;

        return (
          <g key={`${node.nodeId}-${idx}`} opacity={nodeOpacity}>
            {/* Connector line from spine up/down */}
            <line
              x1={node.xPosition}
              y1={branchTopY}
              x2={node.xPosition}
              y2={branchEndY}
              stroke={nodeColor}
              strokeWidth={1.5}
              strokeDasharray="4 3"
              opacity={0.45 * labelOpacity}
            />

            {/* Text labels with wrapping via foreignObject */}
            <g opacity={labelOpacity}>
              {(() => {
                const labelBoxW = 200;
                const titleBoxH = 44;
                const dateH = 22;
                const dbH = showDbLabels ? 20 : 0;

                // Resolve detail field value for this node
                const detailFieldName = fieldConfig[node.databaseId]?.detailField ?? null;
                const detailValue: string | null = detailFieldName
                  ? (() => {
                      const raw = node.fieldValues?.[detailFieldName] ?? null;
                      if (raw == null) return null;
                      if (Array.isArray(raw)) return raw.filter(Boolean).join(", ") || null;
                      return String(raw) || null;
                    })()
                  : null;
                const detailBoxH = detailValue ? 32 : 0;

                const cardBoxH = titleBoxH + detailBoxH;
                // Left edge of label box pinned to connector line X
                const boxX = node.xPosition;

                // above: card floats upward from branch end; below: downward
                const titleY = node.side === "above"
                  ? branchEndY - 6 - cardBoxH
                  : branchEndY + 6;
                const detailY = titleY + titleBoxH + 2;

                // Date is on the OPPOSITE side of the spine from the card:
                // card above → date below the spine; card below → date above the spine
                const dateY2 = node.side === "above"
                  ? spineY + 8
                  : spineY - dateH - 8;
                const dbY2 = node.side === "above"
                  ? dateY2 - dbH - 2
                  : dateY2 + dateH + 2;

                return (
                  <>
                    {/* Title — left-justified, pinned to connector line X */}
                    <foreignObject
                      x={boxX}
                      y={titleY}
                      width={labelBoxW}
                      height={titleBoxH}
                    >
                      {/* @ts-expect-error xmlns required */}
                      <div xmlns="http://www.w3.org/1999/xhtml" style={{
                        fontFamily: "'Geist', sans-serif",
                        fontSize: "15px",
                        fontWeight: 500,
                        color: textPrimary,
                        lineHeight: "1.35",
                        wordWrap: "break-word",
                        overflow: "hidden",
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                        textAlign: "left",
                        width: "100%",
                        height: "100%",
                      }}>
                        {node.nodeName}
                      </div>
                    </foreignObject>

                    {/* Detail field value — semi-bold, below title */}
                    {detailValue && (
                      <foreignObject
                        x={boxX}
                        y={detailY}
                        width={labelBoxW}
                        height={detailBoxH}
                      >
                        {/* @ts-expect-error xmlns required */}
                        <div xmlns="http://www.w3.org/1999/xhtml" style={{
                          fontFamily: "'Geist', sans-serif",
                          fontSize: "11px",
                          fontWeight: 600,
                          color: nodeColor,
                          lineHeight: "1.3",
                          wordWrap: "break-word",
                          overflow: "hidden",
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                          textAlign: "left",
                          width: "100%",
                          height: "100%",
                          opacity: 0.85,
                        }}>
                          {detailValue}
                        </div>
                      </foreignObject>
                    )}

                    {/* Date — opposite side of spine from card */}
                    <text
                      x={boxX}
                      y={dateY2 + 16}
                      textAnchor="start"
                      fontFamily="'DM Mono', monospace"
                      fontSize={14}
                      fontWeight={300}
                      fill={textFaint}
                    >
                      {formatDate(node.createdTime)}
                    </text>

                    {/* DB label */}
                    {showDbLabels && (
                      <text
                        x={boxX}
                        y={dbY2 + 15}
                        textAnchor="start"
                        fontFamily="'DM Mono', monospace"
                        fontSize={13}
                        fill={nodeColor}
                        fontWeight={400}
                        opacity={0.7}
                      >
                        {node.databaseName}
                      </text>
                    )}
                  </>
                );
              })()}
            </g>

            {/* Orange selection ring — behind the node circle */}
            {isSelected && (
              <circle
                cx={node.xPosition}
                cy={spineY}
                r={NODE_R + 5}
                fill="none"
                stroke="#f97316"
                strokeWidth={2}
                opacity={0.9}
                style={{ pointerEvents: "none" }}
              />
            )}
            {/* Node circle — clickable */}
            <circle
              cx={node.xPosition}
              cy={spineY}
              r={NODE_R}
              fill={nodeColor}
              stroke={bgSurface}
              strokeWidth={NODE_STROKE}
              style={{ cursor: "pointer" }}
              onClick={() => onNodeClick(node, idx)}
            />
            {/* Inner dot */}
            <circle
              cx={node.xPosition}
              cy={spineY}
              r={NODE_R * 0.35}
              fill={bgSurface}
              opacity={0.7}
              style={{ pointerEvents: "none" }}
            />
          </g>
        );
      })}
      </g>
    </svg>
  );
}

// ─── PersonNameBar ────────────────────────────────────────────────────────────

function PersonNameBar({
  entry,
  darkMode,
  opacity,
}: {
  entry: PersonEntry;
  darkMode: boolean;
  opacity: number;
}) {
  const color = avatarColor(entry.key);
  const inits = initials(entry.displayName);
  const textPrimary = darkMode ? "#ececec" : "#2d2520";

  return (
    <div style={{
      display:      "flex",
      alignItems:   "center",
      gap:          10,
      opacity,
      transition:   "opacity 0.3s ease",
      flexShrink:   0,
      marginBottom: 28,
    }}>
      <div style={{
        width:           32,
        height:          32,
        borderRadius:    "50%",
        background:      color,
        display:         "flex",
        alignItems:      "center",
        justifyContent:  "center",
        fontFamily:      "'DM Mono', monospace",
        fontSize:        11,
        fontWeight:      500,
        color:           "#fff",
        flexShrink:      0,
      }}>
        {inits}
      </div>
      <span style={{
        fontFamily:    "'Lora', Georgia, serif",
        fontSize:      20,
        fontWeight:    600,
        color:         textPrimary,
        letterSpacing: "-0.01em",
      }}>
        {entry.displayName}
      </span>
      <span style={{
        fontFamily: "'DM Mono', monospace",
        fontSize:   11,
        color:      darkMode ? "#8b8b8b" : "#8b7868",
        fontWeight: 300,
        marginLeft: 4,
      }}>
        {entry.nodes.length} record{entry.nodes.length !== 1 ? "s" : ""}
      </span>
    </div>
  );
}

// ─── UserCanvas ───────────────────────────────────────────────────────────────

export function TimelineCanvas({
  graph,
  fieldConfig,
  enabledDbs,
  groupByDb,
  showDbLabels,
  darkMode,
  activePersonKey,
  onSelectNode,
  onActivePersonChange,
  onAutoCollapse,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  // ── Per-person timeline scroll state ───────────────────────────────────────
  const timelineScrollXRef  = useRef<Map<string, number>>(new Map());
  const selectedNodeIdxRef  = useRef<Map<string, number>>(new Map());

  // ── Person index ───────────────────────────────────────────────────────────
  const personIndex = useMemo(
    () => buildPersonIndex(graph, fieldConfig, enabledDbs),
    [graph, fieldConfig, enabledDbs],
  );
  const sortedKeys = useMemo(
    () => [...personIndex.keys()].sort((a, b) => a.localeCompare(b)),
    [personIndex],
  );

  // ── Active index ───────────────────────────────────────────────────────────
  const [activeIdx, setActiveIdx] = useState(() => {
    if (activePersonKey) {
      const idx = sortedKeys.indexOf(activePersonKey);
      if (idx >= 0) return idx;
    }
    return 0;
  });

  // Keep activeIdx in sync when activePersonKey prop changes (e.g. picker click)
  useEffect(() => {
    if (!activePersonKey) return;
    const idx = sortedKeys.indexOf(activePersonKey);
    if (idx >= 0 && idx !== targetIdxRef.current) {
      goTo(idx);
    }
  }, [activePersonKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Carousel tween ─────────────────────────────────────────────────────────
  // offsetY: 0 = center panel at active, animated in units of 1 = one panel height
  const offsetYRef   = useRef(0);          // current rendered offset (fractional)
  const targetIdxRef = useRef(activeIdx);
  const tweenRef     = useRef<{ from: number; to: number; startTime: number } | null>(null);
  const rafRef       = useRef<number>(0);
  const [, setRenderTick] = useState(0); // forces re-render each frame

  // Grow animation per panel: key → { startTime, growProgress, labelProgress }
  const growStateRef = useRef<Map<string, { startTime: number }>>(new Map());

  // Track which key was last "locked" to center to trigger grow
  const lastLockedKeyRef = useRef<string | null>(null);

  // ── Animate loop ───────────────────────────────────────────────────────────
  useEffect(() => {
    let alive = true;

    function loop(now: number) {
      if (!alive) return;

      const tween = tweenRef.current;
      if (tween) {
        const elapsed = now - tween.startTime;
        const t       = Math.min(elapsed / 400, 1);
        const eased   = easeInOutCubic(t);
        offsetYRef.current = tween.from + (tween.to - tween.from) * eased;
        if (t >= 1) {
          offsetYRef.current = tween.to;
          tweenRef.current   = null;
        }
      }

      setRenderTick((v) => v + 1);
      rafRef.current = requestAnimationFrame(loop);
    }

    rafRef.current = requestAnimationFrame(loop);
    return () => {
      alive = false;
      cancelAnimationFrame(rafRef.current);
    };
  }, [sortedKeys]);

  // Trigger initial grow for the first active panel
  useEffect(() => {
    const key = sortedKeys[activeIdx];
    if (key && !growStateRef.current.has(key)) {
      growStateRef.current.set(key, { startTime: performance.now() });
      lastLockedKeyRef.current = key;
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Navigate to index ──────────────────────────────────────────────────────
  const goTo = useCallback((idx: number) => {
    const N = sortedKeys.length;
    if (N === 0) return;
    const clamped = Math.max(0, Math.min(N - 1, idx));
    if (clamped === targetIdxRef.current) return;

    const now = performance.now();

    // Pre-register grow for the incoming panel immediately so opacity is
    // continuous throughout the tween — no flash-to-zero at the crossing point.
    const incomingKey = sortedKeys[clamped];
    if (incomingKey && !growStateRef.current.has(incomingKey)) {
      growStateRef.current.set(incomingKey, { startTime: now });
      lastLockedKeyRef.current = incomingKey;
    }

    tweenRef.current = {
      from:      offsetYRef.current,
      to:        clamped,
      startTime: now,
    };
    targetIdxRef.current = clamped;
    setActiveIdx(clamped);
    onActivePersonChange(sortedKeys[clamped]);
    onAutoCollapse?.();
  }, [sortedKeys, onActivePersonChange, onAutoCollapse]);

  // ── Keyboard ───────────────────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        goTo(targetIdxRef.current + 1);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        goTo(targetIdxRef.current - 1);
      } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        const key = sortedKeys[activeIdx];
        if (!key) return;
        const entry = personIndex.get(key);
        if (!entry) return;
        const laidOut = layoutPersonPanel(entry.nodes, false, entry.effectiveWidth);
        const sorted = [...laidOut].sort((a, b) => a.xPosition - b.xPosition);
        const curIdx = selectedNodeIdxRef.current.get(key) ?? 0;
        const nextIdx = e.key === "ArrowRight"
          ? Math.min(sorted.length - 1, curIdx + 1)
          : Math.max(0, curIdx - 1);
        selectedNodeIdxRef.current.set(key, nextIdx);
        // Pan so the selected node is visible with PANEL_SCROLL_MARGIN from right
        const node = sorted[nextIdx];
        if (node && containerWidth > 0) {
          // SVG is 1:1 world-to-pixel; node screen X = LEFT_INSET + xPosition - scrollOffsetX
          const scrollX     = timelineScrollXRef.current.get(key) ?? 0;
          const nodeScreenX = LEFT_INSET + node.xPosition - scrollX;
          const rightEdge   = containerWidth * (1 - PANEL_SCROLL_MARGIN);
          if (nodeScreenX > rightEdge) {
            const newScroll = scrollX + (nodeScreenX - rightEdge);
            const maxScroll = Math.max(0, (entry.effectiveWidth ?? PANEL_WIDTH) - PANEL_WIDTH);
            timelineScrollXRef.current.set(key, Math.max(0, Math.min(maxScroll, newScroll)));
          } else if (nodeScreenX < LEFT_INSET + 40) {
            const newScroll = scrollX - (LEFT_INSET + 40 - nodeScreenX);
            timelineScrollXRef.current.set(key, Math.max(0, newScroll));
          }
        }
        setRenderTick(v => v + 1); // eslint-disable-line
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goTo, sortedKeys, activeIdx, personIndex, containerWidth]);

  // ── Carousel vertical scroll ────────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let accumY = 0;
    let lastStepTime = 0;
    const STEP_COOLDOWN = 700; // ms between carousel steps

    function onWheel(e: WheelEvent) {
      e.preventDefault();
      // Only handle vertical scroll for carousel
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      accumY += e.deltaY;
      const now = Date.now();
      if (Math.abs(accumY) > 80 && now - lastStepTime > STEP_COOLDOWN) {
        lastStepTime = now;
        accumY = 0;
        if (e.deltaY > 0) goTo(targetIdxRef.current + 1);
        else               goTo(targetIdxRef.current - 1);
      }
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [goTo]);

  // ── Horizontal scroll for timeline pan ─────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let lastHorizTime = 0;

    function onWheelHoriz(e: WheelEvent) {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return; // vertical handled elsewhere
      e.preventDefault();
      const now = Date.now();
      if (now - lastHorizTime < 50) return;
      lastHorizTime = now;
      const key = sortedKeys[targetIdxRef.current];
      if (!key) return;
      const entry = personIndex.get(key);
      if (!entry || !containerWidth) return;
      const scrollDelta = e.deltaX; // SVG is 1:1 world-to-pixel
      const current = timelineScrollXRef.current.get(key) ?? 0;
      const maxScroll = Math.max(0, entry.effectiveWidth - PANEL_WIDTH);
      timelineScrollXRef.current.set(key, Math.max(0, Math.min(maxScroll, current + scrollDelta)));
      setRenderTick(v => v + 1); // eslint-disable-line
    }
    el.addEventListener("wheel", onWheelHoriz, { passive: false });
    return () => el.removeEventListener("wheel", onWheelHoriz);
  }, [goTo, sortedKeys, personIndex, containerWidth]);

  // ── Container resize ───────────────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      setContainerWidth(entries[0].contentRect.width);
    });
    obs.observe(el);
    setContainerWidth(el.clientWidth);
    return () => obs.disconnect();
  }, []);

  // ── Node click handler ─────────────────────────────────────────────────────
  const handleNodeClick = useCallback((node: PersonNode, sortedIdx: number) => {
    const key = sortedKeys[targetIdxRef.current];
    if (key) selectedNodeIdxRef.current.set(key, sortedIdx);
    const detail: NodeDetail = {
      id:           node.nodeId,
      name:         node.nodeName,
      createdBy:    "",
      createdTime:  node.createdTime,
      databaseName: node.databaseName,
      databaseId:   node.databaseId,
      notionUrl:    node.notionUrl,
    };
    onSelectNode(detail);
  }, [onSelectNode, sortedKeys]);

  // ── Compute grow progress for a key ───────────────────────────────────────
  function getGrowProgress(key: string, nowMs: number): { grow: number; label: number } {
    const state = growStateRef.current.get(key);
    if (!state) return { grow: 0, label: 0 };
    const elapsed = nowMs - state.startTime;
    const grow    = Math.min(1, elapsed / GROW_DURATION_MS);
    const labelRaw = Math.max(0, elapsed - LABEL_DELAY_MS) / (GROW_DURATION_MS - LABEL_DELAY_MS);
    const label   = Math.min(1, labelRaw);
    return { grow, label };
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const N = sortedKeys.length;
  if (N === 0) {
    return (
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
    );
  }

  // Fixed slot step — spacing between neighbor name bands
  const containerHeight = containerRef.current?.clientHeight ?? 600;
  const panelSlotH      = 75;
  const nowMs           = performance.now();

  // ── Neighbor band Y positions (computed from carousel geometry each frame) ──
  // Panel i center Y in container space = containerHeight/2 + (i - offsetY) * panelSlotH
  // We render bands for i ≠ activeIdx, within ±3, capped at N=20.
  const MAX_BANDS = 3;
  // Anchor bands to the active name bar center (spine at 44% - SPINE_Y - NAME_BAR_H/2)
  const nameBandRefY  = Math.round(containerHeight * 0.44) - SPINE_Y - NAME_BAR_H / 2;
  // Chrome margins: don't let bands overlap top header or bottom bar
  const TOP_MARGIN    = 90;
  const BOTTOM_MARGIN = 70;
  const neighborBands = sortedKeys
    .map((key, i) => {
      const dist = i - offsetYRef.current;
      const absDist = Math.abs(dist);
      if (absDist < 0.4 || absDist > MAX_BANDS + 0.5) return null;
      const bandCenterY = nameBandRefY + dist * panelSlotH;
      // Fade based on distance from center
      const distOpacity = Math.max(0, 0.80 * (1 - Math.max(0, absDist - 0.4) / (MAX_BANDS + 0.1)));
      // Also fade based on proximity to screen edges (fade to 0 within margin zone)
      const topFade    = Math.min(1, Math.max(0, (bandCenterY - TOP_MARGIN) / 40));
      const bottomFade = Math.min(1, Math.max(0, (containerHeight - BOTTOM_MARGIN - bandCenterY) / 40));
      const bandOpacity = distOpacity * topFade * bottomFade;
      if (bandOpacity < 0.02) return null;
      return { key, i, bandCenterY, bandOpacity };
    })
    .filter(Boolean) as { key: string; i: number; bandCenterY: number; bandOpacity: number }[];

  return (
    <div
      ref={containerRef}
      style={{
        width:    "100%",
        height:   "100%",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Neighbor name bands — persistent HTML overlays, always visible */}
      {neighborBands.map(({ key, bandCenterY, bandOpacity }) => {
        const entry = personIndex.get(key)!;
        const color = avatarColor(key);
        const inits = initials(entry.displayName);
        const textPrimary = darkMode ? "#ececec" : "#2d2520";
        const textMuted   = darkMode ? "#8b8b8b" : "#8b7868";
        return (
          <div
            key={key}
            onClick={() => goTo(sortedKeys.indexOf(key))}
            style={{
              position:   "absolute",
              left:       LEFT_INSET,
              top:        bandCenterY - 20,
              height:     40,
              display:    "flex",
              alignItems: "center",
              gap:        10,
              opacity:    bandOpacity,
              cursor:     "pointer",
              zIndex:     10,
              pointerEvents: "auto",
            }}
          >
            <div style={{
              width:           28,
              height:          28,
              borderRadius:    "50%",
              background:      color,
              display:         "flex",
              alignItems:      "center",
              justifyContent:  "center",
              fontFamily:      "'DM Mono', monospace",
              fontSize:        10,
              fontWeight:      500,
              color:           "#fff",
              flexShrink:      0,
            }}>
              {inits}
            </div>
            <span style={{
              fontFamily:    "'Lora', Georgia, serif",
              fontSize:      15,
              fontWeight:    600,
              color:         textPrimary,
              letterSpacing: "-0.01em",
              whiteSpace:    "nowrap",
            }}>
              {entry.displayName}
            </span>
            <span style={{
              fontFamily: "'DM Mono', monospace",
              fontSize:   10,
              color:      textMuted,
              fontWeight: 300,
            }}>
              {entry.nodes.length} record{entry.nodes.length !== 1 ? "s" : ""}
            </span>
          </div>
        );
      })}

      {/* Top + bottom fade vignettes to reinforce the fade-out effect */}
      <div style={{
        position:   "absolute",
        inset:      0,
        background: `linear-gradient(to bottom,
          ${darkMode ? "rgba(18,18,18,0.85)" : "rgba(242,237,230,0.85)"} 0%,
          transparent 8%,
          transparent 85%,
          ${darkMode ? "rgba(18,18,18,0.85)" : "rgba(242,237,230,0.85)"} 100%)`,
        pointerEvents: "none",
        zIndex:     11,
      }} />

      {/* Position dots — fixed far left, always visible */}
      <div style={{
        position:      "absolute",
        left:          16,
        top:           "50%",
        transform:     "translateY(-50%)",
        display:       "flex",
        flexDirection: "column",
        gap:           5,
        zIndex:        15,
      }}>
        {sortedKeys.map((k, di) => {
          const isActive = di === activeIdx;
          return (
            <div
              key={k}
              onClick={() => goTo(di)}
              title={personIndex.get(k)?.displayName}
              style={{
                width:        isActive ? 7 : 4,
                height:       isActive ? 7 : 4,
                borderRadius: "50%",
                background:   isActive ? "var(--accent-warm)" : "var(--text-faint)",
                cursor:       "pointer",
                transition:   "width 0.2s ease, height 0.2s ease, background 0.2s ease",
                opacity:      isActive ? 1 : 0.4,
                alignSelf:    "center",
              }}
            />
          );
        })}
      </div>

      {/* Active panel — spine pinned to vertical center, name bar floats above it */}
      {(() => {
        const key   = sortedKeys[activeIdx];
        const entry = key ? personIndex.get(key) : undefined;
        if (!key || !entry) return null;
        const { grow, label } = getGrowProgress(key, nowMs);
        // Pin spine to 44% down the screen — name bar just above, cards fill below
        const spineScreenY = Math.round(containerHeight * 0.44);
        const svgTop       = spineScreenY - SPINE_Y;
        const nameBarTop   = svgTop - NAME_BAR_H;
        return (
          <div key={key} style={{ position: "absolute", inset: 0, zIndex: 5, pointerEvents: "none" }}>
            {/* Name bar — just above the spine */}
            <div style={{
              position:    "absolute",
              left:        LEFT_INSET,
              right:       40,
              top:         nameBarTop,
              pointerEvents: "auto",
            }}>
              <PersonNameBar entry={entry} darkMode={darkMode} opacity={1} />
            </div>
            {/* Timeline SVG — spine at containerHeight/2 */}
            <div style={{
              position:    "absolute",
              left:        LEFT_INSET,
              right:       0,
              top:         svgTop,
              height:      PANEL_HEIGHT,
              pointerEvents: "auto",
            }}>
              <TimelinePanel
                entry={entry}
                groupByDb={groupByDb}
                showDbLabels={showDbLabels}
                darkMode={darkMode}
                growProgress={grow}
                labelProgress={label}
                scrollOffsetX={timelineScrollXRef.current.get(key) ?? 0}
                selectedNodeIdx={selectedNodeIdxRef.current.get(key) ?? -1}
                onNodeClick={handleNodeClick}
                fieldConfig={fieldConfig}
              />
            </div>
          </div>
        );
      })()}
    </div>
  );
}
