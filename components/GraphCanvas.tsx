"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { GraphData, NodeDetail } from "@/lib/types";

// ─── Types ────────────────────────────────────────────────────────────────────

type Vec3 = [number, number, number];
type Quat = [number, number, number, number]; // [x, y, z, w]

type SimNode = {
  id: string;
  name: string;
  color: string;
  databaseId: string;
  sx: number; sy: number; sz: number; // unit sphere position
};

type ProjectedNode = SimNode & {
  screenX: number;
  screenY: number;
  depth: number; // 0 = back, 1 = front
};

type Props = {
  graph: GraphData;
  onSelectNode: (detail: NodeDetail | null) => void;
  selectedNodeId: string | null;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 5.0;
const NODE_RADIUS = 7;
const NODE_RADIUS_SELECTED = 10;
const SPHERE_FILL_RATIO = 0.40;
const FOV_BASE = 2.5;
const DRAG_SENSITIVITY = 0.006;
const DEPTH_MIN_OPACITY = 0.18;
const DEPTH_MIN_RADIUS = 0.38;

// ─── 3D Math ──────────────────────────────────────────────────────────────────

const QUAT_IDENTITY: Quat = [0, 0, 0, 1];

function quatMul(a: Quat, b: Quat): Quat {
  return [
    a[3]*b[0] + a[0]*b[3] + a[1]*b[2] - a[2]*b[1],
    a[3]*b[1] - a[0]*b[2] + a[1]*b[3] + a[2]*b[0],
    a[3]*b[2] + a[0]*b[1] - a[1]*b[0] + a[2]*b[3],
    a[3]*b[3] - a[0]*b[0] - a[1]*b[1] - a[2]*b[2],
  ];
}

function quatFromAxisAngle(axis: Vec3, angle: number): Quat {
  const s = Math.sin(angle / 2);
  return [axis[0]*s, axis[1]*s, axis[2]*s, Math.cos(angle / 2)];
}

function quatRotate(q: Quat, v: Vec3): Vec3 {
  // v' = q * [v,0] * q^-1  (optimized form)
  const [qx, qy, qz, qw] = q;
  const [vx, vy, vz] = v;
  const tx = 2*(qy*vz - qz*vy);
  const ty = 2*(qz*vx - qx*vz);
  const tz = 2*(qx*vy - qy*vx);
  return [
    vx + qw*tx + qy*tz - qz*ty,
    vy + qw*ty + qz*tx - qx*tz,
    vz + qw*tz + qx*ty - qy*tx,
  ];
}

function quatNorm(q: Quat): Quat {
  const len = Math.sqrt(q[0]**2 + q[1]**2 + q[2]**2 + q[3]**2) || 1;
  return [q[0]/len, q[1]/len, q[2]/len, q[3]/len];
}

function quatSlerp(a: Quat, b: Quat, t: number): Quat {
  let dot = a[0]*b[0] + a[1]*b[1] + a[2]*b[2] + a[3]*b[3];
  // Choose shortest path
  const b2: Quat = dot < 0 ? [-b[0], -b[1], -b[2], -b[3]] : [...b];
  dot = Math.abs(dot);
  if (dot > 0.9995) {
    // Linear fallback for nearly identical quats
    return quatNorm([a[0]+(b2[0]-a[0])*t, a[1]+(b2[1]-a[1])*t, a[2]+(b2[2]-a[2])*t, a[3]+(b2[3]-a[3])*t]);
  }
  const omega = Math.acos(Math.min(1, dot));
  const sinOmega = Math.sin(omega);
  const sa = Math.sin((1-t)*omega) / sinOmega;
  const sb = Math.sin(t*omega) / sinOmega;
  return [sa*a[0]+sb*b2[0], sa*a[1]+sb*b2[1], sa*a[2]+sb*b2[2], sa*a[3]+sb*b2[3]];
}

/**
 * Distribute nodes evenly across the entire sphere, with each database's
 * nodes interleaved throughout so all databases are represented everywhere.
 * Achieved by sorting nodes so databases alternate, then running a single
 * fibonacci spiral over the full sorted list.
 */
function fibonacciSphereByDatabase(
  nodes: Array<{ id: string; databaseId: string }>,
): Map<string, Vec3> {
  const total = nodes.length;
  if (total === 0) return new Map();

  // Group nodes by database, preserving insertion order of databases
  const dbOrder: string[] = [];
  const dbGroups = new Map<string, string[]>();
  for (const n of nodes) {
    if (!dbGroups.has(n.databaseId)) {
      dbOrder.push(n.databaseId);
      dbGroups.set(n.databaseId, []);
    }
    dbGroups.get(n.databaseId)!.push(n.id);
  }

  // Interleave: round-robin across databases so nodes from each db are
  // spread throughout the spiral index range rather than clumped together
  const interleaved: string[] = [];
  const maxLen = Math.max(...dbOrder.map((db) => dbGroups.get(db)!.length));
  for (let i = 0; i < maxLen; i++) {
    for (const db of dbOrder) {
      const group = dbGroups.get(db)!;
      if (i < group.length) interleaved.push(group[i]);
    }
  }

  // Single fibonacci spiral over all nodes
  const phi = Math.PI * (3 - Math.sqrt(5));
  const result = new Map<string, Vec3>();
  interleaved.forEach((id, i) => {
    const y = 1 - (i / (total - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = phi * i;
    result.set(id, [Math.cos(theta) * r, y, Math.sin(theta) * r]);
  });

  return result;
}

function slerp(a: Vec3, b: Vec3, t: number): Vec3 {
  const dot = Math.max(-1, Math.min(1, a[0]*b[0] + a[1]*b[1] + a[2]*b[2]));
  const omega = Math.acos(dot);
  if (omega < 0.001) {
    // linear fallback for nearly identical points
    const x = a[0] + (b[0]-a[0])*t;
    const y = a[1] + (b[1]-a[1])*t;
    const z = a[2] + (b[2]-a[2])*t;
    const len = Math.sqrt(x*x+y*y+z*z)||1;
    return [x/len, y/len, z/len];
  }
  const sinOmega = Math.sin(omega);
  const sa = Math.sin((1-t)*omega)/sinOmega;
  const sb = Math.sin(t*omega)/sinOmega;
  return [sa*a[0]+sb*b[0], sa*a[1]+sb*b[1], sa*a[2]+sb*b[2]];
}

function project(
  rotated: Vec3,
  cx: number, cy: number,
  sphereRadius: number,
  fov: number,
): { screenX: number; screenY: number; depth: number } {
  const scale = fov / (fov - rotated[2]);
  return {
    screenX: cx + rotated[0] * sphereRadius * scale,
    screenY: cy + rotated[1] * sphereRadius * scale,
    depth: (rotated[2] + 1) / 2,
  };
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

// ─── Component ────────────────────────────────────────────────────────────────

export function GraphCanvas({ graph, onSelectNode, selectedNodeId }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef       = useRef<SVGSVGElement>(null);

  const [rotation, setRotation] = useState<Quat>(QUAT_IDENTITY);
  const [zoom, setZoom]         = useState(1.0);

  // Animation state for smooth focus transitions
  const animFrameRef    = useRef<number | null>(null);
  const animStartRef    = useRef<number>(0);
  const animFromRef     = useRef<Quat>(QUAT_IDENTITY);
  const animToRef       = useRef<Quat>(QUAT_IDENTITY);
  const ANIM_DURATION   = 600; // ms

  const isDragging   = useRef(false);
  const dragStart    = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const rotAtDrag    = useRef<Quat>(QUAT_IDENTITY);

  const [hoveredId, setHoveredId]             = useState<string | null>(null);
  const [localSelectedId, setLocalSelectedId] = useState<string | null>(null);
  const [simNodes, setSimNodes]               = useState<SimNode[]>([]);

  // Container size for projection
  const [size, setSize] = useState({ w: 800, h: 600 });
  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setSize({ w: r.width, h: r.height });
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  // ── Graph change → place nodes on sphere ──
  const graphKey = graph.nodes.map((n) => n.id).sort().join(",");
  const lastGraphKey = useRef("");

  useEffect(() => {
    if (graphKey === lastGraphKey.current) return;
    lastGraphKey.current = graphKey;
    if (graph.nodes.length === 0) { setSimNodes([]); return; }
    const positions = fibonacciSphereByDatabase(graph.nodes);
    setSimNodes(graph.nodes.map((n) => {
      const [sx, sy, sz] = positions.get(n.id)!;
      return { id: n.id, name: n.name, color: n.color, databaseId: n.databaseId, sx, sy, sz };
    }));
    setRotation(QUAT_IDENTITY);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphKey]);

  // ── Sync external selection (from detail panel) ──
  useEffect(() => {
    if (!selectedNodeId) {
      setLocalSelectedId(null);
      return;
    }
    setLocalSelectedId(selectedNodeId);

    // Find the node's unit-sphere position
    const node = simNodes.find((n) => n.id === selectedNodeId);
    if (!node) return;

    // We want to rotate the sphere so the node ends up at front-center,
    // but offset upward to 2/3 of the viewport height (1/3 from top).
    // The sphere center is at cy = h/2; 2/3 up means screenY = h/3.
    // That corresponds to a vertical offset of -h/6 from center in world space.
    // We achieve this by targeting the node at (0, yOffset, 1) direction
    // where yOffset = -( (h/6) / sphereRadius ).
    // Since we want the node on the front (z=1 after rotation), we need to
    // find a rotation that maps node's sphere pos to (0, yTarget, 1)-normalised.
    const sphereRadius = Math.min(size.w, size.h) * SPHERE_FILL_RATIO;
    const yOffset = -(size.h / 6) / sphereRadius; // negative = up
    const targetY = Math.max(-0.85, Math.min(0.85, yOffset));
    const targetX = 0;
    const targetZ = Math.sqrt(Math.max(0, 1 - targetX * targetX - targetY * targetY));
    const target: Vec3 = [targetX, targetY, targetZ];

    // Rotation that takes node's current world position to `target`:
    // We solve for q such that q * nodePos = target.
    // Use the half-angle between nodePos (after current rotation) and target.
    const nodeWorld = quatRotate(rotation, [node.sx, node.sy, node.sz]);
    const dot = Math.max(-1, Math.min(1, nodeWorld[0]*target[0] + nodeWorld[1]*target[1] + nodeWorld[2]*target[2]));
    if (dot > 0.9999) return; // already there

    const cross: Vec3 = [
      nodeWorld[1]*target[2] - nodeWorld[2]*target[1],
      nodeWorld[2]*target[0] - nodeWorld[0]*target[2],
      nodeWorld[0]*target[1] - nodeWorld[1]*target[0],
    ];
    const crossLen = Math.sqrt(cross[0]**2 + cross[1]**2 + cross[2]**2) || 1;
    const axis: Vec3 = [cross[0]/crossLen, cross[1]/crossLen, cross[2]/crossLen];
    const angle = Math.acos(dot);
    const deltaQ = quatFromAxisAngle(axis, angle);
    const targetRotation = quatNorm(quatMul(deltaQ, rotation));

    // Animate from current rotation to targetRotation
    if (animFrameRef.current !== null) cancelAnimationFrame(animFrameRef.current);
    animFromRef.current = rotation;
    animToRef.current = targetRotation;
    animStartRef.current = performance.now();

    function animate(now: number) {
      const t = Math.min(1, (now - animStartRef.current) / ANIM_DURATION);
      const ease = t < 0.5 ? 2*t*t : -1 + (4 - 2*t)*t; // ease-in-out quad
      setRotation(quatNorm(quatSlerp(animFromRef.current, animToRef.current, ease)));
      if (t < 1) {
        animFrameRef.current = requestAnimationFrame(animate);
      } else {
        animFrameRef.current = null;
      }
    }
    animFrameRef.current = requestAnimationFrame(animate);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNodeId]);

  // ── Fetch node detail when selection changes ──
  useEffect(() => {
    if (!localSelectedId) { onSelectNode(null); return; }
    void fetch(`/api/node/${localSelectedId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((payload: NodeDetail | null) => onSelectNode(payload))
      .catch(() => onSelectNode(null));
  }, [localSelectedId, onSelectNode]);

  // ── Neighbors of selected node ──
  const selectedNeighbors = useMemo(() => {
    if (!localSelectedId) return new Set<string>();
    const neighbors = new Set<string>();
    for (const edge of graph.edges) {
      if (edge.source === localSelectedId) neighbors.add(edge.target);
      if (edge.target === localSelectedId) neighbors.add(edge.source);
    }
    return neighbors;
  }, [localSelectedId, graph.edges]);

  // ── Connection degree per node ──
  const degreeMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const edge of graph.edges) {
      map.set(edge.source, (map.get(edge.source) ?? 0) + 1);
      map.set(edge.target, (map.get(edge.target) ?? 0) + 1);
    }
    return map;
  }, [graph.edges]);

  const maxDegree = useMemo(() => Math.max(1, ...degreeMap.values()), [degreeMap]);

  // ── Project all nodes ──
  const { projected, projectedMap } = useMemo(() => {
    const cx = size.w / 2;
    const cy = size.h / 2;
    const sphereRadius = Math.min(size.w, size.h) * SPHERE_FILL_RATIO * zoom;
    const fov = FOV_BASE;

    const list: ProjectedNode[] = simNodes.map((n) => {
      const rotated = quatRotate(rotation, [n.sx, n.sy, n.sz]);
      const { screenX, screenY, depth } = project(rotated, cx, cy, sphereRadius, fov);
      return { ...n, screenX, screenY, depth };
    });

    // Sort back-to-front so front nodes paint over back nodes
    list.sort((a, b) => a.depth - b.depth);

    const map = new Map<string, ProjectedNode>(list.map((n) => [n.id, n]));
    return { projected: list, projectedMap: map };
  }, [simNodes, rotation, zoom, size]);

  // ── Mouse handlers ──
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as Element).closest("[data-node]")) return;
    isDragging.current = true;
    dragStart.current = { x: e.clientX, y: e.clientY };
    rotAtDrag.current = rotation;
  }, [rotation]);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging.current) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    const dist = Math.sqrt(dx*dx + dy*dy);
    if (dist < 0.5) return;
    const axis: Vec3 = [dy/dist, dx/dist, 0];
    const angle = dist * DRAG_SENSITIVITY;
    const delta = quatFromAxisAngle(axis, angle);
    setRotation(quatNorm(quatMul(delta, rotAtDrag.current)));
  }, []);

  const stopDrag = useCallback(() => { isDragging.current = false; }, []);

  // ── Wheel zoom ──
  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.12 : 1/1.12;
    setZoom((z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z * factor)));
  }, []);

  // ── Touch handlers ──
  const lastTouches = useRef<React.Touch[]>([]);
  const touchRotStart = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const touchRotCapture = useRef<Quat>(QUAT_IDENTITY);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    lastTouches.current = Array.from(e.touches);
    if (e.touches.length === 1) {
      touchRotStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      touchRotCapture.current = rotation;
    }
  }, [rotation]);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    const touches = Array.from(e.touches);
    if (touches.length === 1) {
      const dx = touches[0].clientX - touchRotStart.current.x;
      const dy = touches[0].clientY - touchRotStart.current.y;
      const dist = Math.sqrt(dx*dx + dy*dy);
      if (dist < 0.5) return;
      const axis: Vec3 = [dy/dist, dx/dist, 0];
      const angle = dist * DRAG_SENSITIVITY;
      const delta = quatFromAxisAngle(axis, angle);
      setRotation(quatNorm(quatMul(delta, touchRotCapture.current)));
    } else if (touches.length === 2 && lastTouches.current.length >= 2) {
      const distNow  = Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
      const distPrev = Math.hypot(lastTouches.current[0].clientX - lastTouches.current[1].clientX, lastTouches.current[0].clientY - lastTouches.current[1].clientY);
      const factor = distNow / (distPrev || 1);
      setZoom((z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z * factor)));
    }
    lastTouches.current = touches;
  }, []);

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%", height: "100%",
        position: "relative", overflow: "hidden",
        userSelect: "none",
        cursor: isDragging.current ? "grabbing" : "grab",
        background: "var(--bg-base)",
      }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={stopDrag}
      onMouseLeave={stopDrag}
      onWheel={onWheel}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={() => { lastTouches.current = []; }}
    >
      <svg ref={svgRef} style={{ width: "100%", height: "100%", display: "block" }}>
        <defs>
          <filter id="node-glow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="3.5" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <filter id="node-glow-soft" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="7" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {/* Sphere outline hint */}
        <ellipse
          cx={size.w / 2}
          cy={size.h / 2}
          rx={Math.min(size.w, size.h) * SPHERE_FILL_RATIO * zoom}
          ry={Math.min(size.w, size.h) * SPHERE_FILL_RATIO * zoom}
          fill="none"
          stroke="var(--border-subtle)"
          strokeWidth={1}
          opacity={0.35}
        />

        {/* Edges — drawn before nodes */}
        {graph.edges.map((edge) => {
          const src = projectedMap.get(edge.source);
          const tgt = projectedMap.get(edge.target);
          if (!src || !tgt) return null;

          const avgDepth = (src.depth + tgt.depth) / 2;

          // Great-circle arc via slerp midpoint as quadratic bezier control
          const rotSrc = quatRotate(rotation, [src.sx, src.sy, src.sz]);
          const rotTgt = quatRotate(rotation, [tgt.sx, tgt.sy, tgt.sz]);
          const mid3   = slerp(rotSrc, rotTgt, 0.5);
          const cx2    = size.w / 2;
          const cy2    = size.h / 2;
          const sphereR = Math.min(size.w, size.h) * SPHERE_FILL_RATIO * zoom;
          const mid2   = project(mid3, cx2, cy2, sphereR, FOV_BASE);

          const isRelated = localSelectedId !== null && (
            edge.source === localSelectedId || edge.target === localSelectedId
          );
          const isDimmed = localSelectedId !== null && !isRelated;

          return (
            <path
              key={edge.id}
              d={`M ${src.screenX},${src.screenY} Q ${mid2.screenX},${mid2.screenY} ${tgt.screenX},${tgt.screenY}`}
              fill="none"
              stroke={isRelated ? "var(--accent-warm)" : "var(--edge-color)"}
              strokeWidth={isRelated ? lerp(0.6, 1.8, avgDepth) : lerp(0.3, 1.0, avgDepth)}
              opacity={isDimmed ? 0.05 : lerp(0.04, isRelated ? 0.85 : 0.55, avgDepth)}
              style={{ transition: "opacity 0.25s, stroke 0.25s" }}
            />
          );
        })}

        {/* Nodes — sorted back to front */}
        {projected.map((node) => {
          const isSelected = node.id === localSelectedId;
          const isHovered  = node.id === hoveredId;
          const isNeighbor = selectedNeighbors.has(node.id);
          const isDimmed   = localSelectedId !== null && !isSelected && !isNeighbor;

          const degree = degreeMap.get(node.id) ?? 0;
          const degreeScale = lerp(0.6, 2.2, degree / maxDegree);
          const baseR  = (isSelected ? NODE_RADIUS_SELECTED : NODE_RADIUS) * degreeScale;
          const r      = baseR * lerp(DEPTH_MIN_RADIUS, 1.0, node.depth);
          const opacityBase = lerp(DEPTH_MIN_OPACITY, 1.0, node.depth);
          const opacity = isDimmed ? opacityBase * 0.2 : opacityBase;

          const showLabel = isHovered || isSelected;

          return (
            <g
              key={node.id}
              data-node="true"
              style={{ cursor: "pointer" }}
              onClick={() => setLocalSelectedId(isSelected ? null : node.id)}
              onMouseEnter={() => setHoveredId(node.id)}
              onMouseLeave={() => setHoveredId(null)}
            >
              {/* Selection ring */}
              {isSelected && (
                <circle
                  cx={node.screenX} cy={node.screenY} r={r + 7}
                  fill="none"
                  stroke={node.color}
                  strokeWidth={1}
                  opacity={0.28}
                />
              )}

              {/* Hover aura */}
              {isHovered && !isSelected && (
                <circle
                  cx={node.screenX} cy={node.screenY} r={r + 4}
                  fill={node.color}
                  opacity={0.12}
                />
              )}

              {/* Main circle */}
              <circle
                cx={node.screenX} cy={node.screenY} r={r}
                fill={node.color}
                stroke={
                  isSelected ? "var(--bg-base)" :
                  isHovered  ? "rgba(255,255,255,0.9)" :
                               "rgba(255,255,255,0.4)"
                }
                strokeWidth={isSelected ? 2.5 : 1.5}
                opacity={opacity}
                filter={isSelected ? "url(#node-glow)" : isHovered ? "url(#node-glow-soft)" : undefined}
                style={{ transition: "opacity 0.2s" }}
              />

              {/* Label */}
              {showLabel && (
                <text
                  x={node.screenX + r + 5}
                  y={node.screenY + 4}
                  fontSize={12}
                  fontFamily="'Geist', sans-serif"
                  fontWeight={isSelected ? "500" : "400"}
                  fill={isSelected ? "var(--text-primary)" : "var(--text-secondary)"}
                  stroke="var(--bg-base)"
                  strokeWidth={3}
                  strokeLinejoin="round"
                  paintOrder="stroke"
                  style={{ pointerEvents: "none" }}
                >
                  {node.name}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {/* Zoom buttons */}
      <div style={{
        position: "absolute", top: 20, right: 24,
        display: "flex", flexDirection: "column", gap: 4, zIndex: 20,
      }}>
        {([
          { label: "+", delta: 1.4 },
          { label: "−", delta: 1 / 1.4 },
        ] as const).map(({ label, delta }) => (
          <button
            key={label}
            type="button"
            onClick={() => setZoom((z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z * delta)))}
            style={zoomBtnStyle}
            onMouseEnter={(e) => Object.assign((e.currentTarget as HTMLElement).style, zoomBtnHover)}
            onMouseLeave={(e) => Object.assign((e.currentTarget as HTMLElement).style, zoomBtnStyle)}
          >
            {label}
          </button>
        ))}
        {/* Reset rotation */}
        <button
          type="button"
          title="Reset view"
          onClick={() => { setRotation(QUAT_IDENTITY); setZoom(1); }}
          style={{ ...zoomBtnStyle, fontSize: 13 }}
          onMouseEnter={(e) => Object.assign((e.currentTarget as HTMLElement).style, zoomBtnHover)}
          onMouseLeave={(e) => Object.assign((e.currentTarget as HTMLElement).style, { ...zoomBtnStyle, fontSize: "13px" })}
        >
          ⌖
        </button>
      </div>
    </div>
  );
}

const zoomBtnStyle: React.CSSProperties = {
  width: 32, height: 32,
  background: "var(--panel-bg)",
  backdropFilter: "blur(12px)",
  border: "1px solid var(--border-default)",
  borderRadius: 8,
  cursor: "pointer",
  fontSize: 18,
  color: "var(--text-secondary)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  boxShadow: "var(--shadow-sm)",
  transition: "background 0.15s, color 0.15s",
  fontFamily: "inherit",
  lineHeight: "1",
};

const zoomBtnHover: React.CSSProperties = {
  ...zoomBtnStyle,
  background: "var(--bg-overlay)",
  color: "var(--accent-warm)",
};
