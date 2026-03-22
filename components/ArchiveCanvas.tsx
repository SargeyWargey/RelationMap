"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import * as THREE from "three";

import type { GraphData } from "@/lib/types";
import {
  computeArchiveLayout,
  verifyArchiveLayout,
  type ArchiveBook,
  ARCHIVE,
} from "@/lib/archiveLayout";
import { ArchiveBookPanel }      from "@/components/ArchiveBookPanel";
import { ArchiveDirectoryKiosk } from "@/components/ArchiveDirectoryKiosk";
import { ArchiveOverheadMap }    from "@/components/ArchiveOverheadMap";

// ─── Constants ────────────────────────────────────────────────────────────────

const EYE_HEIGHT      = 1.6;
const FP_SPEED        = 5.0;
const FP_SPRINT       = 10.0;
const FP_SENS         = 0.002;
const PLAYER_RADIUS   = 0.4;
const PULL_DIST       = 0.5;   // units a selected book floats out
const PULL_DURATION   = 0.3;   // seconds for pull animation
const OVERHEAD_Y      = 40;    // height of overhead camera
const OVERHEAD_DUR    = 0.7;   // seconds for overhead transition
const NAV_DURATION    = 1.2;   // seconds for panel-navigation camera move
const DOLLY_DURATION  = 1.5;   // T-48: entry dolly animation (seconds)
const LOD_DIST_SQ     = 900;   // T-46: 30² — beyond this, hide spine labels
const DUST_ENABLED    = true;  // T-49: ambient dust particles (toggle off on low perf)
const DUST_COUNT      = 200;   // T-49: number of floating dust motes

const THEME = {
  dark:  { floor: 0x2a1f14, ceiling: 0x1a1008, shelf: 0x3d2b18, fog: 0x1a1a1a },
  light: { floor: 0xb5966a, ceiling: 0xd4c4a0, shelf: 0x7a5c3a, fog: 0xf0ebe0 },
} as const;

type ThemeKey = keyof typeof THEME;

// ─── Bridge — React ↔ Three.js ────────────────────────────────────────────────

interface Bridge {
  // Three.js → React  (filled in component body; useState setters are stable)
  setSelected:     (b: ArchiveBook | null) => void;
  setFpLocked:     (v: boolean) => void;
  setInOverhead:   (v: boolean) => void;
  setNearEntrance: (v: boolean) => void;
  setCameraPos:    (x: number, z: number) => void;
  // React → Three.js (filled inside useEffect)
  deselect:        () => void;
  navigate:        (nodeId: string) => void;
  navigateToAisle: (x: number, z: number) => void;
  navigateTo:      (x: number, z: number) => void;
}

// ─── Props ────────────────────────────────────────────────────────────────────

type Props = {
  graph:          GraphData;
  databaseColors: Record<string, string>;
};

// ─── Spine label canvas texture ───────────────────────────────────────────────

function makeSpineTexture(book: ArchiveBook): THREE.CanvasTexture {
  const cw = 128, ch = 512;
  const canvas = document.createElement("canvas");
  canvas.width = cw; canvas.height = ch;
  const ctx = canvas.getContext("2d")!;

  const base = new THREE.Color(book.color || "#555555");
  ctx.fillStyle = `#${base.getHexString()}`;
  ctx.fillRect(0, 0, cw, ch);

  ctx.fillStyle = "rgba(255,255,255,0.12)";
  ctx.fillRect(0, 0, 5, ch);
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.fillRect(cw - 4, 0, 4, ch);

  ctx.save();
  ctx.translate(cw / 2, ch - 12);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";

  const titleSize = Math.round(Math.max(13, 10 + book.bookHeight * 2.5));
  ctx.font = `bold ${titleSize}px Lora, Georgia, serif`;
  ctx.fillStyle = "#ffffff";
  ctx.fillText(book.name, 0, 0, ch - 24);

  if (book.createdBy) {
    const authSize = Math.round(Math.max(9, titleSize * 0.65));
    ctx.font = `${authSize}px Lora, Georgia, serif`;
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.fillText(book.createdBy, 0, titleSize + 4, ch - 24);
  }

  ctx.restore();
  return new THREE.CanvasTexture(canvas);
}

// ─── Section sign canvas texture ─────────────────────────────────────────────

function makeSignTexture(name: string, isDark: boolean): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512; canvas.height = 64;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = isDark ? "#2e1f0e" : "#c4a46a";
  ctx.fillRect(0, 0, 512, 64);
  ctx.strokeStyle = isDark ? "#ffd59e44" : "#3d2b1844";
  ctx.lineWidth = 2;
  ctx.strokeRect(4, 4, 504, 56);
  ctx.fillStyle = isDark ? "#ffd59e" : "#3d2b18";
  ctx.font = "bold 26px 'DM Mono', 'Courier New', monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(name.toUpperCase(), 256, 32);

  return new THREE.CanvasTexture(canvas);
}

// ─── Easing ───────────────────────────────────────────────────────────────────

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function smoothstep(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ArchiveCanvas({ graph, databaseColors }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);

  // Pure layout — memoized so aisles/books are available in JSX and useEffect
  const { books, aisles } = useMemo(() => computeArchiveLayout(graph), [graph]);

  const [selectedBook,  setSelectedBook]  = useState<ArchiveBook | null>(null);
  const [fpLocked,      setFpLocked]      = useState(false);
  const [inOverhead,    setInOverhead]    = useState(false);
  const [nearEntrance,  setNearEntrance]  = useState(true);
  const [cameraPos,     setCameraPos]     = useState({ x: 0, z: 2 });
  const [noPointerLock, setNoPointerLock] = useState(false);

  const bridge = useRef<Bridge>({
    setSelected:     () => {},
    setFpLocked:     () => {},
    setInOverhead:   () => {},
    setNearEntrance: () => {},
    setCameraPos:    () => {},
    deselect:        () => {},
    navigate:        () => {},
    navigateToAisle: () => {},
    navigateTo:      () => {},
  });

  // Keep React-side callbacks current — useState setters are stable across renders
  bridge.current.setSelected    = setSelectedBook;
  bridge.current.setFpLocked    = setFpLocked;
  bridge.current.setInOverhead  = setInOverhead;
  bridge.current.setNearEntrance = setNearEntrance;
  bridge.current.setCameraPos   = (x, z) => setCameraPos({ x, z });

  // T-51: Detect pointer-lock availability once on mount
  useEffect(() => {
    setNoPointerLock(!("pointerLockElement" in document));
  }, []);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    // ── Layout (computed via useMemo above; verify side-effects here) ─────────
    verifyArchiveLayout(books, graph.nodes);

    const getThemeKey = (): ThemeKey =>
      document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";

    let themeKey = getThemeKey();
    let theme    = THEME[themeKey];

    // ── Renderer ──────────────────────────────────────────────────────────────
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // T-52: cap at 2× for perf
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    // ── Scene ─────────────────────────────────────────────────────────────────
    const scene = new THREE.Scene();
    const fog   = new THREE.FogExp2(theme.fog, 0.018);
    scene.fog        = fog;
    scene.background = new THREE.Color(theme.fog);

    // ── Camera ────────────────────────────────────────────────────────────────
    const camera = new THREE.PerspectiveCamera(
      75, container.clientWidth / container.clientHeight, 0.1, 200
    );
    // T-48: start behind entrance; dolly animation moves camera to its resting position
    camera.position.set(0, EYE_HEIGHT, -4);
    camera.lookAt(0, EYE_HEIGHT, 10);

    // ── Entry dolly state (T-48) ──────────────────────────────────────────────
    const dollyStartPos = new THREE.Vector3(0, EYE_HEIGHT, -4);
    const dollyEndPos   = new THREE.Vector3(0, EYE_HEIGHT, 2);
    let   dollyActive   = true;
    let   dollyT        = 0;

    // ── Lighting ──────────────────────────────────────────────────────────────
    scene.add(new THREE.AmbientLight(0xffd59e, 0.25));
    const dirLight = new THREE.DirectionalLight(0xffb347, 0.35);
    dirLight.position.set(5, 12, 5);
    scene.add(dirLight);

    for (const aisle of aisles) {
      const steps = Math.ceil(ARCHIVE.AISLE_LENGTH / 8);
      for (let s = 0; s <= steps; s++) {
        const pl = new THREE.PointLight(0xffa040, 1.5, 16, 2);
        pl.position.set(aisle.originX, ARCHIVE.SHELF_HEIGHT - 0.3, aisle.originZ + s * 8);
        scene.add(pl);
      }
    }

    // ── Floor / ceiling bounds ────────────────────────────────────────────────
    const totalCols = Math.max(1, Math.min(aisles.length, 3));
    const totalRows = Math.max(1, Math.ceil(aisles.length / 3));
    const floorW    = totalCols * ARCHIVE.AISLE_PITCH_X + 20;
    const floorD    = totalRows * ARCHIVE.AISLE_PITCH_Z + ARCHIVE.ENTRANCE_Z_OFFSET + 12;
    const floorCX   = ((totalCols - 1) * ARCHIVE.AISLE_PITCH_X) / 2;
    const floorCZ   = ARCHIVE.ENTRANCE_Z_OFFSET + (totalRows * ARCHIVE.AISLE_PITCH_Z) / 2;

    const floorMat  = new THREE.MeshLambertMaterial({ color: theme.floor });
    const floorMesh = new THREE.Mesh(new THREE.PlaneGeometry(floorW, floorD), floorMat);
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.position.set(floorCX, 0, floorCZ);
    floorMesh.receiveShadow = true;
    scene.add(floorMesh);

    const ceilMat  = new THREE.MeshLambertMaterial({ color: theme.ceiling, side: THREE.BackSide });
    const ceilMesh = new THREE.Mesh(new THREE.PlaneGeometry(floorW, floorD), ceilMat);
    ceilMesh.rotation.x = Math.PI / 2;
    ceilMesh.position.set(floorCX, ARCHIVE.SHELF_HEIGHT + 2, floorCZ);
    scene.add(ceilMesh);

    // ── Shelves ───────────────────────────────────────────────────────────────
    const shelfMats:   THREE.MeshLambertMaterial[]        = [];
    const shelfBounds: [number, number, number, number][] = [];

    function buildShelf(x: number, originZ: number) {
      const mat = new THREE.MeshLambertMaterial({ color: theme.shelf });
      shelfMats.push(mat);
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(ARCHIVE.SHELF_THICKNESS, ARCHIVE.SHELF_HEIGHT, ARCHIVE.AISLE_LENGTH),
        mat
      );
      mesh.position.set(x, ARCHIVE.SHELF_HEIGHT / 2, originZ + ARCHIVE.AISLE_LENGTH / 2);
      mesh.castShadow = mesh.receiveShadow = true;
      scene.add(mesh);
      const ht = ARCHIVE.SHELF_THICKNESS / 2;
      shelfBounds.push([x - ht, x + ht, originZ, originZ + ARCHIVE.AISLE_LENGTH]);
    }

    for (const aisle of aisles) {
      buildShelf(aisle.originX - ARCHIVE.WALKWAY_WIDTH / 2 - ARCHIVE.SHELF_THICKNESS / 2, aisle.originZ);
      buildShelf(aisle.originX + ARCHIVE.WALKWAY_WIDTH / 2 + ARCHIVE.SHELF_THICKNESS / 2, aisle.originZ);
    }

    // ── Entrance podium (T-33) ────────────────────────────────────────────────
    const podiumMat = new THREE.MeshLambertMaterial({ color: theme.shelf });
    shelfMats.push(podiumMat);
    const podiumMesh = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.0, 0.8), podiumMat);
    podiumMesh.position.set(0, 0.5, 5);
    podiumMesh.castShadow = true;
    scene.add(podiumMesh);

    // ── InstancedMesh books ───────────────────────────────────────────────────
    const unitBox = new THREE.BoxGeometry(1, 1, 1);

    // Lookup structures for raycasting and navigation
    const allInstancedMeshes: THREE.InstancedMesh[]                               = [];
    const meshToBooks        = new Map<THREE.InstancedMesh, ArchiveBook[]>();
    const bookToInstance     = new Map<string, { mesh: THREE.InstancedMesh; idx: number }>();
    const bookByNodeId       = new Map<string, ArchiveBook>();

    for (const book of books) bookByNodeId.set(book.id, book);

    const booksByDb = new Map<string, ArchiveBook[]>();
    for (const book of books) {
      if (!booksByDb.has(book.databaseId)) booksByDb.set(book.databaseId, []);
      booksByDb.get(book.databaseId)!.push(book);
    }

    // Reusable scratch math objects
    const mat4      = new THREE.Matrix4();
    const posVec    = new THREE.Vector3();
    const rotQuat   = new THREE.Quaternion();
    const scaleVec  = new THREE.Vector3();
    const tiltEuler = new THREE.Euler();

    for (const [, dbBooks] of booksByDb) {
      const baseColor   = new THREE.Color(dbBooks[0].color || "#888888");
      const emissiveCol = baseColor.clone().multiplyScalar(0.2);

      const mat = new THREE.MeshStandardMaterial({
        color: baseColor, emissive: emissiveCol, emissiveIntensity: 1.0,
        roughness: 0.78, metalness: 0.0,
      });

      const mesh = new THREE.InstancedMesh(unitBox, mat, dbBooks.length);
      mesh.castShadow = mesh.receiveShadow = true;

      for (let i = 0; i < dbBooks.length; i++) {
        const b = dbBooks[i];
        posVec.set(b.bookX, b.bookY, b.bookZ);
        tiltEuler.set(0, 0, b.tiltZ);
        rotQuat.setFromEuler(tiltEuler);
        scaleVec.set(b.bookWidth, b.bookHeight, b.bookDepth);
        mat4.compose(posVec, rotQuat, scaleVec);
        mesh.setMatrixAt(i, mat4);
        bookToInstance.set(b.id, { mesh, idx: i });
      }

      mesh.instanceMatrix.needsUpdate = true;
      scene.add(mesh);
      allInstancedMeshes.push(mesh);
      meshToBooks.set(mesh, dbBooks);
    }

    // ── Spine labels ──────────────────────────────────────────────────────────
    const spineTextures: THREE.CanvasTexture[] = [];
    // T-46: store world-XZ positions for per-frame LOD visibility culling
    const spineMeshes: Array<{ mesh: THREE.Mesh; bx: number; bz: number }> = [];

    for (const book of books) {
      const texture   = makeSpineTexture(book);
      spineTextures.push(texture);
      const spineGeo  = new THREE.PlaneGeometry(book.bookDepth, book.bookHeight);
      const spineMesh = new THREE.Mesh(spineGeo, new THREE.MeshBasicMaterial({ map: texture }));
      const GAP       = 0.003;
      const spineX    = book.shelfSide === "left"
        ? book.bookX + book.bookWidth / 2 + GAP
        : book.bookX - book.bookWidth / 2 - GAP;
      spineMesh.position.set(spineX, book.bookY, book.bookZ);
      spineMesh.rotation.y = book.shelfSide === "left" ? -Math.PI / 2 : Math.PI / 2;
      scene.add(spineMesh);
      spineMeshes.push({ mesh: spineMesh, bx: book.bookX, bz: book.bookZ });
    }

    // ── Section signs ─────────────────────────────────────────────────────────
    for (const aisle of aisles) {
      const texture   = makeSignTexture(aisle.databaseName, themeKey === "dark");
      const spriteMat = new THREE.SpriteMaterial({ map: texture, transparent: true });
      const sprite    = new THREE.Sprite(spriteMat);
      sprite.scale.set(8, 1, 1);
      sprite.position.set(aisle.originX, ARCHIVE.SHELF_HEIGHT + 0.9, aisle.originZ - 1.5);
      scene.add(sprite);
    }

    // ── Ambient dust particles (T-49) ────────────────────────────────────────
    let dustGeo: THREE.BufferGeometry | null = null;
    let dustInitPos: Float32Array | null     = null;
    let dustPointsMesh: THREE.Points | null  = null;

    if (DUST_ENABLED) {
      const positions = new Float32Array(DUST_COUNT * 3);
      for (let i = 0; i < DUST_COUNT; i++) {
        positions[i * 3]     = floorCX + (Math.random() - 0.5) * floorW * 0.85;
        positions[i * 3 + 1] = Math.random() * (ARCHIVE.SHELF_HEIGHT + 0.5);
        positions[i * 3 + 2] = floorD * Math.random();
      }
      dustInitPos = positions.slice();
      dustGeo     = new THREE.BufferGeometry();
      dustGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      dustPointsMesh = new THREE.Points(
        dustGeo,
        new THREE.PointsMaterial({ color: 0xffa040, size: 0.04, transparent: true, opacity: 0.5, sizeAttenuation: true })
      );
      scene.add(dustPointsMesh);
    }

    // ── Hover box (T-24) ──────────────────────────────────────────────────────
    const hoverBox = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({
        color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.3,
        transparent: true, opacity: 0.1, depthWrite: false,
      })
    );
    hoverBox.visible = false;
    scene.add(hoverBox);

    // ── Accent color (for edge lines) ─────────────────────────────────────────
    const accentWarm = getComputedStyle(document.documentElement)
      .getPropertyValue("--accent-warm").trim() || "#d97757";

    // ── Selection + animation state ───────────────────────────────────────────
    let selectedBookRef: ArchiveBook | null = null;

    // Pull animation — book floats off shelf on select
    let pullAnimBook: ArchiveBook | null     = null;
    let pullAnimMesh: THREE.InstancedMesh | null = null;
    let pullAnimIdx     = -1;
    let pullAnimProg    = 0;    // 0 = on shelf, 1 = fully pulled out
    let pullAnimTarget  = 0;    // drives direction: 0 pull back, 1 pull out

    // Connection edge lines (T-27)
    const connectionLines: THREE.Line[] = [];

    // Neighbor highlight overlays (T-28)
    const neighborHighlights: THREE.Mesh[] = [];

    // ── Helper: set book instance position with pull offset ───────────────────
    function applyPullOffset(
      book: ArchiveBook,
      mesh: THREE.InstancedMesh,
      idx:  number,
      t:    number
    ) {
      const dir    = book.shelfSide === "left" ? 1 : -1;
      const offset = easeInOut(t) * PULL_DIST;
      posVec.set(book.bookX + dir * offset, book.bookY, book.bookZ);
      tiltEuler.set(0, 0, book.tiltZ);
      rotQuat.setFromEuler(tiltEuler);
      scaleVec.set(book.bookWidth, book.bookHeight, book.bookDepth);
      mat4.compose(posVec, rotQuat, scaleVec);
      mesh.setMatrixAt(idx, mat4);
      mesh.instanceMatrix.needsUpdate = true;
    }

    // ── Helper: build bezier connection lines ─────────────────────────────────
    function buildConnectionLines(book: ArchiveBook) {
      const edgeColor = new THREE.Color(accentWarm);
      const startPos  = new THREE.Vector3(book.bookX, book.bookY + book.bookHeight * 0.5, book.bookZ);

      for (const edge of graph.edges) {
        let neighborId: string | null = null;
        if (edge.source === book.id) neighborId = edge.target;
        else if (edge.target === book.id) neighborId = edge.source;
        if (!neighborId) continue;

        const neighbor = bookByNodeId.get(neighborId);
        if (!neighbor) continue;

        const endPos = new THREE.Vector3(
          neighbor.bookX,
          neighbor.bookY + neighbor.bookHeight * 0.5,
          neighbor.bookZ
        );

        // Control point: midpoint raised 3 units for arc effect
        const mid = startPos.clone().add(endPos).multiplyScalar(0.5);
        mid.y += 3;

        const curve   = new THREE.QuadraticBezierCurve3(startPos, mid, endPos);
        const points  = curve.getPoints(28);
        const lineMat = new THREE.LineBasicMaterial({
          color: edgeColor, transparent: true, opacity: 0.65,
        });
        const line = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(points),
          lineMat
        );
        scene.add(line);
        connectionLines.push(line);
      }
    }

    function clearConnectionLines() {
      for (const line of connectionLines) {
        scene.remove(line);
        line.geometry.dispose();
        (line.material as THREE.Material).dispose();
      }
      connectionLines.length = 0;
    }

    // ── Helper: build neighbor highlight overlays ─────────────────────────────
    function buildNeighborHighlights(book: ArchiveBook) {
      const neighborIds = new Set<string>();
      for (const edge of graph.edges) {
        if (edge.source === book.id) neighborIds.add(edge.target);
        else if (edge.target === book.id) neighborIds.add(edge.source);
      }

      for (const nid of neighborIds) {
        const nb = bookByNodeId.get(nid);
        if (!nb) continue;

        const hlMat = new THREE.MeshStandardMaterial({
          color:             new THREE.Color(nb.color || "#888"),
          emissive:          new THREE.Color(nb.color || "#888"),
          emissiveIntensity: 0.6,
          transparent:       true,
          opacity:           0.22,
          depthWrite:        false,
        });

        const hlMesh = new THREE.Mesh(unitBox, hlMat);
        hlMesh.position.set(nb.bookX, nb.bookY, nb.bookZ);
        hlMesh.rotation.z = nb.tiltZ;
        hlMesh.scale.set(nb.bookWidth + 0.05, nb.bookHeight + 0.05, nb.bookDepth + 0.05);
        scene.add(hlMesh);
        neighborHighlights.push(hlMesh);
      }
    }

    function clearNeighborHighlights() {
      for (const m of neighborHighlights) {
        scene.remove(m);
        (m.material as THREE.Material).dispose();
      }
      neighborHighlights.length = 0;
    }

    // ── Select / deselect (T-25 / T-26 / T-32) ───────────────────────────────
    function selectBook(book: ArchiveBook) {
      if (selectedBookRef?.id === book.id) return;

      // Instantly reset any previously pulled-out book
      if (pullAnimBook && pullAnimMesh && pullAnimIdx >= 0) {
        applyPullOffset(pullAnimBook, pullAnimMesh, pullAnimIdx, 0);
      }
      clearConnectionLines();
      clearNeighborHighlights();

      selectedBookRef = book;
      const entry = bookToInstance.get(book.id);
      if (!entry) return;

      pullAnimBook   = book;
      pullAnimMesh   = entry.mesh;
      pullAnimIdx    = entry.idx;
      pullAnimProg   = 0;
      pullAnimTarget = 1;

      buildConnectionLines(book);
      buildNeighborHighlights(book);

      bridge.current.setSelected(book);

      // Release pointer lock so the user can interact with the panel
      if (document.pointerLockElement === renderer.domElement) {
        document.exitPointerLock();
      }
    }

    function deselectBook() {
      if (!selectedBookRef) return;
      clearConnectionLines();
      clearNeighborHighlights();

      // Keep pullAnim refs — animate back to shelf
      pullAnimTarget = 0;
      selectedBookRef = null;
      bridge.current.setSelected(null);
    }

    // ── Click handler: book selection (T-25) ──────────────────────────────────
    const raycaster    = new THREE.Raycaster();
    const SCREEN_CTR   = new THREE.Vector2(0, 0);
    let   mouseVec     = new THREE.Vector2(0, 0);
    let   fpActive     = false;

    function handleBookClick() {
      const origin = fpActive ? SCREEN_CTR : mouseVec;
      raycaster.setFromCamera(origin, camera);
      const hits = raycaster.intersectObjects(allInstancedMeshes, false);

      if (hits.length > 0 && hits[0].instanceId !== undefined) {
        const hit   = hits[0];
        const dbArr = meshToBooks.get(hit.object as THREE.InstancedMesh);
        if (!dbArr) return;
        const book  = dbArr[hit.instanceId!];

        if (selectedBookRef?.id === book.id) {
          deselectBook();
        } else {
          selectBook(book);
        }
      } else {
        deselectBook();
      }
    }

    // ── Navigation: panel → camera (T-31) ────────────────────────────────────
    let navActive     = false;
    let navT          = 0;
    let pendingSelect = "";
    const navStartPos = new THREE.Vector3();
    const navTargetPos = new THREE.Vector3();

    function navigateToBook(nodeId: string) {
      const target = bookByNodeId.get(nodeId);
      if (!target) return;

      // Stand in the walkway of the target aisle at the book's Z
      navTargetPos.set(target.aisle.originX, EYE_HEIGHT, target.bookZ);
      navStartPos.copy(camera.position);
      navT          = 0;
      navActive     = true;
      pendingSelect = nodeId;
    }

    // ── Navigate to aisle entrance (T-35) ────────────────────────────────────
    function navigateToAislePos(x: number, z: number) {
      navTargetPos.set(x, EYE_HEIGHT, z);
      navStartPos.copy(camera.position);
      navT          = 0;
      navActive     = true;
      pendingSelect = "";
    }

    // ── Navigate from overhead map click (T-41) ───────────────────────────────
    function navigateTo(x: number, z: number) {
      if (overheadMode && !overheadAnim) {
        // Override the FP return position so the camera lands at the clicked spot
        savedFpPos.set(x, EYE_HEIGHT, z);
        savedFpQuat.setFromEuler(new THREE.Euler(0, 0, 0, "YXZ"));
        savedFpYaw   = 0;
        savedFpPitch = 0;
        overheadMode = false;
        overheadProg = 1;
        overheadAnim = true;
        bridge.current.setInOverhead(false);
      }
    }

    // ── Overhead view (T-23) ──────────────────────────────────────────────────
    let   overheadMode   = false;
    let   overheadAnim   = false;
    let   overheadProg   = 0;   // 0 = FP, 1 = overhead
    const savedFpPos     = new THREE.Vector3();
    const savedFpQuat    = new THREE.Quaternion();
    let   savedFpYaw     = 0;
    let   savedFpPitch   = 0;
    const overheadPos    = new THREE.Vector3(floorCX, OVERHEAD_Y, floorCZ);
    const overheadQuat   = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(-Math.PI / 2, 0, 0)
    );

    function handleTabToggle() {
      if (!overheadMode && !overheadAnim) {
        // Enter overhead
        savedFpPos.copy(camera.position);
        savedFpQuat.copy(camera.quaternion);
        savedFpYaw   = fpYaw;
        savedFpPitch = fpPitch;
        overheadMode = true;
        overheadProg = 0;
        overheadAnim = true;
        if (document.pointerLockElement === renderer.domElement) document.exitPointerLock();
        bridge.current.setInOverhead(true);
      } else if (overheadMode && !overheadAnim) {
        // Return to FP
        overheadMode = false;
        overheadProg = 1;
        overheadAnim = true;
        bridge.current.setInOverhead(false);
      }
    }

    // ── Fill bridge → Three.js ────────────────────────────────────────────────
    bridge.current.deselect        = deselectBook;
    bridge.current.navigate        = navigateToBook;
    bridge.current.navigateToAisle = navigateToAislePos;
    bridge.current.navigateTo      = navigateTo;

    // ── FP controls ───────────────────────────────────────────────────────────
    const fpKeys  = new Set<string>();
    let   fpYaw   = 0;
    let   fpPitch = 0;

    const onPointerLockChange = () => {
      fpActive = document.pointerLockElement === renderer.domElement;
      bridge.current.setFpLocked(fpActive);
      if (fpActive) dollyActive = false; // T-48: skip dolly when user manually engages
    };

    const onClick = () => {
      if (!fpActive) {
        renderer.domElement.requestPointerLock();
      } else {
        handleBookClick();
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      fpKeys.add(e.code);

      if (e.code === "Tab") {
        e.preventDefault();
        handleTabToggle();
      }

      if (e.code === "Escape" && selectedBookRef) {
        deselectBook();
      }
    };

    const onKeyUp = (e: KeyboardEvent) => fpKeys.delete(e.code);

    const onMouseMove = (e: MouseEvent) => {
      if (fpActive) {
        fpYaw   -= e.movementX * FP_SENS;
        fpPitch -= e.movementY * FP_SENS;
        fpPitch  = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, fpPitch));
        return;
      }
      // Cursor-mode: track mouse for raycasting
      const rect = renderer.domElement.getBoundingClientRect();
      mouseVec = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width)  *  2 - 1,
        ((e.clientY - rect.top)  / rect.height) * -2 + 1
      );
    };

    renderer.domElement.addEventListener("click", onClick);
    document.addEventListener("pointerlockchange", onPointerLockChange);
    document.addEventListener("keydown",    onKeyDown);
    document.addEventListener("keyup",      onKeyUp);
    document.addEventListener("mousemove",  onMouseMove);

    // ── Collision ─────────────────────────────────────────────────────────────
    function resolveCollisions(pos: THREE.Vector3) {
      for (const [minX, maxX, minZ, maxZ] of shelfBounds) {
        const eX0 = minX - PLAYER_RADIUS, eX1 = maxX + PLAYER_RADIUS;
        const eZ0 = minZ - PLAYER_RADIUS, eZ1 = maxZ + PLAYER_RADIUS;
        if (pos.x > eX0 && pos.x < eX1 && pos.z > eZ0 && pos.z < eZ1) {
          const dL = pos.x - eX0, dR = eX1 - pos.x;
          const dF = pos.z - eZ0, dB = eZ1 - pos.z;
          const m  = Math.min(dL, dR, dF, dB);
          if      (m === dL) pos.x = eX0;
          else if (m === dR) pos.x = eX1;
          else if (m === dF) pos.z = eZ0;
          else               pos.z = eZ1;
        }
      }
    }

    // ── Theme observer ────────────────────────────────────────────────────────
    const themeObserver = new MutationObserver(() => {
      themeKey = getThemeKey();
      theme    = THEME[themeKey];
      fog.color.setHex(theme.fog);
      scene.background = new THREE.Color(theme.fog);
      floorMat.color.setHex(theme.floor);
      ceilMat.color.setHex(theme.ceiling);
      for (const m of shelfMats) m.color.setHex(theme.shelf);
    });
    themeObserver.observe(document.documentElement, {
      attributes: true, attributeFilter: ["data-theme"],
    });

    // ── Render loop ───────────────────────────────────────────────────────────
    const moveDir    = new THREE.Vector3();
    const lookEuler  = new THREE.Euler(0, 0, 0, "YXZ");
    const moveEuler  = new THREE.Euler();

    let prevTime    = performance.now();
    let animFrameId = 0;
    let hoveredBook: ArchiveBook | null = null;

    // Camera-position throttle (for kiosk proximity + overhead map dot)
    let camPosTimer    = 0;
    let lastCamPosX    = camera.position.x;
    let lastCamPosZ    = camera.position.z;
    let lastNearEntrance = true;

    const renderFrame = (now: number) => {
      animFrameId = requestAnimationFrame(renderFrame);
      const dt = Math.min((now - prevTime) / 1000, 0.1);
      prevTime  = now;

      // ── T-48: Entry dolly ────────────────────────────────────────────────
      if (dollyActive) {
        dollyT = Math.min(1, dollyT + dt / DOLLY_DURATION);
        camera.position.lerpVectors(dollyStartPos, dollyEndPos, smoothstep(dollyT));
        camera.lookAt(0, EYE_HEIGHT, 10);
        if (dollyT >= 1) dollyActive = false;
      }

      // ── T-23: Overhead transition ─────────────────────────────────────────
      if (overheadAnim) {
        const dir = overheadMode ? 1 : -1;
        overheadProg = Math.max(0, Math.min(1, overheadProg + dir * dt / OVERHEAD_DUR));
        const t      = smoothstep(overheadProg);

        camera.position.lerpVectors(savedFpPos, overheadPos, t);
        camera.quaternion.slerpQuaternions(savedFpQuat, overheadQuat, t);

        if (overheadProg >= 1 || overheadProg <= 0) {
          overheadAnim = false;
          if (!overheadMode) {
            // Restore FP look direction
            fpYaw   = savedFpYaw;
            fpPitch = savedFpPitch;
          }
        }
      }

      // ── FP movement (disabled during transitions) ─────────────────────────
      else if (fpActive && !overheadMode && !navActive && !dollyActive) {
        const speed = fpKeys.has("ShiftLeft") || fpKeys.has("ShiftRight")
          ? FP_SPRINT : FP_SPEED;
        moveDir.set(0, 0, 0);
        if (fpKeys.has("KeyW") || fpKeys.has("ArrowUp"))    moveDir.z -= 1;
        if (fpKeys.has("KeyS") || fpKeys.has("ArrowDown"))  moveDir.z += 1;
        if (fpKeys.has("KeyA") || fpKeys.has("ArrowLeft"))  moveDir.x -= 1;
        if (fpKeys.has("KeyD") || fpKeys.has("ArrowRight")) moveDir.x += 1;

        if (moveDir.lengthSq() > 0) {
          moveEuler.set(0, fpYaw, 0);
          moveDir.normalize().applyEuler(moveEuler);
          camera.position.addScaledVector(moveDir, speed * dt);
          resolveCollisions(camera.position);
        }

        camera.position.y = EYE_HEIGHT;
        lookEuler.x = fpPitch; lookEuler.y = fpYaw;
        camera.quaternion.setFromEuler(lookEuler);
      }

      // ── Panel navigation (T-31) ───────────────────────────────────────────
      if (navActive) {
        navT = Math.min(1, navT + dt / NAV_DURATION);
        const t = smoothstep(navT);
        camera.position.lerpVectors(navStartPos, navTargetPos, t);
        camera.position.y = EYE_HEIGHT;

        if (navT >= 1) {
          navActive = false;
          if (pendingSelect) {
            const bk = bookByNodeId.get(pendingSelect);
            if (bk) selectBook(bk);
            pendingSelect = "";
          }
        }
      }

      // ── Pull animation (T-26) ─────────────────────────────────────────────
      if (pullAnimBook && pullAnimMesh && pullAnimProg !== pullAnimTarget) {
        const dir  = pullAnimTarget > pullAnimProg ? 1 : -1;
        pullAnimProg = Math.max(0, Math.min(1, pullAnimProg + dir * dt / PULL_DURATION));
        applyPullOffset(pullAnimBook, pullAnimMesh, pullAnimIdx, pullAnimProg);

        if (pullAnimProg <= 0) {
          // Fully returned — clear anim refs
          pullAnimBook = null;
          pullAnimMesh = null;
          pullAnimIdx  = -1;
        }
      }

      // ── T-28: Neighbor highlight pulse ────────────────────────────────────
      if (neighborHighlights.length > 0) {
        const pulse = Math.sin(now * 0.003) * 0.25 + 0.5;
        for (const m of neighborHighlights) {
          (m.material as THREE.MeshStandardMaterial).emissiveIntensity = pulse;
        }
      }

      // ── T-24: Hover raycasting ────────────────────────────────────────────
      const origin = fpActive ? SCREEN_CTR : mouseVec;
      raycaster.setFromCamera(origin, camera);
      const hits = raycaster.intersectObjects(allInstancedMeshes, false);

      if (hits.length > 0 && hits[0].instanceId !== undefined) {
        const hit = hits[0];
        const arr = meshToBooks.get(hit.object as THREE.InstancedMesh);
        if (arr) {
          hoveredBook = arr[hit.instanceId!];
          // Don't show hover box on the already-selected book
          if (hoveredBook.id !== selectedBookRef?.id) {
            hoverBox.position.set(hoveredBook.bookX, hoveredBook.bookY, hoveredBook.bookZ);
            hoverBox.rotation.z = hoveredBook.tiltZ;
            hoverBox.scale.set(
              hoveredBook.bookWidth  + 0.05,
              hoveredBook.bookHeight + 0.05,
              hoveredBook.bookDepth  + 0.05
            );
            hoverBox.visible = true;
          } else {
            hoverBox.visible = false;
          }
        }
      } else {
        hoveredBook     = null;
        hoverBox.visible = false;
      }

      // ── T-46: LOD — hide spine labels beyond 30 units ────────────────────
      for (const { mesh, bx, bz } of spineMeshes) {
        const dx = camera.position.x - bx;
        const dz = camera.position.z - bz;
        mesh.visible = dx * dx + dz * dz < LOD_DIST_SQ;
      }

      // ── T-49: Animate dust motes ──────────────────────────────────────────
      if (DUST_ENABLED && dustGeo && dustInitPos) {
        const pos = dustGeo.attributes.position as THREE.BufferAttribute;
        const t   = now * 0.0003;
        for (let i = 0; i < DUST_COUNT; i++) {
          const ti = t + i * 0.4;
          pos.setX(i, dustInitPos[i * 3]     + Math.sin(ti * 0.8) * 0.1);
          pos.setY(i, dustInitPos[i * 3 + 1] + Math.sin(ti)       * 0.15);
          pos.setZ(i, dustInitPos[i * 3 + 2] + Math.cos(ti * 0.6) * 0.1);
        }
        pos.needsUpdate = true;
      }

      // Update cursor in non-FP mode
      if (!fpActive) {
        container.style.cursor = hoveredBook ? "pointer" : "default";
      }

      // ── Camera pos → kiosk proximity + overhead map dot ───────────────────
      camPosTimer += dt;
      if (camPosTimer >= 0.08) {
        camPosTimer = 0;
        const cx = camera.position.x;
        const cz = camera.position.z;
        if (Math.abs(cx - lastCamPosX) > 0.5 || Math.abs(cz - lastCamPosZ) > 0.5) {
          lastCamPosX = cx;
          lastCamPosZ = cz;
          bridge.current.setCameraPos(cx, cz);
        }
        const near = cz < ARCHIVE.ENTRANCE_Z_OFFSET + 14;
        if (near !== lastNearEntrance) {
          lastNearEntrance = near;
          bridge.current.setNearEntrance(near);
        }
      }

      renderer.render(scene, camera);
    };

    animFrameId = requestAnimationFrame(renderFrame);

    // ── Resize ────────────────────────────────────────────────────────────────
    const onResize = () => {
      camera.aspect = container.clientWidth / container.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
    };
    window.addEventListener("resize", onResize);

    // ── Cleanup ───────────────────────────────────────────────────────────────
    return () => {
      cancelAnimationFrame(animFrameId);
      themeObserver.disconnect();
      window.removeEventListener("resize", onResize);
      renderer.domElement.removeEventListener("click", onClick);
      document.removeEventListener("pointerlockchange", onPointerLockChange);
      document.removeEventListener("keydown",   onKeyDown);
      document.removeEventListener("keyup",     onKeyUp);
      document.removeEventListener("mousemove", onMouseMove);
      if (document.pointerLockElement === renderer.domElement) document.exitPointerLock();
      clearConnectionLines();
      clearNeighborHighlights();
      for (const t of spineTextures) t.dispose();
      if (dustPointsMesh) scene.remove(dustPointsMesh);
      if (dustGeo)        dustGeo.dispose();
      renderer.dispose();
      container.removeChild(renderer.domElement);
    };
  }, [graph, databaseColors]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── JSX ───────────────────────────────────────────────────────────────────

  const MONO = "'DM Mono', 'Courier New', monospace";
  const HINT = {
    position:       "absolute" as const,
    pointerEvents:  "none"     as const,
    fontFamily:     MONO,
    fontSize:       12,
    letterSpacing:  "0.07em",
    textShadow:     "0 1px 6px rgba(0,0,0,0.95)",
    color:          "rgba(255,213,158,0.65)",
  };

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden" }}>

      {/* Three.js canvas mount */}
      <div
        ref={mountRef}
        style={{ width: "100%", height: "100%", cursor: fpLocked ? "none" : "default" }}
      />

      {/* ── Wordmark / home link (T-43) ───────────────────────────────────── */}
      <div style={{ position: "absolute", top: 20, left: 24, zIndex: 20 }}>
        <Link href="/" style={{ textDecoration: "none" }}>
          <div
            style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2, cursor: "pointer", opacity: 1, transition: "opacity 0.15s" }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.opacity = "0.65"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.opacity = "1"; }}
          >
            <span style={{ fontFamily: "'Lora', Georgia, serif", fontSize: 20, fontWeight: 600, color: "var(--text-primary)", letterSpacing: "-0.01em", display: "flex", alignItems: "center", gap: 7 }}>
              <span style={{ fontSize: 17 }}>📚</span>
              The Archive
            </span>
            <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: "var(--text-faint)", fontWeight: 300 }}>
              notion library
            </span>
          </div>
        </Link>
      </div>

      {/* ── Crosshair (T-18) ─────────────────────────────────────────────── */}
      {fpLocked && !inOverhead && (
        <div style={{
          position:      "absolute",
          top:           "50%",
          left:          "50%",
          transform:     "translate(-50%, -50%)",
          width:         14,
          height:        14,
          pointerEvents: "none",
        }}>
          <div style={{
            position:  "absolute",
            top:       "50%",
            left:      0,
            right:     0,
            height:    1,
            background:"rgba(255,255,255,0.75)",
            transform: "translateY(-50%)",
          }} />
          <div style={{
            position:  "absolute",
            left:      "50%",
            top:       0,
            bottom:    0,
            width:     1,
            background:"rgba(255,255,255,0.75)",
            transform: "translateX(-50%)",
          }} />
        </div>
      )}

      {/* ── Entry hint / mobile fallback (T-51) ─────────────────────────── */}
      {!fpLocked && !inOverhead && (
        <div style={{ ...HINT, bottom: 36, left: "50%", transform: "translateX(-50%)", whiteSpace: "nowrap" }}>
          {noPointerLock ? "Click books to explore" : "Click to explore"}
        </div>
      )}

      {/* ── Overhead return hint ─────────────────────────────────────────── */}
      {inOverhead && (
        <div style={{ ...HINT, bottom: 36, left: "50%", transform: "translateX(-50%)" }}>
          TAB — return to first-person
        </div>
      )}

      {/* ── FP controls legend ───────────────────────────────────────────── */}
      {fpLocked && !inOverhead && (
        <div style={{ ...HINT, bottom: 18, left: 18, color: "rgba(255,213,158,0.35)" }}>
          WASD · SHIFT sprint · TAB overhead · ESC exit
        </div>
      )}

      {/* ── Directory kiosk (T-34 to T-37) ──────────────────────────────── */}
      {!inOverhead && (
        <ArchiveDirectoryKiosk
          aisles={aisles}
          books={books}
          nearEntrance={nearEntrance && !fpLocked}
          onNavigateAisle={(aisle) =>
            bridge.current.navigateToAisle(aisle.originX, aisle.originZ - 3)
          }
          onNavigateBook={(id) => bridge.current.navigate(id)}
        />
      )}

      {/* ── Overhead map (T-38 to T-41) ──────────────────────────────────── */}
      {inOverhead && (
        <ArchiveOverheadMap
          aisles={aisles}
          cameraPos={cameraPos}
          onNavigate={(x, z) => bridge.current.navigateTo(x, z)}
        />
      )}

      {/* ── Book detail panel (T-29 / T-30 / T-31 / T-32) ───────────────── */}
      <ArchiveBookPanel
        book={selectedBook}
        graph={graph}
        onClose={() => bridge.current.deselect()}
        onNavigate={(id) => bridge.current.navigate(id)}
      />
    </div>
  );
}
