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

const LABEL_NEAR  = 4;    // distance at which label reaches max opacity
const LABEL_FAR   = 14;   // distance at which label starts fading in

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
  overheadPos: THREE.Vector3;
  overheadTarget: THREE.Vector3;
  animFrameId: number;
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
};

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

  // Collect items
  interface Item {
    id: string; name: string; isMain: boolean;
    sx: number; sy: number; color: string;
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
    const facingRight = sx < W / 2;
    items.push({
      id, name: e.node.name, isMain, sx, sy,
      color: e.node.color, facingRight,
      ex: sx + (facingRight ? DIAG_X : -DIAG_X),
      ey: sy - DIAG_Y,
    });
  };

  project(selectedId, true);
  for (const id of connectedIds) project(id, false);

  if (items.length === 0) { svg.innerHTML = ""; return; }

  // Anti-overlap: process in order of ascending ey (topmost label first).
  // When two labels' pill rects would collide, push the lower one further up.
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
    item.ey = Math.max(16, ey); // don't go off the top of the viewport
    placed.push(item);
  }

  // Build SVG markup
  let html = "";
  for (const item of items) {
    const { sx, sy, ex, ey, facingRight, name, isMain, color } = item;
    const fs  = isMain ? 12 : 11;
    const fw  = isMain ? "600" : "400";
    const sw  = isMain ? "1.7" : "1.3";
    const so  = isMain ? "0.88" : "0.68";

    const horizEnd  = facingRight ? ex + HORIZ : ex - HORIZ;
    const approxTW  = Math.max(44, name.length * (isMain ? 7.6 : 7.1));
    const pillW     = approxTW + padX * 2;
    const pillH     = fs + padY * 2;
    const rectX     = facingRight ? horizEnd : horizEnd - pillW;
    const rectY     = ey - pillH / 2;
    const textX     = facingRight ? horizEnd + padX : horizEnd - padX;
    const anchor    = facingRight ? "start" : "end";

    // Dot at building top
    html += `<circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="2.5" fill="${color}" opacity="0.92"/>`;
    // Angled segment
    html += `<line x1="${sx.toFixed(1)}" y1="${sy.toFixed(1)}" x2="${ex.toFixed(1)}" y2="${ey.toFixed(1)}" stroke="${color}" stroke-width="${sw}" opacity="${so}"/>`;
    // Horizontal segment
    html += `<line x1="${ex.toFixed(1)}" y1="${ey.toFixed(1)}" x2="${horizEnd.toFixed(1)}" y2="${ey.toFixed(1)}" stroke="${color}" stroke-width="${sw}" opacity="${so}"/>`;
    // Pill background
    html += `<rect x="${rectX.toFixed(1)}" y="${rectY.toFixed(1)}" width="${pillW.toFixed(1)}" height="${pillH.toFixed(1)}" rx="3" ry="3" fill="${pillBg}" opacity="0.93"/>`;
    // Label text
    html += `<text x="${textX.toFixed(1)}" y="${ey.toFixed(1)}" font-family="${fontBase}" font-size="${fs}" font-weight="${fw}" fill="${textFill}" text-anchor="${anchor}" dominant-baseline="middle">${escSvg(name)}</text>`;
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
    const facingRight = true; // always label to the right in flyover mode
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

// ─── Component ────────────────────────────────────────────────────────────────

export function CityCanvas({
  graph, onSelectNode, selectedNodeId,
  darkMode = false, firstPerson = false, onExitFirstPerson,
  showLabelsFP = true, showLabelsOverhead = false, showClickLabels = true,
  flyover = false, flyoverLabelMode = 'none',
  flyoverSpeedMult = 1.0, flyoverArcHeightMult = 1.0,
  flyoverCameraHeightOffset = 1.5,
  onExitFlyover,
}: Props) {
  const mountRef        = useRef<HTMLDivElement>(null);
  const stateRef        = useRef<SceneState | null>(null);
  const onSelectRef     = useRef(onSelectNode);
  const onExitFPRef     = useRef(onExitFirstPerson);
  const onExitFlyoverRef = useRef(onExitFlyover);
  useEffect(() => { onSelectRef.current      = onSelectNode; },      [onSelectNode]);
  useEffect(() => { onExitFPRef.current      = onExitFirstPerson; }, [onExitFirstPerson]);
  useEffect(() => { onExitFlyoverRef.current = onExitFlyover; },     [onExitFlyover]);

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

    // Buildings
    const cityNodes  = computeCityLayout(graph);
    const buildingMap = new Map<string, BuildingEntry>();

    for (const node of cityNodes) {
      const color = new THREE.Color(node.color);
      const w = BUILDING_BASE * node.widthScale;
      const boxGeo = new THREE.BoxGeometry(w, node.height, w);

      const faceMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false });
      const face    = new THREE.Mesh(boxGeo, faceMat);
      face.position.set(node.cx, node.height / 2, node.cz);
      face.userData = { nodeId: node.id };

      const edgesGeo  = new THREE.EdgesGeometry(boxGeo);
      const edgesMat  = new THREE.LineBasicMaterial({ color });
      const edgesMesh = new THREE.LineSegments(edgesGeo, edgesMat);
      edgesMesh.position.set(node.cx, node.height / 2, node.cz);
      edgesMesh.userData = { nodeId: node.id };

      scene.add(face);
      scene.add(edgesMesh);
      buildingMap.set(node.id, { face, edges: edgesMesh, node });
    }

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
    if (cityNodes.length > 0) {
      const spread = Math.max(10, ...cityNodes.map((n) => Math.abs(n.cx)), ...cityNodes.map((n) => Math.abs(n.cz)));
      camera.position.set(0, spread * 0.9, spread * 1.4);
      controls.target.set(0, 0, 0);
      controls.update();
    }

    // ── Click → raycasting ─────────────────────────────────────────────────
    const raycaster = new THREE.Raycaster();
    const mouse     = new THREE.Vector2();

    function onClick(e: MouseEvent) {
      const s = stateRef.current;
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
        const hits = raycaster.intersectObjects([...buildingMap.values()].map((b) => b.face));
        if (hits.length > 0) {
          const nodeId = hits[0].object.userData.nodeId as string;
          const entry  = buildingMap.get(nodeId);
          if (entry) {
            const n = entry.node;
            onSelectRef.current({ id: n.id, name: n.name, createdBy: n.createdBy, createdTime: n.createdTime, databaseName: n.databaseName, databaseId: n.databaseId, notionUrl: n.notionUrl, fieldValues: n.fieldValues });
          }
        } else {
          onSelectRef.current(null);
        }
        return;
      }
      if (s?.flyoverActive) {
        const rect = renderer.domElement.getBoundingClientRect();
        mouse.x = ((e.clientX - rect.left) / rect.width)  *  2 - 1;
        mouse.y = -((e.clientY - rect.top)  / rect.height) *  2 + 1;
        raycaster.setFromCamera(mouse, camera);
        const hits = raycaster.intersectObjects([...buildingMap.values()].map((b) => b.face));
        if (hits.length > 0) {
          const nodeId = hits[0].object.userData.nodeId as string;
          const entry  = buildingMap.get(nodeId);
          if (entry) {
            const n = entry.node;
            onSelectRef.current({ id: n.id, name: n.name, createdBy: n.createdBy, createdTime: n.createdTime, databaseName: n.databaseName, databaseId: n.databaseId, notionUrl: n.notionUrl, fieldValues: n.fieldValues });
            s.flyoverPendingReroute = nodeId;
          }
        }
        return;
      }
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width)  *  2 - 1;
      mouse.y = -((e.clientY - rect.top)  / rect.height) *  2 + 1;
      raycaster.setFromCamera(mouse, camera);
      const hits = raycaster.intersectObjects([...buildingMap.values()].map((b) => b.face));
      if (hits.length > 0) {
        const nodeId = hits[0].object.userData.nodeId as string;
        const entry  = buildingMap.get(nodeId);
        if (entry) {
          const n = entry.node;
          onSelectRef.current({ id: n.id, name: n.name, createdBy: n.createdBy, createdTime: n.createdTime, databaseName: n.databaseName, databaseId: n.databaseId, notionUrl: n.notionUrl, fieldValues: n.fieldValues });
        }
      } else {
        if (raycaster.intersectObject(ground).length > 0) onSelectRef.current(null);
      }
    }

    function onKeyDown(e: KeyboardEvent) {
      const s = stateRef.current;
      if (s?.fpActive) {
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

    renderer.domElement.addEventListener("click", onClick);
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
        // First-person movement
        const speed = (s.fpKeys.has("ShiftLeft") || s.fpKeys.has("ShiftRight")) ? FP_SPRINT : FP_SPEED;
        const fwd   = new THREE.Vector3(-Math.sin(s.fpYaw), 0, -Math.cos(s.fpYaw));
        const rgt   = new THREE.Vector3( Math.cos(s.fpYaw), 0, -Math.sin(s.fpYaw));
        if (s.fpKeys.has("KeyW")) camera.position.addScaledVector(fwd,  speed * dt);
        if (s.fpKeys.has("KeyS")) camera.position.addScaledVector(fwd, -speed * dt);
        if (s.fpKeys.has("KeyA")) camera.position.addScaledVector(rgt, -speed * dt);
        if (s.fpKeys.has("KeyD")) camera.position.addScaledVector(rgt,  speed * dt);
        camera.position.y = FP_HEIGHT;
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
              (sp.material as THREE.SpriteMaterial).opacity = 0.45;
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
      }
    }
    animate();

    stateRef.current = {
      renderer, scene, camera, controls,
      buildingMap, labelSpriteMap, connectionLines: [], streetGroup, labelSprites,
      graphEdges: graph.edges, darkMode,
      fpActive: false, fpYaw: 0, fpPitch: 0, fpKeys: new Set(),
      overheadPos:    new THREE.Vector3(),
      overheadTarget: new THREE.Vector3(),
      animFrameId,
      prevTime: performance.now(),
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
    };

    return () => {
      cancelAnimationFrame(animFrameId);
      renderer.domElement.removeEventListener("click", onClick);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup",   onKeyUp);
      window.removeEventListener("resize",  onResize);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("pointerlockchange", onPointerLockChange);
      if (document.pointerLockElement === renderer.domElement) document.exitPointerLock();
      controls.dispose();
      for (const { face, edges: em } of buildingMap.values()) {
        face.geometry.dispose(); (face.material as THREE.Material).dispose();
        em.geometry.dispose();   (em.material   as THREE.Material).dispose();
      }
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
      renderer.dispose();
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
      if (mount.contains(labelSvg)) mount.removeChild(labelSvg);
      stateRef.current = null;
    };
  }, [graph, darkMode]);

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
      s.fpYaw   = 0;
      s.fpPitch = 0;
      s.fpActive = true;
      s.controls.enabled = false;
      s.streetGroup.visible = true;

      // requestPointerLock must be called close to a user gesture.
      // If it fails (SecurityError), we silently ignore — the user can click
      // the canvas to lock the pointer manually on their next interaction.
      try {
        const result = s.renderer.domElement.requestPointerLock();
        if (result instanceof Promise) result.catch(() => {});
      } catch { /* SecurityError: will retry on next canvas click */ }
    } else {
      // Exit first-person
      s.fpActive = false;
      s.fpKeys.clear();
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
  }, [selectedNodeId]);

  return <div ref={mountRef} style={{ width: "100%", height: "100%", position: "relative" }} />;
}
