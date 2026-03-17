"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import type { GraphData, NodeDetail } from "@/lib/types";
import {
  computeMountainLayout,
  sampleTerrainHeight,
  type MountainNode,
  type MountainRange,
} from "@/lib/mountainLayout";

// ─── Constants ────────────────────────────────────────────────────────────────

const FP_HEIGHT   = 1.8;   // base eye-level offset above terrain
const FP_SPEED    = 5;     // units/sec walking
const FP_SPRINT   = 14;    // units/sec sprinting
const FP_SENS     = 0.002; // mouse look sensitivity

const LABEL_NEAR  = 4;
const LABEL_FAR   = 14;
const OVERHEAD_LABEL_PRIORITY_COUNT  = 10;
const OVERHEAD_LABEL_HIDDEN_OPACITY  = 0.0;
const OVERHEAD_LABEL_MIN_OPACITY     = 0.25;
const OVERHEAD_LABEL_MAX_OPACITY     = 1.0;

const FLYOVER_BASE_SPEED    = 5.0;
const FLYOVER_LOOK_DURATION = 3.0;

const CONE_SEGMENTS = 6; // hexagonal base — faceted natural look

// ─── Types ────────────────────────────────────────────────────────────────────

type FlyoverLabelMode = 'none' | 'overhead' | 'center';

type FlyoverSegment = {
  type: 'arc' | 'fly';
  duration: number;
  nodeIdx: number;
  arcCx: number; arcCy: number; arcCz: number;
  arcRadius: number;
  arcStartAngle: number; arcEndAngle: number; arcCCW: boolean;
  flyStart: THREE.Vector3;
  flyEnd:   THREE.Vector3;
  lookAtTarget: THREE.Vector3;
};

type PeakEntry = {
  cone:  THREE.Mesh;
  node:  MountainNode;
};

type SceneState = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  peakMap: Map<string, PeakEntry>;
  ridgeMeshes: THREE.Mesh[];
  rangeLabelSprites: THREE.Sprite[];
  labelSpriteMap: Map<string, THREE.Sprite>;
  connectionLines: THREE.Line[];
  labelSprites: THREE.Sprite[];
  graphEdges: GraphData["edges"];
  ranges: MountainRange[];
  darkMode: boolean;
  // Hike (first-person) state
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
  showRangeLabels: boolean;
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
  flyoverLookFrom: THREE.Vector3;
  flyoverLookTo: THREE.Vector3;
  flyoverLookT: number;
  flyoverLookArcNode: number;
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
  showRangeLabels?: boolean;
  flyover?: boolean;
  flyoverLabelMode?: FlyoverLabelMode;
  flyoverSpeedMult?: number;
  flyoverArcHeightMult?: number;
  flyoverCameraHeightOffset?: number;
  onExitFlyover?: () => void;
  fitSceneTrigger?: number;
};

// ─── Camera fit ───────────────────────────────────────────────────────────────

function fitCameraToPeaks(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  peakMap: Map<string, PeakEntry>,
  padding = 1.12,
) {
  if (peakMap.size === 0) return;
  const bounds = new THREE.Box3();
  for (const { cone } of peakMap.values()) bounds.expandByObject(cone);
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
  const up    = new THREE.Vector3().crossVectors(right, forward).normalize();

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

// ─── Ridge mesh builder ───────────────────────────────────────────────────────

function buildRidgeMesh(range: MountainRange, darkMode: boolean): THREE.Mesh {
  const M = 32; // arc samples
  const baseColor = new THREE.Color(range.color);
  // Desaturate and darken for the ridge
  const hsl = { h: 0, s: 0, l: 0 };
  baseColor.getHSL(hsl);
  const ridgeColor = new THREE.Color().setHSL(hsl.h, hsl.s * 0.55, hsl.l * 0.45);

  const positions: number[] = [];
  const normals:   number[] = [];
  const indices:   number[] = [];

  const ridgeW = range.baseRadius * 0.28; // half-width of ridge base (lateral taper)

  for (let i = 0; i <= M; i++) {
    const t    = i / M;                                        // 0 → 1 along arc
    const theta = range.arcStart + t * range.arcSpread;        // angle along arc

    // Height of ridge crest using sin curve — tallest at mid-arc, tapers to horns
    const heightT = Math.pow(Math.sin(Math.PI * t), 0.5);
    const ridgeH  = range.ridgeHeight * heightT;

    // Arc point
    const ax = range.centerX + range.baseRadius * Math.cos(theta);
    const az = range.centerZ + range.baseRadius * Math.sin(theta);

    // Perpendicular to the arc tangent (points outward from arc)
    const tangentX = -Math.sin(theta);
    const tangentZ =  Math.cos(theta);
    const perpX    = -tangentZ;  // outward normal in XZ
    const perpZ    =  tangentX;

    // Each sample: 3 verts — outer base, ridge crest, inner base
    // Outer base (Y=0)
    positions.push(ax + perpX * ridgeW, 0,       az + perpZ * ridgeW);
    normals.push(perpX, 0, perpZ);
    // Ridge crest
    positions.push(ax, ridgeH, az);
    normals.push(0, 1, 0);
    // Inner base (Y=0)
    positions.push(ax - perpX * ridgeW, 0,       az - perpZ * ridgeW);
    normals.push(-perpX, 0, -perpZ);
  }

  // Build triangle strips: each column of 3 verts connects to the next
  for (let i = 0; i < M; i++) {
    const a = i * 3;
    const b = (i + 1) * 3;
    // Outer slope: [a0, b0, a1] and [b0, b1, a1]
    indices.push(a, b,     a + 1);
    indices.push(b, b + 1, a + 1);
    // Inner slope: [a1, b1, a2] and [b1, b2, a2]
    indices.push(a + 1, b + 1, a + 2);
    indices.push(b + 1, b + 2, a + 2);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("normal",   new THREE.Float32BufferAttribute(normals,   3));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    color: ridgeColor,
    roughness: 0.85,
    metalness: 0.0,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow    = true;
  mesh.receiveShadow = true;
  mesh.userData      = { isRidge: true, databaseId: range.databaseId };
  return mesh;
}

// ─── Peak cone builder ────────────────────────────────────────────────────────

/** Deterministic float in [0, 1] from any string. */
function hashFloat(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 0xffffffff;
}

function buildPeakCone(node: MountainNode, ridgeHeight: number): THREE.Mesh {
  const geo = new THREE.ConeGeometry(node.coneRadius, node.coneHeight, CONE_SEGMENTS, 1);

  // Per-peak luminance variation ±8% (seeded)
  const baseColor = new THREE.Color(node.color);
  const hsl = { h: 0, s: 0, l: 0 };
  baseColor.getHSL(hsl);
  const lVariation = (hashFloat(node.id + "lum") - 0.5) * 0.16; // ±8%
  const peakColor  = new THREE.Color().setHSL(hsl.h, hsl.s, Math.max(0, Math.min(1, hsl.l + lVariation)));

  const mat = new THREE.MeshStandardMaterial({
    color: peakColor,
    roughness: 0.75,
    metalness: 0.05,
  });

  const mesh = new THREE.Mesh(geo, mat);

  // Cone origin is at its geometric center; base sits on the ground plane (Y=0)
  mesh.position.set(node.cx, node.coneHeight / 2, node.cz);

  // Seeded Y-rotation so facets don't all align
  mesh.rotation.y = hashFloat(node.id + "rot") * Math.PI * 2;

  mesh.castShadow    = true;
  mesh.receiveShadow = true;
  mesh.userData      = { nodeId: node.id };
  return mesh;
}

// ─── Label sprite ─────────────────────────────────────────────────────────────

function makeLabelSprite(text: string, scale: number, darkMode: boolean): THREE.Sprite {
  const SIZE = 1024;
  const canvas = document.createElement("canvas");
  canvas.width  = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d")!;

  ctx.clearRect(0, 0, SIZE, SIZE);
  ctx.fillStyle    = darkMode ? "rgba(255,255,255,0.92)" : "rgba(0,0,0,0.88)";
  ctx.textAlign    = "center";
  ctx.textBaseline = "middle";

  const maxW   = SIZE * 0.88;
  let fontSize = Math.max(72, Math.min(200, SIZE / Math.max(1, text.length / 2.5)));
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
  const lineH = fontSize * 1.25;
  while (lines.length * lineH > SIZE * 0.88 && fontSize > 48) {
    fontSize -= 8;
    lines = wrapLines(fontSize);
  }
  ctx.font = `bold ${fontSize}px sans-serif`;
  const totalH = lines.length * lineH;
  const startY = SIZE / 2 - totalH / 2 + lineH / 2;
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], SIZE / 2, startY + i * lineH);
  }

  const texture      = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 16;
  const mat    = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(scale, scale, 1);
  sprite.visible = false;
  return sprite;
}

// ─── Range label sprite ───────────────────────────────────────────────────────

function makeRangeLabelSprite(text: string, color: string, darkMode: boolean): THREE.Sprite {
  const SIZE  = 1024;
  const canvas = document.createElement("canvas");
  canvas.width  = SIZE;
  canvas.height = SIZE / 3;
  const ctx = canvas.getContext("2d")!;

  const h = canvas.height;
  ctx.clearRect(0, 0, SIZE, h);

  // Pill background
  const pillW = SIZE * 0.9, pillH = h * 0.72;
  const rx    = 24;
  const px    = (SIZE - pillW) / 2;
  const py    = (h - pillH) / 2;
  ctx.fillStyle = darkMode ? "rgba(14,14,20,0.78)" : "rgba(255,255,255,0.82)";
  ctx.beginPath();
  ctx.moveTo(px + rx, py);
  ctx.lineTo(px + pillW - rx, py);
  ctx.quadraticCurveTo(px + pillW, py, px + pillW, py + rx);
  ctx.lineTo(px + pillW, py + pillH - rx);
  ctx.quadraticCurveTo(px + pillW, py + pillH, px + pillW - rx, py + pillH);
  ctx.lineTo(px + rx, py + pillH);
  ctx.quadraticCurveTo(px, py + pillH, px, py + pillH - rx);
  ctx.lineTo(px, py + rx);
  ctx.quadraticCurveTo(px, py, px + rx, py);
  ctx.closePath();
  ctx.fill();

  // Color accent dot
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(px + 36, h / 2, 10, 0, Math.PI * 2);
  ctx.fill();

  // Text
  const fontSize = Math.max(56, Math.min(110, SIZE / Math.max(1, text.length / 1.8)));
  ctx.font        = `600 ${fontSize}px 'DM Mono', monospace, sans-serif`;
  ctx.fillStyle   = darkMode ? "rgba(255,255,255,0.95)" : "rgba(14,14,20,0.95)";
  ctx.textAlign   = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(text, px + 62, h / 2, pillW - 80);

  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 16;
  const mat    = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  // Scale: wider pill proportions
  sprite.scale.set(12, 4, 1);
  sprite.visible = true;
  return sprite;
}

// ─── SVG overlay helpers (identical to CityCanvas) ────────────────────────────

function escSvg(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function mapDistanceToOpacity(
  distance: number, nearestDistance: number, furthestDistance: number,
  minOpacity = OVERHEAD_LABEL_MIN_OPACITY, maxOpacity = OVERHEAD_LABEL_MAX_OPACITY,
): number {
  if (!Number.isFinite(distance)) return maxOpacity;
  if (!Number.isFinite(nearestDistance) || !Number.isFinite(furthestDistance) || furthestDistance <= nearestDistance) return maxOpacity;
  const t = THREE.MathUtils.clamp((distance - nearestDistance) / (furthestDistance - nearestDistance), 0, 1);
  return THREE.MathUtils.lerp(maxOpacity, minOpacity, t);
}

function buildOverheadOpacityMap<T>(
  entries: T[],
  getKey: (e: T) => string,
  getDistance: (e: T) => number,
): Map<string, number> {
  const sorted      = [...entries].sort((a, b) => getDistance(a) - getDistance(b));
  const prioritized = sorted.slice(0, OVERHEAD_LABEL_PRIORITY_COUNT);
  const opacityMap  = new Map<string, number>();
  let nearestDistance  = Infinity;
  let furthestDistance = -Infinity;
  for (const e of prioritized) {
    const d = getDistance(e);
    nearestDistance  = Math.min(nearestDistance, d);
    furthestDistance = Math.max(furthestDistance, d);
  }
  for (let i = 0; i < sorted.length; i++) {
    const e = sorted[i];
    const d = getDistance(e);
    const opacity = i < OVERHEAD_LABEL_PRIORITY_COUNT
      ? mapDistanceToOpacity(d, nearestDistance, furthestDistance)
      : OVERHEAD_LABEL_HIDDEN_OPACITY;
    opacityMap.set(getKey(e), opacity);
  }
  return opacityMap;
}

function updateOverheadLabels(
  peakMap: Map<string, PeakEntry>,
  svg: SVGSVGElement,
  selectedId: string,
  connectedIds: Set<string>,
  darkMode: boolean,
  camera: THREE.PerspectiveCamera,
  W: number, H: number,
  vec: THREE.Vector3,
): void {
  const DIAG_X = 26, DIAG_Y = 54, HORIZ = 62, LABEL_H = 22, LABEL_PAD = 7;
  const textFill = darkMode ? "rgba(255,255,255,0.96)" : "rgba(14,14,20,0.96)";
  const pillBg   = darkMode ? "rgba(10,10,22,0.84)"   : "rgba(255,255,255,0.90)";
  const padX = 8, padY = 4;
  const fontBase = "'DM Mono',monospace";

  interface Item {
    id: string; name: string; isMain: boolean;
    sx: number; sy: number; color: string;
    distance: number; facingRight: boolean;
    ex: number; ey: number;
  }

  const items: Item[] = [];

  const project = (id: string, isMain: boolean) => {
    const e = peakMap.get(id);
    if (!e) return;
    vec.set(e.node.cx, e.node.peakY, e.node.cz);
    vec.project(camera);
    if (vec.z > 1) return;
    const sx = (vec.x + 1) / 2 * W;
    const sy = (-vec.y + 1) / 2 * H;
    if (sx < -300 || sx > W + 300 || sy < -300 || sy > H + 300) return;
    const distance = camera.position.distanceTo(new THREE.Vector3(e.node.cx, e.node.peakY, e.node.cz));
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

  const opacityById = buildOverheadOpacityMap(items, (i) => i.id, (i) => i.distance);

  items.sort((a, b) => a.ey - b.ey);
  const placed: Item[] = [];
  for (const item of items) {
    let ey = item.ey;
    const approxTW = Math.max(44, item.name.length * (item.isMain ? 7.6 : 7.1));
    const lx1 = item.facingRight ? item.ex + HORIZ : item.ex - HORIZ - approxTW;
    const lx2 = lx1 + approxTW;
    for (const p of placed) {
      const pTW  = Math.max(44, p.name.length * (p.isMain ? 7.6 : 7.1));
      const plx1 = p.facingRight ? p.ex + HORIZ : p.ex - HORIZ - pTW;
      const plx2 = plx1 + pTW;
      if (lx2 + 4 > plx1 && lx1 - 4 < plx2 && Math.abs(ey - p.ey) < LABEL_H + LABEL_PAD) {
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
    const opacity = opacityById.get(item.id) ?? OVERHEAD_LABEL_HIDDEN_OPACITY;
    const so  = (isMain ? 0.88 : 0.68) * opacity;
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

// ─── Flyover helpers (identical to CityCanvas) ────────────────────────────────

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function normalizeAngle(a: number): number {
  return ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
}

function arcAngleAt(start: number, end: number, ccw: boolean, t: number): number {
  return ccw
    ? start + normalizeAngle(end - start) * t
    : start - normalizeAngle(start - end) * t;
}

function computeFlyoverQueue(
  hubId: string,
  graphEdges: GraphData["edges"],
  peakMap: Map<string, PeakEntry>,
): string[] {
  const visited = new Set<string>([hubId]);
  const connectedIds: string[] = [];
  for (const edge of graphEdges) {
    let connId: string | null = null;
    if (edge.source === hubId) connId = edge.target;
    else if (edge.target === hubId) connId = edge.source;
    if (connId && !visited.has(connId) && peakMap.has(connId)) {
      visited.add(connId);
      connectedIds.push(connId);
    }
  }
  connectedIds.sort((a, b) => {
    const nA = peakMap.get(a)?.node, nB = peakMap.get(b)?.node;
    const tA = nA?.createdTime ?? null, tB = nB?.createdTime ?? null;
    if (tA && tB) return tB.localeCompare(tA);
    if (tA) return -1; if (tB) return 1;
    return (nA?.name ?? "").localeCompare(nB?.name ?? "");
  });
  return [hubId, ...connectedIds];
}

function computeFlyoverSegments(
  queue: string[],
  peakMap: Map<string, PeakEntry>,
  initialCamPos: THREE.Vector3,
  camHeightOffset: number,
  speedMult: number,
  radiusMult: number,
): FlyoverSegment[] {
  const N = queue.length;
  if (N === 0) return [];

  const circles = queue.map((id) => {
    const e = peakMap.get(id)!;
    const n = e.node;
    const r = Math.max(n.coneRadius * 0.6, n.coneRadius * radiusMult);
    return {
      cx: n.cx,
      cy: Math.max(0.3, n.peakY * (1 + camHeightOffset)),
      cz: n.cz,
      r,
      node: n,
    };
  });

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

  const exitAngles: number[] = [];
  const arcCCWs:    boolean[] = [];
  let prevExitX = initialCamPos.x;
  let prevExitZ = initialCamPos.z;

  for (let i = 0; i < N - 1; i++) {
    const ci  = circles[i];
    const θ   = entryAngles[i];
    const entX = ci.cx + ci.r * Math.cos(θ);
    const entZ = ci.cz + ci.r * Math.sin(θ);
    const adx  = entX - prevExitX, adz = entZ - prevExitZ;
    const adLen = Math.sqrt(adx * adx + adz * adz);
    const tangDot = adLen > 0.01 ? (adx * (-Math.sin(θ)) + adz * Math.cos(θ)) / adLen : 0;
    const preferCCW = tangDot >= 0;

    const ep1x = circles[i + 1].cx + circles[i + 1].r * Math.cos(entryAngles[i + 1]);
    const ep1z = circles[i + 1].cz + circles[i + 1].r * Math.sin(entryAngles[i + 1]);
    const dvx  = ep1x - ci.cx, dvz = ep1z - ci.cz;
    const d    = Math.sqrt(dvx * dvx + dvz * dvz);

    if (d <= ci.r + 0.1) {
      exitAngles[i] = θ + (preferCCW ? Math.PI : -Math.PI);
      arcCCWs[i]    = preferCCW;
    } else {
      const alpha   = Math.atan2(dvz, dvx);
      const beta    = Math.acos(Math.min(1, ci.r / d));
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
  const flyEnd0  = new THREE.Vector3(ep0x, ep0y, ep0z);
  const flyDist0 = initialCamPos.distanceTo(flyEnd0);
  const flyDur0  = Math.max(0.5, flyDist0 / (FLYOVER_BASE_SPEED * speedMult));
  const lookC0   = new THREE.Vector3(circles[0].cx, circles[0].node.peakY, circles[0].cz);
  segs.push({
    type: 'fly', duration: flyDur0, nodeIdx: 0,
    arcCx: 0, arcCy: 0, arcCz: 0, arcRadius: 0, arcStartAngle: 0, arcEndAngle: 0, arcCCW: true,
    flyStart: initialCamPos.clone(), flyEnd: flyEnd0,
    lookAtTarget: lookC0.clone(),
  });

  for (let i = 0; i < N; i++) {
    const ci     = circles[i];
    const isLast = i === N - 1;
    const arcEnd = isLast
      ? (arcCCWs[i] ? entryAngles[i] + Math.PI : entryAngles[i] - Math.PI)
      : exitAngles[i];
    const arcSweep = arcCCWs[i]
      ? normalizeAngle(arcEnd - entryAngles[i])
      : normalizeAngle(entryAngles[i] - arcEnd);
    const arcDur   = Math.max(0.3, arcSweep * ci.r / (FLYOVER_BASE_SPEED * speedMult));
    const lookArcTarget = isLast
      ? new THREE.Vector3(ci.cx, ci.node.peakY, ci.cz)
      : new THREE.Vector3(circles[i + 1].cx, circles[i + 1].node.peakY, circles[i + 1].cz);

    segs.push({
      type: 'arc', duration: arcDur, nodeIdx: i,
      arcCx: ci.cx, arcCy: ci.cy, arcCz: ci.cz,
      arcRadius: ci.r, arcStartAngle: entryAngles[i], arcEndAngle: arcEnd, arcCCW: arcCCWs[i],
      flyStart: new THREE.Vector3(), flyEnd: new THREE.Vector3(),
      lookAtTarget: lookArcTarget,
    });

    if (!isLast) {
      const exitX  = ci.cx + ci.r * Math.cos(exitAngles[i]);
      const exitY  = ci.cy;
      const exitZ  = ci.cz + ci.r * Math.sin(exitAngles[i]);
      const ci1    = circles[i + 1];
      const entX1  = ci1.cx + ci1.r * Math.cos(entryAngles[i + 1]);
      const entY1  = ci1.cy;
      const entZ1  = ci1.cz + ci1.r * Math.sin(entryAngles[i + 1]);
      const flyDist = Math.sqrt((entX1 - exitX) ** 2 + (entY1 - exitY) ** 2 + (entZ1 - exitZ) ** 2);
      const flyDur  = Math.max(0.5, flyDist / (FLYOVER_BASE_SPEED * speedMult));
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
  peakMap: Map<string, PeakEntry>,
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
    const e = peakMap.get(id);
    if (!e) return;
    vec.set(e.node.cx, e.node.peakY, e.node.cz);
    vec.project(camera);
    if (vec.z > 1) return;
    const sx = (vec.x + 1) / 2 * W;
    const sy = (-vec.y + 1) / 2 * H;
    if (sx < -300 || sx > W + 300 || sy < -300 || sy > H + 300) return;
    const ex = sx + DIAG_X, ey = sy - DIAG_Y;
    const horizEnd = ex + HORIZ;
    const { name, color } = e.node;
    const fs = isMain ? 12 : 11, fw = isMain ? "600" : "400", sw = isMain ? "1.7" : "1.3";
    const approxTW = Math.max(44, name.length * (isMain ? 7.6 : 7.1));
    const pillW = approxTW + padX * 2, pillH = fs + padY * 2;
    const rectX = horizEnd, rectY = ey - pillH / 2;
    const textX = horizEnd + padX;
    html += `<circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="2.5" fill="${color}" opacity="${(0.92*opacity).toFixed(2)}"/>`;
    html += `<line x1="${sx.toFixed(1)}" y1="${sy.toFixed(1)}" x2="${ex.toFixed(1)}" y2="${ey.toFixed(1)}" stroke="${color}" stroke-width="${sw}" opacity="${(0.88*opacity).toFixed(2)}"/>`;
    html += `<line x1="${ex.toFixed(1)}" y1="${ey.toFixed(1)}" x2="${horizEnd.toFixed(1)}" y2="${ey.toFixed(1)}" stroke="${color}" stroke-width="${sw}" opacity="${(0.88*opacity).toFixed(2)}"/>`;
    html += `<rect x="${rectX.toFixed(1)}" y="${rectY.toFixed(1)}" width="${pillW.toFixed(1)}" height="${pillH.toFixed(1)}" rx="3" ry="3" fill="${pillBg}" opacity="${(0.93*opacity).toFixed(2)}"/>`;
    html += `<text x="${textX.toFixed(1)}" y="${ey.toFixed(1)}" font-family="${fontBase}" font-size="${fs}" font-weight="${fw}" fill="${textFill}" text-anchor="start" dominant-baseline="middle" opacity="${opacity.toFixed(2)}">${escSvg(name)}</text>`;
  };

  if (currentId) renderLabel(currentId, true, currentOpacity);
  if (nextId && nextId !== currentId) renderLabel(nextId, false, nextOpacity);
  svg.innerHTML = html;
}

function toNodeDetail(node: MountainNode): NodeDetail {
  return {
    id: node.id, name: node.name,
    createdBy: node.createdBy, createdTime: node.createdTime,
    databaseName: node.databaseName, databaseId: node.databaseId,
    notionUrl: node.notionUrl, fieldValues: node.fieldValues,
  };
}

// ─── Component ────────────────────────────────────────────────────────────────

export function MountainCanvas({
  graph, onSelectNode, selectedNodeId,
  darkMode = false, firstPerson = false, onExitFirstPerson,
  showLabelsFP = true, showLabelsOverhead = false, showClickLabels = true,
  showRangeLabels = true,
  flyover = false, flyoverLabelMode = 'none',
  flyoverSpeedMult = 1.0, flyoverArcHeightMult = 1.0,
  flyoverCameraHeightOffset = 1.5,
  onExitFlyover,
  fitSceneTrigger = 0,
}: Props) {
  const mountRef         = useRef<HTMLDivElement>(null);
  const stateRef         = useRef<SceneState | null>(null);
  const onSelectRef      = useRef(onSelectNode);
  const onExitFPRef      = useRef(onExitFirstPerson);
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
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
    mount.appendChild(renderer.domElement);

    // SVG overlay for overhead click-labels
    const labelSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg") as SVGSVGElement;
    labelSvg.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;overflow:visible;";
    mount.appendChild(labelSvg);

    const scene  = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, W / H, 0.1, 1000);
    camera.position.set(0, 28, 40);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping     = true;
    controls.dampingFactor     = 0.08;
    controls.minPolarAngle     = Math.PI * 0.05;
    controls.maxPolarAngle     = Math.PI * 0.48;
    controls.minDistance       = 2;
    controls.maxDistance       = 300;
    controls.screenSpacePanning = false;

    // Ambient + directional with shadows
    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const dir = new THREE.DirectionalLight(0xffffff, 0.65);
    dir.position.set(30, 60, 20);
    dir.castShadow             = true;
    dir.shadow.mapSize.width   = 2048;
    dir.shadow.mapSize.height  = 2048;
    dir.shadow.camera.near     = 0.5;
    dir.shadow.camera.far      = 500;
    dir.shadow.camera.left     = -200;
    dir.shadow.camera.right    = 200;
    dir.shadow.camera.top      = 200;
    dir.shadow.camera.bottom   = -200;
    dir.shadow.bias            = -0.0005;
    scene.add(dir);

    // Ground plane — receives shadows
    const groundGeo = new THREE.PlaneGeometry(600, 600);
    const groundMat = new THREE.MeshStandardMaterial({
      color: darkMode ? 0x1a1a1a : 0xf7f3ed,
      roughness: 1.0, metalness: 0.0,
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x  = -Math.PI / 2;
    ground.position.y  = -0.01;
    ground.receiveShadow = true;
    ground.name = "ground";
    scene.add(ground);

    const gridColor = darkMode ? 0x222222 : 0xe8e2d8;
    const grid = new THREE.GridHelper(600, 300, gridColor, gridColor);
    grid.position.y = -0.01;
    scene.add(grid);

    // ── Build mountains ──────────────────────────────────────────────────
    const { nodes: mountainNodes, ranges } = computeMountainLayout(graph);
    const peakMap = new Map<string, PeakEntry>();

    const ridgeMeshes: THREE.Mesh[] = [];

    // Peak cones
    for (const node of mountainNodes) {
      const range      = ranges[node.rangeIndex];
      const ridgeH     = range?.ridgeHeight ?? 0;
      const cone       = buildPeakCone(node, ridgeH);
      scene.add(cone);
      peakMap.set(node.id, { cone, node });
    }

    // Peak name labels (visible in hike mode)
    const labelSprites: THREE.Sprite[] = [];
    const labelSpriteMap = new Map<string, THREE.Sprite>();
    for (const node of mountainNodes) {
      const sprite = makeLabelSprite(node.name, node.coneRadius * 1.6, darkMode);
      sprite.position.set(node.cx, node.peakY + 1.2, node.cz);
      scene.add(sprite);
      labelSprites.push(sprite);
      labelSpriteMap.set(node.id, sprite);
    }

    // Range label sprites — float at 1.5× tallest peak per range
    const rangeLabelSprites: THREE.Sprite[] = [];
    for (const range of ranges) {
      const peaksInRange = mountainNodes.filter((n) => n.rangeIndex === ranges.indexOf(range));
      const maxPeakY     = peaksInRange.reduce((m, n) => Math.max(m, n.peakY), 0);
      const labelY       = maxPeakY * 1.5;
      const sprite       = makeRangeLabelSprite(range.databaseName, range.color, darkMode);
      // Position at the arc midpoint of the range
      const arcMid = range.arcStart + range.arcSpread / 2;
      const labelX = range.centerX + range.baseRadius * Math.cos(arcMid);
      const labelZ = range.centerZ + range.baseRadius * Math.sin(arcMid);
      sprite.position.set(labelX, labelY, labelZ);
      scene.add(sprite);
      rangeLabelSprites.push(sprite);
    }

    // Fit camera to scene
    if (mountainNodes.length > 0) fitCameraToPeaks(camera, controls, peakMap);

    // ── Raycasting ───────────────────────────────────────────────────────
    const raycaster   = new THREE.Raycaster();
    const mouse       = new THREE.Vector2();
    const pointerDown = { x: 0, y: 0, moved: false };
    const CLICK_DRAG_THRESHOLD = 5;

    function setRayFromPointer(e: MouseEvent | PointerEvent) {
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x =  ((e.clientX - rect.left) / rect.width)  * 2 - 1;
      mouse.y = -((e.clientY - rect.top)  / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);
    }

    function hitPeakFromPointer(e: MouseEvent | PointerEvent): PeakEntry | null {
      setRayFromPointer(e);
      const hits = raycaster.intersectObjects([...peakMap.values()].map((p) => p.cone));
      if (hits.length === 0) return null;
      const nodeId = hits[0].object.userData.nodeId as string;
      return peakMap.get(nodeId) ?? null;
    }

    function onPointerDown(e: PointerEvent) {
      if (e.button === 0) {
        try { renderer.domElement.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      }
      pointerDown.x = e.clientX;
      pointerDown.y = e.clientY;
      pointerDown.moved = false;
    }

    function onPointerMove(e: PointerEvent) {
      if (pointerDown.moved) return;
      if (Math.hypot(e.clientX - pointerDown.x, e.clientY - pointerDown.y) > CLICK_DRAG_THRESHOLD) {
        pointerDown.moved = true;
      }
    }

    function onPointerUp(e: PointerEvent) {
      if (e.button !== 0) return;
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
        const hits = raycaster.intersectObjects([...peakMap.values()].map((p) => p.cone));
        if (hits.length > 0) {
          const nodeId = hits[0].object.userData.nodeId as string;
          const entry  = peakMap.get(nodeId);
          if (entry) onSelectRef.current(toNodeDetail(entry.node));
        } else {
          onSelectRef.current(null);
        }
        return;
      }

      if (s?.flyoverActive) {
        const entry = hitPeakFromPointer(e);
        if (entry) {
          onSelectRef.current(toNodeDetail(entry.node));
          s.flyoverPendingReroute = entry.node.id;
        }
        return;
      }

      const entry = hitPeakFromPointer(e);
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
        s.fpKeys.add(e.code);
      } else if (e.key === "Escape") {
        if (s?.flyoverActive) onExitFlyoverRef.current?.();
        else onSelectRef.current(null);
      }
    }
    function onKeyUp(e: KeyboardEvent) {
      stateRef.current?.fpKeys.delete(e.code);
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
        if (s?.fpActive) onExitFPRef.current?.();
      }
    }

    renderer.domElement.addEventListener("pointerdown",       onPointerDown);
    renderer.domElement.addEventListener("pointermove",       onPointerMove);
    renderer.domElement.addEventListener("pointerup",         onPointerUp);
    window.addEventListener("keydown",                        onKeyDown);
    window.addEventListener("keyup",                          onKeyUp);
    document.addEventListener("mousemove",                    onMouseMove);
    document.addEventListener("pointerlockchange",            onPointerLockChange);

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

      const s       = stateRef.current;
      const nowMs   = performance.now();
      const dt      = s ? Math.min((nowMs - s.prevTime) / 1000, 0.1) : 0;
      if (s) s.prevTime = nowMs;

      const flyoverWasActive = !!s?.flyoverActive;

      if (s?.fpActive) {
        // Terrain-following hike mode
        const speed = (s.fpKeys.has("ShiftLeft") || s.fpKeys.has("ShiftRight")) ? FP_SPRINT : FP_SPEED;
        const fwd = new THREE.Vector3(-Math.sin(s.fpYaw), 0, -Math.cos(s.fpYaw));
        const rgt = new THREE.Vector3( Math.cos(s.fpYaw), 0, -Math.sin(s.fpYaw));
        if (s.fpKeys.has("KeyW")) camera.position.addScaledVector(fwd,  speed * dt);
        if (s.fpKeys.has("KeyS")) camera.position.addScaledVector(fwd, -speed * dt);
        if (s.fpKeys.has("KeyA")) camera.position.addScaledVector(rgt, -speed * dt);
        if (s.fpKeys.has("KeyD")) camera.position.addScaledVector(rgt,  speed * dt);
        // Follow terrain elevation
        const terrainH = sampleTerrainHeight(camera.position.x, camera.position.z, s.ranges);
        camera.position.y = terrainH + FP_HEIGHT;
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
          s.flyoverQueue    = computeFlyoverQueue(rid, s.graphEdges, s.peakMap);
          s.flyoverQueueIndex = 0;
          s.flyoverSegments = computeFlyoverSegments(
            s.flyoverQueue, s.peakMap, camera.position.clone(),
            s.flyoverCameraHeightOffset, s.flyoverSpeedMult, s.flyoverArcHeightMult,
          );
          s.flyoverSegIdx  = 0;
          s.flyoverSegT    = 0;
          s.flyoverLookArcNode = -1;
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
            s.flyoverLookFrom.set(
              s.flyoverLookFrom.x + (s.flyoverLookTo.x - s.flyoverLookFrom.x) * lp,
              s.flyoverLookFrom.y + (s.flyoverLookTo.y - s.flyoverLookFrom.y) * lp,
              s.flyoverLookFrom.z + (s.flyoverLookTo.z - s.flyoverLookFrom.z) * lp,
            );
            s.flyoverLookTo.copy(seg.lookAtTarget);
            s.flyoverLookT       = 0;
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
            if (s.flyoverSegIdx >= s.flyoverSegments.length) exitFlyover();
          }
        }
      } else {
        controls.update();
      }

      // ── Label visibility ───────────────────────────────────────────────
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
        // Range label visibility
        for (const sp of s.rangeLabelSprites) {
          sp.visible = s.showRangeLabels && !s.fpActive;
        }

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
            sp.visible = false;
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

      // ── Overhead label overlay ─────────────────────────────────────────
      if (s && !s.fpActive) {
        if (flyoverWasActive && s.flyoverLabelMode === 'overhead') {
          updateFlyoverOverheadLabels(
            s.peakMap, s.labelOverlaySvg,
            flyLabelId, flyLabelOp, null, 0,
            s.darkMode, camera, mount!.clientWidth, mount!.clientHeight, s.projVec,
          );
        } else if (flyoverWasActive) {
          if (s.labelOverlaySvg.innerHTML !== "") s.labelOverlaySvg.innerHTML = "";
        } else if (s.selectedNodeIdForLabels && s.showClickLabels && !s.flyoverActive) {
          updateOverheadLabels(
            s.peakMap, s.labelOverlaySvg,
            s.selectedNodeIdForLabels, s.connectedNodeIdsForLabels,
            s.darkMode, camera, mount!.clientWidth, mount!.clientHeight, s.projVec,
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
      peakMap, ridgeMeshes, rangeLabelSprites, labelSpriteMap,
      connectionLines: [], labelSprites,
      graphEdges: graph.edges, ranges, darkMode,
      fpActive: false, fpYaw: 0, fpPitch: 0, fpKeys: new Set(),
      overheadPos:    new THREE.Vector3(),
      overheadTarget: new THREE.Vector3(),
      animFrameId, prevTime: performance.now(),
      showLabelsFP, showLabelsOverhead, showClickLabels, showRangeLabels,
      labelOverlaySvg: labelSvg,
      selectedNodeIdForLabels: null,
      connectedNodeIdsForLabels: new Set(),
      projVec: new THREE.Vector3(),
      flyoverActive: false,
      flyoverQueue: [], flyoverQueueIndex: 0,
      flyoverSegments: [], flyoverSegIdx: 0, flyoverSegT: 0,
      flyoverLabelMode, flyoverSpeedMult, flyoverArcHeightMult, flyoverCameraHeightOffset,
      flyoverPendingReroute: null,
      flyoverLookFrom: new THREE.Vector3(),
      flyoverLookTo:   new THREE.Vector3(),
      flyoverLookT: 1, flyoverLookArcNode: -1,
    };

    return () => {
      cancelAnimationFrame(animFrameId);
      renderer.domElement.removeEventListener("pointerdown",    onPointerDown);
      renderer.domElement.removeEventListener("pointermove",    onPointerMove);
      renderer.domElement.removeEventListener("pointerup",      onPointerUp);
      window.removeEventListener("keydown",                     onKeyDown);
      window.removeEventListener("keyup",                       onKeyUp);
      window.removeEventListener("resize",                      onResize);
      document.removeEventListener("mousemove",                 onMouseMove);
      document.removeEventListener("pointerlockchange",         onPointerLockChange);
      if (document.pointerLockElement === renderer.domElement) document.exitPointerLock();
      controls.dispose();
      for (const { cone } of peakMap.values()) {
        cone.geometry.dispose();
        (cone.material as THREE.Material).dispose();
      }
      for (const mesh of ridgeMeshes) {
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      }
      for (const sp of [...labelSprites, ...rangeLabelSprites]) {
        sp.geometry.dispose();
        (sp.material as THREE.SpriteMaterial).map?.dispose();
        (sp.material as THREE.SpriteMaterial).dispose();
      }
      groundGeo.dispose(); groundMat.dispose();
      renderer.dispose();
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
      if (mount.contains(labelSvg))            mount.removeChild(labelSvg);
      stateRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, darkMode]);

  // ── Fit scene on demand ───────────────────────────────────────────────────
  useEffect(() => {
    const s = stateRef.current;
    if (!s || s.fpActive || s.flyoverActive) return;
    fitCameraToPeaks(s.camera, s.controls, s.peakMap);
  }, [fitSceneTrigger]);

  // ── Hike (first-person) toggle ────────────────────────────────────────────
  useEffect(() => {
    const s = stateRef.current;
    if (!s) return;

    if (firstPerson) {
      s.overheadPos.copy(s.camera.position);
      s.overheadTarget.copy(s.controls.target);
      // Drop to terrain at the current orbit target
      const terrainH = sampleTerrainHeight(s.controls.target.x, s.controls.target.z, s.ranges);
      s.camera.position.set(s.controls.target.x, terrainH + FP_HEIGHT, s.controls.target.z + 6);
      s.fpYaw   = 0;
      s.fpPitch = 0;
      s.fpActive = true;
      s.controls.enabled = false;
      if (s.labelOverlaySvg.innerHTML !== "") s.labelOverlaySvg.innerHTML = "";
      try {
        const result = s.renderer.domElement.requestPointerLock();
        if (result instanceof Promise) result.catch(() => {});
      } catch { /* SecurityError: retry on next click */ }
    } else {
      s.fpActive = false;
      s.fpKeys.clear();
      s.controls.enabled = true;
      s.camera.position.copy(s.overheadPos);
      s.controls.target.copy(s.overheadTarget);
      s.camera.rotation.set(0, 0, 0);
      s.controls.update();
      if (document.pointerLockElement === s.renderer.domElement) document.exitPointerLock();
    }
  }, [firstPerson]);

  // ── Flyover toggle ────────────────────────────────────────────────────────
  useEffect(() => {
    const s = stateRef.current;
    if (!s) return;

    if (flyover && selectedNodeId) {
      const hubEntry = s.peakMap.get(selectedNodeId);
      if (!hubEntry) return;
      s.overheadPos.copy(s.camera.position);
      s.overheadTarget.copy(s.controls.target);
      s.flyoverQueue    = computeFlyoverQueue(selectedNodeId, s.graphEdges, s.peakMap);
      s.flyoverQueueIndex = 0;
      s.flyoverSegments = computeFlyoverSegments(
        s.flyoverQueue, s.peakMap, s.camera.position.clone(),
        s.flyoverCameraHeightOffset, s.flyoverSpeedMult, s.flyoverArcHeightMult,
      );
      s.flyoverSegIdx  = 0;
      s.flyoverSegT    = 0;
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

  // ── Sync flyover settings ─────────────────────────────────────────────────
  useEffect(() => {
    const s = stateRef.current;
    if (!s) return;
    s.flyoverLabelMode         = flyoverLabelMode;
    s.flyoverSpeedMult         = flyoverSpeedMult;
    s.flyoverArcHeightMult     = flyoverArcHeightMult;
    s.flyoverCameraHeightOffset = flyoverCameraHeightOffset;
  }, [flyoverLabelMode, flyoverSpeedMult, flyoverArcHeightMult, flyoverCameraHeightOffset]);

  // ── Sync label settings ───────────────────────────────────────────────────
  useEffect(() => {
    const s = stateRef.current;
    if (!s) return;
    s.showLabelsFP      = showLabelsFP;
    s.showLabelsOverhead = showLabelsOverhead;
    s.showClickLabels   = showClickLabels;
  }, [showLabelsFP, showLabelsOverhead, showClickLabels]);

  // ── Sync range label toggle ───────────────────────────────────────────────
  useEffect(() => {
    const s = stateRef.current;
    if (!s) return;
    s.showRangeLabels = showRangeLabels;
  }, [showRangeLabels]);

  // ── Selection: highlight/dim + tip-to-tip connection lines ───────────────
  useEffect(() => {
    const s = stateRef.current;
    if (!s) return;

    const { scene, peakMap, graphEdges } = s;

    for (const line of s.connectionLines) {
      scene.remove(line);
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
    }
    s.connectionLines = [];

    if (!selectedNodeId) {
      s.selectedNodeIdForLabels = null;
      s.connectedNodeIdsForLabels = new Set();
      // Restore full opacity for all peaks and ridges
      for (const { cone } of peakMap.values()) {
        const mat = cone.material as THREE.MeshStandardMaterial;
        mat.transparent = false;
        mat.opacity = 1.0;
        mat.needsUpdate = true;
      }
      return;
    }

    const connectedIds = new Set<string>();
    for (const edge of graphEdges) {
      if (edge.source === selectedNodeId) connectedIds.add(edge.target);
      else if (edge.target === selectedNodeId) connectedIds.add(edge.source);
    }

    s.selectedNodeIdForLabels   = selectedNodeId;
    s.connectedNodeIdsForLabels = connectedIds;

    // Dim peaks
    for (const [id, { cone }] of peakMap) {
      const mat = cone.material as THREE.MeshStandardMaterial;
      mat.transparent = true;
      mat.needsUpdate = true;
      if (id === selectedNodeId)     mat.opacity = 1.00;
      else if (connectedIds.has(id)) mat.opacity = 0.75;
      else                           mat.opacity = 0.15;
    }


    // Tip-to-tip connection lines
    const selectedEntry = peakMap.get(selectedNodeId);
    if (!selectedEntry) return;
    const lineColor = s.darkMode ? 0xffffff : 0x222222;
    const lineMat   = new THREE.LineBasicMaterial({ color: lineColor, opacity: 0.55, transparent: true });

    for (const connId of connectedIds) {
      const conn = peakMap.get(connId);
      if (!conn) continue;
      const pts = [
        new THREE.Vector3(selectedEntry.node.cx, selectedEntry.node.peakY, selectedEntry.node.cz),
        new THREE.Vector3(conn.node.cx,           conn.node.peakY,           conn.node.cz),
      ];
      const geo  = new THREE.BufferGeometry().setFromPoints(pts);
      const line = new THREE.Line(geo, lineMat);
      scene.add(line);
      s.connectionLines.push(line);
    }
  }, [selectedNodeId]);

  return <div ref={mountRef} style={{ width: "100%", height: "100%", position: "relative" }} />;
}
