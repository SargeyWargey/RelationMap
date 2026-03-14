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

export type ShapeLayout = "sphere" | "seven" | "horse";

type Props = {
  graph: GraphData;
  onSelectNode: (detail: NodeDetail | null) => void;
  selectedNodeId: string | null;
  shape?: ShapeLayout;
  deepHighlight?: boolean;
  panelOpen?: boolean;
  sphereCenterText?: string | null;
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

/**
 * Distribute nodes on the surface of a 3D number "7".
 * The 7 is formed by two segments:
 *   - Top bar: left to right across the top
 *   - Diagonal stroke: from the right end of the bar down-left
 * Nodes sit on the cylindrical tube surface around each segment.
 * The shape fits in roughly a unit cube (coords roughly -0.5..0.5 on each axis),
 * then we normalize so it renders at the same scale as the sphere.
 */
function sevenLayout(
  nodes: Array<{ id: string; databaseId: string }>,
): Map<string, Vec3> {
  const total = nodes.length;
  if (total === 0) return new Map();

  // Define the 7 skeleton in local space
  // Top bar: (-0.5, 0.6, 0) → (0.5, 0.6, 0)
  // Diagonal: (0.5, 0.6, 0) → (-0.2, -0.7, 0)
  const topBarStart:   Vec3 = [-0.5,  0.6, 0];
  const topBarEnd:     Vec3 = [ 0.5,  0.6, 0];
  const diagEnd:       Vec3 = [-0.2, -0.7, 0];

  // Tube radius (the 7 has some thickness)
  const tubeR = 0.09;

  // Length of each segment
  function segLen(a: Vec3, b: Vec3) {
    return Math.sqrt((b[0]-a[0])**2 + (b[1]-a[1])**2 + (b[2]-a[2])**2);
  }
  const lenBar  = segLen(topBarStart, topBarEnd);
  const lenDiag = segLen(topBarEnd, diagEnd);
  const totalLen = lenBar + lenDiag;

  // Proportional node counts per segment
  const nBar  = Math.max(1, Math.round(total * lenBar / totalLen));
  const nDiag = total - nBar;

  // Interleave nodes across databases so colors are evenly spread
  const dbOrder: string[] = [];
  const dbGroups = new Map<string, string[]>();
  for (const n of nodes) {
    if (!dbGroups.has(n.databaseId)) {
      dbOrder.push(n.databaseId);
      dbGroups.set(n.databaseId, []);
    }
    dbGroups.get(n.databaseId)!.push(n.id);
  }
  const interleaved: string[] = [];
  const maxLen2 = Math.max(...dbOrder.map((db) => dbGroups.get(db)!.length));
  for (let i = 0; i < maxLen2; i++) {
    for (const db of dbOrder) {
      const g = dbGroups.get(db)!;
      if (i < g.length) interleaved.push(g[i]);
    }
  }

  // For a point along a segment at parameter t (0..1), compute tube surface position
  // using an angular offset around the segment's local axis
  function tubePoint(a: Vec3, b: Vec3, t: number, angle: number): Vec3 {
    // Segment direction
    const dx = b[0]-a[0], dy = b[1]-a[1], dz = b[2]-a[2];
    const len = Math.sqrt(dx*dx+dy*dy+dz*dz)||1;
    const dir: Vec3 = [dx/len, dy/len, dz/len];

    // A perpendicular vector (use world up [0,0,1] or [0,1,0])
    const up: Vec3 = Math.abs(dir[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0];
    // Gram-Schmidt
    const dot2 = dir[0]*up[0]+dir[1]*up[1]+dir[2]*up[2];
    const perp1: Vec3 = [up[0]-dot2*dir[0], up[1]-dot2*dir[1], up[2]-dot2*dir[2]];
    const p1len = Math.sqrt(perp1[0]**2+perp1[1]**2+perp1[2]**2)||1;
    const n1: Vec3 = [perp1[0]/p1len, perp1[1]/p1len, perp1[2]/p1len];
    // Second perpendicular = dir × n1
    const n2: Vec3 = [dir[1]*n1[2]-dir[2]*n1[1], dir[2]*n1[0]-dir[0]*n1[2], dir[0]*n1[1]-dir[1]*n1[0]];

    const cx3 = a[0] + t*dx;
    const cy3 = a[1] + t*dy;
    const cz3 = a[2] + t*dz;

    return [
      cx3 + tubeR * (Math.cos(angle)*n1[0] + Math.sin(angle)*n2[0]),
      cy3 + tubeR * (Math.cos(angle)*n1[1] + Math.sin(angle)*n2[1]),
      cz3 + tubeR * (Math.cos(angle)*n1[2] + Math.sin(angle)*n2[2]),
    ];
  }

  const result = new Map<string, Vec3>();

  // Place nodes on bar segment
  for (let i = 0; i < nBar && i < interleaved.length; i++) {
    const t = nBar === 1 ? 0.5 : i / (nBar - 1);
    const angle = (i / nBar) * Math.PI * 2 * 3; // helical wrap
    result.set(interleaved[i], tubePoint(topBarStart, topBarEnd, t, angle));
  }
  // Place nodes on diagonal segment
  for (let i = 0; i < nDiag && (nBar + i) < interleaved.length; i++) {
    const t = nDiag === 1 ? 0.5 : i / (nDiag - 1);
    const angle = (i / Math.max(1, nDiag)) * Math.PI * 2 * 5;
    result.set(interleaved[nBar + i], tubePoint(topBarEnd, diagEnd, t, angle));
  }

  // Normalize: find bounding sphere radius and scale to ~1
  let maxR = 0;
  for (const v of result.values()) {
    const r2 = Math.sqrt(v[0]**2 + v[1]**2 + v[2]**2);
    if (r2 > maxR) maxR = r2;
  }
  if (maxR > 0) {
    for (const [id, v] of result.entries()) {
      result.set(id, [v[0]/maxR, v[1]/maxR, v[2]/maxR]);
    }
  }

  return result;
}

/**
 * Distribute nodes on the surface of a 3D horse silhouette.
 * The horse is built from tube segments forming a side-profile skeleton
 * with real Z-depth (body has barrel width). Facing right.
 *
 * Coordinate system: X=right, Y=up, Z=toward viewer
 */
function horseLayout(
  nodes: Array<{ id: string; databaseId: string }>,
): Map<string, Vec3> {
  const total = nodes.length;
  if (total === 0) return new Map();

  // ── Skeleton segments ──────────────────────────────────────────────────
  // Each entry: [start, end, tubeRadius, label]
  // All coords in a local ~2-unit space; will be normalized at the end.
  // Horse faces right (+X). Y is up. Z gives depth.
  const segments: Array<{ a: Vec3; b: Vec3; r: number }> = [
    // Body (barrel) — main torso, slight taper toward rump
    { a: [-0.55,  0.10, 0], b: [ 0.35,  0.15, 0], r: 0.22 },

    // Rump — from body rear up and back slightly
    { a: [ 0.35,  0.15, 0], b: [ 0.50,  0.30, 0], r: 0.15 },

    // Neck — rising forward from chest
    { a: [-0.35,  0.30, 0], b: [-0.15,  0.68, 0], r: 0.10 },

    // Head — from top of neck forward
    { a: [-0.15,  0.68, 0], b: [ 0.10,  0.72, 0], r: 0.09 },

    // Muzzle — from front of head, slight downward angle
    { a: [ 0.10,  0.72, 0], b: [ 0.22,  0.62, 0], r: 0.07 },

    // Ear — short spike up from top of head
    { a: [-0.02,  0.80, 0], b: [ 0.04,  0.90, 0], r: 0.04 },

    // Front-left foreleg upper
    { a: [-0.30, 0.10, 0.06], b: [-0.32, -0.22, 0.06], r: 0.06 },
    // Front-left foreleg lower (slight knee bend)
    { a: [-0.32, -0.22, 0.06], b: [-0.30, -0.55, 0.06], r: 0.05 },

    // Front-right foreleg upper
    { a: [-0.22, 0.10, -0.06], b: [-0.24, -0.22, -0.06], r: 0.06 },
    // Front-right foreleg lower
    { a: [-0.24, -0.22, -0.06], b: [-0.22, -0.55, -0.06], r: 0.05 },

    // Rear-left hind leg upper
    { a: [ 0.28, 0.10, 0.07], b: [ 0.32, -0.18, 0.07], r: 0.07 },
    // Rear-left hind leg lower
    { a: [ 0.32, -0.18, 0.07], b: [ 0.26, -0.55, 0.07], r: 0.05 },

    // Rear-right hind leg upper
    { a: [ 0.20, 0.10, -0.07], b: [ 0.24, -0.18, -0.07], r: 0.07 },
    // Rear-right hind leg lower
    { a: [ 0.24, -0.18, -0.07], b: [ 0.18, -0.55, -0.07], r: 0.05 },

    // Tail — flowing back and down from rump
    { a: [ 0.50,  0.30, 0.00], b: [ 0.72,  0.10, 0.05], r: 0.06 },
    { a: [ 0.72,  0.10, 0.05], b: [ 0.80, -0.10, 0.12], r: 0.05 },
    { a: [ 0.80, -0.10, 0.12], b: [ 0.76, -0.28, 0.16], r: 0.04 },

    // Mane — short segments along top of neck/head
    { a: [-0.30,  0.68, 0.04], b: [-0.18,  0.78, 0.06], r: 0.04 },
    { a: [-0.18,  0.78, 0.06], b: [-0.06,  0.82, 0.05], r: 0.03 },
  ];

  // ── Helpers ───────────────────────────────────────────────────────────
  function segLen(a: Vec3, b: Vec3) {
    return Math.sqrt((b[0]-a[0])**2 + (b[1]-a[1])**2 + (b[2]-a[2])**2);
  }

  function tubePoint(a: Vec3, b: Vec3, r: number, t: number, angle: number): Vec3 {
    const dx = b[0]-a[0], dy = b[1]-a[1], dz = b[2]-a[2];
    const len = Math.sqrt(dx*dx+dy*dy+dz*dz) || 1;
    const dir: Vec3 = [dx/len, dy/len, dz/len];
    const up: Vec3 = Math.abs(dir[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const dot2 = dir[0]*up[0]+dir[1]*up[1]+dir[2]*up[2];
    const perp1: Vec3 = [up[0]-dot2*dir[0], up[1]-dot2*dir[1], up[2]-dot2*dir[2]];
    const p1len = Math.sqrt(perp1[0]**2+perp1[1]**2+perp1[2]**2) || 1;
    const n1: Vec3 = [perp1[0]/p1len, perp1[1]/p1len, perp1[2]/p1len];
    const n2: Vec3 = [dir[1]*n1[2]-dir[2]*n1[1], dir[2]*n1[0]-dir[0]*n1[2], dir[0]*n1[1]-dir[1]*n1[0]];
    return [
      a[0]+t*dx + r*(Math.cos(angle)*n1[0]+Math.sin(angle)*n2[0]),
      a[1]+t*dy + r*(Math.cos(angle)*n1[1]+Math.sin(angle)*n2[1]),
      a[2]+t*dz + r*(Math.cos(angle)*n1[2]+Math.sin(angle)*n2[2]),
    ];
  }

  // Proportional node counts per segment by length
  const lengths = segments.map((s) => segLen(s.a, s.b));
  const totalLen = lengths.reduce((s, l) => s + l, 0);
  const counts = lengths.map((l, i) =>
    i < lengths.length - 1
      ? Math.max(1, Math.round(total * l / totalLen))
      : 0
  );
  // Last segment gets remainder
  counts[counts.length - 1] = Math.max(1, total - counts.slice(0, -1).reduce((s, c) => s + c, 0));

  // Interleave nodes across databases
  const dbOrder: string[] = [];
  const dbGroups = new Map<string, string[]>();
  for (const n of nodes) {
    if (!dbGroups.has(n.databaseId)) { dbOrder.push(n.databaseId); dbGroups.set(n.databaseId, []); }
    dbGroups.get(n.databaseId)!.push(n.id);
  }
  const interleaved: string[] = [];
  const maxLen3 = Math.max(...dbOrder.map((db) => dbGroups.get(db)!.length));
  for (let i = 0; i < maxLen3; i++) {
    for (const db of dbOrder) {
      const g = dbGroups.get(db)!;
      if (i < g.length) interleaved.push(g[i]);
    }
  }

  // Place nodes
  const result = new Map<string, Vec3>();
  let cursor = 0;
  for (let si = 0; si < segments.length; si++) {
    const { a, b, r } = segments[si];
    const n = counts[si];
    for (let i = 0; i < n && cursor < interleaved.length; i++, cursor++) {
      const t = n === 1 ? 0.5 : i / (n - 1);
      const angle = (i / Math.max(1, n)) * Math.PI * 2 * 4;
      result.set(interleaved[cursor], tubePoint(a, b, r, t, angle));
    }
  }

  // Normalize to unit bounding sphere
  let maxR = 0;
  for (const v of result.values()) {
    const r2 = Math.sqrt(v[0]**2+v[1]**2+v[2]**2);
    if (r2 > maxR) maxR = r2;
  }
  if (maxR > 0) {
    for (const [id, v] of result.entries()) {
      result.set(id, [v[0]/maxR, v[1]/maxR, v[2]/maxR]);
    }
  }

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

export function GraphCanvas({ graph, onSelectNode, selectedNodeId, shape = "sphere", deepHighlight = false, panelOpen = false, sphereCenterText }: Props) {
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

  // Fade transition when first database is selected
  const [beanOpacity, setBeanOpacity]     = useState(1);
  const [sphereOpacity, setSphereOpacity] = useState(0);
  const [showBean, setShowBean]           = useState(true);
  const wasEmptyRef = useRef(true);

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
    const positions = shape === "seven"
      ? sevenLayout(graph.nodes)
      : shape === "horse"
        ? horseLayout(graph.nodes)
        : fibonacciSphereByDatabase(graph.nodes);
    setSimNodes(graph.nodes.map((n) => {
      const [sx, sy, sz] = positions.get(n.id)!;
      return { id: n.id, name: n.name, color: n.color, databaseId: n.databaseId, sx, sy, sz };
    }));
    setRotation(QUAT_IDENTITY);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphKey, shape]);

  // ── Fade in sphere / fade out bean on first database selection ──
  useEffect(() => {
    const isEmpty = simNodes.length === 0;
    if (wasEmptyRef.current && !isEmpty) {
      // Transition: empty → has nodes
      wasEmptyRef.current = false;
      setSphereOpacity(1);
      setBeanOpacity(0);
      const timer = setTimeout(() => setShowBean(false), 2000);
      return () => clearTimeout(timer);
    }
    if (!wasEmptyRef.current && isEmpty) {
      // Transition: has nodes → empty (deselect all dbs)
      wasEmptyRef.current = true;
      setSphereOpacity(0);
      // Mount bean at opacity 0, then fade it in on next frame so CSS transition fires
      setBeanOpacity(0);
      setShowBean(true);
      requestAnimationFrame(() => setBeanOpacity(1));
    }
  }, [simNodes.length]);

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

  // ── BFS distance map from selected node ──
  // distance 0 = selected, 1 = direct neighbor, 2 = two hops, etc.
  // In normal mode only distance 0 and 1 are "highlighted" (others dimmed).
  // In deepHighlight mode all reachable nodes are shown with opacity decay.
  const distanceMap = useMemo(() => {
    if (!localSelectedId) return new Map<string, number>();
    const dist = new Map<string, number>();
    dist.set(localSelectedId, 0);
    const queue: string[] = [localSelectedId];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      const curDist = dist.get(cur)!;
      if (!deepHighlight && curDist >= 1) break; // in normal mode only need 1 hop
      for (const edge of graph.edges) {
        let neighbor: string | null = null;
        if (edge.source === cur) neighbor = edge.target;
        else if (edge.target === cur) neighbor = edge.source;
        if (neighbor && !dist.has(neighbor)) {
          dist.set(neighbor, curDist + 1);
          queue.push(neighbor);
        }
      }
    }
    return dist;
  }, [localSelectedId, graph.edges, deepHighlight]);

  const selectedNeighbors = useMemo(() => {
    const neighbors = new Set<string>();
    for (const [id, d] of distanceMap) {
      if (d === 1) neighbors.add(id);
    }
    return neighbors;
  }, [distanceMap]);

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

        {/* Empty state — no database selected */}
        {showBean && (() => {
          const r = Math.min(size.w, size.h) * SPHERE_FILL_RATIO * zoom;
          const imgSize = r * 2 * 0.9;
          return (
            <g style={{ pointerEvents: "none", transition: "opacity 2s ease", opacity: beanOpacity }}>
              <image
                href="/bean.png"
                x={size.w / 2 - imgSize / 2}
                y={size.h / 2 - imgSize / 2}
                width={imgSize}
                height={imgSize}
                preserveAspectRatio="xMidYMid meet"
              />
            </g>
          );
        })()}

        {/* Sphere content — fades in when first database is selected */}
        <g style={{ opacity: sphereOpacity, transition: "opacity 2s ease" }}>

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
          // In deep highlight mode, an edge is "related" if either endpoint has a finite distance
          const srcDist = distanceMap.get(edge.source) ?? Infinity;
          const tgtDist = distanceMap.get(edge.target) ?? Infinity;
          const edgeDist = Math.min(srcDist, tgtDist); // distance of the closer endpoint
          const isDeepRelated = deepHighlight && localSelectedId !== null && edgeDist < Infinity;
          const isDimmed  = localSelectedId !== null && !isRelated && !isDeepRelated;
          const isHiddenEdge = deepHighlight && localSelectedId !== null && !isRelated && !isDeepRelated;

          // Decay edge opacity by hop distance in deep mode
          const edgeDepthDecay = isDeepRelated && !isRelated
            ? Math.max(0.3, Math.pow(0.80, edgeDist))
            : 1;

          // In deep mode color the edge by the farther endpoint's node color
          // (the node further from the selected root, i.e. higher distance)
          const deepEdgeColor = deepHighlight && isDeepRelated && !isRelated
            ? (srcDist >= tgtDist ? src.color : tgt.color)
            : null;

          return (
            <path
              key={edge.id}
              d={`M ${src.screenX},${src.screenY} Q ${mid2.screenX},${mid2.screenY} ${tgt.screenX},${tgt.screenY}`}
              fill="none"
              stroke={isRelated ? "var(--accent-warm)" : deepEdgeColor ?? "var(--edge-color)"}
              strokeWidth={isRelated ? lerp(0.6, 1.8, avgDepth) : lerp(0.3, 1.0, avgDepth)}
              opacity={isHiddenEdge ? 0 : isDimmed ? 0.05 : lerp(0.04, isRelated ? 0.85 : 0.55, avgDepth) * edgeDepthDecay}
              style={{ transition: "opacity 0.25s, stroke 0.25s" }}
            />
          );
        })}

        {/* Nodes — sorted back to front */}
        {projected.map((node) => {
          const isSelected = node.id === localSelectedId;
          const isHovered  = node.id === hoveredId;
          const isNeighbor = selectedNeighbors.has(node.id);
          const nodeDist   = distanceMap.get(node.id) ?? Infinity;
          const isDimmed   = localSelectedId !== null && !isSelected && !isNeighbor &&
                             (!deepHighlight || nodeDist === Infinity);
          const isHidden   = deepHighlight && localSelectedId !== null && nodeDist === Infinity;

          const degree = degreeMap.get(node.id) ?? 0;
          const degreeScale = lerp(0.6, 2.2, degree / maxDegree);
          const baseR  = (isSelected ? NODE_RADIUS_SELECTED : NODE_RADIUS) * degreeScale;
          const r      = baseR * lerp(DEPTH_MIN_RADIUS, 1.0, node.depth);
          const opacityBase = lerp(DEPTH_MIN_OPACITY, 1.0, node.depth);

          // In deep highlight mode, decay opacity by hop distance
          // dist 1 → 0.90, dist 2 → 0.72, dist 3 → 0.58, dist 4 → 0.47, …
          const depthDecay = deepHighlight && localSelectedId !== null && !isSelected && nodeDist < Infinity
            ? Math.max(0.35, Math.pow(0.80, nodeDist - 1))
            : 1;
          const opacity = isHidden ? 0 : isDimmed ? opacityBase * 0.2 : opacityBase * depthDecay;

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

        </g>{/* end sphere content */}

        {/* Center text overlay — driven by field config */}
        {sphereCenterText && localSelectedId && (() => {
          const sphereR = Math.min(size.w, size.h) * SPHERE_FILL_RATIO * zoom;
          const maxW = sphereR * 1.1;
          return (
            <foreignObject
              x={size.w / 2 - maxW / 2}
              y={size.h / 2 - sphereR * 0.55}
              width={maxW}
              height={sphereR * 1.1}
              style={{ pointerEvents: "none" }}
            >
              <div
                // @ts-expect-error xmlns required for foreignObject
                xmlns="http://www.w3.org/1999/xhtml"
                style={{
                  width: "100%",
                  height: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  overflow: "hidden",
                }}
              >
                <p style={{
                  margin: 0,
                  fontFamily: "'Lora', Georgia, serif",
                  fontSize: Math.max(13, Math.min(26, sphereR * 0.085)),
                  fontWeight: 500,
                  color: "var(--text-primary)",
                  lineHeight: 1.5,
                  textAlign: "center",
                  opacity: 0.88,
                  textShadow: "0 1px 12px var(--bg-base), 0 0 24px var(--bg-base)",
                  padding: "0 8px",
                  display: "-webkit-box",
                  WebkitLineClamp: 6,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}>
                  {sphereCenterText}
                </p>
              </div>
            </foreignObject>
          );
        })()}
      </svg>

      {/* Zoom buttons */}
      <div style={{
        position: "absolute",
        top: 60,
        right: panelOpen ? 332 : 24,
        display: "flex",
        flexDirection: "column",
        gap: 12,
        zIndex: 20,
        transition: "right 0.35s cubic-bezier(0.32, 0, 0.15, 1)",
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
  width: 28,
  height: 28,
  background: "var(--panel-bg)",
  backdropFilter: "blur(12px)",
  border: "1px solid var(--border-default)",
  borderRadius: 8,
  cursor: "pointer",
  fontSize: 14,
  color: "var(--text-muted)",
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
