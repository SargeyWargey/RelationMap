"use client";

import {
  useEffect,
  useRef,
  useCallback,
  useState,
  useMemo,
} from "react";
import type { GraphData, GraphNode, GraphEdge, NodeDetail } from "@/lib/types";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface NodeSim {
  id: string;
  node: GraphNode;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** radius at this point in time */
  r: number;
  /** connection count at this point in time */
  degree: number;
  /** 0→1 entrance scale animation progress */
  enterProgress: number;
  /** ms timestamp when this node was added to simulation */
  addedAt: number;
}

interface Props {
  graph: GraphData;
  showRelations: boolean;
  nodeSizeScale: number;
  onSelectNode: (detail: NodeDetail | null) => void;
  selectedNodeId: string | null;
  /** Called each frame with the current playback timestamp */
  onTimeChange?: (t: Date) => void;
  /** External play state control */
  isPlaying: boolean;
  onPlayPause: (v: boolean) => void;
  /** speed multiplier — see BASE_MS_PER_SECOND */
  playbackSpeed: number;
  onSpeedChange: (v: number) => void;
  /** if provided, jump timeline to this time */
  seekTo?: Date | null;
  panelOpen: boolean;
}

const BASE_RADIUS = 8;
const ENTER_DURATION_MS = 500;

// ── Physics ──────────────────────────────────────────────────────────────────
// Alpha decay: simulation "cools" over time so nodes settle in place.
// Forces are multiplied by alpha. When alpha → 0, only center gravity keeps
// nodes from drifting, and damping kills remaining velocity.
const ALPHA_DECAY  = 0.018;   // per tick — reaches ~0.05 in ~165 ticks (~2.7s at 60fps)
const ALPHA_MIN    = 0.002;   // below this: skip repulsion/spring, just center-pull + damp
const ALPHA_REHEAT = 0.45;    // alpha is bumped to at least this when a new node spawns

const CENTER_PULL  = 0.006;   // always-on gravity toward center — keeps cluster from flying out
const REPULSION    = 1200;    // node-to-node push
const REPULSION_MAX_FORCE = 8; // cap per-axis force — prevents blow-up when nodes overlap
const SPRING_K     = 0.006;   // spring attraction for connected pairs
const SPRING_REST  = 70;      // rest length for connected pairs
const DAMPING      = 0.88;    // velocity damping each tick

const SIM_TICKS_PER_FRAME = 1;

// 1× speed = 10 days per second
const BASE_MS_PER_SECOND = 10 * 24 * 60 * 60 * 1000;

function nodeRadius(degree: number, scale: number): number {
  return (BASE_RADIUS + Math.sqrt(degree) * 4) * scale;
}

function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

// ─────────────────────────────────────────────────────────────────────────────
// CultureCanvas
// ─────────────────────────────────────────────────────────────────────────────

export function CultureCanvas({
  graph,
  showRelations,
  nodeSizeScale,
  onSelectNode,
  selectedNodeId,
  onTimeChange,
  isPlaying,
  onPlayPause,
  playbackSpeed,
  onSpeedChange,
  seekTo,
  panelOpen,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });

  // Simulation state — kept in refs so RAF loop doesn't re-render on every tick
  const simNodes = useRef<Map<string, NodeSim>>(new Map());
  const alphaRef = useRef(1.0);           // simulation "temperature" — decays toward 0
  const currentTimeRef = useRef<Date>(new Date(0));
  const isPlayingRef = useRef(isPlaying);
  const playbackSpeedRef = useRef(playbackSpeed);
  const lastRafTimeRef = useRef<number | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const [renderTick, setRenderTick] = useState(0); // just triggers re-render

  // Keep refs in sync with props
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { playbackSpeedRef.current = playbackSpeed; }, [playbackSpeed]);

  // Sorted nodes by createdTime
  const sortedNodes = useMemo(() => {
    return [...graph.nodes]
      .filter((n) => !!n.createdTime)
      .sort((a, b) => new Date(a.createdTime).getTime() - new Date(b.createdTime).getTime());
  }, [graph.nodes]);

  const minTime = useMemo(() => sortedNodes.length ? new Date(sortedNodes[0].createdTime).getTime() : Date.now(), [sortedNodes]);
  const maxTime = useMemo(() => sortedNodes.length ? new Date(sortedNodes[sortedNodes.length - 1].createdTime).getTime() : Date.now(), [sortedNodes]);

  // Edge adjacency — for computing degree at a point in time
  const edgesByNode = useMemo(() => {
    const map = new Map<string, GraphEdge[]>();
    for (const e of graph.edges) {
      if (!map.has(e.source)) map.set(e.source, []);
      if (!map.has(e.target)) map.set(e.target, []);
      map.get(e.source)!.push(e);
      map.get(e.target)!.push(e);
    }
    return map;
  }, [graph.edges]);

  // Resize observer
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // ── Spawn helper — always reads live container size ───────────────────────
  const spawnCenter = useCallback(() => {
    const el = containerRef.current;
    const w = el ? el.clientWidth : size.w;
    const h = el ? el.clientHeight : size.h;
    return { cx: w / 2, cy: h / 2 };
  }, [size.w, size.h]);

  // ── Seek handler ──────────────────────────────────────────────────────────
  const seekToTime = useCallback((target: Date) => {
    const targetMs = target.getTime();
    const { cx, cy } = spawnCenter();

    // Determine which nodes should be visible
    const visibleIds = new Set(
      sortedNodes.filter((n) => new Date(n.createdTime).getTime() <= targetMs).map((n) => n.id)
    );

    // Remove nodes that are now in the future
    const toRemove: string[] = [];
    simNodes.current.forEach((_, id) => {
      if (!visibleIds.has(id)) toRemove.push(id);
    });
    toRemove.forEach((id) => simNodes.current.delete(id));

    // Add nodes that should now be visible
    let spawned = false;
    for (const n of sortedNodes) {
      if (new Date(n.createdTime).getTime() > targetMs) break;
      if (simNodes.current.has(n.id)) continue;
      const jitter = () => (Math.random() - 0.5) * 20;
      simNodes.current.set(n.id, {
        id: n.id,
        node: n,
        x: cx + jitter(),
        y: cy + jitter(),
        vx: 0,
        vy: 0,
        r: nodeRadius(0, nodeSizeScale),
        degree: 0,
        enterProgress: 0,
        addedAt: performance.now(),
      });
      spawned = true;
    }

    // Reheat simulation when new nodes are added
    if (spawned) alphaRef.current = Math.max(alphaRef.current, ALPHA_REHEAT);

    // Update degrees
    updateDegrees(targetMs);
    currentTimeRef.current = target;
    onTimeChange?.(target);
    setRenderTick((v) => v + 1);
  }, [sortedNodes, spawnCenter, nodeSizeScale, onTimeChange]);

  // ── Degree update ─────────────────────────────────────────────────────────
  const updateDegrees = useCallback((targetMs: number) => {
    simNodes.current.forEach((s) => {
      const edges = edgesByNode.get(s.id) ?? [];
      let deg = 0;
      for (const e of edges) {
        const other = e.source === s.id ? e.target : e.source;
        const otherNode = graph.nodes.find((n) => n.id === other);
        if (otherNode && new Date(otherNode.createdTime).getTime() <= targetMs) deg++;
      }
      s.degree = deg;
      s.r = nodeRadius(deg, nodeSizeScale);
    });
  }, [edgesByNode, graph.nodes, nodeSizeScale]);

  // ── Initialize timeline at start ─────────────────────────────────────────
  useEffect(() => {
    if (sortedNodes.length === 0) return;
    seekToTime(new Date(minTime));
  }, [sortedNodes, minTime]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Handle external seekTo ────────────────────────────────────────────────
  useEffect(() => {
    if (!seekTo) return;
    seekToTime(seekTo);
  }, [seekTo, seekToTime]);

  // ── Force simulation tick ─────────────────────────────────────────────────
  const tickSimulation = useCallback(() => {
    const nodes = Array.from(simNodes.current.values());
    if (nodes.length === 0) return;

    const el = containerRef.current;
    const W = el ? el.clientWidth  : size.w;
    const H = el ? el.clientHeight : size.h;
    const cx = W / 2;
    const cy = H / 2;
    const now = performance.now();
    const alpha = alphaRef.current;

    // Update enter animation
    for (const s of nodes) {
      if (s.enterProgress < 1) {
        s.enterProgress = Math.min(1, (now - s.addedAt) / ENTER_DURATION_MS);
      }
    }

    // Only apply inter-node forces while simulation is warm
    if (alpha > ALPHA_MIN) {
      // Repulsion between all pairs — capped to prevent blow-up
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i], b = nodes[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const minDist = a.r + b.r + 2;
          if (dist < minDist * 4) {
            const rawForce = (REPULSION * alpha) / (dist * dist);
            // Cap each axis — prevents huge launches when nodes are very close
            const fx = Math.min(Math.abs((dx / dist) * rawForce), REPULSION_MAX_FORCE) * Math.sign(dx);
            const fy = Math.min(Math.abs((dy / dist) * rawForce), REPULSION_MAX_FORCE) * Math.sign(dy);
            a.vx -= fx; a.vy -= fy;
            b.vx += fx; b.vy += fy;
          }
        }
      }

      // Spring attraction for linked pairs
      const currentMs = currentTimeRef.current.getTime();
      for (const e of graph.edges) {
        const a = simNodes.current.get(e.source);
        const b = simNodes.current.get(e.target);
        if (!a || !b) continue;
        if (new Date(a.node.createdTime).getTime() > currentMs) continue;
        if (new Date(b.node.createdTime).getTime() > currentMs) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const displacement = dist - SPRING_REST;
        const f = displacement * SPRING_K * alpha;
        const fx = (dx / dist) * f;
        const fy = (dy / dist) * f;
        a.vx += fx; a.vy += fy;
        b.vx -= fx; b.vy -= fy;
      }

      // Decay alpha
      alphaRef.current = alpha * (1 - ALPHA_DECAY);
    }

    // Center gravity — always on, strength increases with distance from center
    for (const s of nodes) {
      const dx = cx - s.x;
      const dy = cy - s.y;
      const distFromCenter = Math.sqrt(dx * dx + dy * dy) || 1;
      // Stronger pull the further a node is — prevents escape
      const gravityScale = 1 + Math.max(0, distFromCenter - 200) * 0.003;
      s.vx += dx * CENTER_PULL * gravityScale;
      s.vy += dy * CENTER_PULL * gravityScale;

      // Integrate + damp
      s.vx *= DAMPING;
      s.vy *= DAMPING;
      s.x += s.vx;
      s.y += s.vy;

      // Soft boundary — push back if outside safe zone
      const pad = s.r + 16;
      if (s.x < pad)      { s.x = pad;      s.vx = Math.abs(s.vx) * 0.3; }
      if (s.x > W - pad)  { s.x = W - pad;  s.vx = -Math.abs(s.vx) * 0.3; }
      if (s.y < pad)      { s.y = pad;      s.vy = Math.abs(s.vy) * 0.3; }
      if (s.y > H - pad)  { s.y = H - pad;  s.vy = -Math.abs(s.vy) * 0.3; }
    }
  }, [size.w, size.h, graph.edges]);

  // ── RAF loop ──────────────────────────────────────────────────────────────
  useEffect(() => {
    let active = true;

    const loop = (timestamp: number) => {
      if (!active) return;

      const dt = lastRafTimeRef.current !== null ? timestamp - lastRafTimeRef.current : 16;
      lastRafTimeRef.current = timestamp;

      // Advance time if playing
      if (isPlayingRef.current) {
        const msAdvance = (dt / 1000) * playbackSpeedRef.current * BASE_MS_PER_SECOND;
        const newMs = Math.min(currentTimeRef.current.getTime() + msAdvance, maxTime);
        const newTime = new Date(newMs);

        // Add any newly born nodes — use live container dimensions
        const el = containerRef.current;
        const spawnCx = el ? el.clientWidth / 2 : size.w / 2;
        const spawnCy = el ? el.clientHeight / 2 : size.h / 2;
        let newlyBorn = false;
        for (const n of sortedNodes) {
          const born = new Date(n.createdTime).getTime();
          if (born > newMs) break;
          if (born > currentTimeRef.current.getTime() && !simNodes.current.has(n.id)) {
            const jitter = () => (Math.random() - 0.5) * 20;
            simNodes.current.set(n.id, {
              id: n.id,
              node: n,
              x: spawnCx + jitter(),
              y: spawnCy + jitter(),
              vx: 0,
              vy: 0,
              r: nodeRadius(0, nodeSizeScale),
              degree: 0,
              enterProgress: 0,
              addedAt: performance.now(),
            });
            newlyBorn = true;
          }
        }
        if (newlyBorn) alphaRef.current = Math.max(alphaRef.current, ALPHA_REHEAT);

        updateDegrees(newMs);
        currentTimeRef.current = newTime;
        onTimeChange?.(newTime);

        // Stop at end
        if (newMs >= maxTime) {
          isPlayingRef.current = false;
          onPlayPause(false);
        }
      }

      // Run force ticks
      for (let i = 0; i < SIM_TICKS_PER_FRAME; i++) tickSimulation();

      setRenderTick((v) => v + 1);
      rafIdRef.current = requestAnimationFrame(loop);
    };

    rafIdRef.current = requestAnimationFrame(loop);
    return () => {
      active = false;
      if (rafIdRef.current !== null) cancelAnimationFrame(rafIdRef.current);
      lastRafTimeRef.current = null;
    };
  }, [size.w, size.h, maxTime, sortedNodes, nodeSizeScale, updateDegrees, tickSimulation, onTimeChange, onPlayPause]);

  // ── Click handler ─────────────────────────────────────────────────────────
  const handleSvgClick = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const target = e.target as SVGElement;
    const nodeId = target.closest("[data-node-id]")?.getAttribute("data-node-id");
    if (!nodeId) {
      onSelectNode(null);
      return;
    }
    const sim = simNodes.current.get(nodeId);
    if (!sim) return;
    const n = sim.node;
    onSelectNode({
      id: n.id,
      name: n.name,
      createdBy: n.createdBy,
      createdTime: n.createdTime,
      databaseName: n.databaseName,
      databaseId: n.databaseId,
      notionUrl: n.notionUrl,
      fieldValues: n.fieldValues,
    });
  }, [onSelectNode]);

  // ── Render ────────────────────────────────────────────────────────────────
  const nodes = Array.from(simNodes.current.values());
  const currentMs = currentTimeRef.current.getTime();

  // Edges to render
  const visibleEdges = useMemo(() => {
    if (!showRelations) return [];
    return graph.edges.filter((e) => {
      const a = simNodes.current.get(e.source);
      const b = simNodes.current.get(e.target);
      return a && b;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph.edges, showRelations, renderTick]);

  return (
    <div ref={containerRef} style={{ width: "100%", height: "100%", position: "relative" }}>
      <svg
        ref={svgRef}
        width={size.w}
        height={size.h}
        style={{ display: "block", cursor: "default" }}
        onClick={handleSvgClick}
      >
        <defs>
          <filter id="node-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {/* ── Edges ── */}
        <g>
          {visibleEdges.map((e) => {
            const a = simNodes.current.get(e.source);
            const b = simNodes.current.get(e.target);
            if (!a || !b) return null;
            const isSelected =
              selectedNodeId === e.source || selectedNodeId === e.target;
            return (
              <line
                key={e.id}
                x1={a.x} y1={a.y}
                x2={b.x} y2={b.y}
                stroke={isSelected ? "#f97316" : "var(--text-faint)"}
                strokeWidth={isSelected ? 1.5 : 0.8}
                strokeOpacity={isSelected ? 0.7 : 0.25}
                style={{ pointerEvents: "none" }}
              />
            );
          })}
        </g>

        {/* ── Nodes ── */}
        <g>
          {nodes.map((s) => {
            const scale = easeOut(s.enterProgress);
            const r = s.r * scale;
            const isSelected = s.id === selectedNodeId;
            const color = s.node.color;

            return (
              <g
                key={s.id}
                data-node-id={s.id}
                transform={`translate(${s.x},${s.y})`}
                style={{ cursor: "pointer" }}
                filter={isSelected ? "url(#node-glow)" : undefined}
              >
                {/* Flat circle node — same visual style as GraphCanvas */}
                <circle
                  r={r}
                  fill={color}
                  stroke={isSelected ? "#f97316" : "white"}
                  strokeWidth={isSelected ? 2 : 1.5}
                  strokeOpacity={isSelected ? 1 : 0.6}
                />
                {/* Label when selected */}
                {isSelected && (
                  <foreignObject
                    x={r + 6}
                    y={-10}
                    width={120}
                    height={40}
                    style={{ pointerEvents: "none", overflow: "visible" }}
                  >
                    <div
                      style={{
                        background: "var(--panel-bg)",
                        backdropFilter: "blur(8px)",
                        border: "1px solid var(--border-default)",
                        borderRadius: 6,
                        padding: "3px 7px",
                        fontFamily: "'Geist', sans-serif",
                        fontSize: 11,
                        fontWeight: 500,
                        color: "var(--text-primary)",
                        whiteSpace: "nowrap",
                        boxShadow: "var(--shadow-sm)",
                      }}
                    >
                      {s.node.name}
                    </div>
                  </foreignObject>
                )}
              </g>
            );
          })}
        </g>
      </svg>

      {/* ── Timeline bar ── */}
      <TimelineBar
        minTime={minTime}
        maxTime={maxTime}
        currentTime={currentTimeRef.current.getTime()}
        isPlaying={isPlaying}
        playbackSpeed={playbackSpeed}
        onPlayPause={onPlayPause}
        onSpeedChange={(v) => { playbackSpeedRef.current = v; onSpeedChange(v); }}
        onSeek={(ms) => seekToTime(new Date(ms))}
        panelOpen={panelOpen}
        nodeCount={nodes.length}
        totalNodes={sortedNodes.length}
        currentMs={currentMs}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TimelineBar
// ─────────────────────────────────────────────────────────────────────────────

const SPEED_OPTIONS = [
  { label: "0.5×", value: 0.5 },
  { label: "1×",   value: 1 },
  { label: "2×",   value: 2 },
  { label: "5×",   value: 5 },
  { label: "10×",  value: 10 },
];

interface TimelineBarProps {
  minTime: number;
  maxTime: number;
  currentTime: number;
  isPlaying: boolean;
  playbackSpeed: number;
  onPlayPause: (v: boolean) => void;
  onSpeedChange: (v: number) => void;
  onSeek: (ms: number) => void;
  panelOpen: boolean;
  nodeCount: number;
  totalNodes: number;
  currentMs: number;
}

function TimelineBar({
  minTime,
  maxTime,
  currentTime,
  isPlaying,
  playbackSpeed,
  onPlayPause,
  onSpeedChange,
  onSeek,
  panelOpen,
  nodeCount,
  totalNodes,
  currentMs,
}: TimelineBarProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  const range = maxTime - minTime || 1;
  const pct = Math.min(1, Math.max(0, (currentTime - minTime) / range));

  const currentLabel = useMemo(() => {
    const d = new Date(currentTime);
    return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
  }, [currentTime]);

  const handleTrackClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    onSeek(minTime + ratio * range);
  }, [minTime, range, onSeek]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    const onMove = (ev: MouseEvent) => {
      if (!isDragging.current || !trackRef.current) return;
      const rect = trackRef.current.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
      onSeek(minTime + ratio * range);
    };
    const onUp = () => { isDragging.current = false; window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [minTime, range, onSeek]);

  // Compute tick marks (year boundaries)
  const ticks = useMemo(() => {
    const result: { pct: number; label: string }[] = [];
    const startYear = new Date(minTime).getFullYear();
    const endYear = new Date(maxTime).getFullYear();
    for (let y = startYear; y <= endYear; y++) {
      const ms = new Date(y, 0, 1).getTime();
      if (ms < minTime || ms > maxTime) continue;
      result.push({ pct: (ms - minTime) / range, label: String(y) });
    }
    return result;
  }, [minTime, maxTime, range]);

  return (
    <div
      style={{
        position: "absolute",
        bottom: 78,
        left: 216,
        right: panelOpen ? 352 : 24,
        transition: "right 0.35s cubic-bezier(0.32,0,0.15,1)",
        zIndex: 25,
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      {/* Current time label */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingRight: 4 }}>
        <span style={{
          fontFamily: "'DM Mono', monospace",
          fontSize: 11,
          color: "var(--accent-warm)",
          fontWeight: 500,
        }}>
          {currentLabel}
        </span>
        <span style={{
          fontFamily: "'DM Mono', monospace",
          fontSize: 10,
          color: "var(--text-faint)",
        }}>
          {nodeCount} / {totalNodes} nodes
        </span>
      </div>

      {/* Controls row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          background: "var(--panel-bg)",
          backdropFilter: "blur(12px)",
          border: "1px solid var(--border-default)",
          borderRadius: 10,
          padding: "8px 14px",
          boxShadow: "var(--shadow-sm)",
        }}
      >
        {/* Play / Pause */}
        <button
          type="button"
          onClick={() => onPlayPause(!isPlaying)}
          title={isPlaying ? "Pause (Space)" : "Play (Space)"}
          style={{
            flexShrink: 0,
            width: 28,
            height: 28,
            borderRadius: 7,
            border: "1px solid var(--border-default)",
            background: isPlaying ? "var(--accent-warm)" : "var(--bg-overlay)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: isPlaying ? "#fff" : "var(--text-primary)",
            fontSize: 12,
            transition: "background 0.15s, color 0.15s",
            padding: 0,
          }}
        >
          {isPlaying ? "⏸" : "▶"}
        </button>

        {/* Reset */}
        <button
          type="button"
          onClick={() => onSeek(minTime)}
          title="Reset to start"
          style={{
            flexShrink: 0,
            width: 28,
            height: 28,
            borderRadius: 7,
            border: "1px solid var(--border-default)",
            background: "var(--bg-overlay)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--text-muted)",
            fontSize: 11,
            padding: 0,
          }}
        >
          ⏮
        </button>

        {/* Scrubber track */}
        <div style={{ flex: 1, position: "relative", height: 28, display: "flex", alignItems: "center" }}>
          {/* Tick marks */}
          <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
            {ticks.map((t) => (
              <div
                key={t.label}
                style={{
                  position: "absolute",
                  left: `${t.pct * 100}%`,
                  top: 0,
                  bottom: 0,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 2,
                }}
              >
                <div style={{ width: 1, height: 6, background: "var(--border-subtle)", marginTop: 2 }} />
                <span style={{
                  fontFamily: "'DM Mono', monospace",
                  fontSize: 9,
                  color: "var(--text-faint)",
                  transform: "translateX(-50%)",
                  whiteSpace: "nowrap",
                }}>
                  {t.label}
                </span>
              </div>
            ))}
          </div>

          {/* Track */}
          <div
            ref={trackRef}
            onClick={handleTrackClick}
            style={{
              width: "100%",
              height: 4,
              borderRadius: 2,
              background: "var(--border-subtle)",
              position: "relative",
              cursor: "pointer",
            }}
          >
            {/* Fill */}
            <div style={{
              position: "absolute",
              left: 0,
              top: 0,
              height: "100%",
              width: `${pct * 100}%`,
              background: "var(--accent-warm)",
              borderRadius: 2,
              transition: "width 0.05s linear",
            }} />
            {/* Thumb */}
            <div
              onMouseDown={handleMouseDown}
              style={{
                position: "absolute",
                left: `${pct * 100}%`,
                top: "50%",
                transform: "translate(-50%, -50%)",
                width: 14,
                height: 14,
                borderRadius: "50%",
                background: "var(--accent-warm)",
                border: "2px solid var(--bg-surface)",
                cursor: "grab",
                boxShadow: "var(--shadow-sm)",
              }}
            />
          </div>
        </div>

        {/* Speed selector */}
        <div style={{ display: "flex", gap: 2, flexShrink: 0 }}>
          {SPEED_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onSpeedChange(opt.value)}
              title={`${opt.value} month${opt.value === 1 ? "" : "s"} per second`}
              style={{
                height: 22,
                padding: "0 7px",
                borderRadius: 5,
                border: `1px solid ${playbackSpeed === opt.value ? "var(--accent-warm)" : "var(--border-default)"}`,
                background: playbackSpeed === opt.value ? "var(--accent-warm)" : "transparent",
                color: playbackSpeed === opt.value ? "#fff" : "var(--text-faint)",
                fontFamily: "'DM Mono', monospace",
                fontSize: 10,
                cursor: "pointer",
                transition: "background 0.12s, color 0.12s, border-color 0.12s",
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
