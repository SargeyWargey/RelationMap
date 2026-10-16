import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

import { degreeAt, organismName, radiusFor, type CultureWorld } from "@/lib/cultureWorld";
import { formatDay } from "@/lib/lineModel";
import {
  DISH_FRAG, DISH_VERT, FILAMENT_FRAG, FILAMENT_VERT, HALO_FRAG, HALO_VERT, LENS_FRAG, LENS_VERT,
  MORPH_EXTENT, MOTE_FRAG, MOTE_VERT, ORGANISM_FRAG, ORGANISM_VERT, TEX_W,
} from "./shaders";

// ─── Public types ─────────────────────────────────────────────────────────────

export type CultureStain = "species" | "age" | "amber";

export type CultureSettings = {
  filaments: boolean;
  sizeScale: number;
  stain: CultureStain;
  labels: boolean;
};

export type CultureInsets = { left: number; right: number; top: number; bottom: number };

export type CultureApi = {
  play: () => void;
  pause: () => void;
  toggle: () => void;
  /** Jump to a day (wall-clock days). `animate` lets births in the jump play out. */
  seek: (day: number, animate?: boolean) => void;
  step: (days: number) => void;
  getDay: () => number;
  isPlaying: () => boolean;
  /** Replay the whole history as a short time-lapse. */
  timelapse: () => void;
  focusOrganism: (index: number) => void;
  focusColony: (colony: number) => void;
  fitAll: () => void;
  zoomBy: (factor: number) => void;
};

export type CultureCallbacks = {
  onSelect: (index: number | null) => void;
  /** Playhead (≈10×/s while it moves, and whenever play state changes). */
  onTime: (day: number, playing: boolean) => void;
};

export type CultureEngine = {
  api: CultureApi;
  setWorld: (world: CultureWorld, opts: { timelapse: boolean }) => void;
  setTheme: (dark: boolean) => void;
  setSelection: (index: number | null) => void;
  /** Light up one species or colony (legend hover); null clears. */
  setHighlight: (h: { species?: number; colony?: number } | null) => void;
  setSettings: (s: CultureSettings) => void;
  setInsets: (i: CultureInsets) => void;
  /** Days of history per second of playback. */
  setSpeed: (daysPerSecond: number) => void;
  dispose: () => void;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOutBack = (t: number) => { const c1 = 1.5, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };

/** Seconds of real time a birth / dormancy / new link takes to play out. */
const ANIM_SECONDS = 1.1;
const TIMELAPSE_SECONDS = 9;
const MIN_ZOOM = 0.35;
const MAX_ZOOM = 90;

const STATE_CODE = { open: 0, active: 1, blocked: 2, done: 3 } as const;

function linear(hex: string): THREE.Color {
  return new THREE.Color(hex);
}

function premulMaterial(params: THREE.ShaderMaterialParameters): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendEquation: THREE.AddEquation,
    ...params,
  });
}

type Theme = { agarA: THREE.Color; agarB: THREE.Color; outside: THREE.Color; rim: THREE.Color };
const THEMES: Record<"dark" | "light", Theme> = {
  dark: { agarA: linear("#0d0705"), agarB: linear("#1f130a"), outside: linear("#040302"), rim: linear("#ffb46e") },
  light: { agarA: linear("#f1e6cc"), agarB: linear("#e3d1aa"), outside: linear("#cdc4b4"), rim: linear("#ffffff") },
};

type LabelEl = { el: HTMLDivElement; key: string; title: HTMLSpanElement; sub: HTMLSpanElement };

// ─── Engine ───────────────────────────────────────────────────────────────────

export function createCultureEngine(mount: HTMLDivElement, cbRef: { current: CultureCallbacks }): CultureEngine {
  let W = Math.max(1, mount.clientWidth);
  let H = Math.max(1, mount.clientHeight);
  const dpr = Math.min(2, window.devicePixelRatio || 1);

  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
  renderer.setPixelRatio(dpr);
  renderer.setSize(W, H);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.domElement.style.display = "block";
  renderer.domElement.style.touchAction = "none";
  renderer.domElement.style.outline = "none";
  mount.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  camera.position.set(0, 0, 10);

  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(dpr);
  composer.setSize(W, H);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(W, H), 0.6, 0.5, 0.3);
  composer.addPass(bloom);
  const lens = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uDark: { value: 1 }, uRes: { value: new THREE.Vector2(W * dpr, H * dpr) } },
    vertexShader: LENS_VERT,
    fragmentShader: LENS_FRAG,
  });
  composer.addPass(lens);
  composer.addPass(new OutputPass());

  // ── Shared uniforms ──
  const speciesColors = Array.from({ length: 32 }, () => new THREE.Color(0.6, 0.6, 0.6));
  const accent = linear("#da7756");
  const U = {
    uTime: { value: 0 },
    uDark: { value: 1 },
    uPx: { value: 2 },
    uStain: { value: 0 },
    uFocusMode: { value: 0 },
    uS0: { value: null as THREE.DataTexture | null },
    uS1: { value: null as THREE.DataTexture | null },
    uS2: { value: null as THREE.DataTexture | null },
    uSpecies: { value: speciesColors },
    uAccent: { value: accent },
  };

  // ── Dish (full-screen) ──
  const theme = THEMES.dark;
  const dishMat = new THREE.ShaderMaterial({
    vertexShader: DISH_VERT,
    fragmentShader: DISH_FRAG,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      uCenter: { value: new THREE.Vector2() },
      uView: { value: new THREE.Vector2(W, H) },
      uPx: U.uPx,
      uDishR: { value: 100 },
      uDark: U.uDark,
      uTime: U.uTime,
      uAgarA: { value: theme.agarA.clone() },
      uAgarB: { value: theme.agarB.clone() },
      uOutside: { value: theme.outside.clone() },
      uRimCol: { value: theme.rim.clone() },
    },
  });
  const dish = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), dishMat);
  dish.frustumCulled = false;
  dish.renderOrder = 0;
  scene.add(dish);

  // ── Motes: a deep layer behind the cells and out-of-focus bokeh in front ──
  const moteUniforms = { uTime: U.uTime, uPx: U.uPx, uCenter: { value: new THREE.Vector2() }, uDpr: { value: dpr }, uDark: U.uDark, uMoteA: { value: 1 } };
  const moteMat = premulMaterial({ vertexShader: MOTE_VERT, fragmentShader: MOTE_FRAG, uniforms: moteUniforms });
  let motesBack: THREE.Points | null = null;
  let motesFront: THREE.Points | null = null;

  // ── Organism layers ──
  const quad = new THREE.PlaneGeometry(2, 2);
  const haloMat = premulMaterial({ vertexShader: HALO_VERT, fragmentShader: HALO_FRAG, uniforms: { ...U }, blendEquation: THREE.MaxEquation });
  const orgMat = premulMaterial({
    vertexShader: ORGANISM_VERT,
    fragmentShader: ORGANISM_FRAG,
    uniforms: { ...U, uExtent: { value: MORPH_EXTENT }, uMinPx: { value: 1.5 } },
  });
  const filUniforms = { ...U, uDay: { value: 0 }, uAnimDays: { value: 0 }, uOnlyFocus: { value: 0 } };
  // Strip winding flips with the link's direction — draw both faces
  const filMat = premulMaterial({ vertexShader: FILAMENT_VERT, fragmentShader: FILAMENT_FRAG, uniforms: filUniforms, side: THREE.DoubleSide });

  let haloMesh: THREE.Mesh | null = null;
  let orgMesh: THREE.Mesh | null = null;
  let filMesh: THREE.Mesh | null = null;

  // ── DOM overlay: labels, tooltip, reticle ──
  const overlay = document.createElement("div");
  overlay.style.cssText = "position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:2;";
  mount.appendChild(overlay);
  const reticle = document.createElement("div");
  reticle.style.cssText = "position:absolute;left:0;top:0;border-radius:50%;border:1.5px solid var(--accent-warm);box-shadow:0 0 0 1px rgba(0,0,0,0.25),0 0 18px rgba(218,119,86,0.45);opacity:0;transition:opacity 0.2s;will-change:transform;";
  for (const [x, y, w, h] of [["50%", "-7px", "1.5px", "6px"], ["50%", "calc(100% + 1px)", "1.5px", "6px"], ["-7px", "50%", "6px", "1.5px"], ["calc(100% + 1px)", "50%", "6px", "1.5px"]]) {
    const t = document.createElement("div");
    t.style.cssText = `position:absolute;left:${x};top:${y};width:${w};height:${h};background:var(--accent-warm);transform:translate(${x === "50%" ? "-50%" : "0"},${y === "50%" ? "-50%" : "0"});`;
    reticle.appendChild(t);
  }
  overlay.appendChild(reticle);
  const tooltip = document.createElement("div");
  tooltip.style.cssText = "position:absolute;left:0;top:0;max-width:280px;padding:8px 10px;border-radius:10px;background:var(--panel-bg);backdrop-filter:blur(14px);border:1px solid var(--border-default);box-shadow:var(--shadow-md);opacity:0;transition:opacity 0.12s;z-index:3;";
  overlay.appendChild(tooltip);

  const labelPool: LabelEl[] = [];
  function labelAt(i: number): LabelEl {
    let l = labelPool[i];
    if (!l) {
      const el = document.createElement("div");
      el.style.cssText = "position:absolute;left:0;top:0;white-space:nowrap;will-change:transform;display:flex;align-items:baseline;gap:5px;";
      const title = document.createElement("span");
      const sub = document.createElement("span");
      el.appendChild(title); el.appendChild(sub);
      overlay.insertBefore(el, reticle);
      l = { el, key: "", title, sub };
      labelPool.push(l);
    }
    return l;
  }

  // ── World state ──
  let world: CultureWorld | null = null;
  let N = 0;
  let texH = 1;
  let S0 = new Float32Array(4), S1 = new Float32Array(4), S2 = new Float32Array(4);
  let homeX = new Float32Array(0), homeY = new Float32Array(0);
  let fromX = new Float32Array(0), fromY = new Float32Array(0), fromVis = new Float32Array(0);
  let born = new Float64Array(0), dormantAt = new Float64Array(0), activeFrom = new Float64Array(0);
  let origin = new Int32Array(0);
  let migrant = new Uint8Array(0);
  let stateCode = new Uint8Array(0);
  let colonyVis = new Int32Array(0);
  let colonyR = new Float32Array(0);
  let transT = 1;
  let filBase: THREE.BufferGeometry | null = null;

  // ── Time ──
  let day = 0;
  let playing = false;
  let speed = 10;
  let timelapse: { speed: number } | null = null;
  let animK = 0;
  let lastNotify = 0;
  let notifyPending = true;

  // ── View ──
  let cx = 0, cy = 0, zoom = 2;
  let tcx = 0, tcy = 0, tzoom = 2;
  let fitted = true;
  let insets: CultureInsets = { left: 0, right: 0, top: 0, bottom: 0 };
  let settings: CultureSettings = { filaments: true, sizeScale: 1, stain: "species", labels: true };

  // ── Interaction ──
  let selected: number | null = null;
  let hovered = -1;
  let related = new Set<number>();
  let hoverRelated = new Set<number>();
  let highlight: { species?: number; colony?: number } | null = null;
  let labelColony = -1;
  let focusDirty = true;
  let mouseX = -1, mouseY = -1;

  function toWorld(sx: number, sy: number): [number, number] {
    return [cx + (sx - W / 2) / zoom, cy - (sy - H / 2) / zoom];
  }
  function toScreen(wx: number, wy: number): [number, number] {
    return [W / 2 + (wx - cx) * zoom, H / 2 - (wy - cy) * zoom];
  }
  /** Screen-space centre of the area not covered by panels. */
  function freeCentre(): [number, number] {
    return [insets.left + (W - insets.left - insets.right) / 2, insets.top + (H - insets.top - insets.bottom) / 2];
  }
  function fitZoom(): number {
    if (!world) return 2;
    const fw = Math.max(120, W - insets.left - insets.right - 48);
    const fh = Math.max(120, H - insets.top - insets.bottom - 32);
    return clamp(Math.min(fw, fh) / (2 * world.dishRadius * 1.02), MIN_ZOOM, MAX_ZOOM);
  }
  function lookAt(wx: number, wy: number, z: number, instant = false) {
    const [fx, fy] = freeCentre();
    tzoom = clamp(z, MIN_ZOOM, MAX_ZOOM);
    tcx = wx - (fx - W / 2) / tzoom;
    tcy = wy + (fy - H / 2) / tzoom;
    if (instant) { cx = tcx; cy = tcy; zoom = tzoom; }
  }
  function fitAll(instant = false) {
    fitted = true;
    lookAt(0, 0, fitZoom(), instant);
  }

  // ── Build GPU resources for a world ──
  function buildMotes(dishR: number) {
    for (const m of [motesBack, motesFront]) if (m) { scene.remove(m); m.geometry.dispose(); }
    let s = 12345;
    const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
    const make = (count: number, layer: (k: number) => number) => {
      const pos = new Float32Array(count * 3);
      const info = new Float32Array(count * 4);
      for (let k = 0; k < count; k++) {
        const r = Math.sqrt(rnd()) * dishR * 1.05, a = rnd() * Math.PI * 2;
        pos[k * 3] = Math.cos(a) * r; pos[k * 3 + 1] = Math.sin(a) * r;
        const L = layer(k);
        info[k * 4] = L === 2 ? 3 + rnd() * 7 : 0.12 + rnd() * (L === 0 ? 0.35 : 0.22);
        info[k * 4 + 1] = L;
        info[k * 4 + 2] = rnd();
        info[k * 4 + 3] = 0.35 + rnd() * 0.65;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      g.setAttribute("aInfo", new THREE.BufferAttribute(info, 4));
      const p = new THREE.Points(g, moteMat);
      p.frustumCulled = false;
      return p;
    };
    const area = Math.PI * dishR * dishR;
    motesBack = make(Math.round(clamp(area / 90, 300, 2400)), (k) => (k % 3 === 0 ? 1 : 0));
    motesBack.renderOrder = 1;
    motesFront = make(Math.round(clamp(area / 2400, 20, 90)), () => 2);
    motesFront.renderOrder = 7;
    scene.add(motesBack, motesFront);
  }

  function instanced(base: THREE.BufferGeometry, count: number): THREE.InstancedBufferGeometry {
    const g = new THREE.InstancedBufferGeometry();
    g.setIndex(base.getIndex());
    g.setAttribute("position", base.getAttribute("position"));
    g.setAttribute("aIdx", new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, count)), 1));
    g.instanceCount = count;
    return g;
  }

  function setWorld(w: CultureWorld, opts: { timelapse: boolean }) {
    const prev = world;
    const prevX = new Map<string, [number, number, number]>();
    if (prev) for (let i = 0; i < prev.organisms.length; i++) prevX.set(prev.organisms[i].node.id, [S0[i * 4], S0[i * 4 + 1], S0[i * 4 + 3]]);

    world = w;
    N = w.organisms.length;
    texH = Math.max(1, Math.ceil(N / TEX_W));
    const size = TEX_W * texH * 4;
    S0 = new Float32Array(size); S1 = new Float32Array(size); S2 = new Float32Array(size);
    homeX = new Float32Array(N); homeY = new Float32Array(N);
    fromX = new Float32Array(N); fromY = new Float32Array(N); fromVis = new Float32Array(N);
    born = new Float64Array(N); dormantAt = new Float64Array(N); activeFrom = new Float64Array(N);
    origin = new Int32Array(N); migrant = new Uint8Array(N); stateCode = new Uint8Array(N);
    colonyVis = new Int32Array(w.colonies.length); colonyR = new Float32Array(w.colonies.length);
    for (let i = 0; i < N; i++) {
      const o = w.organisms[i];
      homeX[i] = o.x; homeY[i] = o.y;
      born[i] = o.born;
      dormantAt[i] = o.dormantAt ?? Infinity;
      activeFrom[i] = o.activeFrom ?? Infinity;
      origin[i] = o.origin;
      migrant[i] = o.origin >= 0 && w.organisms[o.origin].colony !== o.colony ? 1 : 0;
      stateCode[i] = STATE_CODE[o.state];
      S2[i * 4] = o.seed;
      S2[i * 4 + 1] = o.angle;
      S2[i * 4 + 2] = w.species[o.species].morph;
      S2[i * 4 + 3] = o.species + clamp((o.born - w.tMin) / (w.tMax - w.tMin || 1), 0, 0.999);
      const p = prevX.get(o.node.id);
      if (p) { fromX[i] = p[0]; fromY[i] = p[1]; fromVis[i] = p[2]; } else { fromX[i] = o.x; fromY[i] = o.y; fromVis[i] = 0; }
    }
    transT = prev ? 0 : 1;
    for (let k = 0; k < 32; k++) speciesColors[k].set(w.species[k % Math.max(1, w.species.length)]?.color ?? "#999999");

    // Textures
    for (const key of ["uS0", "uS1", "uS2"] as const) U[key].value?.dispose();
    const mk = (data: Float32Array) => {
      const t = new THREE.DataTexture(data, TEX_W, texH, THREE.RGBAFormat, THREE.FloatType);
      t.minFilter = t.magFilter = THREE.NearestFilter;
      t.generateMipmaps = false;
      t.needsUpdate = true;
      return t;
    };
    U.uS0.value = mk(S0); U.uS1.value = mk(S1); U.uS2.value = mk(S2);

    // Meshes
    for (const m of [haloMesh, orgMesh, filMesh]) if (m) { scene.remove(m); m.geometry.dispose(); }
    haloMesh = new THREE.Mesh(instanced(quad, N), haloMat);
    haloMesh.frustumCulled = false;
    haloMesh.renderOrder = 2;
    orgMesh = new THREE.Mesh(instanced(quad, N), orgMat);
    orgMesh.frustumCulled = false;
    orgMesh.renderOrder = 5;

    // Filament strips: SEG segments, two sides
    const SEG = 18;
    const base = new THREE.BufferGeometry();
    const pos = new Float32Array((SEG + 1) * 2 * 3);
    const sAttr = new Float32Array((SEG + 1) * 2);
    const sideAttr = new Float32Array((SEG + 1) * 2);
    const idx: number[] = [];
    for (let k = 0; k <= SEG; k++) {
      for (let sd = 0; sd < 2; sd++) {
        const v = k * 2 + sd;
        sAttr[v] = k / SEG;
        sideAttr[v] = sd === 0 ? -1 : 1;
        pos[v * 3] = k / SEG; pos[v * 3 + 1] = sideAttr[v];
      }
      if (k < SEG) { const a = k * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    base.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    base.setAttribute("aS", new THREE.BufferAttribute(sAttr, 1));
    base.setAttribute("aSide", new THREE.BufferAttribute(sideAttr, 1));
    base.setIndex(idx);
    const F = w.filaments.length;
    const fg = new THREE.InstancedBufferGeometry();
    fg.setIndex(base.getIndex());
    for (const name of ["position", "aS", "aSide"]) fg.setAttribute(name, base.getAttribute(name));
    const ends = new Float32Array(Math.max(1, F) * 2);
    const info = new Float32Array(Math.max(1, F) * 4);
    for (let k = 0; k < F; k++) {
      const f = w.filaments[k];
      // the older end first, so a new link grows out from the established cell
      const older = w.organisms[f.a].born <= w.organisms[f.b].born;
      ends[k * 2] = older ? f.a : f.b;
      ends[k * 2 + 1] = older ? f.b : f.a;
      info[k * 4] = f.formed;
      info[k * 4 + 1] = f.cross ? 1 : 0;
      info[k * 4 + 2] = f.weight;
      info[k * 4 + 3] = (Math.sin((f.a * 12.9898 + f.b * 78.233)) * 43758.5453) % 1 * 0.5 + 0.5;
    }
    fg.setAttribute("aEnds", new THREE.InstancedBufferAttribute(ends, 2));
    fg.setAttribute("aInfo", new THREE.InstancedBufferAttribute(info, 4));
    fg.instanceCount = F;
    filBase?.dispose();
    filBase = base;
    filMesh = new THREE.Mesh(fg, filMat);
    filMesh.frustumCulled = false;
    filMesh.renderOrder = 6;
    scene.add(haloMesh, filMesh, orgMesh);

    dishMat.uniforms.uDishR.value = w.dishRadius;
    buildMotes(w.dishRadius);

    // Keep the selection if its record survived
    if (selected !== null) {
      const id = prev?.organisms[selected]?.node.id;
      selected = id ? w.byNodeId.get(id) ?? null : null;
    }
    hovered = -1;
    related = new Set(selected !== null ? w.neighbors[selected] : []);
    hoverRelated = new Set();
    focusDirty = true;

    if (!prev) {
      fitAll(true);
      if (opts.timelapse && N > 0) startTimelapse();
      else { day = w.tMax; playing = false; }
    } else {
      day = clamp(day, w.tMin, w.tMax);
      if (fitted) fitAll();
    }
    notifyPending = true;
  }

  function startTimelapse() {
    if (!world) return;
    day = world.tMin;
    timelapse = { speed: (world.tMax - world.tMin) / TIMELAPSE_SECONDS };
    if (fitted) lookAt(0, 0, fitZoom() * 1.35, true);
    playing = true;
    animK = 1;
    notifyPending = true;
  }

  // ── Per-frame organism state ──
  function updateState(animDays: number, dt: number) {
    if (!world) return;
    const w = world;
    const scale = settings.sizeScale;
    const tr = transT < 1 ? easeInOut(transT) : 1;
    colonyVis.fill(0);
    colonyR.fill(0);
    const anyFocus = selected !== null;
    const hl = highlight ?? (labelColony >= 0 ? { colony: labelColony } : null);
    const hs = hl?.species ?? -1, hc = hl?.colony ?? -1;
    for (let i = 0; i < N; i++) {
      const o = w.organisms[i];
      const j = i * 4;
      let hx = homeX[i], hy = homeY[i];
      let tv = 1;
      if (tr < 1) {
        hx = fromX[i] + (homeX[i] - fromX[i]) * tr;
        hy = fromY[i] + (homeY[i] - fromY[i]) * tr;
        if (fromVis[i] < 0.5) tv = tr;
      }
      if (born[i] > day) {
        S0[j] = hx; S0[j + 1] = hy; S0[j + 2] = 0; S0[j + 3] = 0;
        S1[j] = 0; S1[j + 1] = 0; S1[j + 2] = 0; S1[j + 3] = 1;
        continue;
      }
      const span = animDays * (migrant[i] ? 2.4 : 1);
      const p = span < 1e-3 ? 1 : clamp((day - born[i]) / span, 0, 1);
      let x = hx, y = hy;
      if (p < 1 && origin[i] >= 0 && born[origin[i]] <= day) {
        const k = origin[i];
        const ox = homeX[k], oy = homeY[k];
        const e = easeOutCubic(p);
        const dx = hx - ox, dy = hy - oy;
        const bend = Math.sin(Math.PI * e) * (migrant[i] ? 0.18 : 0.12);
        x = ox + dx * e - dy * bend;
        y = oy + dy * e + dx * bend;
      }
      const deg = degreeAt(o, day);
      let degEff = deg;
      if (deg > 0 && animDays > 1e-3) degEff = deg - 1 + clamp((day - o.linkTimes[deg - 1]) / animDays, 0, 1);
      const r = radiusFor(degEff) * scale * (p < 1 ? 0.25 + 0.75 * easeOutBack(p) : 1);
      S0[j] = x; S0[j + 1] = y; S0[j + 2] = r; S0[j + 3] = clamp(p * 6, 0, 1) * tv;

      const da = dormantAt[i];
      const dorm = day < da ? 0 : animDays < 1e-3 ? 1 : clamp((day - da) / animDays, 0, 1);
      let mood = 0;
      if (stateCode[i] === STATE_CODE.blocked) mood = -(animDays < 1e-3 ? 1 : clamp((day - born[i]) / animDays, 0, 1));
      else if (day >= activeFrom[i] && day < da) mood = animDays < 1e-3 ? 1 : clamp((day - activeFrom[i]) / animDays, 0, 1);
      let focus = 1;
      if (i === selected || i === hovered) focus = 3;
      else if (related.has(i) || hoverRelated.has(i)) focus = 2;
      else if (hl) focus = o.species === hs || o.colony === hc ? 2 : 0;
      else if (anyFocus) focus = 0;
      S1[j] = p; S1[j + 1] = dorm; S1[j + 2] = mood; S1[j + 3] = focus + 4 * Math.min(deg, 255);

      const c = o.colony;
      colonyVis[c]++;
      const cc = w.colonies[c];
      const rr = Math.hypot(homeX[i] - cc.cx, homeY[i] - cc.cy) + r;
      if (rr > colonyR[c]) colonyR[c] = rr;
    }
    if (transT < 1) transT = Math.min(1, transT + dt / 1.4);
    (U.uS0.value as THREE.DataTexture).needsUpdate = true;
    (U.uS1.value as THREE.DataTexture).needsUpdate = true;
    U.uFocusMode.value = anyFocus || hl ? 1 : 0;
    focusDirty = false;
  }

  // ── Picking ──
  function pick(sx: number, sy: number): number {
    if (!world) return -1;
    const [wx, wy] = toWorld(sx, sy);
    const tol = 4 / zoom;
    let best = -1, bestD = Infinity;
    for (let i = 0; i < N; i++) {
      const j = i * 4;
      if (S0[j + 3] < 0.4) continue;
      const r = Math.max(S0[j + 2], 1.5 / zoom);
      const d = Math.hypot(S0[j] - wx, S0[j + 1] - wy) - r;
      if (d < tol && d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  function setHovered(i: number) {
    if (i === hovered) return;
    hovered = i;
    hoverRelated = new Set(i >= 0 && world && selected === null ? world.neighbors[i] : []);
    focusDirty = true;
    renderer.domElement.style.cursor = i >= 0 ? "pointer" : dragging ? "grabbing" : "grab";
  }

  // ── Pointer input ──
  const el = renderer.domElement;
  el.style.cursor = "grab";
  let dragging = false;
  let downX = 0, downY = 0, lastX = 0, lastY = 0, lastT = 0;
  let velX = 0, velY = 0;
  const pointers = new Map<number, { x: number; y: number }>();
  let pinchD = 0;

  function onPointerDown(e: PointerEvent) {
    el.setPointerCapture(e.pointerId);
    const r = el.getBoundingClientRect();
    pointers.set(e.pointerId, { x: e.clientX - r.left, y: e.clientY - r.top });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchD = Math.hypot(a.x - b.x, a.y - b.y);
    }
    downX = lastX = e.clientX - r.left;
    downY = lastY = e.clientY - r.top;
    lastT = performance.now();
    dragging = false;
    velX = velY = 0;
  }
  function onPointerMove(e: PointerEvent) {
    const r = el.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    mouseX = x; mouseY = y;
    if (pointers.has(e.pointerId)) {
      pointers.set(e.pointerId, { x, y });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchD > 0) zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, d / pinchD);
        pinchD = d;
        dragging = true;
        return;
      }
      if (!dragging && Math.hypot(x - downX, y - downY) > 4) { dragging = true; el.style.cursor = "grabbing"; setHovered(-1); }
      if (dragging) {
        const now = performance.now();
        const dx = x - lastX, dy = y - lastY;
        cx -= dx / zoom; cy += dy / zoom;
        tcx = cx; tcy = cy;
        const dtm = Math.max(1, now - lastT);
        velX = (-dx / zoom) / dtm * 1000; velY = (dy / zoom) / dtm * 1000;
        lastX = x; lastY = y; lastT = now;
        fitted = false;
        tooltip.style.opacity = "0";
      }
      return;
    }
    setHovered(pick(x, y));
  }
  function onPointerUp(e: PointerEvent) {
    const wasPinch = pointers.size > 1;
    pointers.delete(e.pointerId);
    if (pointers.size > 0) return;
    pinchD = 0;
    el.style.cursor = hovered >= 0 ? "pointer" : "grab";
    if (dragging || wasPinch) {
      dragging = false;
      if (performance.now() - lastT > 80) velX = velY = 0;
      return;
    }
    const r = el.getBoundingClientRect();
    const i = pick(e.clientX - r.left, e.clientY - r.top);
    cbRef.current.onSelect(i >= 0 ? i : null);
  }
  function zoomAt(sx: number, sy: number, f: number) {
    const [wx, wy] = toWorld(sx, sy);
    zoom = clamp(zoom * f, MIN_ZOOM, MAX_ZOOM);
    cx = wx - (sx - W / 2) / zoom;
    cy = wy + (sy - H / 2) / zoom;
    tcx = cx; tcy = cy; tzoom = zoom;
    fitted = false;
  }
  function onWheel(e: WheelEvent) {
    e.preventDefault();
    const r = el.getBoundingClientRect();
    const k = e.ctrlKey ? 0.012 : 0.0016;
    const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-delta * k));
    velX = velY = 0;
  }
  function onDblClick(e: MouseEvent) {
    const r = el.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    const i = pick(sx, sy);
    if (i >= 0) { api.focusOrganism(i); return; }
    const [wx, wy] = toWorld(sx, sy);
    const z = clamp(tzoom * 2.2, MIN_ZOOM, MAX_ZOOM);
    tzoom = z;
    tcx = wx - (sx - W / 2) / z;
    tcy = wy + (sy - H / 2) / z;
    fitted = false;
  }
  function onLeave() { setHovered(-1); mouseX = mouseY = -1; }
  el.addEventListener("pointerdown", onPointerDown);
  el.addEventListener("pointermove", onPointerMove);
  el.addEventListener("pointerup", onPointerUp);
  el.addEventListener("pointercancel", onPointerUp);
  el.addEventListener("pointerleave", onLeave);
  el.addEventListener("wheel", onWheel, { passive: false });
  el.addEventListener("dblclick", onDblClick);
  // Colony names are clickable; everything else on the overlay lets the canvas through
  const colonyOf = (e: Event) => {
    const t = (e.target as HTMLElement).closest?.("[data-colony]") as HTMLElement | null;
    return t ? Number(t.dataset.colony) : -1;
  };
  function onOverlayClick(e: MouseEvent) {
    const c = colonyOf(e);
    if (c >= 0) api.focusColony(c);
  }
  function onOverlayOver(e: MouseEvent) {
    const c = colonyOf(e);
    if (c !== labelColony) { labelColony = c; focusDirty = true; }
  }
  overlay.addEventListener("click", onOverlayClick);
  overlay.addEventListener("mouseover", onOverlayOver);
  overlay.addEventListener("mouseout", onOverlayOver);
  overlay.addEventListener("wheel", onWheel, { passive: false });

  // ── Labels ──
  type Rect = { x0: number; y0: number; x1: number; y1: number };
  const placed: Rect[] = [];
  const hits = (r: Rect) => placed.some((p) => r.x0 < p.x1 && r.x1 > p.x0 && r.y0 < p.y1 && r.y1 > p.y0);
  let labelFrame = 0;

  function updateLabels() {
    let used = 0;
    placed.length = 0;
    const show = (key: string, title: string, sub: string, x: number, y: number, kind: "colony" | "cell" | "focus", opacity: number) => {
      const l = labelAt(used++);
      if (l.key !== key) {
        l.key = key;
        l.title.textContent = title;
        l.sub.textContent = sub;
        l.el.style.pointerEvents = kind === "colony" ? "auto" : "none";
        l.el.style.cursor = kind === "colony" ? "pointer" : "";
        if (kind === "colony") l.el.dataset.colony = key.slice(1); else delete l.el.dataset.colony;
        if (kind === "colony") {
          l.title.style.cssText = "font-family:'Lora',Georgia,serif;font-size:13px;font-weight:600;color:var(--text-primary);text-shadow:0 1px 3px var(--bg-base),0 0 10px var(--bg-base);";
          l.sub.style.cssText = "font-family:'DM Mono',monospace;font-size:9.5px;color:var(--text-muted);text-shadow:0 1px 3px var(--bg-base);";
        } else {
          l.title.style.cssText = `font-family:'Geist',sans-serif;font-size:${kind === "focus" ? 12 : 10.5}px;font-weight:${kind === "focus" ? 600 : 500};color:var(--text-primary);text-shadow:0 1px 2px var(--bg-base),0 0 8px var(--bg-base);`;
          l.sub.style.cssText = "font-family:'DM Mono',monospace;font-size:9px;color:var(--text-muted);text-shadow:0 1px 2px var(--bg-base);";
        }
      }
      l.el.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
      l.el.style.opacity = String(opacity);
      l.el.style.display = "flex";
    };
    if (world && settings.labels !== false) {
      const w = world;
      const vx0 = insets.left - 40, vx1 = W - insets.right + 40, vy0 = insets.top - 20, vy1 = H - insets.bottom + 20;
      // Selected cell first (above its reticle), then its most-linked neighbours
      if (selected !== null && S0[selected * 4 + 3] > 0.3) {
        const [sx, sy] = toScreen(S0[selected * 4], S0[selected * 4 + 1]);
        if (sx > vx0 && sx < vx1 && sy > vy0 && sy < vy1) {
          const rp = Math.max(13, S0[selected * 4 + 2] * zoom * 1.45);
          const name = organismName(w.organisms[selected].node);
          const title = name.length > 40 ? name.slice(0, 39) + "…" : name;
          const wpx = title.length * 6.6 + 8;
          const x = sx - wpx / 2, y = sy - rp - 24;
          placed.push({ x0: x, y0: y, x1: x + wpx, y1: y + 16 });
          placed.push({ x0: sx - rp, y0: sy - rp, x1: sx + rp, y1: sy + rp });
          show(`f${selected}`, title, "", x, y, "focus", 1);
        }
        const rel = [...related].filter((i) => S0[i * 4 + 3] > 0.3).sort((a, b) => w.organisms[b].degree - w.organisms[a].degree);
        let n = 0;
        for (const i of rel) {
          if (n >= 14) break;
          const [sx, sy] = toScreen(S0[i * 4], S0[i * 4 + 1]);
          if (sx < vx0 || sx > vx1 || sy < vy0 || sy > vy1) continue;
          const rp = S0[i * 4 + 2] * zoom;
          const name = organismName(w.organisms[i].node);
          const title = name.length > 30 ? name.slice(0, 29) + "…" : name;
          const wpx = title.length * 5.9 + 8;
          const x = sx - wpx / 2, y = sy + Math.max(rp, 4) + 5;
          const rect = { x0: x, y0: y, x1: x + wpx, y1: y + 15 };
          if (hits(rect)) continue;
          placed.push(rect);
          show(`f${i}`, title, "", x, y, "cell", 1);
          n++;
        }
      }
      // Colony names while the colony reads as a shape
      const order = w.colonies.map((c) => c.index).sort((a, b) => colonyVis[b] - colonyVis[a]);
      for (const c of order) {
        const n = colonyVis[c];
        if (n < 6) continue;
        const col = w.colonies[c];
        const R = colonyR[c] * zoom;
        if (R < 24 || R > 900) continue;
        const [sx, sy] = toScreen(col.cx, col.cy);
        if (sx < vx0 || sx > vx1 || sy + R < vy0 || sy - R > vy1) continue;
        const name = col.name.length > 30 ? col.name.slice(0, 29) + "…" : col.name;
        const sub = `${n.toLocaleString()}`;
        const wpx = name.length * 7.1 + sub.length * 6 + 12;
        const x = sx - wpx / 2, y = sy - R - 22;
        const rect = { x0: x, y0: y, x1: x + wpx, y1: y + 18 };
        if (hits(rect)) continue;
        placed.push(rect);
        const op = clamp((R - 24) / 30, 0, 1) * clamp((900 - R) / 200, 0, 1) * (selected !== null && w.organisms[selected]?.colony !== c ? 0.45 : 1);
        show(`c${c}`, name, sub, x, y, "colony", op);
      }
      // Individual cells once they're big enough to read
      if (zoom >= 5.5) {
        const cand: Array<[number, number]> = [];
        for (let i = 0; i < N; i++) {
          const j = i * 4;
          if (S0[j + 3] < 0.6) continue;
          const rp = S0[j + 2] * zoom;
          if (rp < 9) continue;
          const [sx, sy] = toScreen(S0[j], S0[j + 1]);
          if (sx < vx0 || sx > vx1 || sy < vy0 || sy > vy1) continue;
          cand.push([i, rp + w.organisms[i].degree * 0.6]);
        }
        cand.sort((a, b) => b[1] - a[1]);
        let n = 0;
        for (const [i] of cand) {
          if (n >= 45) break;
          if (i === selected || related.has(i)) continue;
          const [sx, sy] = toScreen(S0[i * 4], S0[i * 4 + 1]);
          const rp = S0[i * 4 + 2] * zoom;
          const name = organismName(w.organisms[i].node);
          const title = name.length > 28 ? name.slice(0, 27) + "…" : name;
          const wpx = title.length * 5.9 + 6;
          const x = sx - wpx / 2, y = sy + rp * 1.15 + 3;
          const rect = { x0: x, y0: y, x1: x + wpx, y1: y + 14 };
          if (hits(rect)) continue;
          placed.push(rect);
          show(`o${i}`, title, "", x, y, "cell", clamp((rp - 9) / 6, 0.35, 0.92) * (selected !== null ? 0.5 : 1));
          n++;
        }
      }
    }
    for (let k = used; k < labelPool.length; k++) {
      const l = labelPool[k];
      if (l.el.style.display !== "none") l.el.style.display = "none";
    }
  }

  function updateReticleAndTooltip() {
    // Reticle on the selected cell
    if (world && selected !== null && S0[selected * 4 + 3] > 0.2) {
      const [sx, sy] = toScreen(S0[selected * 4], S0[selected * 4 + 1]);
      const d = Math.max(26, S0[selected * 4 + 2] * zoom * 2.9);
      reticle.style.width = reticle.style.height = `${d}px`;
      reticle.style.transform = `translate3d(${sx - d / 2}px, ${sy - d / 2}px, 0)`;
      reticle.style.opacity = "1";
    } else reticle.style.opacity = "0";

    // Hover tooltip
    if (world && hovered >= 0 && !dragging && mouseX >= 0) {
      const o = world.organisms[hovered];
      const sp = world.species[o.species];
      const dot = /^#[0-9a-f]{3,8}$/i.test(sp.color) ? sp.color : "#999999";
      const col = world.colonies[o.colony];
      const key = `${hovered}:${Math.floor(day)}`;
      if (tooltip.dataset.key !== key) {
        tooltip.dataset.key = key;
        const deg = degreeAt(o, day);
        let state = "Open";
        let stateCol = "var(--text-muted)";
        if (o.dormantAt !== null && day >= o.dormantAt) { state = o.dormantKnown ? `Dormant · done ${formatDay(o.dormantAt, false)}` : "Dormant · done"; stateCol = "var(--text-faint)"; }
        else if (o.state === "blocked") { state = `Blocked${o.status ? ` · ${o.status}` : ""}`; stateCol = "#c9a227"; }
        else if (o.activeFrom !== null && day >= o.activeFrom) { state = `Active${o.status ? ` · ${o.status}` : ""}`; stateCol = "#3fb771"; }
        else if (o.status) state = o.status;
        const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);
        tooltip.innerHTML =
          `<div style="display:flex;align-items:center;gap:6px;margin-bottom:3px"><span style="width:7px;height:7px;border-radius:50%;background:${dot};flex-shrink:0"></span>` +
          `<span style="font-family:'DM Mono',monospace;font-size:9.5px;letter-spacing:0.06em;text-transform:uppercase;color:var(--text-muted)">${esc(sp.name)}</span></div>` +
          `<div style="font-family:'Geist',sans-serif;font-size:12.5px;font-weight:600;color:var(--text-primary);line-height:1.3">${esc(organismName(o.node))}</div>` +
          `<div style="margin-top:4px;font-family:'DM Mono',monospace;font-size:10px;color:var(--text-muted)">born ${formatDay(o.born, false)} · ${deg} link${deg === 1 ? "" : "s"}</div>` +
          `<div style="margin-top:2px;font-family:'Geist',sans-serif;font-size:11px;color:${stateCol}">${esc(state)}</div>` +
          (col.members.length > 1 ? `<div style="margin-top:2px;font-family:'Geist',sans-serif;font-size:10.5px;color:var(--text-faint)">in ${esc(col.name)}</div>` : "");
      }
      const tw = tooltip.offsetWidth || 200, th = tooltip.offsetHeight || 70;
      let tx = mouseX + 16, ty = mouseY + 14;
      if (tx + tw > W - insets.right - 8) tx = mouseX - tw - 14;
      if (ty + th > H - insets.bottom - 4) ty = mouseY - th - 12;
      tooltip.style.transform = `translate3d(${Math.round(tx)}px, ${Math.round(ty)}px, 0)`;
      tooltip.style.opacity = "1";
    } else tooltip.style.opacity = "0";
  }

  // ── Frame loop ──
  let raf = 0;
  let last = performance.now();
  const t0 = last;

  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    U.uTime.value = (now - t0) / 1000;
    lens.uniforms.uTime.value = U.uTime.value;

    // Time
    let moved = false;
    if (world) {
      const sp = timelapse ? timelapse.speed : speed;
      if (playing) {
        day += dt * sp;
        animK = Math.min(1, animK + dt * 4);
        moved = true;
        if (day >= world.tMax) {
          day = world.tMax;
          playing = false;
          timelapse = null;
          notifyPending = true;
        }
      } else if (animK > 0) {
        animK = Math.max(0, animK - dt / 0.7);
        moved = true;
      }
      const animDays = Math.min((timelapse ? timelapse.speed : speed) * ANIM_SECONDS, 60) * animK;
      filUniforms.uDay.value = day;
      filUniforms.uAnimDays.value = animDays;
      if (moved || focusDirty || transT < 1) updateState(animDays, dt);
      if ((moved && now - lastNotify > 100) || notifyPending) {
        lastNotify = now;
        notifyPending = false;
        cbRef.current.onTime(day, playing);
      }
    }

    // Time-lapse pull-back, as long as nobody has moved the camera
    if (timelapse && fitted && world) {
      const prog = clamp((day - world.tMin) / (world.tMax - world.tMin || 1), 0, 1);
      lookAt(0, 0, fitZoom() * (1.35 - 0.35 * easeInOut(prog)));
    }

    // Camera: inertia, then ease toward target
    if (!dragging && (Math.abs(velX) > 0.01 || Math.abs(velY) > 0.01)) {
      cx += velX * dt; cy += velY * dt; tcx = cx; tcy = cy;
      const decay = Math.exp(-dt * 5);
      velX *= decay; velY *= decay;
    }
    const k = 1 - Math.exp(-dt * 7);
    cx += (tcx - cx) * k;
    cy += (tcy - cy) * k;
    zoom = Math.exp(Math.log(zoom) + (Math.log(tzoom) - Math.log(zoom)) * k);
    if (world) {
      const lim = world.dishRadius * 1.15;
      const d = Math.hypot(cx, cy);
      if (d > lim) { cx *= lim / d; cy *= lim / d; tcx = cx; tcy = cy; }
    }
    camera.left = cx - W / 2 / zoom;
    camera.right = cx + W / 2 / zoom;
    camera.top = cy + H / 2 / zoom;
    camera.bottom = cy - H / 2 / zoom;
    camera.updateProjectionMatrix();
    U.uPx.value = zoom;
    dishMat.uniforms.uCenter.value.set(cx, cy);
    moteUniforms.uCenter.value.set(cx, cy);

    if ((labelFrame++ & 1) === 0) updateLabels();
    updateReticleAndTooltip();
    composer.render();
  }
  raf = requestAnimationFrame(frame);

  // ── Resize ──
  function resize() {
    W = Math.max(1, mount.clientWidth);
    H = Math.max(1, mount.clientHeight);
    renderer.setSize(W, H);
    composer.setSize(W, H);
    bloom.resolution.set(W, H);
    lens.uniforms.uRes.value.set(W * dpr, H * dpr);
    dishMat.uniforms.uView.value.set(W, H);
    if (fitted) fitAll(true);
  }
  const ro = new ResizeObserver(resize);
  ro.observe(mount);

  // ── API ──
  const api: CultureApi = {
    play() {
      if (!world) return;
      timelapse = null;
      if (day >= world.tMax - 0.01) day = world.tMin;
      playing = true;
      notifyPending = true;
    },
    pause() { playing = false; timelapse = null; notifyPending = true; },
    toggle() { if (playing) api.pause(); else api.play(); },
    seek(d, animate = false) {
      if (!world) return;
      day = clamp(d, world.tMin, world.tMax);
      timelapse = null;
      animK = animate ? 1 : 0;
      focusDirty = true;
      notifyPending = true;
    },
    step(days) {
      if (!world) return;
      api.pause();
      api.seek(day + days, days > 0);
    },
    getDay: () => day,
    isPlaying: () => playing,
    timelapse() { startTimelapse(); },
    focusOrganism(i) {
      if (!world || i < 0 || i >= N) return;
      const r = Math.max(S0[i * 4 + 2], world.organisms[i].r * settings.sizeScale);
      fitted = false;
      lookAt(homeX[i], homeY[i], clamp(26 / r, Math.max(zoom, 5), 30));
    },
    focusColony(c) {
      if (!world) return;
      const col = world.colonies[c];
      if (!col) return;
      const fw = Math.max(120, W - insets.left - insets.right), fh = Math.max(120, H - insets.top - insets.bottom);
      fitted = false;
      lookAt(col.cx, col.cy, clamp((Math.min(fw, fh) * 0.36) / Math.max(colonyR[c] || col.radius, 6), MIN_ZOOM, 30));
    },
    fitAll() { fitAll(); },
    zoomBy(f) {
      const [fx, fy] = freeCentre();
      const [wx, wy] = toWorld(fx, fy);
      fitted = false;
      lookAt(wx, wy, tzoom * f);
    },
  };

  return {
    api,
    setWorld,
    setTheme(d) {
      const t = d ? THEMES.dark : THEMES.light;
      U.uDark.value = d ? 1 : 0;
      lens.uniforms.uDark.value = d ? 1 : 0;
      dishMat.uniforms.uAgarA.value.copy(t.agarA);
      dishMat.uniforms.uAgarB.value.copy(t.agarB);
      dishMat.uniforms.uOutside.value.copy(t.outside);
      dishMat.uniforms.uRimCol.value.copy(t.rim);
      bloom.enabled = d;
      haloMat.blendEquation = d ? THREE.MaxEquation : THREE.MinEquation;
      renderer.toneMapping = d ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
      moteUniforms.uMoteA.value = d ? 1 : 0.8;
    },
    setSelection(i) {
      if (i === selected) return;
      selected = i;
      related = new Set(i !== null && world ? world.neighbors[i] : []);
      hoverRelated = new Set();
      focusDirty = true;
    },
    setHighlight(h) {
      if (!h && !highlight) return;
      if (h && highlight && h.species === highlight.species && h.colony === highlight.colony) return;
      highlight = h;
      focusDirty = true;
    },
    setSettings(s) {
      const sizeChanged = s.sizeScale !== settings.sizeScale;
      settings = s;
      U.uStain.value = s.stain === "amber" ? 1 : s.stain === "age" ? 2 : 0;
      filUniforms.uOnlyFocus.value = s.filaments ? 0 : 1;
      if (sizeChanged) focusDirty = true;
    },
    setInsets(i) {
      const changed = i.left !== insets.left || i.right !== insets.right || i.top !== insets.top || i.bottom !== insets.bottom;
      insets = i;
      if (changed && fitted) fitAll();
    },
    setSpeed(s) { speed = s; },
    dispose() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("pointercancel", onPointerUp);
      el.removeEventListener("pointerleave", onLeave);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("dblclick", onDblClick);
      overlay.removeEventListener("click", onOverlayClick);
      overlay.removeEventListener("mouseover", onOverlayOver);
      overlay.removeEventListener("mouseout", onOverlayOver);
      overlay.removeEventListener("wheel", onWheel);
      for (const m of [haloMesh, orgMesh, filMesh]) m?.geometry.dispose();
      for (const m of [motesBack, motesFront]) m?.geometry.dispose();
      for (const key of ["uS0", "uS1", "uS2"] as const) U[key].value?.dispose();
      for (const mat of [dishMat, moteMat, haloMat, orgMat, filMat]) mat.dispose();
      filBase?.dispose();
      quad.dispose();
      dish.geometry.dispose();
      composer.dispose();
      renderer.dispose();
      overlay.remove();
      renderer.domElement.remove();
    },
  };
}
