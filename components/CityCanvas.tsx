"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import type { GraphData, NodeDetail } from "@/lib/types";
import { computeCityLayout, type CityNode, BUILDING_BASE, CELL_SIZE, MIN_ALLEY } from "@/lib/cityLayout";

// ─── Constants ────────────────────────────────────────────────────────────────

const FP_HEIGHT   = 1.8;  // eye-level height in world units
const FP_SPEED    = 5;    // units/sec walking
const FP_SPRINT   = 14;   // units/sec sprinting
const FP_SENS     = 0.002; // mouse look sensitivity
const FP_JUMP_VEL = 8;    // upward velocity on jump (world units/sec)
const FP_GRAVITY  = 20;   // downward acceleration (world units/sec²)
const FP_ACCEL_TIME = 0.1;  // seconds for walk velocity to reach ~63% of target
const FP_MAX_FALL   = 15;   // max downward speed (world units/sec)
const FP_BOB_AMP    = 0.035; // head-bob amplitude (world units, ≤ 0.05)
const FP_BOB_FREQ_WALK   = 9;  // head-bob frequency while walking (rad/sec)
const FP_BOB_FREQ_SPRINT = 13; // head-bob frequency while sprinting (rad/sec)
const FAR_FROM_CENTER_DIST = 250; // horizontal distance that triggers the return-to-center hint
const COLLISION_CELL = BUILDING_BASE * 3; // spatial-grid cell size for FP roof collision

// ─── Hover Constants ──────────────────────────────────────────────────────────
const HOVER_THROTTLE_MS    = 30;   // min interval between hover raycasts
const HOVER_OPACITY_BOOST  = 0.10; // face-opacity bump on hovered building

// ─── Atmosphere Constants ─────────────────────────────────────────────────────
// Theme-resolved equivalents of --bg-base (see docs/color-scheme.md)
const BG_LIGHT = 0xf7f3ed;
const BG_DARK  = 0x1a1a1a;
const FOG_NEAR = 140;  // beyond the default fitted orbit distance — city stays crisp
const FOG_FAR  = 460;  // ground plane edge (~300 from center) fades into haze

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

const FLYOVER_BASE_SPEED    = 5.0; // world-units per second for both arcs and fly segments
const FLYOVER_LOOK_DURATION = 3.0; // seconds for one look-at ease-in/out transition

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
  face: THREE.Mesh;
  edges: THREE.LineSegments;
  node: CityNode;
};

type SceneState = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  buildingMap: Map<string, BuildingEntry>;
  labelSpriteMap: Map<string, THREE.Sprite>;
  connectionLines: THREE.Line[];
  streetGroup: THREE.Group;
  labelSprites: THREE.Sprite[];
  graphEdges: GraphData["edges"];
  darkMode: boolean;
  // First-person state
  fpActive: boolean;
  fpYaw: number;
  fpPitch: number;
  fpKeys: Set<string>;
  fpVelY: number;
  fpOnGround: boolean;
  fpMoveVelX: number;       // smoothed walk velocity (world units/sec)
  fpMoveVelZ: number;
  fpBobPhase: number;       // head-bob sine phase
  fpBobOffset: number;      // head-bob Y offset applied to the camera last frame
  fpSpawn: THREE.Vector3;   // street-level spawn point (return-to-center target)
  farFromCenter: boolean;   // player wandered beyond FAR_FROM_CENTER_DIST
  lastFarCheckMs: number;
  collisionGrid: Map<string, CityNode[]>;
  overheadPos: THREE.Vector3;
  overheadTarget: THREE.Vector3;
  animFrameId: number;
  prevTime: number;
  // Reusable scratch vectors (avoid per-frame allocation)
  _fwd: THREE.Vector3;
  _rgt: THREE.Vector3;
  _toPlayer: THREE.Vector3;
  _radialDir: THREE.Vector3;
  _vel3: THREE.Vector3;
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
  onFarFromCenterChange?: (far: boolean) => void;
  returnToCenterTrigger?: number;
};

function fitCameraToBuildings(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  buildingMap: Map<string, BuildingEntry>,
  padding = 1.12,
) {
  if (buildingMap.size === 0) return;

  const bounds = new THREE.Box3();
  for (const { face } of buildingMap.values()) bounds.expandByObject(face);
  if (bounds.isEmpty()) return;

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

  const forward = new THREE.Vector3().subVectors(controls.target, camera.position);
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

  const distance = Math.max(requiredDistance * padding, controls.minDistance + 1);
  camera.position.copy(center).addScaledVector(forward, -distance);
  controls.target.copy(center);
  controls.update();
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

  const STREET_Y = 0.004;
  const LANE_Y   = 0.007;
  const HWY_Y    = 0.006;
  const OBS_PAD  = MIN_ALLEY / 2 + 0.05;
  const PAD      = CELL_SIZE * 1.2;

  const streetCol = darkMode ? 0x1c1c2e : 0xd4d0c8;
  const laneCol   = darkMode ? 0xffffff : 0x888878;
  const hwayCol   = darkMode ? 0x28283e : 0xbcb8b0;

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

    function addLines(pts: number[], color: number, opacity: number) {
      if (pts.length === 0) return;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
      const mat = new THREE.LineBasicMaterial({ color, opacity, transparent: true });
      group.add(new THREE.LineSegments(geo, mat));
    }

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

      // Highway center dashes
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

// ─── Building label sprite ────────────────────────────────────────────────────

function makeLabelSprite(text: string, buildingWidth: number, darkMode: boolean): THREE.Sprite {
  const SIZE = 1024;
  const canvas = document.createElement("canvas");
  canvas.width  = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d")!;

  ctx.clearRect(0, 0, SIZE, SIZE);
  ctx.fillStyle   = darkMode ? "rgba(255,255,255,0.92)" : "rgba(0,0,0,0.88)";
  ctx.textAlign   = "center";
  ctx.textBaseline = "middle";

  // Fit font size to the canvas, then word-wrap
  const maxW   = SIZE * 0.88;
  let fontSize = Math.max(72, Math.min(200, SIZE / Math.max(1, text.length / 2.5)));
  ctx.font = `bold ${fontSize}px sans-serif`;

  // Word-wrap
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
  const lineH = fontSize * 1.25;
  // Shrink font until text fits vertically
  while (lines.length * lineH > SIZE * 0.88 && fontSize > 48) {
    fontSize -= 8;
    lines = wrapLines(fontSize);
  }
  ctx.font = `bold ${fontSize}px sans-serif`;
  const totalH  = lines.length * lineH;
  const startY  = SIZE / 2 - totalH / 2 + lineH / 2;
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], SIZE / 2, startY + i * lineH);
  }

  const texture      = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 16;
  const mat     = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false });
  const sprite  = new THREE.Sprite(mat);
  const s       = buildingWidth * 0.82;
  sprite.scale.set(s, s, 1);
  sprite.visible = false;
  return sprite;
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

// Shared layout constants for overhead label pills (orbit + flyover renderers)
const LABEL_DIAG_X = 26;   // horizontal offset of angled segment (toward label)
const LABEL_DIAG_Y = 54;   // default vertical rise of angled segment
const LABEL_HORIZ  = 62;   // horizontal segment length
const LABEL_BOX_H  = 22;   // approximate label height for overlap detection
const LABEL_PAD_X  = 8;    // pill horizontal padding
const LABEL_PAD_Y  = 4;    // pill vertical padding
const LABEL_FONT   = "'DM Mono',monospace";

function labelPalette(darkMode: boolean): { textFill: string; pillBg: string } {
  return {
    textFill: darkMode ? "rgba(255,255,255,0.96)" : "rgba(14,14,20,0.96)",
    pillBg:   darkMode ? "rgba(10,10,22,0.84)"    : "rgba(255,255,255,0.90)",
  };
}

function approxLabelTextWidth(name: string, isMain: boolean): number {
  return Math.max(44, name.length * (isMain ? 7.6 : 7.1));
}

// Renders one leader-line + pill + text label as an SVG fragment.
// Shared by the orbit-mode click labels and the flyover labels.
function renderOverheadLabelPill(opts: {
  sx: number; sy: number;          // dot at building top (screen px)
  ex: number; ey: number;          // elbow of the leader line
  facingRight: boolean;
  name: string;
  isMain: boolean;
  color: string;
  opacity: number;                 // overall label opacity
  lineOpacity: number;             // leader-line opacity (already scaled)
  textFill: string;
  pillBg: string;
}): string {
  const { sx, sy, ex, ey, facingRight, name, isMain, color, opacity, lineOpacity, textFill, pillBg } = opts;
  const fs  = isMain ? 12 : 11;
  const fw  = isMain ? "600" : "400";
  const sw  = isMain ? "1.7" : "1.3";
  const horizEnd = facingRight ? ex + LABEL_HORIZ : ex - LABEL_HORIZ;
  const approxTW = approxLabelTextWidth(name, isMain);
  const pillW    = approxTW + LABEL_PAD_X * 2;
  const pillH    = fs + LABEL_PAD_Y * 2;
  const rectX    = facingRight ? horizEnd : horizEnd - pillW;
  const rectY    = ey - pillH / 2;
  const textX    = facingRight ? horizEnd + LABEL_PAD_X : horizEnd - LABEL_PAD_X;
  const anchor   = facingRight ? "start" : "end";

  let html = "";
  // Dot at building top
  html += `<circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="2.5" fill="${color}" opacity="${(0.92 * opacity).toFixed(2)}"/>`;
  // Angled segment
  html += `<line x1="${sx.toFixed(1)}" y1="${sy.toFixed(1)}" x2="${ex.toFixed(1)}" y2="${ey.toFixed(1)}" stroke="${color}" stroke-width="${sw}" opacity="${lineOpacity.toFixed(2)}"/>`;
  // Horizontal segment
  html += `<line x1="${ex.toFixed(1)}" y1="${ey.toFixed(1)}" x2="${horizEnd.toFixed(1)}" y2="${ey.toFixed(1)}" stroke="${color}" stroke-width="${sw}" opacity="${lineOpacity.toFixed(2)}"/>`;
  // Pill background
  html += `<rect x="${rectX.toFixed(1)}" y="${rectY.toFixed(1)}" width="${pillW.toFixed(1)}" height="${pillH.toFixed(1)}" rx="3" ry="3" fill="${pillBg}" opacity="${(0.93 * opacity).toFixed(2)}"/>`;
  // Label text
  html += `<text x="${textX.toFixed(1)}" y="${ey.toFixed(1)}" font-family="${LABEL_FONT}" font-size="${fs}" font-weight="${fw}" fill="${textFill}" text-anchor="${anchor}" dominant-baseline="middle" opacity="${opacity.toFixed(2)}">${escSvg(name)}</text>`;
  return html;
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
  const LABEL_PAD = 7;    // minimum vertical gap between labels

  const { textFill, pillBg } = labelPalette(darkMode);

  // Collect items
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
    // Cull items far off-screen
    if (sx < -300 || sx > W + 300 || sy < -300 || sy > H + 300) return;
    const distance = camera.position.distanceTo(vec.set(e.node.cx, e.node.height, e.node.cz));
    const facingRight = sx < W / 2;
    items.push({
      id, name: e.node.name, isMain, sx, sy,
      color: e.node.color, distance, facingRight,
      ex: sx + (facingRight ? LABEL_DIAG_X : -LABEL_DIAG_X),
      ey: sy - LABEL_DIAG_Y,
    });
  };

  project(selectedId, true);
  for (const id of connectedIds) project(id, false);

  if (items.length === 0) { svg.innerHTML = ""; return; }

  const opacityById = buildOverheadOpacityMap(items, (item) => item.id, (item) => item.distance);

  // Anti-overlap: process in order of ascending ey (topmost label first).
  // When two labels' pill rects would collide, push the lower one further up.
  items.sort((a, b) => a.ey - b.ey);

  const placed: Item[] = [];
  for (const item of items) {
    let ey = item.ey;
    const approxTW = approxLabelTextWidth(item.name, item.isMain);
    const lx1 = item.facingRight ? item.ex + LABEL_HORIZ : item.ex - LABEL_HORIZ - approxTW;
    const lx2 = lx1 + approxTW;

    for (const p of placed) {
      const pTW = approxLabelTextWidth(p.name, p.isMain);
      const plx1 = p.facingRight ? p.ex + LABEL_HORIZ : p.ex - LABEL_HORIZ - pTW;
      const plx2 = plx1 + pTW;
      const xOverlap = lx2 + 4 > plx1 && lx1 - 4 < plx2;
      if (xOverlap && Math.abs(ey - p.ey) < LABEL_BOX_H + LABEL_PAD) {
        ey = p.ey - LABEL_BOX_H - LABEL_PAD;
      }
    }
    item.ey = Math.max(16, ey); // don't go off the top of the viewport
    placed.push(item);
  }

  // Build SVG markup
  let html = "";
  for (const item of items) {
    const baseLineOpacity = item.isMain ? 0.88 : 0.68;
    const opacity = opacityById.get(item.id) ?? OVERHEAD_LABEL_HIDDEN_OPACITY;
    html += renderOverheadLabelPill({
      sx: item.sx, sy: item.sy, ex: item.ex, ey: item.ey,
      facingRight: item.facingRight,
      name: item.name, isMain: item.isMain, color: item.color,
      opacity, lineOpacity: baseLineOpacity * opacity,
      textFill, pillBg,
    });
  }

  svg.innerHTML = html;
}

// ─── Flyover helpers ──────────────────────────────────────────────────────────

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function cubicBezier(
  p0: THREE.Vector3, p1: THREE.Vector3,
  p2: THREE.Vector3, p3: THREE.Vector3,
  t: number,
): THREE.Vector3 {
  const mt = 1 - t;
  return new THREE.Vector3(
    mt*mt*mt*p0.x + 3*mt*mt*t*p1.x + 3*mt*t*t*p2.x + t*t*t*p3.x,
    mt*mt*mt*p0.y + 3*mt*mt*t*p1.y + 3*mt*t*t*p2.y + t*t*t*p3.y,
    mt*mt*mt*p0.z + 3*mt*mt*t*p1.z + 3*mt*t*t*p2.z + t*t*t*p3.z,
  );
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
  // camera never reverses mid-circle.  We track the previous exit point (starting
  // from the real camera position) and project the arrival vector onto the two
  // tangent directions at the entry point.  Whichever sign the tangential
  // component has, we commit to that orbit direction for the whole arc.
  const exitAngles: number[] = [];
  const arcCCWs: boolean[] = [];
  let prevExitX = initialCamPos.x;
  let prevExitZ = initialCamPos.z;
  for (let i = 0; i < N - 1; i++) {
    const ci = circles[i];
    const θ = entryAngles[i];
    const entX = ci.cx + ci.r * Math.cos(θ);
    const entZ = ci.cz + ci.r * Math.sin(θ);

    // Approach vector from the previous exit (or camera start) to this entry point
    const adx = entX - prevExitX;
    const adz = entZ - prevExitZ;
    const adLen = Math.sqrt(adx * adx + adz * adz);
    // Dot with the CCW tangent (-sinθ, cosθ); positive → arriving CCW, negative → arriving CW
    const tangDot = adLen > 0.01 ? (adx * (-Math.sin(θ)) + adz * Math.cos(θ)) / adLen : 0;
    const preferCCW = tangDot >= 0;

    // Compute the two external-tangent exit options toward the next circle's entry point
    const ep1x = circles[i + 1].cx + circles[i + 1].r * Math.cos(entryAngles[i + 1]);
    const ep1z = circles[i + 1].cz + circles[i + 1].r * Math.sin(entryAngles[i + 1]);
    const dvx = ep1x - ci.cx, dvz = ep1z - ci.cz;
    const d = Math.sqrt(dvx * dvx + dvz * dvz);
    if (d <= ci.r + 0.1) {
      // Degenerate: next entry is inside this circle — just orbit half-way
      exitAngles[i] = θ + (preferCCW ? Math.PI : -Math.PI);
      arcCCWs[i] = preferCCW;
    } else {
      const alpha = Math.atan2(dvz, dvx);
      const beta  = Math.acos(Math.min(1, ci.r / d));
      exitAngles[i] = preferCCW ? alpha - beta : alpha + beta;
      arcCCWs[i]    = preferCCW;
    }

    // Record this exit point so the next iteration knows the approach direction
    prevExitX = ci.cx + ci.r * Math.cos(exitAngles[i]);
    prevExitZ = ci.cz + ci.r * Math.sin(exitAngles[i]);
  }
  arcCCWs[N - 1] = N > 1 ? arcCCWs[N - 2] : true;

  const segs: FlyoverSegment[] = [];

  // Initial fly from camera to entry[0]
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
    // Arc look target: the NEXT node's top-center. As soon as the camera
    // reaches this orbit circle the look transition kicks off toward the next
    // node, and the subsequent fly keeps the same target so the ease runs
    // continuously through both segments.
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
        // fly shares the same look target as the arc it departs from
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
  const { textFill, pillBg } = labelPalette(darkMode);
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
    // Always label to the right in flyover mode
    const ex = sx + LABEL_DIAG_X;
    const ey = sy - LABEL_DIAG_Y;
    html += renderOverheadLabelPill({
      sx, sy, ex, ey, facingRight: true,
      name: e.node.name, isMain, color: e.node.color,
      opacity, lineOpacity: 0.88 * opacity,
      textFill, pillBg,
    });
  };

  if (currentId) renderLabel(currentId, true, currentOpacity);
  if (nextId && nextId !== currentId) renderLabel(nextId, false, nextOpacity);
  svg.innerHTML = html;
}

// ─── Web swing helper ────────────────────────────────────────────────────────

function releaseWeb(s: SceneState): void {
  if (s.webLine) {
    s.scene.remove(s.webLine);
    s.webLine.geometry.dispose();
    (s.webLine.material as THREE.Material).dispose();
    s.webLine = null;
  }
  s.webAnchor = null;
}

// ─── FP collision spatial grid ───────────────────────────────────────────────
// Buildings are bucketed into every grid cell their footprint overlaps, so a
// point query only needs to look at the single cell containing the player.

function collisionGridKey(ix: number, iz: number): string {
  return `${ix},${iz}`;
}

function buildCollisionGrid(cityNodes: CityNode[]): Map<string, CityNode[]> {
  const grid = new Map<string, CityNode[]>();
  for (const node of cityNodes) {
    const hw = (node.widthScale * BUILDING_BASE) / 2;
    const ix0 = Math.floor((node.cx - hw) / COLLISION_CELL);
    const ix1 = Math.floor((node.cx + hw) / COLLISION_CELL);
    const iz0 = Math.floor((node.cz - hw) / COLLISION_CELL);
    const iz1 = Math.floor((node.cz + hw) / COLLISION_CELL);
    for (let ix = ix0; ix <= ix1; ix++) {
      for (let iz = iz0; iz <= iz1; iz++) {
        const key = collisionGridKey(ix, iz);
        let bucket = grid.get(key);
        if (!bucket) { bucket = []; grid.set(key, bucket); }
        bucket.push(node);
      }
    }
  }
  return grid;
}

// ─── Atmosphere helpers ──────────────────────────────────────────────────────
// Soft vertical gradient derived from the theme background color.

function makeBackgroundTexture(darkMode: boolean): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width  = 2;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  const base   = new THREE.Color(darkMode ? BG_DARK : BG_LIGHT);
  const top    = base.clone().offsetHSL(0, 0, darkMode ? -0.015 : 0.02);
  const bottom = base.clone().offsetHSL(0, 0, darkMode ? 0.015 : -0.02);
  const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
  grad.addColorStop(0, `#${top.getHexString()}`);
  grad.addColorStop(1, `#${bottom.getHexString()}`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
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
  onFarFromCenterChange,
  returnToCenterTrigger = 0,
}: Props) {
  const mountRef        = useRef<HTMLDivElement>(null);
  const stateRef        = useRef<SceneState | null>(null);
  const onSelectRef     = useRef(onSelectNode);
  const onExitFPRef     = useRef(onExitFirstPerson);
  const onExitFlyoverRef = useRef(onExitFlyover);
  const jumpEnabledRef  = useRef(jumpEnabled);
  const webEnabledRef   = useRef(webEnabled);
  const onFarFromCenterRef = useRef(onFarFromCenterChange);
  useEffect(() => { onSelectRef.current      = onSelectNode; },      [onSelectNode]);
  useEffect(() => { onExitFPRef.current      = onExitFirstPerson; }, [onExitFirstPerson]);
  useEffect(() => { onExitFlyoverRef.current = onExitFlyover; },     [onExitFlyover]);
  useEffect(() => { jumpEnabledRef.current   = jumpEnabled; },       [jumpEnabled]);
  useEffect(() => { webEnabledRef.current    = webEnabled; },        [webEnabled]);
  useEffect(() => { onFarFromCenterRef.current = onFarFromCenterChange; }, [onFarFromCenterChange]);

  // ── Scene init ───────────────────────────────────────────────────────────
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const W = mount.clientWidth;
    const H = mount.clientHeight;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(darkMode ? 0x1a1a1a : 0xf7f3ed);
    mount.appendChild(renderer.domElement);

    // SVG overlay for overhead click-labels
    const labelSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg") as SVGSVGElement;
    labelSvg.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;overflow:visible;";
    mount.appendChild(labelSvg);

    const scene  = new THREE.Scene();

    // Atmosphere: soft vertical gradient background + distance fog so the
    // city fades at the horizon instead of hard-stopping at the ground edge.
    const bgTexture = makeBackgroundTexture(darkMode);
    scene.background = bgTexture;
    const fogColor = new THREE.Color(darkMode ? BG_DARK : BG_LIGHT)
      .offsetHSL(0, 0, darkMode ? 0.01 : -0.01);
    scene.fog = new THREE.Fog(fogColor, FOG_NEAR, FOG_FAR);

    const camera = new THREE.PerspectiveCamera(60, W / H, 0.1, 1000);
    camera.position.set(0, 22, 32);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping  = true;
    controls.dampingFactor  = 0.08;
    controls.minPolarAngle  = Math.PI * 0.05;
    controls.maxPolarAngle  = Math.PI * 0.48;
    controls.minDistance    = 2;
    controls.maxDistance    = 200;
    controls.screenSpacePanning = false;

    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const dir = new THREE.DirectionalLight(0xffffff, 0.6);
    dir.position.set(10, 20, 10);
    scene.add(dir);

    const groundGeo = new THREE.PlaneGeometry(600, 600);
    const groundMat = new THREE.MeshBasicMaterial({ color: darkMode ? 0x1a1a1a : 0xf7f3ed, side: THREE.DoubleSide });
    const ground    = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.01;
    ground.name = "ground";
    scene.add(ground);

    const gridColor = darkMode ? 0x222222 : 0xe8e2d8;
    const grid = new THREE.GridHelper(600, 300, gridColor, gridColor);
    grid.position.y = -0.01;
    scene.add(grid);

    // Buildings — ONE shared unit geometry, scaled per mesh. Materials stay
    // per-building because selection highlighting mutates opacity per building.
    const cityNodes  = computeCityLayout(graph);
    const buildingMap = new Map<string, BuildingEntry>();

    const unitBoxGeo   = new THREE.BoxGeometry(1, 1, 1);
    const unitEdgesGeo = new THREE.EdgesGeometry(unitBoxGeo);

    for (const node of cityNodes) {
      const color = new THREE.Color(node.color);
      const w = BUILDING_BASE * node.widthScale;

      const faceMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false });
      const face    = new THREE.Mesh(unitBoxGeo, faceMat);
      face.scale.set(w, node.height, w);
      face.position.set(node.cx, node.height / 2, node.cz);
      face.userData = { nodeId: node.id };

      const edgesMat  = new THREE.LineBasicMaterial({ color });
      const edgesMesh = new THREE.LineSegments(unitEdgesGeo, edgesMat);
      edgesMesh.scale.set(w, node.height, w);
      edgesMesh.position.set(node.cx, node.height / 2, node.cz);
      edgesMesh.userData = { nodeId: node.id };

      scene.add(face);
      scene.add(edgesMesh);
      buildingMap.set(node.id, { face, edges: edgesMesh, node });
    }

    // Cached raycast target list (rebuilt only when the scene rebuilds)
    const buildingFaces = [...buildingMap.values()].map((b) => b.face);
    // Spatial grid for FP floor/roof collision queries
    const collisionGrid = buildCollisionGrid(cityNodes);

    // Building name labels (visible in first-person only)
    const labelSprites: THREE.Sprite[] = [];
    const labelSpriteMap = new Map<string, THREE.Sprite>();
    for (const node of cityNodes) {
      const w      = BUILDING_BASE * node.widthScale;
      const sprite = makeLabelSprite(node.name, w, darkMode);
      sprite.position.set(node.cx, node.height / 2, node.cz);
      scene.add(sprite);
      labelSprites.push(sprite);
      labelSpriteMap.set(node.id, sprite);
    }

    // Streets — hidden until first-person mode
    const streetGroup = buildStreets(cityNodes, darkMode);
    scene.add(streetGroup);

    // Fit camera to city
    if (cityNodes.length > 0) fitCameraToBuildings(camera, controls, buildingMap);

    // ── Click → raycasting ─────────────────────────────────────────────────
    const raycaster = new THREE.Raycaster();
    const mouse     = new THREE.Vector2();
    const pointerDown = { x: 0, y: 0, moved: false };
    const CLICK_DRAG_THRESHOLD = 5;

    function setRayFromPointer(e: MouseEvent | PointerEvent) {
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width)  *  2 - 1;
      mouse.y = -((e.clientY - rect.top)  / rect.height) *  2 + 1;
      raycaster.setFromCamera(mouse, camera);
    }

    function hitBuildingFromPointer(e: MouseEvent | PointerEvent): BuildingEntry | null {
      setRayFromPointer(e);
      const hits = raycaster.intersectObjects(buildingFaces);
      if (hits.length === 0) return null;
      const nodeId = hits[0].object.userData.nodeId as string;
      return buildingMap.get(nodeId) ?? null;
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
    }

    function onPointerMove(e: PointerEvent) {
      if (pointerDown.moved) return;
      const dx = e.clientX - pointerDown.x;
      const dy = e.clientY - pointerDown.y;
      if (Math.hypot(dx, dy) > CLICK_DRAG_THRESHOLD) pointerDown.moved = true;
    }

    function onPointerUp(e: PointerEvent) {
      if (e.button !== 0) return;
      if (renderer.domElement.hasPointerCapture(e.pointerId)) {
        renderer.domElement.releasePointerCapture(e.pointerId);
      }
      const s = stateRef.current;
      if (pointerDown.moved) return;

      if (s?.fpActive) {
        // If pointer isn't locked yet, grab it now (this click IS a user gesture)
        if (document.pointerLockElement !== renderer.domElement) {
          try {
            const result = renderer.domElement.requestPointerLock();
            if (result instanceof Promise) result.catch(() => {});
          } catch { /* ignore */ }
          return;
        }
        // In first-person with pointer lock — raycast from screen center (crosshair)
        raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
        const hits = raycaster.intersectObjects(buildingFaces);
        if (hits.length > 0) {
          const nodeId = hits[0].object.userData.nodeId as string;
          const entry  = buildingMap.get(nodeId);
          if (entry) onSelectRef.current(toNodeDetail(entry.node));
        } else {
          onSelectRef.current(null);
        }
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
        if (entry.node.id === selectedNodeId) onSelectRef.current(null);
        else onSelectRef.current(toNodeDetail(entry.node));
        return;
      }

      onSelectRef.current(null);
    }

    function onKeyDown(e: KeyboardEvent) {
      const s = stateRef.current;
      if (s?.fpActive) {
        if (e.code === "Space" && s.fpOnGround && jumpEnabledRef.current) {
          s.fpVelY = FP_JUMP_VEL;
          s.fpOnGround = false;
          e.preventDefault();
        }
        // R key = release web
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

    // Pointer lock — mouse look in first-person
    function onMouseMove(e: MouseEvent) {
      const s = stateRef.current;
      if (!s?.fpActive) return;
      s.fpYaw   -= e.movementX * FP_SENS;
      s.fpPitch -= e.movementY * FP_SENS;
      s.fpPitch  = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, s.fpPitch));
    }

    function onPointerLockChange() {
      if (document.pointerLockElement !== renderer.domElement) {
        // Pointer lock released (user pressed Escape or browser forced it)
        const s = stateRef.current;
        if (s?.fpActive) {
          onExitFPRef.current?.();
        }
      }
    }

    // ── Hover feedback (orbit mode only) ───────────────────────────────────
    function baseFaceOpacity(st: SceneState, id: string): number {
      if (!st.selectedNodeIdForLabels) return 0.12;
      if (id === st.selectedNodeIdForLabels) return 0.30;
      if (st.connectedNodeIdsForLabels.has(id)) return 0.22;
      return 0.04;
    }

    let hoveredId: string | null = null;
    let lastHoverMs = 0;

    function setHovered(id: string | null) {
      const s = stateRef.current;
      if (!s || hoveredId === id) return;
      if (hoveredId) {
        const prev = s.buildingMap.get(hoveredId);
        if (prev) (prev.face.material as THREE.MeshBasicMaterial).opacity = baseFaceOpacity(s, hoveredId);
      }
      hoveredId = id;
      if (id) {
        const entry = s.buildingMap.get(id);
        if (entry) {
          const fm = entry.face.material as THREE.MeshBasicMaterial;
          fm.opacity = Math.min(1, baseFaceOpacity(s, id) + HOVER_OPACITY_BOOST);
        }
      }
      renderer.domElement.style.cursor = id ? "pointer" : "";
    }

    function onHoverMove(e: PointerEvent) {
      const s = stateRef.current;
      if (!s) return;
      if (s.fpActive || s.flyoverActive) { setHovered(null); return; }
      const now = performance.now();
      if (now - lastHoverMs < HOVER_THROTTLE_MS) return;
      lastHoverMs = now;
      setRayFromPointer(e);
      const hits = raycaster.intersectObjects(buildingFaces);
      setHovered(hits.length > 0 ? (hits[0].object.userData.nodeId as string) : null);
    }

    // ── Web swing: shoot on right-click, release on R key ──────────────────
    function onContextMenu(e: MouseEvent) {
      // Suppress browser context menu in all cases so right-click can be used for web swing
      e.preventDefault();
    }

    function onWebShoot(e: MouseEvent) {
      if (e.button !== 2) return;
      const s = stateRef.current;
      if (!s?.fpActive || !webEnabledRef.current) return;
      // Works whether or not pointer lock is active

      // Toggle: if web is active, release it
      if (s.webAnchor) {
        releaseWeb(s);
        return;
      }

      // Shoot web from crosshair
      raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
      const hits = raycaster.intersectObjects(buildingFaces);
      let anchorPoint: THREE.Vector3 | null = null;

      if (hits.length > 0 && hits[0].distance <= WEB_SHOOT_RANGE) {
        // Aim for the top of the hit building face or exact hit point if high up
        const hit = hits[0];
        const nodeId = hit.object.userData.nodeId as string;
        const entry = buildingMap.get(nodeId);
        if (entry) {
          // Prefer the top of the building as anchor so it swings well
          const node = entry.node;
          const topY = node.height;
          // Use hit point X/Z but snap to building top if hit point is below top
          if (hit.point.y < topY - 0.5) {
            anchorPoint = new THREE.Vector3(hit.point.x, topY, hit.point.z);
          } else {
            anchorPoint = hit.point.clone();
          }
        } else {
          anchorPoint = hit.point.clone();
        }
      }

      if (!anchorPoint) return; // nothing in range

      // Compute web length (distance from player to anchor)
      const dist = camera.position.distanceTo(anchorPoint);
      s.webAnchor = anchorPoint;
      s.webLength = dist;

      // Transfer current FP horizontal velocity into web swing velocity
      // and give a small upward boost
      const fwd = new THREE.Vector3(-Math.sin(s.fpYaw), 0, -Math.cos(s.fpYaw));
      const spd = (s.fpKeys.has("ShiftLeft") || s.fpKeys.has("ShiftRight")) ? FP_SPRINT : FP_SPEED;
      const hasMovement = s.fpKeys.has("KeyW") || s.fpKeys.has("KeyS") || s.fpKeys.has("KeyA") || s.fpKeys.has("KeyD");
      if (hasMovement) {
        s.webVelX = fwd.x * spd;
        s.webVelZ = fwd.z * spd;
      }
      s.fpVelY += WEB_LAUNCH_BOOST;
      s.fpOnGround = false;

      // Create the visual web line
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
    renderer.domElement.addEventListener("pointermove", onHoverMove);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup",   onKeyUp);
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("pointerlockchange", onPointerLockChange);

    function onResize() {
      if (!mountRef.current) return;
      const w = mountRef.current.clientWidth;
      const h = mountRef.current.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    window.addEventListener("resize", onResize);

    // ── Render loop ────────────────────────────────────────────────────────
    let animFrameId = 0;
    function animate() {
      animFrameId = requestAnimationFrame(animate);

      const s = stateRef.current;
      const nowMs = performance.now();
      const dt = s ? Math.min((nowMs - s.prevTime) / 1000, 0.1) : 0;
      if (s) s.prevTime = nowMs;

      // Capture flyoverActive BEFORE the animation block may call exitFlyover() and flip it to false.
      // This prevents label rendering from seeing the mid-frame state change (double-label bug).
      const flyoverWasActive = !!s?.flyoverActive;

      if (s?.fpActive) {
        // Remove last frame's head-bob offset before running physics so the
        // bob never interferes with jump / web-swing camera-Y management.
        camera.position.y -= s.fpBobOffset;

        // First-person movement — short acceleration/deceleration lerp
        const speed = (s.fpKeys.has("ShiftLeft") || s.fpKeys.has("ShiftRight")) ? FP_SPRINT : FP_SPEED;
        const fwd   = s._fwd.set(-Math.sin(s.fpYaw), 0, -Math.cos(s.fpYaw));
        const rgt   = s._rgt.set( Math.cos(s.fpYaw), 0, -Math.sin(s.fpYaw));
        const fwdInput = (s.fpKeys.has("KeyW") ? 1 : 0) - (s.fpKeys.has("KeyS") ? 1 : 0);
        const rgtInput = (s.fpKeys.has("KeyD") ? 1 : 0) - (s.fpKeys.has("KeyA") ? 1 : 0);
        const targetVelX = (fwd.x * fwdInput + rgt.x * rgtInput) * speed;
        const targetVelZ = (fwd.z * fwdInput + rgt.z * rgtInput) * speed;
        const accel = dt > 0 ? 1 - Math.exp(-dt / FP_ACCEL_TIME) : 0;
        s.fpMoveVelX += (targetVelX - s.fpMoveVelX) * accel;
        s.fpMoveVelZ += (targetVelZ - s.fpMoveVelZ) * accel;
        camera.position.x += s.fpMoveVelX * dt;
        camera.position.z += s.fpMoveVelZ * dt;
        // ── Web swing physics (takes over vertical + horizontal when attached) ──
        if (s.webAnchor && webEnabledRef.current) {
          const anchor = s.webAnchor;

          // Apply gravity to the full velocity vector
          s.fpVelY -= FP_GRAVITY * dt;

          // Step the position using both horizontal web velocity and vertical fpVelY
          camera.position.x += s.webVelX * dt;
          camera.position.z += s.webVelZ * dt;
          camera.position.y += s.fpVelY * dt;

          // Pendulum constraint: keep player at webLength from anchor
          const toPlayer = s._toPlayer.subVectors(camera.position, anchor);
          const dist = toPlayer.length();
          if (dist > 0.001) {
            // Project velocity onto the tangent (remove radial component)
            const radialDir = s._radialDir.copy(toPlayer).normalize();
            const vel3 = s._vel3.set(s.webVelX, s.fpVelY, s.webVelZ);
            const radialVel = vel3.dot(radialDir);
            // Only remove inward (contracting) radial velocity; allow outward slightly
            if (radialVel < 0) {
              vel3.addScaledVector(radialDir, -radialVel);
              s.webVelX = vel3.x;
              s.fpVelY  = vel3.y;
              s.webVelZ = vel3.z;
            }

            // Constrain position to rope length (snap back if stretched)
            if (dist > s.webLength) {
              camera.position.copy(anchor).addScaledVector(radialDir, s.webLength);
            }
          }

          // Damping
          s.webVelX *= WEB_SWING_DAMPING;
          s.webVelZ *= WEB_SWING_DAMPING;

          // Auto-release if player has landed on the ground
          const floorCheck = FP_HEIGHT;
          if (camera.position.y <= floorCheck) {
            camera.position.y = floorCheck;
            s.fpVelY = 0;
            s.fpOnGround = true;
            releaseWeb(s);
          } else {
            s.fpOnGround = false;
          }

          // Update visual web line geometry
          if (s.webLine) {
            const pos = s.webLine.geometry.attributes.position as THREE.BufferAttribute;
            pos.setXYZ(0, camera.position.x, camera.position.y, camera.position.z);
            pos.setXYZ(1, anchor.x, anchor.y, anchor.z);
            pos.needsUpdate = true;
          }
        } else {
          // Normal vertical physics (only when jump is enabled)
          if (jumpEnabledRef.current) {
            s.fpVelY -= FP_GRAVITY * dt;
            if (s.fpVelY < -FP_MAX_FALL) s.fpVelY = -FP_MAX_FALL;
            camera.position.y += s.fpVelY * dt;

            // Determine the floor height at the player's XZ position.
            // The ground is FP_HEIGHT; buildings add a roof surface only when
            // the player is falling onto the top from above (no wall/floor collision).
            // Only the player's spatial-grid cell is checked — buildings were
            // bucketed into every cell their footprint overlaps at scene build.
            let floorY = FP_HEIGHT;
            if (s.fpVelY <= 0) {
              const px = camera.position.x;
              const pz = camera.position.z;
              const bucket = s.collisionGrid.get(collisionGridKey(
                Math.floor(px / COLLISION_CELL),
                Math.floor(pz / COLLISION_CELL),
              ));
              if (bucket) {
                for (const node of bucket) {
                  const hw = (node.widthScale * BUILDING_BASE) / 2;
                  if (px >= node.cx - hw && px <= node.cx + hw &&
                      pz >= node.cz - hw && pz <= node.cz + hw) {
                    const roofY = node.height + FP_HEIGHT;
                    if (roofY > floorY) floorY = roofY;
                  }
                }
              }
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

        // Head-bob: subtle sine on camera Y while walking on the ground.
        // Disabled while jumping/falling or web-swinging; the offset is
        // removed at the top of the block so physics never sees it.
        const isWalking = !s.webAnchor && s.fpOnGround && (fwdInput !== 0 || rgtInput !== 0);
        if (isWalking) {
          s.fpBobPhase += dt * (speed === FP_SPRINT ? FP_BOB_FREQ_SPRINT : FP_BOB_FREQ_WALK);
          s.fpBobOffset = Math.sin(s.fpBobPhase) * FP_BOB_AMP;
        } else {
          s.fpBobPhase = 0;
          s.fpBobOffset *= 0.8; // ease back to level
          if (Math.abs(s.fpBobOffset) < 0.001) s.fpBobOffset = 0;
        }
        camera.position.y += s.fpBobOffset;

        // Return-to-center hint: notify the screen when the player wanders far
        // from the city origin (checked at most twice per second).
        if (nowMs - s.lastFarCheckMs > 500) {
          s.lastFarCheckMs = nowMs;
          const far = Math.hypot(camera.position.x, camera.position.z) > FAR_FROM_CENTER_DIST;
          if (far !== s.farFromCenter) {
            s.farFromCenter = far;
            onFarFromCenterRef.current?.(far);
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

        // Handle pending reroute
        if (s.flyoverPendingReroute !== null) {
          const rid = s.flyoverPendingReroute;
          s.flyoverPendingReroute = null;
          s.flyoverQueue = computeFlyoverQueue(rid, s.graphEdges, s.buildingMap);
          s.flyoverQueueIndex = 0;
          s.flyoverSegments = computeFlyoverSegments(
            s.flyoverQueue, s.buildingMap, camera.position.clone(),
            s.flyoverCameraHeightOffset, s.flyoverSpeedMult,
            s.flyoverArcHeightMult,
          );
          s.flyoverSegIdx = 0;
          s.flyoverSegT = 0;
          s.flyoverLookArcNode = -1; // let first arc in new route trigger a fresh transition
        }

        if (s.flyoverSegIdx >= s.flyoverSegments.length) {
          exitFlyover();
        } else {
          const seg = s.flyoverSegments[s.flyoverSegIdx];
          s.flyoverSegT += dt / seg.duration;
          if (s.flyoverSegT > 1) s.flyoverSegT = 1;

          const t = s.flyoverSegT;

          // Camera position
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

          // LookAt — when a new arc starts, begin a fresh ease-in/out transition
          // toward that arc's look target (the next node's top-center).
          // The transition runs for FLYOVER_LOOK_DURATION seconds, spanning the
          // arc + the subsequent fly so it completes smoothly before arrival.
          if (seg.type === 'arc' && seg.nodeIdx !== s.flyoverLookArcNode) {
            // Capture current interpolated look position as the new start
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
      } else {
        controls.update();
      }

      // ── Label visibility ────────────────────────────────────────────────
      // (flyoverWasActive was captured before the animation block above)
      // Flyover single-label: computed outside both blocks so overhead overlay can reuse it
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
        let overheadOpacityBySprite = new Map<THREE.Sprite, number>();
        if (!s.fpActive && !flyoverWasActive && s.showLabelsOverhead) {
          const byUuid = buildOverheadOpacityMap(
            s.labelSprites,
            (sp) => sp.uuid,
            (sp) => camera.position.distanceTo(sp.position),
          );
          overheadOpacityBySprite = new Map(
            s.labelSprites.map((sp) => [sp, byUuid.get(sp.uuid) ?? OVERHEAD_LABEL_HIDDEN_OPACITY]),
          );
        }

        for (const sp of s.labelSprites) {
          if (s.fpActive) {
            if (!s.showLabelsFP) {
              sp.visible = false;
            } else {
              sp.visible = true;
              const dist = camera.position.distanceTo(sp.position);
              let opacity = 0;
              if (dist <= LABEL_NEAR) opacity = 0.5;
              else if (dist < LABEL_FAR) opacity = 0.5 * (1 - (dist - LABEL_NEAR) / (LABEL_FAR - LABEL_NEAR));
              (sp.material as THREE.SpriteMaterial).opacity = opacity;
            }
          } else if (flyoverWasActive) {
            sp.visible = false; // will be re-enabled below for 'center' mode
          } else {
            if (!s.showLabelsOverhead) {
              sp.visible = false;
            } else {
              sp.visible = true;
              (sp.material as THREE.SpriteMaterial).opacity = overheadOpacityBySprite.get(sp) ?? OVERHEAD_LABEL_HIDDEN_OPACITY;
            }
          }
        }

        // Flyover center-label sprite
        if (flyoverWasActive && s.flyoverLabelMode === 'center' && flyLabelId && flyLabelOp > 0) {
          const sp = s.labelSpriteMap.get(flyLabelId);
          if (sp) {
            sp.visible = true;
            (sp.material as THREE.SpriteMaterial).opacity = flyLabelOp * 0.85;
          }
        }
      }

      renderer.render(scene, camera);

      // ── Overhead label overlay ──────────────────────────────────────────
      if (s && !s.fpActive) {
        if (flyoverWasActive && s.flyoverLabelMode === 'overhead') {
          updateFlyoverOverheadLabels(
            s.buildingMap, s.labelOverlaySvg,
            flyLabelId, flyLabelOp, null, 0,
            s.darkMode, camera,
            mount!.clientWidth, mount!.clientHeight, s.projVec,
          );
        } else if (flyoverWasActive) {
          if (s.labelOverlaySvg.innerHTML !== "") s.labelOverlaySvg.innerHTML = "";
        } else if (s.selectedNodeIdForLabels && s.showClickLabels && !s.flyoverActive) {
          updateOverheadLabels(
            s.buildingMap, s.labelOverlaySvg,
            s.selectedNodeIdForLabels, s.connectedNodeIdsForLabels,
            s.darkMode, camera,
            mount!.clientWidth, mount!.clientHeight, s.projVec,
          );
        } else if (s.labelOverlaySvg.innerHTML !== "") {
          s.labelOverlaySvg.innerHTML = "";
        }
      } else if (s && s.labelOverlaySvg.innerHTML !== "") {
        s.labelOverlaySvg.innerHTML = "";
      }
    }
    animate();

    stateRef.current = {
      renderer, scene, camera, controls,
      buildingMap, labelSpriteMap, connectionLines: [], streetGroup, labelSprites,
      graphEdges: graph.edges, darkMode,
      fpActive: false, fpYaw: 0, fpPitch: 0, fpKeys: new Set(), fpVelY: 0, fpOnGround: true,
      fpMoveVelX: 0, fpMoveVelZ: 0,
      fpBobPhase: 0, fpBobOffset: 0,
      fpSpawn: new THREE.Vector3(),
      farFromCenter: false,
      lastFarCheckMs: 0,
      collisionGrid,
      overheadPos:    new THREE.Vector3(),
      overheadTarget: new THREE.Vector3(),
      animFrameId,
      prevTime: performance.now(),
      _fwd: new THREE.Vector3(),
      _rgt: new THREE.Vector3(),
      _toPlayer: new THREE.Vector3(),
      _radialDir: new THREE.Vector3(),
      _vel3: new THREE.Vector3(),
      showLabelsFP, showLabelsOverhead, showClickLabels,
      labelOverlaySvg: labelSvg,
      selectedNodeIdForLabels: null,
      connectedNodeIdsForLabels: new Set(),
      projVec: new THREE.Vector3(),
      // Flyover
      flyoverActive: false,
      flyoverQueue: [],
      flyoverQueueIndex: 0,
      flyoverSegments: [],
      flyoverSegIdx: 0,
      flyoverSegT: 0,
      flyoverLabelMode: flyoverLabelMode,
      flyoverSpeedMult: flyoverSpeedMult,
      flyoverArcHeightMult: flyoverArcHeightMult,
      flyoverCameraHeightOffset: flyoverCameraHeightOffset,
      flyoverPendingReroute: null,
      flyoverLookFrom: new THREE.Vector3(),
      flyoverLookTo: new THREE.Vector3(),
      flyoverLookT: 1,
      flyoverLookArcNode: -1,
      // Web swing
      webAnchor: null,
      webLength: 0,
      webVelX: 0,
      webVelZ: 0,
      webLine: null,
    };

    return () => {
      cancelAnimationFrame(animFrameId);
      renderer.domElement.removeEventListener("contextmenu", onContextMenu);
      document.removeEventListener("mousedown", onWebShoot);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointermove", onHoverMove);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup",   onKeyUp);
      window.removeEventListener("resize",  onResize);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("pointerlockchange", onPointerLockChange);
      if (document.pointerLockElement === renderer.domElement) document.exitPointerLock();
      // Clean up web line if active
      const s = stateRef.current;
      if (s?.webLine) {
        scene.remove(s.webLine);
        s.webLine.geometry.dispose();
        (s.webLine.material as THREE.Material).dispose();
      }
      controls.dispose();
      for (const { face, edges: em } of buildingMap.values()) {
        (face.material as THREE.Material).dispose();
        (em.material   as THREE.Material).dispose();
      }
      // Geometry is shared by all buildings — dispose once
      unitBoxGeo.dispose();
      unitEdgesGeo.dispose();
      streetGroup.traverse((obj) => {
        if (obj instanceof THREE.LineSegments || obj instanceof THREE.Line) {
          obj.geometry.dispose();
          (obj.material as THREE.Material).dispose();
        }
      });
      for (const sp of labelSprites) {
        sp.geometry.dispose();
        (sp.material as THREE.SpriteMaterial).map?.dispose();
        (sp.material as THREE.SpriteMaterial).dispose();
      }
      groundGeo.dispose(); groundMat.dispose();
      bgTexture.dispose();
      renderer.dispose();
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
      if (mount.contains(labelSvg)) mount.removeChild(labelSvg);
      stateRef.current = null;
    };
  }, [graph, darkMode]);

  // ── Fit scene on demand ───────────────────────────────────────────────────
  useEffect(() => {
    const s = stateRef.current;
    if (!s || s.fpActive || s.flyoverActive) return;
    fitCameraToBuildings(s.camera, s.controls, s.buildingMap);
  }, [fitSceneTrigger]);

  // ── Return to center (street view) ────────────────────────────────────────
  useEffect(() => {
    if (!returnToCenterTrigger) return;
    const s = stateRef.current;
    if (!s || !s.fpActive) return;
    releaseWeb(s);
    s.webVelX = 0;
    s.webVelZ = 0;
    s.fpMoveVelX = 0;
    s.fpMoveVelZ = 0;
    s.fpVelY = 0;
    s.fpOnGround = true;
    s.fpBobPhase = 0;
    s.fpBobOffset = 0;
    s.camera.position.copy(s.fpSpawn);
    s.fpYaw = 0;
    s.fpPitch = 0;
    if (s.farFromCenter) {
      s.farFromCenter = false;
      onFarFromCenterRef.current?.(false);
    }
  }, [returnToCenterTrigger]);

  // ── First-person toggle ──────────────────────────────────────────────────
  useEffect(() => {
    const s = stateRef.current;
    if (!s) return;

    if (firstPerson) {
      // Save overhead position so we can return to it
      s.overheadPos.copy(s.camera.position);
      s.overheadTarget.copy(s.controls.target);

      // Drop to street level at the current orbit target
      s.camera.position.set(s.controls.target.x, FP_HEIGHT, s.controls.target.z + 6);
      s.fpSpawn.copy(s.camera.position);
      s.fpYaw   = 0;
      s.fpPitch = 0;
      s.fpMoveVelX = 0;
      s.fpMoveVelZ = 0;
      s.fpBobPhase = 0;
      s.fpBobOffset = 0;
      s.lastFarCheckMs = 0;
      s.fpActive = true;
      s.controls.enabled = false;
      s.streetGroup.visible = true;

      // requestPointerLock must be called close to a user gesture.
      // If it fails (SecurityError), we silently ignore — the user can click
      // the canvas to lock the pointer manually on their next interaction.
      if (s.labelOverlaySvg.innerHTML !== "") s.labelOverlaySvg.innerHTML = "";
      try {
        const result = s.renderer.domElement.requestPointerLock();
        if (result instanceof Promise) result.catch(() => {});
      } catch { /* SecurityError: will retry on next canvas click */ }
    } else {
      // Exit first-person — release any active web so its line geometry
      // can't leak across FP sessions
      releaseWeb(s);
      s.webVelX = 0;
      s.webVelZ = 0;
      s.fpActive = false;
      s.fpKeys.clear();
      s.fpVelY = 0;
      s.fpOnGround = true;
      s.fpMoveVelX = 0;
      s.fpMoveVelZ = 0;
      s.fpBobPhase = 0;
      s.fpBobOffset = 0;
      if (s.farFromCenter) {
        s.farFromCenter = false;
        onFarFromCenterRef.current?.(false);
      }
      s.controls.enabled = true;
      s.streetGroup.visible = false;

      // Restore overhead camera
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
      // Immediately snap look-at to the first node's top-center; transitions
      // will be triggered when arcs are entered during the animation loop.
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

  // ── Selection: highlight/dim + ground-level connection lines ────────────
  useEffect(() => {
    const s = stateRef.current;
    if (!s) return;

    const { scene, buildingMap, graphEdges } = s;

    for (const line of s.connectionLines) {
      scene.remove(line);
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
    }
    s.connectionLines = [];

    if (!selectedNodeId) {
      s.selectedNodeIdForLabels = null;
      s.connectedNodeIdsForLabels = new Set();
      for (const { face, edges } of buildingMap.values()) {
        (face.material as THREE.MeshBasicMaterial).opacity = 0.12;
        const em = edges.material as THREE.LineBasicMaterial;
        em.opacity = 1; em.transparent = false; em.needsUpdate = true;
      }
      return;
    }

    const connectedIds = new Set<string>();
    for (const edge of graphEdges) {
      if (edge.source === selectedNodeId) connectedIds.add(edge.target);
      else if (edge.target === selectedNodeId) connectedIds.add(edge.source);
    }

    // Sync label state so the render loop can draw the overlay
    s.selectedNodeIdForLabels = selectedNodeId;
    s.connectedNodeIdsForLabels = connectedIds;

    for (const [id, { face, edges }] of buildingMap) {
      const fm = face.material  as THREE.MeshBasicMaterial;
      const em = edges.material as THREE.LineBasicMaterial;
      em.transparent = true; em.needsUpdate = true;
      if (id === selectedNodeId)    { fm.opacity = 0.30; em.opacity = 1.00; }
      else if (connectedIds.has(id)) { fm.opacity = 0.22; em.opacity = 0.85; }
      else                           { fm.opacity = 0.04; em.opacity = 0.18; }
    }

    const sel = buildingMap.get(selectedNodeId);
    if (!sel) return;

    if (showConnectors) {
      const lineColor = s.darkMode ? 0xffffff : 0x222222;
      const lineMat   = new THREE.LineBasicMaterial({ color: lineColor, opacity: 0.55, transparent: true });

      for (const connId of connectedIds) {
        const conn = buildingMap.get(connId);
        if (!conn) continue;
        const pts = [
          new THREE.Vector3(sel.node.cx,  0.01, sel.node.cz),
          new THREE.Vector3(conn.node.cx, 0.01, conn.node.cz),
        ];
        const geo  = new THREE.BufferGeometry().setFromPoints(pts);
        const line = new THREE.Line(geo, lineMat);
        scene.add(line);
        s.connectionLines.push(line);
      }
    }
  }, [selectedNodeId, showConnectors]);

  return <div ref={mountRef} style={{ width: "100%", height: "100%", position: "relative" }} />;
}
