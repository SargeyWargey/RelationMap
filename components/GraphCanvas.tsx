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
  rx: number; ry: number; rz: number; // rotated unit-sphere position (reused by edges)
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
  centerTextOpacity?: number;
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

// Intro animation: offset the sphere settles in from when the first database
// is selected.
const INTRO_DURATION = 3500; // ms
const INTRO_OFFSET_YAW = Math.PI / 12;   // ~15° left
const INTRO_OFFSET_PITCH = Math.PI / 15; // ~12° up

// Dot-product threshold above which the selected node is treated as already
// at the focus target (no rotation animation needed).
const ROTATION_ALIGNED_DOT = 0.9999;

// Wheel/button zoom easing duration
const ZOOM_ANIM_MS = 120;

function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3);
}

// ─── Depth atmosphere (B4) ────────────────────────────────────────────────────
// Back-of-sphere nodes cool down and desaturate slightly; front nodes keep
// full warmth. Results are cached per (color, quantized depth) so the hot
// render path only does a Map lookup.

const DEPTH_TINT_STEPS = 12;
const DEPTH_TINT_MAX = 0.45; // max desaturation/cooling at the very back

const depthTintCache = new Map<string, string>();

function depthTintColor(color: string, depth: number): string {
  const step = Math.round(Math.max(0, Math.min(1, depth)) * DEPTH_TINT_STEPS);
  if (step >= DEPTH_TINT_STEPS) return color;
  const key = `${color}|${step}`;
  const cached = depthTintCache.get(key);
  if (cached) return cached;

  let hex = color.startsWith("#") ? color.slice(1) : null;
  if (hex && hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
  if (!hex || !/^[0-9a-fA-F]{6}$/.test(hex)) {
    // Non-hex colors (css vars etc.) pass through untinted
    depthTintCache.set(key, color);
    return color;
  }
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const t = (1 - step / DEPTH_TINT_STEPS) * DEPTH_TINT_MAX;
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  // Desaturate toward luminance, then nudge cooler (less red, a touch more blue)
  const rr = Math.round((r + (lum - r) * t) * (1 - 0.10 * t));
  const gg = Math.round(g + (lum - g) * t);
  const bb = Math.round(Math.min(255, (b + (lum - b) * t) * (1 + 0.08 * t)));
  const out = `rgb(${rr},${gg},${bb})`;
  depthTintCache.set(key, out);
  return out;
}

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

/** Inverse of a unit quaternion (conjugate). */
function quatInverse(q: Quat): Quat {
  return [-q[0], -q[1], -q[2], q[3]];
}

/** Convert quaternion to a CSS matrix3d() rotation string (column-major). */
function quatToMatrix3d(q: Quat): string {
  const [qx, qy, qz, qw] = q;
  const r00 = 1 - 2*(qy*qy + qz*qz);
  const r01 = 2*(qx*qy - qz*qw);
  const r02 = 2*(qx*qz + qy*qw);
  const r10 = 2*(qx*qy + qz*qw);
  const r11 = 1 - 2*(qx*qx + qz*qz);
  const r12 = 2*(qy*qz - qx*qw);
  const r20 = 2*(qx*qz - qy*qw);
  const r21 = 2*(qy*qz + qx*qw);
  const r22 = 1 - 2*(qx*qx + qy*qy);
  // matrix3d is column-major: col0, col1, col2, col3
  return `matrix3d(${r00},${r10},${r20},0, ${r01},${r11},${r21},0, ${r02},${r12},${r22},0, 0,0,0,1)`;
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

export function GraphCanvas({ graph, onSelectNode, selectedNodeId, shape = "sphere", deepHighlight = false, panelOpen = false, sphereCenterText, centerTextOpacity = 0.25 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef       = useRef<SVGSVGElement>(null);

  const [rotation, setRotation] = useState<Quat>(QUAT_IDENTITY);
  const [textBaseRotation, setTextBaseRotation] = useState<Quat>(QUAT_IDENTITY);
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

  // Center text fade animation state
  const [displayedCenterText, setDisplayedCenterText] = useState<string | null>(null);
  const [centerTextAnimOpacity, setCenterTextAnimOpacity] = useState(0);
  const centerTextFadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (centerTextFadeTimer.current) clearTimeout(centerTextFadeTimer.current);

    if (!sphereCenterText) {
      // No text — fade out immediately
      setCenterTextAnimOpacity(0);
      centerTextFadeTimer.current = setTimeout(() => setDisplayedCenterText(null), 500);
      return;
    }

    if (!displayedCenterText) {
      // First text — fade in over 1.5s
      setDisplayedCenterText(sphereCenterText);
      setCenterTextAnimOpacity(0);
      centerTextFadeTimer.current = setTimeout(() => setCenterTextAnimOpacity(centerTextOpacity), 30);
    } else {
      // Switching text — fade out old (0.5s), then swap and fade in new (1.5s)
      setCenterTextAnimOpacity(0);
      centerTextFadeTimer.current = setTimeout(() => {
        setDisplayedCenterText(sphereCenterText);
        centerTextFadeTimer.current = setTimeout(() => setCenterTextAnimOpacity(centerTextOpacity), 30);
      }, 500);
    }

    return () => {
      if (centerTextFadeTimer.current) clearTimeout(centerTextFadeTimer.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sphereCenterText]);

  // Keep displayed opacity in sync when centerTextOpacity setting changes (no animation)
  useEffect(() => {
    if (displayedCenterText) setCenterTextAnimOpacity(centerTextOpacity);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centerTextOpacity]);

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
    setTextBaseRotation(QUAT_IDENTITY);
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
      const timer = setTimeout(() => setShowBean(false), 4000);

      // Intro rotation: start offset toward top-left, settle to identity
      const startRot = quatNorm(quatMul(
        quatFromAxisAngle([0, -1, 0], INTRO_OFFSET_YAW),
        quatFromAxisAngle([-1, 0, 0], INTRO_OFFSET_PITCH),
      ));
      setRotation(startRot);
      const introStart = performance.now();
      let introFrame: number;
      const introStep = (now: number) => {
        const t = Math.min(1, (now - introStart) / INTRO_DURATION);
        const ease = easeOutCubic(t);
        setRotation(quatNorm(quatSlerp(startRot, QUAT_IDENTITY, ease)));
        if (t < 1) introFrame = requestAnimationFrame(introStep);
      };
      introFrame = requestAnimationFrame(introStep);

      return () => { clearTimeout(timer); cancelAnimationFrame(introFrame); };
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
    const focusSphereRadius = Math.min(size.w, size.h) * SPHERE_FILL_RATIO;
    const yOffset = -(size.h / 6) / focusSphereRadius; // negative = up
    const targetY = Math.max(-0.85, Math.min(0.85, yOffset));
    const targetX = 0;
    const targetZ = Math.sqrt(Math.max(0, 1 - targetX * targetX - targetY * targetY));
    const target: Vec3 = [targetX, targetY, targetZ];

    // Rotation that takes node's current world position to `target`:
    // We solve for q such that q * nodePos = target.
    // Use the half-angle between nodePos (after current rotation) and target.
    const nodeWorld = quatRotate(rotation, [node.sx, node.sy, node.sz]);
    const dot = Math.max(-1, Math.min(1, nodeWorld[0]*target[0] + nodeWorld[1]*target[1] + nodeWorld[2]*target[2]));
    if (dot > ROTATION_ALIGNED_DOT) return; // already there

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
    // Text base = target so the text faces camera head-on when animation settles
    setTextBaseRotation(targetRotation);

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

    return () => {
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
    };
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

  // ── Adjacency map (rebuilt only when edges change) ──
  const adjacency = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const edge of graph.edges) {
      let src = map.get(edge.source);
      if (!src) { src = []; map.set(edge.source, src); }
      src.push(edge.target);
      let tgt = map.get(edge.target);
      if (!tgt) { tgt = []; map.set(edge.target, tgt); }
      tgt.push(edge.source);
    }
    return map;
  }, [graph.edges]);

  // ── BFS distance map from selected node ──
  // distance 0 = selected, 1 = direct neighbor, 2 = two hops, etc.
  // Always computed to full depth so toggling deepHighlight never re-runs the
  // BFS — deep-highlight filtering is derived downstream from the flag.
  const distanceMap = useMemo(() => {
    if (!localSelectedId) return new Map<string, number>();
    const dist = new Map<string, number>();
    dist.set(localSelectedId, 0);
    const queue: string[] = [localSelectedId];
    let head = 0;
    while (head < queue.length) {
      const cur = queue[head++];
      const curDist = dist.get(cur)!;
      const neighbors = adjacency.get(cur);
      if (!neighbors) continue;
      for (const neighbor of neighbors) {
        if (!dist.has(neighbor)) {
          dist.set(neighbor, curDist + 1);
          queue.push(neighbor);
        }
      }
    }
    return dist;
  }, [localSelectedId, adjacency]);

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

  // ── Projection geometry — hoisted once per render ──
  const cx = size.w / 2;
  const cy = size.h / 2;
  const sphereRadius = Math.min(size.w, size.h) * SPHERE_FILL_RATIO * zoom;

  // Previous frame's paint order: rotation changes are incremental, so feeding
  // the nearly-sorted list back into sort keeps it ~O(n) without changing
  // paint-order semantics (same comparator, full sort still runs).
  const paintOrderRef = useRef<{ source: SimNode[]; ordered: ProjectedNode[] } | null>(null);

  // ── Project all nodes ──
  const { projected, projectedMap } = useMemo(() => {
    const fov = FOV_BASE;

    const prev = paintOrderRef.current;
    const base: readonly SimNode[] =
      prev && prev.source === simNodes ? prev.ordered : simNodes;

    const list: ProjectedNode[] = base.map((n) => {
      const rotated = quatRotate(rotation, [n.sx, n.sy, n.sz]);
      const { screenX, screenY, depth } = project(rotated, cx, cy, sphereRadius, fov);
      return { ...n, screenX, screenY, depth, rx: rotated[0], ry: rotated[1], rz: rotated[2] };
    });

    // Sort back-to-front so front nodes paint over back nodes
    list.sort((a, b) => a.depth - b.depth);
    paintOrderRef.current = { source: simNodes, ordered: list };

    const map = new Map<string, ProjectedNode>(list.map((n) => [n.id, n]));
    return { projected: list, projectedMap: map };
  }, [simNodes, rotation, sphereRadius, cx, cy]);

  // Latest rotation/zoom values, readable from stable callbacks without
  // recreating handlers on every animation frame.
  const rotationRef = useRef<Quat>(QUAT_IDENTITY);
  useEffect(() => { rotationRef.current = rotation; }, [rotation]);
  const zoomRef = useRef(1.0);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);

  // ── Mouse handlers ──
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as Element).closest("[data-node]")) return;
    isDragging.current = true;
    dragStart.current = { x: e.clientX, y: e.clientY };
    rotAtDrag.current = rotation;
    containerRef.current?.classList.add("graph-canvas-panning");
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

  const stopDrag = useCallback(() => {
    isDragging.current = false;
    containerRef.current?.classList.remove("graph-canvas-panning");
  }, []);

  // ── Wheel zoom — eased toward target over ~120ms ──
  const zoomAnimRef = useRef<number | null>(null);
  const zoomTargetRef = useRef(1.0);

  const animateZoomTo = useCallback((target: number) => {
    const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, target));
    zoomTargetRef.current = clamped;
    if (zoomAnimRef.current !== null) cancelAnimationFrame(zoomAnimRef.current);
    const from = zoomRef.current;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / ZOOM_ANIM_MS);
      setZoom(from + (clamped - from) * easeOutCubic(t));
      zoomAnimRef.current = t < 1 ? requestAnimationFrame(step) : null;
    };
    zoomAnimRef.current = requestAnimationFrame(step);
  }, []);

  // Cancel any in-flight zoom animation on unmount
  useEffect(() => () => {
    if (zoomAnimRef.current !== null) cancelAnimationFrame(zoomAnimRef.current);
  }, []);

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.12 : 1/1.12;
    animateZoomTo(zoomTargetRef.current * factor);
  }, [animateZoomTo]);

  // ── Touch handlers ──
  const lastTouches = useRef<React.Touch[]>([]);
  const touchRotStart = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const touchRotCapture = useRef<Quat>(QUAT_IDENTITY);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    lastTouches.current = Array.from(e.touches);
    if (e.touches.length === 1) {
      touchRotStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      touchRotCapture.current = rotationRef.current;
    }
  }, []);

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
      // Pinch is direct manipulation — apply immediately, keep eased target in sync
      if (zoomAnimRef.current !== null) { cancelAnimationFrame(zoomAnimRef.current); zoomAnimRef.current = null; }
      setZoom((z) => {
        const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z * factor));
        zoomTargetRef.current = next;
        return next;
      });
    }
    lastTouches.current = touches;
  }, []);

  return (
    <div
      ref={containerRef}
      className="graph-canvas"
      style={{
        width: "100%", height: "100%",
        position: "relative", overflow: "hidden",
        userSelect: "none",
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
          {/* Edge bloom underlay — userSpaceOnUse avoids degenerate bboxes on near-straight paths */}
          <filter
            id="edge-glow"
            filterUnits="userSpaceOnUse"
            x={-100} y={-100}
            width={size.w + 200} height={size.h + 200}
          >
            <feGaussianBlur stdDeviation="3" />
          </filter>
        </defs>

        {/* Sphere outline hint */}
        <ellipse
          cx={cx}
          cy={cy}
          rx={sphereRadius}
          ry={sphereRadius}
          fill="none"
          stroke="var(--border-subtle)"
          strokeWidth={1.25}
          opacity={0.7}
        />


        {/* Sphere content — fades in when first database is selected */}
        <g style={{ opacity: sphereOpacity, transition: "opacity 4s ease" }}>

        {/* Center text — rendered first so all edges and nodes paint over it */}
        {displayedCenterText && localSelectedId && (() => {
          const sphereR = sphereRadius;
          const maxW = sphereR * 1.1;
          const perspective = FOV_BASE * sphereR;
          return (
            <foreignObject
              x={size.w / 2 - maxW / 2}
              y={size.h / 2 - sphereR * 0.55}
              width={maxW}
              height={sphereR * 1.1}
              style={{ pointerEvents: "none", overflow: "visible" }}
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
                  overflow: "visible",
                  perspective: `${perspective}px`,
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
                  opacity: centerTextAnimOpacity,
                  transition: centerTextAnimOpacity === 0 ? "opacity 0.5s ease" : "opacity 3s ease",
                  textShadow: "0 1px 12px var(--bg-base), 0 0 24px var(--bg-base)",
                  padding: "0 8px",
                  display: "-webkit-box",
                  WebkitLineClamp: 6,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                  transform: quatToMatrix3d(quatNorm(quatMul(rotation, quatInverse(textBaseRotation)))),
                  transformStyle: "preserve-3d",
                  backfaceVisibility: "visible",
                  maxWidth: maxW,
                }}>{displayedCenterText}</p>
              </div>
            </foreignObject>
          );
        })()}

        {/* Edges */}
        {graph.edges.map((edge) => {
          const src = projectedMap.get(edge.source);
          const tgt = projectedMap.get(edge.target);
          if (!src || !tgt) return null;
          const avgDepth = (src.depth + tgt.depth) / 2;

          const mid3 = slerp([src.rx, src.ry, src.rz], [tgt.rx, tgt.ry, tgt.rz], 0.5);
          const mid2 = project(mid3, cx, cy, sphereRadius, FOV_BASE);

          const isRelated = localSelectedId !== null && (edge.source === localSelectedId || edge.target === localSelectedId);
          const srcDist = distanceMap.get(edge.source) ?? Infinity;
          const tgtDist = distanceMap.get(edge.target) ?? Infinity;
          const edgeDist = Math.min(srcDist, tgtDist);
          const isDeepRelated = deepHighlight && localSelectedId !== null && edgeDist < Infinity;
          const isDimmed  = localSelectedId !== null && !isRelated && !isDeepRelated;
          const isHiddenEdge = deepHighlight && localSelectedId !== null && !isRelated && !isDeepRelated;
          const edgeDepthDecay = isDeepRelated && !isRelated ? Math.max(0.3, Math.pow(0.80, edgeDist)) : 1;
          const deepEdgeColor = deepHighlight && isDeepRelated && !isRelated ? (srcDist >= tgtDist ? src.color : tgt.color) : null;

          const d = `M ${src.screenX},${src.screenY} Q ${mid2.screenX},${mid2.screenY} ${tgt.screenX},${tgt.screenY}`;
          const sharpStroke = isRelated ? "var(--accent-warm)" : deepEdgeColor ?? "var(--edge-color)";
          const sharpWidth = isRelated ? lerp(0.6, 1.8, avgDepth) : lerp(0.3, 1.0, avgDepth);
          const sharpOpacity = isHiddenEdge ? 0 : isDimmed ? 0.05 : lerp(0.04, isRelated ? 0.85 : 0.55, avgDepth) * edgeDepthDecay;

          // Active connections bloom: blurred underlay + sharp stroke.
          // Non-highlighted edges stay single-pass (no blur) for perf; the
          // stable <g> wrapper keeps the sharp path's identity so its
          // stroke/opacity transitions survive highlight changes.
          return (
            <g key={edge.id}>
              {isRelated && (
                <path
                  d={d}
                  fill="none"
                  stroke="var(--accent-warm-glow, rgba(217,119,87,0.35))"
                  strokeWidth={lerp(1.6, 4, avgDepth)}
                  opacity={lerp(0.25, 0.9, avgDepth)}
                  filter="url(#edge-glow)"
                  style={{ pointerEvents: "none" }}
                />
              )}
              <path
                d={d}
                fill="none"
                stroke={sharpStroke}
                strokeWidth={sharpWidth}
                opacity={sharpOpacity}
                style={{ transition: "opacity 0.25s, stroke 0.25s" }}
              />
            </g>
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
          const depthDecay = deepHighlight && localSelectedId !== null && !isSelected && nodeDist < Infinity
            ? Math.max(0.35, Math.pow(0.80, nodeDist - 1)) : 1;
          const opacity = isHidden ? 0 : isDimmed ? opacityBase * 0.2 : opacityBase * depthDecay;
          const showLabel = isHovered || isSelected;
          // Depth atmosphere: back nodes cool/desaturate, front nodes full warmth
          const nodeColor = depthTintColor(node.color, node.depth);
          return (
            <g key={node.id} data-node="true" style={{ cursor: "pointer" }}
              onClick={() => setLocalSelectedId(isSelected ? null : node.id)}
              onMouseEnter={() => setHoveredId(node.id)}
              onMouseLeave={() => setHoveredId(null)}
            >
              {isSelected && <circle cx={node.screenX} cy={node.screenY} r={r + 7} fill="none" stroke={nodeColor} strokeWidth={1} opacity={0.28} />}
              {isHovered && !isSelected && <circle cx={node.screenX} cy={node.screenY} r={r + 4} fill={nodeColor} opacity={0.12} />}
              <circle cx={node.screenX} cy={node.screenY} r={r} fill={nodeColor}
                stroke={isSelected ? "var(--bg-base)" : isHovered ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.4)"}
                strokeWidth={isSelected ? 2.5 : 1.5} opacity={opacity}
                filter={isSelected ? "url(#node-glow)" : isHovered ? "url(#node-glow-soft)" : undefined}
                style={{ transition: "opacity 0.2s" }}
              />
              {showLabel && (
                <text x={node.screenX + r + 5} y={node.screenY + 4} fontSize={12}
                  fontFamily="'Geist', sans-serif" fontWeight={isSelected ? "500" : "400"}
                  fill={isSelected ? "var(--text-primary)" : "var(--text-secondary)"}
                  stroke="var(--bg-base)" strokeWidth={3} strokeLinejoin="round" paintOrder="stroke"
                  style={{ pointerEvents: "none" }}
                >{node.name}</text>
              )}
            </g>
          );
        })}

        </g>{/* end sphere content */}
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
            onClick={() => animateZoomTo(zoomTargetRef.current * delta)}
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
          onClick={() => {
            setRotation(QUAT_IDENTITY);
            if (zoomAnimRef.current !== null) { cancelAnimationFrame(zoomAnimRef.current); zoomAnimRef.current = null; }
            zoomTargetRef.current = 1;
            setZoom(1);
          }}
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
