"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

import type { GraphData, NodeDetail } from "@/lib/types";
import { computeCityLayout, type CityNode, BUILDING_BASE, CELL_SIZE, MIN_ALLEY } from "@/lib/cityLayout";

// ─── Constants ────────────────────────────────────────────────────────────────

const FP_HEIGHT   = 1.8;  // eye-level height in world units
const FP_SPEED    = 5;    // units/sec walking
const FP_SPRINT   = 14;   // units/sec sprinting
const FP_SENS     = 0.002; // mouse look sensitivity
const FP_JUMP_VEL = 8;    // upward velocity on jump (world units/sec)
const FP_GRAVITY  = 20;   // downward acceleration (world units/sec²)

// ─── Web Swing Constants ──────────────────────────────────────────────────────
const WEB_SHOOT_RANGE   = 80;   // max raycast distance to attach web
const WEB_SWING_DAMPING = 0.995; // velocity damping per frame while swinging
const WEB_LAUNCH_BOOST  = 6;    // extra upward velocity given when web first attaches
const WEB_COLOR_LIGHT   = 0xaaaaaa;
const WEB_COLOR_DARK    = 0x888888;

const LABEL_NEAR  = 4;    // distance at which label reaches max opacity
const LABEL_FAR   = 14;   // distance at which label starts fading in
const OVERHEAD_LABEL_PRIORITY_COUNT = 10;
const OVERHEAD_LABEL_HIDDEN_OPACITY = 0.0;
const OVERHEAD_LABEL_MIN_OPACITY = 0.25;
const OVERHEAD_LABEL_MAX_OPACITY = 1.0;
const LABEL_CACHE_MAX = 240;   // building label textures kept alive (LRU)
const LABEL_TEX_SIZE  = 512;

const FLYOVER_BASE_SPEED    = 5.0; // world-units per second for both arcs and fly segments
const FLYOVER_LOOK_DURATION = 3.0; // seconds for one look-at ease-in/out transition

const GRID_CELL = 8;           // spatial hash cell size (world units)
const GROW_DURATION = 1.1;     // seconds for one building to rise
const ARC_SEGMENTS = 28;
const MINIMAP_SIZE = 168;      // css px
const DISTRICT_NAMES = ["New Town", "Midtown", "Old Town"] as const;

// Flat things lying on the floor (plates, streets, labels, ripple) are only
// hundredths of a unit above it, which the depth buffer can't resolve when
// zoomed out — they'd z-fight and flicker. Instead they skip depth testing and
// draw in this fixed order: after the floor (opaque) and before buildings
// (edges = 1, glass = 2), so towers still paint over them.
const GROUND_DECAL_ORDER = { plate: 0, street: 0.2, districtLabel: 0.4, ripple: 0.6 } as const;

// Building highlight targets: [fill, edge, selected, connected]
const STATE_DEFAULT:   [number, number, number, number] = [0.12, 1.00, 0, 0];
const STATE_SELECTED:  [number, number, number, number] = [0.30, 1.00, 1, 0];
const STATE_CONNECTED: [number, number, number, number] = [0.22, 0.85, 0, 1];
const STATE_DIMMED:    [number, number, number, number] = [0.04, 0.18, 0, 0];

// ─── Types ────────────────────────────────────────────────────────────────────

type FlyoverLabelMode = 'none' | 'overhead' | 'center';

type FlyoverSegment = {
  type: 'arc' | 'fly';
  duration: number;
  nodeIdx: number;
  // Arc
  arcCx: number; arcCy: number; arcCz: number;
  arcRadius: number;
  arcStartAngle: number; arcEndAngle: number; arcCCW: boolean;
  // Fly
  flyStart: THREE.Vector3;
  flyEnd:   THREE.Vector3;
  // LookAt target for this segment
  lookAtTarget: THREE.Vector3;
};

type BuildingEntry = {
  node: CityNode;
  index: number; // instance index
};

type Theme = {
  dark: boolean;
  bg: THREE.Color;
  grid: THREE.Color;
  accent: THREE.Color;
};

type CameraAnim = {
  fromPos: THREE.Vector3; fromTarget: THREE.Vector3;
  toPos: THREE.Vector3;   toTarget: THREE.Vector3;
  start: number; dur: number;
};

type SceneState = {
  renderer: THREE.WebGLRenderer;
  composer: EffectComposer;
  bloom: UnrealBloomPass;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  buildingMap: Map<string, BuildingEntry>;
  buildings: CityNode[];
  adjacency: Map<string, Set<string>>;
  graphEdges: GraphData["edges"];
  darkMode: boolean;
  glow: boolean;
  // First-person state
  fpActive: boolean;
  fpYaw: number;
  fpPitch: number;
  fpKeys: Set<string>;
  fpVelY: number;
  fpOnGround: boolean;
  overheadPos: THREE.Vector3;
  overheadTarget: THREE.Vector3;
  prevTime: number;
  // Label settings
  showLabelsFP: boolean;
  showLabelsOverhead: boolean;
  showClickLabels: boolean;
  // Overhead click-label overlay
  labelOverlaySvg: SVGSVGElement;
  selectedNodeIdForLabels: string | null;
  connectedNodeIdsForLabels: Set<string>;
  projVec: THREE.Vector3;
  // Flyover state
  flyoverActive: boolean;
  flyoverQueue: string[];
  flyoverQueueIndex: number;
  flyoverSegments: FlyoverSegment[];
  flyoverSegIdx: number;
  flyoverSegT: number;
  flyoverLabelMode: FlyoverLabelMode;
  flyoverSpeedMult: number;
  flyoverArcHeightMult: number;
  flyoverCameraHeightOffset: number;
  flyoverPendingReroute: string | null;
  flyoverLookFrom: THREE.Vector3;  // look-at start of the active eased transition
  flyoverLookTo: THREE.Vector3;    // look-at end of the active eased transition
  flyoverLookT: number;            // 0→1 progress through current transition
  flyoverLookArcNode: number;      // nodeIdx of the arc that last triggered a transition (-1 = none)
  // Web swing state
  webAnchor: THREE.Vector3 | null; // world-space anchor point (null = no web)
  webLength: number;               // rope length at time of attachment
  webVelX: number;                 // player velocity X (separate from fpVelY, for swing)
  webVelZ: number;                 // player velocity Z
  webLine: THREE.Line | null;      // visual web line in scene
  // Camera animation (fit / focus)
  camAnim: CameraAnim | null;
  // Imperative hooks
  rebuild: (graph: GraphData) => void;
  applyTheme: (dark: boolean) => void;
  applySelection: (selectedId: string | null, showConnectors: boolean) => void;
  fitView: (animated: boolean) => void;
  focusBuilding: (id: string) => void;
};

type Props = {
  graph: GraphData;
  onSelectNode: (detail: NodeDetail | null) => void;
  selectedNodeId: string | null;
  darkMode?: boolean;
  firstPerson?: boolean;
  onExitFirstPerson?: () => void;
  showLabelsFP?: boolean;
  showLabelsOverhead?: boolean;
  showClickLabels?: boolean;
  flyover?: boolean;
  flyoverLabelMode?: FlyoverLabelMode;
  flyoverSpeedMult?: number;
  flyoverArcHeightMult?: number;
  flyoverCameraHeightOffset?: number;
  onExitFlyover?: () => void;
  fitSceneTrigger?: number;
  jumpEnabled?: boolean;
  webEnabled?: boolean;
  showConnectors?: boolean;
  /** Bloom glow on bright edges/windows (dark mode only). */
  glow?: boolean;
  /** Fly the camera to a building (e.g. from search). Bump `seq` to re-trigger. */
  focusRequest?: { id: string; seq: number } | null;
  panelOpen?: boolean;
};

// ─── Math helpers ─────────────────────────────────────────────────────────────

function easeInOutCubic(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function hashFloat(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 0x100000000;
}

/** Camera position/target that frames every building from the current viewing direction. */
function computeFitView(
  camera: THREE.PerspectiveCamera,
  currentTarget: THREE.Vector3,
  buildings: CityNode[],
  minDistance: number,
  padding = 1.12,
  extraPoints: THREE.Vector3[] = [],
): { position: THREE.Vector3; target: THREE.Vector3; distance: number } | null {
  if (buildings.length === 0) return null;

  const bounds = new THREE.Box3();
  for (const n of buildings) {
    const hw = (n.widthScale * BUILDING_BASE) / 2;
    bounds.expandByPoint(new THREE.Vector3(n.cx - hw, 0, n.cz - hw));
    bounds.expandByPoint(new THREE.Vector3(n.cx + hw, n.height, n.cz + hw));
  }
  for (const p of extraPoints) bounds.expandByPoint(p);

  const center = bounds.getCenter(new THREE.Vector3());
  const corners = [
    new THREE.Vector3(bounds.min.x, bounds.min.y, bounds.min.z),
    new THREE.Vector3(bounds.min.x, bounds.min.y, bounds.max.z),
    new THREE.Vector3(bounds.min.x, bounds.max.y, bounds.min.z),
    new THREE.Vector3(bounds.min.x, bounds.max.y, bounds.max.z),
    new THREE.Vector3(bounds.max.x, bounds.min.y, bounds.min.z),
    new THREE.Vector3(bounds.max.x, bounds.min.y, bounds.max.z),
    new THREE.Vector3(bounds.max.x, bounds.max.y, bounds.min.z),
    new THREE.Vector3(bounds.max.x, bounds.max.y, bounds.max.z),
  ];

  const forward = new THREE.Vector3().subVectors(currentTarget, camera.position);
  if (forward.lengthSq() < 1e-6) forward.set(0, -0.5, -1);
  forward.normalize();

  const worldUp = Math.abs(forward.y) > 0.98
    ? new THREE.Vector3(0, 0, 1)
    : new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3().crossVectors(forward, worldUp).normalize();
  const up = new THREE.Vector3().crossVectors(right, forward).normalize();

  const vFov = THREE.MathUtils.degToRad(camera.fov);
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
  const tanV = Math.tan(vFov / 2);
  const tanH = Math.tan(hFov / 2);

  let requiredDistance = 0;
  for (const corner of corners) {
    const rel = corner.clone().sub(center);
    const x = Math.abs(rel.dot(right));
    const y = Math.abs(rel.dot(up));
    const z = rel.dot(forward);
    requiredDistance = Math.max(requiredDistance, x / tanH - z, y / tanV - z);
  }

  const distance = Math.max(requiredDistance * padding, minDistance + 1);
  return {
    position: center.clone().addScaledVector(forward, -distance),
    target: center,
    distance,
  };
}

// ─── Spatial grid ─────────────────────────────────────────────────────────────

/** Uniform hash grid over building footprints for O(1) neighbourhood queries. */
class BuildingGrid {
  private cells = new Map<number, number[]>();
  private stamp: Uint32Array;
  private stampId = 0;

  constructor(private nodes: CityNode[]) {
    this.stamp = new Uint32Array(nodes.length);
    nodes.forEach((n, i) => {
      const hw = (n.widthScale * BUILDING_BASE) / 2;
      this.forCells(n.cx - hw, n.cx + hw, n.cz - hw, n.cz + hw, (k) => {
        let cell = this.cells.get(k);
        if (!cell) { cell = []; this.cells.set(k, cell); }
        cell.push(i);
      });
    });
  }

  private forCells(x0: number, x1: number, z0: number, z1: number, fn: (key: number) => void) {
    const ix0 = Math.floor(x0 / GRID_CELL), ix1 = Math.floor(x1 / GRID_CELL);
    const iz0 = Math.floor(z0 / GRID_CELL), iz1 = Math.floor(z1 / GRID_CELL);
    for (let ix = ix0; ix <= ix1; ix++) {
      for (let iz = iz0; iz <= iz1; iz++) fn((ix + 50000) * 100003 + (iz + 50000));
    }
  }

  /** Visit each building whose footprint cell overlaps the query box once. */
  query(x0: number, x1: number, z0: number, z1: number, fn: (index: number) => void) {
    this.stampId = (this.stampId + 1) >>> 0 || 1;
    const id = this.stampId;
    this.forCells(x0, x1, z0, z1, (k) => {
      const cell = this.cells.get(k);
      if (!cell) return;
      for (const i of cell) {
        if (this.stamp[i] === id) continue;
        this.stamp[i] = id;
        fn(i);
      }
    });
  }
}

// ─── Street helpers ───────────────────────────────────────────────────────────

type Obstacle = { x0: number; x1: number; z0: number; z1: number };

function clipLine(
  lineStart: number, lineEnd: number,
  linePos: number, dir: "h" | "v",
  obstacles: Obstacle[],
): [number, number][] {
  const blocked: [number, number][] = [];
  for (const obs of obstacles) {
    const crossMin = dir === "h" ? obs.z0 : obs.x0;
    const crossMax = dir === "h" ? obs.z1 : obs.x1;
    const alongMin = dir === "h" ? obs.x0 : obs.z0;
    const alongMax = dir === "h" ? obs.x1 : obs.z1;
    if (linePos >= crossMin && linePos <= crossMax) {
      const s = Math.max(lineStart, alongMin);
      const e = Math.min(lineEnd, alongMax);
      if (e > s) blocked.push([s, e]);
    }
  }
  blocked.sort((a, b) => a[0] - b[0]);

  const free: [number, number][] = [];
  const MIN_SEG = 0.4;
  let pos = lineStart;
  for (const [b0, b1] of blocked) {
    if (b0 - pos > MIN_SEG) free.push([pos, b0]);
    pos = Math.max(pos, b1);
  }
  if (lineEnd - pos > MIN_SEG) free.push([pos, lineEnd]);
  return free;
}

function dashSegment(
  s: number, e: number, pos: number, dir: "h" | "v", y: number,
  dashSize = 0.22, gapSize = 0.28,
): number[] {
  const pts: number[] = [];
  let t = s + gapSize / 2;
  while (t + dashSize <= e) {
    const t1 = t + dashSize;
    if (dir === "h") pts.push(t, y, pos, t1, y, pos);
    else              pts.push(pos, y, t,  pos, y, t1);
    t = t1 + gapSize;
  }
  return pts;
}

function buildStreets(cityNodes: CityNode[], darkMode: boolean): THREE.Group {
  const group = new THREE.Group();
  group.visible = false; // hidden until first-person mode activates
  group.userData.isStreets = true;

  const STREET_Y = 0.004;
  const LANE_Y   = 0.007;
  const HWY_Y    = 0.006;
  const OBS_PAD  = MIN_ALLEY / 2 + 0.05;
  const PAD      = CELL_SIZE * 1.2;

  const streetCol = darkMode ? 0x2a2a3e : 0xd4d0c8;
  const laneCol   = darkMode ? 0xffffff : 0x888878;
  const hwayCol   = darkMode ? 0x34344e : 0xbcb8b0;

  const clusters = new Map<number, CityNode[]>();
  for (const n of cityNodes) {
    if (!clusters.has(n.cohort)) clusters.set(n.cohort, []);
    clusters.get(n.cohort)!.push(n);
  }

  const centroids: [number, number][] = [];

  for (const [, nodes] of [...clusters.entries()].sort(([a], [b]) => a - b)) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    let sumX = 0, sumZ = 0;
    for (const n of nodes) {
      const hw = (n.widthScale * BUILDING_BASE) / 2;
      minX = Math.min(minX, n.cx - hw); maxX = Math.max(maxX, n.cx + hw);
      minZ = Math.min(minZ, n.cz - hw); maxZ = Math.max(maxZ, n.cz + hw);
      sumX += n.cx; sumZ += n.cz;
    }
    centroids.push([sumX / nodes.length, sumZ / nodes.length]);

    minX -= PAD; maxX += PAD; minZ -= PAD; maxZ += PAD;

    const obstacles: Obstacle[] = nodes.map((n) => {
      const hw = (n.widthScale * BUILDING_BASE) / 2 + OBS_PAD;
      return { x0: n.cx - hw, x1: n.cx + hw, z0: n.cz - hw, z1: n.cz + hw };
    });

    const streetPts: number[] = [];
    const lanePts:   number[] = [];
    const zStart = Math.ceil(minZ / CELL_SIZE) * CELL_SIZE;
    const xStart = Math.ceil(minX / CELL_SIZE) * CELL_SIZE;

    for (let z = zStart; z <= maxZ; z += CELL_SIZE) {
      for (const [x0, x1] of clipLine(minX, maxX, z, "h", obstacles)) {
        streetPts.push(x0, STREET_Y, z, x1, STREET_Y, z);
        lanePts.push(...dashSegment(x0, x1, z, "h", LANE_Y));
      }
    }
    for (let x = xStart; x <= maxX; x += CELL_SIZE) {
      for (const [z0, z1] of clipLine(minZ, maxZ, x, "v", obstacles)) {
        streetPts.push(x, STREET_Y, z0, x, STREET_Y, z1);
        lanePts.push(...dashSegment(z0, z1, x, "v", LANE_Y));
      }
    }

    const addLines = (pts: number[], color: number, opacity: number) => {
      if (pts.length === 0) return;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
      const mat = new THREE.LineBasicMaterial({ color, opacity, transparent: true });
      group.add(new THREE.LineSegments(geo, mat));
    };

    addLines(streetPts, streetCol, 0.55);
    addLines(lanePts,   laneCol,   0.20);
  }

  // Highways between cluster centroids
  if (centroids.length === 3) {
    for (const [a, b] of [[0, 1], [1, 2], [0, 2]] as [number, number][]) {
      const [ax, az] = centroids[a];
      const [bx, bz] = centroids[b];

      const hwPts = [ax, HWY_Y, az, bx, HWY_Y, bz];
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(hwPts, 3));
      group.add(new THREE.Line(geo, new THREE.LineBasicMaterial({ color: hwayCol, opacity: 0.45, transparent: true })));

      const dx = bx - ax, dz = bz - az;
      const len = Math.sqrt(dx * dx + dz * dz);
      const DASH = 0.5, GAP = 0.5;
      const hwDash: number[] = [];
      let t = GAP / 2;
      while (t + DASH <= len) {
        const t0 = t / len, t1 = (t + DASH) / len;
        hwDash.push(ax + dx * t0, HWY_Y + 0.001, az + dz * t0, ax + dx * t1, HWY_Y + 0.001, az + dz * t1);
        t += DASH + GAP;
      }
      if (hwDash.length > 0) {
        const dGeo = new THREE.BufferGeometry();
        dGeo.setAttribute("position", new THREE.Float32BufferAttribute(hwDash, 3));
        group.add(new THREE.LineSegments(dGeo, new THREE.LineBasicMaterial({ color: laneCol, opacity: 0.30, transparent: true })));
      }
    }
  }

  return group;
}

function disposeGroup(group: THREE.Object3D) {
  group.traverse((obj) => {
    const o = obj as THREE.Mesh;
    if (o.geometry) o.geometry.dispose();
    const mat = o.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else if (mat) {
      (mat as THREE.MeshBasicMaterial).map?.dispose();
      mat.dispose();
    }
  });
}

// ─── Building label sprite ────────────────────────────────────────────────────

function makeLabelSprite(text: string, buildingWidth: number, darkMode: boolean): THREE.Sprite {
  const SIZE = LABEL_TEX_SIZE;
  const canvas = document.createElement("canvas");
  canvas.width  = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d")!;

  ctx.clearRect(0, 0, SIZE, SIZE);
  ctx.fillStyle   = darkMode ? "rgba(255,255,255,0.92)" : "rgba(0,0,0,0.88)";
  ctx.textAlign   = "center";
  ctx.textBaseline = "middle";

  const maxW   = SIZE * 0.88;
  let fontSize = Math.max(36, Math.min(100, SIZE / Math.max(1, text.length / 2.5)));
  ctx.font = `bold ${fontSize}px sans-serif`;

  const words = text.split(/\s+/);
  const wrapLines = (fs: number): string[] => {
    ctx.font = `bold ${fs}px sans-serif`;
    const lines: string[] = [];
    let cur = "";
    for (const w of words) {
      const test = cur ? cur + " " + w : w;
      if (ctx.measureText(test).width <= maxW) { cur = test; }
      else { if (cur) lines.push(cur); cur = w; }
    }
    if (cur) lines.push(cur);
    return lines;
  };

  let lines = wrapLines(fontSize);
  const lineH = () => fontSize * 1.25;
  while (lines.length * lineH() > SIZE * 0.88 && fontSize > 24) {
    fontSize -= 4;
    lines = wrapLines(fontSize);
  }
  ctx.font = `bold ${fontSize}px sans-serif`;
  const totalH  = lines.length * lineH();
  const startY  = SIZE / 2 - totalH / 2 + lineH() / 2;
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], SIZE / 2, startY + i * lineH());
  }

  const texture      = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 8;
  texture.colorSpace = THREE.SRGBColorSpace;
  const mat     = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false });
  const sprite  = new THREE.Sprite(mat);
  const s       = buildingWidth * 0.82;
  sprite.scale.set(s, s, 1);
  sprite.visible = false;
  sprite.renderOrder = 10;
  return sprite;
}

/** Flat ground label naming a district, e.g. "NEW TOWN · 1,204". */
function makeDistrictLabel(name: string, count: number, darkMode: boolean): THREE.Mesh {
  const W = 1024, H = 192;
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, W, H);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "500 92px 'DM Mono', ui-monospace, monospace";
  ctx.fillStyle = darkMode ? "rgba(255,255,255,0.55)" : "rgba(45,37,32,0.50)";
  const title = name.toUpperCase().split("").join(" ");
  ctx.fillText(title, W / 2, H * 0.40);
  ctx.font = "400 44px 'DM Mono', ui-monospace, monospace";
  ctx.fillStyle = darkMode ? "rgba(255,255,255,0.30)" : "rgba(45,37,32,0.32)";
  ctx.fillText(`${count.toLocaleString()} record${count === 1 ? "" : "s"}`, W / 2, H * 0.80);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  // Ground decal: skips the depth test and relies on draw order instead (see GROUND_DECAL_ORDER)
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, H / W), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.renderOrder = GROUND_DECAL_ORDER.districtLabel;
  return mesh;
}

// ─── Overhead click-label overlay ────────────────────────────────────────────

function escSvg(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function mapDistanceToOpacity(
  distance: number,
  nearestDistance: number,
  furthestDistance: number,
  minOpacity = OVERHEAD_LABEL_MIN_OPACITY,
  maxOpacity = OVERHEAD_LABEL_MAX_OPACITY,
): number {
  if (!Number.isFinite(distance)) return maxOpacity;
  if (!Number.isFinite(nearestDistance) || !Number.isFinite(furthestDistance) || furthestDistance <= nearestDistance) {
    return maxOpacity;
  }
  const t = THREE.MathUtils.clamp((distance - nearestDistance) / (furthestDistance - nearestDistance), 0, 1);
  return THREE.MathUtils.lerp(maxOpacity, minOpacity, t);
}

function buildOverheadOpacityMap<T>(
  entries: T[],
  getKey: (entry: T) => string,
  getDistance: (entry: T) => number,
): Map<string, number> {
  const sorted = [...entries].sort((a, b) => getDistance(a) - getDistance(b));
  const prioritized = sorted.slice(0, OVERHEAD_LABEL_PRIORITY_COUNT);
  const opacityMap = new Map<string, number>();

  let nearestDistance = Infinity;
  let furthestDistance = -Infinity;
  for (const entry of prioritized) {
    const distance = getDistance(entry);
    nearestDistance = Math.min(nearestDistance, distance);
    furthestDistance = Math.max(furthestDistance, distance);
  }

  for (let index = 0; index < sorted.length; index++) {
    const entry = sorted[index];
    const key = getKey(entry);
    const distance = getDistance(entry);
    const opacity = index < OVERHEAD_LABEL_PRIORITY_COUNT
      ? mapDistanceToOpacity(distance, nearestDistance, furthestDistance)
      : OVERHEAD_LABEL_HIDDEN_OPACITY;
    opacityMap.set(key, opacity);
  }

  return opacityMap;
}

function updateOverheadLabels(
  buildingMap: Map<string, BuildingEntry>,
  svg: SVGSVGElement,
  selectedId: string,
  connectedIds: Set<string>,
  darkMode: boolean,
  camera: THREE.PerspectiveCamera,
  W: number,
  H: number,
  vec: THREE.Vector3,
): void {
  // Layout constants
  const DIAG_X    = 26;   // horizontal offset of angled segment (toward label)
  const DIAG_Y    = 54;   // default vertical rise of angled segment
  const HORIZ     = 62;   // horizontal segment length
  const LABEL_H   = 22;   // approximate label height for overlap detection
  const LABEL_PAD = 7;    // minimum vertical gap between labels

  // Colour scheme
  const textFill = darkMode ? "rgba(255,255,255,0.96)" : "rgba(14,14,20,0.96)";
  const pillBg   = darkMode ? "rgba(10,10,22,0.84)"   : "rgba(255,255,255,0.90)";
  const padX = 8, padY = 4;
  const fontBase = "'DM Mono',monospace";

  interface Item {
    id: string; name: string; isMain: boolean;
    sx: number; sy: number; color: string;
    distance: number;
    facingRight: boolean;
    ex: number; ey: number; // elbow position (ey may be adjusted)
  }

  const items: Item[] = [];

  const project = (id: string, isMain: boolean) => {
    const e = buildingMap.get(id);
    if (!e) return;
    vec.set(e.node.cx, e.node.height, e.node.cz);
    vec.project(camera);
    if (vec.z > 1) return; // behind camera
    const sx = (vec.x + 1) / 2 * W;
    const sy = (-vec.y + 1) / 2 * H;
    if (sx < -300 || sx > W + 300 || sy < -300 || sy > H + 300) return;
    const distance = camera.position.distanceTo(vec.set(e.node.cx, e.node.height, e.node.cz));
    const facingRight = sx < W / 2;
    items.push({
      id, name: e.node.name, isMain, sx, sy,
      color: e.node.color, distance, facingRight,
      ex: sx + (facingRight ? DIAG_X : -DIAG_X),
      ey: sy - DIAG_Y,
    });
  };

  project(selectedId, true);
  for (const id of connectedIds) project(id, false);

  if (items.length === 0) { svg.innerHTML = ""; return; }

  const opacityById = buildOverheadOpacityMap(items, (item) => item.id, (item) => item.distance);

  // Anti-overlap: process in order of ascending ey (topmost label first).
  items.sort((a, b) => a.ey - b.ey);

  const placed: Item[] = [];
  for (const item of items) {
    let ey = item.ey;
    const approxTW = Math.max(44, item.name.length * (item.isMain ? 7.6 : 7.1));
    const lx1 = item.facingRight ? item.ex + HORIZ : item.ex - HORIZ - approxTW;
    const lx2 = lx1 + approxTW;

    for (const p of placed) {
      const pTW = Math.max(44, p.name.length * (p.isMain ? 7.6 : 7.1));
      const plx1 = p.facingRight ? p.ex + HORIZ : p.ex - HORIZ - pTW;
      const plx2 = plx1 + pTW;
      const xOverlap = lx2 + 4 > plx1 && lx1 - 4 < plx2;
      if (xOverlap && Math.abs(ey - p.ey) < LABEL_H + LABEL_PAD) {
        ey = p.ey - LABEL_H - LABEL_PAD;
      }
    }
    item.ey = Math.max(16, ey);
    placed.push(item);
  }

  let html = "";
  for (const item of items) {
    const { sx, sy, ex, ey, facingRight, name, isMain, color } = item;
    const fs  = isMain ? 12 : 11;
    const fw  = isMain ? "600" : "400";
    const sw  = isMain ? "1.7" : "1.3";
    const baseLineOpacity = isMain ? 0.88 : 0.68;
    const opacity = opacityById.get(item.id) ?? OVERHEAD_LABEL_HIDDEN_OPACITY;
    const so  = baseLineOpacity * opacity;

    const horizEnd  = facingRight ? ex + HORIZ : ex - HORIZ;
    const approxTW  = Math.max(44, name.length * (isMain ? 7.6 : 7.1));
    const pillW     = approxTW + padX * 2;
    const pillH     = fs + padY * 2;
    const rectX     = facingRight ? horizEnd : horizEnd - pillW;
    const rectY     = ey - pillH / 2;
    const textX     = facingRight ? horizEnd + padX : horizEnd - padX;
    const anchor    = facingRight ? "start" : "end";

    html += `<circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="2.5" fill="${color}" opacity="${(0.92 * opacity).toFixed(2)}"/>`;
    html += `<line x1="${sx.toFixed(1)}" y1="${sy.toFixed(1)}" x2="${ex.toFixed(1)}" y2="${ey.toFixed(1)}" stroke="${color}" stroke-width="${sw}" opacity="${so.toFixed(2)}"/>`;
    html += `<line x1="${ex.toFixed(1)}" y1="${ey.toFixed(1)}" x2="${horizEnd.toFixed(1)}" y2="${ey.toFixed(1)}" stroke="${color}" stroke-width="${sw}" opacity="${so.toFixed(2)}"/>`;
    html += `<rect x="${rectX.toFixed(1)}" y="${rectY.toFixed(1)}" width="${pillW.toFixed(1)}" height="${pillH.toFixed(1)}" rx="3" ry="3" fill="${pillBg}" opacity="${(0.93 * opacity).toFixed(2)}"/>`;
    html += `<text x="${textX.toFixed(1)}" y="${ey.toFixed(1)}" font-family="${fontBase}" font-size="${fs}" font-weight="${fw}" fill="${textFill}" text-anchor="${anchor}" dominant-baseline="middle" opacity="${opacity.toFixed(2)}">${escSvg(name)}</text>`;
  }

  svg.innerHTML = html;
}

// ─── Flyover helpers ──────────────────────────────────────────────────────────

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function computeFlyoverQueue(
  hubId: string,
  graphEdges: GraphData["edges"],
  buildingMap: Map<string, BuildingEntry>,
): string[] {
  const visited = new Set<string>([hubId]);
  const connectedIds: string[] = [];
  for (const edge of graphEdges) {
    let connId: string | null = null;
    if (edge.source === hubId) connId = edge.target;
    else if (edge.target === hubId) connId = edge.source;
    if (connId && !visited.has(connId) && buildingMap.has(connId)) {
      visited.add(connId);
      connectedIds.push(connId);
    }
  }
  connectedIds.sort((a, b) => {
    const nodeA = buildingMap.get(a)?.node;
    const nodeB = buildingMap.get(b)?.node;
    const timeA = nodeA?.createdTime ?? null;
    const timeB = nodeB?.createdTime ?? null;
    if (timeA && timeB) return timeB.localeCompare(timeA);
    if (timeA) return -1;
    if (timeB) return 1;
    return (nodeA?.name ?? "").localeCompare(nodeB?.name ?? "");
  });
  return [hubId, ...connectedIds];
}

function normalizeAngle(a: number): number {
  return ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
}

function arcAngleAt(start: number, end: number, ccw: boolean, t: number): number {
  if (ccw) {
    return start + normalizeAngle(end - start) * t;
  } else {
    return start - normalizeAngle(start - end) * t;
  }
}

function computeFlyoverSegments(
  queue: string[],
  buildingMap: Map<string, BuildingEntry>,
  initialCamPos: THREE.Vector3,
  camHeightOffset: number,
  speedMult: number,
  radiusMult: number,
): FlyoverSegment[] {
  const N = queue.length;
  if (N === 0) return [];

  const circles = queue.map(id => {
    const entry = buildingMap.get(id)!;
    const n = entry.node;
    const bw = BUILDING_BASE * n.widthScale;
    return {
      cx: n.cx,
      cy: Math.max(0.3, n.height * (1 + camHeightOffset)),
      cz: n.cz,
      r: Math.max(bw * 0.6, bw * radiusMult),
      node: n,
    };
  });

  // Entry angles: furthest from next building
  const entryAngles: number[] = [];
  for (let i = 0; i < N; i++) {
    if (i < N - 1) {
      const dx = circles[i + 1].cx - circles[i].cx;
      const dz = circles[i + 1].cz - circles[i].cz;
      entryAngles[i] = Math.atan2(-dz, -dx);
    } else if (N > 1) {
      const dx = circles[N - 2].cx - circles[N - 1].cx;
      const dz = circles[N - 2].cz - circles[N - 1].cz;
      entryAngles[i] = Math.atan2(dz, dx);
    } else {
      entryAngles[i] = 0;
    }
  }

  // Exit angles and arc directions — direction locked to approach vector so the
  // camera never reverses mid-circle.
  const exitAngles: number[] = [];
  const arcCCWs: boolean[] = [];
  let prevExitX = initialCamPos.x;
  let prevExitZ = initialCamPos.z;
  for (let i = 0; i < N - 1; i++) {
    const ci = circles[i];
    const θ = entryAngles[i];
    const entX = ci.cx + ci.r * Math.cos(θ);
    const entZ = ci.cz + ci.r * Math.sin(θ);

    const adx = entX - prevExitX;
    const adz = entZ - prevExitZ;
    const adLen = Math.sqrt(adx * adx + adz * adz);
    const tangDot = adLen > 0.01 ? (adx * (-Math.sin(θ)) + adz * Math.cos(θ)) / adLen : 0;
    const preferCCW = tangDot >= 0;

    const ep1x = circles[i + 1].cx + circles[i + 1].r * Math.cos(entryAngles[i + 1]);
    const ep1z = circles[i + 1].cz + circles[i + 1].r * Math.sin(entryAngles[i + 1]);
    const dvx = ep1x - ci.cx, dvz = ep1z - ci.cz;
    const d = Math.sqrt(dvx * dvx + dvz * dvz);
    if (d <= ci.r + 0.1) {
      exitAngles[i] = θ + (preferCCW ? Math.PI : -Math.PI);
      arcCCWs[i] = preferCCW;
    } else {
      const alpha = Math.atan2(dvz, dvx);
      const beta  = Math.acos(Math.min(1, ci.r / d));
      exitAngles[i] = preferCCW ? alpha - beta : alpha + beta;
      arcCCWs[i]    = preferCCW;
    }

    prevExitX = ci.cx + ci.r * Math.cos(exitAngles[i]);
    prevExitZ = ci.cz + ci.r * Math.sin(exitAngles[i]);
  }
  arcCCWs[N - 1] = N > 1 ? arcCCWs[N - 2] : true;

  const segs: FlyoverSegment[] = [];

  const ep0x = circles[0].cx + circles[0].r * Math.cos(entryAngles[0]);
  const ep0y = circles[0].cy;
  const ep0z = circles[0].cz + circles[0].r * Math.sin(entryAngles[0]);
  const flyEnd0 = new THREE.Vector3(ep0x, ep0y, ep0z);
  const flyDist0 = initialCamPos.distanceTo(flyEnd0);
  const flyDur0 = Math.max(0.5, flyDist0 / (FLYOVER_BASE_SPEED * speedMult));
  const lookC0 = new THREE.Vector3(circles[0].cx, circles[0].node.height, circles[0].cz);
  segs.push({
    type: 'fly', duration: flyDur0, nodeIdx: 0,
    arcCx: 0, arcCy: 0, arcCz: 0, arcRadius: 0, arcStartAngle: 0, arcEndAngle: 0, arcCCW: true,
    flyStart: initialCamPos.clone(), flyEnd: flyEnd0,
    lookAtTarget: lookC0.clone(),
  });

  for (let i = 0; i < N; i++) {
    const ci = circles[i];
    const isLast = i === N - 1;
    const arcEnd = isLast
      ? (arcCCWs[i] ? entryAngles[i] + Math.PI : entryAngles[i] - Math.PI)
      : exitAngles[i];
    const arcSweep = arcCCWs[i]
      ? normalizeAngle(arcEnd - entryAngles[i])
      : normalizeAngle(entryAngles[i] - arcEnd);
    const arcDur = Math.max(0.3, arcSweep * ci.r / (FLYOVER_BASE_SPEED * speedMult));
    const lookArcTarget = isLast
      ? new THREE.Vector3(ci.cx, ci.node.height, ci.cz)
      : new THREE.Vector3(circles[i + 1].cx, circles[i + 1].node.height, circles[i + 1].cz);
    segs.push({
      type: 'arc', duration: arcDur, nodeIdx: i,
      arcCx: ci.cx, arcCy: ci.cy, arcCz: ci.cz,
      arcRadius: ci.r, arcStartAngle: entryAngles[i], arcEndAngle: arcEnd, arcCCW: arcCCWs[i],
      flyStart: new THREE.Vector3(), flyEnd: new THREE.Vector3(),
      lookAtTarget: lookArcTarget,
    });

    if (!isLast) {
      const exitX = ci.cx + ci.r * Math.cos(exitAngles[i]);
      const exitY = ci.cy;
      const exitZ = ci.cz + ci.r * Math.sin(exitAngles[i]);
      const ci1 = circles[i + 1];
      const entX1 = ci1.cx + ci1.r * Math.cos(entryAngles[i + 1]);
      const entY1 = ci1.cy;
      const entZ1 = ci1.cz + ci1.r * Math.sin(entryAngles[i + 1]);
      const flyDist = Math.sqrt((entX1 - exitX) ** 2 + (entY1 - exitY) ** 2 + (entZ1 - exitZ) ** 2);
      const flyDur = Math.max(0.5, flyDist / (FLYOVER_BASE_SPEED * speedMult));
      segs.push({
        type: 'fly', duration: flyDur, nodeIdx: i + 1,
        arcCx: 0, arcCy: 0, arcCz: 0, arcRadius: 0, arcStartAngle: 0, arcEndAngle: 0, arcCCW: true,
        flyStart: new THREE.Vector3(exitX, exitY, exitZ),
        flyEnd:   new THREE.Vector3(entX1, entY1, entZ1),
        lookAtTarget: lookArcTarget.clone(),
      });
    }
  }
  return segs;
}

function updateFlyoverOverheadLabels(
  buildingMap: Map<string, BuildingEntry>,
  svg: SVGSVGElement,
  currentId: string | null, currentOpacity: number,
  nextId: string | null, nextOpacity: number,
  darkMode: boolean,
  camera: THREE.PerspectiveCamera,
  W: number, H: number,
  vec: THREE.Vector3,
): void {
  const textFill = darkMode ? "rgba(255,255,255,0.96)" : "rgba(14,14,20,0.96)";
  const pillBg   = darkMode ? "rgba(10,10,22,0.84)"   : "rgba(255,255,255,0.90)";
  const fontBase = "'DM Mono',monospace";
  const DIAG_X = 26, DIAG_Y = 54, HORIZ = 62, padX = 8, padY = 4;
  let html = "";

  const renderLabel = (id: string, isMain: boolean, opacity: number) => {
    if (opacity <= 0.01) return;
    const e = buildingMap.get(id);
    if (!e) return;
    vec.set(e.node.cx, e.node.height, e.node.cz);
    vec.project(camera);
    if (vec.z > 1) return;
    const sx = (vec.x + 1) / 2 * W;
    const sy = (-vec.y + 1) / 2 * H;
    if (sx < -300 || sx > W + 300 || sy < -300 || sy > H + 300) return;
    const facingRight = true;
    const ex = sx + (facingRight ? DIAG_X : -DIAG_X);
    const ey = sy - DIAG_Y;
    const horizEnd = facingRight ? ex + HORIZ : ex - HORIZ;
    const { name, color } = e.node;
    const fs = isMain ? 12 : 11;
    const fw = isMain ? "600" : "400";
    const sw = isMain ? "1.7" : "1.3";
    const approxTW = Math.max(44, name.length * (isMain ? 7.6 : 7.1));
    const pillW = approxTW + padX * 2;
    const pillH = fs + padY * 2;
    const rectX = facingRight ? horizEnd : horizEnd - pillW;
    const rectY = ey - pillH / 2;
    const textX = facingRight ? horizEnd + padX : horizEnd - padX;
    const anchor = facingRight ? "start" : "end";
    html += `<circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="2.5" fill="${color}" opacity="${(0.92*opacity).toFixed(2)}"/>`;
    html += `<line x1="${sx.toFixed(1)}" y1="${sy.toFixed(1)}" x2="${ex.toFixed(1)}" y2="${ey.toFixed(1)}" stroke="${color}" stroke-width="${sw}" opacity="${(0.88*opacity).toFixed(2)}"/>`;
    html += `<line x1="${ex.toFixed(1)}" y1="${ey.toFixed(1)}" x2="${horizEnd.toFixed(1)}" y2="${ey.toFixed(1)}" stroke="${color}" stroke-width="${sw}" opacity="${(0.88*opacity).toFixed(2)}"/>`;
    html += `<rect x="${rectX.toFixed(1)}" y="${rectY.toFixed(1)}" width="${pillW.toFixed(1)}" height="${pillH.toFixed(1)}" rx="3" ry="3" fill="${pillBg}" opacity="${(0.93*opacity).toFixed(2)}"/>`;
    html += `<text x="${textX.toFixed(1)}" y="${ey.toFixed(1)}" font-family="${fontBase}" font-size="${fs}" font-weight="${fw}" fill="${textFill}" text-anchor="${anchor}" dominant-baseline="middle" opacity="${opacity.toFixed(2)}">${escSvg(name)}</text>`;
  };

  if (currentId) renderLabel(currentId, true, currentOpacity);
  if (nextId && nextId !== currentId) renderLabel(nextId, false, nextOpacity);
  svg.innerHTML = html;
}

function toNodeDetail(node: CityNode): NodeDetail {
  return {
    id: node.id,
    name: node.name,
    createdBy: node.createdBy,
    createdTime: node.createdTime,
    databaseName: node.databaseName,
    databaseId: node.databaseId,
    notionUrl: node.notionUrl,
    fieldValues: node.fieldValues,
  };
}

// ─── Shaders ──────────────────────────────────────────────────────────────────

const FOG_GLSL = /* glsl */`
  uniform vec3 uFogColor;
  uniform float uFogNear;
  uniform float uFogFar;
  float fogFactor(float dist) { return smoothstep(uFogNear, uFogFar, dist); }
`;

// One instanced box per building; the same vertex stage drives both the glass
// fill and the wireframe edges. Buildings rise from the ground (and glide to new
// lots after a re-layout) using per-instance origin + delay attributes.
const BUILDING_VERT = /* glsl */`
  uniform float uMorphTime;
  attribute vec3 aColor;
  attribute vec4 aState;   // fill, edge, selected, connected
  attribute float aHover;
  attribute vec4 aAnim;    // prevCx, prevCz, prevHeight, delay (s)
  attribute float aSeed;
  varying vec3 vLocal;
  varying vec3 vObjNormal;
  varying vec3 vWorld;
  varying vec3 vColor;
  varying vec4 vState;
  varying float vHover;
  varying vec2 vDims;
  varying float vSeed;
  varying float vViewDist;
  void main() {
    float w = instanceMatrix[0][0];
    float hFinal = instanceMatrix[1][1];
    vec2 cFinal = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
    float g = clamp((uMorphTime - aAnim.w) / ${GROW_DURATION.toFixed(2)}, 0.0, 1.0);
    // ease-out-back: a little overshoot as the tower tops out
    float c1 = 1.3;
    float gm = g - 1.0;
    float e = 1.0 + (c1 + 1.0) * gm * gm * gm + c1 * gm * gm;
    float h = max(0.001, mix(aAnim.z, hFinal, e));
    vec2 c = mix(aAnim.xy, cFinal, clamp(e, 0.0, 1.0));
    vec3 world = vec3(c.x + position.x * w, position.y * h, c.y + position.z * w);
    vLocal = position;
    vObjNormal = normal;
    vWorld = world;
    vColor = aColor;
    vState = aState;
    vHover = aHover;
    vDims = vec2(w, h);
    vSeed = aSeed;
    vec4 mv = viewMatrix * vec4(world, 1.0);
    vViewDist = length(mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

const FACE_GLSL = /* glsl */`
  // Face-local coordinates (0..1) and the face's world size
  void faceInfo(out vec2 coord, out vec2 size, out float side) {
    vec3 n = abs(vObjNormal);
    if (n.y > 0.5) { coord = vLocal.xz + 0.5; size = vec2(vDims.x); side = 0.0; }
    else if (n.x > 0.5) { coord = vec2(vLocal.z + 0.5, vLocal.y); size = vDims; side = 1.0; }
    else { coord = vec2(vLocal.x + 0.5, vLocal.y); size = vDims; side = 1.0; }
  }
`;

const BUILDING_VARYINGS = /* glsl */`
  varying vec3 vLocal;
  varying vec3 vObjNormal;
  varying vec3 vWorld;
  varying vec3 vColor;
  varying vec4 vState;
  varying float vHover;
  varying vec2 vDims;
  varying float vSeed;
  varying float vViewDist;
`;

const BUILDING_EDGE_FRAG = /* glsl */`
  ${BUILDING_VARYINGS}
  ${FOG_GLSL}
  ${FACE_GLSL}
  uniform float uLineWidth;
  uniform float uDark;
  uniform float uTime;
  void main() {
    vec2 coord, size; float side;
    faceInfo(coord, size, side);
    vec2 worldCoord = coord * size;
    vec2 dist = min(worldCoord, size - worldCoord);
    vec2 fw = max(fwidth(worldCoord), vec2(1e-5));
    vec2 px = dist / fw;
    float d = min(px.x, px.y);
    float lw = uLineWidth * (1.0 + 0.6 * vState.z + 0.5 * vHover);
    float line = 1.0 - smoothstep(lw - 0.6, lw + 0.6, d);
    if (line < 0.01) discard;
    float fog = fogFactor(vViewDist);
    float boost = 1.0 + uDark * (0.35 + 0.9 * vState.z + 0.6 * vHover);
    vec3 col = vColor * boost;
    col = mix(col, vec3(1.0), 0.25 * vHover);
    float a = line * min(1.0, vState.y + 0.4 * vHover) * (1.0 - fog * 0.95);
    gl_FragColor = vec4(mix(col, uFogColor, fog * 0.6), a);
    #include <colorspace_fragment>
  }
`;

const BUILDING_FILL_FRAG = /* glsl */`
  ${BUILDING_VARYINGS}
  ${FOG_GLSL}
  ${FACE_GLSL}
  uniform float uDark;
  uniform float uTime;
  uniform vec3 uWindowColor;
  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  void main() {
    vec2 coord, size; float side;
    faceInfo(coord, size, side);
    vec3 viewDir = normalize(cameraPosition - vWorld);
    float fresnel = pow(1.0 - abs(dot(viewDir, vObjNormal)), 2.0);
    float fill = vState.x;
    float alpha = fill * (0.75 + 0.7 * fresnel);
    vec3 col = vColor;

    // Roofs read slightly more solid
    alpha *= mix(1.0, 1.6, 1.0 - side);

    // Procedural windows on the walls
    vec2 wc = coord * size / vec2(0.42, 0.56);
    vec2 cell = floor(wc);
    vec2 f = fract(wc);
    float pane = step(0.24, f.x) * step(f.x, 0.76) * step(0.26, f.y) * step(f.y, 0.74);
    float margin = step(0.45, coord.y * size.y) * step(0.25, (1.0 - coord.y) * size.y)
                 * step(0.15, coord.x * size.x) * step(0.15, (1.0 - coord.x) * size.x);
    float facing = floor(vObjNormal.x * 2.0 + vObjNormal.z * 3.0 + 3.0);
    float rnd = hash12(cell + vec2(vSeed * 173.0 + facing * 17.0, vSeed * 59.0));
    float lit = step(mix(0.72, 0.55, vState.z + vState.w), rnd);
    vec2 cellPx = fwidth(wc);
    float lod = 1.0 - smoothstep(0.18, 0.5, max(cellPx.x, cellPx.y));
    float flicker = 0.85 + 0.15 * sin(uTime * (0.5 + rnd * 1.5) + rnd * 60.0);
    float win = pane * margin * side * lod * lit * flicker;
    float relevance = clamp(fill / 0.12, 0.0, 2.2);
    if (uDark > 0.5) {
      vec3 warm = mix(uWindowColor, vColor, 0.35);
      col = mix(col, warm * 1.6, win);
      alpha += win * 0.7 * min(relevance, 1.3);
    } else {
      col = mix(col, vColor * 0.55, win);
      alpha += win * 0.16 * min(relevance, 1.3);
    }

    // Selected tower: a scan band sweeping up the facade
    float y = coord.y * size.y;
    float bandY = mod(uTime * 3.0, size.y + 3.0) - 1.0;
    float band = exp(-pow((y - bandY) * 1.6, 2.0)) * vState.z * side;
    col = mix(col, vec3(1.0), band * 0.5);
    alpha += band * 0.35;

    // Hover lift
    alpha += vHover * 0.08;

    float fog = fogFactor(vViewDist);
    alpha *= 1.0 - fog * 0.95;
    if (alpha < 0.004) discard;
    gl_FragColor = vec4(mix(col, uFogColor, fog * 0.6), min(alpha, 0.95));
    #include <colorspace_fragment>
  }
`;

// Sky dome — drawn explicitly (not via clear colour) so it shares the same
// colour pipeline as everything else with or without post-processing.
const SKY_VERT = /* glsl */`
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww; // pin to the far plane
  }
`;

const SKY_FRAG = /* glsl */`
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  varying vec3 vDir;
  void main() {
    float h = clamp(vDir.y, 0.0, 1.0);
    vec3 col = mix(uHorizon, uZenith, pow(h, 0.45));
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

const GROUND_VERT = /* glsl */`
  varying vec3 vWorld;
  varying float vViewDist;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vec4 mv = viewMatrix * w;
    vViewDist = length(mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

const GROUND_FRAG = /* glsl */`
  ${FOG_GLSL}
  uniform vec3 uBg;
  uniform vec3 uGrid;
  uniform vec3 uGlow;
  uniform vec2 uCenter;
  uniform float uRadius;
  uniform float uDark;
  varying vec3 vWorld;
  varying float vViewDist;
  float gridLine(vec2 p, float scale) {
    vec2 q = p / scale;
    vec2 g = abs(fract(q - 0.5) - 0.5) / max(fwidth(q), vec2(1e-5));
    return 1.0 - min(min(g.x, g.y), 1.0);
  }
  void main() {
    float r = length(vWorld.xz - uCenter);
    float near = 1.0 - smoothstep(uRadius * 1.2, uRadius * 3.2, r);
    float minor = gridLine(vWorld.xz, 2.0);
    float major = gridLine(vWorld.xz, 16.0);
    float g = max(minor * 0.55, major) * near;
    vec3 col = mix(uBg, uGrid, g);
    // Soft city glow pooled beneath the districts
    float glow = exp(-pow(r / max(uRadius * 1.1, 1.0), 2.0));
    col += uGlow * glow * mix(0.035, 0.06, uDark);
    float fog = fogFactor(vViewDist);
    gl_FragColor = vec4(mix(col, uFogColor, fog), 1.0);
    #include <colorspace_fragment>
  }
`;

// District plate: a rounded-rect footprint under each age cohort
const PLATE_FRAG = /* glsl */`
  ${FOG_GLSL}
  uniform vec2 uHalf;
  uniform vec3 uTint;
  uniform float uOpacity;
  varying vec2 vUv;
  varying float vViewDist;
  float sdRoundBox(vec2 p, vec2 b, float r) {
    vec2 q = abs(p) - b + r;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
  }
  void main() {
    vec2 p = (vUv - 0.5) * 2.0 * uHalf;
    float d = sdRoundBox(p, uHalf - 0.5, 6.0);
    float aa = fwidth(d);
    float inside = 1.0 - smoothstep(-aa, aa, d);
    float border = 1.0 - smoothstep(0.0, aa * 1.5, abs(d + 0.4));
    float a = (inside * 0.5 + border * 0.9) * uOpacity;
    float fog = fogFactor(vViewDist);
    a *= 1.0 - fog;
    if (a < 0.003) discard;
    gl_FragColor = vec4(uTint, a);
    #include <colorspace_fragment>
  }
`;

const PLATE_VERT = /* glsl */`
  varying vec2 vUv;
  varying float vViewDist;
  void main() {
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vViewDist = length(mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

// Screen-space ribbons for connection arcs (constant pixel width)
const ARC_VERT = /* glsl */`
  uniform vec2 uResolution;
  uniform float uWidth;
  attribute vec3 aA;
  attribute vec3 aB;
  attribute float aSide;
  attribute float aEnd;
  attribute float aT;
  attribute vec3 aColor;
  varying float vSide;
  varying float vT;
  varying vec3 vColor;
  varying float vViewDist;
  void main() {
    vec4 mvA = modelViewMatrix * vec4(aA, 1.0);
    vec4 mvB = modelViewMatrix * vec4(aB, 1.0);
    vec4 cA = projectionMatrix * mvA;
    vec4 cB = projectionMatrix * mvB;
    vec2 sA = cA.xy / max(cA.w, 1e-4) * uResolution * 0.5;
    vec2 sB = cB.xy / max(cB.w, 1e-4) * uResolution * 0.5;
    vec2 dir = sB - sA;
    dir = length(dir) < 1e-4 ? vec2(1.0, 0.0) : normalize(dir);
    vec2 n = vec2(-dir.y, dir.x);
    vec4 c = aEnd < 0.5 ? cA : cB;
    vec4 mv = aEnd < 0.5 ? mvA : mvB;
    c.xy += n * aSide * uWidth / uResolution * c.w;
    gl_Position = c;
    vSide = aSide;
    vT = aT;
    vColor = aColor;
    vViewDist = length(mv.xyz);
  }
`;

const ARC_FRAG = /* glsl */`
  ${FOG_GLSL}
  uniform float uTime;
  uniform float uDark;
  uniform float uReveal;
  varying float vSide;
  varying float vT;
  varying vec3 vColor;
  varying float vViewDist;
  void main() {
    if (vT > uReveal) discard;
    float edge = 1.0 - smoothstep(0.4, 1.0, abs(vSide));
    float pulse = exp(-pow((fract(vT * 1.2 - uTime * 0.5) - 0.5) * 6.0, 2.0));
    vec3 col = mix(vColor, uDark > 0.5 ? vec3(1.0) : vColor * 0.55, pulse * 0.6);
    col *= 1.0 + uDark * 0.6;
    float a = edge * (0.6 + 0.4 * pulse);
    a *= 1.0 - fogFactor(vViewDist) * 0.9;
    if (a < 0.004) discard;
    gl_FragColor = vec4(col, a);
    #include <colorspace_fragment>
  }
`;

const BEACON_VERT = /* glsl */`
  varying vec2 vUv;
  varying float vFacing;
  void main() {
    vUv = uv;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vec3 n = normalize(mat3(modelMatrix) * normal);
    vec3 v = normalize(cameraPosition - world.xyz);
    vFacing = abs(dot(normalize(n.xz), normalize(v.xz)));
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const BEACON_FRAG = /* glsl */`
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uOpacity;
  varying vec2 vUv;
  varying float vFacing;
  void main() {
    float fade = pow(1.0 - vUv.y, 2.2);
    float core = pow(vFacing, 3.0);          // bright core, soft edges
    float shimmer = 0.75 + 0.25 * sin(uTime * 2.4 - vUv.y * 18.0);
    float a = fade * core * shimmer * uOpacity;
    if (a < 0.003) discard;
    gl_FragColor = vec4(uColor, a);
    #include <colorspace_fragment>
  }
`;

const RIPPLE_FRAG = /* glsl */`
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uOpacity;
  uniform float uInner;
  varying vec2 vUv;
  void main() {
    float r = length(vUv - 0.5) * 2.0;
    float a = 0.0;
    for (int i = 0; i < 2; i++) {
      float ph = fract(uTime * 0.45 + float(i) * 0.5);
      float rr = mix(uInner, 1.0, ph);
      a += (1.0 - smoothstep(0.0, 0.035, abs(r - rr))) * (1.0 - ph);
    }
    a *= uOpacity;
    if (a < 0.003) discard;
    gl_FragColor = vec4(uColor, a);
    #include <colorspace_fragment>
  }
`;

// ─── Component ────────────────────────────────────────────────────────────────

export function CityCanvas({
  graph, onSelectNode, selectedNodeId,
  darkMode = false, firstPerson = false, onExitFirstPerson,
  showLabelsFP = true, showLabelsOverhead = false, showClickLabels = true,
  flyover = false, flyoverLabelMode = 'none',
  flyoverSpeedMult = 1.0, flyoverArcHeightMult = 1.0,
  flyoverCameraHeightOffset = 1.5,
  onExitFlyover,
  fitSceneTrigger = 0,
  jumpEnabled = true,
  webEnabled = false,
  showConnectors = true,
  glow = true,
  focusRequest = null,
  panelOpen = false,
}: Props) {
  const mountRef        = useRef<HTMLDivElement>(null);
  const minimapRef      = useRef<HTMLCanvasElement>(null);
  const stateRef        = useRef<SceneState | null>(null);
  const onSelectRef     = useRef(onSelectNode);
  const onExitFPRef     = useRef(onExitFirstPerson);
  const onExitFlyoverRef = useRef(onExitFlyover);
  const jumpEnabledRef  = useRef(jumpEnabled);
  const webEnabledRef   = useRef(webEnabled);
  const selectedIdRef   = useRef(selectedNodeId);
  const initialDarkRef  = useRef(darkMode);
  useEffect(() => { onSelectRef.current      = onSelectNode; },      [onSelectNode]);
  useEffect(() => { onExitFPRef.current      = onExitFirstPerson; }, [onExitFirstPerson]);
  useEffect(() => { onExitFlyoverRef.current = onExitFlyover; },     [onExitFlyover]);
  useEffect(() => { jumpEnabledRef.current   = jumpEnabled; },       [jumpEnabled]);
  useEffect(() => { webEnabledRef.current    = webEnabled; },        [webEnabled]);
  useEffect(() => { selectedIdRef.current    = selectedNodeId; },    [selectedNodeId]);

  // ── Scene init (once) ────────────────────────────────────────────────────
  useEffect(() => {
    const mount = mountRef.current;
    const minimap = minimapRef.current;
    if (!mount || !minimap) return;

    const W0 = mount.clientWidth;
    const H0 = mount.clientHeight;

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setSize(W0, H0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);
    renderer.domElement.style.display = "block";

    // SVG overlay for overhead click-labels
    const labelSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg") as SVGSVGElement;
    labelSvg.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;overflow:visible;";
    mount.appendChild(labelSvg);

    // Hover tooltip
    const tooltip = document.createElement("div");
    tooltip.style.cssText = [
      "position:absolute", "left:0", "top:0", "pointer-events:none", "z-index:5",
      "background:var(--panel-bg)", "backdrop-filter:blur(12px)", "border:1px solid var(--border-default)",
      "border-radius:8px", "padding:6px 10px", "box-shadow:var(--shadow-md)", "opacity:0",
      "transition:opacity 0.12s ease", "max-width:280px", "will-change:transform",
    ].join(";");
    mount.appendChild(tooltip);

    const scene  = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, W0 / H0, 0.1, 2000);
    camera.position.set(0, 22, 32);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping  = true;
    controls.dampingFactor  = 0.08;
    controls.minPolarAngle  = Math.PI * 0.05;
    controls.maxPolarAngle  = Math.PI * 0.48;
    controls.minDistance    = 2;
    controls.maxDistance    = 200;
    controls.screenSpacePanning = false;
    controls.zoomToCursor   = true;

    // ── Post-processing (bloom in dark mode) ──
    const composer = new EffectComposer(renderer);
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(W0, H0);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(W0, H0), 0.45, 0.4, 0.32);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());

    // ── Shared uniforms ──
    const uTime = { value: 0 };
    const uMorphTime = { value: 100 };
    const uDark = { value: 0 };
    const uFogColor = { value: new THREE.Color() };
    const uFogNear = { value: 120 };
    const uFogFar = { value: 600 };
    const uResolution = { value: new THREE.Vector2(W0 * renderer.getPixelRatio(), H0 * renderer.getPixelRatio()) };
    const fogUniforms = { uFogColor, uFogNear, uFogFar };

    // ── Sky ──
    const skyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      uniforms: { uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() } },
      side: THREE.BackSide, depthWrite: false,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16), skyMat);
    sky.renderOrder = -2;
    sky.frustumCulled = false;
    scene.add(sky);

    // ── Ground ──
    const groundGeo = new THREE.PlaneGeometry(1, 1);
    const groundMat = new THREE.ShaderMaterial({
      vertexShader: GROUND_VERT,
      fragmentShader: GROUND_FRAG,
      uniforms: {
        ...fogUniforms, uDark,
        uBg: { value: new THREE.Color() },
        uGrid: { value: new THREE.Color() },
        uGlow: { value: new THREE.Color() },
        uCenter: { value: new THREE.Vector2() },
        uRadius: { value: 60 },
      },
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.05; // clearance below building bases (y = 0) to avoid z-fighting
    ground.scale.set(4000, 4000, 1);
    ground.name = "ground";
    ground.renderOrder = -1;
    scene.add(ground);

    // ── Building materials (shared across rebuilds) ──
    const fillMat = new THREE.ShaderMaterial({
      vertexShader: BUILDING_VERT,
      fragmentShader: BUILDING_FILL_FRAG,
      uniforms: { ...fogUniforms, uMorphTime, uDark, uTime, uWindowColor: { value: new THREE.Color("#ffd7a0") } },
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    const edgeMat = new THREE.ShaderMaterial({
      vertexShader: BUILDING_VERT,
      fragmentShader: BUILDING_EDGE_FRAG,
      uniforms: { ...fogUniforms, uMorphTime, uDark, uTime, uLineWidth: { value: 1.0 * renderer.getPixelRatio() } },
      transparent: true, depthWrite: true, side: THREE.DoubleSide,
    });

    const arcMat = new THREE.ShaderMaterial({
      vertexShader: ARC_VERT,
      fragmentShader: ARC_FRAG,
      uniforms: {
        ...fogUniforms, uResolution, uTime, uDark,
        uWidth: { value: 2.4 * renderer.getPixelRatio() },
        uReveal: { value: 0 },
      },
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });

    const beaconMat = new THREE.ShaderMaterial({
      vertexShader: BEACON_VERT,
      fragmentShader: BEACON_FRAG,
      uniforms: { uTime, uColor: { value: new THREE.Color() }, uOpacity: { value: 0.3 } },
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1, 32, 1, true).translate(0, 0.5, 0), beaconMat);
    beacon.visible = false;
    beacon.renderOrder = 4;
    scene.add(beacon);

    const rippleMat = new THREE.ShaderMaterial({
      vertexShader: BEACON_VERT,
      fragmentShader: RIPPLE_FRAG,
      uniforms: { uTime, uColor: { value: new THREE.Color() }, uOpacity: { value: 0.8 }, uInner: { value: 0.2 } },
      transparent: true, depthWrite: false, depthTest: false,
    });
    const ripple = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), rippleMat);
    ripple.rotation.x = -Math.PI / 2;
    ripple.visible = false;
    ripple.renderOrder = GROUND_DECAL_ORDER.ripple;
    scene.add(ripple);

    // ── Per-rebuild content ──
    const cityGroup = new THREE.Group();
    scene.add(cityGroup);
    const unitBox = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);

    let fillMesh: THREE.InstancedMesh | null = null;
    let edgeMesh: THREE.InstancedMesh | null = null;
    let stateAttr: THREE.InstancedBufferAttribute | null = null;
    let hoverAttr: THREE.InstancedBufferAttribute | null = null;
    let stateCur = new Float32Array(0);
    let stateTgt = new Float32Array(0);
    let hoverCur = new Float32Array(0);
    let hoverTgt = new Float32Array(0);
    let grid = new BuildingGrid([]);
    let streetGroup = new THREE.Group();
    let districtGroup = new THREE.Group();
    let districtLabelPoints: THREE.Vector3[] = [];
    let arcMesh: THREE.Mesh | null = null;
    let cityCenter = new THREE.Vector2();
    let cityRadius = 40;
    let morphStart = performance.now() / 1000 - 100;
    let hadBuildings = false;
    let minimapBase: HTMLCanvasElement | null = null;
    let mapBounds = { minX: 0, minZ: 0, scale: 1 };
    let hoveredIndex = -1;
    let lastPointer: { x: number; y: number } | null = null;
    let hoverDirty = false;
    let theme: Theme = { dark: false, bg: new THREE.Color(), grid: new THREE.Color(), accent: new THREE.Color() };

    // ── Label sprite cache (LRU) ──
    const labelCache = new Map<string, THREE.Sprite>();
    const labelGroup = new THREE.Group();
    scene.add(labelGroup);
    function getLabel(entry: BuildingEntry): THREE.Sprite {
      let sp = labelCache.get(entry.node.id);
      if (sp) {
        labelCache.delete(entry.node.id);
        labelCache.set(entry.node.id, sp); // refresh LRU order
      } else {
        sp = makeLabelSprite(entry.node.name, BUILDING_BASE * entry.node.widthScale, theme.dark);
        labelCache.set(entry.node.id, sp);
        labelGroup.add(sp);
        if (labelCache.size > LABEL_CACHE_MAX) {
          const [oldId, old] = labelCache.entries().next().value as [string, THREE.Sprite];
          labelCache.delete(oldId);
          labelGroup.remove(old);
          old.material.map?.dispose();
          old.material.dispose();
        }
      }
      const n = entry.node;
      sp.position.set(n.cx, n.height / 2, n.cz);
      sp.scale.setScalar(BUILDING_BASE * n.widthScale * 0.82);
      return sp;
    }
    function clearLabels() {
      for (const sp of labelCache.values()) {
        labelGroup.remove(sp);
        sp.material.map?.dispose();
        sp.material.dispose();
      }
      labelCache.clear();
    }
    const visibleLabels = new Set<THREE.Sprite>();

    // ── Theme ──
    function applyTheme(dark: boolean) {
      const css = getComputedStyle(document.documentElement);
      theme = {
        dark,
        bg: new THREE.Color(dark ? 0x1a1a1a : 0xf7f3ed),
        grid: new THREE.Color(dark ? 0x2a2a2e : 0xe5ded2),
        accent: new THREE.Color(css.getPropertyValue("--accent-warm").trim() || "#d97757"),
      };
      renderer.setClearColor(theme.bg);
      skyMat.uniforms.uZenith.value.copy(theme.bg).multiplyScalar(dark ? 0.82 : 1.0);
      skyMat.uniforms.uHorizon.value.copy(theme.bg).lerp(theme.accent, dark ? 0.07 : 0.04);
      uDark.value = dark ? 1 : 0;
      // Fog fades into the horizon colour so the floor meets the sky without a seam
      uFogColor.value.copy(skyMat.uniforms.uHorizon.value);
      groundMat.uniforms.uBg.value.copy(theme.bg);
      groundMat.uniforms.uGrid.value.copy(theme.grid);
      groundMat.uniforms.uGlow.value.copy(theme.accent);
      beaconMat.uniforms.uOpacity.value = dark ? 0.22 : 0.2;
      beaconMat.blending = dark ? THREE.AdditiveBlending : THREE.NormalBlending;
      beaconMat.needsUpdate = true;
      const s = stateRef.current;
      if (s) s.darkMode = dark;
      // Theme-dependent geometry
      clearLabels();
      rebuildStreets(currentNodes);
      rebuildDistricts(currentNodes);
      renderMinimapBase(currentNodes);
    }

    // ── Rebuild city from graph ──
    let currentNodes: CityNode[] = [];
    const buildingMap = new Map<string, BuildingEntry>();
    const adjacency = new Map<string, Set<string>>();

    function rebuildStreets(nodes: CityNode[]) {
      const wasVisible = streetGroup.visible;
      cityGroup.remove(streetGroup);
      disposeGroup(streetGroup);
      streetGroup = buildStreets(nodes, theme.dark);
      streetGroup.traverse((o) => {
        const line = o as THREE.Line;
        if (!line.isLine) return;
        (line.material as THREE.Material).depthTest = false;
        line.renderOrder = GROUND_DECAL_ORDER.street;
      });
      streetGroup.visible = wasVisible;
      cityGroup.add(streetGroup);
      const s = stateRef.current;
      if (s) streetGroup.visible = s.fpActive;
    }

    function rebuildDistricts(nodes: CityNode[]) {
      cityGroup.remove(districtGroup);
      disposeGroup(districtGroup);
      districtGroup = new THREE.Group();
      districtLabelPoints = [];
      cityGroup.add(districtGroup);
      for (let c = 0; c < 3; c++) {
        const members = nodes.filter((n) => n.cohort === c);
        if (members.length === 0) continue;
        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
        for (const n of members) {
          const hw = (n.widthScale * BUILDING_BASE) / 2;
          minX = Math.min(minX, n.cx - hw); maxX = Math.max(maxX, n.cx + hw);
          minZ = Math.min(minZ, n.cz - hw); maxZ = Math.max(maxZ, n.cz + hw);
        }
        const pad = CELL_SIZE * 0.9;
        minX -= pad; maxX += pad; minZ -= pad; maxZ += pad;
        const w = maxX - minX, d = maxZ - minZ;
        const plateMat = new THREE.ShaderMaterial({
          vertexShader: PLATE_VERT,
          fragmentShader: PLATE_FRAG,
          uniforms: {
            ...fogUniforms,
            uHalf: { value: new THREE.Vector2(w / 2, d / 2) },
            uTint: { value: theme.dark ? new THREE.Color(0xffffff) : new THREE.Color(0x8b7864) },
            uOpacity: { value: theme.dark ? 0.035 : 0.07 },
          },
          transparent: true, depthWrite: false, depthTest: false,
        });
        const plate = new THREE.Mesh(new THREE.PlaneGeometry(w, d), plateMat);
        plate.rotation.x = -Math.PI / 2;
        plate.position.set((minX + maxX) / 2, 0.002, (minZ + maxZ) / 2);
        plate.renderOrder = GROUND_DECAL_ORDER.plate;
        districtGroup.add(plate);

        // Name the district on its outward-facing edge so neighbours never cover it
        const label = makeDistrictLabel(DISTRICT_NAMES[c], members.length, theme.dark);
        const labelW = THREE.MathUtils.clamp(Math.min(w, d) * 0.6, 10, 60);
        label.scale.set(labelW, labelW, 1);
        const px = (minX + maxX) / 2, pz = (minZ + maxZ) / 2;
        const ox = px - cityCenter.x, oz = pz - cityCenter.y;
        const gap = labelW * 0.12 + 1.5;
        if (Math.abs(ox) > Math.abs(oz)) {
          label.position.set(ox > 0 ? maxX + labelW * 0.55 : minX - labelW * 0.55, 0.02, pz);
        } else {
          label.position.set(px, 0.02, oz > 0 ? maxZ + gap : minZ - gap);
        }
        const halfW = labelW / 2, halfD = labelW * 0.1;
        districtLabelPoints.push(
          new THREE.Vector3(label.position.x - halfW, 0, label.position.z - halfD),
          new THREE.Vector3(label.position.x + halfW, 0, label.position.z + halfD),
        );
        districtGroup.add(label);
      }
    }

    function renderMinimapBase(nodes: CityNode[]) {
      if (nodes.length === 0) { minimapBase = null; return; }
      const dpr = Math.min(window.devicePixelRatio, 2);
      const size = MINIMAP_SIZE * dpr;
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const n of nodes) {
        minX = Math.min(minX, n.cx); maxX = Math.max(maxX, n.cx);
        minZ = Math.min(minZ, n.cz); maxZ = Math.max(maxZ, n.cz);
      }
      const span = Math.max(maxX - minX, maxZ - minZ) + CELL_SIZE * 4;
      const scale = (size * 0.92) / span;
      const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
      mapBounds = { minX: cx - size / 2 / scale, minZ: cz - size / 2 / scale, scale };
      const c = document.createElement("canvas");
      c.width = c.height = size;
      const ctx = c.getContext("2d")!;
      for (const n of nodes) {
        const w = Math.max(1.2 * dpr, n.widthScale * BUILDING_BASE * scale);
        const x = (n.cx - mapBounds.minX) * scale, y = (n.cz - mapBounds.minZ) * scale;
        ctx.globalAlpha = theme.dark ? 0.85 : 0.75;
        ctx.fillStyle = n.color;
        ctx.fillRect(x - w / 2, y - w / 2, w, w);
      }
      minimapBase = c;
    }

    function rebuild(g: GraphData) {
      const now = performance.now() / 1000;
      const prev = new Map<string, { cx: number; cz: number; h: number }>();
      for (const n of currentNodes) prev.set(n.id, { cx: n.cx, cz: n.cz, h: n.height });

      const nodes = computeCityLayout(g);
      currentNodes = nodes;

      // Dispose old instanced meshes
      if (fillMesh) { cityGroup.remove(fillMesh); fillMesh.geometry.dispose(); fillMesh.dispose(); fillMesh = null; }
      if (edgeMesh) { cityGroup.remove(edgeMesh); edgeMesh.dispose(); edgeMesh = null; }
      hoveredIndex = -1;
      tooltip.style.opacity = "0";

      buildingMap.clear();
      nodes.forEach((n, i) => buildingMap.set(n.id, { node: n, index: i }));
      adjacency.clear();
      for (const n of nodes) adjacency.set(n.id, new Set());
      for (const e of g.edges) {
        adjacency.get(e.source)?.add(e.target);
        adjacency.get(e.target)?.add(e.source);
      }
      grid = new BuildingGrid(nodes);

      // City extents
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const n of nodes) {
        minX = Math.min(minX, n.cx); maxX = Math.max(maxX, n.cx);
        minZ = Math.min(minZ, n.cz); maxZ = Math.max(maxZ, n.cz);
      }
      if (nodes.length > 0) {
        cityCenter = new THREE.Vector2((minX + maxX) / 2, (minZ + maxZ) / 2);
        cityRadius = Math.max(20, Math.hypot(maxX - minX, maxZ - minZ) / 2);
      }
      groundMat.uniforms.uCenter.value.copy(cityCenter);
      groundMat.uniforms.uRadius.value = cityRadius;

      const N = nodes.length;
      if (N > 0) {
        const geo = unitBox.clone();
        const color = new Float32Array(N * 3);
        const anim = new Float32Array(N * 4);
        const seed = new Float32Array(N);
        stateCur = new Float32Array(N * 4);
        stateTgt = new Float32Array(N * 4);
        hoverCur = new Float32Array(N);
        hoverTgt = new Float32Array(N);
        const c = new THREE.Color();
        const firstBuild = prev.size === 0;
        for (let i = 0; i < N; i++) {
          const n = nodes[i];
          c.set(n.color);
          color.set([c.r, c.g, c.b], i * 3);
          const p = prev.get(n.id);
          if (p) {
            anim.set([p.cx, p.cz, p.h, 0], i * 4);
          } else {
            // New tower: rises in place. First build ripples outward from the core.
            const dist = Math.hypot(n.cx - cityCenter.x, n.cz - cityCenter.y) / cityRadius;
            const delay = firstBuild
              ? 0.15 + dist * 1.4 + hashFloat(n.id) * 0.35
              : 0.1 + hashFloat(n.id) * 0.5;
            anim.set([n.cx, n.cz, 0, delay], i * 4);
          }
          seed[i] = hashFloat(n.id + "s");
          stateCur.set(STATE_DEFAULT, i * 4);
          stateTgt.set(STATE_DEFAULT, i * 4);
        }
        geo.setAttribute("aColor", new THREE.InstancedBufferAttribute(color, 3));
        geo.setAttribute("aAnim", new THREE.InstancedBufferAttribute(anim, 4));
        geo.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seed, 1));
        stateAttr = new THREE.InstancedBufferAttribute(stateCur, 4).setUsage(THREE.DynamicDrawUsage);
        hoverAttr = new THREE.InstancedBufferAttribute(hoverCur, 1).setUsage(THREE.DynamicDrawUsage);
        geo.setAttribute("aState", stateAttr);
        geo.setAttribute("aHover", hoverAttr);

        fillMesh = new THREE.InstancedMesh(geo, fillMat, N);
        edgeMesh = new THREE.InstancedMesh(geo, edgeMat, N);
        const m = new THREE.Matrix4();
        for (let i = 0; i < N; i++) {
          const n = nodes[i];
          const w = BUILDING_BASE * n.widthScale;
          m.makeScale(w, n.height, w).setPosition(n.cx, 0, n.cz);
          fillMesh.setMatrixAt(i, m);
        }
        fillMesh.instanceMatrix.needsUpdate = true;
        edgeMesh.instanceMatrix = fillMesh.instanceMatrix;
        fillMesh.computeBoundingSphere();
        fillMesh.frustumCulled = false;
        edgeMesh.frustumCulled = false;
        edgeMesh.renderOrder = 1;
        fillMesh.renderOrder = 2;
        cityGroup.add(edgeMesh);
        cityGroup.add(fillMesh);
      }
      morphStart = now;

      rebuildStreets(nodes);
      rebuildDistricts(nodes);
      renderMinimapBase(nodes);

      const s = stateRef.current;
      if (s) {
        s.buildings = nodes;
        s.graphEdges = g.edges;
        if (s.flyoverActive) {
          s.flyoverActive = false;
          s.controls.enabled = true;
          onExitFlyoverRef.current?.();
        }
        if (s.webAnchor && !s.fpActive) releaseWeb(s);
      }

      // Dynamic camera limits so very large cities still fit
      const fit = computeFitView(camera, controls.target, nodes, controls.minDistance, 1.12, districtLabelPoints);
      if (fit) {
        controls.maxDistance = Math.max(200, fit.distance * 1.8);
        camera.far = Math.max(2000, fit.distance * 6);
        camera.updateProjectionMatrix();
      }

      applySelection(selectedIdRef.current, showConnectorsRef.current);

      if (N > 0 && s && !s.fpActive && !s.flyoverActive) {
        if (!hadBuildings && fit) {
          // Cinematic entrance: start pulled back and drift in while towers rise
          const back = fit.position.clone().sub(fit.target).multiplyScalar(1.35).add(fit.target);
          back.y += fit.distance * 0.15;
          camera.position.copy(back);
          controls.target.copy(fit.target);
          controls.update();
          flyTo(fit.position, fit.target, 2.6);
        } else {
          fitView(true);
        }
      }
      hadBuildings = N > 0;
    }

    // ── Camera animation ──
    function flyTo(pos: THREE.Vector3, target: THREE.Vector3, dur: number) {
      const s = stateRef.current;
      if (!s) return;
      s.camAnim = {
        fromPos: camera.position.clone(), fromTarget: controls.target.clone(),
        toPos: pos.clone(), toTarget: target.clone(),
        start: performance.now() / 1000, dur,
      };
    }

    function fitView(animated: boolean) {
      const fit = computeFitView(camera, controls.target, currentNodes, controls.minDistance, 1.12, districtLabelPoints);
      if (!fit) return;
      if (animated) flyTo(fit.position, fit.target, 1.4);
      else {
        camera.position.copy(fit.position);
        controls.target.copy(fit.target);
        controls.update();
      }
    }

    function focusBuilding(id: string) {
      const s = stateRef.current;
      const entry = buildingMap.get(id);
      if (!s || !entry) return;
      const n = entry.node;
      const w = BUILDING_BASE * n.widthScale;
      if (s.fpActive) {
        // Step out onto the street facing the tower
        s.camAnim = null;
        camera.position.set(n.cx, FP_HEIGHT, n.cz + w / 2 + 6);
        s.fpYaw = 0;
        s.fpPitch = Math.min(0.6, Math.atan2(n.height * 0.6, w / 2 + 6));
        s.fpVelY = 0;
        return;
      }
      if (s.flyoverActive) {
        s.flyoverPendingReroute = id;
        return;
      }
      const target = new THREE.Vector3(n.cx, n.height * 0.5, n.cz);
      const dir = camera.position.clone().sub(controls.target);
      if (dir.lengthSq() < 1e-6) dir.set(0, 0.7, 1);
      dir.normalize();
      if (dir.y < 0.35) { dir.y = 0.35; dir.normalize(); }
      const dist = THREE.MathUtils.clamp(Math.max(w * 7, n.height * 2.4, 16), 12, 90);
      flyTo(target.clone().addScaledVector(dir, dist), target, 1.3);
    }

    // ── Selection ──
    const showConnectorsRef = { current: true };
    let arcRevealStart = 0;
    function applySelection(selectedId: string | null, connectors: boolean) {
      showConnectorsRef.current = connectors;
      const s = stateRef.current;
      if (arcMesh) {
        scene.remove(arcMesh);
        arcMesh.geometry.dispose();
        arcMesh = null;
      }
      beacon.visible = false;
      ripple.visible = false;
      const sel = selectedId ? buildingMap.get(selectedId) : undefined;
      const connected = sel ? adjacency.get(sel.node.id) ?? new Set<string>() : new Set<string>();
      if (s) {
        s.selectedNodeIdForLabels = sel ? sel.node.id : null;
        s.connectedNodeIdsForLabels = new Set([...connected].filter((id) => buildingMap.has(id)));
      }
      for (let i = 0; i < currentNodes.length; i++) {
        const id = currentNodes[i].id;
        const st = !sel ? STATE_DEFAULT
          : id === sel.node.id ? STATE_SELECTED
          : connected.has(id) ? STATE_CONNECTED
          : STATE_DIMMED;
        stateTgt.set(st, i * 4);
      }
      if (!sel) return;

      const n = sel.node;
      const w = BUILDING_BASE * n.widthScale;
      const beamH = Math.max(30, cityRadius * 0.6);
      beacon.scale.set(w * 0.62, beamH, w * 0.62);
      beacon.position.set(n.cx, n.height, n.cz);
      beaconMat.uniforms.uColor.value.set(n.color);
      beacon.visible = true;
      ripple.scale.set(w * 7, w * 7, 1);
      ripple.position.set(n.cx, 0.015, n.cz);
      rippleMat.uniforms.uColor.value.set(n.color);
      rippleMat.uniforms.uInner.value = 0.16;
      ripple.visible = true;

      if (!connectors) return;
      const targets = [...connected].map((id) => buildingMap.get(id)).filter((e): e is BuildingEntry => !!e);
      if (targets.length === 0) return;

      // Roof-to-roof arcs, built as screen-space ribbons
      const S = ARC_SEGMENTS;
      const quads = targets.length * S;
      const aA = new Float32Array(quads * 12), aB = new Float32Array(quads * 12);
      const aSide = new Float32Array(quads * 4), aEnd = new Float32Array(quads * 4), aT = new Float32Array(quads * 4);
      const aColor = new Float32Array(quads * 12);
      const index = new Uint32Array(quads * 6);
      const start = new THREE.Vector3(n.cx, n.height, n.cz);
      const c0 = new THREE.Color(n.color), c1 = new THREE.Color(), cc = new THREE.Color();
      const curve = new THREE.QuadraticBezierCurve3(start, new THREE.Vector3(), new THREE.Vector3());
      const p0 = new THREE.Vector3(), p1 = new THREE.Vector3();
      let q = 0;
      for (const t of targets) {
        const end = new THREE.Vector3(t.node.cx, t.node.height, t.node.cz);
        const span = Math.hypot(end.x - start.x, end.z - start.z);
        curve.v1.set((start.x + end.x) / 2, Math.max(start.y, end.y) + 2 + span * 0.32, (start.z + end.z) / 2);
        curve.v2.copy(end);
        c1.set(t.node.color);
        for (let k = 0; k < S; k++) {
          const t0 = k / S, t1 = (k + 1) / S;
          curve.getPoint(t0, p0);
          curve.getPoint(t1, p1);
          for (let v = 0; v < 4; v++) {
            const vi = q * 4 + v;
            aA.set([p0.x, p0.y, p0.z], vi * 3);
            aB.set([p1.x, p1.y, p1.z], vi * 3);
            const isEnd = v >= 2 ? 1 : 0;
            aEnd[vi] = isEnd;
            aSide[vi] = v % 2 === 0 ? -1 : 1;
            const tt = isEnd ? t1 : t0;
            aT[vi] = tt;
            cc.copy(c0).lerp(c1, tt);
            aColor.set([cc.r, cc.g, cc.b], vi * 3);
          }
          const b = q * 4;
          index.set([b, b + 1, b + 2, b + 1, b + 3, b + 2], q * 6);
          q++;
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(aA, 3));
      geo.setAttribute("aA", new THREE.BufferAttribute(aA, 3));
      geo.setAttribute("aB", new THREE.BufferAttribute(aB, 3));
      geo.setAttribute("aSide", new THREE.BufferAttribute(aSide, 1));
      geo.setAttribute("aEnd", new THREE.BufferAttribute(aEnd, 1));
      geo.setAttribute("aT", new THREE.BufferAttribute(aT, 1));
      geo.setAttribute("aColor", new THREE.BufferAttribute(aColor, 3));
      geo.setIndex(new THREE.BufferAttribute(index, 1));
      arcMesh = new THREE.Mesh(geo, arcMat);
      arcMesh.frustumCulled = false;
      arcMesh.renderOrder = 3;
      scene.add(arcMesh);
      arcRevealStart = performance.now() / 1000;
    }

    // ── Picking ──
    const raycaster = new THREE.Raycaster();
    const mouse     = new THREE.Vector2();
    const pointerDown = { x: 0, y: 0, moved: false, down: false };
    const CLICK_DRAG_THRESHOLD = 5;

    function setRayFromPointer(e: { clientX: number; clientY: number }) {
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width)  *  2 - 1;
      mouse.y = -((e.clientY - rect.top)  / rect.height) *  2 + 1;
      raycaster.setFromCamera(mouse, camera);
    }

    function hitBuilding(): { entry: BuildingEntry; point: THREE.Vector3; distance: number } | null {
      if (!fillMesh) return null;
      const hits = raycaster.intersectObject(fillMesh, false);
      for (const h of hits) {
        if (h.instanceId === undefined) continue;
        const node = currentNodes[h.instanceId];
        if (!node) continue;
        return { entry: buildingMap.get(node.id)!, point: h.point, distance: h.distance };
      }
      return null;
    }

    function hitBuildingFromPointer(e: MouseEvent | PointerEvent): BuildingEntry | null {
      setRayFromPointer(e);
      return hitBuilding()?.entry ?? null;
    }

    function onPointerDown(e: PointerEvent) {
      if (e.button === 0) {
        try {
          renderer.domElement.setPointerCapture(e.pointerId);
        } catch {
          // Ignore transient capture failures; drag detection still works without capture.
        }
      }
      pointerDown.x = e.clientX;
      pointerDown.y = e.clientY;
      pointerDown.moved = false;
      pointerDown.down = true;
      const s = stateRef.current;
      if (s?.camAnim && !s.fpActive && !s.flyoverActive) {
        // User takes the wheel — stop any scripted camera move
        s.camAnim = null;
        controls.enabled = true;
      }
    }

    function onPointerMove(e: PointerEvent) {
      const rect = renderer.domElement.getBoundingClientRect();
      lastPointer = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      hoverDirty = true;
      if (!pointerDown.down || pointerDown.moved) return;
      const dx = e.clientX - pointerDown.x;
      const dy = e.clientY - pointerDown.y;
      if (Math.hypot(dx, dy) > CLICK_DRAG_THRESHOLD) pointerDown.moved = true;
    }

    function onPointerLeave() {
      lastPointer = null;
      hoverDirty = true;
    }

    function onPointerUp(e: PointerEvent) {
      if (e.button !== 0) return;
      pointerDown.down = false;
      if (renderer.domElement.hasPointerCapture(e.pointerId)) {
        renderer.domElement.releasePointerCapture(e.pointerId);
      }
      const s = stateRef.current;
      if (pointerDown.moved) return;

      if (s?.fpActive) {
        if (document.pointerLockElement !== renderer.domElement) {
          try {
            const result = renderer.domElement.requestPointerLock();
            if (result instanceof Promise) result.catch(() => {});
          } catch { /* ignore */ }
          return;
        }
        raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
        const hit = hitBuilding();
        if (hit) onSelectRef.current(toNodeDetail(hit.entry.node));
        else onSelectRef.current(null);
        return;
      }
      if (s?.flyoverActive) {
        const entry = hitBuildingFromPointer(e);
        if (entry) {
          onSelectRef.current(toNodeDetail(entry.node));
          s.flyoverPendingReroute = entry.node.id;
        }
        return;
      }

      const entry = hitBuildingFromPointer(e);
      if (entry) {
        if (entry.node.id === selectedIdRef.current) onSelectRef.current(null);
        else onSelectRef.current(toNodeDetail(entry.node));
        return;
      }

      onSelectRef.current(null);
    }

    function onKeyDown(e: KeyboardEvent) {
      const s = stateRef.current;
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
      if (s?.fpActive) {
        if (e.code === "Space" && s.fpOnGround && jumpEnabledRef.current) {
          s.fpVelY = FP_JUMP_VEL;
          s.fpOnGround = false;
          e.preventDefault();
        }
        if (e.code === "KeyR" && s.webAnchor) {
          releaseWeb(s);
          e.preventDefault();
        }
        s.fpKeys.add(e.code);
      } else if (e.key === "Escape") {
        if (s?.flyoverActive) {
          onExitFlyoverRef.current?.();
        } else {
          onSelectRef.current(null);
        }
      }
    }
    function onKeyUp(e: KeyboardEvent) {
      stateRef.current?.fpKeys.delete(e.code);
    }
    function onBlur() {
      stateRef.current?.fpKeys.clear();
    }

    function onMouseMove(e: MouseEvent) {
      const s = stateRef.current;
      if (!s?.fpActive) return;
      s.fpYaw   -= e.movementX * FP_SENS;
      s.fpPitch -= e.movementY * FP_SENS;
      s.fpPitch  = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, s.fpPitch));
    }

    function onPointerLockChange() {
      if (document.pointerLockElement !== renderer.domElement) {
        const s = stateRef.current;
        if (s?.fpActive) {
          onExitFPRef.current?.();
        }
      }
    }

    // ── Web swing: shoot on right-click, release on R key ──────────────────
    function releaseWeb(s: SceneState) {
      if (s.webLine) {
        scene.remove(s.webLine);
        s.webLine.geometry.dispose();
        (s.webLine.material as THREE.Material).dispose();
        s.webLine = null;
      }
      s.webAnchor = null;
    }

    function onContextMenu(e: MouseEvent) {
      e.preventDefault();
    }

    function onWebShoot(e: MouseEvent) {
      if (e.button !== 2) return;
      const s = stateRef.current;
      if (!s?.fpActive || !webEnabledRef.current) return;

      if (s.webAnchor) {
        releaseWeb(s);
        return;
      }

      raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
      const hit = hitBuilding();
      let anchorPoint: THREE.Vector3 | null = null;

      if (hit && hit.distance <= WEB_SHOOT_RANGE) {
        // Prefer the top of the building as anchor so it swings well
        const topY = hit.entry.node.height;
        anchorPoint = hit.point.y < topY - 0.5
          ? new THREE.Vector3(hit.point.x, topY, hit.point.z)
          : hit.point.clone();
      }

      if (!anchorPoint) return;

      const dist = camera.position.distanceTo(anchorPoint);
      s.webAnchor = anchorPoint;
      s.webLength = dist;

      const fwd = new THREE.Vector3(-Math.sin(s.fpYaw), 0, -Math.cos(s.fpYaw));
      const spd = (s.fpKeys.has("ShiftLeft") || s.fpKeys.has("ShiftRight")) ? FP_SPRINT : FP_SPEED;
      const hasMovement = s.fpKeys.has("KeyW") || s.fpKeys.has("KeyS") || s.fpKeys.has("KeyA") || s.fpKeys.has("KeyD");
      if (hasMovement) {
        s.webVelX = fwd.x * spd;
        s.webVelZ = fwd.z * spd;
      }
      s.fpVelY += WEB_LAUNCH_BOOST;
      s.fpOnGround = false;

      const lineMat = new THREE.LineBasicMaterial({
        color: s.darkMode ? WEB_COLOR_DARK : WEB_COLOR_LIGHT,
        transparent: true,
        opacity: 0.6,
      });
      const lineGeo = new THREE.BufferGeometry().setFromPoints([
        camera.position.clone(),
        anchorPoint,
      ]);
      const line = new THREE.Line(lineGeo, lineMat);
      scene.add(line);
      s.webLine = line;
    }

    renderer.domElement.addEventListener("contextmenu", onContextMenu);
    document.addEventListener("mousedown", onWebShoot);

    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("pointerleave", onPointerLeave);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup",   onKeyUp);
    window.addEventListener("blur",    onBlur);
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("pointerlockchange", onPointerLockChange);

    function onResize() {
      if (!mountRef.current) return;
      const w = mountRef.current.clientWidth;
      const h = mountRef.current.clientHeight;
      if (w === 0 || h === 0) return;
      renderer.setSize(w, h);
      composer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      uResolution.value.set(w * renderer.getPixelRatio(), h * renderer.getPixelRatio());
    }
    const ro = new ResizeObserver(onResize);
    ro.observe(mount);

    // ── Hover ──
    function updateHover(s: SceneState) {
      let next = -1;
      if (s.fpActive) {
        raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
        const hit = hitBuilding();
        if (hit && hit.distance < 60) next = hit.entry.index;
      } else if (!s.flyoverActive && !pointerDown.down && lastPointer) {
        const rect = renderer.domElement.getBoundingClientRect();
        setRayFromPointer({ clientX: lastPointer.x + rect.left, clientY: lastPointer.y + rect.top });
        const hit = hitBuilding();
        if (hit) next = hit.entry.index;
      }
      if (next !== hoveredIndex) {
        if (hoveredIndex >= 0 && hoveredIndex < hoverTgt.length) hoverTgt[hoveredIndex] = 0;
        hoveredIndex = next;
        if (next >= 0) hoverTgt[next] = 1;
        renderer.domElement.style.cursor = next >= 0 && !s.fpActive ? "pointer" : "";
        if (next >= 0 && !s.fpActive) {
          const n = currentNodes[next];
          const degree = adjacency.get(n.id)?.size ?? 0;
          tooltip.innerHTML =
            `<div style="display:flex;align-items:center;gap:7px;font-family:'Geist',sans-serif;font-size:12px;font-weight:500;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">` +
            `<span style="width:7px;height:7px;border-radius:50%;background:${n.color};flex-shrink:0"></span>${escSvg(n.name)}</div>` +
            `<div style="margin-top:3px;font-family:'DM Mono',monospace;font-size:10px;color:var(--text-faint);white-space:nowrap">${escSvg(n.databaseName)} · ${degree} link${degree === 1 ? "" : "s"}</div>`;
          tooltip.style.opacity = "1";
        } else {
          tooltip.style.opacity = "0";
        }
      }
      if (hoveredIndex >= 0 && lastPointer && !s.fpActive) {
        const W = mount!.clientWidth;
        const x = Math.min(lastPointer.x + 16, W - 290);
        tooltip.style.transform = `translate3d(${x}px, ${lastPointer.y + 18}px, 0)`;
      }
    }

    // ── Minimap ──
    const mmCtx = minimap.getContext("2d")!;
    function drawMinimap(s: SceneState) {
      const dpr = Math.min(window.devicePixelRatio, 2);
      const size = MINIMAP_SIZE * dpr;
      if (minimap!.width !== size) { minimap!.width = size; minimap!.height = size; }
      mmCtx.clearRect(0, 0, size, size);
      if (minimapBase) mmCtx.drawImage(minimapBase, 0, 0);
      const { minX, minZ, scale } = mapBounds;
      const toMap = (x: number, z: number) => [(x - minX) * scale, (z - minZ) * scale] as const;
      const sel = s.selectedNodeIdForLabels ? buildingMap.get(s.selectedNodeIdForLabels) : undefined;
      if (sel) {
        const [sx, sy] = toMap(sel.node.cx, sel.node.cz);
        mmCtx.strokeStyle = sel.node.color;
        mmCtx.lineWidth = 1.5 * dpr;
        mmCtx.beginPath();
        mmCtx.arc(sx, sy, (4 + 2 * Math.sin(performance.now() / 250)) * dpr, 0, Math.PI * 2);
        mmCtx.stroke();
      }
      const [px, py] = toMap(camera.position.x, camera.position.z);
      const yaw = s.fpYaw;
      // View cone
      mmCtx.save();
      mmCtx.translate(px, py);
      mmCtx.rotate(-yaw);
      const grad = mmCtx.createRadialGradient(0, 0, 0, 0, 0, 34 * dpr);
      grad.addColorStop(0, theme.dark ? "rgba(255,255,255,0.28)" : "rgba(45,37,32,0.22)");
      grad.addColorStop(1, "rgba(0,0,0,0)");
      mmCtx.fillStyle = grad;
      mmCtx.beginPath();
      mmCtx.moveTo(0, 0);
      mmCtx.arc(0, 0, 34 * dpr, -Math.PI / 2 - 0.55, -Math.PI / 2 + 0.55);
      mmCtx.closePath();
      mmCtx.fill();
      // Player arrow
      mmCtx.fillStyle = `#${theme.accent.getHexString()}`;
      mmCtx.beginPath();
      mmCtx.moveTo(0, -6 * dpr);
      mmCtx.lineTo(4.2 * dpr, 4.5 * dpr);
      mmCtx.lineTo(0, 2.4 * dpr);
      mmCtx.lineTo(-4.2 * dpr, 4.5 * dpr);
      mmCtx.closePath();
      mmCtx.fill();
      mmCtx.restore();
    }

    // ── Render loop ────────────────────────────────────────────────────────
    let animFrameId = 0;
    let lastHoverCheck = 0;
    const lastOverlayKey = new Float32Array(18);
    let lastOverlaySel = "";
    const tmpVec = new THREE.Vector3();
    const nearestIdx: number[] = [];
    const nearestDist: number[] = [];

    function animate() {
      animFrameId = requestAnimationFrame(animate);

      const s = stateRef.current;
      const nowMs = performance.now();
      const dt = s ? Math.min((nowMs - s.prevTime) / 1000, 0.1) : 0;
      if (s) s.prevTime = nowMs;
      const nowS = nowMs / 1000;
      uTime.value = nowS;
      uMorphTime.value = nowS - morphStart;

      const flyoverWasActive = !!s?.flyoverActive;

      if (s?.fpActive) {
        // First-person movement
        const speed = (s.fpKeys.has("ShiftLeft") || s.fpKeys.has("ShiftRight")) ? FP_SPRINT : FP_SPEED;
        const fwd   = new THREE.Vector3(-Math.sin(s.fpYaw), 0, -Math.cos(s.fpYaw));
        const rgt   = new THREE.Vector3( Math.cos(s.fpYaw), 0, -Math.sin(s.fpYaw));
        if (s.fpKeys.has("KeyW")) camera.position.addScaledVector(fwd,  speed * dt);
        if (s.fpKeys.has("KeyS")) camera.position.addScaledVector(fwd, -speed * dt);
        if (s.fpKeys.has("KeyA")) camera.position.addScaledVector(rgt, -speed * dt);
        if (s.fpKeys.has("KeyD")) camera.position.addScaledVector(rgt,  speed * dt);
        if (s.webAnchor && webEnabledRef.current) {
          const anchor = s.webAnchor;
          s.fpVelY -= FP_GRAVITY * dt;
          camera.position.x += s.webVelX * dt;
          camera.position.z += s.webVelZ * dt;
          camera.position.y += s.fpVelY * dt;

          // Pendulum constraint: keep player at webLength from anchor
          const toPlayer = new THREE.Vector3().subVectors(camera.position, anchor);
          const dist = toPlayer.length();
          if (dist > 0.001) {
            const radialDir = toPlayer.clone().normalize();
            const vel3 = new THREE.Vector3(s.webVelX, s.fpVelY, s.webVelZ);
            const radialVel = vel3.dot(radialDir);
            if (radialVel < 0) {
              vel3.addScaledVector(radialDir, -radialVel);
              s.webVelX = vel3.x;
              s.fpVelY  = vel3.y;
              s.webVelZ = vel3.z;
            }
            if (dist > s.webLength) {
              camera.position.copy(anchor).addScaledVector(radialDir, s.webLength);
            }
          }

          s.webVelX *= WEB_SWING_DAMPING;
          s.webVelZ *= WEB_SWING_DAMPING;

          const floorCheck = FP_HEIGHT;
          if (camera.position.y <= floorCheck) {
            camera.position.y = floorCheck;
            s.fpVelY = 0;
            s.fpOnGround = true;
            releaseWeb(s);
          } else {
            s.fpOnGround = false;
          }

          if (s.webLine) {
            const pos = s.webLine.geometry.attributes.position as THREE.BufferAttribute;
            pos.setXYZ(0, camera.position.x, camera.position.y, camera.position.z);
            pos.setXYZ(1, anchor.x, anchor.y, anchor.z);
            pos.needsUpdate = true;
          }
        } else {
          if (jumpEnabledRef.current) {
            s.fpVelY -= FP_GRAVITY * dt;
            camera.position.y += s.fpVelY * dt;

            // Roof landing — only buildings under the player's XZ (spatial grid lookup)
            let floorY = FP_HEIGHT;
            if (s.fpVelY <= 0) {
              const px = camera.position.x;
              const pz = camera.position.z;
              grid.query(px, px, pz, pz, (i) => {
                const node = currentNodes[i];
                const hw = (node.widthScale * BUILDING_BASE) / 2;
                if (px >= node.cx - hw && px <= node.cx + hw &&
                    pz >= node.cz - hw && pz <= node.cz + hw) {
                  const roofY = node.height + FP_HEIGHT;
                  if (roofY > floorY) floorY = roofY;
                }
              });
            }

            if (camera.position.y <= floorY) {
              camera.position.y = floorY;
              s.fpVelY = 0;
              s.fpOnGround = true;
            }
          } else {
            camera.position.y = FP_HEIGHT;
            s.fpVelY = 0;
            s.fpOnGround = true;
          }
        }

        camera.rotation.order = "YXZ";
        camera.rotation.y = s.fpYaw;
        camera.rotation.x = s.fpPitch;
      } else if (s?.flyoverActive) {
        const exitFlyover = () => {
          s.flyoverActive = false;
          s.controls.enabled = true;
          camera.position.copy(s.overheadPos);
          s.controls.target.copy(s.overheadTarget);
          camera.rotation.set(0, 0, 0);
          s.controls.update();
          onExitFlyoverRef.current?.();
        };

        if (s.flyoverPendingReroute !== null) {
          const rid = s.flyoverPendingReroute;
          s.flyoverPendingReroute = null;
          if (s.buildingMap.has(rid)) {
            s.flyoverQueue = computeFlyoverQueue(rid, s.graphEdges, s.buildingMap);
            s.flyoverQueueIndex = 0;
            s.flyoverSegments = computeFlyoverSegments(
              s.flyoverQueue, s.buildingMap, camera.position.clone(),
              s.flyoverCameraHeightOffset, s.flyoverSpeedMult,
              s.flyoverArcHeightMult,
            );
            s.flyoverSegIdx = 0;
            s.flyoverSegT = 0;
            s.flyoverLookArcNode = -1;
          }
        }

        if (s.flyoverSegIdx >= s.flyoverSegments.length) {
          exitFlyover();
        } else {
          const seg = s.flyoverSegments[s.flyoverSegIdx];
          s.flyoverSegT += dt / seg.duration;
          if (s.flyoverSegT > 1) s.flyoverSegT = 1;

          const t = s.flyoverSegT;

          if (seg.type === 'arc') {
            const angle = arcAngleAt(seg.arcStartAngle, seg.arcEndAngle, seg.arcCCW, t);
            camera.position.set(
              seg.arcCx + seg.arcRadius * Math.cos(angle),
              seg.arcCy,
              seg.arcCz + seg.arcRadius * Math.sin(angle),
            );
          } else {
            camera.position.lerpVectors(seg.flyStart!, seg.flyEnd!, t);
          }

          if (seg.type === 'arc' && seg.nodeIdx !== s.flyoverLookArcNode) {
            const lp = easeInOut(Math.min(s.flyoverLookT, 1));
            const cx = s.flyoverLookFrom.x + (s.flyoverLookTo.x - s.flyoverLookFrom.x) * lp;
            const cy = s.flyoverLookFrom.y + (s.flyoverLookTo.y - s.flyoverLookFrom.y) * lp;
            const cz = s.flyoverLookFrom.z + (s.flyoverLookTo.z - s.flyoverLookFrom.z) * lp;
            s.flyoverLookFrom.set(cx, cy, cz);
            s.flyoverLookTo.copy(seg.lookAtTarget);
            s.flyoverLookT = 0;
            s.flyoverLookArcNode = seg.nodeIdx;
          }
          s.flyoverLookT = Math.min(1, s.flyoverLookT + dt / FLYOVER_LOOK_DURATION);
          const lp = easeInOut(s.flyoverLookT);
          camera.lookAt(
            s.flyoverLookFrom.x + (s.flyoverLookTo.x - s.flyoverLookFrom.x) * lp,
            s.flyoverLookFrom.y + (s.flyoverLookTo.y - s.flyoverLookFrom.y) * lp,
            s.flyoverLookFrom.z + (s.flyoverLookTo.z - s.flyoverLookFrom.z) * lp,
          );

          s.flyoverQueueIndex = seg.nodeIdx;

          if (s.flyoverSegT >= 1) {
            s.flyoverSegIdx++;
            s.flyoverSegT = 0;
            if (s.flyoverSegIdx >= s.flyoverSegments.length) {
              exitFlyover();
            }
          }
        }
      } else if (s?.camAnim) {
        // Scripted overhead camera move (fit / focus)
        const a = s.camAnim;
        const t = Math.min(1, (nowS - a.start) / a.dur);
        const e = easeInOutCubic(t);
        camera.position.lerpVectors(a.fromPos, a.toPos, e);
        controls.target.lerpVectors(a.fromTarget, a.toTarget, e);
        controls.enabled = false;
        controls.update();
        if (t >= 1) {
          s.camAnim = null;
          controls.enabled = true;
        }
      } else {
        controls.update();
      }

      sky.position.copy(camera.position);

      // ── Near plane tracks zoom: a fixed 0.1 wastes depth precision when far out ──
      const wantNear = s?.fpActive || s?.flyoverActive
        ? 0.1
        : THREE.MathUtils.clamp(camera.position.distanceTo(controls.target) * 0.004, 0.1, 4);
      if (Math.abs(camera.near - wantNear) / wantNear > 0.05) {
        camera.near = wantNear;
        camera.updateProjectionMatrix();
      }

      // ── Fog follows the viewing distance so the city always reads ──
      if (s?.fpActive) {
        uFogNear.value = 30; uFogFar.value = 160;
      } else {
        const d = camera.position.distanceTo(controls.target);
        uFogNear.value = d * 1.1 + cityRadius * 0.6;
        uFogFar.value = d * 2.6 + cityRadius * 2.2;
      }

      // ── Highlight easing ──
      if (stateAttr && hoverAttr) {
        const k = 1 - Math.exp(-dt * 10);
        let changed = false;
        for (let i = 0; i < stateCur.length; i++) {
          const d = stateTgt[i] - stateCur[i];
          if (d !== 0) {
            stateCur[i] = Math.abs(d) < 1e-3 ? stateTgt[i] : stateCur[i] + d * k;
            changed = true;
          }
        }
        if (changed) stateAttr.needsUpdate = true;
        let hChanged = false;
        for (let i = 0; i < hoverCur.length; i++) {
          const d = hoverTgt[i] - hoverCur[i];
          if (d !== 0) {
            hoverCur[i] = Math.abs(d) < 1e-3 ? hoverTgt[i] : hoverCur[i] + d * (1 - Math.exp(-dt * 16));
            hChanged = true;
          }
        }
        if (hChanged) hoverAttr.needsUpdate = true;
      }
      arcMat.uniforms.uReveal.value = Math.min(1.01, (nowS - arcRevealStart) / 0.9);

      // ── Hover (throttled raycast) ──
      if (s && (hoverDirty || s.fpActive || controls.enabled === false || nowMs - lastHoverCheck > 120)) {
        if (nowMs - lastHoverCheck > 40) {
          updateHover(s);
          lastHoverCheck = nowMs;
          hoverDirty = false;
        }
      }

      // ── Label visibility ────────────────────────────────────────────────
      let flyLabelId: string | null = null;
      let flyLabelOp = 0;
      if (flyoverWasActive && s.flyoverSegments.length > 0) {
        const seg = s.flyoverSegments[Math.min(s.flyoverSegIdx, s.flyoverSegments.length - 1)];
        flyLabelId = s.flyoverQueue[seg.nodeIdx] ?? null;
        if (seg.type === 'arc') {
          flyLabelOp = Math.min(1, s.flyoverSegT * 3);
        } else {
          flyLabelOp = s.flyoverSegT < 0.6 ? 0 : (s.flyoverSegT - 0.6) / 0.4;
        }
      }

      if (s) {
        const shown = new Set<THREE.Sprite>();
        if (s.fpActive && s.showLabelsFP) {
          const p = camera.position;
          grid.query(p.x - LABEL_FAR, p.x + LABEL_FAR, p.z - LABEL_FAR, p.z + LABEL_FAR, (i) => {
            const n = currentNodes[i];
            tmpVec.set(n.cx, n.height / 2, n.cz);
            const dist = p.distanceTo(tmpVec);
            if (dist >= LABEL_FAR) return;
            const opacity = dist <= LABEL_NEAR ? 0.5 : 0.5 * (1 - (dist - LABEL_NEAR) / (LABEL_FAR - LABEL_NEAR));
            const sp = getLabel(buildingMap.get(n.id)!);
            sp.material.opacity = opacity;
            shown.add(sp);
          });
        } else if (!s.fpActive && !flyoverWasActive && s.showLabelsOverhead && currentNodes.length > 0) {
          // Nearest N towers to the camera — partial selection, no full sort
          nearestIdx.length = 0; nearestDist.length = 0;
          for (let i = 0; i < currentNodes.length; i++) {
            const n = currentNodes[i];
            const dx = n.cx - camera.position.x, dy = n.height / 2 - camera.position.y, dz = n.cz - camera.position.z;
            const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (nearestIdx.length < OVERHEAD_LABEL_PRIORITY_COUNT || d < nearestDist[nearestDist.length - 1]) {
              let k = nearestDist.length;
              while (k > 0 && nearestDist[k - 1] > d) k--;
              nearestDist.splice(k, 0, d);
              nearestIdx.splice(k, 0, i);
              if (nearestIdx.length > OVERHEAD_LABEL_PRIORITY_COUNT) { nearestIdx.pop(); nearestDist.pop(); }
            }
          }
          const nearest = nearestDist[0], furthest = nearestDist[nearestDist.length - 1];
          nearestIdx.forEach((i, k) => {
            const sp = getLabel(buildingMap.get(currentNodes[i].id)!);
            sp.material.opacity = mapDistanceToOpacity(nearestDist[k], nearest, furthest);
            shown.add(sp);
          });
        }
        if (flyoverWasActive && s.flyoverLabelMode === 'center' && flyLabelId && flyLabelOp > 0) {
          const entry = buildingMap.get(flyLabelId);
          if (entry) {
            const sp = getLabel(entry);
            sp.material.opacity = flyLabelOp * 0.85;
            shown.add(sp);
          }
        }
        for (const sp of visibleLabels) if (!shown.has(sp)) sp.visible = false;
        visibleLabels.clear();
        for (const sp of shown) { sp.visible = true; visibleLabels.add(sp); }
      }

      // ── Render ──
      // Bloom eases off as the camera pulls back so dense skylines don't smear
      // Street level: glass walls fill the view, so keep the haze to a whisper
      bloom.strength = s?.fpActive
        ? 0.14
        : THREE.MathUtils.lerp(0.5, 0.16, THREE.MathUtils.smoothstep(camera.position.distanceTo(controls.target), 30, 320));
      districtGroup.visible = !s?.fpActive;
      if (theme.dark && s?.glow) composer.render();
      else renderer.render(scene, camera);

      // ── Overhead label overlay ──────────────────────────────────────────
      if (s && !s.fpActive) {
        const W = mount!.clientWidth, H = mount!.clientHeight;
        if (flyoverWasActive && s.flyoverLabelMode === 'overhead') {
          updateFlyoverOverheadLabels(
            s.buildingMap, s.labelOverlaySvg,
            flyLabelId, flyLabelOp, null, 0,
            s.darkMode, camera, W, H, s.projVec,
          );
        } else if (flyoverWasActive) {
          if (s.labelOverlaySvg.innerHTML !== "") s.labelOverlaySvg.innerHTML = "";
        } else if (s.selectedNodeIdForLabels && s.showClickLabels && !s.flyoverActive) {
          // Skip the DOM rebuild when neither the camera nor the selection moved
          const e = camera.matrixWorld.elements;
          let same = lastOverlaySel === `${s.selectedNodeIdForLabels}|${s.connectedNodeIdsForLabels.size}|${s.darkMode}`
            && lastOverlayKey[16] === W && lastOverlayKey[17] === H;
          for (let i = 0; i < 16 && same; i++) if (Math.abs(lastOverlayKey[i] - e[i]) > 1e-5) same = false;
          if (!same) {
            updateOverheadLabels(
              s.buildingMap, s.labelOverlaySvg,
              s.selectedNodeIdForLabels, s.connectedNodeIdsForLabels,
              s.darkMode, camera, W, H, s.projVec,
            );
            for (let i = 0; i < 16; i++) lastOverlayKey[i] = e[i];
            lastOverlayKey[16] = W; lastOverlayKey[17] = H;
            lastOverlaySel = `${s.selectedNodeIdForLabels}|${s.connectedNodeIdsForLabels.size}|${s.darkMode}`;
          }
        } else if (s.labelOverlaySvg.innerHTML !== "") {
          s.labelOverlaySvg.innerHTML = "";
          lastOverlaySel = "";
        }
      } else if (s && s.labelOverlaySvg.innerHTML !== "") {
        s.labelOverlaySvg.innerHTML = "";
        lastOverlaySel = "";
      }

      // ── Minimap (street view only) ──
      if (s?.fpActive) {
        minimap!.style.opacity = "1";
        drawMinimap(s);
      } else if (minimap!.style.opacity !== "0") {
        minimap!.style.opacity = "0";
      }
    }

    stateRef.current = {
      renderer, composer, bloom, scene, camera, controls,
      buildingMap, buildings: currentNodes, adjacency,
      graphEdges: [], darkMode: initialDarkRef.current, glow: true,
      fpActive: false, fpYaw: 0, fpPitch: 0, fpKeys: new Set(), fpVelY: 0, fpOnGround: true,
      overheadPos:    new THREE.Vector3(),
      overheadTarget: new THREE.Vector3(),
      prevTime: performance.now(),
      showLabelsFP: true, showLabelsOverhead: false, showClickLabels: true,
      labelOverlaySvg: labelSvg,
      selectedNodeIdForLabels: null,
      connectedNodeIdsForLabels: new Set(),
      projVec: new THREE.Vector3(),
      flyoverActive: false,
      flyoverQueue: [],
      flyoverQueueIndex: 0,
      flyoverSegments: [],
      flyoverSegIdx: 0,
      flyoverSegT: 0,
      flyoverLabelMode: 'none',
      flyoverSpeedMult: 1,
      flyoverArcHeightMult: 1,
      flyoverCameraHeightOffset: 1.5,
      flyoverPendingReroute: null,
      flyoverLookFrom: new THREE.Vector3(),
      flyoverLookTo: new THREE.Vector3(),
      flyoverLookT: 1,
      flyoverLookArcNode: -1,
      webAnchor: null,
      webLength: 0,
      webVelX: 0,
      webVelZ: 0,
      webLine: null,
      camAnim: null,
      rebuild,
      applyTheme,
      applySelection,
      fitView,
      focusBuilding,
    };
    applyTheme(initialDarkRef.current);
    animate();

    return () => {
      cancelAnimationFrame(animFrameId);
      ro.disconnect();
      renderer.domElement.removeEventListener("contextmenu", onContextMenu);
      document.removeEventListener("mousedown", onWebShoot);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("pointerleave", onPointerLeave);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup",   onKeyUp);
      window.removeEventListener("blur",    onBlur);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("pointerlockchange", onPointerLockChange);
      if (document.pointerLockElement === renderer.domElement) document.exitPointerLock();
      const s = stateRef.current;
      if (s?.webLine) {
        scene.remove(s.webLine);
        s.webLine.geometry.dispose();
        (s.webLine.material as THREE.Material).dispose();
      }
      controls.dispose();
      if (fillMesh) { fillMesh.geometry.dispose(); fillMesh.dispose(); }
      if (edgeMesh) edgeMesh.dispose();
      if (arcMesh) arcMesh.geometry.dispose();
      disposeGroup(streetGroup);
      disposeGroup(districtGroup);
      clearLabels();
      unitBox.dispose();
      fillMat.dispose(); edgeMat.dispose(); arcMat.dispose();
      beacon.geometry.dispose(); beaconMat.dispose();
      ripple.geometry.dispose(); rippleMat.dispose();
      groundGeo.dispose(); groundMat.dispose();
      sky.geometry.dispose(); skyMat.dispose();
      composer.dispose();
      bloom.dispose();
      renderer.dispose();
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
      if (mount.contains(labelSvg)) mount.removeChild(labelSvg);
      if (mount.contains(tooltip)) mount.removeChild(tooltip);
      stateRef.current = null;
    };
  }, []);

  // ── Graph change → rebuild city content (renderer persists) ──────────────
  useEffect(() => {
    stateRef.current?.rebuild(graph);
  }, [graph]);

  // ── Theme ────────────────────────────────────────────────────────────────
  useEffect(() => {
    stateRef.current?.applyTheme(darkMode);
  }, [darkMode]);

  useEffect(() => {
    const s = stateRef.current;
    if (s) s.glow = glow;
  }, [glow]);

  // ── Fit scene on demand ───────────────────────────────────────────────────
  useEffect(() => {
    const s = stateRef.current;
    if (!s || s.fpActive || s.flyoverActive || fitSceneTrigger === 0) return;
    s.fitView(true);
  }, [fitSceneTrigger]);

  // ── Focus request (search) ────────────────────────────────────────────────
  useEffect(() => {
    if (!focusRequest) return;
    stateRef.current?.focusBuilding(focusRequest.id);
  }, [focusRequest]);

  // ── First-person toggle ──────────────────────────────────────────────────
  useEffect(() => {
    const s = stateRef.current;
    if (!s) return;

    if (firstPerson) {
      s.camAnim = null;
      s.overheadPos.copy(s.camera.position);
      s.overheadTarget.copy(s.controls.target);

      s.camera.position.set(s.controls.target.x, FP_HEIGHT, s.controls.target.z + 6);
      s.fpYaw   = 0;
      s.fpPitch = 0;
      s.fpActive = true;
      s.controls.enabled = false;
      setStreetsVisible(s, true);

      if (s.labelOverlaySvg.innerHTML !== "") s.labelOverlaySvg.innerHTML = "";
      try {
        const result = s.renderer.domElement.requestPointerLock();
        if (result instanceof Promise) result.catch(() => {});
      } catch { /* SecurityError: will retry on next canvas click */ }
    } else if (s.fpActive) {
      s.fpActive = false;
      s.fpKeys.clear();
      s.fpVelY = 0;
      s.fpOnGround = true;
      s.controls.enabled = true;
      setStreetsVisible(s, false);
      if (s.webLine) {
        s.scene.remove(s.webLine);
        s.webLine.geometry.dispose();
        (s.webLine.material as THREE.Material).dispose();
        s.webLine = null;
      }
      s.webAnchor = null;

      s.camera.position.copy(s.overheadPos);
      s.controls.target.copy(s.overheadTarget);
      s.camera.rotation.set(0, 0, 0);
      s.controls.update();

      if (document.pointerLockElement === s.renderer.domElement) document.exitPointerLock();
    }
  }, [firstPerson]);

  // ── Flyover toggle ───────────────────────────────────────────────────────
  useEffect(() => {
    const s = stateRef.current;
    if (!s) return;

    if (flyover && selectedNodeId) {
      const hubEntry = s.buildingMap.get(selectedNodeId);
      if (!hubEntry) return;
      if (s.flyoverActive) {
        // Selection changed mid-flight — reroute instead of restarting
        s.flyoverPendingReroute = selectedNodeId;
        return;
      }
      s.camAnim = null;
      s.overheadPos.copy(s.camera.position);
      s.overheadTarget.copy(s.controls.target);

      s.flyoverQueue = computeFlyoverQueue(selectedNodeId, s.graphEdges, s.buildingMap);
      s.flyoverQueueIndex = 0;
      s.flyoverSegments = computeFlyoverSegments(
        s.flyoverQueue, s.buildingMap, s.camera.position.clone(),
        s.flyoverCameraHeightOffset, s.flyoverSpeedMult,
        s.flyoverArcHeightMult,
      );
      s.flyoverSegIdx = 0;
      s.flyoverSegT = 0;
      s.flyoverPendingReroute = null;
      if (s.flyoverSegments.length > 0) {
        const firstTarget = s.flyoverSegments[0].lookAtTarget;
        s.flyoverLookFrom.copy(firstTarget);
        s.flyoverLookTo.copy(firstTarget);
        s.flyoverLookT = 1;
        s.flyoverLookArcNode = -1;
      }
      s.flyoverActive = true;
      s.controls.enabled = false;
    } else if (!flyover && s.flyoverActive) {
      s.flyoverActive = false;
      s.controls.enabled = true;
      s.camera.position.copy(s.overheadPos);
      s.controls.target.copy(s.overheadTarget);
      s.camera.rotation.set(0, 0, 0);
      s.controls.update();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flyover, selectedNodeId]);

  // ── Sync flyover settings into scene state ───────────────────────────────
  useEffect(() => {
    const s = stateRef.current;
    if (!s) return;
    s.flyoverLabelMode = flyoverLabelMode;
    s.flyoverSpeedMult = flyoverSpeedMult;
    s.flyoverArcHeightMult = flyoverArcHeightMult;
    s.flyoverCameraHeightOffset = flyoverCameraHeightOffset;
  }, [flyoverLabelMode, flyoverSpeedMult, flyoverArcHeightMult, flyoverCameraHeightOffset]);

  // ── Sync label settings into scene state ─────────────────────────────────
  useEffect(() => {
    const s = stateRef.current;
    if (!s) return;
    s.showLabelsFP = showLabelsFP;
    s.showLabelsOverhead = showLabelsOverhead;
    s.showClickLabels = showClickLabels;
  }, [showLabelsFP, showLabelsOverhead, showClickLabels]);

  // ── Selection: highlight/dim + connection arcs + beacon ─────────────────
  useEffect(() => {
    stateRef.current?.applySelection(selectedNodeId, showConnectors);
  }, [selectedNodeId, showConnectors]);

  return (
    <div ref={mountRef} style={{ width: "100%", height: "100%", position: "relative" }}>
      {/* Street-view minimap */}
      <canvas
        ref={minimapRef}
        style={{
          position: "absolute",
          top: 64,
          right: panelOpen ? 332 : 24,
          width: MINIMAP_SIZE,
          height: MINIMAP_SIZE,
          borderRadius: 12,
          background: "var(--panel-bg)",
          border: "1px solid var(--border-default)",
          boxShadow: "var(--shadow-md)",
          backdropFilter: "blur(12px)",
          pointerEvents: "none",
          opacity: 0,
          transition: "opacity 0.4s ease, right 0.35s cubic-bezier(0.32, 0, 0.15, 1)",
          zIndex: 6,
        }}
      />
    </div>
  );
}

function setStreetsVisible(s: SceneState, visible: boolean) {
  s.scene.traverse((o) => {
    if (o.userData.isStreets) o.visible = visible;
  });
}
