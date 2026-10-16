"use client";

import { useEffect, useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

import {
  buildTicks,
  describeWhen,
  dayToDate,
  stackPoints,
  tickLevel,
  TRACK_DEPTH,
  displayName,
  personWindow,
  type LaneLayout,
  type LineModel,
  type TickLevel,
} from "@/lib/lineModel";

// ─── Public API ───────────────────────────────────────────────────────────────

export type LineView = { t0: number; t1: number; center: number; pxPerDay: number };

export type LineEngineApi = {
  /** Fly to a person's lane; `fit` also frames their whole activity range. */
  focusPerson: (person: number, fit?: boolean) => void;
  focusEvent: (event: number) => void;
  goToday: () => void;
  fitAll: () => void;
  zoomBy: (factor: number) => void;
  /** Move the view (overview strip). `pxPerDay` omitted keeps the zoom. */
  setView: (center: number, pxPerDay?: number, animate?: boolean) => void;
  getView: () => LineView;
  /** Step the lane camera by ±1 lane. */
  stepLane: (dir: 1 | -1) => void;
};

type Props = {
  model: LineModel;
  lanes: LaneLayout;
  darkMode: boolean;
  selectedEvent: number | null;
  relatedEvents: number[];
  /** Person whose lane is isolated (others dimmed), or null. */
  isolatePerson: number | null;
  /** Screen space covered by side panels — the view centres on what's left. */
  leftInset: number;
  rightInset: number;
  apiRef: MutableRefObject<LineEngineApi | null>;
  onSelect: (event: number | null) => void;
  /** Lane nearest the camera target changed. */
  onFocusLane: (person: number) => void;
  /** Lane header clicked. */
  onPickPerson: (person: number) => void;
  /** Coarse view label changed, e.g. "Aug – Nov 2026". */
  onViewLabel: (label: string, level: TickLevel) => void;
};

type Cb = Pick<Props, "onSelect" | "onFocusLane" | "onPickPerson" | "onViewLabel">;

// ─── Constants ────────────────────────────────────────────────────────────────

const FOV = 32;
const TAN_HALF = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
const TARGET_Y = 2.2;
/** The camera looks this far behind the focused lane, so the focused lane sits in the lower half. */
const LOOK_AHEAD = 0.13;
const TRACK_BASE = 1.05;     // first span track sits this far behind the lane line
const SPAN_HALF = 0.34;      // half thickness of a span bar (world Z)
const MAX_STACK = 7;        // taller columns compress
const THREAD_SEG = 16;
const ARC_SEG = 28;
const LABEL_POOL = 40;
const HEADER_POOL = 48;
const TICK_POOL = 96;
const RULER_Y = 70;

type Palette = {
  bgTop: string; bgHorizon: string; floor: string; future: string; ink: string; grid: string;
  laneAlpha: number; dark: boolean;
};
const DARK: Palette = { bgTop: "#05060b", bgHorizon: "#0c0f1c", floor: "#0e1120", future: "#121a33", ink: "#ffffff", grid: "#8fa0c8", laneAlpha: 1, dark: true };
const LIGHT: Palette = { bgTop: "#f7f3ed", bgHorizon: "#ede6da", floor: "#eee7dc", future: "#e6e3e6", ink: "#2d2520", grid: "#8b7868", laneAlpha: 1, dark: false };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

export function personColor(hue: number, dark = true): string {
  return `hsl(${hue}, ${dark ? 62 : 48}%, ${dark ? 62 : 46}%)`;
}

const STATE_INDEX = { open: 0, active: 1, done: 2, blocked: 3 } as const;

// ─── Shaders ──────────────────────────────────────────────────────────────────

const COMMON = /* glsl */ `
  uniform sampler2D uLanes;
  uniform float uCenter;
  uniform float uScale;
  uniform float uReveal;
  uniform float uRevealSoft;
  uniform float uFogNear;
  uniform float uFogFar;
  uniform float uSel;
  uniform float uHover;
  uniform float uIsolate;
  uniform float uFocusLane;
  vec4 laneOf(float p) { return texelFetch(uLanes, ivec2(int(p + 0.5), 0), 0); }
  float tx(float t) { return (t - uCenter) * uScale; }
  float fogOf(float depth) { return 1.0 - smoothstep(uFogNear, uFogFar, depth); }
  float revealOf(float t) { return clamp((uReveal - t) / uRevealSoft, 0.0, 1.0); }
  float isoOf(float p) { return (uIsolate < -0.5 || abs(p - uIsolate) < 0.5) ? 1.0 : 0.16; }
  float bit(float flags, float b) { return mod(floor(flags / b), 2.0); }
`;

const BG_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.9999, 1.0); }
`;
const BG_FRAG = /* glsl */ `
  uniform vec3 uTop;
  uniform vec3 uHorizon;
  uniform float uHorizonY;
  varying vec2 vUv;
  void main() {
    float t = smoothstep(uHorizonY - 0.55, uHorizonY + 0.1, vUv.y);
    vec3 c = mix(uHorizon, uTop, t);
    gl_FragColor = vec4(c, 1.0);
    #include <colorspace_fragment>
  }
`;

// Ground: past/future tint + fog
const FLOOR_VERT = /* glsl */ `
  ${COMMON}
  varying float vX;
  varying float vFog;
  varying float vZ;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vX = position.x;
    vZ = position.z;
    vFog = fogOf(-mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;
const FLOOR_FRAG = /* glsl */ `
  ${COMMON}
  uniform vec3 uFloor;
  uniform vec3 uFuture;
  uniform float uToday;
  uniform float uAlpha;
  varying float vX;
  varying float vFog;
  varying float vZ;
  void main() {
    float t = uCenter + vX / uScale;
    float fut = smoothstep(uToday, uToday + 0.5, t);
    vec3 c = mix(uFloor, uFuture, fut);
    gl_FragColor = vec4(c, uAlpha * vFog);
    #include <colorspace_fragment>
  }
`;

const GRID_VERT = /* glsl */ `
  ${COMMON}
  attribute float aT;
  attribute float aMajor;
  varying float vA;
  void main() {
    vec3 p = vec3(tx(aT), 0.0, position.z);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vA = mix(0.07, 0.17, aMajor) * fogOf(-mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;
const GRID_FRAG = /* glsl */ `
  uniform vec3 uColor;
  varying float vA;
  void main() {
    gl_FragColor = vec4(uColor, vA);
    #include <colorspace_fragment>
  }
`;

// Lane lines (one instanced quad per person, spanning the whole view)
const LANE_VERT = /* glsl */ `
  ${COMMON}
  attribute float aPerson;
  attribute vec2 aRange;
  attribute vec3 aColor;
  uniform float uHalfW;
  varying float vX;
  varying float vLz;
  varying vec2 vRange;
  varying vec3 vColor;
  varying float vFog;
  varying float vDim;
  varying float vEmph;
  void main() {
    vec4 L = laneOf(aPerson);
    vec3 p = vec3(position.x * uHalfW, 0.01, L.x + position.y * 0.55);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vX = p.x;
    vLz = position.y * 0.55;
    vRange = aRange;
    vColor = aColor;
    vFog = fogOf(-mv.z);
    vDim = L.y * isoOf(aPerson);
    vEmph = L.w;
    gl_Position = projectionMatrix * mv;
  }
`;
const LANE_FRAG = /* glsl */ `
  ${COMMON}
  uniform float uDark;
  varying float vX;
  varying float vLz;
  varying vec2 vRange;
  varying vec3 vColor;
  varying float vFog;
  varying float vDim;
  varying float vEmph;
  void main() {
    float t = uCenter + vX / uScale;
    float aa = fwidth(t) * 1.5;
    float inRange = smoothstep(vRange.x - aa, vRange.x + aa, t) * (1.0 - smoothstep(vRange.y - aa, vRange.y + aa, t));
    float shown = revealOf(t);
    float d = abs(vLz);
    float px = fwidth(vLz);
    float core = 1.0 - smoothstep(px * (0.7 + 0.8 * vEmph), px * (1.7 + 0.8 * vEmph), d);
    float glow = exp(-d * 14.0) * (0.16 + 0.22 * vEmph) * uDark;
    float a = (core * mix(0.16, 0.95, inRange) + glow * inRange) * vFog * vDim * mix(1.0, shown, 0.85);
    if (a < 0.003) discard;
    gl_FragColor = vec4(mix(vColor, vec3(1.0), 0.15 * vEmph * uDark), a);
    #include <colorspace_fragment>
  }
`;

// Spans: capsules painted on the ground in front of the lane
const SPAN_VERT = /* glsl */ `
  ${COMMON}
  attribute vec2 aT;
  attribute float aTrack;
  attribute float aPerson;
  attribute float aEvent;
  attribute float aState;
  attribute float aFlags;
  attribute float aRel;
  attribute vec3 aColor;
  uniform float uTrackBase;
  uniform float uTrackDepth;
  uniform float uHalf;
  uniform float uMinW;
  varying vec2 vLocal;
  varying vec2 vWH;
  varying float vT0;
  varying vec3 vColor;
  varying float vState;
  varying float vFlags;
  varying float vAlpha;
  varying float vEmph;
  varying float vRel;
  void main() {
    vec4 L = laneOf(aPerson);
    float t1 = min(aT.y, max(aT.x, uReveal));
    float x0 = tx(aT.x);
    float w = max(tx(t1) - x0, uMinW);
    float sel = step(abs(aEvent - uSel), 0.5);
    float hov = step(abs(aEvent - uHover), 0.5);
    float h = uHalf * (1.0 + 0.3 * sel + 0.15 * hov);
    float pad = h * 0.9;
    float lx = mix(-pad, w + pad, position.x);
    float lz = position.y * (h + pad);
    float z = L.x - uTrackBase - aTrack * uTrackDepth;
    vec4 mv = modelViewMatrix * vec4(x0 + lx, 0.03, z + lz, 1.0);
    vLocal = vec2(lx, lz);
    vWH = vec2(w, h);
    vT0 = aT.x;
    vColor = aColor;
    vState = aState;
    vFlags = aFlags;
    vEmph = max(sel, hov * 0.6);
    vRel = aRel;
    float laneW = uIsolate < -0.5 ? mix(0.42, 1.0, step(0.25, L.w)) : 1.0;
    vAlpha = fogOf(-mv.z) * L.y * max(isoOf(aPerson) * laneW, max(sel, aRel)) * step(aT.x, uReveal);
    gl_Position = projectionMatrix * mv;
  }
`;
const SPAN_FRAG = /* glsl */ `
  ${COMMON}
  uniform float uTime;
  uniform float uToday;
  uniform float uDark;
  uniform vec3 uInk;
  uniform vec3 uAlert;
  varying vec2 vLocal;
  varying vec2 vWH;
  varying float vT0;
  varying vec3 vColor;
  varying float vState;
  varying float vFlags;
  varying float vAlpha;
  varying float vEmph;
  varying float vRel;
  void main() {
    float w = vWH.x, h = vWH.y;
    float r = min(h, w * 0.5);
    float cx = clamp(vLocal.x, r, max(r, w - r));
    float d = length(vec2(vLocal.x - cx, vLocal.y)) - r;
    float aa = fwidth(d) * 1.2;
    float fill = 1.0 - smoothstep(-aa, aa, d);
    float bw = h * 0.34;
    float border = fill * smoothstep(-bw - aa, -bw + aa, d);
    float t = vT0 + vLocal.x / uScale;
    float past = 1.0 - smoothstep(uToday - 0.5, uToday + 0.5, t);
    vec3 c = vColor;
    float a;
    if (vState < 0.5) {            // open
      a = max(border * 0.75, fill * mix(0.1, 0.2, past));
    } else if (vState < 1.5) {     // active: elapsed part solid, future part ghosted, sheen
      float sheen = pow(max(0.0, sin((vLocal.x * 0.35 - uTime * 2.2))), 24.0) * past;
      a = max(border, fill * mix(0.3, 0.85, past));
      c = mix(c, vec3(1.0), sheen * 0.5 * uDark);
    } else if (vState < 2.5) {     // done: quiet
      a = fill * 0.4;
      c *= mix(1.0, 0.8, uDark);
    } else {                       // blocked: hatched
      float hatch = step(0.5, fract((vLocal.x + vLocal.y) * 1.3));
      a = max(border, fill * (0.16 + 0.3 * hatch));
      c = mix(c, uAlert, border * 0.85);
    }
    if (bit(vFlags, 4.0) > 0.5) a *= mix(1.0, 0.25, smoothstep(w * 0.55, w, vLocal.x));   // ongoing → fade out
    if (bit(vFlags, 2.0) > 0.5) {                                                       // overdue → red tail
      float tail = smoothstep(w - h * 3.0, w, vLocal.x) * border;
      c = mix(c, uAlert, tail);
    }
    // Selection / hover outline & glow outside the capsule
    float outline = (1.0 - smoothstep(0.0, h * 0.35 + aa, abs(d - h * 0.28))) * vEmph;
    float relGlow = (1.0 - smoothstep(0.0, h * 0.5, max(d, 0.0))) * vRel * (1.0 - fill) * 0.6;
    c = mix(c, uInk, outline * 0.9);
    a = max(a, max(outline, relGlow));
    a *= vAlpha;
    if (a < 0.003) discard;
    gl_FragColor = vec4(c, a);
    #include <colorspace_fragment>
  }
`;

// Point records: billboards stacked into columns above the lane
const BEAD_VERT = /* glsl */ `
  ${COMMON}
  attribute vec3 aFrom;
  attribute vec3 aTo;
  attribute float aPerson;
  attribute float aEvent;
  attribute float aState;
  attribute float aFlags;
  attribute float aRel;
  attribute vec3 aColor;
  uniform float uMorph;
  uniform float uRadius;
  uniform float uStep;
  uniform float uMaxStack;
  uniform float uPxPerUnit;
  uniform float uDark;
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vState;
  varying float vFlags;
  varying float vAlpha;
  varying float vEmph;
  varying float vRel;
  varying float vSeed;
  void main() {
    vec3 s = mix(aFrom, aTo, uMorph);
    vec4 L = laneOf(aPerson);
    float comp = min(1.0, uMaxStack / max(s.z, 1.0));
    float r = uRadius * mix(1.0, comp, 0.45);
    vec4 mv = modelViewMatrix * vec4(tx(s.x), uRadius * 1.3, L.x, 1.0);
    mv.y += s.y * uStep * comp;
    float depth = -mv.z;
    float sel = step(abs(aEvent - uSel), 0.5);
    float hov = step(abs(aEvent - uHover), 0.5);
    r *= 1.0 + 0.5 * sel + 0.3 * hov + 0.2 * aRel;
    if (bit(aFlags, 1.0) > 0.5) r *= 0.82;            // created-time placement
    float px = r * uPxPerUnit / depth;
    r *= max(1.0, 1.8 / max(px, 1e-3));
    float ext = 1.9;
    mv.xy += position.xy * r * ext;
    vUv = position.xy * ext;
    vColor = aColor;
    vState = aState;
    vFlags = aFlags;
    vEmph = max(sel, hov * 0.65);
    vRel = aRel;
    vSeed = fract(aEvent * 0.61803);
    float laneW = uIsolate < -0.5 ? mix(0.7, 1.0, step(0.25, L.w)) : 1.0;
    vAlpha = fogOf(depth) * L.y * max(isoOf(aPerson) * laneW, max(sel, aRel)) * revealOf(s.x);
    gl_Position = projectionMatrix * mv;
  }
`;
const BEAD_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uDark;
  uniform vec3 uInk;
  uniform vec3 uAlert;
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vState;
  varying float vFlags;
  varying float vAlpha;
  varying float vEmph;
  varying float vRel;
  varying float vSeed;
  float bit(float flags, float b) { return mod(floor(flags / b), 2.0); }
  void main() {
    float d = length(vUv);
    float aa = fwidth(d) * 1.2;
    float core = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, d);
    float ring = core * smoothstep(0.62 - aa, 0.62 + aa, d);
    vec3 c = vColor;
    float a;
    if (vState < 0.5) {
      a = max(ring, core * 0.3);
    } else if (vState < 1.5) {
      a = core;
      c = mix(c, vec3(1.0), (1.0 - smoothstep(0.0, 0.6, d)) * 0.5 * uDark);
      float pr = fract(uTime * 0.55 + vSeed);
      float pulse = (1.0 - smoothstep(0.0, 0.07 + aa, abs(d - (1.05 + pr * 0.7)))) * (1.0 - pr);
      a = max(a, pulse * 0.65);
    } else if (vState < 2.5) {
      a = core * 0.95;
    } else {
      a = max(ring, core * 0.4);
      c = mix(c, uAlert, ring);
    }
    if (bit(vFlags, 1.0) > 0.5) a *= 0.6;
    if (bit(vFlags, 2.0) > 0.5) {
      float halo = (1.0 - smoothstep(0.0, 0.1 + aa, abs(d - 1.3))) * (0.55 + 0.45 * sin(uTime * 3.0 + vSeed * 6.28));
      c = mix(c, uAlert, halo * (1.0 - core));
      a = max(a, halo * 0.8);
    }
    float glow = exp(-d * d * 1.6) * 0.32 * uDark * (1.0 - core);
    a = max(a, glow);
    float sel = (1.0 - smoothstep(0.0, 0.09 + aa, abs(d - 1.45))) * vEmph;
    float rel = (1.0 - smoothstep(0.0, 0.08 + aa, abs(d - 1.35))) * vRel * 0.7;
    c = mix(c, uInk, max(sel, rel * (1.0 - core)));
    a = max(a, max(sel, rel));
    a *= vAlpha;
    if (a < 0.004) discard;
    gl_FragColor = vec4(c, a);
    #include <colorspace_fragment>
  }
`;

// Collaboration threads between lanes of a shared record
const THREAD_VERT = /* glsl */ `
  ${COMMON}
  attribute float aT;
  attribute float aPA;
  attribute float aPB;
  attribute float aU;
  attribute float aEvent;
  varying float vA;
  varying float vU;
  void main() {
    float zA = laneOf(aPA).x, zB = laneOf(aPB).x;
    float z = mix(zA, zB, aU);
    float y = sin(3.14159265 * aU) * min(abs(zA - zB) * 0.22, 7.0) + 0.05;
    vec4 mv = modelViewMatrix * vec4(tx(aT), y, z, 1.0);
    float sel = step(abs(aEvent - uSel), 0.5) + step(abs(aEvent - uHover), 0.5);
    float mine = (abs(aPA - uFocusLane) < 0.5 || abs(aPB - uFocusLane) < 0.5) ? 1.0 : 0.0;
    float iso = uIsolate < -0.5 ? mix(1.0, 3.0, mine) : (abs(aPA - uIsolate) < 0.5 || abs(aPB - uIsolate) < 0.5 ? 4.0 : 0.3);
    vA = min(1.0, (0.055 * iso + sel * 0.8)) * fogOf(-mv.z) * revealOf(aT) * min(laneOf(aPA).y, laneOf(aPB).y);
    vU = aU;
    gl_Position = projectionMatrix * mv;
  }
`;
const THREAD_FRAG = /* glsl */ `
  uniform vec3 uColor;
  varying float vA;
  varying float vU;
  void main() {
    float a = vA * (0.55 + 0.45 * sin(3.14159265 * vU));
    if (a < 0.003) discard;
    gl_FragColor = vec4(uColor, a);
    #include <colorspace_fragment>
  }
`;

// Relation arcs from the selected record to linked records
const ARC_VERT = /* glsl */ `
  ${COMMON}
  attribute vec2 aTT;
  attribute vec2 aPP;
  attribute vec2 aOO;
  attribute float aU;
  varying float vU;
  varying float vFog;
  void main() {
    float zA = laneOf(aPP.x).x + aOO.x, zB = laneOf(aPP.y).x + aOO.y;
    float xA = tx(aTT.x), xB = tx(aTT.y);
    float dist = length(vec2(xB - xA, zB - zA));
    vec3 p = vec3(mix(xA, xB, aU), sin(3.14159265 * aU) * min(dist * 0.3, 16.0) + 0.1, mix(zA, zB, aU));
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vU = aU;
    vFog = max(0.35, fogOf(-mv.z));
    gl_Position = projectionMatrix * mv;
  }
`;
const ARC_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uOpacity;
  varying float vU;
  varying float vFog;
  void main() {
    float pulse = exp(-pow((fract(vU - uTime * 0.6) - 0.5) * 7.0, 2.0));
    float a = (0.4 + 0.6 * pulse) * vFog * uOpacity;
    gl_FragColor = vec4(mix(uColor, vec3(1.0), pulse * 0.4), a);
    #include <colorspace_fragment>
  }
`;

// "Now" wall
const TODAY_VERT = /* glsl */ `
  ${COMMON}
  uniform float uToday;
  varying float vY;
  varying float vFog;
  void main() {
    vec3 p = vec3(tx(uToday) + position.x, position.y, position.z);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vY = position.y;
    vFog = fogOf(-mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;
const TODAY_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uHeight;
  uniform float uBase;
  varying float vY;
  varying float vFog;
  void main() {
    float k = 1.0 - clamp(vY / uHeight, 0.0, 1.0);
    float a = (k * k * uBase) * vFog;
    gl_FragColor = vec4(uColor, a);
    #include <colorspace_fragment>
  }
`;

// ─── Engine ───────────────────────────────────────────────────────────────────

type Engine = {
  api: LineEngineApi;
  setData: (model: LineModel, lanes: LaneLayout) => void;
  setTheme: (dark: boolean) => void;
  setSelection: (event: number | null, related: number[]) => void;
  setIsolate: (person: number | null) => void;
  setInsets: (left: number, right: number) => void;
  dispose: () => void;
};

function createEngine(mount: HTMLDivElement, cbRef: MutableRefObject<Cb>): Engine {
  const dpr = Math.min(window.devicePixelRatio, 2);
  let W = Math.max(1, mount.clientWidth), H = Math.max(1, mount.clientHeight);

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(dpr);
  renderer.setSize(W, H);
  renderer.domElement.style.display = "block";
  renderer.domElement.style.cursor = "grab";
  renderer.domElement.style.touchAction = "none";
  mount.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, W / H, 0.5, 4000);

  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(dpr);
  composer.setSize(W, H);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(W, H), 0.4, 0.45, 0.72);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  let palette = DARK;
  const accentHex = getComputedStyle(document.documentElement).getPropertyValue("--accent-warm").trim() || "#d97757";
  const accent = new THREE.Color(accentHex);

  const lanesTexData = { data: new Float32Array(4), tex: null as THREE.DataTexture | null };
  const makeLaneTex = (n: number) => {
    lanesTexData.tex?.dispose();
    lanesTexData.data = new Float32Array(Math.max(1, n) * 4);
    const t = new THREE.DataTexture(lanesTexData.data, Math.max(1, n), 1, THREE.RGBAFormat, THREE.FloatType);
    t.minFilter = t.magFilter = THREE.NearestFilter;
    t.needsUpdate = true;
    lanesTexData.tex = t;
    return t;
  };

  // Shared uniforms (same objects referenced by every material)
  const U = {
    uLanes: { value: makeLaneTex(1) as THREE.Texture },
    uCenter: { value: 0 },
    uScale: { value: 1 },
    uReveal: { value: -1e9 },
    uRevealSoft: { value: 10 },
    uFogNear: { value: 200 },
    uFogFar: { value: 400 },
    uSel: { value: -1 },
    uHover: { value: -1 },
    uIsolate: { value: -1 },
    uFocusLane: { value: -1 },
    uTime: { value: 0 },
    uToday: { value: 0 },
    uDark: { value: 1 },
    uInk: { value: new THREE.Color("#ffffff") },
    uAlert: { value: new THREE.Color("#ff5a4f") },
  };

  const disposables: Array<{ dispose: () => void }> = [];
  const track = <T extends { dispose: () => void }>(x: T) => { disposables.push(x); return x; };
  const mat = (vertexShader: string, fragmentShader: string, extra: Record<string, THREE.IUniform> = {}, opts: Partial<THREE.ShaderMaterialParameters> = {}) =>
    track(new THREE.ShaderMaterial({
      vertexShader, fragmentShader, uniforms: { ...U, ...extra },
      transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide, ...opts,
    }));

  // ── Background ──
  const bgMat = mat(BG_VERT, BG_FRAG, {
    uTop: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uHorizonY: { value: 0.6 },
  }, { transparent: false });
  const bg = new THREE.Mesh(track(new THREE.PlaneGeometry(2, 2)), bgMat);
  bg.frustumCulled = false;
  bg.renderOrder = -10;
  scene.add(bg);

  // ── Floor ──
  const floorMat = mat(FLOOR_VERT, FLOOR_FRAG, {
    uFloor: { value: new THREE.Color() }, uFuture: { value: new THREE.Color() }, uAlpha: { value: 0.6 },
  });
  const floorGeo = track(new THREE.BufferGeometry());
  floorGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(12), 3));
  floorGeo.setIndex([0, 1, 2, 0, 2, 3]);
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.frustumCulled = false;
  floor.renderOrder = -5;
  scene.add(floor);

  // ── Grid (calendar ticks on the ground) ──
  const gridMat = mat(GRID_VERT, GRID_FRAG, { uColor: { value: new THREE.Color() } });
  let gridGeo = new THREE.BufferGeometry();
  const grid = new THREE.LineSegments(gridGeo, gridMat);
  grid.frustumCulled = false;
  grid.renderOrder = -4;
  scene.add(grid);

  // ── Lanes ──
  const quad = (x0: number, x1: number, y0: number, y1: number) => {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array([x0, y0, 0, x1, y0, 0, x1, y1, 0, x0, y1, 0]), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    return g;
  };
  const laneMat = mat(LANE_VERT, LANE_FRAG, { uHalfW: { value: 2000 } });
  let laneGeo = quad(-1, 1, -1, 1);
  const laneMesh = new THREE.Mesh(laneGeo, laneMat);
  laneMesh.frustumCulled = false;
  laneMesh.renderOrder = -3;
  scene.add(laneMesh);

  // ── Today wall ──
  const todayMat = mat(TODAY_VERT, TODAY_FRAG, { uColor: { value: accent.clone() }, uHeight: { value: 16 }, uBase: { value: 0.12 } });
  const todayGeo = track(new THREE.BufferGeometry());
  todayGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(12), 3));
  todayGeo.setIndex([0, 1, 2, 0, 2, 3]);
  const todayWall = new THREE.Mesh(todayGeo, todayMat);
  todayWall.frustumCulled = false;
  todayWall.renderOrder = -2;
  scene.add(todayWall);
  const todayLineMat = mat(TODAY_VERT, TODAY_FRAG, { uColor: { value: accent.clone() }, uHeight: { value: 1 }, uBase: { value: 0.9 } });
  const todayLineGeo = track(new THREE.BufferGeometry());
  todayLineGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(12), 3));
  todayLineGeo.setIndex([0, 1, 2, 0, 2, 3]);
  const todayLine = new THREE.Mesh(todayLineGeo, todayLineMat);
  todayLine.frustumCulled = false;
  todayLine.renderOrder = -1;
  scene.add(todayLine);

  // ── Spans ──
  const spanMat = mat(SPAN_VERT, SPAN_FRAG, {
    uTrackBase: { value: TRACK_BASE }, uTrackDepth: { value: TRACK_DEPTH }, uHalf: { value: SPAN_HALF }, uMinW: { value: 0.3 },
  });
  let spanGeo = quad(0, 1, -1, 1);
  const spanMesh = new THREE.Mesh(spanGeo, spanMat);
  spanMesh.frustumCulled = false;
  spanMesh.renderOrder = 1;
  scene.add(spanMesh);

  // ── Threads ──
  const threadMat = mat(THREAD_VERT, THREAD_FRAG, { uColor: { value: new THREE.Color() } });
  let threadGeo = new THREE.BufferGeometry();
  const threads = new THREE.LineSegments(threadGeo, threadMat);
  threads.frustumCulled = false;
  threads.renderOrder = 2;
  scene.add(threads);

  // ── Beads ──
  const beadMat = mat(BEAD_VERT, BEAD_FRAG, {
    uMorph: { value: 1 }, uRadius: { value: 0.3 }, uStep: { value: 0.7 }, uMaxStack: { value: MAX_STACK }, uPxPerUnit: { value: 1 },
  });
  let beadGeo = quad(-1, 1, -1, 1);
  const beadMesh = new THREE.Mesh(beadGeo, beadMat);
  beadMesh.frustumCulled = false;
  beadMesh.renderOrder = 4;
  scene.add(beadMesh);

  // ── Relation arcs ──
  const arcMat = mat(ARC_VERT, ARC_FRAG, { uColor: { value: accent.clone() }, uOpacity: { value: 0.9 } });
  let arcGeo = new THREE.BufferGeometry();
  const arcs = new THREE.LineSegments(arcGeo, arcMat);
  arcs.frustumCulled = false;
  arcs.renderOrder = 5;
  scene.add(arcs);

  // ── DOM overlay ──
  const overlay = document.createElement("div");
  overlay.style.cssText = "position:absolute;inset:0;pointer-events:none;overflow:hidden;";
  mount.appendChild(overlay);

  const rulerShade = document.createElement("div");
  rulerShade.style.cssText = "position:absolute;left:0;right:0;top:0;height:104px;pointer-events:none;";
  overlay.appendChild(rulerShade);

  const tickEls: HTMLDivElement[] = [];
  for (let i = 0; i < TICK_POOL; i++) {
    const el = document.createElement("div");
    el.style.cssText = `position:absolute;left:0;top:${RULER_Y}px;white-space:nowrap;font-family:'DM Mono',monospace;opacity:0;will-change:transform;`;
    overlay.appendChild(el);
    tickEls.push(el);
  }
  const todayChip = document.createElement("div");
  todayChip.style.cssText = `position:absolute;left:0;top:${RULER_Y - 3}px;padding:2px 7px;border-radius:999px;background:var(--accent-warm);color:#fff;font-family:'DM Mono',monospace;font-size:9.5px;letter-spacing:0.06em;text-transform:uppercase;white-space:nowrap;box-shadow:0 0 14px color-mix(in srgb, var(--accent-warm) 55%, transparent);opacity:0;will-change:transform;`;
  overlay.appendChild(todayChip);
  const cursorChip = document.createElement("div");
  cursorChip.style.cssText = `position:absolute;left:0;top:${RULER_Y + 18}px;padding:1px 6px;border-radius:5px;font-family:'DM Mono',monospace;font-size:9.5px;white-space:nowrap;opacity:0;transition:opacity 0.15s;will-change:transform;`;
  overlay.appendChild(cursorChip);

  type Header = { el: HTMLDivElement; av: HTMLDivElement; name: HTMLSpanElement; count: HTMLSpanElement; key: number };
  const headers: Header[] = [];
  for (let i = 0; i < HEADER_POOL; i++) {
    const el = document.createElement("div");
    el.style.cssText = "position:absolute;left:0;top:0;display:flex;align-items:center;gap:7px;height:24px;padding:0 9px 0 3px;border-radius:999px;cursor:pointer;pointer-events:auto;opacity:0;white-space:nowrap;will-change:transform,opacity;transition:background 0.15s,box-shadow 0.15s;";
    const av = document.createElement("div");
    av.style.cssText = "width:18px;height:18px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:'DM Mono',monospace;font-size:8px;font-weight:500;color:#fff;flex-shrink:0;";
    const name = document.createElement("span");
    name.style.cssText = "font-family:'Geist',sans-serif;font-size:12px;font-weight:500;";
    const count = document.createElement("span");
    count.style.cssText = "font-family:'DM Mono',monospace;font-size:9.5px;";
    el.append(av, name, count);
    overlay.appendChild(el);
    const h: Header = { el, av, name, count, key: -1 };
    el.addEventListener("click", (e) => { e.stopPropagation(); if (h.key >= 0) cbRef.current.onPickPerson(h.key); });
    el.addEventListener("pointerenter", () => { hoverLane = h.key; });
    el.addEventListener("pointerleave", () => { if (hoverLane === h.key) hoverLane = -1; });
    el.addEventListener("pointerdown", (e) => e.stopPropagation());
    headers.push(h);
  }

  type Label = { el: HTMLDivElement; title: HTMLSpanElement; sub: HTMLSpanElement; key: string; used: boolean };
  const labels: Label[] = [];
  for (let i = 0; i < LABEL_POOL; i++) {
    const el = document.createElement("div");
    el.style.cssText = "position:absolute;left:0;top:0;display:flex;flex-direction:column;gap:0;padding:2px 7px 3px;border-radius:6px;opacity:0;transition:opacity 0.2s ease;will-change:transform,opacity;white-space:nowrap;overflow:hidden;";
    const title = document.createElement("span");
    title.style.cssText = "font-family:'Geist',sans-serif;font-size:11.5px;font-weight:500;overflow:hidden;text-overflow:ellipsis;";
    const sub = document.createElement("span");
    sub.style.cssText = "font-family:'DM Mono',monospace;font-size:9px;letter-spacing:0.02em;overflow:hidden;text-overflow:ellipsis;";
    el.append(title, sub);
    overlay.appendChild(el);
    labels.push({ el, title, sub, key: "", used: false });
  }

  const tooltip = document.createElement("div");
  tooltip.style.cssText = "position:absolute;left:0;top:0;padding:9px 12px;border-radius:10px;backdrop-filter:blur(12px);opacity:0;transition:opacity 0.12s ease;max-width:320px;pointer-events:none;";
  overlay.appendChild(tooltip);

  function styleOverlay() {
    const d = palette.dark;
    rulerShade.style.background = `linear-gradient(to bottom, ${palette.bgTop} 0%, ${palette.bgTop}e6 55%, transparent 100%)`;
    for (const h of headers) {
      h.el.style.background = d ? "rgba(10,12,22,0.72)" : "rgba(250,247,242,0.86)";
      h.el.style.border = d ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(139,120,100,0.22)";
      h.name.style.color = d ? "rgba(255,255,255,0.92)" : "#2d2520";
      h.count.style.color = d ? "rgba(255,255,255,0.42)" : "#8b7868";
    }
    for (const l of labels) {
      l.el.style.background = d ? "rgba(8,10,18,0.66)" : "rgba(252,250,246,0.88)";
      l.el.style.boxShadow = d ? "none" : "0 1px 2px rgba(45,37,32,0.08)";
      l.title.style.color = d ? "rgba(255,255,255,0.94)" : "#2d2520";
      l.sub.style.color = d ? "rgba(255,255,255,0.45)" : "#8b7868";
    }
    tooltip.style.background = d ? "rgba(8,10,20,0.88)" : "rgba(252,250,246,0.96)";
    tooltip.style.border = d ? "1px solid rgba(255,255,255,0.12)" : "1px solid rgba(139,120,100,0.25)";
    tooltip.style.boxShadow = d ? "0 10px 30px rgba(0,0,0,0.5)" : "0 10px 30px rgba(45,37,32,0.16)";
    cursorChip.style.background = d ? "rgba(255,255,255,0.1)" : "rgba(45,37,32,0.08)";
    cursorChip.style.color = d ? "rgba(255,255,255,0.75)" : "#5c4f44";
  }

  // ── Data state ──
  let model: LineModel | null = null;
  let lanes: LaneLayout | null = null;
  let P = 0;
  // Current (animated) lane Z per person
  let laneZ = new Float64Array(0);
  let laneGoal = new Float64Array(0);
  let laneDim = new Float32Array(0);
  // Point instances
  let pts: Array<{ event: number; person: number; t: number }> = [];
  let ptFrom = new Float32Array(0), ptTo = new Float32Array(0);
  let ptFromAttr: THREE.InstancedBufferAttribute | null = null, ptToAttr: THREE.InstancedBufferAttribute | null = null;
  let ptRelAttr: THREE.InstancedBufferAttribute | null = null;
  // Span instances
  let spans: Array<{ event: number; person: number; track: number }> = [];
  let spanRelAttr: THREE.InstancedBufferAttribute | null = null;
  let stackLevel = NaN;
  let morphStart = -1;

  // ── View state ──
  let center = 0, goalCenter = 0;
  let logPx = Math.log(4), goalLogPx = Math.log(4);
  let camZ = 0, goalCamZ = 0;
  let el = 0.6, goalEl = 0.6;
  let dist = 120, goalDist = 120;
  let anchor: { t: number; xw: number } | null = null;
  let velC = 0, velZ = 0;
  let leftInset = 0, rightInset = 0;
  let revealStart = -1;
  let viewInited = false;

  let selEvent = -1;
  let related: number[] = [];
  let isolate = -1;
  let hoverLane = -1;
  let hover: { event: number; person: number } | null = null;
  let focusLane = -1;
  let lastViewLabel = "";

  const pxPerDay = () => Math.exp(logPx);
  const pxPerUnit = () => H / (2 * dist * TAN_HALF);
  const visW = () => Math.max(200, W - leftInset - rightInset);
  const laneCenter = (p: number) => laneGoal[p] - (TRACK_BASE + (lanes?.tracks[p] ?? 0) * TRACK_DEPTH) * 0.45;

  function bounds() {
    if (!model) return;
    const range = Math.max(30, model.tMax - model.tMin);
    const minPx = visW() / (range * 2.2);
    goalLogPx = Math.min(Math.log(1400), Math.max(Math.log(minPx), goalLogPx));
    logPx = Math.min(Math.log(1400), Math.max(Math.log(minPx) - 0.2, logPx));
    const half = visW() / 2 / pxPerDay();
    const lo = model.tMin - half * 0.8, hi = model.tMax + half * 0.8;
    goalCenter = Math.min(hi, Math.max(lo, goalCenter));
    center = Math.min(hi + half * 0.3, Math.max(lo - half * 0.3, center));
    const zLo = (lanes?.depth ?? 0) - 2, zHi = 4;
    goalCamZ = Math.min(zHi, Math.max(zLo, goalCamZ));
    goalEl = Math.min(1.35, Math.max(0.22, goalEl));
    goalDist = Math.min(320, Math.max(45, goalDist));
  }

  // ── Build geometry for a model ──
  function rebuild() {
    if (!model || !lanes) return;
    const m = model, L = lanes;
    const prevZ = laneZ;
    const samePeople = prevZ.length === m.people.length;
    P = m.people.length;
    laneGoal = Float64Array.from(L.laneZ);
    laneZ = samePeople && viewInited ? prevZ : Float64Array.from(L.laneZ);
    laneDim = new Float32Array(P).fill(1);
    if (!samePeople || !lanesTexData.tex) U.uLanes.value = makeLaneTex(P);

    const back = [...L.order].sort((a, b) => L.laneZ[a] - L.laneZ[b]); // back → front draw order
    const colorOf = new Map<string, THREE.Color>();
    const dbColor = (id: string, hex: string) => {
      let c = colorOf.get(id);
      if (!c) { c = new THREE.Color(hex); colorOf.set(id, c); }
      return c;
    };

    // Lanes
    laneGeo.dispose();
    laneGeo = quad(-1, 1, -1, 1);
    {
      const aPerson = new Float32Array(P), aRange = new Float32Array(P * 2), aColor = new Float32Array(P * 3);
      const c = new THREE.Color();
      back.forEach((p, k) => {
        const person = m.people[p];
        aPerson[k] = p;
        aRange[k * 2] = person.first; aRange[k * 2 + 1] = person.last;
        c.set(personColor(person.hue, palette.dark));
        aColor[k * 3] = c.r; aColor[k * 3 + 1] = c.g; aColor[k * 3 + 2] = c.b;
      });
      laneGeo.setAttribute("aPerson", new THREE.InstancedBufferAttribute(aPerson, 1));
      laneGeo.setAttribute("aRange", new THREE.InstancedBufferAttribute(aRange, 2));
      laneGeo.setAttribute("aColor", new THREE.InstancedBufferAttribute(aColor, 3));
      laneGeo.instanceCount = P;
      laneMesh.geometry = laneGeo;
    }

    // Points & spans
    pts = [];
    spans = [];
    for (const p of back) {
      const person = m.people[p];
      const evs = [...person.events].sort((a, b) => m.events[a].t0 - m.events[b].t0);
      for (const e of evs) {
        const ev = m.events[e];
        if (ev.kind === "span") spans.push({ event: e, person: p, track: L.spanTrack.get(`${e}:${p}`) ?? 0 });
        else pts.push({ event: e, person: p, t: ev.t0 });
      }
    }
    // Draw spans back-to-front, lower tracks (further back) first
    spans.sort((a, b) => L.laneZ[a.person] - L.laneZ[b.person] || a.track - b.track);

    const flagsOf = (e: number) => {
      const ev = m.events[e];
      return (ev.kind === "created" ? 1 : 0) + (ev.overdue ? 2 : 0) + (ev.ongoing ? 4 : 0);
    };

    beadGeo.dispose();
    beadGeo = quad(-1, 1, -1, 1);
    {
      const n = pts.length;
      ptFrom = new Float32Array(n * 3);
      ptTo = new Float32Array(n * 3);
      const aPerson = new Float32Array(n), aEvent = new Float32Array(n), aState = new Float32Array(n), aFlags = new Float32Array(n);
      const aColor = new Float32Array(n * 3);
      pts.forEach((it, i) => {
        const ev = m.events[it.event];
        aPerson[i] = it.person; aEvent[i] = it.event; aState[i] = STATE_INDEX[ev.state]; aFlags[i] = flagsOf(it.event);
        const c = dbColor(ev.node.databaseId, ev.node.color);
        aColor[i * 3] = c.r; aColor[i * 3 + 1] = c.g; aColor[i * 3 + 2] = c.b;
        ptTo[i * 3] = it.t; ptTo[i * 3 + 1] = 0; ptTo[i * 3 + 2] = 1;
      });
      ptFrom.set(ptTo);
      ptFromAttr = new THREE.InstancedBufferAttribute(ptFrom, 3);
      ptToAttr = new THREE.InstancedBufferAttribute(ptTo, 3);
      ptRelAttr = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
      beadGeo.setAttribute("aFrom", ptFromAttr);
      beadGeo.setAttribute("aTo", ptToAttr);
      beadGeo.setAttribute("aPerson", new THREE.InstancedBufferAttribute(aPerson, 1));
      beadGeo.setAttribute("aEvent", new THREE.InstancedBufferAttribute(aEvent, 1));
      beadGeo.setAttribute("aState", new THREE.InstancedBufferAttribute(aState, 1));
      beadGeo.setAttribute("aFlags", new THREE.InstancedBufferAttribute(aFlags, 1));
      beadGeo.setAttribute("aRel", ptRelAttr);
      beadGeo.setAttribute("aColor", new THREE.InstancedBufferAttribute(aColor, 3));
      beadGeo.instanceCount = n;
      beadMesh.geometry = beadGeo;
    }

    spanGeo.dispose();
    spanGeo = quad(0, 1, -1, 1);
    {
      const n = spans.length;
      const aT = new Float32Array(n * 2), aTrack = new Float32Array(n), aPerson = new Float32Array(n), aEvent = new Float32Array(n);
      const aState = new Float32Array(n), aFlags = new Float32Array(n), aColor = new Float32Array(n * 3);
      spans.forEach((s, i) => {
        const ev = m.events[s.event];
        aT[i * 2] = ev.t0; aT[i * 2 + 1] = ev.t1;
        aTrack[i] = s.track; aPerson[i] = s.person; aEvent[i] = s.event;
        aState[i] = STATE_INDEX[ev.state]; aFlags[i] = flagsOf(s.event);
        const c = dbColor(ev.node.databaseId, ev.node.color);
        aColor[i * 3] = c.r; aColor[i * 3 + 1] = c.g; aColor[i * 3 + 2] = c.b;
      });
      spanRelAttr = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
      spanGeo.setAttribute("aT", new THREE.InstancedBufferAttribute(aT, 2));
      spanGeo.setAttribute("aTrack", new THREE.InstancedBufferAttribute(aTrack, 1));
      spanGeo.setAttribute("aPerson", new THREE.InstancedBufferAttribute(aPerson, 1));
      spanGeo.setAttribute("aEvent", new THREE.InstancedBufferAttribute(aEvent, 1));
      spanGeo.setAttribute("aState", new THREE.InstancedBufferAttribute(aState, 1));
      spanGeo.setAttribute("aFlags", new THREE.InstancedBufferAttribute(aFlags, 1));
      spanGeo.setAttribute("aRel", spanRelAttr);
      spanGeo.setAttribute("aColor", new THREE.InstancedBufferAttribute(aColor, 3));
      spanGeo.instanceCount = n;
      spanMesh.geometry = spanGeo;
    }

    // Threads between lanes of shared records
    threadGeo.dispose();
    threadGeo = new THREE.BufferGeometry();
    {
      const segs: Array<[number, number, number, number]> = []; // t, pA, pB, event
      for (const ev of m.events) {
        if (ev.people.length < 2) continue;
        const ps = [...ev.people].sort((a, b) => L.laneZ[b] - L.laneZ[a]);
        for (let k = 1; k < ps.length; k++) segs.push([ev.t0, ps[k - 1], ps[k], ev.index]);
      }
      const nv = segs.length * THREAD_SEG * 2;
      const aT = new Float32Array(nv), aPA = new Float32Array(nv), aPB = new Float32Array(nv), aU = new Float32Array(nv), aEvent = new Float32Array(nv);
      let v = 0;
      for (const [t, pa, pb, e] of segs) {
        for (let s = 0; s < THREAD_SEG; s++) {
          for (const u of [s / THREAD_SEG, (s + 1) / THREAD_SEG]) {
            aT[v] = t; aPA[v] = pa; aPB[v] = pb; aU[v] = u; aEvent[v] = e; v++;
          }
        }
      }
      threadGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(nv * 3), 3));
      threadGeo.setAttribute("aT", new THREE.BufferAttribute(aT, 1));
      threadGeo.setAttribute("aPA", new THREE.BufferAttribute(aPA, 1));
      threadGeo.setAttribute("aPB", new THREE.BufferAttribute(aPB, 1));
      threadGeo.setAttribute("aU", new THREE.BufferAttribute(aU, 1));
      threadGeo.setAttribute("aEvent", new THREE.BufferAttribute(aEvent, 1));
      threads.geometry = threadGeo;
    }

    U.uToday.value = m.today;
    stackLevel = NaN;
    restack(true);
    applySelection();

    if (!viewInited) {
      viewInited = true;
      initialView();
    } else {
      bounds();
    }
  }

  function initialView() {
    if (!model || !lanes) return;
    // Frame the bulk of the activity (5th–95th percentile), with today in view when close
    const ts = model.events.map((e) => (e.t0 + e.t1) / 2).sort((a, b) => a - b);
    let a = ts[Math.floor(ts.length * 0.05)] ?? model.tMin;
    let b = ts[Math.floor(ts.length * 0.95)] ?? model.tMax;
    if (model.today > a - 60 && model.today < b + 60) { a = Math.min(a, model.today - 14); b = Math.max(b, model.today + 14); }
    goalCenter = center = (a + b) / 2;
    goalLogPx = logPx = Math.log(visW() * 0.86 / Math.max(14, b - a));
    const front = lanes.order[0] ?? 0;
    goalCamZ = laneCenter(front);
    camZ = goalCamZ + 30;
    el = 1.2; goalEl = 0.8;
    dist = 170; goalDist = 125;
    bounds();
    revealStart = performance.now();
  }

  // ── Column stacking (re-bins with zoom) ──
  function beadPx() { return Math.min(6.5, Math.max(3.4, pxPerDay() * 0.42)); }

  function restack(force = false) {
    if (!model || pts.length === 0) return;
    const raw = (2.5 * beadPx()) / pxPerDay();
    const level = Math.max(-6, Math.ceil(Math.log2(raw)));
    if (!force && level === stackLevel) return;
    const firstBuild = Number.isNaN(stackLevel);
    stackLevel = level;
    const bucket = Math.pow(2, level);
    const { center: c, slot, count } = stackPoints(pts, bucket);
    // Freeze the current interpolated state as the new "from"
    const k = morphStart < 0 ? 1 : morphProgress();
    for (let i = 0; i < pts.length; i++) {
      for (let j = 0; j < 3; j++) ptFrom[i * 3 + j] = ptFrom[i * 3 + j] + (ptTo[i * 3 + j] - ptFrom[i * 3 + j]) * k;
      ptTo[i * 3] = c[i]; ptTo[i * 3 + 1] = slot[i]; ptTo[i * 3 + 2] = count[i];
    }
    if (firstBuild) ptFrom.set(ptTo);
    ptFromAttr!.needsUpdate = true;
    ptToAttr!.needsUpdate = true;
    morphStart = performance.now();
    beadMat.uniforms.uMorph.value = firstBuild ? 1 : 0;
  }
  function morphProgress() {
    if (morphStart < 0) return 1;
    const k = Math.min(1, (performance.now() - morphStart) / 420);
    return 1 - Math.pow(1 - k, 3);
  }

  // ── Selection ──
  function applySelection() {
    U.uSel.value = selEvent;
    const rel = new Set(related);
    relSet = rel;
    if (ptRelAttr) {
      const a = ptRelAttr.array as Float32Array;
      for (let i = 0; i < pts.length; i++) a[i] = rel.has(pts[i].event) ? 1 : 0;
      ptRelAttr.needsUpdate = true;
    }
    if (spanRelAttr) {
      const a = spanRelAttr.array as Float32Array;
      for (let i = 0; i < spans.length; i++) a[i] = rel.has(spans[i].event) ? 1 : 0;
      spanRelAttr.needsUpdate = true;
    }
    // Arcs: from the selected record's primary instance to each related record's primary instance
    arcGeo.dispose();
    arcGeo = new THREE.BufferGeometry();
    if (model && lanes && selEvent >= 0 && related.length > 0) {
      const m = model;
      const anchorOf = (e: number) => {
        const ev = m.events[e];
        const p = isolate >= 0 && ev.people.includes(isolate) ? isolate : ev.people[0];
        const off = ev.kind === "span" ? -(TRACK_BASE + (lanes!.spanTrack.get(`${e}:${p}`) ?? 0) * TRACK_DEPTH) : 0;
        const t = ev.kind === "span" ? (ev.t0 + ev.t1) / 2 : ev.t0;
        return { t, p, off };
      };
      const A = anchorOf(selEvent);
      const nv = related.length * ARC_SEG * 2;
      const aTT = new Float32Array(nv * 2), aPP = new Float32Array(nv * 2), aOO = new Float32Array(nv * 2), aU = new Float32Array(nv);
      let v = 0;
      for (const r of related) {
        const B = anchorOf(r);
        for (let s = 0; s < ARC_SEG; s++) {
          for (const u of [s / ARC_SEG, (s + 1) / ARC_SEG]) {
            aTT[v * 2] = A.t; aTT[v * 2 + 1] = B.t;
            aPP[v * 2] = A.p; aPP[v * 2 + 1] = B.p;
            aOO[v * 2] = A.off; aOO[v * 2 + 1] = B.off;
            aU[v] = u; v++;
          }
        }
      }
      arcGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(nv * 3), 3));
      arcGeo.setAttribute("aTT", new THREE.BufferAttribute(aTT, 2));
      arcGeo.setAttribute("aPP", new THREE.BufferAttribute(aPP, 2));
      arcGeo.setAttribute("aOO", new THREE.BufferAttribute(aOO, 2));
      arcGeo.setAttribute("aU", new THREE.BufferAttribute(aU, 1));
    }
    arcs.geometry = arcGeo;
  }

  // ── Theme ──
  function applyTheme() {
    const d = palette.dark;
    bgMat.uniforms.uTop.value.set(palette.bgTop);
    bgMat.uniforms.uHorizon.value.set(palette.bgHorizon);
    floorMat.uniforms.uFloor.value.set(palette.floor);
    floorMat.uniforms.uFuture.value.set(palette.future);
    floorMat.uniforms.uAlpha.value = d ? 0.55 : 0.5;
    gridMat.uniforms.uColor.value.set(palette.grid);
    threadMat.uniforms.uColor.value.set(d ? "#cfd8ff" : "#6b5a4c");
    U.uInk.value.set(palette.ink);
    U.uDark.value = d ? 1 : 0;
    U.uAlert.value.set(d ? "#ff5a4f" : "#d8433a");
    todayMat.uniforms.uBase.value = d ? 0.06 : 0.07;
    arcMat.uniforms.uOpacity.value = d ? 0.85 : 0.75;
    styleOverlay();
    if (model) {
      // Lane colours depend on theme
      const aColor = laneGeo.getAttribute("aColor") as THREE.InstancedBufferAttribute | undefined;
      const aPerson = laneGeo.getAttribute("aPerson") as THREE.InstancedBufferAttribute | undefined;
      if (aColor && aPerson) {
        const c = new THREE.Color();
        for (let i = 0; i < aPerson.count; i++) {
          c.set(personColor(model.people[aPerson.getX(i)].hue, d));
          aColor.setXYZ(i, c.r, c.g, c.b);
        }
        aColor.needsUpdate = true;
      }
    }
  }

  // ── Projection helpers ──
  const pm = new THREE.Matrix4();
  let pe = pm.elements;
  const sp = { x: 0, y: 0, w: 0 };
  function prepProj() {
    camera.updateMatrixWorld();
    pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    pe = pm.elements;
  }
  function proj(x: number, y: number, z: number) {
    const w = pe[3] * x + pe[7] * y + pe[11] * z + pe[15];
    sp.w = w;
    if (w < 1e-4) { sp.x = sp.y = -1e5; return false; }
    sp.x = ((pe[0] * x + pe[4] * y + pe[8] * z + pe[12]) / w * 0.5 + 0.5) * W;
    sp.y = (0.5 - (pe[1] * x + pe[5] * y + pe[9] * z + pe[13]) / w * 0.5) * H;
    return true;
  }
  const raycaster = new THREE.Raycaster();
  const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const ndc = new THREE.Vector2();
  const hit = new THREE.Vector3();
  function groundAt(px: number, py: number): THREE.Vector3 | null {
    ndc.set((px / W) * 2 - 1, -(py / H) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const r = raycaster.ray.intersectPlane(ground, hit);
    if (!r) return null;
    if (hit.distanceTo(camera.position) > 2500) return null;
    return hit;
  }
  const scaleNow = () => pxPerDay() / pxPerUnit();
  const tOfX = (xw: number) => center + xw / scaleNow();
  const xOfT = (t: number) => (t - center) * scaleNow();

  // Current point instance world position (matches the bead shader)
  const morphNow = { k: 1 };
  function pointWorld(i: number, out: { x: number; y: number; z: number; r: number; lift: number }) {
    const k = morphNow.k;
    const t = ptFrom[i * 3] + (ptTo[i * 3] - ptFrom[i * 3]) * k;
    const slot = ptFrom[i * 3 + 1] + (ptTo[i * 3 + 1] - ptFrom[i * 3 + 1]) * k;
    const count = ptFrom[i * 3 + 2] + (ptTo[i * 3 + 2] - ptFrom[i * 3 + 2]) * k;
    const comp = Math.min(1, MAX_STACK / Math.max(count, 1));
    const R = beadMat.uniforms.uRadius.value as number;
    out.x = xOfT(t);
    out.y = R * 1.3;
    out.z = laneZ[pts[i].person];
    out.r = R * (1 - 0.45 * (1 - comp));
    out.lift = slot * (beadMat.uniforms.uStep.value as number) * comp;
  }
  const wp = { x: 0, y: 0, z: 0, r: 0, lift: 0 };
  /** Project a point instance (columns stack in view space, straight up on screen). */
  function projPoint(i: number) {
    pointWorld(i, wp);
    if (!proj(wp.x, wp.y, wp.z)) return false;
    sp.y -= wp.lift * (H / (2 * TAN_HALF)) / sp.w;
    return true;
  }

  function spanEnds(i: number) {
    const s = spans[i];
    const ev = model!.events[s.event];
    const z = laneZ[s.person] - TRACK_BASE - s.track * TRACK_DEPTH;
    const x0 = xOfT(ev.t0);
    const x1 = Math.max(xOfT(ev.t1), x0 + (spanMat.uniforms.uMinW.value as number));
    return { x0, x1, z };
  }

  // ── Picking ──
  let relSet = new Set<number>();
  function visibleFor(person: number, event: number) {
    if (isolate < 0 || person === isolate || event === selEvent) return true;
    return relSet.has(event);
  }
  function pick(px: number, py: number): { event: number; person: number } | null {
    if (!model) return null;
    let best: { event: number; person: number } | null = null;
    let bestD = Infinity;
    const ppu = pxPerUnit();
    for (let i = 0; i < pts.length; i++) {
      const it = pts[i];
      if (!visibleFor(it.person, it.event)) continue;
      if (!projPoint(i)) continue;
      const rpx = Math.max(2.2, wp.r * ppu * dist / sp.w) + 3;
      const dx = sp.x - px, dy = sp.y - py;
      if (Math.abs(dx) > rpx || Math.abs(dy) > rpx) continue;
      const d = Math.hypot(dx, dy) - rpx * 0.5;
      if (d < bestD) { bestD = d; best = { event: it.event, person: it.person }; }
    }
    if (best) return best;
    for (let i = 0; i < spans.length; i++) {
      const s = spans[i];
      if (!visibleFor(s.person, s.event)) continue;
      const { x0, x1, z } = spanEnds(i);
      if (!proj(x0, 0, z)) continue;
      const ax = sp.x, ay = sp.y, aw = sp.w;
      if (!proj(x1, 0, z)) continue;
      const bx = sp.x, by = sp.y;
      const half = Math.max(3, SPAN_HALF * ppu * dist / aw * Math.sin(el)) + 3;
      const vx = bx - ax, vy = by - ay;
      const len2 = vx * vx + vy * vy || 1;
      const u = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / len2));
      const d = Math.hypot(ax + vx * u - px, ay + vy * u - py);
      if (d < half && d < bestD) { bestD = d; best = { event: s.event, person: s.person }; }
    }
    return best;
  }

  // ── Input ──
  const canvas = renderer.domElement;
  let mouse: { x: number; y: number } | null = null;
  let mouseMoved = false;
  let drag: null | { mode: "pan" | "tilt"; x: number; y: number; sx: number; sy: number; t: number; z: number; moved: boolean; lastT: number } = null;
  const samples: Array<{ c: number; z: number; time: number }> = [];

  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    const g = groundAt(x, y);
    const tilt = e.button === 2 || e.altKey;
    drag = { mode: tilt ? "tilt" : "pan", x, y, sx: x, sy: y, t: g ? tOfX(g.x) : center, z: g ? g.z : camZ, moved: false, lastT: performance.now() };
    anchor = null;
    velC = velZ = 0;
    samples.length = 0;
    canvas.style.cursor = "grabbing";
  });
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  canvas.addEventListener("pointermove", (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    mouse = { x, y };
    mouseMoved = true;
    if (!drag) return;
    if (Math.hypot(x - drag.sx, y - drag.sy) > 3) drag.moved = true;
    if (drag.mode === "tilt") {
      goalEl = el = Math.min(1.35, Math.max(0.22, el + (y - drag.y) * 0.004));
      drag.x = x; drag.y = y;
      return;
    }
    // Map-style drag: keep the grabbed ground point under the cursor
    const g = groundAt(x, y);
    if (g) {
      const s = scaleNow();
      center = goalCenter = drag.t - g.x / s;
      const dz = Math.max(-30, Math.min(30, drag.z - g.z));
      camZ = goalCamZ = camZ + dz;
    } else {
      center = goalCenter = center - (x - drag.x) / pxPerDay();
    }
    bounds();
    const now = performance.now();
    samples.push({ c: center, z: camZ, time: now });
    while (samples.length > 6) samples.shift();
    drag.x = x; drag.y = y;
  });
  const endDrag = (e: PointerEvent) => {
    if (!drag) return;
    const wasClick = !drag.moved;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    if (!wasClick && samples.length >= 2) {
      const a = samples[0], b = samples[samples.length - 1];
      const dt = (b.time - a.time) / 1000;
      if (dt > 0 && performance.now() - b.time < 80) { velC = (b.c - a.c) / dt; velZ = (b.z - a.z) / dt; }
    }
    drag = null;
    canvas.style.cursor = hover ? "pointer" : "grab";
    if (wasClick && e.button === 0) {
      const h = pick(x, y);
      cbRef.current.onSelect(h ? h.event : null);
    }
  };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
  canvas.addEventListener("pointerleave", () => { mouse = null; mouseMoved = true; });
  canvas.addEventListener("dblclick", (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    const h = pick(x, y);
    if (h) { api.focusEvent(h.event); return; }
    zoomAt(x, y, 2.2);
  });
  function zoomAt(x: number, y: number, factor: number) {
    const g = groundAt(x, y);
    const xw = g ? g.x : 0;
    const t = g ? tOfX(g.x) : center;
    anchor = { t, xw };
    goalLogPx += Math.log(factor);
    bounds();
  }
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? H : 1;
    const dx = e.deltaX * unit, dy = e.deltaY * unit;
    if (e.altKey) {
      // Alt + wheel: walk through lanes
      goalCamZ -= dy * 0.06;
      anchor = null;
      bounds();
      return;
    }
    if (Math.abs(dx) > Math.abs(dy) && !e.ctrlKey) {
      goalCenter = (anchor ? goalCenter : goalCenter) + dx / pxPerDay();
      anchor = null;
      bounds();
      return;
    }
    const k = e.ctrlKey ? 0.012 : 0.0022;
    zoomAt(x, y, Math.exp(-dy * k));
  }, { passive: false });

  // ── API ──
  const api: LineEngineApi = {
    focusPerson(p, fit) {
      if (!model || !lanes || p < 0 || p >= P) return;
      anchor = null; velC = velZ = 0;
      goalCamZ = laneCenter(p);
      if (fit) {
        const [a, b] = personWindow(model, p);
        goalCenter = (a + b) / 2;
        goalLogPx = Math.log(visW() * 0.84 / Math.max(10, b - a));
      }
      bounds();
    },
    focusEvent(e) {
      if (!model) return;
      const ev = model.events[e];
      if (!ev) return;
      anchor = null; velC = velZ = 0;
      const p = isolate >= 0 && ev.people.includes(isolate) ? isolate : ev.people[0];
      goalCamZ = laneCenter(p);
      if (ev.kind === "span") {
        goalCenter = (ev.t0 + ev.t1) / 2;
        goalLogPx = Math.log(Math.min(160, visW() * 0.5 / Math.max(1, ev.t1 - ev.t0)));
      } else {
        goalCenter = ev.t0;
        goalLogPx = Math.max(goalLogPx, Math.log(26));
      }
      bounds();
    },
    goToday() {
      if (!model) return;
      anchor = null; velC = 0;
      goalCenter = model.today;
      if (pxPerDay() < 2) goalLogPx = Math.log(5);
      bounds();
    },
    fitAll() {
      if (!model) return;
      anchor = null; velC = 0;
      goalCenter = (model.tMin + model.tMax) / 2;
      goalLogPx = Math.log(visW() * 0.92 / Math.max(14, model.tMax - model.tMin));
      bounds();
    },
    zoomBy(f) {
      anchor = { t: center, xw: 0 };
      goalLogPx += Math.log(f);
      bounds();
    },
    setView(c, ppd, animate = true) {
      anchor = null; velC = 0;
      goalCenter = c;
      if (ppd) goalLogPx = Math.log(ppd);
      if (!animate) { center = goalCenter; logPx = goalLogPx; }
      bounds();
    },
    getView() {
      const half = visW() / 2 / pxPerDay();
      return { t0: center - half, t1: center + half, center, pxPerDay: pxPerDay() };
    },
    stepLane(dir) {
      if (!lanes || lanes.order.length === 0) return;
      const pos = Math.max(0, lanes.order.indexOf(focusLane));
      const next = lanes.order[Math.min(lanes.order.length - 1, Math.max(0, pos + dir))];
      api.focusPerson(next);
    },
  };

  // ── Grid ticks ──
  let gridKey = "";
  let ticks: ReturnType<typeof buildTicks> = [];
  let tickLvl: TickLevel = "month";
  function updateGrid(t0: number, t1: number) {
    if (!lanes) return;
    const lvl = tickLevel(pxPerDay());
    const span = t1 - t0;
    const g0 = Math.floor((t0 - span) / Math.max(1, span)) * Math.max(1, span);
    const key = `${lvl}:${g0}:${Math.round(span)}:${Math.round(lanes.depth)}`;
    if (key === gridKey) return;
    gridKey = key;
    tickLvl = lvl;
    ticks = buildTicks(g0, g0 + span * 3 + Math.max(1, span), lvl);
    gridGeo.dispose();
    gridGeo = new THREE.BufferGeometry();
    const n = ticks.length;
    const pos = new Float32Array(n * 6), aT = new Float32Array(n * 2), aMajor = new Float32Array(n * 2);
    const zFront = 40, zBack = lanes.depth - 120;
    ticks.forEach((tk, i) => {
      pos[i * 6 + 2] = zFront; pos[i * 6 + 5] = zBack;
      aT[i * 2] = aT[i * 2 + 1] = tk.t;
      aMajor[i * 2] = aMajor[i * 2 + 1] = tk.major ? 1 : 0;
    });
    gridGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    gridGeo.setAttribute("aT", new THREE.BufferAttribute(aT, 1));
    gridGeo.setAttribute("aMajor", new THREE.BufferAttribute(aMajor, 1));
    grid.geometry = gridGeo;
  }

  function viewLabel(t0: number, t1: number): string {
    const a = dayToDate(t0), b = dayToDate(t1);
    const ya = a.getUTCFullYear(), yb = b.getUTCFullYear();
    if (t1 - t0 < 20) return `${MONTHS[a.getUTCMonth()]} ${a.getUTCDate()} – ${a.getUTCMonth() === b.getUTCMonth() ? "" : MONTHS[b.getUTCMonth()] + " "}${b.getUTCDate()}, ${yb}`;
    if (ya === yb) return a.getUTCMonth() === b.getUTCMonth() ? `${MONTHS[a.getUTCMonth()]} ${ya}` : `${MONTHS[a.getUTCMonth()]} – ${MONTHS[b.getUTCMonth()]} ${yb}`;
    return `${MONTHS[a.getUTCMonth()]} ${ya} – ${MONTHS[b.getUTCMonth()]} ${yb}`;
  }

  // ── Overlays ──
  const headerYs: Array<{ p: number; y: number }> = [];
  function updateHeaders() {
    if (!model || !lanes) return;
    headerYs.length = 0;
    const placed: number[] = [];
    const left = leftInset + 14;
    // Front lanes first (they're nearest and drawn largest); focused lane always wins
    const order = [...lanes.order].sort((a, b) => (a === focusLane ? -1 : b === focusLane ? 1 : laneZ[b] - laneZ[a]));
    let used = 0;
    const seen = new Set<number>();
    for (const p of order) {
      if (used >= HEADER_POOL) break;
      if (!proj(0, 0, laneZ[p])) continue;
      const y = sp.y;
      if (y < RULER_Y + 34 || y > H - 96) continue;
      if (placed.some((py) => Math.abs(py - y) < 27)) continue;
      const fog = fogAt(sp.w);
      if (fog < 0.08) continue;
      placed.push(y);
      headerYs.push({ p, y });
      const h = headers[used++];
      seen.add(p);
      if (h.key !== p) {
        h.key = p;
        const person = model.people[p];
        h.av.textContent = initials(person.name);
        h.av.style.background = personColor(person.hue, true);
        h.name.textContent = person.name;
        h.count.textContent = String(person.events.length);
      }
      const emph = p === focusLane || p === isolate || p === hoverLane;
      const dim = isolate >= 0 && p !== isolate ? 0.45 : 1;
      h.el.style.opacity = String(Math.min(1, fog * 1.4) * dim);
      h.el.style.transform = `translate3d(${left}px, ${y - 12}px, 0)`;
      h.el.style.boxShadow = emph ? `0 0 0 1.5px ${personColor(model.people[p].hue, palette.dark)}` : "none";
    }
    for (let i = used; i < HEADER_POOL; i++) { headers[i].el.style.opacity = "0"; headers[i].el.style.pointerEvents = "none"; headers[i].key = -1; }
    for (let i = 0; i < used; i++) headers[i].el.style.pointerEvents = "auto";
  }

  function fogAt(depth: number) {
    const a = U.uFogNear.value, b = U.uFogFar.value;
    const k = Math.min(1, Math.max(0, (depth - a) / (b - a)));
    return 1 - k * k * (3 - 2 * k);
  }

  function updateRuler(t0: number, t1: number) {
    if (!lanes) return;
    const z = focusLane >= 0 ? laneZ[focusLane] : camZ;
    const minGap = tickLvl === "day" ? 26 : 40;
    let used = 0;
    let lastX = -1e9;
    const left = leftInset + 8, right = W - rightInset - 8;
    const todayX = model && proj(xOfT(model.today), 0, z) ? sp.x : -1e9;
    const chipHalf = todayChip.offsetWidth / 2 + 8;
    for (const tk of ticks) {
      if (tk.t < t0 - 2 || tk.t > t1 + 2) continue;
      if (!proj(xOfT(tk.t), 0, z)) continue;
      const x = sp.x;
      if (x < left || x > right) continue;
      if (x + 30 > todayX - chipHalf && x < todayX + chipHalf) continue;
      if (x - lastX < (tk.major ? minGap * 0.8 : minGap)) continue;
      if (used >= TICK_POOL) break;
      lastX = x;
      const elT = tickEls[used++];
      if (elT.textContent !== tk.label) elT.textContent = tk.label;
      elT.style.fontSize = tk.major ? "11px" : "10px";
      elT.style.fontWeight = tk.major ? "500" : "400";
      elT.style.color = palette.dark ? (tk.major ? "rgba(255,255,255,0.86)" : "rgba(255,255,255,0.42)") : (tk.major ? "#2d2520" : "#8b7868");
      elT.style.opacity = "1";
      elT.style.transform = `translate3d(${x + 4}px, 0, 0)`;
    }
    for (let i = used; i < TICK_POOL; i++) tickEls[i].style.opacity = "0";

    // Today chip
    if (model && proj(xOfT(model.today), 0, z) && sp.x > left && sp.x < right) {
      todayChip.textContent = `Today · ${MONTHS[dayToDate(model.today).getUTCMonth()]} ${dayToDate(model.today).getUTCDate()}`;
      todayChip.style.opacity = "1";
      todayChip.style.transform = `translate3d(${sp.x - todayChip.offsetWidth / 2}px, 0, 0)`;
    } else todayChip.style.opacity = "0";

    // Cursor time
    if (mouse && !drag) {
      const g = groundAt(mouse.x, mouse.y);
      if (g && mouse.y > RULER_Y + 30) {
        const t = tOfX(g.x);
        const d = dayToDate(t);
        const fine = pxPerDay() > 60;
        cursorChip.textContent = `${WEEKDAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}${fine ? ` · ${String(d.getUTCHours()).padStart(2, "0")}:00` : `, ${d.getUTCFullYear()}`}`;
        cursorChip.style.opacity = "1";
        cursorChip.style.transform = `translate3d(${Math.round(mouse.x - cursorChip.offsetWidth / 2)}px, 0, 0)`;
      } else cursorChip.style.opacity = "0";
    } else cursorChip.style.opacity = "0";
  }

  type Cand = { key: string; x: number; y: number; w: number; h: number; pri: number; title: string; sub: string; color: string; maxW: number };
  const cands: Cand[] = [];
  const boxes: Array<[number, number, number, number]> = [];
  function textW(s: string, px = 6.4) { return Math.min(260, s.length * px + 16); }

  function updateLabels() {
    if (!model || !lanes) return;
    const m = model;
    cands.length = 0;
    const left = leftInset + 8, right = W - rightInset - 8, top = RULER_Y + 30, bottom = H - 96;
    const ppu = pxPerUnit();
    // Headers occupy the left gutter
    boxes.length = 0;
    for (const h of headerYs) boxes.push([leftInset + 10, h.y - 13, leftInset + 10 + textW(m.people[h.p].name, 7) + 34, h.y + 13]);

    const activeLanes = new Set<number>();
    const nearLanes = new Set<number>();
    if (focusLane >= 0) {
      activeLanes.add(focusLane);
      const pos = lanes.order.indexOf(focusLane);
      for (let k = Math.max(0, pos - 1); k <= Math.min(lanes.order.length - 1, pos + 2); k++) nearLanes.add(lanes.order[k]);
    }
    if (isolate >= 0) activeLanes.add(isolate);
    if (hoverLane >= 0) activeLanes.add(hoverLane);

    // Spans: sticky titles above the bar, on any visible lane
    for (let i = 0; i < spans.length; i++) {
      const s = spans[i];
      const special = s.event === selEvent || relSet.has(s.event);
      if (!special && !nearLanes.has(s.person) && !activeLanes.has(s.person)) continue;
      if (!visibleFor(s.person, s.event)) continue;
      const { x0, x1, z } = spanEnds(i);
      if (!proj(x0, 0, z)) continue;
      const ax = sp.x, ay = sp.y, depth = sp.w;
      if (!proj(x1, 0, z)) continue;
      const bx = sp.x;
      const vis0 = Math.max(ax, left), vis1 = Math.min(bx, right);
      if (ay < top || ay > bottom) continue;
      const visW = vis1 - vis0;
      if (visW < (special ? 20 : 64)) continue;
      const fog = fogAt(depth);
      if (fog < 0.35 && !special) continue;
      const ev = m.events[s.event];
      const lane = activeLanes.has(s.person);
      const pri = (s.event === selEvent ? 2000 : 0) + (special ? 600 : 0) + (lane ? 400 : 0) + Math.min(160, visW / 4) + fog * 80;
      const half = Math.max(2.5, SPAN_HALF * ppu * dist / depth * Math.sin(el));
      cands.push({
        key: `s${s.event}:${s.person}`, x: vis0 + 2, y: ay - half - 32, w: Math.min(visW, textW(displayName(ev.node))), h: 32, pri,
        title: displayName(ev.node), sub: `${ev.status ?? ev.node.databaseName}${ev.overdue ? " · overdue" : ""}`, color: ev.node.color, maxW: Math.max(40, visW - 4),
      });
    }
    // Points: titles on the focused / isolated / hovered lanes, plus selection & related anywhere
    for (let i = 0; i < pts.length; i++) {
      const it = pts[i];
      const special = it.event === selEvent || relSet.has(it.event);
      if (!special && !activeLanes.has(it.person)) continue;
      if (!visibleFor(it.person, it.event)) continue;
      const cnt = ptTo[i * 3 + 2], slot = ptTo[i * 3 + 1];
      if (!projPoint(i)) continue;
      if (sp.x < left || sp.x > right || sp.y < top || sp.y > bottom) continue;
      const ev = m.events[it.event];
      const rpx = wp.r * ppu * dist / sp.w;
      if (cnt > 1 && !special) {
        // Column: one badge at the top
        if (slot !== cnt - 1 || cnt <= MAX_STACK) continue;
        cands.push({
          key: `c${it.person}:${ptTo[i * 3]}`, x: sp.x - 14, y: sp.y - rpx - 20, w: 28, h: 16, pri: 120 + cnt,
          title: "", sub: `${cnt}`, color: "", maxW: 40,
        });
        continue;
      }
      const pri = (it.event === selEvent ? 2000 : 0) + (special ? 600 : 0) + 260 - Math.abs(sp.x - (left + right) / 2) * 0.05;
      cands.push({
        key: `p${it.event}:${it.person}`, x: sp.x + rpx + 6, y: sp.y - 15, w: textW(displayName(ev.node)), h: 32, pri,
        title: displayName(ev.node), sub: describeWhen(ev, m.today).split(" · ")[0], color: ev.node.color, maxW: 240,
      });
    }

    cands.sort((a, b) => b.pri - a.pri);
    for (const l of labels) l.used = false;
    const byKey = new Map<string, Label>();
    for (const l of labels) if (l.key) byKey.set(l.key, l);
    const placedList: Array<{ c: Cand; l: Label | null }> = [];
    let count = 0;
    for (const c of cands) {
      if (count >= LABEL_POOL) break;
      const x0 = c.x, y0 = c.y, x1 = c.x + Math.min(c.w, c.maxW), y1 = c.y + c.h;
      if (boxes.some((b) => x0 < b[2] && x1 > b[0] && y0 < b[3] && y1 > b[1])) continue;
      boxes.push([x0, y0, x1, y1]);
      const l = byKey.get(c.key) ?? null;
      if (l) l.used = true;
      placedList.push({ c, l });
      count++;
    }
    const free = labels.filter((l) => !l.used);
    for (const { c, l: existing } of placedList) {
      const l = existing ?? free.shift();
      if (!l) continue;
      l.used = true;
      if (l.key !== c.key) {
        l.key = c.key;
        l.title.textContent = c.title;
        l.title.style.display = c.title ? "" : "none";
        l.sub.textContent = c.sub;
        l.el.style.borderLeft = c.color ? `2px solid ${c.color}` : "none";
        l.el.style.padding = c.title ? "2px 7px 3px" : "1px 6px";
        l.sub.style.fontSize = c.title ? "9px" : "9.5px";
      }
      l.el.style.maxWidth = `${Math.round(c.maxW)}px`;
      l.el.style.opacity = "1";
      l.el.style.transform = `translate3d(${Math.round(c.x)}px, ${Math.round(c.y)}px, 0)`;
    }
    for (const l of labels) if (!l.used) { l.el.style.opacity = "0"; l.key = ""; }
  }

  function updateTooltip() {
    if (!model || !hover || !mouse || drag) { tooltip.style.opacity = "0"; return; }
    const ev = model.events[hover.event];
    const d = palette.dark;
    const who = ev.people.map((p) => model!.people[p].name);
    const stateColor = ev.state === "done" ? "#4ade80" : ev.state === "active" ? "#60a5fa" : ev.state === "blocked" ? "#f87171" : (d ? "rgba(255,255,255,0.5)" : "#8b7868");
    const key = `${hover.event}`;
    if (tooltip.dataset.key !== key) {
      tooltip.dataset.key = key;
      tooltip.innerHTML = `
        <div style="display:flex;align-items:center;gap:6px;font-family:'DM Mono',monospace;font-size:9.5px;letter-spacing:0.06em;text-transform:uppercase;color:${d ? "rgba(255,255,255,0.5)" : "#8b7868"}">
          <span style="width:7px;height:7px;border-radius:50%;background:${esc(ev.node.color)};flex-shrink:0"></span>${esc(ev.node.databaseName)}
          ${ev.status ? `<span style="margin-left:auto;color:${stateColor};letter-spacing:0.02em;text-transform:none">● ${esc(ev.status)}</span>` : ""}
        </div>
        <div style="margin-top:4px;font-family:'Geist',sans-serif;font-size:13px;font-weight:600;line-height:1.3;color:${d ? "#fff" : "#2d2520"}">${esc(displayName(ev.node))}</div>
        <div style="margin-top:4px;font-family:'DM Mono',monospace;font-size:10.5px;color:${ev.overdue ? "#f87171" : d ? "rgba(255,255,255,0.7)" : "#5c4f44"}">${esc(describeWhen(ev, model.today))}</div>
        ${who.length > 1 ? `<div style="margin-top:5px;font-family:'Geist',sans-serif;font-size:11px;color:${d ? "rgba(255,255,255,0.55)" : "#8b7868"}">with ${esc(who.filter((_, i) => ev.people[i] !== hover!.person).join(", "))}</div>` : ""}
        ${ev.detail ? `<div style="margin-top:6px;font-family:'Geist',sans-serif;font-size:11px;line-height:1.4;color:${d ? "rgba(255,255,255,0.6)" : "#5c4f44"};display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden">${esc(ev.detail)}</div>` : ""}`;
    }
    const tw = tooltip.offsetWidth, th = tooltip.offsetHeight;
    let x = mouse.x + 16, y = mouse.y + 16;
    if (x + tw > W - rightInset - 8) x = mouse.x - tw - 16;
    if (y + th > H - 8) y = mouse.y - th - 16;
    tooltip.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    tooltip.style.opacity = "1";
  }

  // ── Resize ──
  function resize() {
    W = Math.max(1, mount.clientWidth); H = Math.max(1, mount.clientHeight);
    renderer.setSize(W, H);
    composer.setSize(W, H);
    applyViewOffset();
  }
  function applyViewOffset() {
    const s = (leftInset - rightInset) / 2;
    const full = W + 2 * Math.abs(s);
    camera.aspect = full / H;
    camera.setViewOffset(full, H, Math.abs(s) - s, 0, W, H);
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(mount);
  resize();

  // ── Frame ──
  let raf = 0;
  let prev = performance.now();
  let lastHoverPick = 0;
  const target = new THREE.Vector3();

  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - prev) / 1000);
    prev = now;
    U.uTime.value += dt;
    if (!model || !lanes) { renderer.setClearColor(palette.bgTop); renderer.render(scene, camera); return; }

    // Inertia
    if (!drag) {
      if (Math.abs(velC) > 1e-4 || Math.abs(velZ) > 1e-4) {
        goalCenter = center = center + velC * dt;
        goalCamZ = camZ = camZ + velZ * dt;
        const decay = Math.exp(-dt * 4.5);
        velC *= decay; velZ *= decay;
        if (Math.abs(velC) * pxPerDay() < 6) velC = 0;
        if (Math.abs(velZ) < 0.2) velZ = 0;
        bounds();
      }
    }
    // Smooth toward goals
    const k = 1 - Math.exp(-dt * 8);
    logPx += (goalLogPx - logPx) * k;
    if (anchor) {
      center = anchor.t - anchor.xw / scaleNow();
      goalCenter = center;
      if (Math.abs(goalLogPx - logPx) < 1e-4) { logPx = goalLogPx; anchor = null; }
    } else {
      center += (goalCenter - center) * k;
    }
    camZ += (goalCamZ - camZ) * k;
    el += (goalEl - el) * (1 - Math.exp(-dt * 3.2));
    dist += (goalDist - dist) * (1 - Math.exp(-dt * 3.2));

    // Lane z animation (sort changes)
    let lanesDirty = false;
    for (let p = 0; p < P; p++) {
      const d = laneGoal[p] - laneZ[p];
      if (Math.abs(d) > 1e-3) { laneZ[p] += d * (1 - Math.exp(-dt * 6)); lanesDirty = true; }
      else if (d !== 0) { laneZ[p] = laneGoal[p]; lanesDirty = true; }
    }
    // Focus lane = nearest to camera target
    let best = -1, bestD = Infinity;
    for (let p = 0; p < P; p++) {
      const d = Math.abs(laneZ[p] - (TRACK_BASE + lanes.tracks[p] * TRACK_DEPTH) * 0.45 - camZ);
      if (d < bestD) { bestD = d; best = p; }
    }
    if (best !== focusLane) { focusLane = best; U.uFocusLane.value = best; cbRef.current.onFocusLane(best); }

    // Lane texture: z, dim, tracks, emphasis
    const data = lanesTexData.data;
    for (let p = 0; p < P; p++) {
      const emph = p === hoverLane || p === isolate ? 1 : p === focusLane ? 0.5 : 0;
      if (data[p * 4] !== laneZ[p] || data[p * 4 + 3] !== emph) lanesDirty = true;
      data[p * 4] = laneZ[p]; data[p * 4 + 1] = laneDim[p]; data[p * 4 + 2] = lanes.tracks[p]; data[p * 4 + 3] = emph;
    }
    if (lanesDirty && lanesTexData.tex) lanesTexData.tex.needsUpdate = true;

    // Camera
    const look = camZ - dist * LOOK_AHEAD;
    target.set(0, TARGET_Y, look);
    camera.position.set(0, TARGET_Y + dist * Math.sin(el), look + dist * Math.cos(el));
    camera.lookAt(target);
    camera.near = Math.max(0.5, dist * 0.08);
    camera.far = dist + Math.abs(lanes.depth) + 600;
    camera.updateProjectionMatrix();
    prepProj();

    // Uniforms
    const ppu = pxPerUnit();
    const scale = scaleNow();
    U.uCenter.value = center;
    U.uScale.value = scale;
    U.uFogNear.value = dist * 1.05 + 20;
    U.uFogFar.value = dist * 1.05 + 190;
    const bpx = beadPx();
    beadMat.uniforms.uRadius.value = bpx / ppu;
    beadMat.uniforms.uStep.value = (bpx * 2.35) / ppu;
    beadMat.uniforms.uPxPerUnit.value = H / (2 * TAN_HALF);
    spanMat.uniforms.uMinW.value = 5 / ppu;
    laneMat.uniforms.uHalfW.value = (visW() + leftInset + rightInset) / ppu * 3 + 200;
    bgMat.uniforms.uHorizonY.value = 0.5 + Math.cos(el) * 0.45;

    // Floor & today geometry follow the view
    {
      const hw = laneMat.uniforms.uHalfW.value as number;
      const zF = Math.max(camZ + dist, 40), zB = lanes.depth - 220;
      const a = floorGeo.getAttribute("position") as THREE.BufferAttribute;
      a.setXYZ(0, -hw, -0.02, zF); a.setXYZ(1, hw, -0.02, zF); a.setXYZ(2, hw, -0.02, zB); a.setXYZ(3, -hw, -0.02, zB);
      a.needsUpdate = true;
      const w = 0.09;
      const tw = todayGeo.getAttribute("position") as THREE.BufferAttribute;
      const zf = 8, zb = lanes.depth - 30, hgt = 16;
      tw.setXYZ(0, 0, 0, zf); tw.setXYZ(1, 0, 0, zb); tw.setXYZ(2, 0, hgt, zb); tw.setXYZ(3, 0, hgt, zf);
      tw.needsUpdate = true;
      todayMat.uniforms.uHeight.value = hgt;
      const tl = todayLineGeo.getAttribute("position") as THREE.BufferAttribute;
      tl.setXYZ(0, -w, 0.02, zf); tl.setXYZ(1, w, 0.02, zf); tl.setXYZ(2, w, 0.02, zb); tl.setXYZ(3, -w, 0.02, zb);
      tl.needsUpdate = true;
    }

    // Reveal sweep (intro)
    const view = api.getView();
    if (revealStart >= 0) {
      const k2 = Math.min(1, (now - revealStart) / 2200);
      const e = 1 - Math.pow(1 - k2, 3);
      const from = view.t0 - (view.t1 - view.t0) * 0.05, to = Math.max(view.t1, model.tMax) + 1;
      U.uReveal.value = from + (to - from) * e;
      U.uRevealSoft.value = Math.max(1, (view.t1 - view.t0) * 0.08);
      if (k2 >= 1) { revealStart = -1; U.uReveal.value = 1e9; }
    }

    // Column re-binning + morph
    restack();
    morphNow.k = morphProgress();
    beadMat.uniforms.uMorph.value = morphNow.k;

    updateGrid(view.t0, view.t1);
    const label = viewLabel(view.t0, view.t1);
    if (label !== lastViewLabel) { lastViewLabel = label; cbRef.current.onViewLabel(label, tickLvl); }

    // Hover pick (throttled)
    if (mouse && !drag && (mouseMoved || now - lastHoverPick > 120)) {
      mouseMoved = false;
      lastHoverPick = now;
      const h = pick(mouse.x, mouse.y);
      const changed = (h?.event ?? -1) !== (hover?.event ?? -1) || (h?.person ?? -1) !== (hover?.person ?? -1);
      hover = h;
      if (changed) { U.uHover.value = h ? h.event : -1; canvas.style.cursor = h ? "pointer" : "grab"; }
    } else if (!mouse && hover) {
      hover = null; U.uHover.value = -1;
    }

    updateHeaders();
    updateRuler(view.t0, view.t1);
    updateLabels();
    updateTooltip();

    if (palette.dark) {
      composer.render();
    } else {
      renderer.render(scene, camera);
    }
  }
  raf = requestAnimationFrame(frame);

  applyTheme();

  return {
    api,
    setData(m, L) {
      const modelChanged = m !== model;
      model = m;
      lanes = L;
      if (modelChanged) gridKey = "";
      rebuild();
    },
    setTheme(dark) {
      palette = dark ? DARK : LIGHT;
      applyTheme();
    },
    setSelection(e, rel) {
      selEvent = e ?? -1;
      related = rel;
      applySelection();
    },
    setIsolate(p) {
      isolate = p ?? -1;
      U.uIsolate.value = isolate;
      if (selEvent >= 0) applySelection();
    },
    setInsets(l, r) {
      if (l === leftInset && r === rightInset) return;
      leftInset = l; rightInset = r;
      applyViewOffset();
      bounds();
    },
    dispose() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      for (const d of disposables) d.dispose();
      laneGeo.dispose(); spanGeo.dispose(); beadGeo.dispose(); threadGeo.dispose(); arcGeo.dispose(); gridGeo.dispose();
      lanesTexData.tex?.dispose();
      composer.dispose();
      renderer.dispose();
      overlay.remove();
      canvas.remove();
    },
  };
}

// ─── Component ────────────────────────────────────────────────────────────────

export function TimelineCanvas(props: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const cbRef = useRef<Cb>(props);
  cbRef.current = props;
  const { model, lanes, darkMode, selectedEvent, relatedEvents, isolatePerson, leftInset, rightInset, apiRef } = props;

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const engine = createEngine(mount, cbRef);
    engineRef.current = engine;
    apiRef.current = engine.api;
    return () => {
      engine.dispose();
      engineRef.current = null;
      apiRef.current = null;
    };
  }, [apiRef]);

  useEffect(() => { engineRef.current?.setInsets(leftInset, rightInset); }, [leftInset, rightInset]);
  useEffect(() => { engineRef.current?.setTheme(darkMode); }, [darkMode]);
  useEffect(() => { engineRef.current?.setData(model, lanes); }, [model, lanes]);
  useEffect(() => { engineRef.current?.setIsolate(isolatePerson); }, [isolatePerson]);
  useEffect(() => { engineRef.current?.setSelection(selectedEvent, relatedEvents); }, [selectedEvent, relatedEvents]);

  return <div ref={mountRef} style={{ position: "absolute", inset: 0, overflow: "hidden" }} />;
}
