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

// ─── Types ────────────────────────────────────────────────────────────────────

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
  // Label settings
  showLabelsFP: boolean;
  showLabelsOverhead: boolean;
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

// ─── Component ────────────────────────────────────────────────────────────────

export function CityCanvas({
  graph, onSelectNode, selectedNodeId,
  darkMode = false, firstPerson = false, onExitFirstPerson,
  showLabelsFP = true, showLabelsOverhead = false,
}: Props) {
  const mountRef    = useRef<HTMLDivElement>(null);
  const stateRef    = useRef<SceneState | null>(null);
  const onSelectRef = useRef(onSelectNode);
  const onExitFPRef = useRef(onExitFirstPerson);
  useEffect(() => { onSelectRef.current  = onSelectNode; },       [onSelectNode]);
  useEffect(() => { onExitFPRef.current  = onExitFirstPerson; },  [onExitFirstPerson]);

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
    ground.name = "ground";
    scene.add(ground);

    const gridColor = darkMode ? 0x222222 : 0xe8e2d8;
    scene.add(new THREE.GridHelper(600, 300, gridColor, gridColor));

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
    for (const node of cityNodes) {
      const w      = BUILDING_BASE * node.widthScale;
      const sprite = makeLabelSprite(node.name, w, darkMode);
      sprite.position.set(node.cx, node.height / 2, node.cz);
      scene.add(sprite);
      labelSprites.push(sprite);
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
        onSelectRef.current(null);
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
      if (s?.fpActive) {
        // First-person movement
        const speed = (s.fpKeys.has("ShiftLeft") || s.fpKeys.has("ShiftRight")) ? FP_SPRINT : FP_SPEED;
        const dt    = 1 / 60;
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
      } else {
        controls.update();
      }

      // Label visibility — runs every frame for both modes
      if (s) {
        for (const sp of s.labelSprites) {
          if (s.fpActive) {
            if (!s.showLabelsFP) {
              sp.visible = false;
            } else {
              sp.visible = true;
              const dist = camera.position.distanceTo(sp.position);
              let opacity = 0;
              if (dist <= LABEL_NEAR) {
                opacity = 0.5;
              } else if (dist < LABEL_FAR) {
                opacity = 0.5 * (1 - (dist - LABEL_NEAR) / (LABEL_FAR - LABEL_NEAR));
              }
              (sp.material as THREE.SpriteMaterial).opacity = opacity;
            }
          } else {
            if (!s.showLabelsOverhead) {
              sp.visible = false;
            } else {
              sp.visible = true;
              (sp.material as THREE.SpriteMaterial).opacity = 0.45;
            }
          }
        }
      }

      renderer.render(scene, camera);
    }
    animate();

    stateRef.current = {
      renderer, scene, camera, controls,
      buildingMap, connectionLines: [], streetGroup, labelSprites,
      graphEdges: graph.edges, darkMode,
      fpActive: false, fpYaw: 0, fpPitch: 0, fpKeys: new Set(),
      overheadPos:    new THREE.Vector3(),
      overheadTarget: new THREE.Vector3(),
      animFrameId,
      showLabelsFP, showLabelsOverhead,
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

  // ── Sync label settings into scene state ─────────────────────────────────
  useEffect(() => {
    const s = stateRef.current;
    if (!s) return;
    s.showLabelsFP = showLabelsFP;
    s.showLabelsOverhead = showLabelsOverhead;
  }, [showLabelsFP, showLabelsOverhead]);

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

  return <div ref={mountRef} style={{ width: "100%", height: "100%" }} />;
}
