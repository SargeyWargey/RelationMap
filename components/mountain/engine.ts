import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

import {
  detailNoise,
  heightAt,
  NOISE_SIZE,
  normalAt,
  peakAtPoint,
  rangeAtPoint,
  raycastTerrain,
  SNOW_LINE,
  toMeters,
  TREE_LINE,
  type World,
} from "@/lib/mountainWorld";
import { createHiker, HIKER_HEIGHT, type Hiker } from "./hiker";
import { computeSky, createSkyState } from "./daycycle";
import {
  ARC_FRAG, ARC_VERT, BEAM_FRAG, BEAM_VERT, BLOB_FRAG, BLOB_VERT, DOT_FRAG, DOT_VERT,
  PROP_FRAG, PROP_VERT, SKY_FRAG, SKY_VERT, TERRAIN_FRAG, TERRAIN_VERT, WATER_FRAG, WATER_VERT,
} from "./shaders";

// ─── Public types ─────────────────────────────────────────────────────────────

export type MountainMode = "map" | "hike";

export type MountainPose = {
  mode: MountainMode;
  /** Hiker position + facing. */
  hx: number; hz: number; hyaw: number;
  /** Camera ground position + heading. */
  cx: number; cz: number; cyaw: number;
  /** Rough visible radius on the ground (map mode). */
  viewR: number;
};

export type MountainApi = {
  setMode: (mode: MountainMode) => void;
  /** Map: fly the camera to a summit. Hike: it becomes the waypoint. */
  focusPeak: (peak: number) => void;
  focusRange: (range: number) => void;
  /** Minimap click: map flies there, hike fast-travels the hiker. */
  travelTo: (x: number, z: number) => void;
  /** Start hiking near a summit (or the current view). */
  hikeFrom: (peak: number | null) => void;
  fitAll: () => void;
  getPose: () => MountainPose;
  /** Set the time of day (0 = midnight, 0.5 = noon). Animated moves always run forward through dawn/dusk. */
  setTime: (tod: number, animate?: boolean) => void;
  getTime: () => number;
};

export type EngineCallbacks = {
  onSelect: (peak: number | null) => void;
  onMode: (mode: MountainMode) => void;
  onLocation: (info: { range: number; altitude: number; swimming: boolean; gliding: boolean }) => void;
  onSummit: (peak: number) => void;
  /** Time of day changed (throttled to clock minutes). */
  onTime: (tod: number) => void;
};

export type MountainEngine = {
  api: MountainApi;
  setWorld: (world: World) => void;
  setTheme: (dark: boolean) => void;
  /** Auto-advance time: one full day every `secondsPerDay`. */
  setCycle: (auto: boolean, secondsPerDay: number) => void;
  setSelection: (peak: number | null, related: number[]) => void;
  setVisited: (visited: Set<string>) => void;
  setInsets: (left: number, right: number) => void;
  setAccent: (hex: string) => void;
  dispose: () => void;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const CHUNK = 64;
const LOD_STEPS = [0.5, 1, 2, 4, 8, 16];
const LOD_DIST = [260, 560, 1100, 2100, 4100];
const LABEL_POOL = 34;
const HIKER_SCALE = 1.8;
const WALK = 13;
const SPRINT = 32;
const SWIM = 6;
const GLIDE = 28;
const GRAVITY = 30;
const JUMP_V = 12.5;
const SWIM_DEPTH = 1.7;

/** Ground materials (lighting and sky come from the day cycle). */
const MATERIALS = {
  grassA: "#56742f", grassB: "#8b9447", forestFloor: "#33472a", dirt: "#7f6a50", sand: "#cdb98f",
  rockA: "#958775", rockB: "#5a5047", snow: "#f4f7fa",
};

const MONTH = 30 * 86_400_000;

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function displayName(name: string, id: string) {
  const n = name?.trim();
  if (!n || /^[0-9a-f]{32}$/i.test(n) || n.replace(/-/g, "") === id.replace(/-/g, "")) return "Untitled";
  return n;
}

// ─── Noise texture (shared with the CPU height sampler) ───────────────────────

function makeNoiseTexture(): THREE.DataTexture {
  const t = new THREE.DataTexture(detailNoise(), NOISE_SIZE, NOISE_SIZE, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

// ─── Geometry templates ───────────────────────────────────────────────────────

/** Chunk grid in [0,1]² with skirts (y = 1 marks a skirt vertex). */
function terrainTemplate(R: number): THREE.InstancedBufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j <= R; j++) for (let i = 0; i <= R; i++) pos.push(i / R, 0, j / R);
  const at = (i: number, j: number) => j * (R + 1) + i;
  for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) {
    const a = at(i, j), b = at(i + 1, j), c = at(i, j + 1), d = at(i + 1, j + 1);
    idx.push(a, c, b, b, c, d);
  }
  // Skirts hide cracks between neighbouring LODs
  const edge: Array<[number, number]> = [];
  for (let i = 0; i <= R; i++) edge.push([i, 0]);
  for (let j = 1; j <= R; j++) edge.push([R, j]);
  for (let i = R - 1; i >= 0; i--) edge.push([i, R]);
  for (let j = R - 1; j >= 1; j--) edge.push([0, j]);
  const base = pos.length / 3;
  for (const [i, j] of edge) pos.push(i / R, 1, j / R);
  for (let k = 0; k < edge.length; k++) {
    const k2 = (k + 1) % edge.length;
    const t0 = at(edge[k][0], edge[k][1]), t1 = at(edge[k2][0], edge[k2][1]);
    const s0 = base + k, s1 = base + k2;
    idx.push(t0, s0, t1, t1, s0, s1);
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

function withColor(g: THREE.BufferGeometry, color: THREE.Color, topH = 0): THREE.BufferGeometry {
  const n = g.getAttribute("position").count;
  const col = new Float32Array(n * 3), top = new Float32Array(n);
  const p = g.getAttribute("position");
  for (let i = 0; i < n; i++) {
    col[i * 3] = color.r; col[i * 3 + 1] = color.g; col[i * 3 + 2] = color.b;
    top[i] = topH > 0 ? Math.max(0, p.getY(i)) / topH : 0;
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.setAttribute("aTop", new THREE.BufferAttribute(top, 1));
  return g;
}

function mergeGeometries(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  const names = ["position", "normal", "color", "aTop"];
  const arrays: Record<string, number[]> = { position: [], normal: [], color: [], aTop: [] };
  const index: number[] = [];
  let offset = 0;
  for (const g0 of parts) {
    const g = g0.index ? g0.toNonIndexed() : g0;
    for (const n of names) {
      const a = g.getAttribute(n);
      arrays[n].push(...(a.array as Float32Array));
    }
    const count = g.getAttribute("position").count;
    for (let i = 0; i < count; i++) index.push(offset + i);
    offset += count;
  }
  out.setAttribute("position", new THREE.Float32BufferAttribute(arrays.position, 3));
  out.setAttribute("normal", new THREE.Float32BufferAttribute(arrays.normal, 3));
  out.setAttribute("color", new THREE.Float32BufferAttribute(arrays.color, 3));
  out.setAttribute("aTop", new THREE.Float32BufferAttribute(arrays.aTop, 1));
  out.setIndex(index);
  return out;
}

function pineGeometry(): THREE.BufferGeometry {
  const trunk = withColor(new THREE.CylinderGeometry(0.16, 0.26, 2.2, 6).translate(0, 1.1, 0), new THREE.Color("#5b4331"), 7);
  const c1 = withColor(new THREE.ConeGeometry(1.75, 3.4, 7).translate(0, 3.0, 0), new THREE.Color("#2e5a33"), 7);
  const c2 = withColor(new THREE.ConeGeometry(1.35, 2.9, 7).translate(0, 4.4, 0), new THREE.Color("#356a3a"), 7);
  const c3 = withColor(new THREE.ConeGeometry(0.9, 2.3, 7).translate(0, 5.7, 0), new THREE.Color("#3f7a42"), 7);
  return mergeGeometries([trunk, c1, c2, c3]);
}

function flagGeometry(): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(2.4, 1.4, 12, 2).translate(1.2, 0, 0);
  return withColor(g, new THREE.Color("#ffffff"));
}

function poleGeometry(): THREE.BufferGeometry {
  return withColor(new THREE.CylinderGeometry(0.07, 0.09, 5, 6).translate(0, 2.5, 0), new THREE.Color("#3a3d42"));
}

function cairnGeometry(): THREE.BufferGeometry {
  const s = (r: number, y: number, rx: number) => withColor(new THREE.DodecahedronGeometry(r, 0).rotateY(rx).translate(0, y, 0), new THREE.Color("#8d867c"));
  return mergeGeometries([s(0.9, 0.5, 0), s(0.65, 1.25, 1.2), s(0.42, 1.8, 2.3)]);
}

// ─── Engine ───────────────────────────────────────────────────────────────────

export function createMountainEngine(mount: HTMLDivElement, cbRef: { current: EngineCallbacks }): MountainEngine {
  const dpr = Math.min(window.devicePixelRatio, 2);
  let W = Math.max(1, mount.clientWidth), H = Math.max(1, mount.clientHeight);

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(dpr);
  renderer.setSize(W, H);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.domElement.style.display = "block";
  renderer.domElement.style.touchAction = "none";
  renderer.domElement.style.cursor = "grab";
  mount.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, W / H, 0.3, 16000);
  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(dpr);
  composer.setSize(W, H);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(W, H), 0.7, 0.55, 0.78);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const disposables: Array<{ dispose: () => void }> = [];
  const track = <T extends { dispose: () => void }>(x: T) => { disposables.push(x); return x; };

  const sky = createSkyState();
  let nightK = 1;
  let fogBase = 0.0002;
  const accent = new THREE.Color(getComputedStyle(document.documentElement).getPropertyValue("--accent-warm").trim() || "#d97757");
  const noiseTex = track(makeNoiseTexture());

  // Shared uniforms
  const L = {
    uSunDir: { value: new THREE.Vector3(-0.5, 0.5, -0.4).normalize() },
    uSunColor: { value: new THREE.Color() },
    uSkyAmb: { value: new THREE.Color() },
    uGroundAmb: { value: new THREE.Color() },
    uFogColor: { value: new THREE.Color() },
    uFogSun: { value: new THREE.Color() },
    uFogDensity: { value: 0.0002 },
    uCamPos: { value: new THREE.Vector3() },
    uTime: { value: 0 },
    uNight: { value: 1 },
    uLampPos: { value: new THREE.Vector3() },
    uLamp: { value: 0 },
    uSunPos: { value: new THREE.Vector3(0, 1, 0) },
    uMoonPos: { value: new THREE.Vector3(0, -1, 0) },
    uSunDisc: { value: new THREE.Color() },
  };
  const T = {
    uHeight: { value: null as THREE.Texture | null },
    uNS: { value: null as THREE.Texture | null },
    uAO: { value: null as THREE.Texture | null },
    uTint: { value: null as THREE.Texture | null },
    uNoise: { value: noiseTex },
    uHorA: { value: null as THREE.Texture | null },
    uHorB: { value: null as THREE.Texture | null },
    uN: { value: 2 },
    uCell: { value: 1 },
    uMin: { value: new THREE.Vector2() },
    uSize: { value: 1 },
  };
  const P = {
    uGrassA: { value: new THREE.Color() }, uGrassB: { value: new THREE.Color() }, uForestFloor: { value: new THREE.Color() },
    uDirt: { value: new THREE.Color() }, uSand: { value: new THREE.Color() }, uRockA: { value: new THREE.Color() },
    uRockB: { value: new THREE.Color() }, uSnow: { value: new THREE.Color() },
    uShallow: { value: new THREE.Color() }, uDeep: { value: new THREE.Color() },
    uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uCloudColor: { value: new THREE.Color() },
    uCloudShadow: { value: 0.3 }, uWind: { value: new THREE.Vector2(0.0011, 0.0006) },
  };

  // ── Sky ──
  const skyMat = track(new THREE.ShaderMaterial({
    vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false,
    uniforms: { ...L, ...P, uNoise: T.uNoise },
  }));
  const skyDome = new THREE.Mesh(track(new THREE.SphereGeometry(10000, 48, 24)), skyMat);
  skyDome.frustumCulled = false;
  skyDome.renderOrder = -10;
  scene.add(skyDome);

  // ── Terrain (chunked, LOD, instanced templates) ──
  const terrainMat = track(new THREE.ShaderMaterial({
    vertexShader: TERRAIN_VERT, fragmentShader: TERRAIN_FRAG, side: THREE.DoubleSide,
    uniforms: { ...L, ...T, ...P, uChunkCells: { value: CHUNK }, uSkirt: { value: 25 }, uSnowLine: { value: SNOW_LINE }, uTreeLine: { value: TREE_LINE } },
  }));
  const lodMeshes = LOD_STEPS.map((step) => {
    const g = track(terrainTemplate(CHUNK / step));
    const attr = new THREE.InstancedBufferAttribute(new Float32Array(2 * 1024), 2);
    attr.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute("aChunk", attr);
    g.instanceCount = 0;
    const m = new THREE.Mesh(g, terrainMat);
    m.frustumCulled = false;
    scene.add(m);
    return { mesh: m, attr, geo: g };
  });

  // ── Water ──
  const waterMat = track(new THREE.ShaderMaterial({
    vertexShader: WATER_VERT, fragmentShader: WATER_FRAG, transparent: true, depthWrite: false,
    uniforms: { ...L, ...T, ...P },
  }));
  const water = new THREE.Mesh(track(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)), waterMat);
  water.renderOrder = 2;
  water.frustumCulled = false;
  scene.add(water);

  // ── Props ──
  const propMat = (opts: { wave?: boolean; sway?: number; emissive?: number } = {}) => track(new THREE.ShaderMaterial({
    vertexShader: PROP_VERT, fragmentShader: PROP_FRAG, vertexColors: true, side: THREE.DoubleSide,
    uniforms: { ...L, uHorA: T.uHorA, uHorB: T.uHorB, uMin: T.uMin, uSize: T.uSize, uWave: { value: opts.wave ? 1 : 0 }, uSway: { value: opts.sway ?? 0 }, uEmissive: { value: opts.emissive ?? 0 } },
  }));
  const treeGeo = track(pineGeometry());
  const treeMat = propMat({ sway: 0.35 });
  const flagMat = propMat({ wave: true, emissive: 0.15 });
  const poleMat = propMat();
  const cairnMat = propMat();
  const flagGeo = track(flagGeometry()), poleGeo = track(poleGeometry()), cairnGeo = track(cairnGeometry());
  let treeTiles: THREE.InstancedMesh[] = [];
  let flags: THREE.InstancedMesh | null = null, poles: THREE.InstancedMesh | null = null, cairns: THREE.InstancedMesh | null = null;

  // ── Summit dots (map view) ──
  const dotMat = track(new THREE.ShaderMaterial({
    vertexShader: DOT_VERT, fragmentShader: DOT_FRAG, transparent: true, depthWrite: false,
    uniforms: { uPxScale: { value: 1 }, uSel: { value: -1 }, uHover: { value: -1 }, uFadeNear: { value: 140 }, uNight: L.uNight },
  }));
  let dots: THREE.Points | null = null;

  // ── Beams ──
  const beamGeo = track(new THREE.CylinderGeometry(1, 1, 1, 20, 1, true).translate(0, 0.5, 0));
  const beamMat = track(new THREE.ShaderMaterial({
    vertexShader: BEAM_VERT, fragmentShader: BEAM_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uTime: L.uTime, uIntensity: { value: 0.4 } },
  }));
  const selBeamMat = track(new THREE.ShaderMaterial({
    vertexShader: BEAM_VERT, fragmentShader: BEAM_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uTime: L.uTime, uIntensity: { value: 1.2 } },
  }));
  let landmarkBeams: THREE.InstancedMesh | null = null;
  const selBeam = new THREE.InstancedMesh(beamGeo, selBeamMat, 1);
  selBeam.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array([accent.r, accent.g, accent.b]), 3);
  selBeam.visible = false;
  selBeam.frustumCulled = false;
  selBeam.renderOrder = 6;
  scene.add(selBeam);

  // ── Relation arcs ──
  const arcMat = track(new THREE.ShaderMaterial({
    vertexShader: ARC_VERT, fragmentShader: ARC_FRAG, transparent: true, depthWrite: false,
    uniforms: { uColor: { value: accent.clone() }, uTime: L.uTime },
  }));
  let arcGeo = new THREE.BufferGeometry();
  const arcs = new THREE.LineSegments(arcGeo, arcMat);
  arcs.frustumCulled = false;
  arcs.renderOrder = 5;
  scene.add(arcs);

  // ── Hiker ──
  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
  const sunLight = new THREE.DirectionalLight(0xffffff, 1);
  const lamp = new THREE.PointLight(0xffc98a, 0, 30, 1.6);
  scene.add(hemi, sunLight, sunLight.target, lamp);
  const hiker: Hiker = createHiker("#d9643a");
  hiker.group.scale.setScalar(HIKER_SCALE);
  scene.add(hiker.group);
  const blobMat = track(new THREE.ShaderMaterial({ vertexShader: BLOB_VERT, fragmentShader: BLOB_FRAG, transparent: true, depthWrite: false, uniforms: { uOpacity: { value: 0.45 } } }));
  const blob = new THREE.Mesh(track(new THREE.PlaneGeometry(2.8, 2.8).rotateX(-Math.PI / 2)), blobMat);
  blob.renderOrder = 1;
  scene.add(blob);

  // ── DOM overlay ──
  const overlay = document.createElement("div");
  overlay.style.cssText = "position:absolute;inset:0;pointer-events:none;overflow:hidden;";
  mount.appendChild(overlay);
  type Label = { el: HTMLDivElement; key: string; used: boolean };
  const labels: Label[] = [];
  for (let i = 0; i < LABEL_POOL; i++) {
    const el = document.createElement("div");
    el.style.cssText = "position:absolute;left:0;top:0;white-space:nowrap;opacity:0;transition:opacity 0.25s ease;will-change:transform,opacity;";
    overlay.appendChild(el);
    labels.push({ el, key: "", used: false });
  }
  const tooltip = document.createElement("div");
  tooltip.style.cssText = "position:absolute;left:0;top:0;padding:8px 11px;border-radius:9px;background:rgba(10,12,20,0.82);backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,0.12);box-shadow:0 10px 28px rgba(0,0,0,0.4);opacity:0;transition:opacity 0.12s;max-width:300px;";
  overlay.appendChild(tooltip);
  const compass = document.createElement("div");
  compass.style.cssText = "position:absolute;top:22px;left:50%;width:440px;height:30px;margin-left:-220px;overflow:hidden;border-radius:999px;background:rgba(8,10,18,0.5);backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,0.12);-webkit-mask-image:linear-gradient(to right,transparent,#000 14%,#000 86%,transparent);mask-image:linear-gradient(to right,transparent,#000 14%,#000 86%,transparent);";
  overlay.appendChild(compass);
  const compassInner = document.createElement("div");
  compassInner.style.cssText = "position:absolute;inset:0;";
  compass.appendChild(compassInner);
  const compassCenter = document.createElement("div");
  compassCenter.style.cssText = "position:absolute;left:50%;top:0;bottom:0;width:2px;margin-left:-1px;background:var(--accent-warm);opacity:0.9;";
  compass.appendChild(compassCenter);

  // ── State ──
  let world: World | null = null;
  let mode: MountainMode = "map";
  let selected = -1;
  let related: number[] = [];
  let hover = -1;
  let visited = new Set<string>();
  let leftInset = 0, rightInset = 0;
  const reachedThisSession = new Set<number>();
  let chunkBoxes: Array<{ box: THREE.Box3; cx: number; cz: number; cy: number; i0: number; j0: number }> = [];

  // Map camera
  const map = { tx: 0, ty: 0, tz: 0, yaw: 0.7, pitch: 0.8, dist: 2000 };
  const mapGoal = { ...map };
  let flight: { from: typeof map; to: typeof map; t0: number; dur: number; hop: number } | null = null;

  // Hiker
  const hk = { x: 0, y: 0, z: 0, vx: 0, vz: 0, vy: 0, yaw: 0, grounded: true, gliding: false, autoGlide: false, swimming: false, placed: false };
  const hcam = { yaw: 0, pitch: 0.2, dist: 13, x: 0, y: 0, z: 0 };
  let transition: { t0: number; dur: number; from: THREE.Vector3; fromLook: THREE.Vector3 } | null = null;
  const keys = new Set<string>();

  // ── World setup ──
  function setWorld(w: World) {
    world = w;
    // Peak indices from the previous world are meaningless now
    hover = -1;
    dotMat.uniforms.uHover.value = -1;
    occlusion = new Map();
    reachedThisSession.clear();
    if (selected >= w.peaks.length) selected = -1;
    related = related.filter((r) => r < w.peaks.length);
    const N = w.N;
    T.uN.value = N;
    T.uCell.value = w.cell;
    T.uMin.value.set(w.minX, w.minZ);
    T.uSize.value = w.size;
    for (const [key, offset] of [["uHorA", 0], ["uHorB", w.horizonN * w.horizonN * 4]] as const) {
      T[key].value?.dispose();
      const ht2 = new THREE.DataTexture(w.horizon.subarray(offset, offset + w.horizonN * w.horizonN * 4), w.horizonN, w.horizonN, THREE.RGBAFormat);
      ht2.magFilter = ht2.minFilter = THREE.LinearFilter;
      ht2.needsUpdate = true;
      T[key].value = ht2;
    }

    T.uHeight.value?.dispose();
    const ht = new THREE.DataTexture(w.heights, N, N, THREE.RedFormat, THREE.FloatType);
    ht.minFilter = ht.magFilter = THREE.NearestFilter;
    ht.needsUpdate = true;
    T.uHeight.value = ht;

    T.uNS.value?.dispose();
    const ns = new THREE.DataTexture(w.normalShadow, N, N, THREE.RGBAFormat);
    ns.magFilter = THREE.LinearFilter;
    ns.minFilter = THREE.LinearMipmapLinearFilter;
    ns.generateMipmaps = true;
    ns.anisotropy = 8;
    ns.needsUpdate = true;
    T.uNS.value = ns;

    T.uAO.value?.dispose();
    const aoData = new Uint8Array(N * N * 4);
    const tintData = new Uint8Array(N * N * 4);
    const rc = w.ranges.map((r) => new THREE.Color(r.color));
    for (let k = 0; k < N * N; k++) {
      aoData[k * 4] = w.ao[k * 4];
      aoData[k * 4 + 1] = w.ao[k * 4 + 3];
      aoData[k * 4 + 3] = 255;
      const ri = w.ao[k * 4 + 1] - 1;
      if (ri >= 0) {
        const c = rc[ri];
        tintData[k * 4] = Math.round(c.r * 255); tintData[k * 4 + 1] = Math.round(c.g * 255); tintData[k * 4 + 2] = Math.round(c.b * 255);
        tintData[k * 4 + 3] = w.ao[k * 4 + 2];
      }
    }
    const aoTex = new THREE.DataTexture(aoData, N, N, THREE.RGBAFormat);
    aoTex.magFilter = THREE.LinearFilter; aoTex.minFilter = THREE.LinearMipmapLinearFilter; aoTex.generateMipmaps = true; aoTex.needsUpdate = true;
    T.uAO.value = aoTex;
    T.uTint.value?.dispose();
    const tintTex = new THREE.DataTexture(tintData, N, N, THREE.RGBAFormat);
    tintTex.magFilter = THREE.LinearFilter; tintTex.minFilter = THREE.LinearMipmapLinearFilter; tintTex.generateMipmaps = true; tintTex.needsUpdate = true;
    T.uTint.value = tintTex;

    // Chunk bounds
    chunkBoxes = [];
    const chunks = Math.floor((N - 1) / CHUNK);
    for (let cj = 0; cj < chunks; cj++) for (let ci = 0; ci < chunks; ci++) {
      let lo = Infinity, hi = -Infinity;
      for (let j = cj * CHUNK; j <= (cj + 1) * CHUNK; j += 4) for (let i = ci * CHUNK; i <= (ci + 1) * CHUNK; i += 4) {
        const h = w.heights[j * N + i];
        lo = Math.min(lo, h); hi = Math.max(hi, h);
      }
      const x0 = w.minX + ci * CHUNK * w.cell, z0 = w.minZ + cj * CHUNK * w.cell, s = CHUNK * w.cell;
      chunkBoxes.push({
        box: new THREE.Box3(new THREE.Vector3(x0, lo - 30, z0), new THREE.Vector3(x0 + s, hi + 6, z0 + s)),
        cx: x0 + s / 2, cz: z0 + s / 2, cy: (lo + hi) / 2, i0: ci * CHUNK, j0: cj * CHUNK,
      });
    }

    // Water plane: the island plus open sea to the horizon
    water.scale.set(w.size * 6, 1, w.size * 6);
    water.position.set(w.minX + w.size / 2, 0, w.minZ + w.size / 2);

    buildProps(w);
    buildDots(w);
    buildLandmarks(w);
    applySelection();

    if (!hk.placed) {
      const s = w.peaks[w.ranges[0]?.summit ?? 0];
      if (s) spawnNear(s.index, null);
    } else {
      hk.y = Math.max(heightAt(w, hk.x, hk.z), -SWIM_DEPTH);
    }
    if (!introDone) intro();
  }

  function buildProps(w: World) {
    for (const t of treeTiles) { scene.remove(t); t.dispose(); }
    treeTiles = [];
    const tiles = 8;
    const ts = w.size / tiles;
    const buckets: number[][] = Array.from({ length: tiles * tiles }, () => []);
    const n = w.trees.length / 5;
    for (let k = 0; k < n; k++) {
      const ti = Math.min(tiles - 1, Math.max(0, Math.floor((w.trees[k * 5] - w.minX) / ts)));
      const tj = Math.min(tiles - 1, Math.max(0, Math.floor((w.trees[k * 5 + 2] - w.minZ) / ts)));
      buckets[tj * tiles + ti].push(k);
    }
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3(), c = new THREE.Color();
    const up = new THREE.Vector3(0, 1, 0);
    for (const b of buckets) {
      if (b.length === 0) continue;
      const mesh = new THREE.InstancedMesh(treeGeo, treeMat, b.length);
      b.forEach((k, i) => {
        const s = w.trees[k * 5 + 3], tint = w.trees[k * 5 + 4];
        q.setFromAxisAngle(up, tint * 40);
        ps.set(w.trees[k * 5], heightAt(w, w.trees[k * 5], w.trees[k * 5 + 2]) - 0.4, w.trees[k * 5 + 2]);
        sc.set(s * 1.45, s * 1.45 * (0.9 + tint * 0.35), s * 1.45);
        mesh.setMatrixAt(i, m4.compose(ps, q, sc));
        c.setHSL(0.27 + tint * 0.08, 0.35 + tint * 0.2, 0.42 + tint * 0.18);
        mesh.setColorAt(i, c.multiplyScalar(2.1));
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      scene.add(mesh);
      treeTiles.push(mesh);
    }

    for (const m of [flags, poles, cairns]) if (m) { scene.remove(m); m.dispose(); }
    const count = w.peaks.length;
    flags = new THREE.InstancedMesh(flagGeo, flagMat, count);
    poles = new THREE.InstancedMesh(poleGeo, poleMat, count);
    cairns = new THREE.InstancedMesh(cairnGeo, cairnMat, count);
    w.peaks.forEach((p, i) => {
      const s = 0.9 + Math.min(1.4, p.height / 140);
      q.setFromAxisAngle(up, -Math.atan2(w.sun[2], w.sun[0]) + Math.sin(i) * 0.5);
      const gy = heightAt(w, p.sx, p.sz);
      ps.set(p.sx, gy - 0.2, p.sz);
      sc.setScalar(s * 1.4);
      poles!.setMatrixAt(i, m4.compose(ps, q, sc));
      cairns!.setMatrixAt(i, m4.compose(ps, q, sc));
      ps.set(p.sx, gy - 0.2 + 4.2 * s * 1.4, p.sz);
      flags!.setMatrixAt(i, m4.compose(ps, q, sc));
      c.set(w.ranges[p.range].color);
      flags!.setColorAt(i, c);
    });
    for (const m of [flags, poles, cairns]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      m.computeBoundingSphere();
      scene.add(m);
    }
  }

  function buildDots(w: World) {
    if (dots) { scene.remove(dots); dots.geometry.dispose(); }
    const n = w.peaks.length;
    const pos = new Float32Array(n * 3), size = new Float32Array(n), col = new Float32Array(n * 3), id = new Float32Array(n);
    const c = new THREE.Color();
    w.peaks.forEach((p, i) => {
      pos[i * 3] = p.sx; pos[i * 3 + 1] = p.sy + 6; pos[i * 3 + 2] = p.sz;
      size[i] = p.height;
      c.set(w.ranges[p.range].color);
      const hsl = { h: 0, s: 0, l: 0 };
      c.getHSL(hsl);
      c.setHSL(hsl.h, Math.min(1, hsl.s * 1.1), Math.min(0.75, hsl.l + 0.12));
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      id[i] = i;
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    g.setAttribute("aColor", new THREE.BufferAttribute(col, 3));
    g.setAttribute("aPeak", new THREE.BufferAttribute(id, 1));
    dots = new THREE.Points(g, dotMat);
    dots.frustumCulled = false;
    dots.renderOrder = 7;
    scene.add(dots);
  }

  function buildLandmarks(w: World) {
    if (landmarkBeams) { scene.remove(landmarkBeams); landmarkBeams.dispose(); }
    const tops = w.ranges.map((r) => w.peaks[r.summit]).filter(Boolean);
    landmarkBeams = new THREE.InstancedMesh(beamGeo, beamMat, Math.max(1, tops.length));
    const m4 = new THREE.Matrix4(), c = new THREE.Color();
    tops.forEach((p, i) => {
      m4.makeScale(1.4, 900, 1.4).setPosition(p.sx, p.sy + 8, p.sz);
      landmarkBeams!.setMatrixAt(i, m4);
      landmarkBeams!.setColorAt(i, c.set(w.ranges[p.range].color));
    });
    landmarkBeams.count = tops.length;
    landmarkBeams.instanceMatrix.needsUpdate = true;
    if (landmarkBeams.instanceColor) landmarkBeams.instanceColor.needsUpdate = true;
    landmarkBeams.frustumCulled = false;
    landmarkBeams.renderOrder = 6;
    scene.add(landmarkBeams);
  }

  function applySelection() {
    dotMat.uniforms.uSel.value = selected;
    arcGeo.dispose();
    arcGeo = new THREE.BufferGeometry();
    if (world && selected >= 0) {
      const w = world;
      const a = w.peaks[selected];
      selBeam.visible = true;
      selBeam.setMatrixAt(0, new THREE.Matrix4().makeScale(2.2, 1400, 2.2).setPosition(a.sx, a.sy + 6, a.sz));
      selBeam.instanceMatrix.needsUpdate = true;
      const SEG = 40;
      const pos: number[] = [], us: number[] = [];
      const nearest = [...related].sort((x, y) => Math.hypot(w.peaks[x].sx - a.sx, w.peaks[x].sz - a.sz) - Math.hypot(w.peaks[y].sx - a.sx, w.peaks[y].sz - a.sz)).slice(0, 40);
      for (const r of nearest) {
        const b = w.peaks[r];
        const d = Math.hypot(b.sx - a.sx, b.sz - a.sz);
        const lift = 30 + d * 0.22;
        let px = a.sx, py = a.sy + 10, pz = a.sz;
        for (let s = 1; s <= SEG; s++) {
          const t = s / SEG;
          const x = a.sx + (b.sx - a.sx) * t, z = a.sz + (b.sz - a.sz) * t;
          const y = (a.sy + 10) * (1 - t) + (b.sy + 10) * t + Math.sin(Math.PI * t) * lift;
          pos.push(px, py, pz, x, y, z);
          us.push((s - 1) / SEG, t);
          px = x; py = y; pz = z;
        }
      }
      arcGeo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      arcGeo.setAttribute("aU", new THREE.Float32BufferAttribute(us, 1));
    } else {
      selBeam.visible = false;
    }
    arcs.geometry = arcGeo;
  }

  function applyMaterials() {
    for (const k of Object.keys(MATERIALS) as Array<keyof typeof MATERIALS>) {
      const u = (P as unknown as Record<string, { value: THREE.Color }>)[`u${k[0].toUpperCase()}${k.slice(1)}`];
      u.value.set(MATERIALS[k]);
    }
  }

  // ── Time of day ──
  let tod = 0.54;
  let cycleAuto = false;
  let secondsPerDay = 180;
  let todAnim: { from: number; to: number; t0: number; dur: number } | null = null;
  let themeInit = false;
  let lastTimeReport = -1, lastTimeReportAt = 0;

  function setTime(t: number, animate = false) {
    const target = ((t % 1) + 1) % 1;
    if (!animate) { tod = target; todAnim = null; applyTime(); return; }
    let to = target;
    if (to <= tod + 1e-4) to += 1;                 // always run forward: the sun sets, the moon rises
    todAnim = { from: tod, to, t0: performance.now(), dur: 2200 + (to - tod) * 5200 };
  }

  function applyTime() {
    computeSky(tod, sky);
    nightK = sky.night;
    L.uSunDir.value.copy(sky.lightDir);
    L.uSunColor.value.copy(sky.light);
    L.uSkyAmb.value.copy(sky.skyAmb);
    L.uGroundAmb.value.copy(sky.groundAmb);
    L.uFogColor.value.copy(sky.fog);
    L.uFogSun.value.copy(sky.fogSun);
    L.uNight.value = nightK;
    L.uSunPos.value.copy(sky.sunDir);
    L.uMoonPos.value.copy(sky.moonDir);
    L.uSunDisc.value.copy(sky.sunDisc);
    fogBase = sky.fogDensity;
    P.uZenith.value.copy(sky.zenith);
    P.uHorizon.value.copy(sky.horizon);
    P.uCloudColor.value.copy(sky.cloud);
    P.uShallow.value.copy(sky.shallow);
    P.uDeep.value.copy(sky.deep);
    P.uCloudShadow.value = 0.35 * sky.day;
    renderer.toneMappingExposure = sky.exposure;
    bloom.strength = 0.7 * nightK;
    bloom.enabled = nightK > 0.03;
    beamMat.uniforms.uIntensity.value = 0.16 + 0.39 * nightK;
    hemi.color.copy(sky.skyAmb).multiplyScalar(1.4 + 1.2 * nightK);
    hemi.groundColor.copy(sky.groundAmb).multiplyScalar(1 + nightK);
    sunLight.color.copy(sky.light).multiplyScalar(1 / Math.max(0.2, sky.light.r, sky.light.g, sky.light.b));
    sunLight.intensity = Math.max(sky.light.r, sky.light.g, sky.light.b) * 1.1 + 0.4 * nightK;
    lamp.intensity = 10 * nightK;
    L.uLamp.value = 0.6 * nightK;
    flagMat.uniforms.uEmissive.value = 0.12 + 0.33 * nightK;
  }

  // ── Camera helpers ──
  const tmpV = new THREE.Vector3(), lookV = new THREE.Vector3();
  function mapCameraPose(m: typeof map, out: THREE.Vector3) {
    out.set(
      m.tx + Math.sin(m.yaw) * Math.cos(m.pitch) * m.dist,
      m.ty + Math.sin(m.pitch) * m.dist,
      m.tz + Math.cos(m.yaw) * Math.cos(m.pitch) * m.dist,
    );
    return out;
  }
  function clampMap(m: typeof map) {
    if (!world) return;
    m.pitch = Math.min(1.5, Math.max(0.1, m.pitch));
    m.dist = Math.min(world.size * 1.3, Math.max(25, m.dist));
    m.tx = Math.min(world.minX + world.size, Math.max(world.minX, m.tx));
    m.tz = Math.min(world.minZ + world.size, Math.max(world.minZ, m.tz));
  }
  function easeInOut(t: number) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function flyMap(to: Partial<typeof map>, dur = 1800) {
    const target = { ...mapGoal, ...to };
    clampMap(target);
    let dyaw = target.yaw - map.yaw;
    while (dyaw > Math.PI) dyaw -= Math.PI * 2;
    while (dyaw < -Math.PI) dyaw += Math.PI * 2;
    target.yaw = map.yaw + dyaw;
    const travel = Math.hypot(target.tx - map.tx, target.tz - map.tz);
    flight = { from: { ...map }, to: target, t0: performance.now(), dur, hop: Math.max(0, travel * 0.55 - Math.max(map.dist, target.dist) * 0.5) };
    Object.assign(mapGoal, target);
  }

  let introDone = false;
  function intro() {
    if (!world) return;
    introDone = true;
    const w = world;
    const cx = w.minX + w.size / 2, cz = w.minZ + w.size / 2;
    Object.assign(map, { tx: cx, ty: 0, tz: cz, yaw: 0.9, pitch: 1.35, dist: w.size * 1.25 });
    Object.assign(mapGoal, map);
    const top = w.ranges[0] ? w.peaks[w.ranges[0].summit] : null;
    flyMap({ tx: top ? (top.sx + cx) / 2 : cx, ty: 0, tz: top ? (top.sz + cz) / 2 : cz, yaw: 0.55, pitch: 0.62, dist: w.size * 0.42 }, 4200);
  }

  function spawnNear(peak: number | null, from: THREE.Vector3 | null) {
    if (!world) return;
    const w = world;
    let x: number, z: number;
    if (peak !== null && w.peaks[peak]) {
      const p = w.peaks[peak];
      // Find a gentle, sunlit spot on the approach (below the snow), preferring the side facing the camera
      const fx = from ? from.x - p.sx : 1, fz = from ? from.z - p.sz : 0.3;
      const fa = Math.atan2(fz, fx);
      let best: [number, number, number] | null = null;
      for (let ring = 0.55; ring <= 2.4 && !best; ring += 0.15) {
        let bestScore = -Infinity;
        for (let k = 0; k < 24; k++) {
          const a = fa + ((k % 2 ? 1 : -1) * Math.ceil(k / 2) * Math.PI) / 12;
          const cx = p.sx + Math.cos(a) * p.radius * ring, cz = p.sz + Math.sin(a) * p.radius * ring;
          const h = heightAt(w, cx, cz);
          if (h < 1 || h > SNOW_LINE - 25) continue;
          const n = normalAt(w, cx, cz);
          if (n[1] < 0.86) continue;
          const gi = Math.round((cx - w.minX) / w.cell), gj = Math.round((cz - w.minZ) / w.cell);
          const sun = w.normalShadow[(gj * w.N + gi) * 4 + 3] / 255;
          const score = sun * 2 + n[1] - Math.abs(k) * 0.02;
          if (score > bestScore && sun > 0.4) { bestScore = score; best = [cx, cz, a]; }
        }
      }
      const pick = best ?? [p.sx + Math.cos(fa) * p.radius, p.sz + Math.sin(fa) * p.radius, fa];
      x = pick[0]; z = pick[1];
      const dx = p.sx - x, dz = p.sz - z;
      hk.yaw = Math.atan2(-dx, -dz);         // face the summit
    } else {
      x = map.tx; z = map.tz;
    }
    hk.x = x; hk.z = z;
    hk.y = Math.max(heightAt(w, x, z), -SWIM_DEPTH);
    hk.vx = hk.vz = hk.vy = 0;
    hk.grounded = true; hk.gliding = false;
    hk.placed = true;
    hcam.yaw = hk.yaw;                       // camera behind, looking the same way
  }

  function setMode(next: MountainMode) {
    if (!world || next === mode) return;
    const fromPos = camera.position.clone();
    const fromLook = new THREE.Vector3();
    camera.getWorldDirection(fromLook).multiplyScalar(50).add(fromPos);
    if (next === "hike") {
      if (!hk.placed) spawnNear(selected >= 0 ? selected : null, camera.position);
      // Face the hiker the way the map camera was looking
      hcam.yaw = map.yaw;
      hcam.pitch = 0.2;
      hcam.dist = 13;
      transition = { t0: performance.now(), dur: 1600, from: fromPos, fromLook };
    } else {
      Object.assign(map, { tx: hk.x, ty: hk.y, tz: hk.z, yaw: hcam.yaw, pitch: Math.max(0.35, hcam.pitch), dist: Math.max(30, hcam.dist) });
      Object.assign(mapGoal, map);
      flyMap({ dist: 520, pitch: 0.72 }, 1600);
    }
    mode = next;
    keys.clear();
    cbRef.current.onMode(mode);
  }

  // ── Input ──
  const canvas = renderer.domElement;
  let mouse: { x: number; y: number } | null = null;
  let mouseMoved = false;
  let drag: { x: number; y: number; sx: number; sy: number; button: number; moved: boolean } | null = null;

  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    drag = { x, y, sx: x, sy: y, button: e.button, moved: false };
    flight = null;
    canvas.style.cursor = "grabbing";
  });
  canvas.addEventListener("pointermove", (e) => {
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    mouse = { x, y };
    mouseMoved = true;
    if (!drag) return;
    const dx = x - drag.x, dy = y - drag.y;
    if (Math.hypot(x - drag.sx, y - drag.sy) > 4) drag.moved = true;
    drag.x = x; drag.y = y;
    if (mode === "hike") {
      hcam.yaw -= dx * 0.0055;
      hcam.pitch = Math.min(1.25, Math.max(-0.35, hcam.pitch + dy * 0.0045));
      return;
    }
    const pan = drag.button === 2 || e.shiftKey;
    if (pan) {
      // Grab-the-ground pan: right = (cos yaw, −sin yaw), forward = (−sin yaw, −cos yaw)
      const s = map.dist * 0.0016;
      map.tx += (-Math.cos(map.yaw) * dx - Math.sin(map.yaw) * dy) * s;
      map.tz += (Math.sin(map.yaw) * dx - Math.cos(map.yaw) * dy) * s;
    } else {
      map.yaw -= dx * 0.005;
      map.pitch = Math.min(1.5, Math.max(0.1, map.pitch + dy * 0.004));
    }
    clampMap(map);
    Object.assign(mapGoal, map);
  });
  const endDrag = (e: PointerEvent) => {
    if (!drag) return;
    const wasClick = !drag.moved;
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    drag = null;
    canvas.style.cursor = hover >= 0 ? "pointer" : "grab";
    if (wasClick && e.button === 0) {
      const p = pickPeak(x, y);
      cbRef.current.onSelect(p >= 0 ? p : null);
    }
  };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
  canvas.addEventListener("pointerleave", () => { mouse = null; });
  canvas.addEventListener("dblclick", (e) => {
    if (!world || mode !== "map") return;
    const r = canvas.getBoundingClientRect();
    const hit = rayFromScreen(e.clientX - r.left, e.clientY - r.top);
    if (!hit) return;
    // Drop in and start hiking right here
    hk.x = hit[0]; hk.z = hit[2]; hk.y = Math.max(heightAt(world, hit[0], hit[2]), -SWIM_DEPTH);
    hk.placed = true; hk.vx = hk.vz = hk.vy = 0;
    setMode("hike");
  });
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : 1;
    const dy = e.deltaY * unit;
    if (mode === "hike") {
      hcam.dist = Math.min(70, Math.max(6, hcam.dist * Math.exp(dy * 0.0015)));
      return;
    }
    flight = null;
    const f = Math.exp(dy * (e.ctrlKey ? 0.01 : 0.0016));
    // Zoom toward the point under the cursor
    const r = canvas.getBoundingClientRect();
    const hit = rayFromScreen(e.clientX - r.left, e.clientY - r.top);
    const nd = Math.min((world?.size ?? 4000) * 1.3, Math.max(25, map.dist * f));
    if (hit && f < 1) {
      const k = 1 - nd / map.dist;
      map.tx += (hit[0] - map.tx) * k;
      map.tz += (hit[2] - map.tz) * k;
      map.ty += (Math.max(0, hit[1]) - map.ty) * k;
    }
    map.dist = nd;
    clampMap(map);
    Object.assign(mapGoal, map);
  }, { passive: false });

  const onKeyDown = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable) return;
    if (mode !== "hike") return;
    if (["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space", "ShiftLeft", "ShiftRight"].includes(e.code)) {
      e.preventDefault();
      if (e.code === "Space" && !keys.has("Space")) jumpRequested = true;
      keys.add(e.code);
    }
  };
  const onKeyUp = (e: KeyboardEvent) => { keys.delete(e.code); };
  const onBlur = () => keys.clear();
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);
  let jumpRequested = false;

  // ── Picking ──
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  function rayFromScreen(x: number, y: number): [number, number, number] | null {
    if (!world) return null;
    ndc.set((x / W) * 2 - 1, -(y / H) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const o = raycaster.ray.origin, d = raycaster.ray.direction;
    return raycastTerrain(world, o.x, o.y, o.z, d.x, d.y, d.z, 14000);
  }
  const sp = { x: 0, y: 0, w: 0 };
  const pm = new THREE.Matrix4();
  let pe = pm.elements;
  function prepProj() {
    pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    pe = pm.elements;
  }
  function proj(x: number, y: number, z: number) {
    const w = pe[3] * x + pe[7] * y + pe[11] * z + pe[15];
    sp.w = w;
    if (w < 0.1) return false;
    sp.x = ((pe[0] * x + pe[4] * y + pe[8] * z + pe[12]) / w * 0.5 + 0.5) * W;
    sp.y = (0.5 - (pe[1] * x + pe[5] * y + pe[9] * z + pe[13]) / w * 0.5) * H;
    return sp.x > -50 && sp.x < W + 50 && sp.y > -50 && sp.y < H + 50;
  }
  function pickPeak(x: number, y: number): number {
    if (!world) return -1;
    // 1. A summit marker / dot near the cursor
    let best = -1, bestD = 16;
    for (const p of world.peaks) {
      if (!proj(p.sx, p.sy + 4, p.sz)) continue;
      const d = Math.hypot(sp.x - x, sp.y - y);
      if (d < bestD && (mode === "map" || sp.w < 900)) { bestD = d; best = p.index; }
    }
    if (best >= 0) return best;
    // 2. Whichever mountain the terrain under the cursor belongs to
    const hit = rayFromScreen(x, y);
    return hit ? peakAtPoint(world, hit[0], hit[2]) : -1;
  }

  // ── API ──
  const api: MountainApi = {
    setMode,
    focusPeak(i) {
      if (!world || !world.peaks[i]) return;
      if (mode === "hike") return; // waypoint only — the compass and beam lead the way
      const p = world.peaks[i];
      flyMap({ tx: p.sx, ty: p.sy * 0.6, tz: p.sz, dist: Math.max(160, p.radius * 4.2), pitch: 0.48 });
    },
    focusRange(ri) {
      if (!world || !world.ranges[ri]) return;
      const r = world.ranges[ri];
      const top = world.peaks[r.summit];
      if (mode === "hike") setMode("map");
      flyMap({ tx: r.cx, ty: (top?.sy ?? 0) * 0.3, tz: r.cz, dist: Math.max(420, r.radius * 2.3), pitch: 0.7 });
    },
    travelTo(x, z) {
      if (!world) return;
      if (mode === "hike") {
        hk.x = x; hk.z = z; hk.y = Math.max(heightAt(world, x, z), -SWIM_DEPTH) + 40; // drop in from above — glide down
        hk.vy = 0; hk.grounded = false; hk.gliding = true; hk.autoGlide = true;
        hcam.x = hk.x; hcam.z = hk.z + 10; hcam.y = hk.y + 6;
        return;
      }
      flyMap({ tx: x, tz: z, ty: Math.max(0, heightAt(world, x, z)) });
    },
    hikeFrom(peak) {
      if (!world) return;
      spawnNear(peak, camera.position);
      if (mode === "hike") {
        hcam.x = hk.x; hcam.y = hk.y + 5; hcam.z = hk.z + 8;
      } else setMode("hike");
    },
    fitAll() {
      if (!world) return;
      if (mode === "hike") setMode("map");
      flyMap({ tx: world.minX + world.size / 2, ty: 0, tz: world.minZ + world.size / 2, dist: world.size * 0.72, pitch: 0.95 });
    },
    setTime(t, animate) { cycleAuto = false; setTime(t, animate); },
    getTime() { return tod; },
    getPose() {
      const fwd = new THREE.Vector3();
      camera.getWorldDirection(fwd);
      return {
        mode, hx: hk.x, hz: hk.z, hyaw: hk.yaw,
        cx: mode === "map" ? map.tx : camera.position.x, cz: mode === "map" ? map.tz : camera.position.z,
        cyaw: Math.atan2(fwd.x, fwd.z),
        viewR: mode === "map" ? map.dist * 0.8 : 300,
      };
    },
  };

  // ── Overlays ──
  type Cand = { key: string; x: number; y: number; w: number; h: number; pri: number; html: string };
  const cands: Cand[] = [];
  let occlusion = new Map<number, boolean>();
  let lastOcclusion = 0;

  function labelW(i: number) {
    const p = world!.peaks[i];
    return Math.min(250, displayName(p.node.name, p.node.id).length * 6.7 + 34);
  }

  function labelHtml(i: number, withDist: boolean, distance: number) {
    const p = world!.peaks[i];
    const r = world!.ranges[p.range];
    const v = visited.has(p.node.id);
    const sel = i === selected;
    const big = p.rank === 0;
    return `<div style="display:flex;flex-direction:column;align-items:center;gap:1px;transform:translateX(-50%);">
      <div style="display:flex;align-items:center;gap:5px;padding:${big ? "3px 9px" : "2px 7px"};border-radius:7px;background:${sel ? "var(--accent-warm)" : "rgba(8,10,18,0.62)"};backdrop-filter:blur(4px);border:1px solid ${sel ? "transparent" : "rgba(255,255,255,0.1)"};box-shadow:0 2px 10px rgba(0,0,0,0.25)">
        <span style="width:6px;height:6px;border-radius:50%;background:${esc(r.color)};flex-shrink:0"></span>
        <span style="font-family:'Geist',sans-serif;font-size:${big ? 12.5 : 11.5}px;font-weight:${big ? 600 : 500};color:#fff;max-width:220px;overflow:hidden;text-overflow:ellipsis">${esc(displayName(p.node.name, p.node.id))}</span>
        ${v ? `<span title="Summit reached" style="font-size:10px;color:#9ef0b0">✓</span>` : ""}
      </div>
      <span style="font-family:'DM Mono',monospace;font-size:9.5px;color:rgba(255,255,255,0.75);text-shadow:0 1px 3px rgba(0,0,0,0.8)">${toMeters(p.sy).toLocaleString()} m${withDist ? ` · ${distance < 1000 / 12 ? Math.round(distance * 12) + " m" : (distance * 12 / 1000).toFixed(1) + " km"}` : ""}</span>
      <span style="width:1px;height:10px;background:rgba(255,255,255,0.45)"></span>
    </div>`;
  }

  function updateLabels(now: number) {
    if (!world) return;
    const w = world;
    cands.length = 0;
    const relSet = new Set(related);
    if (mode === "map") {
      for (const r of w.ranges) {
        const top = w.peaks[r.summit];
        if (!top || !proj(r.cx, top.sy + 70, r.cz)) continue;
        if (map.dist < r.radius * 0.6) continue;
        cands.push({
          key: `r${r.index}`, x: sp.x, y: sp.y, w: 200, h: 40, pri: 5000 + r.peaks.length,
          html: `<div style="transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:2px;text-shadow:0 2px 12px rgba(0,0,0,0.75)">
            <span style="font-family:'Lora',Georgia,serif;font-size:${Math.round(15 + Math.min(9, Math.sqrt(r.peaks.length) * 0.4))}px;font-weight:600;color:#fff;letter-spacing:0.01em">${esc(r.name)}</span>
            <span style="display:flex;align-items:center;gap:6px;font-family:'DM Mono',monospace;font-size:9.5px;letter-spacing:0.12em;text-transform:uppercase;color:rgba(255,255,255,0.7)"><span style="width:14px;height:2px;border-radius:1px;background:${esc(r.color)}"></span>${r.peaks.length} peaks</span>
          </div>`,
        });
      }
      for (const p of w.peaks) {
        const special = p.index === selected || p.index === hover || relSet.has(p.index);
        if (!proj(p.sx, p.sy + 8, p.sz)) continue;
        const pxR = (p.radius * H) / (2 * Math.tan(THREE.MathUtils.degToRad(25)) * sp.w);
        if (!special && pxR < 26) continue;
        cands.push({
          key: `p${p.index}`, x: sp.x, y: sp.y - 44, w: labelW(p.index), h: 44,
          pri: (p.index === selected ? 9000 : 0) + (p.index === hover ? 8000 : 0) + (relSet.has(p.index) ? 3000 : 0) + pxR,
          html: labelHtml(p.index, false, 0),
        });
      }
    } else {
      // Hike: nearby visible summits
      if (now - lastOcclusion > 280) {
        lastOcclusion = now;
        const near: Array<[number, number]> = [];
        for (const p of w.peaks) {
          const d = Math.hypot(p.sx - camera.position.x, p.sz - camera.position.z);
          if (d < 1100 || p.index === selected) near.push([p.index, (p.height + 20) / (d + 60)]);
        }
        near.sort((a, b) => b[1] - a[1]);
        const next = new Map<number, boolean>();
        const c = camera.position;
        for (const [i] of near.slice(0, 26)) {
          const p = w.peaks[i];
          const dx = p.sx - c.x, dy = p.sy + 3 - c.y, dz = p.sz - c.z;
          const len = Math.hypot(dx, dy, dz);
          const hit = raycastTerrain(w, c.x, c.y, c.z, dx / len, dy / len, dz / len, len - 6);
          next.set(i, !hit);
        }
        occlusion = next;
      }
      for (const [i, vis] of occlusion) {
        if (!vis && i !== selected) continue;
        const p = w.peaks[i];
        if (!proj(p.sx, p.sy + 9, p.sz)) continue;
        const d = Math.hypot(p.sx - hk.x, p.sz - hk.z);
        cands.push({
          key: `p${i}`, x: sp.x, y: sp.y - 44, w: labelW(i), h: 44,
          pri: (i === selected ? 9000 : 0) + (i === hover ? 8000 : 0) + 2000 - d,
          html: labelHtml(i, true, Math.hypot(d, p.sy - hk.y)),
        });
      }
    }
    cands.sort((a, b) => b.pri - a.pri);
    const boxes: Array<[number, number, number, number]> = [];
    for (const l of labels) l.used = false;
    const byKey = new Map(labels.filter((l) => l.key).map((l) => [l.key, l]));
    const placed: Array<{ c: Cand; l: Label | null }> = [];
    for (const c of cands) {
      if (placed.length >= LABEL_POOL) break;
      const b: [number, number, number, number] = [c.x - c.w / 2, c.y, c.x + c.w / 2, c.y + c.h];
      if (boxes.some((o) => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1])) continue;
      boxes.push(b);
      const l = byKey.get(c.key) ?? null;
      if (l) l.used = true;
      placed.push({ c, l });
    }
    const free = labels.filter((l) => !l.used);
    for (const { c, l: existing } of placed) {
      const l = existing ?? free.shift();
      if (!l) continue;
      l.used = true;
      if (l.key !== c.key || l.el.dataset.html !== c.html) {
        l.key = c.key;
        l.el.dataset.html = c.html;
        l.el.innerHTML = c.html;
      }
      l.el.style.opacity = "1";
      l.el.style.transform = `translate3d(${Math.round(c.x)}px, ${Math.round(c.y)}px, 0)`;
    }
    for (const l of labels) if (!l.used) { l.el.style.opacity = "0"; l.key = ""; }
  }

  function updateTooltip() {
    if (!world || hover < 0 || !mouse || drag) { tooltip.style.opacity = "0"; return; }
    const p = world.peaks[hover];
    const r = world.ranges[p.range];
    const key = String(hover);
    if (tooltip.dataset.key !== key) {
      tooltip.dataset.key = key;
      const ageDays = Math.round((Date.now() - Date.parse(p.node.createdTime)) / 86_400_000);
      tooltip.innerHTML = `
        <div style="display:flex;align-items:center;gap:6px;font-family:'DM Mono',monospace;font-size:9.5px;letter-spacing:0.08em;text-transform:uppercase;color:rgba(255,255,255,0.55)">
          <span style="width:7px;height:7px;border-radius:50%;background:${esc(r.color)}"></span>${esc(r.name)} range${p.rank === 0 ? " · highest" : ` · #${p.rank + 1}`}
        </div>
        <div style="margin-top:4px;font-family:'Geist',sans-serif;font-size:13px;font-weight:600;color:#fff;line-height:1.3">${esc(displayName(p.node.name, p.node.id))}</div>
        <div style="margin-top:4px;font-family:'DM Mono',monospace;font-size:10.5px;color:rgba(255,255,255,0.7)">${toMeters(p.sy).toLocaleString()} m · ${p.degree} connection${p.degree === 1 ? "" : "s"} · ${ageDays < 45 ? "active" : ageDays < 180 ? `${Math.round(ageDays / 30)} mo old` : "quiet"}</div>`;
    }
    const tw = tooltip.offsetWidth, th = tooltip.offsetHeight;
    let x = mouse.x + 16, y = mouse.y + 16;
    if (x + tw > W - rightInset - 8) x = mouse.x - tw - 16;
    if (y + th > H - 8) y = mouse.y - th - 16;
    tooltip.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    tooltip.style.opacity = "1";
  }

  let compassKey = "";
  function updateCompass(yaw: number) {
    if (!world) return;
    const pxPerRad = 440 / (Math.PI * 0.9);
    const items: string[] = [];
    const wrap = (a: number) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
    // Heading: yaw is the direction the camera faces (atan2(x, z)); north = -z
    const heading = yaw;
    for (let deg = 0; deg < 360; deg += 15) {
      const a = (deg * Math.PI) / 180;
      const dirYaw = Math.atan2(Math.sin(a), -Math.cos(a));       // compass bearing → world yaw (north = -z)
      const off = wrap(dirYaw - heading);
      if (Math.abs(off) > Math.PI * 0.48) continue;
      const x = 220 - off * pxPerRad;
      const card = deg % 90 === 0 ? ["N", "E", "S", "W"][deg / 90] : "";
      items.push(card
        ? `<span style="position:absolute;left:${x}px;top:6px;transform:translateX(-50%);font-family:'DM Mono',monospace;font-size:11px;font-weight:600;color:${card === "N" ? "var(--accent-warm)" : "#fff"}">${card}</span>`
        : `<span style="position:absolute;left:${x}px;top:${deg % 45 === 0 ? 10 : 13}px;width:1px;height:${deg % 45 === 0 ? 10 : 5}px;background:rgba(255,255,255,0.45)"></span>`);
    }
    const ox = mode === "hike" ? hk.x : camera.position.x, oz = mode === "hike" ? hk.z : camera.position.z;
    const marker = (x: number, z: number, color: string, text: string, strong: boolean) => {
      const a = Math.atan2(x - ox, z - oz);
      const off = wrap(a - heading);
      if (Math.abs(off) > Math.PI * 0.48) return;
      const px = 220 - off * pxPerRad;
      items.push(`<span style="position:absolute;left:${px}px;top:${strong ? 2 : 17}px;transform:translateX(-50%);display:flex;align-items:center;gap:3px;font-family:'Geist',sans-serif;font-size:${strong ? 10 : 9}px;font-weight:${strong ? 600 : 500};color:${strong ? "#fff" : "rgba(255,255,255,0.7)"};white-space:nowrap;${strong ? `background:${color};padding:1px 6px;border-radius:999px;` : ""}">${strong ? "" : `<span style="width:5px;height:5px;border-radius:1px;transform:rotate(45deg);background:${esc(color)}"></span>`}${esc(text)}</span>`);
    };
    // Ranges within reach
    const rs = world.ranges.map((r) => ({ r, d: Math.hypot(r.cx - ox, r.cz - oz) - r.radius })).filter((o) => o.d > -o.r.radius * 0.4).sort((a, b) => a.d - b.d).slice(0, 4);
    const used: number[] = [];
    for (const { r } of rs) {
      const off = wrap(Math.atan2(r.cx - ox, r.cz - oz) - heading);
      const px = 220 - off * pxPerRad;
      if (used.some((u) => Math.abs(u - px) < 80)) continue;
      used.push(px);
      marker(r.cx, r.cz, r.color, r.name, false);
    }
    if (selected >= 0) {
      const p = world.peaks[selected];
      const d = Math.hypot(p.sx - ox, p.sz - oz) * 12;
      marker(p.sx, p.sz, "var(--accent-warm)", `◆ ${d < 1000 ? Math.round(d) + " m" : (d / 1000).toFixed(1) + " km"}`, true);
    }
    const html = items.join("");
    if (html !== compassKey) { compassKey = html; compassInner.innerHTML = html; }
  }

  // ── Resize ──
  function applyViewOffset() {
    const s = (leftInset - rightInset) / 2;
    const full = W + 2 * Math.abs(s);
    camera.aspect = full / H;
    camera.setViewOffset(full, H, Math.abs(s) - s, 0, W, H);
    camera.updateProjectionMatrix();
    compass.style.marginLeft = `${-220 + s}px`;
  }
  function resize() {
    W = Math.max(1, mount.clientWidth); H = Math.max(1, mount.clientHeight);
    renderer.setSize(W, H);
    composer.setSize(W, H);
    applyViewOffset();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(mount);
  resize();

  // ── Frame ──
  const frustum = new THREE.Frustum();
  const projScreen = new THREE.Matrix4();
  let raf = 0;
  let prev = performance.now();
  let lastHover = 0;
  let lastLoc = 0;
  let lastLocKey = "";
  let lastSummitCheck = 0;
  const headV = new THREE.Vector3();

  function updateHiker(dt: number) {
    if (!world) return;
    const w = world;
    const fwdX = -Math.sin(hcam.yaw), fwdZ = -Math.cos(hcam.yaw);
    const rightX = Math.cos(hcam.yaw), rightZ = -Math.sin(hcam.yaw);
    let ix = 0, iz = 0;
    if (keys.has("KeyW") || keys.has("ArrowUp")) { ix += fwdX; iz += fwdZ; }
    if (keys.has("KeyS") || keys.has("ArrowDown")) { ix -= fwdX; iz -= fwdZ; }
    if (keys.has("KeyD") || keys.has("ArrowRight")) { ix += rightX; iz += rightZ; }
    if (keys.has("KeyA") || keys.has("ArrowLeft")) { ix -= rightX; iz -= rightZ; }
    const il = Math.hypot(ix, iz);
    if (il > 0) { ix /= il; iz /= il; }
    const sprint = keys.has("ShiftLeft") || keys.has("ShiftRight");

    const ground = heightAt(w, hk.x, hk.z);
    hk.swimming = ground < -SWIM_DEPTH && hk.y <= -SWIM_DEPTH + 0.05;
    const n = normalAt(w, hk.x, hk.z);

    let speed = hk.swimming ? SWIM : sprint ? SPRINT : WALK;
    if (hk.grounded && !hk.swimming && il > 0) {
      // Uphill on steep ground slows you to a scramble
      const up = -(n[0] * ix + n[2] * iz);
      if (up > 0) speed *= Math.max(0.22, Math.min(1, (n[1] - 0.42) / 0.36));
    }
    let tvx = ix * speed, tvz = iz * speed;
    if (hk.gliding) {
      // Glide in the facing direction; A/D or the camera steer
      const gx = il > 0 ? ix : -Math.sin(hk.yaw), gz = il > 0 ? iz : -Math.cos(hk.yaw);
      tvx = gx * GLIDE; tvz = gz * GLIDE;
    }
    const acc = hk.grounded ? 10 : hk.gliding ? 2.2 : 2.5;
    hk.vx += (tvx - hk.vx) * Math.min(1, dt * acc);
    hk.vz += (tvz - hk.vz) * Math.min(1, dt * acc);
    // Slide down very steep faces
    if (hk.grounded && !hk.swimming && n[1] < 0.55) {
      hk.vx += n[0] * 30 * dt; hk.vz += n[2] * 30 * dt;
    }
    hk.x += hk.vx * dt; hk.z += hk.vz * dt;
    hk.x = Math.min(w.minX + w.size - 10, Math.max(w.minX + 10, hk.x));
    hk.z = Math.min(w.minZ + w.size - 10, Math.max(w.minZ + 10, hk.z));

    const g2 = heightAt(w, hk.x, hk.z);
    const floor = Math.max(g2, -SWIM_DEPTH);
    if (jumpRequested && (hk.grounded || hk.swimming)) { hk.vy = hk.swimming ? 5 : JUMP_V; hk.grounded = false; }
    jumpRequested = false;
    if (hk.grounded) {
      // Stick to the ground unless it drops away faster than we can follow (then we're airborne)
      if (floor < hk.y - 1.2 && !hk.swimming) hk.grounded = false;
      else hk.y = floor;
    }
    if (!hk.grounded) {
      const holding = keys.has("Space");
      hk.gliding = (holding || hk.autoGlide) && hk.vy < 0 && hk.y - floor > 2.5;
      hk.vy -= GRAVITY * dt * (hk.gliding ? 0.15 : 1);
      if (hk.gliding) hk.vy = Math.max(hk.vy, -2.6);
      hk.y += hk.vy * dt;
      if (hk.y <= floor) { hk.y = floor; hk.vy = 0; hk.grounded = true; hk.gliding = false; hk.autoGlide = false; }
    }

    const moveSpeed = Math.hypot(hk.vx, hk.vz);
    if (moveSpeed > 0.5) {
      const target = Math.atan2(-hk.vx, -hk.vz);
      let d = target - hk.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      hk.yaw += d * Math.min(1, dt * 10);
    }
    hiker.group.position.set(hk.x, hk.y, hk.z);
    hiker.group.rotation.y = hk.yaw + Math.PI;
    hiker.animate(dt, hk.grounded ? moveSpeed : 0, hk.swimming ? "swim" : hk.gliding ? "glide" : hk.grounded ? "ground" : "air");

    // Blob shadow
    blob.position.set(hk.x, Math.max(g2, 0.02) + 0.06, hk.z);
    const hAbove = hk.y - Math.max(g2, 0);
    blob.scale.setScalar(1 + hAbove * 0.04);
    blobMat.uniforms.uOpacity.value = (0.45 - 0.15 * nightK) * Math.max(0, 1 - hAbove / 30) * (hk.swimming ? 0 : 1);
    blob.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(n[0], n[1], n[2]));
  }

  function updateHikeCamera(dt: number) {
    if (!world) return;
    const w = world;
    headV.set(hk.x, hk.y + HIKER_HEIGHT * HIKER_SCALE * 0.85, hk.z);
    const dirX = Math.sin(hcam.yaw) * Math.cos(hcam.pitch), dirY = Math.sin(hcam.pitch), dirZ = Math.cos(hcam.yaw) * Math.cos(hcam.pitch);
    let dist = hcam.dist * (hk.gliding ? 1.6 : 1);
    // Pull the camera in when terrain is between it and the hiker
    for (let s = 0.15; s <= 1; s += 0.08) {
      const x = headV.x + dirX * dist * s, y = headV.y + dirY * dist * s, z = headV.z + dirZ * dist * s;
      if (y < heightAt(w, x, z) + 0.8) { dist = Math.max(2.5, dist * s - 0.6); break; }
    }
    const tx = headV.x + dirX * dist, tz = headV.z + dirZ * dist;
    let ty = headV.y + dirY * dist;
    ty = Math.max(ty, heightAt(w, tx, tz) + 0.6, -SWIM_DEPTH + 0.6);
    const k = 1 - Math.exp(-dt * 14);
    hcam.x += (tx - hcam.x) * k; hcam.y += (ty - hcam.y) * k; hcam.z += (tz - hcam.z) * k;
    camera.position.set(hcam.x, hcam.y, hcam.z);
    // Over-the-shoulder: look a little past the hiker so the horizon stays in frame
    lookV.set(headV.x - Math.sin(hcam.yaw) * 9, headV.y + 1.8, headV.z - Math.cos(hcam.yaw) * 9);
    camera.lookAt(lookV);
  }

  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - prev) / 1000);
    prev = now;
    L.uTime.value += dt;
    // Advance the clock
    {
      const before = tod;
      if (todAnim) {
        const k = Math.min(1, (now - todAnim.t0) / todAnim.dur);
        const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        tod = (todAnim.from + (todAnim.to - todAnim.from) * e) % 1;
        if (k >= 1) todAnim = null;
      } else if (cycleAuto) {
        tod = (tod + dt / secondsPerDay) % 1;
      }
      if (tod !== before) applyTime();
      const minute = Math.floor(tod * 1440);
      if (minute !== lastTimeReport && now - lastTimeReportAt > 120) {
        lastTimeReport = minute;
        lastTimeReportAt = now;
        cbRef.current.onTime(tod);
      }
    }
    if (!world) { renderer.setClearColor(P.uZenith.value); renderer.render(scene, camera); return; }
    const w = world;

    // ── Cameras ──
    if (mode === "hike") {
      updateHiker(dt);
      updateHikeCamera(dt);
      if (transition) {
        const t = Math.min(1, (now - transition.t0) / transition.dur);
        const e = easeInOut(t);
        const target = camera.position.clone();
        camera.position.lerpVectors(transition.from, target, e);
        lookV.set(hk.x, hk.y + 3, hk.z);
        const look = transition.fromLook.clone().lerp(lookV, e);
        camera.lookAt(look);
        if (t >= 1) transition = null;
      }
      camera.near = 0.25;
    } else {
      updateHiker(dt); // hiker keeps idling / settles if mid-air
      if (flight) {
        const t = Math.min(1, (now - flight.t0) / flight.dur);
        const e = easeInOut(t);
        const f = flight.from, to = flight.to;
        map.tx = f.tx + (to.tx - f.tx) * e;
        map.ty = f.ty + (to.ty - f.ty) * e;
        map.tz = f.tz + (to.tz - f.tz) * e;
        map.yaw = f.yaw + (to.yaw - f.yaw) * e;
        map.pitch = f.pitch + (to.pitch - f.pitch) * e;
        map.dist = Math.exp(Math.log(f.dist) + (Math.log(to.dist) - Math.log(f.dist)) * e) + Math.sin(Math.PI * e) * flight.hop;
        if (t >= 1) flight = null;
      }
      mapCameraPose(map, tmpV);
      // Never dip below the terrain
      const ground = Math.max(heightAt(w, tmpV.x, tmpV.z), 0);
      if (tmpV.y < ground + 8) tmpV.y = ground + 8;
      camera.position.copy(tmpV);
      camera.lookAt(map.tx, map.ty, map.tz);
      camera.near = Math.max(0.5, map.dist * 0.004);
    }
    camera.far = 16000;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    prepProj();
    L.uCamPos.value.copy(camera.position);
    // Aerial haze: full strength on foot, thinner when looking down from high above
    L.uFogDensity.value = fogBase * (mode === "hike" ? 1 : Math.min(1, Math.max(0.28, 700 / map.dist)));
    skyDome.position.copy(camera.position);
    sunLight.position.set(hk.x + sky.lightDir.x * 50, hk.y + sky.lightDir.y * 50, hk.z + sky.lightDir.z * 50);
    // Headlamp: ahead of and above the hiker, lighting the trail at night
    L.uLampPos.value.set(hk.x - Math.sin(hk.yaw) * 3, hk.y + 4.5, hk.z - Math.cos(hk.yaw) * 3);
    lamp.position.set(hk.x + Math.sin(hcam.yaw) * 3, hk.y + 4, hk.z + Math.cos(hcam.yaw) * 3);
    sunLight.target.position.set(hk.x, hk.y, hk.z);
    dotMat.uniforms.uPxScale.value = H / (2 * Math.tan(THREE.MathUtils.degToRad(25)));

    // ── Terrain LOD ──
    projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projScreen);
    const counts = [0, 0, 0, 0, 0, 0];
    const cp = camera.position;
    for (const c of chunkBoxes) {
      if (!frustum.intersectsBox(c.box)) continue;
      const dx = Math.max(c.box.min.x - cp.x, 0, cp.x - c.box.max.x);
      const dz = Math.max(c.box.min.z - cp.z, 0, cp.z - c.box.max.z);
      const dy = Math.max(c.box.min.y - cp.y, 0, cp.y - c.box.max.y);
      const d = Math.hypot(dx, dy, dz);
      let lod = LOD_STEPS.length - 1;
      for (let k = 0; k < LOD_DIST.length; k++) if (d < LOD_DIST[k]) { lod = k; break; }
      const m = lodMeshes[lod];
      const arr = m.attr.array as Float32Array;
      arr[counts[lod] * 2] = c.i0;
      arr[counts[lod] * 2 + 1] = c.j0;
      counts[lod]++;
    }
    lodMeshes.forEach((m, k) => { m.geo.instanceCount = counts[k]; m.attr.needsUpdate = true; m.attr.addUpdateRange(0, counts[k] * 2); });

    // Trees fade out with distance
    for (const t of treeTiles) {
      const s = t.boundingSphere!;
      t.visible = s.center.distanceTo(cp) - s.radius < 2600;
    }
    if (flags && poles && cairns) {
      const near = mode === "hike" || map.dist < 1600;
      flags.visible = poles.visible = cairns.visible = near;
    }
    dotMat.uniforms.uFadeNear.value = mode === "hike" ? 160 : 90;
    arcs.visible = mode === "map";

    // ── Hover ──
    if (mouse && !drag && (mouseMoved || now - lastHover > 250) && now - lastHover > 50) {
      mouseMoved = false;
      lastHover = now;
      const h = pickPeak(mouse.x, mouse.y);
      if (h !== hover) {
        hover = h;
        dotMat.uniforms.uHover.value = h;
        canvas.style.cursor = h >= 0 ? "pointer" : "grab";
      }
    } else if (!mouse && hover >= 0) {
      hover = -1;
      dotMat.uniforms.uHover.value = -1;
    }

    // ── Hike bookkeeping ──
    if (mode === "hike" && now - lastSummitCheck > 200) {
      lastSummitCheck = now;
      for (const p of w.peaks) {
        if (Math.abs(p.sx - hk.x) > 14 || Math.abs(p.sz - hk.z) > 14) continue;
        if (Math.hypot(p.sx - hk.x, p.sz - hk.z) < 13 && hk.y > p.sy - 7 && !reachedThisSession.has(p.index)) {
          reachedThisSession.add(p.index);
          cbRef.current.onSummit(p.index);
        }
      }
    }
    if (now - lastLoc > 250) {
      lastLoc = now;
      const x = mode === "hike" ? hk.x : map.tx, z = mode === "hike" ? hk.z : map.tz;
      const range = rangeAtPoint(w, x, z);
      const alt = mode === "hike" ? toMeters(Math.max(0, hk.y)) : toMeters(Math.max(0, heightAt(w, x, z)));
      const key = `${range}:${Math.round(alt / 10)}:${hk.swimming}:${hk.gliding}`;
      if (key !== lastLocKey) { lastLocKey = key; cbRef.current.onLocation({ range, altitude: alt, swimming: hk.swimming && mode === "hike", gliding: hk.gliding && mode === "hike" }); }
    }

    // ── Overlays ──
    const fwd = new THREE.Vector3();
    camera.getWorldDirection(fwd);
    updateCompass(Math.atan2(fwd.x, fwd.z));
    updateLabels(now);
    updateTooltip();

    composer.render();
  }
  raf = requestAnimationFrame(frame);
  applyMaterials();
  applyTime();

  return {
    api,
    setWorld,
    setTheme(dark) {
      // First call sets the scene; later toggles play the sunset / sunrise and hold there
      const target = dark ? 0.955 : 0.54;
      if (!themeInit) { themeInit = true; setTime(target, false); return; }
      cycleAuto = false;
      setTime(target, true);
    },
    setCycle(auto, spd) {
      cycleAuto = auto;
      secondsPerDay = Math.max(5, spd);
      if (auto) todAnim = null;
    },
    setSelection(peak, rel) {
      selected = peak ?? -1;
      related = rel;
      applySelection();
    },
    setVisited(v) { visited = v; for (const l of labels) l.el.dataset.html = ""; },
    setInsets(l, r) {
      if (l === leftInset && r === rightInset) return;
      leftInset = l; rightInset = r;
      applyViewOffset();
    },
    setAccent(hex) { hiker.setAccent(hex); },
    dispose() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      for (const t of treeTiles) t.dispose();
      for (const m of [flags, poles, cairns, landmarkBeams]) m?.dispose();
      selBeam.dispose();
      dots?.geometry.dispose();
      arcGeo.dispose();
      T.uHeight.value?.dispose(); T.uNS.value?.dispose(); T.uAO.value?.dispose(); T.uTint.value?.dispose();
      for (const d of disposables) d.dispose();
      hiker.dispose();
      composer.dispose();
      renderer.dispose();
      overlay.remove();
      canvas.remove();
    },
  };
}
