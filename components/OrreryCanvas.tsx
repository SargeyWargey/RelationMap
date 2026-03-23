"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import type { GraphData, GraphNode, NodeDetail } from "@/lib/types";
import type { OrreryConfig } from "@/lib/orreryTypes";
import {
  distributeGalaxies,
  distributeStarsInGalaxy,
  assignGalaxyShape,
  assignGalaxyColor,
  assignStarColor,
  assignPlanetType,
  assignMoonType,
  computeOrbitalParams,
  TIER_SIZE,
  type Vec3,
  type TierNode,
  type PlanetType,
  type MoonType,
} from "@/lib/orreryLayout";

// ── Types ─────────────────────────────────────────────────────────────────────

export type OrreryScale = "universe" | "galaxy" | "solar-system" | "planet";

export type HoverInfo = {
  name: string;
  tier: "galaxy" | "star" | "planet" | "moon";
  databaseName: string;
  connectionCount: number;
  createdTime: string;
};

type Label = {
  id: string;
  text: string;
  subtext?: string;
  x: number;
  y: number;
  opacity: number;
};

type StarOrbitState = {
  starId: string;
  orbitalRadius: number;
  angularSpeed: number;
  inclination: number;
  eccentricity: number;
  phase: number;
  yOffset: number;
};

type PlanetOrbitState = {
  planetId: string;
  orbitalRadius: number;
  angularSpeed: number;
  inclination: number;
  eccentricity: number;
  phase: number;
  planetType: PlanetType;
  normalizedSize: number;
  meshIndex: number;
};

type MoonOrbitState = {
  moonId: string;
  orbitalRadius: number;
  angularSpeed: number;
  inclination: number;
  eccentricity: number;
  phase: number;
  moonType: MoonType;
  meshIndex: number;
};

type GalaxyEntry = {
  id: string;
  node: GraphNode;
  worldPos: Vec3;
  group: THREE.Group;
  pointCloud: THREE.Points;
  hitbox: THREE.Mesh;
  rotationSpeed: number;
  color: string;
};

type SceneState = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  animFrameId: number;
  prevTime: number;
  // Background
  bgStars: THREE.Points;
  nebulaMeshes: THREE.Mesh[];
  // Universe scale
  universeGroup: THREE.Group;
  galaxyEntries: GalaxyEntry[];
  // Galaxy scale
  galaxyScaleGroup: THREE.Group;
  starMeshes: THREE.Mesh[];
  starOrbits: StarOrbitState[];
  starIdForMesh: Map<THREE.Mesh, string>;
  // Solar-system scale
  solarSystemGroup: THREE.Group;
  planetMeshes: THREE.Mesh[];
  planetOrbits: PlanetOrbitState[];
  orbitalRings: THREE.Line[];
  asteroidBelts: THREE.InstancedMesh[];
  planetIdForMesh: Map<THREE.Mesh, string>;
  // Planet scale
  planetGroup: THREE.Group;
  moonMeshes: THREE.Mesh[];
  moonOrbits: MoonOrbitState[];
  ringParticles: THREE.InstancedMesh | null;
  moonIdForMesh: Map<THREE.Mesh, string>;
  connectionArcs: THREE.Line[];
  starBackgroundLight: THREE.PointLight | null;
  // Scale / transition state
  scale: OrreryScale;
  transitioning: boolean;
  transitionProgress: number;
  transitionFrom: THREE.Vector3;
  transitionFromTarget: THREE.Vector3;
  transitionTo: THREE.Vector3;
  transitionToTarget: THREE.Vector3;
  onTransitionEnd: (() => void) | null;
  // Selected IDs
  selectedGalaxyId: string | null;
  selectedStarId: string | null;
  selectedPlanetId: string | null;
  selectedMoonId: string | null;
  // Hover
  hoveredGalaxyId: string | null;
  hoveredStarId: string | null;
  hoveredPlanetId: string | null;
  hoveredMoonId: string | null;
  hoverChangedAt: number;     // timestamp of last hover ID change (for debounce)
  lastEmittedHoverId: string | null; // ID last sent via onHover (for debounce)
  // Interaction
  lastInteraction: number;
  autoOrbiting: boolean;
  mouse: THREE.Vector2;
  raycaster: THREE.Raycaster;
};

type PropsRef = {
  speedMultiplier: number;
  paused: boolean;
  onScaleChange?: Props["onScaleChange"];
  onHover?: Props["onHover"];
  onSelectNode?: Props["onSelectNode"];
};

type Props = {
  graphData: GraphData;
  orreryConfig: OrreryConfig;
  speedMultiplier?: number;
  paused?: boolean;
  onScaleChange?: (
    scale: OrreryScale,
    path: { galaxyName?: string; starName?: string; planetName?: string },
  ) => void;
  onHover?: (info: HoverInfo | null) => void;
  onSelectNode?: (detail: NodeDetail | null) => void;
  /** Ref that will be populated with the goBack function — lets parent trigger back-navigation */
  backRef?: React.MutableRefObject<(() => void) | null>;
};

// ── Constants ─────────────────────────────────────────────────────────────────

const UNIVERSE_SPREAD      = 2000;
const AUTO_ORBIT_DELAY_MS  = 4000;
const AUTO_ORBIT_SPEED     = 0.06;
const TRANSITION_DURATION  = 2.0;
const BG_STAR_COUNT        = 3500;
const BG_STAR_SPREAD       = 8000;
const NEBULA_COUNT         = 7;
const GALAXY_CLOUD_DENSITY = 250;
const STAR_GALAXY_DIST     = 300;
const SOLAR_CAM_DIST       = 160;
const PLANET_CAM_DIST      = 30;

// Solar system orbital layout
const SS_BASE_RADIUS  = 14;
const SS_SPREAD       = 70;
const SS_SPEED_BASE   = 0.20;   // rad/s innermost planet
const SS_MAX_INCL     = 0.22;   // ~12.5°

// Moon orbital layout
const MOON_BASE_RADIUS = 4.5;
const MOON_SPREAD      = 16;
const MOON_SPEED_BASE  = 0.40;
const MOON_MAX_INCL    = 0.35;

// Asteroid belt
const BELT_PARTICLE_COUNT = 600;

// Ring system
const RING_PARTICLE_COUNT = 800;

// ── Texture generators ────────────────────────────────────────────────────────

function makeCircleTexture(size = 64): THREE.Texture {
  const cv = document.createElement("canvas");
  cv.width = size; cv.height = size;
  const ctx = cv.getContext("2d")!;
  const cx = size / 2;
  const g = ctx.createRadialGradient(cx, cx, 0, cx, cx, cx);
  g.addColorStop(0,    "rgba(255,255,255,1)");
  g.addColorStop(0.35, "rgba(255,255,255,0.85)");
  g.addColorStop(0.7,  "rgba(255,255,255,0.2)");
  g.addColorStop(1,    "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(cv);
}

function makeNebulaTexture(color: string, size = 256): THREE.Texture {
  const cv = document.createElement("canvas");
  cv.width = size; cv.height = size;
  const ctx = cv.getContext("2d")!;
  const cx = size / 2;
  const g = ctx.createRadialGradient(cx, cx, 0, cx, cx, cx * 0.85);
  g.addColorStop(0,   color.replace(")", ",0.18)").replace("rgb(", "rgba("));
  g.addColorStop(0.5, color.replace(")", ",0.08)").replace("rgb(", "rgba("));
  g.addColorStop(1,   "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(cv);
}

function makeGlowTexture(size = 128): THREE.Texture {
  const cv = document.createElement("canvas");
  cv.width = size; cv.height = size;
  const ctx = cv.getContext("2d")!;
  const cx = size / 2;
  const g = ctx.createRadialGradient(cx, cx, 0, cx, cx, cx);
  g.addColorStop(0,    "rgba(255,255,255,1)");
  g.addColorStop(0.15, "rgba(255,255,255,0.95)");
  g.addColorStop(0.45, "rgba(255,255,255,0.35)");
  g.addColorStop(0.75, "rgba(255,255,255,0.08)");
  g.addColorStop(1,    "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(cv);
}

function makeGasBandTexture(c1: string, c2: string, bands = 9): THREE.Texture {
  const cv = document.createElement("canvas");
  cv.width = 256; cv.height = 256;
  const ctx = cv.getContext("2d")!;
  const bh = 256 / bands;
  for (let i = 0; i < bands; i++) {
    ctx.fillStyle = i % 2 === 0 ? c1 : c2;
    ctx.fillRect(0, Math.floor(i * bh), 256, Math.ceil(bh) + 1);
  }
  return new THREE.CanvasTexture(cv);
}

// ── Data derivation ───────────────────────────────────────────────────────────

type OrreryData = {
  galaxyNodes:    GraphNode[];
  starNodes:      GraphNode[];
  planetNodes:    GraphNode[];
  moonNodes:      GraphNode[];
  galaxyToStars:  Map<string, string[]>;
  starToPlanets:  Map<string, string[]>;
  planetToMoons:  Map<string, string[]>;
  ringNodeIds:    Set<string>;
  ringColorByDb:  Map<string, string>;
  galaxyPositions: Vec3[];
  nodeById:       Map<string, GraphNode>;
  connectionCount: Map<string, number>;
  edges:          GraphData["edges"];
};

function deriveOrreryData(graphData: GraphData, orreryConfig: OrreryConfig): OrreryData {
  const { galaxyDatabaseId, starDatabaseId, planetDatabaseId, moonDatabaseId, ringDatabases } = orreryConfig.tierMapping;

  const nodeById = new Map<string, GraphNode>(graphData.nodes.map((n) => [n.id, n]));

  const connectionCount = new Map<string, number>();
  for (const edge of graphData.edges) {
    connectionCount.set(edge.source, (connectionCount.get(edge.source) ?? 0) + 1);
    connectionCount.set(edge.target, (connectionCount.get(edge.target) ?? 0) + 1);
  }

  const galaxyNodes  = graphData.nodes.filter((n) => n.databaseId === galaxyDatabaseId);
  const starNodes    = graphData.nodes.filter((n) => n.databaseId === starDatabaseId);
  const planetNodes  = graphData.nodes.filter((n) => n.databaseId === planetDatabaseId);
  const moonNodes    = graphData.nodes.filter((n) => n.databaseId === moonDatabaseId);

  const ringDbIds    = new Set(ringDatabases.map((r) => r.databaseId));
  const ringNodeIds  = new Set(graphData.nodes.filter((n) => ringDbIds.has(n.databaseId)).map((n) => n.id));
  const ringColorByDb = new Map(ringDatabases.map((r) => [r.databaseId, graphData.nodes.find((n) => n.databaseId === r.databaseId)?.color ?? "#aaaaaa"]));

  const galaxyIdSet  = new Set(galaxyNodes.map((n) => n.id));
  const starIdSet    = new Set(starNodes.map((n) => n.id));
  const planetIdSet  = new Set(planetNodes.map((n) => n.id));
  const moonIdSet    = new Set(moonNodes.map((n) => n.id));

  const galaxyToStars  = new Map<string, string[]>(galaxyNodes.map((n) => [n.id, []]));
  const starToPlanets  = new Map<string, string[]>(starNodes.map((n) => [n.id, []]));
  const planetToMoons  = new Map<string, string[]>(planetNodes.map((n) => [n.id, []]));

  for (const edge of graphData.edges) {
    const { source: s, target: t } = edge;
    if (galaxyIdSet.has(s) && starIdSet.has(t))   galaxyToStars.get(s)!.push(t);
    if (galaxyIdSet.has(t) && starIdSet.has(s))   galaxyToStars.get(t)!.push(s);
    if (starIdSet.has(s)   && planetIdSet.has(t)) starToPlanets.get(s)!.push(t);
    if (starIdSet.has(t)   && planetIdSet.has(s)) starToPlanets.get(t)!.push(s);
    if (planetIdSet.has(s) && moonIdSet.has(t))   planetToMoons.get(s)!.push(t);
    if (planetIdSet.has(t) && moonIdSet.has(s))   planetToMoons.get(t)!.push(s);
  }

  const galaxyPositions = distributeGalaxies(galaxyNodes.map((n) => n.id), UNIVERSE_SPREAD);

  return { galaxyNodes, starNodes, planetNodes, moonNodes, galaxyToStars, starToPlanets, planetToMoons, ringNodeIds, ringColorByDb, galaxyPositions, nodeById, connectionCount, edges: graphData.edges };
}

function toNodeDetail(node: GraphNode): NodeDetail {
  return { id: node.id, name: node.name, createdBy: node.createdBy, createdTime: node.createdTime, databaseName: node.databaseName, databaseId: node.databaseId, notionUrl: node.notionUrl, fieldValues: node.fieldValues };
}

// ── FNV-1a hash ───────────────────────────────────────────────────────────────

function hashFloat(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 0x100000000;
}
function hf(id: string, salt: string): number { return hashFloat(id + "\x00" + salt); }

// ── Shared size helper ────────────────────────────────────────────────────────

function normalizedSizeFor(nodeId: string, allNodes: GraphNode[], connectionCount: Map<string, number>): number {
  const parseMs = (s: string) => { const t = new Date(s).getTime(); return isNaN(t) ? Date.now() : t; };
  const allMs  = allNodes.map((n) => parseMs(n.createdTime));
  const oldest = Math.min(...allMs), newest = Math.max(...allMs);
  const maxConn = Math.max(1, ...allNodes.map((n) => connectionCount.get(n.id) ?? 0));
  const node    = allNodes.find((n) => n.id === nodeId);
  if (!node) return 0.5;
  const connScore = (connectionCount.get(nodeId) ?? 0) / maxConn;
  const ageScore  = (newest - parseMs(node.createdTime)) / (newest - oldest || 1);
  return connScore * 0.6 + ageScore * 0.4;
}

// ── Material factories ────────────────────────────────────────────────────────

function makePlanetMaterial(type: PlanetType, seed: string): THREE.Material {
  switch (type) {
    case "rocky": {
      const shade = 0.35 + hf(seed, "rocky-shade") * 0.3;
      return new THREE.MeshStandardMaterial({ color: new THREE.Color(shade + 0.1, shade * 0.75, shade * 0.55), roughness: 0.92, metalness: 0 });
    }
    case "gas-giant": {
      const c1 = `hsl(${30 + hf(seed,"gc1")*30},60%,55%)`;
      const c2 = `hsl(${20 + hf(seed,"gc2")*20},45%,38%)`;
      const tex = makeGasBandTexture(c1, c2, 8 + Math.floor(hf(seed,"gbands")*5));
      return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5, metalness: 0 });
    }
    case "ocean":
      return new THREE.MeshStandardMaterial({ color: new THREE.Color(0.05, 0.22, 0.72), roughness: 0.15, metalness: 0.05 });
    case "desert":
      return new THREE.MeshStandardMaterial({ color: new THREE.Color(0.72, 0.48, 0.20), roughness: 0.88, metalness: 0 });
    case "ice-giant":
      return new THREE.MeshStandardMaterial({ color: new THREE.Color(0.68, 0.85, 0.98), roughness: 0.30, metalness: 0.05, transparent: true, opacity: 0.92 });
    case "lava":
      return new THREE.MeshStandardMaterial({ color: new THREE.Color(0.08, 0.04, 0.02), roughness: 0.95, metalness: 0, emissive: new THREE.Color(0.55, 0.18, 0.01), emissiveIntensity: 0.9 });
    case "jungle":
      return new THREE.MeshStandardMaterial({ color: new THREE.Color(0.08, 0.32, 0.18), roughness: 0.70, metalness: 0 });
  }
}

function makeMoonMaterial(type: MoonType, seed: string): THREE.Material {
  switch (type) {
    case "cratered":
      return new THREE.MeshStandardMaterial({ color: new THREE.Color(0.40, 0.38, 0.36), roughness: 0.95, metalness: 0 });
    case "icy":
      return new THREE.MeshStandardMaterial({ color: new THREE.Color(0.88, 0.92, 0.98), roughness: 0.20, metalness: 0.05 });
    case "volcanic":
      return new THREE.MeshStandardMaterial({ color: new THREE.Color(0.12, 0.08, 0.06), roughness: 0.90, metalness: 0, emissive: new THREE.Color(0.45, 0.12, 0.0), emissiveIntensity: 0.6 });
    case "dusty":
      return new THREE.MeshStandardMaterial({ color: new THREE.Color(0.55, 0.42, 0.30), roughness: 0.98, metalness: 0 });
    case "tidally-locked": {
      const bright = 0.5 + hf(seed, "tl-b") * 0.15;
      return new THREE.MeshStandardMaterial({ color: new THREE.Color(bright, bright * 0.82, bright * 0.70), roughness: 0.75, metalness: 0 });
    }
  }
}

// ── Geometry helpers ──────────────────────────────────────────────────────────

function makeOrbitalRing(a: number, b: number, inclination: number, hexColor: number): THREE.Line {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 96; i++) {
    const theta = (i / 96) * Math.PI * 2;
    pts.push(new THREE.Vector3(a * Math.cos(theta), 0, b * Math.sin(theta)));
  }
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const mat = new THREE.LineBasicMaterial({ color: hexColor, transparent: true, opacity: 0.22, depthWrite: false });
  const line = new THREE.Line(geo, mat);
  line.rotation.x = inclination;
  return line;
}

function makeAsteroidBelt(innerR: number, outerR: number, color: THREE.Color): THREE.InstancedMesh {
  const geo   = new THREE.SphereGeometry(0.25, 4, 4);
  const mat   = new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0 });
  const inst  = new THREE.InstancedMesh(geo, mat, BELT_PARTICLE_COUNT);
  const dummy = new THREE.Object3D();
  inst.userData.speeds = new Float32Array(BELT_PARTICLE_COUNT);
  for (let i = 0; i < BELT_PARTICLE_COUNT; i++) {
    const r     = innerR + hf(`belt${i}`, "r") * (outerR - innerR);
    const theta = hf(`belt${i}`, "theta") * Math.PI * 2;
    const y     = (hf(`belt${i}`, "y") - 0.5) * 1.5;
    dummy.position.set(r * Math.cos(theta), y, r * Math.sin(theta));
    dummy.scale.setScalar(0.15 + hf(`belt${i}`, "s") * 0.55);
    dummy.updateMatrix();
    inst.setMatrixAt(i, dummy.matrix);
    inst.userData.speeds[i] = 0.008 + hf(`belt${i}`, "speed") * 0.015;
  }
  inst.instanceMatrix.needsUpdate = true;
  return inst;
}

function makeRingParticles(innerR: number, outerR: number, color: THREE.Color, inclination: number): THREE.InstancedMesh {
  const geo   = new THREE.SphereGeometry(0.15, 4, 4);
  const mat   = new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.55, roughness: 0.8, metalness: 0 });
  const inst  = new THREE.InstancedMesh(geo, mat, RING_PARTICLE_COUNT);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < RING_PARTICLE_COUNT; i++) {
    const r     = innerR + hf(`rp${i}`, "r") * (outerR - innerR);
    const theta = hf(`rp${i}`, "theta") * Math.PI * 2;
    dummy.position.set(r * Math.cos(theta), (hf(`rp${i}`, "y") - 0.5) * 0.25, r * Math.sin(theta));
    dummy.scale.setScalar(0.2 + hf(`rp${i}`, "s") * 0.6);
    dummy.updateMatrix();
    inst.setMatrixAt(i, dummy.matrix);
  }
  inst.instanceMatrix.needsUpdate = true;
  inst.rotation.z = inclination;
  return inst;
}

// ── Scene builders ────────────────────────────────────────────────────────────

function buildBackground(scene: THREE.Scene, circleTex: THREE.Texture): { bgStars: THREE.Points; nebulaMeshes: THREE.Mesh[] } {
  const pos    = new Float32Array(BG_STAR_COUNT * 3);
  const col    = new Float32Array(BG_STAR_COUNT * 3);
  const sizes  = new Float32Array(BG_STAR_COUNT);
  for (let i = 0; i < BG_STAR_COUNT; i++) {
    const r = BG_STAR_SPREAD * (0.3 + hf(`bg${i}`, "r") * 0.7);
    const theta = Math.acos(2 * hf(`bg${i}`, "theta") - 1);
    const phi   = hf(`bg${i}`, "phi") * Math.PI * 2;
    pos[i*3]   = r * Math.sin(theta) * Math.cos(phi);
    pos[i*3+1] = r * Math.cos(theta);
    pos[i*3+2] = r * Math.sin(theta) * Math.sin(phi);
    const t = hf(`bg${i}`, "temp");
    if      (t < 0.15) { col[i*3]=1;    col[i*3+1]=0.92; col[i*3+2]=0.75; }
    else if (t < 0.55) { col[i*3]=1;    col[i*3+1]=1;    col[i*3+2]=1;    }
    else               { col[i*3]=0.75; col[i*3+1]=0.88; col[i*3+2]=1;    }
    sizes[i] = 0.8 + hf(`bg${i}`, "size") * 2.2;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("color",    new THREE.BufferAttribute(col, 3));
  geo.setAttribute("size",     new THREE.BufferAttribute(sizes, 1));
  const mat = new THREE.PointsMaterial({ map: circleTex, size: 2, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false });
  const bgStars = new THREE.Points(geo, mat);
  bgStars.frustumCulled = false;
  scene.add(bgStars);

  const NEBULA_COLS = ["rgb(60,80,180)","rgb(100,50,160)","rgb(180,80,100)","rgb(50,120,180)","rgb(180,130,50)","rgb(80,160,120)","rgb(120,60,180)"];
  const nebulaMeshes: THREE.Mesh[] = [];
  for (let i = 0; i < NEBULA_COUNT; i++) {
    const tex = makeNebulaTexture(NEBULA_COLS[i % NEBULA_COLS.length], 256);
    const mat2 = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    const sz   = 1200 + hf(`neb${i}`, "size") * 1800;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(sz, sz), mat2);
    mesh.position.set((hf(`neb${i}`,"px")-0.5)*UNIVERSE_SPREAD*2.5, (hf(`neb${i}`,"py")-0.5)*UNIVERSE_SPREAD*0.6, (hf(`neb${i}`,"pz")-0.5)*UNIVERSE_SPREAD*2.5);
    mesh.rotation.set(hf(`neb${i}`,"rx")*Math.PI, hf(`neb${i}`,"ry")*Math.PI, hf(`neb${i}`,"rz")*Math.PI);
    scene.add(mesh);
    nebulaMeshes.push(mesh);
  }
  return { bgStars, nebulaMeshes };
}

function buildUniverseObjects(universeGroup: THREE.Group, data: OrreryData, dbColors: Record<string, string>, circleTex: THREE.Texture): GalaxyEntry[] {
  const entries: GalaxyEntry[] = [];
  const parseMs = (s: string) => { const t = new Date(s).getTime(); return isNaN(t) ? Date.now() : t; };
  const allMs   = data.galaxyNodes.map((n) => parseMs(n.createdTime));
  const oldest  = Math.min(...allMs), newest = Math.max(...allMs);

  for (let gi = 0; gi < data.galaxyNodes.length; gi++) {
    const node      = data.galaxyNodes[gi];
    const worldPos  = data.galaxyPositions[gi];
    const shape     = assignGalaxyShape(node.id);
    const starIds   = data.galaxyToStars.get(node.id) ?? [];
    const baseColor = dbColors[node.databaseId] ?? "#6688cc";
    const normAge   = (newest - parseMs(node.createdTime)) / (newest - oldest || 1);
    const color     = assignGalaxyColor(baseColor, node.id, normAge);

    const cloudCount = Math.min(Math.max(starIds.length, 20), GALAXY_CLOUD_DENSITY);
    // Always produce exactly cloudCount IDs so distributeStarsInGalaxy returns cloudCount positions.
    // When a galaxy has fewer real stars than cloudCount, pad with synthetic IDs.
    const cloudIds = (() => {
      if (starIds.length === 0) return Array.from({ length: cloudCount }, (_, k) => `${node.id}_s${k}`);
      if (starIds.length >= cloudCount) return [...starIds].slice(0, cloudCount);
      const synth = Array.from({ length: cloudCount - starIds.length }, (_, k) => `${node.id}_s${k}`);
      return [...starIds, ...synth];
    })();
    const starPos    = distributeStarsInGalaxy(cloudIds, shape, node.id);
    const scale      = 8 + (data.connectionCount.get(node.id) ?? 0) * 0.3;

    const positions = new Float32Array(cloudCount * 3);
    const ptColors  = new Float32Array(cloudCount * 3);
    const ptSizes   = new Float32Array(cloudCount);
    const r = parseInt(color.slice(1,3),16)/255, g = parseInt(color.slice(3,5),16)/255, b = parseInt(color.slice(5,7),16)/255;

    for (let pi = 0; pi < cloudCount; pi++) {
      const sp = starPos[pi];
      positions[pi*3]   = sp.x/100*scale;
      positions[pi*3+1] = sp.y/100*scale;
      positions[pi*3+2] = sp.z/100*scale;
      const br = 0.7 + hf(cloudIds[pi],"bright")*0.3;
      ptColors[pi*3]=Math.min(1,r*br); ptColors[pi*3+1]=Math.min(1,g*br); ptColors[pi*3+2]=Math.min(1,b*br);
      ptSizes[pi] = 1.5 + hf(cloudIds[pi],"ps")*2.5;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions,3));
    geo.setAttribute("color",    new THREE.BufferAttribute(ptColors,3));
    geo.setAttribute("size",     new THREE.BufferAttribute(ptSizes,1));
    const mat = new THREE.PointsMaterial({ map: circleTex, size: 3, sizeAttenuation: true, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending });
    const pointCloud = new THREE.Points(geo, mat);

    const hitRadius = Math.max(scale * 1.5, 10);
    const hitMat    = new THREE.MeshBasicMaterial({ visible: false });
    const hitbox    = new THREE.Mesh(new THREE.SphereGeometry(hitRadius, 8, 8), hitMat);
    hitbox.userData.galaxyId = node.id;

    const group = new THREE.Group();
    group.add(pointCloud); group.add(hitbox);
    group.position.set(worldPos.x, worldPos.y, worldPos.z);
    universeGroup.add(group);

    entries.push({ id: node.id, node, worldPos, group, pointCloud, hitbox, rotationSpeed: 0.005 + (starIds.length/100)*0.02, color });
  }
  return entries;
}

function buildGalaxyObjects(
  galaxyScaleGroup: THREE.Group, galaxyId: string, data: OrreryData, glowTex: THREE.Texture,
): { starMeshes: THREE.Mesh[]; starOrbits: StarOrbitState[]; starIdForMesh: Map<THREE.Mesh, string> } {
  const starIds  = data.galaxyToStars.get(galaxyId) ?? [];
  const shape    = assignGalaxyShape(galaxyId);
  const rawPos   = distributeStarsInGalaxy(starIds, shape, galaxyId);
  const SPEED_BASE = 0.12;

  const starMeshes: THREE.Mesh[]           = [];
  const starOrbits: StarOrbitState[]       = [];
  const starIdForMesh = new Map<THREE.Mesh, string>();

  const glowMat = new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });

  for (let si = 0; si < starIds.length; si++) {
    const starId   = starIds[si];
    const starNode = data.nodeById.get(starId);
    if (!starNode) continue;

    const normSize   = normalizedSizeFor(starId, data.starNodes, data.connectionCount);
    const starColor  = assignStarColor(normSize);
    const starRadius = TIER_SIZE.star.minSize + normSize * (TIER_SIZE.star.maxSize - TIER_SIZE.star.minSize);
    const cr = parseInt(starColor.slice(1,3),16)/255, cg = parseInt(starColor.slice(3,5),16)/255, cb = parseInt(starColor.slice(5,7),16)/255;

    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(starRadius, 10, 10),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(cr,cg,cb), emissive: new THREE.Color(cr*0.8,cg*0.8,cb*0.8), emissiveIntensity: 1.5, roughness: 0.3, metalness: 0 }),
    );
    mesh.userData.starId = starId;
    mesh.userData.normalizedSize = normSize;

    const glow = new THREE.Sprite(glowMat.clone() as THREE.SpriteMaterial);
    (glow.material as THREE.SpriteMaterial).color.set(new THREE.Color(cr,cg,cb));
    glow.scale.set(starRadius*8, starRadius*8, 1);
    mesh.add(glow);

    galaxyScaleGroup.add(mesh);
    starMeshes.push(mesh);
    starIdForMesh.set(mesh, starId);

    const rp = rawPos[si];
    const effectiveR = Math.max(5, Math.sqrt(rp.x*rp.x + rp.z*rp.z));
    starOrbits.push({
      starId, orbitalRadius: effectiveR,
      angularSpeed: SPEED_BASE * Math.pow(5 / effectiveR, 1.5),
      inclination:  (hf(starId,"incl")-0.5)*2*(Math.PI/6),
      eccentricity: 0.05 + hf(starId,"ecc")*0.20,
      phase: hf(starId,"phase")*Math.PI*2,
      yOffset: rp.y,
    });
  }

  galaxyScaleGroup.add(new THREE.AmbientLight(0x111122, 2));
  return { starMeshes, starOrbits, starIdForMesh };
}

function buildSolarSystemObjects(
  solarSystemGroup: THREE.Group, starId: string, data: OrreryData, orreryConfig: OrreryConfig, glowTex: THREE.Texture,
): { planetMeshes: THREE.Mesh[]; planetOrbits: PlanetOrbitState[]; orbitalRings: THREE.Line[]; asteroidBelts: THREE.InstancedMesh[]; planetIdForMesh: Map<THREE.Mesh, string> } {
  const starNode   = data.nodeById.get(starId);
  const normSize   = normalizedSizeFor(starId, data.starNodes, data.connectionCount);
  const starColor  = assignStarColor(normSize);
  const starRadius = TIER_SIZE.star.minSize + normSize * (TIER_SIZE.star.maxSize - TIER_SIZE.star.minSize);
  const cr = parseInt(starColor.slice(1,3),16)/255, cg = parseInt(starColor.slice(3,5),16)/255, cb = parseInt(starColor.slice(5,7),16)/255;

  // Central star sphere + PointLight
  const starMesh = new THREE.Mesh(
    new THREE.SphereGeometry(starRadius * 3, 16, 16),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(cr,cg,cb), emissive: new THREE.Color(cr,cg,cb), emissiveIntensity: 2.5, roughness: 0 }),
  );
  starMesh.userData.isCentralStar = true;
  solarSystemGroup.add(starMesh);

  const ptLight = new THREE.PointLight(new THREE.Color(cr,cg,cb), 4, 0, 1.2);
  solarSystemGroup.add(ptLight);

  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  (glow.material as THREE.SpriteMaterial).color.set(new THREE.Color(cr,cg,cb));
  glow.scale.set(starRadius * 20, starRadius * 20, 1);
  solarSystemGroup.add(glow);

  const planetIds = data.starToPlanets.get(starId) ?? [];
  const orbParams = computeOrbitalParams(planetIds, SS_BASE_RADIUS, SS_SPREAD, SS_SPEED_BASE, SS_MAX_INCL);

  const planetMeshes: THREE.Mesh[]           = [];
  const planetOrbits: PlanetOrbitState[]     = [];
  const orbitalRings: THREE.Line[]           = [];
  const asteroidBelts: THREE.InstancedMesh[] = [];
  const planetIdForMesh = new Map<THREE.Mesh, string>();

  for (let pi = 0; pi < planetIds.length; pi++) {
    const planetId   = planetIds[pi];
    const planetNode = data.nodeById.get(planetId);
    if (!planetNode) continue;

    const params     = orbParams[pi];
    const pType      = assignPlanetType(planetId);
    const normSz     = normalizedSizeFor(planetId, data.planetNodes, data.connectionCount);
    const pRadius    = TIER_SIZE.planet.minSize + normSz * (TIER_SIZE.planet.maxSize - TIER_SIZE.planet.minSize);
    const pMat       = makePlanetMaterial(pType, planetId);
    const pMesh      = new THREE.Mesh(new THREE.SphereGeometry(pRadius, 18, 18), pMat);
    pMesh.userData.planetId       = planetId;
    pMesh.userData.planetType     = pType;
    pMesh.userData.normalizedSize = normSz;
    pMesh.userData.moonCount      = (data.planetToMoons.get(planetId) ?? []).length;

    // Atmospheric rim for gas/ocean/ice
    if (pType === "gas-giant" || pType === "ocean" || pType === "ice-giant") {
      const rimGeo  = new THREE.SphereGeometry(pRadius * 1.06, 16, 16);
      const rimMat  = new THREE.MeshBasicMaterial({ color: pType === "gas-giant" ? 0xffa050 : pType === "ocean" ? 0x4488ff : 0x88ccff, transparent: true, opacity: 0.12, side: THREE.BackSide, depthWrite: false });
      pMesh.add(new THREE.Mesh(rimGeo, rimMat));
    }

    solarSystemGroup.add(pMesh);
    planetMeshes.push(pMesh);
    planetIdForMesh.set(pMesh, planetId);

    // Orbital ring
    const a    = params.orbitalRadius;
    const b    = params.orbitalRadius * (1 - params.eccentricity * 0.5);
    const hexCol = 0x888888;
    const ring = makeOrbitalRing(a, b, params.inclination, hexCol);
    solarSystemGroup.add(ring);
    orbitalRings.push(ring);

    planetOrbits.push({ planetId, orbitalRadius: params.orbitalRadius, angularSpeed: params.angularSpeed, inclination: params.inclination, eccentricity: params.eccentricity, phase: params.initialPhase, planetType: pType, normalizedSize: normSz, meshIndex: pi });
  }

  // Asteroid belt (star-belt ring databases)
  const beltDbs = orreryConfig.tierMapping.ringDatabases.filter((r) => r.subType === "star-belt");
  for (const beltDb of beltDbs) {
    const beltColor = new THREE.Color(data.ringColorByDb.get(beltDb.databaseId) ?? "#888888");
    if (planetOrbits.length >= 2) {
      const innerR = planetOrbits[Math.floor(planetOrbits.length * 0.4)].orbitalRadius + 2;
      const outerR = planetOrbits[Math.floor(planetOrbits.length * 0.6)].orbitalRadius - 2;
      if (outerR > innerR) {
        const belt = makeAsteroidBelt(innerR, outerR, beltColor);
        belt.rotation.x = 0.08;
        solarSystemGroup.add(belt);
        asteroidBelts.push(belt);
      }
    }
  }

  solarSystemGroup.add(new THREE.AmbientLight(0x111122, 0.8));

  return { planetMeshes, planetOrbits, orbitalRings, asteroidBelts, planetIdForMesh };
}

function buildPlanetObjects(
  planetGroup: THREE.Group, planetId: string, data: OrreryData, orreryConfig: OrreryConfig, glowTex: THREE.Texture, starId: string | null,
): { moonMeshes: THREE.Mesh[]; moonOrbits: MoonOrbitState[]; ringParticles: THREE.InstancedMesh | null; moonIdForMesh: Map<THREE.Mesh, string>; starBackgroundLight: THREE.PointLight | null } {
  const planetNode = data.nodeById.get(planetId);
  const pType      = assignPlanetType(planetId);
  const normSz     = normalizedSizeFor(planetId, data.planetNodes, data.connectionCount);
  const pRadius    = TIER_SIZE.planet.minSize + normSz * (TIER_SIZE.planet.maxSize - TIER_SIZE.planet.minSize);
  const displayRadius = pRadius * 5; // planet appears large at this scale

  // Central planet
  const pMat  = makePlanetMaterial(pType, planetId);
  const pMesh = new THREE.Mesh(new THREE.SphereGeometry(displayRadius, 32, 32), pMat);
  planetGroup.add(pMesh);

  // Atmospheric rim
  if (pType === "gas-giant" || pType === "ocean" || pType === "ice-giant") {
    const rimColor = pType === "ocean" ? 0x4488ff : pType === "ice-giant" ? 0x88ccff : 0xffa050;
    planetGroup.add(new THREE.Mesh(
      new THREE.SphereGeometry(displayRadius * 1.05, 16, 16),
      new THREE.MeshBasicMaterial({ color: rimColor, transparent: true, opacity: 0.15, side: THREE.BackSide, depthWrite: false }),
    ));
  }

  // Moons
  const moonIds   = data.planetToMoons.get(planetId) ?? [];
  const orbParams = computeOrbitalParams(moonIds, MOON_BASE_RADIUS + displayRadius, MOON_SPREAD, MOON_SPEED_BASE, MOON_MAX_INCL);
  const moonMeshes: THREE.Mesh[]        = [];
  const moonOrbits: MoonOrbitState[]    = [];
  const moonIdForMesh = new Map<THREE.Mesh, string>();

  for (let mi = 0; mi < moonIds.length; mi++) {
    const moonId   = moonIds[mi];
    const moonNode = data.nodeById.get(moonId);
    if (!moonNode) continue;

    const params   = orbParams[mi];
    const mType    = assignMoonType(moonId);
    const normMSz  = normalizedSizeFor(moonId, data.moonNodes, data.connectionCount);
    const mRadius  = TIER_SIZE.moon.minSize + normMSz * (TIER_SIZE.moon.maxSize - TIER_SIZE.moon.minSize);
    const mMat     = makeMoonMaterial(mType, moonId);
    const mMesh    = new THREE.Mesh(new THREE.SphereGeometry(mRadius * 3, 10, 10), mMat);
    mMesh.userData.moonId       = moonId;
    mMesh.userData.moonType     = mType;

    // Moon orbital ring (subtle)
    const ring = makeOrbitalRing(params.orbitalRadius, params.orbitalRadius * (1 - params.eccentricity*0.4), params.inclination, 0x444455);
    planetGroup.add(ring);

    planetGroup.add(mMesh);
    moonMeshes.push(mMesh);
    moonIdForMesh.set(mMesh, moonId);

    moonOrbits.push({ moonId, orbitalRadius: params.orbitalRadius, angularSpeed: params.angularSpeed, inclination: params.inclination, eccentricity: params.eccentricity, phase: params.initialPhase, moonType: mType, meshIndex: mi });
  }

  // Ring system (planet-rings databases)
  let ringParticles: THREE.InstancedMesh | null = null;
  const planetRingDbs = orreryConfig.tierMapping.ringDatabases.filter((r) => r.subType === "planet-rings");
  if (planetRingDbs.length > 0) {
    const ringDb    = planetRingDbs[0];
    const ringColor = new THREE.Color(data.ringColorByDb.get(ringDb.databaseId) ?? "#ccaa88");
    const innerR    = displayRadius * 1.3;
    const outerR    = displayRadius * 2.2;
    ringParticles   = makeRingParticles(innerR, outerR, ringColor, 0.10);
    planetGroup.add(ringParticles);
  }

  // Distant star point light
  let starBackgroundLight: THREE.PointLight | null = null;
  if (starId) {
    const starNode = data.nodeById.get(starId);
    if (starNode) {
      const normStarSz = normalizedSizeFor(starId, data.starNodes, data.connectionCount);
      const sColor = assignStarColor(normStarSz);
      const sr = parseInt(sColor.slice(1,3),16)/255, sg = parseInt(sColor.slice(3,5),16)/255, sb = parseInt(sColor.slice(5,7),16)/255;
      starBackgroundLight = new THREE.PointLight(new THREE.Color(sr,sg,sb), 3, 0, 1.5);
      starBackgroundLight.position.set(200, 80, -300);
      planetGroup.add(starBackgroundLight);

      // Distant star sprite
      const starSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: new THREE.Color(sr,sg,sb) }));
      starSprite.scale.set(12, 12, 1);
      starSprite.position.set(200, 80, -300);
      planetGroup.add(starSprite);
    }
  }

  planetGroup.add(new THREE.AmbientLight(0x111133, 1.2));

  return { moonMeshes, moonOrbits, ringParticles, moonIdForMesh, starBackgroundLight };
}

// ── Dispose helpers ───────────────────────────────────────────────────────────

function disposeGroup(group: THREE.Group) {
  group.traverse((obj) => {
    if (obj instanceof THREE.Mesh || obj instanceof THREE.InstancedMesh || obj instanceof THREE.Line || obj instanceof THREE.Points) {
      obj.geometry?.dispose();
      if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
      else (obj.material as THREE.Material)?.dispose();
    }
  });
  group.clear();
}

// ── Connection arcs ───────────────────────────────────────────────────────────

function buildConnectionArcs(planetGroup: THREE.Group, moonId: string, moonMeshes: THREE.Mesh[], moonIdForMesh: Map<THREE.Mesh, string>, edges: OrreryData["edges"]): THREE.Line[] {
  const arcs: THREE.Line[] = [];
  const moonMesh = [...moonIdForMesh.entries()].find(([, id]) => id === moonId)?.[0];
  if (!moonMesh) return arcs;

  const connectedIds = edges
    .filter((e) => e.source === moonId || e.target === moonId)
    .map((e) => (e.source === moonId ? e.target : e.source));

  for (const otherId of connectedIds) {
    const otherMesh = [...moonIdForMesh.entries()].find(([, id]) => id === otherId)?.[0];
    if (!otherMesh) continue;

    const start = moonMesh.position.clone();
    const end   = otherMesh.position.clone();
    const mid   = start.clone().add(end).multiplyScalar(0.5);
    mid.y += start.distanceTo(end) * 0.4;

    const curve  = new THREE.QuadraticBezierCurve3(start, mid, end);
    const pts    = curve.getPoints(40);
    const geo    = new THREE.BufferGeometry().setFromPoints(pts);
    geo.computeBoundingSphere();
    const mat  = new THREE.LineDashedMaterial({ color: 0xe07a35, dashSize: 1.5, gapSize: 1.0, transparent: true, opacity: 0.65, depthWrite: false });
    const line = new THREE.Line(geo, mat);
    line.computeLineDistances();
    line.userData.isArc = true;
    planetGroup.add(line);
    arcs.push(line);
  }
  return arcs;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function OrreryCanvas({ graphData, orreryConfig, speedMultiplier = 1, paused = false, onScaleChange, onHover, onSelectNode, backRef }: Props) {
  const mountRef   = useRef<HTMLDivElement>(null);
  const stateRef   = useRef<SceneState | null>(null);
  const propsRef   = useRef<PropsRef>({ speedMultiplier, paused, onScaleChange, onHover, onSelectNode });
  propsRef.current = { speedMultiplier, paused, onScaleChange, onHover, onSelectNode };

  const [labels, setLabels]     = useState<Label[]>([]);
  const [currentScale, setCurrentScale] = useState<OrreryScale>("universe");
  const [warpActive, setWarpActive] = useState(false);

  // ── Escape / back navigation ─────────────────────────────────────────────
  const goBack = useCallback(() => {
    const s = stateRef.current;
    if (!s || s.transitioning) return;
    setWarpActive(true);
    setTimeout(() => setWarpActive(false), 800);
    if (s.scale === "planet") {
      // planet → solar-system
      disposeGroup(s.planetGroup);
      s.moonMeshes = []; s.moonOrbits = []; s.moonIdForMesh.clear();
      s.connectionArcs = [];
      if (s.ringParticles) { s.ringParticles = null; }
      s.starBackgroundLight = null;
      s.selectedMoonId = null;

      s.transitionFrom = s.camera.position.clone(); s.transitionFromTarget = s.controls.target.clone();
      s.transitionTo   = new THREE.Vector3(0, SOLAR_CAM_DIST * 0.5, SOLAR_CAM_DIST);
      s.transitionToTarget = new THREE.Vector3(0,0,0);
      s.transitionProgress = 0; s.transitioning = true;
      s.onTransitionEnd = () => { s.solarSystemGroup.visible = true; s.planetGroup.visible = false; };
      s.scale = "solar-system"; s.selectedPlanetId = null;
      s.controls.minDistance = 20; s.controls.maxDistance = 400;
      setLabels([]); setCurrentScale("solar-system");
      const d0 = dataRef.current;
      const starNode = s.selectedStarId ? d0?.nodeById.get(s.selectedStarId) : undefined;
      const galNode  = s.selectedGalaxyId ? d0?.galaxyNodes.find((n) => n.id === s.selectedGalaxyId) : undefined;
      propsRef.current.onScaleChange?.("solar-system", { galaxyName: galNode?.name, starName: starNode?.name });
      propsRef.current.onSelectNode?.(null);
    } else if (s.scale === "solar-system") {
      // solar-system → galaxy
      disposeGroup(s.solarSystemGroup);
      s.planetMeshes = []; s.planetOrbits = []; s.orbitalRings = []; s.asteroidBelts = []; s.planetIdForMesh.clear();
      s.selectedStarId = null;

      s.transitionFrom = s.camera.position.clone(); s.transitionFromTarget = s.controls.target.clone();
      s.transitionTo   = new THREE.Vector3(0, STAR_GALAXY_DIST * 0.5, STAR_GALAXY_DIST);
      s.transitionToTarget = new THREE.Vector3(0,0,0);
      s.transitionProgress = 0; s.transitioning = true;
      s.onTransitionEnd = () => { s.galaxyScaleGroup.visible = true; s.solarSystemGroup.visible = false; };
      s.scale = "galaxy";
      s.controls.minDistance = 50; s.controls.maxDistance = 1500;
      setLabels([]); setCurrentScale("galaxy");
      const d1 = dataRef.current;
      const galNode = s.selectedGalaxyId ? d1?.galaxyNodes.find((n) => n.id === s.selectedGalaxyId) : undefined;
      propsRef.current.onScaleChange?.("galaxy", { galaxyName: galNode?.name });
    } else if (s.scale === "galaxy") {
      // galaxy → universe
      disposeGroup(s.galaxyScaleGroup);
      s.starMeshes = []; s.starOrbits = []; s.starIdForMesh.clear();

      s.transitionFrom = s.camera.position.clone(); s.transitionFromTarget = s.controls.target.clone();
      s.transitionTo   = new THREE.Vector3(0, 0, UNIVERSE_SPREAD * 0.25);
      s.transitionToTarget = new THREE.Vector3(0,0,0);
      s.transitionProgress = 0; s.transitioning = true;
      s.onTransitionEnd = () => { s.universeGroup.visible = true; s.galaxyScaleGroup.visible = false; };
      s.scale = "universe"; s.selectedGalaxyId = null; s.hoveredStarId = null;
      s.controls.minDistance = 200; s.controls.maxDistance = 8000;
      setLabels([]); setCurrentScale("universe");
      propsRef.current.onScaleChange?.("universe", {});
    }
  // data captured via closure below
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // We need data inside goBack; store derived data in a ref
  const dataRef = useRef<OrreryData | null>(null);
  // Patch goBack to access dataRef (workaround for closure)
  const goBackRef = useRef(goBack);
  goBackRef.current = goBack;
  // Expose goBack to parent via backRef prop
  if (backRef) backRef.current = () => goBackRef.current();

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const data = deriveOrreryData(graphData, orreryConfig);
    dataRef.current = data;

    const dbColors: Record<string, string> = {};
    for (const n of graphData.nodes) dbColors[n.databaseId] = n.color ?? "#6688cc";

    // Textures
    const circleTex = makeCircleTexture(64);
    const glowTex   = makeGlowTexture(128);

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.setClearColor(0x05060d, 1);
    mount.appendChild(renderer.domElement);

    // Scene + camera
    const scene  = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, mount.clientWidth / mount.clientHeight, 0.1, 30000);
    camera.position.set(0, 600, 1400);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.08;
    controls.minDistance = 200; controls.maxDistance = 8000;
    controls.target.set(0,0,0); controls.update();

    // Background
    const { bgStars, nebulaMeshes } = buildBackground(scene, circleTex);

    // Groups
    const universeGroup    = new THREE.Group(); scene.add(universeGroup);
    const galaxyScaleGroup = new THREE.Group(); galaxyScaleGroup.visible = false; scene.add(galaxyScaleGroup);
    const solarSystemGroup = new THREE.Group(); solarSystemGroup.visible = false; scene.add(solarSystemGroup);
    const planetGroup      = new THREE.Group(); planetGroup.visible      = false; scene.add(planetGroup);

    const galaxyEntries = buildUniverseObjects(universeGroup, data, dbColors, circleTex);

    const raycaster = new THREE.Raycaster();

    const state: SceneState = {
      renderer, scene, camera, controls,
      animFrameId: 0, prevTime: performance.now(),
      bgStars, nebulaMeshes,
      universeGroup, galaxyEntries,
      galaxyScaleGroup, starMeshes: [], starOrbits: [], starIdForMesh: new Map(),
      solarSystemGroup, planetMeshes: [], planetOrbits: [], orbitalRings: [], asteroidBelts: [], planetIdForMesh: new Map(),
      planetGroup, moonMeshes: [], moonOrbits: [], ringParticles: null, moonIdForMesh: new Map(), connectionArcs: [], starBackgroundLight: null,
      scale: "universe", transitioning: false, transitionProgress: 0,
      transitionFrom: new THREE.Vector3(), transitionFromTarget: new THREE.Vector3(),
      transitionTo: new THREE.Vector3(),   transitionToTarget: new THREE.Vector3(),
      onTransitionEnd: null,
      selectedGalaxyId: null, selectedStarId: null, selectedPlanetId: null, selectedMoonId: null,
      hoveredGalaxyId: null, hoveredStarId: null, hoveredPlanetId: null, hoveredMoonId: null,
      hoverChangedAt: 0, lastEmittedHoverId: null,
      lastInteraction: performance.now(), autoOrbiting: false,
      mouse: new THREE.Vector2(), raycaster,
    };
    stateRef.current = state;

    // Resize
    const resizeObs = new ResizeObserver(() => {
      const w = mount.clientWidth, h = mount.clientHeight;
      camera.aspect = w/h; camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    resizeObs.observe(mount);

    // Mouse
    const onMouseMove = (e: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      state.mouse.x =  ((e.clientX - rect.left) / rect.width)  * 2 - 1;
      state.mouse.y = -((e.clientY - rect.top)  / rect.height) * 2 + 1;
      state.lastInteraction = performance.now(); state.autoOrbiting = false;
    };

    const onClick = (e: MouseEvent) => {
      if (state.transitioning) return;
      const rect = renderer.domElement.getBoundingClientRect();
      const mx =  ((e.clientX - rect.left) / rect.width)  * 2 - 1;
      const my = -((e.clientY - rect.top)  / rect.height) * 2 + 1;
      state.raycaster.setFromCamera(new THREE.Vector2(mx, my), camera);

      if (state.scale === "universe") {
        const hits = state.raycaster.intersectObjects(state.galaxyEntries.map((g) => g.hitbox));
        if (hits.length > 0) enterGalaxy(state, data, hits[0].object.userData.galaxyId as string, glowTex, setLabels, setCurrentScale, propsRef, setWarpActive);
      } else if (state.scale === "galaxy") {
        const hits = state.raycaster.intersectObjects(state.starMeshes);
        if (hits.length > 0) {
          const starId = state.starIdForMesh.get(hits[0].object as THREE.Mesh);
          if (starId) enterSolarSystem(state, data, orreryConfig, starId, glowTex, setLabels, setCurrentScale, propsRef, setWarpActive);
        }
      } else if (state.scale === "solar-system") {
        const hits = state.raycaster.intersectObjects(state.planetMeshes);
        if (hits.length > 0) {
          const planetId = state.planetIdForMesh.get(hits[0].object as THREE.Mesh);
          if (planetId) enterPlanet(state, data, orreryConfig, planetId, glowTex, setLabels, setCurrentScale, propsRef, setWarpActive);
        }
      } else if (state.scale === "planet") {
        const hits = state.raycaster.intersectObjects(state.moonMeshes);
        if (hits.length > 0) {
          const moonId = state.moonIdForMesh.get(hits[0].object as THREE.Mesh);
          if (moonId) {
            // Clear previous arcs
            for (const arc of state.connectionArcs) { state.planetGroup.remove(arc); arc.geometry.dispose(); (arc.material as THREE.Material).dispose(); }
            state.connectionArcs = buildConnectionArcs(state.planetGroup, moonId, state.moonMeshes, state.moonIdForMesh, data.edges);
            state.selectedMoonId = moonId;
            const moonNode = data.nodeById.get(moonId);
            if (moonNode) propsRef.current.onSelectNode?.(toNodeDetail(moonNode));
          }
        } else {
          // Click on empty space → deselect
          if (state.selectedMoonId) {
            for (const arc of state.connectionArcs) { state.planetGroup.remove(arc); arc.geometry.dispose(); (arc.material as THREE.Material).dispose(); }
            state.connectionArcs = []; state.selectedMoonId = null;
            propsRef.current.onSelectNode?.(null);
          }
        }
      }
      state.lastInteraction = performance.now(); state.autoOrbiting = false;
    };

    const onWheel = () => { state.lastInteraction = performance.now(); state.autoOrbiting = false; };

    renderer.domElement.addEventListener("mousemove", onMouseMove);
    renderer.domElement.addEventListener("click",     onClick);
    renderer.domElement.addEventListener("wheel",     onWheel, { passive: true });

    const onKeyDown = (e: KeyboardEvent) => { if (e.key === "Escape") goBackRef.current(); };
    window.addEventListener("keydown", onKeyDown);

    // Animation loop
    function animate() {
      state.animFrameId = requestAnimationFrame(animate);
      const now   = performance.now();
      const delta = Math.min((now - state.prevTime) / 1000, 0.1);
      state.prevTime = now;
      const { speedMultiplier: speed, paused: isPaused } = propsRef.current;
      const dt = isPaused ? 0 : delta * speed;

      // Camera transition
      if (state.transitioning) {
        state.transitionProgress = Math.min(1, state.transitionProgress + delta / TRANSITION_DURATION);
        const t = easeInOut(state.transitionProgress);
        camera.position.lerpVectors(state.transitionFrom, state.transitionTo, t);
        state.controls.target.lerpVectors(state.transitionFromTarget, state.transitionToTarget, t);
        state.controls.update();
        if (state.transitionProgress >= 1) {
          state.transitioning = false;
          state.onTransitionEnd?.();
          state.onTransitionEnd = null;
        }
      } else {
        const idle = now - state.lastInteraction;
        if (idle > AUTO_ORBIT_DELAY_MS) state.autoOrbiting = true;
        if (state.autoOrbiting) camera.position.applyAxisAngle(new THREE.Vector3(0,1,0), AUTO_ORBIT_SPEED * delta);
        state.controls.update();
      }

      // Galaxy rotation (universe scale)
      if (state.scale === "universe" || (state.transitioning && state.scale === "galaxy")) {
        for (const g of state.galaxyEntries) g.group.rotation.y += g.rotationSpeed * dt;
      }

      // Star orbital animation (galaxy scale)
      if (state.scale === "galaxy") {
        for (let i = 0; i < state.starOrbits.length; i++) {
          const o = state.starOrbits[i];
          o.phase += o.angularSpeed * dt;
          const r = o.orbitalRadius * (1 - o.eccentricity * Math.cos(o.phase));
          state.starMeshes[i]?.position.set(
            r * Math.cos(o.phase) * Math.cos(o.inclination),
            o.yOffset + r * Math.sin(o.inclination) * 0.5,
            r * Math.sin(o.phase),
          );
          const pulse = 1 + 0.05 * Math.sin(now * 0.001 * (0.3 + hf(o.starId,"pf")*0.4) * Math.PI * 2 + hf(o.starId,"pp")*Math.PI*2);
          state.starMeshes[i]?.scale.setScalar(pulse);
        }
      }

      // Planet orbital animation (solar-system scale)
      if (state.scale === "solar-system") {
        for (let i = 0; i < state.planetOrbits.length; i++) {
          const o = state.planetOrbits[i];
          o.phase += o.angularSpeed * dt;
          const r = o.orbitalRadius * (1 - o.eccentricity * Math.cos(o.phase));
          state.planetMeshes[i]?.position.set(
            r * Math.cos(o.phase) * Math.cos(o.inclination),
            r * Math.sin(o.inclination) * 0.5,
            r * Math.sin(o.phase),
          );
          // Planet self-rotation
          if (state.planetMeshes[i]) state.planetMeshes[i].rotation.y += dt * (0.3 + hf(o.planetId,"rot")*0.5);
        }
        // Asteroid belt rotation
        for (const belt of state.asteroidBelts) belt.rotation.y += dt * 0.004;
      }

      // Moon orbital animation (planet scale)
      if (state.scale === "planet") {
        for (let i = 0; i < state.moonOrbits.length; i++) {
          const o = state.moonOrbits[i];
          o.phase += o.angularSpeed * dt;
          const r = o.orbitalRadius * (1 - o.eccentricity * Math.cos(o.phase));
          state.moonMeshes[i]?.position.set(
            r * Math.cos(o.phase) * Math.cos(o.inclination),
            r * Math.sin(o.inclination) * 0.5,
            r * Math.sin(o.phase),
          );
        }
        // Ring system slow rotation
        if (state.ringParticles) state.ringParticles.rotation.y += dt * 0.02;
        // Animate arc dashOffset
        for (const arc of state.connectionArcs) { const m = arc.material as THREE.LineDashedMaterial & { dashOffset: number }; m.dashOffset -= dt * 4; }
      }

      // Hover detection
      if (!state.transitioning) {
        state.raycaster.setFromCamera(state.mouse, camera);
        if      (state.scale === "universe")     updateGalaxyHover(state, data, propsRef);
        else if (state.scale === "galaxy")       updateStarHover(state, data, camera, mount!, setLabels, propsRef);
        else if (state.scale === "solar-system") updatePlanetHover(state, data, camera, mount!, setLabels, propsRef);
        else if (state.scale === "planet")       updateMoonHover(state, data, camera, mount!, setLabels, propsRef);
      }

      // Parallax background stars
      state.bgStars.position.set(-camera.position.x * 0.02, 0, -camera.position.z * 0.02);

      renderer.render(scene, camera);
    }

    animate();

    return () => {
      cancelAnimationFrame(state.animFrameId);
      renderer.domElement.removeEventListener("mousemove", onMouseMove);
      renderer.domElement.removeEventListener("click",     onClick);
      renderer.domElement.removeEventListener("wheel",     onWheel);
      window.removeEventListener("keydown", onKeyDown);
      resizeObs.disconnect();
      controls.dispose();
      renderer.dispose();
      circleTex.dispose(); glowTex.dispose();
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphData, orreryConfig]);

  return (
    <div ref={mountRef} style={{ width: "100%", height: "100%", position: "relative", background: "#05060d" }}>
      {/* Warp transition overlay (10.9) */}
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 5, background: "radial-gradient(ellipse at center, rgba(220,235,255,0.14) 0%, rgba(140,180,255,0.05) 40%, transparent 70%)", opacity: warpActive ? 1 : 0, transition: "opacity 0.8s ease-out" }} />
      {/* Label overlay */}
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden" }}>
        {labels.map((label) => (
          <div key={label.id} style={{ position: "absolute", left: label.x, top: label.y, transform: "translate(-50%,-100%)", opacity: label.opacity, transition: "opacity 0.2s", pointerEvents: "none", userSelect: "none", display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
            <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, color: "rgba(255,255,255,0.92)", background: "rgba(5,6,13,0.65)", padding: "2px 7px", borderRadius: 4, border: "1px solid rgba(255,255,255,0.12)", backdropFilter: "blur(4px)", whiteSpace: "nowrap" }}>
              {label.text}
            </span>
            {label.subtext && (
              <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: "rgba(255,200,80,0.75)", background: "rgba(5,6,13,0.5)", padding: "1px 5px", borderRadius: 3, whiteSpace: "nowrap" }}>
                {label.subtext}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Scale transitions ─────────────────────────────────────────────────────────

function enterGalaxy(state: SceneState, data: OrreryData, galaxyId: string, glowTex: THREE.Texture, setLabels: React.Dispatch<React.SetStateAction<Label[]>>, setCurrentScale: React.Dispatch<React.SetStateAction<OrreryScale>>, propsRef: React.MutableRefObject<PropsRef>, setWarpActive: React.Dispatch<React.SetStateAction<boolean>>) {
  if (state.transitioning) return;
  disposeGroup(state.galaxyScaleGroup); // 10.8 defensive clear
  setWarpActive(true); setTimeout(() => setWarpActive(false), 800); // 10.9 warp
  const entry = state.galaxyEntries.find((g) => g.id === galaxyId);
  if (!entry) return;

  state.selectedGalaxyId = galaxyId;
  const { starMeshes, starOrbits, starIdForMesh } = buildGalaxyObjects(state.galaxyScaleGroup, galaxyId, data, glowTex);
  state.starMeshes = starMeshes; state.starOrbits = starOrbits; state.starIdForMesh = starIdForMesh;

  state.galaxyScaleGroup.visible = false;
  state.transitionFrom = state.camera.position.clone(); state.transitionFromTarget = state.controls.target.clone();
  state.transitionTo   = new THREE.Vector3(0, STAR_GALAXY_DIST * 0.5, STAR_GALAXY_DIST);
  state.transitionToTarget = new THREE.Vector3(0,0,0);
  state.transitionProgress = 0; state.transitioning = true;
  state.onTransitionEnd = () => { state.galaxyScaleGroup.visible = true; state.universeGroup.visible = false; };
  state.scale = "galaxy";
  state.controls.minDistance = 50; state.controls.maxDistance = 1500;
  setLabels([]); setCurrentScale("galaxy");
  const galaxyNode = data.galaxyNodes.find((n) => n.id === galaxyId);
  propsRef.current.onScaleChange?.("galaxy", { galaxyName: galaxyNode?.name });
}

function enterSolarSystem(state: SceneState, data: OrreryData, orreryConfig: OrreryConfig, starId: string, glowTex: THREE.Texture, setLabels: React.Dispatch<React.SetStateAction<Label[]>>, setCurrentScale: React.Dispatch<React.SetStateAction<OrreryScale>>, propsRef: React.MutableRefObject<PropsRef>, setWarpActive: React.Dispatch<React.SetStateAction<boolean>>) {
  if (state.transitioning) return;
  disposeGroup(state.solarSystemGroup); // 10.8 defensive clear
  setWarpActive(true); setTimeout(() => setWarpActive(false), 800); // 10.9 warp

  state.selectedStarId = starId;
  const { planetMeshes, planetOrbits, orbitalRings, asteroidBelts, planetIdForMesh } = buildSolarSystemObjects(state.solarSystemGroup, starId, data, orreryConfig, glowTex);
  state.planetMeshes = planetMeshes; state.planetOrbits = planetOrbits; state.orbitalRings = orbitalRings; state.asteroidBelts = asteroidBelts; state.planetIdForMesh = planetIdForMesh;

  state.solarSystemGroup.visible = false;
  state.transitionFrom = state.camera.position.clone(); state.transitionFromTarget = state.controls.target.clone();
  state.transitionTo   = new THREE.Vector3(0, SOLAR_CAM_DIST * 0.5, SOLAR_CAM_DIST);
  state.transitionToTarget = new THREE.Vector3(0,0,0);
  state.transitionProgress = 0; state.transitioning = true;
  state.onTransitionEnd = () => { state.solarSystemGroup.visible = true; state.galaxyScaleGroup.visible = false; };
  state.scale = "solar-system";
  state.controls.minDistance = 20; state.controls.maxDistance = 400;
  setLabels([]); setCurrentScale("solar-system");

  const galNode  = state.selectedGalaxyId ? data.galaxyNodes.find((n) => n.id === state.selectedGalaxyId) : undefined;
  const starNode = data.nodeById.get(starId);
  propsRef.current.onScaleChange?.("solar-system", { galaxyName: galNode?.name, starName: starNode?.name });
}

function enterPlanet(state: SceneState, data: OrreryData, orreryConfig: OrreryConfig, planetId: string, glowTex: THREE.Texture, setLabels: React.Dispatch<React.SetStateAction<Label[]>>, setCurrentScale: React.Dispatch<React.SetStateAction<OrreryScale>>, propsRef: React.MutableRefObject<PropsRef>, setWarpActive: React.Dispatch<React.SetStateAction<boolean>>) {
  if (state.transitioning) return;
  disposeGroup(state.planetGroup); // 10.8 defensive clear
  setWarpActive(true); setTimeout(() => setWarpActive(false), 800); // 10.9 warp

  state.selectedPlanetId = planetId;
  const { moonMeshes, moonOrbits, ringParticles, moonIdForMesh, starBackgroundLight } = buildPlanetObjects(state.planetGroup, planetId, data, orreryConfig, glowTex, state.selectedStarId);
  state.moonMeshes = moonMeshes; state.moonOrbits = moonOrbits; state.ringParticles = ringParticles; state.moonIdForMesh = moonIdForMesh; state.starBackgroundLight = starBackgroundLight;

  state.planetGroup.visible = false;
  state.transitionFrom = state.camera.position.clone(); state.transitionFromTarget = state.controls.target.clone();
  state.transitionTo   = new THREE.Vector3(0, PLANET_CAM_DIST * 0.5, PLANET_CAM_DIST);
  state.transitionToTarget = new THREE.Vector3(0,0,0);
  state.transitionProgress = 0; state.transitioning = true;
  state.onTransitionEnd = () => { state.planetGroup.visible = true; state.solarSystemGroup.visible = false; };
  state.scale = "planet";
  state.controls.minDistance = 5; state.controls.maxDistance = 100;
  setLabels([]); setCurrentScale("planet");

  const galNode    = state.selectedGalaxyId ? data.galaxyNodes.find((n) => n.id === state.selectedGalaxyId) : undefined;
  const starNode   = state.selectedStarId   ? data.nodeById.get(state.selectedStarId) : undefined;
  const planetNode = data.nodeById.get(planetId);
  propsRef.current.onScaleChange?.("planet", { galaxyName: galNode?.name, starName: starNode?.name, planetName: planetNode?.name });
}

// ── Hover updaters ────────────────────────────────────────────────────────────

function easeInOut(t: number): number { return t < 0.5 ? 2*t*t : -1+(4-2*t)*t; }

function projectToScreen(mesh: THREE.Mesh | THREE.Object3D, camera: THREE.PerspectiveCamera, W: number, H: number): { x: number; y: number; z: number } | null {
  const v = new THREE.Vector3();
  mesh.getWorldPosition(v);
  v.project(camera);
  if (v.z > 1) return null;
  return { x: (v.x * 0.5 + 0.5) * W, y: (-v.y * 0.5 + 0.5) * H, z: v.z };
}

const HOVER_DEBOUNCE_MS = 150;

function emitHoverDebounced(state: SceneState, newId: string | null, data: OrreryData, tier: HoverInfo["tier"], propsRef: React.MutableRefObject<PropsRef>) {
  if (newId !== state.lastEmittedHoverId && performance.now() - state.hoverChangedAt >= HOVER_DEBOUNCE_MS) {
    state.lastEmittedHoverId = newId;
    if (newId) {
      const node = data.nodeById.get(newId);
      if (node) propsRef.current.onHover?.({ name: node.name, tier, databaseName: node.databaseName, connectionCount: data.connectionCount.get(newId) ?? 0, createdTime: node.createdTime });
    } else {
      propsRef.current.onHover?.(null);
    }
  }
}

function updateGalaxyHover(state: SceneState, data: OrreryData, propsRef: React.MutableRefObject<PropsRef>) {
  const hits = state.raycaster.intersectObjects(state.galaxyEntries.map((g) => g.hitbox));
  const newId = hits.length > 0 ? (hits[0].object.userData.galaxyId as string) : null;
  if (newId !== state.hoveredGalaxyId) {
    state.hoveredGalaxyId = newId;
    state.hoverChangedAt = performance.now();
  }
  emitHoverDebounced(state, state.hoveredGalaxyId, data, "galaxy", propsRef);
}

function updateStarHover(state: SceneState, data: OrreryData, camera: THREE.PerspectiveCamera, mount: HTMLDivElement, setLabels: React.Dispatch<React.SetStateAction<Label[]>>, propsRef: React.MutableRefObject<PropsRef>) {
  const hits    = state.raycaster.intersectObjects(state.starMeshes);
  const hoverId = hits.length > 0 ? state.starIdForMesh.get(hits[0].object as THREE.Mesh) ?? null : null;
  if (hoverId !== state.hoveredStarId) {
    state.hoveredStarId = hoverId;
    state.hoverChangedAt = performance.now();
  }
  emitHoverDebounced(state, state.hoveredStarId, data, "star", propsRef);
  const W = mount.clientWidth, H = mount.clientHeight;
  const newLabels: Label[] = [];
  for (let i = 0; i < state.starMeshes.length; i++) {
    const mesh = state.starMeshes[i];
    const starId = state.starIdForMesh.get(mesh);
    if (!starId) continue;
    const node = data.nodeById.get(starId);
    if (!node) continue;
    const proj = projectToScreen(mesh, camera, W, H);
    if (!proj || proj.x < -60 || proj.x > W+60 || proj.y < -30 || proj.y > H+30) continue;
    const dist     = camera.position.distanceTo(mesh.position);
    const isHover  = starId === hoverId;
    const opacity  = isHover ? 1 : Math.max(0, Math.min(0.65, (350 - dist) / 280));
    if (opacity < 0.05 && !isHover) continue;
    const planetCount = (data.starToPlanets.get(starId) ?? []).length;
    newLabels.push({ id: starId, text: node.name, subtext: isHover ? `${planetCount} planet${planetCount !== 1 ? "s" : ""}` : undefined, x: proj.x, y: proj.y - 18 - (mesh.userData.normalizedSize as number) * 10, opacity });
  }
  setLabels(newLabels);
}

function updatePlanetHover(state: SceneState, data: OrreryData, camera: THREE.PerspectiveCamera, mount: HTMLDivElement, setLabels: React.Dispatch<React.SetStateAction<Label[]>>, propsRef: React.MutableRefObject<PropsRef>) {
  const hits    = state.raycaster.intersectObjects(state.planetMeshes);
  const hoverId = hits.length > 0 ? state.planetIdForMesh.get(hits[0].object as THREE.Mesh) ?? null : null;
  if (hoverId !== state.hoveredPlanetId) {
    state.hoveredPlanetId = hoverId;
    state.hoverChangedAt = performance.now();
  }
  emitHoverDebounced(state, state.hoveredPlanetId, data, "planet", propsRef);
  const W = mount.clientWidth, H = mount.clientHeight;
  const newLabels: Label[] = [];
  for (const mesh of state.planetMeshes) {
    const planetId = state.planetIdForMesh.get(mesh);
    if (!planetId) continue;
    const node = data.nodeById.get(planetId);
    if (!node) continue;
    const proj = projectToScreen(mesh, camera, W, H);
    if (!proj || proj.x < -60 || proj.x > W+60 || proj.y < -30 || proj.y > H+30) continue;
    const isHover  = planetId === hoverId;
    const opacity  = isHover ? 1 : 0.5;
    const moonCount = (data.planetToMoons.get(planetId) ?? []).length;
    newLabels.push({ id: planetId, text: node.name, subtext: isHover ? `${moonCount} moon${moonCount !== 1 ? "s" : ""} · ${(mesh.userData.planetType as string).replace("-", " ")}` : undefined, x: proj.x, y: proj.y - 22 - (mesh.userData.normalizedSize as number)*8, opacity });
  }
  setLabels(newLabels);
}

function updateMoonHover(state: SceneState, data: OrreryData, camera: THREE.PerspectiveCamera, mount: HTMLDivElement, setLabels: React.Dispatch<React.SetStateAction<Label[]>>, propsRef: React.MutableRefObject<PropsRef>) {
  const hits    = state.raycaster.intersectObjects(state.moonMeshes);
  const hoverId = hits.length > 0 ? state.moonIdForMesh.get(hits[0].object as THREE.Mesh) ?? null : null;
  if (hoverId !== state.hoveredMoonId) {
    state.hoveredMoonId = hoverId;
    state.hoverChangedAt = performance.now();
  }
  emitHoverDebounced(state, state.hoveredMoonId, data, "moon", propsRef);
  const W = mount.clientWidth, H = mount.clientHeight;
  const newLabels: Label[] = [];
  for (const mesh of state.moonMeshes) {
    const moonId = state.moonIdForMesh.get(mesh);
    if (!moonId) continue;
    const node = data.nodeById.get(moonId);
    if (!node) continue;
    const proj = projectToScreen(mesh, camera, W, H);
    if (!proj || proj.x < -60 || proj.x > W+60 || proj.y < -30 || proj.y > H+30) continue;
    const isHover    = moonId === hoverId;
    const isSelected = moonId === state.selectedMoonId;
    const opacity    = (isHover || isSelected) ? 1 : 0.45;
    newLabels.push({ id: moonId, text: node.name, subtext: isSelected ? "selected" : undefined, x: proj.x, y: proj.y - 16, opacity });
  }
  setLabels(newLabels);
}
