"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as THREE from "three";

import type { GraphData, GraphEdge, GraphNode, NodeDetail } from "@/lib/types";
import { computeShapeLayout, type ShapeLayout, type Vec3 } from "@/lib/graph/shapeLayouts";

export type { ShapeLayout } from "@/lib/graph/shapeLayouts";

// ─── Types ────────────────────────────────────────────────────────────────────

type Quat = [number, number, number, number]; // [x, y, z, w]

type Props = {
  graph: GraphData;
  onSelectNode: (detail: NodeDetail | null) => void;
  selectedNodeId: string | null;
  shape?: ShapeLayout;
  deepHighlight?: boolean;
  panelOpen?: boolean;
  sphereCenterText?: string | null;
  centerTextOpacity?: number;
  autoRotate?: boolean;
};

/** Imperative API the React layer uses to drive the WebGL engine. */
type Engine = {
  setData: (nodes: GraphNode[], edges: GraphEdge[], shape: ShapeLayout) => void;
  setSelection: (id: string | null, deep: boolean) => void;
  focusNode: (id: string) => void;
  setAutoRotate: (on: boolean) => void;
  zoomBy: (factor: number) => void;
  resetView: () => void;
  setCenterText: (visible: boolean) => void;
  nodeCount: () => number;
  dispose: () => void;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 5.0;
const NODE_RADIUS = 7;
const SPHERE_FILL_RATIO = 0.40;
const FOV_BASE = 2.5;              // camera distance from sphere center (unit radius)
const DRAG_SENSITIVITY = 0.006;
const FOCUS_DURATION = 900;        // ms — rotate selected node to front
const INTRO_DURATION = 3500;       // ms — settle rotation on first reveal
const MORPH_FIRST_MS = 2600;       // ms — big-bang reveal
const MORPH_MS = 1600;             // ms — re-layout / shape change
const EDGE_SEGMENTS = 8;           // polyline segments per background edge
const RIBBON_SEGMENTS = 18;        // segments per highlighted edge ribbon
const AUTO_ROTATE_SPEED = 0.05;    // rad/s
const AUTO_ROTATE_IDLE_MS = 2500;
const MAX_NEIGHBOR_LABELS = 10;
const HUB_LABELS = 5;
const STAR_COUNT = 1400;

// ─── 3D Math ──────────────────────────────────────────────────────────────────
// Rotation lives in the view's screen-aligned space (x right, y down, z toward
// the viewer). Three.js is y-up, so positions are mirrored on y when uploaded
// and the quaternion is conjugated by that mirror: (x, y, z, w) → (-x, y, -z, w).

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
  return `matrix3d(${r00},${r10},${r20},0, ${r01},${r11},${r21},0, ${r02},${r12},${r22},0, 0,0,0,1)`;
}

function quatSlerp(a: Quat, b: Quat, t: number): Quat {
  let dot = a[0]*b[0] + a[1]*b[1] + a[2]*b[2] + a[3]*b[3];
  const b2: Quat = dot < 0 ? [-b[0], -b[1], -b[2], -b[3]] : [...b];
  dot = Math.abs(dot);
  if (dot > 0.9995) {
    return quatNorm([a[0]+(b2[0]-a[0])*t, a[1]+(b2[1]-a[1])*t, a[2]+(b2[2]-a[2])*t, a[3]+(b2[3]-a[3])*t]);
  }
  const omega = Math.acos(Math.min(1, dot));
  const sinOmega = Math.sin(omega);
  const sa = Math.sin((1-t)*omega) / sinOmega;
  const sb = Math.sin(t*omega) / sinOmega;
  return [sa*a[0]+sb*b2[0], sa*a[1]+sb*b2[1], sa*a[2]+sb*b2[2], sa*a[3]+sb*b2[3]];
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

function easeInOutCubic(t: number) {
  return t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t + 2, 3) / 2;
}

/** Deterministic float in [0, 1) from a string. */
function hashFloat(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 0x100000000;
}

/** Small seeded PRNG (mulberry32) — for decorative randomness. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Per-node morph progress — mirrors the vertex shader so CPU picking matches the GPU. */
function morphT(morph: number, seed: number) {
  return easeInOutCubic(Math.max(0, Math.min(1, morph * 1.5 - seed * 0.5)));
}

/** Quadratic bezier between two points, control point pushed out to the surface. */
function edgeControl(a: Vec3, b: Vec3): Vec3 {
  const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, mz = (a[2] + b[2]) / 2;
  const ml = Math.hypot(mx, my, mz);
  const target = (Math.hypot(...a) + Math.hypot(...b)) / 2;
  if (ml < 1e-6) {
    // Antipodal — pick any perpendicular direction
    const p: Vec3 = Math.abs(a[0]) < 0.9 ? [0, -a[2], a[1]] : [-a[2], 0, a[0]];
    const pl = Math.hypot(...p) || 1;
    return [p[0]/pl*target, p[1]/pl*target, p[2]/pl*target];
  }
  return [mx/ml*target, my/ml*target, mz/ml*target];
}

function bezier(a: Vec3, m: Vec3, b: Vec3, t: number, out: Vec3): Vec3 {
  const u = 1 - t;
  out[0] = u*u*a[0] + 2*u*t*m[0] + t*t*b[0];
  out[1] = u*u*a[1] + 2*u*t*m[1] + t*t*b[1];
  out[2] = u*u*a[2] + 2*u*t*m[2] + t*t*b[2];
  return out;
}

function readCssVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function isDarkTheme() {
  return typeof document !== "undefined" && document.documentElement.getAttribute("data-theme") === "dark";
}

// ─── Shaders ──────────────────────────────────────────────────────────────────

const MORPH_GLSL = /* glsl */`
  uniform float uMorph;
  float easeInOutCubic(float t) { return t < 0.5 ? 4.0*t*t*t : 1.0 - pow(-2.0*t + 2.0, 3.0) / 2.0; }
  vec3 morphPos(vec3 from, vec3 to, float seed) {
    float t = easeInOutCubic(clamp(uMorph * 1.5 - seed * 0.5, 0.0, 1.0));
    return mix(from, to, t);
  }
`;

const NODE_VERT = /* glsl */`
  ${MORPH_GLSL}
  uniform float uPixelRatio;
  uniform float uSizeScale;
  uniform float uCamDist;
  attribute vec3 aFrom;
  attribute vec3 aColor;
  attribute float aSize;
  attribute float aAlpha;
  attribute float aEmph;
  attribute float aSeed;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vEmph;
  varying float vR;
  varying float vExtent;
  void main() {
    vec3 p = morphPos(aFrom, position, aSeed);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float depth = clamp((mv.z + uCamDist + 1.0) * 0.5, 0.0, 1.0);
    float selected = smoothstep(0.6, 1.0, aEmph);
    float r = aSize * mix(0.38, 1.0, depth) * uSizeScale * (1.0 + 0.43 * selected);
    float extent = r * (1.6 + 1.2 * aEmph) + 2.0 + 26.0 * selected;
    vR = r;
    vExtent = extent;
    gl_PointSize = 2.0 * extent * uPixelRatio;
    gl_Position = projectionMatrix * mv;
    vColor = aColor;
    vAlpha = aAlpha * mix(0.18, 1.0, depth);
    vEmph = aEmph;
  }
`;

const NODE_FRAG = /* glsl */`
  uniform float uDark;
  uniform float uTime;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vEmph;
  varying float vR;
  varying float vExtent;
  void main() {
    vec2 uv = gl_PointCoord * 2.0 - 1.0;
    float d = length(uv) * vExtent;            // pixels from center
    if (d > vExtent) discard;

    // Antialiased core disc with soft orb shading (light from upper-left)
    float core = 1.0 - smoothstep(vR - 0.9, vR + 0.6, d);
    vec2 hl = (uv * vExtent) / max(vR, 0.001) + vec2(0.38, 0.38);
    float shade = 1.0 - clamp(length(hl), 0.0, 1.6) / 1.6;
    vec3 col = vColor * (0.78 + 0.42 * shade);
    col += vec3(0.22) * pow(shade, 6.0);

    // Rim stroke — brighter on hover / selection
    float rim = smoothstep(vR - 2.2, vR - 0.6, d) * core;
    col = mix(col, vec3(1.0), rim * (0.30 + 0.55 * vEmph));

    // Halo
    float falloff = vR * (0.55 + 0.9 * vEmph) + 1.5;
    float g = exp(-pow(max(d - vR, 0.0) / falloff, 2.0)) * (1.0 - core);
    float glowA = g * mix(mix(0.10, 0.30, uDark), 0.85, vEmph);

    // Selection rings: a fixed orbit ring + an expanding sonar pulse
    float selected = smoothstep(0.9, 1.0, vEmph);
    float ringR = vR + 7.0;
    float ring = (1.0 - smoothstep(0.0, 1.2, abs(d - ringR))) * 0.45 * selected;
    float pulsePhase = fract(uTime * 0.55);
    float pulseR = vR + 4.0 + pulsePhase * 22.0;
    float pulse = (1.0 - smoothstep(0.0, 1.6, abs(d - pulseR))) * (1.0 - pulsePhase) * 0.6 * selected;

    float a = (core + glowA + ring + pulse) * vAlpha;
    if (a < 0.004) discard;
    vec3 outCol = mix(vColor, col, core);
    outCol = mix(outCol, mix(vColor, vec3(1.0), 0.35), (ring + pulse) * (1.0 - core));
    gl_FragColor = vec4(outCol, min(a, 1.0));
    #include <colorspace_fragment>
  }
`;

const EDGE_VERT = /* glsl */`
  ${MORPH_GLSL}
  uniform float uCamDist;
  attribute vec3 aFrom;
  attribute vec3 aColor;
  attribute float aAlpha;
  attribute float aSeed;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec3 p = morphPos(aFrom, position, aSeed);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float depth = clamp((mv.z + uCamDist + 1.0) * 0.5, 0.0, 1.0);
    gl_Position = projectionMatrix * mv;
    vColor = aColor;
    vAlpha = aAlpha * mix(0.07, 1.0, depth * depth);
  }
`;

const EDGE_FRAG = /* glsl */`
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    if (vAlpha < 0.002) discard;
    gl_FragColor = vec4(vColor, vAlpha);
    #include <colorspace_fragment>
  }
`;

// Screen-space ribbons for the selected node's edges: constant pixel width,
// gradient from the selection outward, and pulses travelling along each link.
const RIBBON_VERT = /* glsl */`
  uniform vec2 uResolution;
  uniform float uWidth;
  uniform float uCamDist;
  attribute vec3 aA;
  attribute vec3 aB;
  attribute float aSide;
  attribute float aEnd;
  attribute float aT;
  attribute vec3 aColor;
  varying float vSide;
  varying float vT;
  varying vec3 vColor;
  varying float vDepth;
  void main() {
    vec4 mvA = modelViewMatrix * vec4(aA, 1.0);
    vec4 mvB = modelViewMatrix * vec4(aB, 1.0);
    vec4 cA = projectionMatrix * mvA;
    vec4 cB = projectionMatrix * mvB;
    vec2 sA = cA.xy / cA.w * uResolution * 0.5;
    vec2 sB = cB.xy / cB.w * uResolution * 0.5;
    vec2 dir = sB - sA;
    dir = length(dir) < 1e-4 ? vec2(1.0, 0.0) : normalize(dir);
    vec2 n = vec2(-dir.y, dir.x);
    vec4 c = aEnd < 0.5 ? cA : cB;
    vec4 mv = aEnd < 0.5 ? mvA : mvB;
    float depth = clamp((mv.z + uCamDist + 1.0) * 0.5, 0.0, 1.0);
    float w = uWidth * mix(0.45, 1.0, depth);
    c.xy += n * aSide * w / uResolution * c.w;
    gl_Position = c;
    vSide = aSide;
    vT = aT;
    vColor = aColor;
    vDepth = depth;
  }
`;

const RIBBON_FRAG = /* glsl */`
  uniform float uTime;
  uniform float uAlpha;
  uniform float uDark;
  varying float vSide;
  varying float vT;
  varying vec3 vColor;
  varying float vDepth;
  void main() {
    float edge = 1.0 - smoothstep(0.45, 1.0, abs(vSide));
    float pulse = exp(-pow((fract(vT * 1.4 - uTime * 0.45) - 0.5) * 7.0, 2.0));
    // Pulses brighten on dark backgrounds, deepen on light ones
    vec3 col = mix(vColor, uDark > 0.5 ? vec3(1.0) : vColor * 0.55, pulse * 0.55);
    float a = edge * mix(0.06, mix(1.0, 0.9, uDark), vDepth) * (mix(0.75, 0.55, uDark) + 0.45 * pulse) * uAlpha;
    if (a < 0.003) discard;
    gl_FragColor = vec4(col, a);
    #include <colorspace_fragment>
  }
`;

const STAR_VERT = /* glsl */`
  uniform float uPixelRatio;
  attribute float aSize;
  attribute float aTwinkle;
  uniform float uTime;
  varying float vA;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aSize * uPixelRatio;
    vA = 0.55 + 0.45 * sin(uTime * (0.6 + aTwinkle) + aTwinkle * 40.0);
  }
`;

const STAR_FRAG = /* glsl */`
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vA;
  void main() {
    float d = length(gl_PointCoord * 2.0 - 1.0);
    float a = (1.0 - smoothstep(0.2, 1.0, d)) * vA * uOpacity;
    if (a < 0.003) discard;
    gl_FragColor = vec4(uColor, a);
    #include <colorspace_fragment>
  }
`;

// ─── Engine ───────────────────────────────────────────────────────────────────

type EngineCallbacks = {
  onNodeClick: (id: string | null) => void;
  onDeselect: () => void;
  labelLayer: HTMLDivElement;
  glowLayer: HTMLDivElement;
  outlineLayer: HTMLDivElement;
  centerWrap: HTMLDivElement;
  centerText: HTMLParagraphElement;
};

function createEngine(container: HTMLDivElement, host: HTMLDivElement, cb: EngineCallbacks): Engine {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  host.appendChild(renderer.domElement);
  renderer.domElement.style.display = "block";

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 100);
  camera.position.set(0, 0, FOV_BASE);
  camera.lookAt(0, 0, 0);

  const root = new THREE.Group();     // rotated graph
  const starRoot = new THREE.Group(); // parallax backdrop
  scene.add(starRoot);
  scene.add(root);

  // ── Theme ──
  let dark = isDarkTheme();
  const accent = new THREE.Color(readCssVar("--accent-warm", "#d97757"));

  // ── Shared uniforms ──
  const uMorph = { value: 1 };
  const uTime = { value: 0 };
  const uCamDist = { value: FOV_BASE };
  const uPixelRatio = { value: renderer.getPixelRatio() };
  const uResolution = { value: new THREE.Vector2(1, 1) };

  // ── Stars ──
  const starGeo = new THREE.BufferGeometry();
  {
    const pos = new Float32Array(STAR_COUNT * 3);
    const size = new Float32Array(STAR_COUNT);
    const tw = new Float32Array(STAR_COUNT);
    const rand = mulberry32(7);
    for (let i = 0; i < STAR_COUNT; i++) {
      // Uniform direction, radius 4–10, biased behind the sphere
      const u = rand() * 2 - 1;
      const th = rand() * Math.PI * 2;
      const r = 4 + rand() * 6;
      const s = Math.sqrt(1 - u * u);
      pos[i*3] = Math.cos(th) * s * r;
      pos[i*3+1] = u * r;
      pos[i*3+2] = Math.sin(th) * s * r - 2;
      size[i] = 0.8 + Math.pow(rand(), 3) * 2.6;
      tw[i] = rand();
    }
    starGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    starGeo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    starGeo.setAttribute("aTwinkle", new THREE.BufferAttribute(tw, 1));
  }
  const starMat = new THREE.ShaderMaterial({
    vertexShader: STAR_VERT,
    fragmentShader: STAR_FRAG,
    uniforms: {
      uPixelRatio, uTime,
      uColor: { value: new THREE.Color(0xffffff) },
      uOpacity: { value: 0.5 },
    },
    transparent: true, depthTest: false, depthWrite: false,
  });
  const stars = new THREE.Points(starGeo, starMat);
  stars.renderOrder = 0;
  stars.frustumCulled = false;
  starRoot.add(stars);

  // ── Nodes ──
  const nodeGeo = new THREE.BufferGeometry();
  const nodeMat = new THREE.ShaderMaterial({
    vertexShader: NODE_VERT,
    fragmentShader: NODE_FRAG,
    uniforms: {
      uMorph, uTime, uCamDist, uPixelRatio,
      uSizeScale: { value: 1 },
      uDark: { value: dark ? 1 : 0 },
    },
    transparent: true, depthTest: false, depthWrite: false,
  });
  const nodePoints = new THREE.Points(nodeGeo, nodeMat);
  nodePoints.renderOrder = 3;
  nodePoints.frustumCulled = false;
  root.add(nodePoints);

  // ── Edge web ──
  const edgeGeo = new THREE.BufferGeometry();
  const edgeMat = new THREE.ShaderMaterial({
    vertexShader: EDGE_VERT,
    fragmentShader: EDGE_FRAG,
    uniforms: { uMorph, uCamDist },
    transparent: true, depthTest: false, depthWrite: false,
  });
  const edgeLines = new THREE.LineSegments(edgeGeo, edgeMat);
  edgeLines.renderOrder = 1;
  edgeLines.frustumCulled = false;
  root.add(edgeLines);

  // ── Highlight ribbons ──
  let ribbonGeo = new THREE.BufferGeometry();
  const ribbonMat = new THREE.ShaderMaterial({
    vertexShader: RIBBON_VERT,
    fragmentShader: RIBBON_FRAG,
    uniforms: {
      uResolution, uCamDist, uTime,
      uWidth: { value: 2.2 * renderer.getPixelRatio() },
      uAlpha: { value: 0 },
      uDark: { value: dark ? 1 : 0 },
    },
    transparent: true, depthTest: false, depthWrite: false,
    side: THREE.DoubleSide, // quad winding flips with screen direction
  });
  const ribbons = new THREE.Mesh(ribbonGeo, ribbonMat);
  ribbons.renderOrder = 2;
  ribbons.frustumCulled = false;
  root.add(ribbons);

  // ── Graph state ──
  type ENode = {
    id: string; name: string; color: string; databaseId: string;
    degree: number; seed: number;
    pos: Vec3;   // target layout position (screen-aligned space)
    from: Vec3;  // morph origin
  };
  let nodes: ENode[] = [];
  let idToIdx = new Map<string, number>();
  let edgePairs: Array<[number, number]> = [];
  let adjacency: number[][] = [];
  let maxDegree = 1;
  let hubs: number[] = [];

  let nodeAlphaCur = new Float32Array(0), nodeAlphaTgt = new Float32Array(0);
  let nodeEmphCur = new Float32Array(0), nodeEmphTgt = new Float32Array(0);
  let edgeAlphaCur = new Float32Array(0), edgeAlphaTgt = new Float32Array(0);
  let sortIdx = new Uint32Array(0);
  let sortZ = new Float32Array(0);
  let screenX = new Float32Array(0), screenY = new Float32Array(0), screenR = new Float32Array(0), screenDepth = new Float32Array(0);

  let morphStart = 0;
  let morphDur = 1;
  let lastShape: ShapeLayout | null = null;
  let ribbonsDirty = false;

  // ── View state ──
  let rot: Quat = QUAT_IDENTITY;
  let textBase: Quat = QUAT_IDENTITY;
  let zoom = 1;
  let zoomTarget = 1;
  let spinAxis: Vec3 = [0, 1, 0];
  let spinRate = 0;            // rad/s inertia after drag release
  let autoRate = 0;            // current auto-rotate speed (eases in)
  let autoRotate = true;
  let lastInteract = performance.now();
  let rotAnim: { from: Quat; to: Quat; start: number; dur: number; ease: (t: number) => number } | null = null;
  let selectedIdx = -1;
  let deep = false;
  let hoveredIdx = -1;
  let centerTextVisible = false;
  let W = 1, H = 1;
  let rotDirty = true;

  // ── Helpers ──
  function sphereRadiusPx() {
    return Math.min(W, H) * SPHERE_FILL_RATIO * zoom;
  }

  function currentMorph(now: number) {
    return Math.min(1, (now - morphStart) / morphDur);
  }

  function currentPos(i: number, morph: number, out: Vec3): Vec3 {
    const n = nodes[i];
    const t = morphT(morph, n.seed);
    out[0] = n.from[0] + (n.pos[0] - n.from[0]) * t;
    out[1] = n.from[1] + (n.pos[1] - n.from[1]) * t;
    out[2] = n.from[2] + (n.pos[2] - n.from[2]) * t;
    return out;
  }

  function applyTheme() {
    dark = isDarkTheme();
    accent.set(readCssVar("--accent-warm", "#d97757"));
    nodeMat.uniforms.uDark.value = dark ? 1 : 0;
    ribbonMat.uniforms.uDark.value = dark ? 1 : 0;
    ribbonMat.uniforms.uWidth.value = (dark ? 2.2 : 2.6) * renderer.getPixelRatio();
    starMat.uniforms.uColor.value.set(dark ? 0xffffff : 0x8b7868);
    starMat.uniforms.uOpacity.value = dark ? 0.55 : 0.22;
    if (nodes.length > 0) {
      rebuildEdgeColors();
      ribbonsDirty = true;
      computeHighlight();
    }
  }

  // Edge base colour: blend of both endpoint colours pulled toward a neutral
  const tmpA = new THREE.Color(), tmpB = new THREE.Color(), neutral = new THREE.Color();
  function rebuildEdgeColors() {
    const colorAttr = edgeGeo.getAttribute("aColor") as THREE.BufferAttribute | undefined;
    if (!colorAttr) return;
    neutral.set(dark ? "#ffffff" : "#5a5044");
    const arr = colorAttr.array as Float32Array;
    let v = 0;
    for (const [a, b] of edgePairs) {
      tmpA.set(nodes[a].color).lerp(neutral, dark ? 0.35 : 0.45);
      tmpB.set(nodes[b].color).lerp(neutral, dark ? 0.35 : 0.45);
      for (let s = 0; s < EDGE_SEGMENTS; s++) {
        for (let e = 0; e < 2; e++) {
          const t = (s + e) / EDGE_SEGMENTS;
          arr[v*3]   = tmpA.r + (tmpB.r - tmpA.r) * t;
          arr[v*3+1] = tmpA.g + (tmpB.g - tmpA.g) * t;
          arr[v*3+2] = tmpA.b + (tmpB.b - tmpA.b) * t;
          v++;
        }
      }
    }
    colorAttr.needsUpdate = true;
  }

  // ── Data ──
  function setData(graphNodes: GraphNode[], graphEdges: GraphEdge[], shape: ShapeLayout) {
    const now = performance.now();
    const morphNow = currentMorph(now);
    const wasEmpty = nodes.length === 0;

    // Where every currently visible node is right now — the morph origin
    const prevPos = new Map<string, Vec3>();
    for (let i = 0; i < nodes.length; i++) prevPos.set(nodes[i].id, currentPos(i, morphNow, [0, 0, 0]));

    const layout = computeShapeLayout(shape, graphNodes);
    const degree = new Map<string, number>();
    for (const e of graphEdges) {
      degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
      degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
    }

    const prevSelectedId = selectedIdx >= 0 ? nodes[selectedIdx]?.id : null;
    const prevAlpha = new Map<string, number>();
    for (let i = 0; i < nodes.length; i++) prevAlpha.set(nodes[i].id, nodeAlphaCur[i]);

    nodes = graphNodes.map((n) => {
      const pos = layout.get(n.id) ?? [0, 0, 0];
      const seed = hashFloat(n.id);
      const prev = prevPos.get(n.id);
      // First reveal bursts from the core; later additions drift in from outside
      const from: Vec3 = prev ?? (wasEmpty ? [pos[0] * 0.02, pos[1] * 0.02, pos[2] * 0.02] : [pos[0] * 1.45, pos[1] * 1.45, pos[2] * 1.45]);
      return {
        id: n.id, name: n.name, color: n.color, databaseId: n.databaseId,
        degree: degree.get(n.id) ?? 0, seed, pos, from,
      };
    });
    idToIdx = new Map(nodes.map((n, i) => [n.id, i]));
    maxDegree = Math.max(1, ...nodes.map((n) => n.degree));
    hubs = nodes.map((_, i) => i).sort((a, b) => nodes[b].degree - nodes[a].degree).slice(0, HUB_LABELS);

    edgePairs = [];
    adjacency = nodes.map(() => []);
    for (const e of graphEdges) {
      const a = idToIdx.get(e.source), b = idToIdx.get(e.target);
      if (a === undefined || b === undefined || a === b) continue;
      edgePairs.push([a, b]);
      adjacency[a].push(b);
      adjacency[b].push(a);
    }

    const N = nodes.length;
    const anyMoved = nodes.some((n) => n.from[0] !== n.pos[0] || n.from[1] !== n.pos[1] || n.from[2] !== n.pos[2]);
    morphStart = now;
    morphDur = !anyMoved ? 1 : wasEmpty ? MORPH_FIRST_MS : MORPH_MS;
    uMorph.value = anyMoved ? 0 : 1;

    // Node buffers
    const pos = new Float32Array(N * 3), from = new Float32Array(N * 3), col = new Float32Array(N * 3);
    const size = new Float32Array(N), seed = new Float32Array(N);
    nodeAlphaCur = new Float32Array(N); nodeAlphaTgt = new Float32Array(N);
    nodeEmphCur = new Float32Array(N); nodeEmphTgt = new Float32Array(N);
    const c = new THREE.Color();
    for (let i = 0; i < N; i++) {
      const n = nodes[i];
      // Mirror y: screen-aligned (y down) → Three.js (y up)
      pos[i*3] = n.pos[0]; pos[i*3+1] = -n.pos[1]; pos[i*3+2] = n.pos[2];
      from[i*3] = n.from[0]; from[i*3+1] = -n.from[1]; from[i*3+2] = n.from[2];
      c.set(n.color);
      col[i*3] = c.r; col[i*3+1] = c.g; col[i*3+2] = c.b;
      size[i] = NODE_RADIUS * lerp(0.6, 2.2, n.degree / maxDegree);
      seed[i] = n.seed;
      const pa = prevAlpha.get(n.id);
      nodeAlphaCur[i] = pa ?? 1;
      nodeAlphaTgt[i] = 1;
    }
    nodeGeo.dispose();
    nodeGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    nodeGeo.setAttribute("aFrom", new THREE.BufferAttribute(from, 3));
    nodeGeo.setAttribute("aColor", new THREE.BufferAttribute(col, 3));
    nodeGeo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    nodeGeo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
    nodeGeo.setAttribute("aAlpha", new THREE.BufferAttribute(nodeAlphaCur, 1).setUsage(THREE.DynamicDrawUsage));
    nodeGeo.setAttribute("aEmph", new THREE.BufferAttribute(nodeEmphCur, 1).setUsage(THREE.DynamicDrawUsage));
    sortIdx = new Uint32Array(N);
    for (let i = 0; i < N; i++) sortIdx[i] = i;
    sortZ = new Float32Array(N);
    nodeGeo.setIndex(new THREE.BufferAttribute(sortIdx, 1).setUsage(THREE.DynamicDrawUsage));
    screenX = new Float32Array(N); screenY = new Float32Array(N); screenR = new Float32Array(N); screenDepth = new Float32Array(N);

    // Edge buffers — every edge is a short polyline hugging the surface
    const E = edgePairs.length;
    const V = E * EDGE_SEGMENTS * 2;
    const ePos = new Float32Array(V * 3), eFrom = new Float32Array(V * 3), eSeed = new Float32Array(V);
    const eAlpha = new Float32Array(V);
    const pTo: Vec3 = [0, 0, 0], pFrom: Vec3 = [0, 0, 0];
    let v = 0;
    for (const [a, b] of edgePairs) {
      const A = nodes[a], B = nodes[b];
      const mTo = edgeControl(A.pos, B.pos), mFrom = edgeControl(A.from, B.from);
      for (let s = 0; s < EDGE_SEGMENTS; s++) {
        for (let e = 0; e < 2; e++) {
          const t = (s + e) / EDGE_SEGMENTS;
          bezier(A.pos, mTo, B.pos, t, pTo);
          bezier(A.from, mFrom, B.from, t, pFrom);
          ePos[v*3] = pTo[0]; ePos[v*3+1] = -pTo[1]; ePos[v*3+2] = pTo[2];
          eFrom[v*3] = pFrom[0]; eFrom[v*3+1] = -pFrom[1]; eFrom[v*3+2] = pFrom[2];
          eSeed[v] = A.seed + (B.seed - A.seed) * t;
          v++;
        }
      }
    }
    edgeAlphaCur = new Float32Array(E); edgeAlphaTgt = new Float32Array(E);
    edgeGeo.dispose();
    edgeGeo.setAttribute("position", new THREE.BufferAttribute(ePos, 3));
    edgeGeo.setAttribute("aFrom", new THREE.BufferAttribute(eFrom, 3));
    edgeGeo.setAttribute("aSeed", new THREE.BufferAttribute(eSeed, 1));
    edgeGeo.setAttribute("aColor", new THREE.BufferAttribute(new Float32Array(V * 3), 3));
    edgeGeo.setAttribute("aAlpha", new THREE.BufferAttribute(eAlpha, 1).setUsage(THREE.DynamicDrawUsage));
    rebuildEdgeColors();

    selectedIdx = prevSelectedId ? idToIdx.get(prevSelectedId) ?? -1 : -1;
    hoveredIdx = -1;
    computeHighlight();
    // Edges start from their resting alpha so the web doesn't flash
    edgeAlphaCur.set(edgeAlphaTgt);
    writeEdgeAlpha();
    ribbonsDirty = true;
    rotDirty = true;

    if (wasEmpty && N > 0) {
      // Intro rotation: start offset toward top-left, settle to identity
      const startRot = quatNorm(quatMul(
        quatFromAxisAngle([0, -1, 0], Math.PI / 12),
        quatFromAxisAngle([-1, 0, 0], Math.PI / 15),
      ));
      rot = startRot;
      textBase = QUAT_IDENTITY;
      rotAnim = { from: startRot, to: QUAT_IDENTITY, start: now, dur: INTRO_DURATION, ease: (t) => 1 - Math.pow(1 - t, 3) };
      lastInteract = now;
    } else if (lastShape !== null && shape !== lastShape && N > 0) {
      // New shape: ease back to the upright reference orientation
      spinRate = 0;
      rotAnim = { from: rot, to: QUAT_IDENTITY, start: now, dur: MORPH_MS, ease: easeInOutCubic };
      textBase = QUAT_IDENTITY;
      lastInteract = now;
    }
    if (N === 0) {
      rot = QUAT_IDENTITY;
      rotAnim = null;
      spinRate = 0;
    }
    lastShape = shape;
  }

  // ── Highlight (selection / deep mode) ──
  function computeHighlight() {
    const N = nodes.length;
    const E = edgePairs.length;
    // Fewer edges read better brighter; thousands need to recede into a haze
    const density = Math.sqrt(1500 / Math.max(1, E));
    const baseEdge = Math.max(0.07, Math.min(0.3, (dark ? 0.2 : 0.24) * density));
    if (selectedIdx < 0) {
      nodeAlphaTgt.fill(1);
      nodeEmphTgt.fill(0);
      edgeAlphaTgt.fill(baseEdge);
      return;
    }

    // BFS with adjacency lists — O(V + E)
    const dist = new Int32Array(N).fill(-1);
    dist[selectedIdx] = 0;
    const queue = new Int32Array(N);
    let head = 0, tail = 0;
    queue[tail++] = selectedIdx;
    while (head < tail) {
      const cur = queue[head++];
      const d = dist[cur];
      if (!deep && d >= 1) continue;
      for (const nb of adjacency[cur]) {
        if (dist[nb] < 0) { dist[nb] = d + 1; queue[tail++] = nb; }
      }
    }

    for (let i = 0; i < N; i++) {
      const d = dist[i];
      if (d === 0) { nodeAlphaTgt[i] = 1; nodeEmphTgt[i] = 1; }
      else if (d === 1) { nodeAlphaTgt[i] = 1; nodeEmphTgt[i] = 0.32; }
      else if (deep && d > 1) { nodeAlphaTgt[i] = Math.max(0.35, Math.pow(0.8, d - 1)); nodeEmphTgt[i] = 0; }
      else { nodeAlphaTgt[i] = deep ? 0 : 0.2; nodeEmphTgt[i] = 0; }
    }
    for (let e = 0; e < E; e++) {
      const [a, b] = edgePairs[e];
      const related = a === selectedIdx || b === selectedIdx;
      const da = dist[a] < 0 ? Infinity : dist[a];
      const db = dist[b] < 0 ? Infinity : dist[b];
      const ed = Math.min(da, db);
      if (related) edgeAlphaTgt[e] = 0.04;           // drawn as a ribbon instead
      else if (deep && ed < Infinity) edgeAlphaTgt[e] = 0.5 * Math.max(0.3, Math.pow(0.8, ed));
      else edgeAlphaTgt[e] = deep ? 0 : 0.035;
    }
  }

  function writeEdgeAlpha() {
    const attr = edgeGeo.getAttribute("aAlpha") as THREE.BufferAttribute | undefined;
    if (!attr) return;
    const arr = attr.array as Float32Array;
    const per = EDGE_SEGMENTS * 2;
    for (let e = 0; e < edgeAlphaCur.length; e++) arr.fill(edgeAlphaCur[e], e * per, e * per + per);
    attr.needsUpdate = true;
  }

  function rebuildRibbons() {
    ribbonsDirty = false;
    ribbonGeo.dispose();
    ribbonGeo = new THREE.BufferGeometry();
    ribbons.geometry = ribbonGeo;
    if (selectedIdx < 0) return;
    const neighbors = adjacency[selectedIdx];
    if (!neighbors || neighbors.length === 0) return;

    const S = RIBBON_SEGMENTS;
    const quads = neighbors.length * S;
    const aA = new Float32Array(quads * 4 * 3), aB = new Float32Array(quads * 4 * 3);
    const aSide = new Float32Array(quads * 4), aEnd = new Float32Array(quads * 4), aT = new Float32Array(quads * 4);
    const aColor = new Float32Array(quads * 4 * 3);
    const index = new Uint32Array(quads * 6);
    const A = nodes[selectedIdx].pos;
    const start = accent.clone();
    const end = new THREE.Color();
    const p0: Vec3 = [0, 0, 0], p1: Vec3 = [0, 0, 0];
    let q = 0;
    for (const nb of neighbors) {
      const B = nodes[nb].pos;
      const m = edgeControl(A, B);
      end.set(nodes[nb].color);
      for (let s = 0; s < S; s++) {
        const t0 = s / S, t1 = (s + 1) / S;
        bezier(A, m, B, t0, p0);
        bezier(A, m, B, t1, p1);
        for (let k = 0; k < 4; k++) {
          const vi = q * 4 + k;
          aA[vi*3] = p0[0]; aA[vi*3+1] = -p0[1]; aA[vi*3+2] = p0[2];
          aB[vi*3] = p1[0]; aB[vi*3+1] = -p1[1]; aB[vi*3+2] = p1[2];
          const isEnd = k >= 2 ? 1 : 0;
          aEnd[vi] = isEnd;
          aSide[vi] = k % 2 === 0 ? -1 : 1;
          const t = isEnd ? t1 : t0;
          aT[vi] = t;
          aColor[vi*3]   = start.r + (end.r - start.r) * t;
          aColor[vi*3+1] = start.g + (end.g - start.g) * t;
          aColor[vi*3+2] = start.b + (end.b - start.b) * t;
        }
        const b = q * 4;
        index.set([b, b + 1, b + 2, b + 1, b + 3, b + 2], q * 6);
        q++;
      }
    }
    ribbonGeo.setAttribute("position", new THREE.BufferAttribute(aA, 3)); // unused by shader, needed for draw range
    ribbonGeo.setAttribute("aA", new THREE.BufferAttribute(aA, 3));
    ribbonGeo.setAttribute("aB", new THREE.BufferAttribute(aB, 3));
    ribbonGeo.setAttribute("aSide", new THREE.BufferAttribute(aSide, 1));
    ribbonGeo.setAttribute("aEnd", new THREE.BufferAttribute(aEnd, 1));
    ribbonGeo.setAttribute("aT", new THREE.BufferAttribute(aT, 1));
    ribbonGeo.setAttribute("aColor", new THREE.BufferAttribute(aColor, 3));
    ribbonGeo.setIndex(new THREE.BufferAttribute(index, 1));
  }

  function setSelection(id: string | null, deepMode: boolean) {
    const idx = id ? idToIdx.get(id) ?? -1 : -1;
    if (idx === selectedIdx && deepMode === deep) return;
    if (idx !== selectedIdx) {
      ribbonMat.uniforms.uAlpha.value = 0;
      ribbonsDirty = true;
    }
    selectedIdx = idx;
    deep = deepMode;
    if (idx >= 0) { spinRate = 0; }
    computeHighlight();
  }

  // ── Focus: rotate node to front, raised to 1/3 from the top ──
  function focusNode(id: string) {
    const idx = idToIdx.get(id);
    if (idx === undefined) return;
    const node = nodes[idx];
    const sphereRadius = Math.min(W, H) * SPHERE_FILL_RATIO;
    const yOffset = -(H / 6) / sphereRadius;
    const targetY = Math.max(-0.85, Math.min(0.85, yOffset));
    const target: Vec3 = [0, targetY, Math.sqrt(Math.max(0, 1 - targetY * targetY))];

    const p = node.pos;
    const pl = Math.hypot(...p) || 1;
    const nodeWorld = quatRotate(rot, [p[0]/pl, p[1]/pl, p[2]/pl]);
    const dot = Math.max(-1, Math.min(1, nodeWorld[0]*target[0] + nodeWorld[1]*target[1] + nodeWorld[2]*target[2]));
    if (dot > 0.9999) { textBase = rot; return; }
    const cross: Vec3 = [
      nodeWorld[1]*target[2] - nodeWorld[2]*target[1],
      nodeWorld[2]*target[0] - nodeWorld[0]*target[2],
      nodeWorld[0]*target[1] - nodeWorld[1]*target[0],
    ];
    const crossLen = Math.hypot(...cross) || 1;
    const axis: Vec3 = [cross[0]/crossLen, cross[1]/crossLen, cross[2]/crossLen];
    const targetRotation = quatNorm(quatMul(quatFromAxisAngle(axis, Math.acos(dot)), rot));
    spinRate = 0;
    rotAnim = { from: rot, to: targetRotation, start: performance.now(), dur: FOCUS_DURATION, ease: easeInOutCubic };
    // Text base = target so the center text faces the camera head-on when settled
    textBase = targetRotation;
  }

  // ── Picking ──
  const tmpV: Vec3 = [0, 0, 0];
  function projectAll(now: number) {
    const morph = currentMorph(now);
    const cx = W / 2, cy = H / 2;
    const R = sphereRadiusPx();
    const sizeScale = nodeMat.uniforms.uSizeScale.value as number;
    for (let i = 0; i < nodes.length; i++) {
      const r = quatRotate(rot, currentPos(i, morph, tmpV));
      const scale = FOV_BASE / (FOV_BASE - r[2]);
      screenX[i] = cx + r[0] * R * scale;
      screenY[i] = cy + r[1] * R * scale;
      const depth = Math.max(0, Math.min(1, (r[2] + 1) / 2));
      screenDepth[i] = depth;
      const sel = Math.max(0, Math.min(1, (nodeEmphCur[i] - 0.6) / 0.4));
      screenR[i] = NODE_RADIUS * lerp(0.6, 2.2, nodes[i].degree / maxDegree) * lerp(0.38, 1, depth) * sizeScale * (1 + 0.43 * sel);
    }
  }

  function pick(x: number, y: number): number {
    let best = -1, bestDepth = -Infinity;
    for (let i = 0; i < nodes.length; i++) {
      if (nodeAlphaTgt[i] < 0.05) continue;
      const dx = screenX[i] - x, dy = screenY[i] - y;
      const rr = screenR[i] + 3;
      if (dx*dx + dy*dy <= rr*rr && screenDepth[i] > bestDepth) { best = i; bestDepth = screenDepth[i]; }
    }
    return best;
  }

  // ── Pointer input ──
  const pointers = new Map<number, { x: number; y: number }>();
  let dragMoved = false;
  let downAt = { x: 0, y: 0 };
  let lastMoveT = 0;
  let pinchDist = 0;
  let hoverPending: { x: number; y: number } | null = null;

  function localXY(e: PointerEvent | WheelEvent) {
    const rect = container.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    if ((e.target as Element).closest("button")) return;
    const p = localXY(e);
    pointers.set(e.pointerId, p);
    try { container.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    if (pointers.size === 1) {
      downAt = p;
      dragMoved = false;
      spinRate = 0;
      rotAnim = null;
      lastMoveT = performance.now();
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
    }
    lastInteract = performance.now();
  }

  function onPointerMove(e: PointerEvent) {
    const p = localXY(e);
    const prev = pointers.get(e.pointerId);
    if (!prev) { hoverPending = p; return; }
    lastInteract = performance.now();
    if (pointers.size === 2) {
      pointers.set(e.pointerId, p);
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchDist > 0) zoomTarget = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoomTarget * (d / pinchDist)));
      pinchDist = d;
      dragMoved = true;
      return;
    }
    const dx = p.x - prev.x, dy = p.y - prev.y;
    pointers.set(e.pointerId, p);
    if (!dragMoved && Math.hypot(p.x - downAt.x, p.y - downAt.y) > 4) {
      dragMoved = true;
      container.style.cursor = "grabbing";
    }
    if (!dragMoved) return;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.01) return;
    const axis: Vec3 = [dy/dist, dx/dist, 0];
    const angle = dist * DRAG_SENSITIVITY;
    rot = quatNorm(quatMul(quatFromAxisAngle(axis, angle), rot));
    rotDirty = true;
    const now = performance.now();
    const dt = Math.max(1, now - lastMoveT) / 1000;
    lastMoveT = now;
    const rate = angle / dt;
    spinAxis = axis;
    spinRate = spinRate * 0.4 + rate * 0.6;
    hoveredIdx = -1;
  }

  function onPointerUp(e: PointerEvent) {
    const had = pointers.delete(e.pointerId);
    if (!had) return;
    try { container.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    container.style.cursor = hoveredIdx >= 0 ? "pointer" : "grab";
    if (pointers.size > 0) return;
    // Inertia only if the pointer was still moving at release
    if (performance.now() - lastMoveT > 80) spinRate = 0;
    spinRate = Math.min(spinRate, 6);
    if (!dragMoved) {
      projectAll(performance.now());
      const p = localXY(e);
      const hit = pick(p.x, p.y);
      if (hit >= 0) cb.onNodeClick(hit === selectedIdx ? null : nodes[hit].id);
    }
  }

  function onPointerLeave() {
    if (pointers.size === 0) { hoveredIdx = -1; hoverPending = null; }
  }

  function onWheel(e: WheelEvent) {
    e.preventDefault();
    const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018));
    zoomTarget = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoomTarget * factor));
    lastInteract = performance.now();
  }

  function onKeyDown(e: KeyboardEvent) {
    const target = e.target as HTMLElement;
    if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
    if (e.key === "Escape" && selectedIdx >= 0) cb.onDeselect();
  }

  container.addEventListener("pointerdown", onPointerDown);
  container.addEventListener("pointermove", onPointerMove);
  container.addEventListener("pointerup", onPointerUp);
  container.addEventListener("pointercancel", onPointerUp);
  container.addEventListener("pointerleave", onPointerLeave);
  container.addEventListener("wheel", onWheel, { passive: false });
  window.addEventListener("keydown", onKeyDown);

  // ── Resize ──
  function resize() {
    const r = container.getBoundingClientRect();
    W = Math.max(1, r.width); H = Math.max(1, r.height);
    renderer.setSize(W, H, false);
    renderer.domElement.style.width = `${W}px`;
    renderer.domElement.style.height = `${H}px`;
    // Match the original projection: screen = c + p · R · d / (d − z), R = min(W,H)·fill
    const f = Math.min(W, H) * SPHERE_FILL_RATIO * FOV_BASE;
    camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan((H / 2) / f));
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    uPixelRatio.value = renderer.getPixelRatio();
    uResolution.value.set(W * renderer.getPixelRatio(), H * renderer.getPixelRatio());
    ribbonMat.uniforms.uWidth.value = (dark ? 2.2 : 2.6) * renderer.getPixelRatio();
    rotDirty = true;
  }
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  // ── Theme observer ──
  const mo = new MutationObserver(applyTheme);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  applyTheme();

  // ── Labels (DOM pool) ──
  const LABEL_POOL = 2 + MAX_NEIGHBOR_LABELS + HUB_LABELS;
  const labelEls: HTMLDivElement[] = [];
  const labelText: string[] = [];
  for (let i = 0; i < LABEL_POOL; i++) {
    const el = document.createElement("div");
    el.style.cssText = [
      "position:absolute", "left:0", "top:0", "white-space:nowrap", "pointer-events:none",
      "font-family:'Geist',sans-serif", "font-size:12px", "line-height:1", "will-change:transform,opacity",
      "text-shadow:0 0 3px var(--bg-base),0 0 3px var(--bg-base),0 0 6px var(--bg-base)",
      "opacity:0", "transition:opacity 0.18s ease",
    ].join(";");
    cb.labelLayer.appendChild(el);
    labelEls.push(el);
    labelText.push("");
  }

  type LabelReq = { i: number; kind: "hover" | "selected" | "neighbor" | "hub"; opacity: number };
  const placed: Array<[number, number, number, number]> = [];
  function updateLabels(dragging: boolean) {
    const reqs: LabelReq[] = [];
    if (hoveredIdx >= 0) reqs.push({ i: hoveredIdx, kind: "hover", opacity: 1 });
    if (selectedIdx >= 0 && selectedIdx !== hoveredIdx) reqs.push({ i: selectedIdx, kind: "selected", opacity: 1 });
    if (!dragging) {
      if (selectedIdx >= 0) {
        const nbs = adjacency[selectedIdx]
          .filter((n) => n !== hoveredIdx && screenDepth[n] > 0.55)
          .sort((a, b) => nodes[b].degree - nodes[a].degree || screenDepth[b] - screenDepth[a])
          .slice(0, MAX_NEIGHBOR_LABELS);
        for (const n of nbs) reqs.push({ i: n, kind: "neighbor", opacity: lerp(0.35, 0.85, (screenDepth[n] - 0.55) / 0.45) });
      } else if (uMorph.value >= 1) {
        for (const h of hubs) {
          if (h === hoveredIdx || nodes[h].degree < 3 || screenDepth[h] < 0.72) continue;
          reqs.push({ i: h, kind: "hub", opacity: lerp(0.0, 0.55, (screenDepth[h] - 0.72) / 0.2) });
        }
      }
    }

    placed.length = 0;
    let used = 0;
    for (const req of reqs) {
      if (used >= LABEL_POOL) break;
      const n = nodes[req.i];
      const x = screenX[req.i] + screenR[req.i] + 6;
      const y = screenY[req.i] - 6;
      const w = n.name.length * 6.4 + 4;
      const h = 14;
      if (req.kind === "neighbor" || req.kind === "hub") {
        let overlaps = false;
        for (const [px, py, pw, ph] of placed) {
          if (x < px + pw && x + w > px && y < py + ph && y + h > py) { overlaps = true; break; }
        }
        if (overlaps) continue;
      }
      placed.push([x, y, w, h]);
      const el = labelEls[used];
      const text = n.name;
      if (labelText[used] !== text) { el.textContent = text; labelText[used] = text; }
      el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      el.style.opacity = String(req.opacity);
      el.style.fontWeight = req.kind === "selected" ? "500" : "400";
      el.style.color = req.kind === "selected" || req.kind === "hover" ? "var(--text-primary)" : "var(--text-secondary)";
      el.style.fontSize = req.kind === "hub" ? "11px" : "12px";
      used++;
    }
    for (let k = used; k < LABEL_POOL; k++) {
      if (labelEls[k].style.opacity !== "0") labelEls[k].style.opacity = "0";
    }
  }

  // ── Render loop ──
  let raf = 0;
  let prevT = performance.now();
  let lastSortRot: Quat = [2, 2, 2, 2];
  let lastR = -1;
  const t3 = new THREE.Quaternion();

  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - prevT) / 1000);
    prevT = now;
    uTime.value = now / 1000;

    const dragging = pointers.size > 0 && dragMoved;

    // Rotation: scripted animation → inertia → idle auto-rotate
    if (rotAnim) {
      const t = Math.min(1, (now - rotAnim.start) / rotAnim.dur);
      rot = quatNorm(quatSlerp(rotAnim.from, rotAnim.to, rotAnim.ease(t)));
      if (t >= 1) rotAnim = null;
      rotDirty = true;
    } else if (!dragging && spinRate > 0.001) {
      rot = quatNorm(quatMul(quatFromAxisAngle(spinAxis, spinRate * dt), rot));
      spinRate *= Math.exp(-dt * 2.6);
      rotDirty = true;
    }
    const idle = autoRotate && selectedIdx < 0 && hoveredIdx < 0 && pointers.size === 0 && !rotAnim
      && spinRate < 0.01 && now - lastInteract > AUTO_ROTATE_IDLE_MS && nodes.length > 0;
    autoRate += ((idle ? AUTO_ROTATE_SPEED : 0) - autoRate) * (1 - Math.exp(-dt * 1.5));
    if (autoRate > 0.0005) {
      rot = quatNorm(quatMul(quatFromAxisAngle([0, 1, 0], -autoRate * dt), rot));
      rotDirty = true;
    }

    // Smooth zoom
    if (Math.abs(zoomTarget - zoom) > 1e-4) {
      zoom += (zoomTarget - zoom) * (1 - Math.exp(-dt * 14));
      rotDirty = true;
    }
    camera.zoom = zoom;
    camera.updateProjectionMatrix();
    nodeMat.uniforms.uSizeScale.value = Math.max(0.75, Math.min(1.8, Math.pow(zoom, 0.35)));

    // Morph progress
    const morph = currentMorph(now);
    uMorph.value = morph;
    const morphing = morph < 1;

    // Rotation → Three.js (mirror y)
    t3.set(-rot[0], rot[1], -rot[2], rot[3]);
    root.quaternion.copy(t3);
    const starQ = quatSlerp(QUAT_IDENTITY, rot, 0.25);
    starRoot.quaternion.set(-starQ[0], starQ[1], -starQ[2], starQ[3]);

    // Per-node highlight easing
    const k = 1 - Math.exp(-dt * 12);
    let nodesChanged = false;
    for (let i = 0; i < nodes.length; i++) {
      const emphT = Math.max(nodeEmphTgt[i], i === hoveredIdx ? 0.6 : 0);
      const da = nodeAlphaTgt[i] - nodeAlphaCur[i];
      const de = emphT - nodeEmphCur[i];
      if (Math.abs(da) > 1e-3) { nodeAlphaCur[i] += da * k; nodesChanged = true; } else if (da !== 0) { nodeAlphaCur[i] = nodeAlphaTgt[i]; nodesChanged = true; }
      if (Math.abs(de) > 1e-3) { nodeEmphCur[i] += de * k; nodesChanged = true; } else if (de !== 0) { nodeEmphCur[i] = emphT; nodesChanged = true; }
    }
    if (nodesChanged) {
      (nodeGeo.getAttribute("aAlpha") as THREE.BufferAttribute).needsUpdate = true;
      (nodeGeo.getAttribute("aEmph") as THREE.BufferAttribute).needsUpdate = true;
    }
    let edgesChanged = false;
    for (let e = 0; e < edgeAlphaCur.length; e++) {
      const d = edgeAlphaTgt[e] - edgeAlphaCur[e];
      if (Math.abs(d) > 1e-4) { edgeAlphaCur[e] += d * k; edgesChanged = true; } else if (d !== 0) { edgeAlphaCur[e] = edgeAlphaTgt[e]; edgesChanged = true; }
    }
    if (edgesChanged) writeEdgeAlpha();

    // Ribbons follow the final layout, so they wait for any morph to finish
    if (ribbonsDirty && !morphing) rebuildRibbons();
    const ribbonTarget = selectedIdx >= 0 && !morphing && !ribbonsDirty ? 1 : 0;
    ribbonMat.uniforms.uAlpha.value += (ribbonTarget - ribbonMat.uniforms.uAlpha.value) * (1 - Math.exp(-dt * 6));

    // Back-to-front sort so nearer orbs paint over farther ones
    if (nodes.length > 0 && (rotDirty || morphing) &&
        (morphing || Math.abs(rot[0] - lastSortRot[0]) + Math.abs(rot[1] - lastSortRot[1]) + Math.abs(rot[2] - lastSortRot[2]) + Math.abs(rot[3] - lastSortRot[3]) > 1e-4)) {
      for (let i = 0; i < nodes.length; i++) sortZ[i] = quatRotate(rot, currentPos(i, morph, tmpV))[2];
      sortIdx.sort((a, b) => sortZ[a] - sortZ[b]);
      (nodeGeo.getIndex() as THREE.BufferAttribute).needsUpdate = true;
      lastSortRot = [...rot];
    }

    // Screen-space positions for picking + labels
    if (nodes.length > 0) {
      projectAll(now);
      if (hoverPending && pointers.size === 0) {
        const hit = pick(hoverPending.x, hoverPending.y);
        if (hit !== hoveredIdx) {
          hoveredIdx = hit;
          container.style.cursor = hit >= 0 ? "pointer" : "grab";
        }
        hoverPending = null;
      }
    }
    updateLabels(dragging || morphing);

    // Backdrop layers sized to the sphere
    const R = sphereRadiusPx();
    if (Math.abs(R - lastR) > 0.25) {
      lastR = R;
      const g = cb.glowLayer.style;
      g.width = g.height = `${R * 3.2}px`;
      g.left = `${W / 2 - R * 1.6}px`;
      g.top = `${H / 2 - R * 1.6}px`;
      const o = cb.outlineLayer.style;
      o.width = o.height = `${R * 2}px`;
      o.left = `${W / 2 - R}px`;
      o.top = `${H / 2 - R}px`;
      const maxW = R * 1.1;
      const cw = cb.centerWrap.style;
      cw.left = `${W / 2 - maxW / 2}px`;
      cw.top = `${H / 2 - R * 0.55}px`;
      cw.width = `${maxW}px`;
      cw.height = `${R * 1.1}px`;
      cw.perspective = `${FOV_BASE * R}px`;
      cb.centerText.style.fontSize = `${Math.max(13, Math.min(26, R * 0.085))}px`;
      cb.centerText.style.maxWidth = `${maxW}px`;
    }
    if (centerTextVisible) {
      cb.centerText.style.transform = quatToMatrix3d(quatNorm(quatMul(rot, quatInverse(textBase))));
    }

    rotDirty = false;
    renderer.render(scene, camera);
  }
  raf = requestAnimationFrame(frame);

  return {
    setData,
    setSelection,
    focusNode,
    setAutoRotate: (on) => { autoRotate = on; },
    zoomBy: (f) => { zoomTarget = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoomTarget * f)); lastInteract = performance.now(); },
    resetView: () => {
      spinRate = 0;
      zoomTarget = 1;
      rotAnim = { from: rot, to: QUAT_IDENTITY, start: performance.now(), dur: FOCUS_DURATION, ease: easeInOutCubic };
      textBase = QUAT_IDENTITY;
      lastInteract = performance.now();
    },
    setCenterText: (v) => { centerTextVisible = v; },
    nodeCount: () => nodes.length,
    dispose: () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      mo.disconnect();
      container.removeEventListener("pointerdown", onPointerDown);
      container.removeEventListener("pointermove", onPointerMove);
      container.removeEventListener("pointerup", onPointerUp);
      container.removeEventListener("pointercancel", onPointerUp);
      container.removeEventListener("pointerleave", onPointerLeave);
      container.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKeyDown);
      for (const el of labelEls) el.remove();
      nodeGeo.dispose(); nodeMat.dispose();
      edgeGeo.dispose(); edgeMat.dispose();
      ribbonGeo.dispose(); ribbonMat.dispose();
      starGeo.dispose(); starMat.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}

// ─── Component ────────────────────────────────────────────────────────────────

export function GraphCanvas({
  graph, onSelectNode, selectedNodeId, shape = "sphere", deepHighlight = false,
  panelOpen = false, sphereCenterText, centerTextOpacity = 0.25, autoRotate = true,
}: Props) {
  const containerRef  = useRef<HTMLDivElement>(null);
  const hostRef       = useRef<HTMLDivElement>(null);
  const labelLayerRef = useRef<HTMLDivElement>(null);
  const glowRef       = useRef<HTMLDivElement>(null);
  const outlineRef    = useRef<HTMLDivElement>(null);
  const centerWrapRef = useRef<HTMLDivElement>(null);
  const centerTextRef = useRef<HTMLParagraphElement>(null);
  const engineRef     = useRef<Engine | null>(null);

  const [localSelectedId, setLocalSelectedId] = useState<string | null>(null);
  const [hasNodes, setHasNodes] = useState(false);

  // Center text fade animation state
  const [displayedCenterText, setDisplayedCenterText] = useState<string | null>(null);
  const [centerTextAnimOpacity, setCenterTextAnimOpacity] = useState(0);
  const centerTextFadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Engine lifecycle ──
  useEffect(() => {
    const container = containerRef.current, host = hostRef.current;
    if (!container || !host || !labelLayerRef.current || !glowRef.current || !outlineRef.current || !centerWrapRef.current || !centerTextRef.current) return;
    const engine = createEngine(container, host, {
      onNodeClick: (id) => setLocalSelectedId(id),
      onDeselect: () => setLocalSelectedId(null),
      labelLayer: labelLayerRef.current,
      glowLayer: glowRef.current,
      outlineLayer: outlineRef.current,
      centerWrap: centerWrapRef.current,
      centerText: centerTextRef.current,
    });
    engineRef.current = engine;
    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  // ── Graph / shape change → morph to new layout ──
  const dataKey = useMemo(
    () => graph.nodes.map((n) => `${n.id}:${n.color}`).join(",") + "|" + graph.edges.length,
    [graph.nodes, graph.edges],
  );
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.setData(graph.nodes, graph.edges, shape);
    setHasNodes(graph.nodes.length > 0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataKey, shape]);

  useEffect(() => { engineRef.current?.setAutoRotate(autoRotate); }, [autoRotate]);

  // ── Selection highlight ──
  useEffect(() => {
    engineRef.current?.setSelection(localSelectedId, deepHighlight);
  }, [localSelectedId, deepHighlight, dataKey]);

  // ── Sync external selection (from detail panel / search) and focus it ──
  useEffect(() => {
    if (!selectedNodeId) {
      setLocalSelectedId(null);
      return;
    }
    setLocalSelectedId(selectedNodeId);
    engineRef.current?.setSelection(selectedNodeId, deepHighlight);
    engineRef.current?.focusNode(selectedNodeId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNodeId]);

  // ── Fetch node detail when selection changes ──
  useEffect(() => {
    if (!localSelectedId) { onSelectNode(null); return; }
    let cancelled = false;
    void fetch(`/api/node/${localSelectedId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((payload: NodeDetail | null) => { if (!cancelled) onSelectNode(payload); })
      .catch(() => { if (!cancelled) onSelectNode(null); });
    return () => { cancelled = true; };
  }, [localSelectedId, onSelectNode]);

  // ── Center text fade ──
  useEffect(() => {
    if (centerTextFadeTimer.current) clearTimeout(centerTextFadeTimer.current);

    if (!sphereCenterText) {
      setCenterTextAnimOpacity(0);
      centerTextFadeTimer.current = setTimeout(() => setDisplayedCenterText(null), 500);
      return;
    }

    if (!displayedCenterText) {
      setDisplayedCenterText(sphereCenterText);
      setCenterTextAnimOpacity(0);
      centerTextFadeTimer.current = setTimeout(() => setCenterTextAnimOpacity(centerTextOpacity), 30);
    } else {
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

  useEffect(() => {
    if (displayedCenterText) setCenterTextAnimOpacity(centerTextOpacity);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centerTextOpacity]);

  const showCenter = !!displayedCenterText && !!localSelectedId;
  useEffect(() => { engineRef.current?.setCenterText(showCenter); }, [showCenter]);

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%", height: "100%",
        position: "relative", overflow: "hidden",
        userSelect: "none",
        touchAction: "none",
        cursor: "grab",
        background: "var(--bg-base)",
      }}
    >
      {/* Ambient glow behind the sphere */}
      <div
        ref={glowRef}
        style={{
          position: "absolute",
          borderRadius: "50%",
          pointerEvents: "none",
          background: "radial-gradient(circle at center, color-mix(in srgb, var(--accent-warm) 9%, transparent) 0%, color-mix(in srgb, var(--accent-warm) 3%, transparent) 38%, transparent 62%)",
          opacity: hasNodes ? 1 : 0,
          transition: "opacity 4s ease",
        }}
      />

      {/* Sphere outline hint */}
      <div
        ref={outlineRef}
        style={{
          position: "absolute",
          borderRadius: "50%",
          border: "1px solid var(--border-subtle)",
          opacity: shape === "sphere" ? 0.35 : 0,
          pointerEvents: "none",
          transition: "opacity 0.6s ease",
        }}
      />

      {/* Center text — beneath the transparent WebGL canvas so nodes and edges paint over it */}
      <div
        ref={centerWrapRef}
        style={{
          position: "absolute",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          pointerEvents: "none",
          visibility: showCenter ? "visible" : "hidden",
        }}
      >
        <p
          ref={centerTextRef}
          style={{
            margin: 0,
            fontFamily: "'Lora', Georgia, serif",
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
            transformStyle: "preserve-3d",
            backfaceVisibility: "visible",
          }}
        >
          {displayedCenterText}
        </p>
      </div>

      {/* WebGL canvas */}
      <div
        ref={hostRef}
        style={{
          position: "absolute",
          inset: 0,
          opacity: hasNodes ? 1 : 0,
          transition: "opacity 4s ease",
        }}
      />

      {/* Node labels */}
      <div ref={labelLayerRef} style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden" }} />

      {/* Zoom buttons */}
      <div
        style={{
          position: "absolute",
          top: 60,
          right: panelOpen ? 332 : 24,
          display: "flex",
          flexDirection: "column",
          gap: 12,
          zIndex: 20,
          transition: "right 0.35s cubic-bezier(0.32, 0, 0.15, 1)",
        }}
      >
        {([
          { label: "+", delta: 1.4 },
          { label: "−", delta: 1 / 1.4 },
        ] as const).map(({ label, delta }) => (
          <button
            key={label}
            type="button"
            onClick={() => engineRef.current?.zoomBy(delta)}
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
          onClick={() => engineRef.current?.resetView()}
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
