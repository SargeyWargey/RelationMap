"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

import { orbitPosition, sampleGalaxyShape, type Body, type Universe } from "@/lib/orreryUniverse";

// ─── Types ────────────────────────────────────────────────────────────────────

type Props = {
  universe: Universe;
  /** Fly to a body (-1 = whole universe). Bump `seq` to re-trigger. */
  focusRequest: { index: number; seq: number } | null;
  selectedIndex: number | null;
  /** Body to ring-highlight from outside the canvas (e.g. Atlas hover). */
  highlightIndex: number | null;
  speed: number;
  paused: boolean;
  onFocusChange: (index: number) => void;
  onSelect: (index: number | null) => void;
};

type Engine = {
  flyTo: (index: number) => void;
  dispose: () => void;
};

type Live = Omit<Props, "universe" | "focusRequest">;

// ─── Constants ────────────────────────────────────────────────────────────────

const FOV = 50;
const ARC_SEGMENTS = 20;
const LABEL_POOL = 30;
const MIN_LABEL_EXTENT_PX = 26;
const RESOLVE_PX = 70;            // a container's children become pickable past this on-screen size
const IDLE_ORBIT_MS = 9000;
const BG_STAR_COUNT = 5000;

const PLANET_TYPE_INDEX: Record<string, number> = {
  rocky: 0, "gas-giant": 1, ocean: 2, desert: 3, "ice-giant": 4, lava: 5, jungle: 6,
  cratered: 7, icy: 8, volcanic: 9, dusty: 10, "tidally-locked": 11,
};
const TYPE_DOT_COLOR = [
  "#b79a86", "#e0b27a", "#4f8fe0", "#d9a35c", "#9fd6e8", "#ff7a3c", "#4fb08a",
  "#a9a39b", "#dfe9f2", "#c26a3e", "#b89a78", "#c9b8a4",
];
const TYPE_LABEL: Record<string, string> = {
  rocky: "rocky world", "gas-giant": "gas giant", ocean: "ocean world", desert: "desert world",
  "ice-giant": "ice giant", lava: "lava world", jungle: "jungle world",
  cratered: "cratered moon", icy: "icy moon", volcanic: "volcanic moon", dusty: "dusty moon",
  "tidally-locked": "tidally locked moon",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hashFloat(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13;
  return (h >>> 0) / 0x100000000;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function easeInOutCubic(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function plural(n: number, word: string) {
  return `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;
}

function childTierWord(b: Body, u: Universe): string | null {
  if (b.children.length === 0) return null;
  const t = u.bodies[b.children[0]].tier;
  return plural(b.children.length, t === "star" ? "star" : t === "planet" ? (b.tier === "galaxy" ? "rogue world" : "planet") : "moon");
}

export function describeBody(b: Body, u: Universe): string {
  const kids = childTierWord(b, u);
  if (b.region === "asteroid-field") return `${plural(b.children.length, "loose moon")}`;
  if (b.tier === "planet" || b.tier === "moon") return [kids, TYPE_LABEL[b.kind]].filter(Boolean).join(" · ");
  return kids ?? (b.tier === "galaxy" ? "empty galaxy" : b.tier === "star" ? "no planets" : "");
}

// ─── Shaders ──────────────────────────────────────────────────────────────────

const NOISE_GLSL = /* glsl */`
  float hash13(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
  }
  float vnoise(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash13(i), hash13(i + vec3(1,0,0)), f.x), mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), f.x), f.y),
      mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), f.x), mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), f.x), f.y),
      f.z);
  }
  float fbm(vec3 p) {
    float a = 0.5, s = 0.0;
    for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; }
    return s;
  }
`;

// Nebula sky — a sphere pinned to the camera and the far plane
const SKY_VERT = /* glsl */`
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 p = projectionMatrix * viewMatrix * vec4(cameraPosition + position, 1.0);
    gl_Position = p.xyww;
  }
`;
const SKY_FRAG = /* glsl */`
  ${NOISE_GLSL}
  varying vec3 vDir;
  void main() {
    vec3 d = normalize(vDir);
    float n1 = fbm(d * 2.1 + vec3(3.1, 0.4, 7.7));
    float n2 = fbm(d * 4.3 + vec3(9.7, 1.3, 4.4) + n1);
    float band = exp(-pow(d.y * 2.6 + (n1 - 0.5) * 1.6, 2.0));
    float cloud = smoothstep(0.42, 0.9, n2);
    vec3 col = vec3(0.0035, 0.0042, 0.010);
    col += band * 0.018 * mix(vec3(0.55, 0.42, 1.0), vec3(0.25, 0.65, 0.95), n1);
    col += cloud * 0.022 * mix(vec3(0.20, 0.45, 0.95), vec3(0.95, 0.35, 0.55), smoothstep(0.3, 0.8, n1));
    col += band * cloud * 0.02 * vec3(1.0, 0.75, 0.55);
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

const BG_STAR_VERT = /* glsl */`
  attribute float aSize;
  attribute vec3 aColor;
  attribute float aTw;
  uniform float uTime;
  uniform float uDpr;
  varying vec3 vColor;
  varying float vA;
  void main() {
    vec4 p = projectionMatrix * viewMatrix * vec4(cameraPosition + position, 1.0);
    gl_Position = p.xyww;
    gl_PointSize = aSize * uDpr;
    vColor = aColor;
    vA = 0.65 + 0.35 * sin(uTime * (0.4 + aTw * 1.6) + aTw * 80.0);
  }
`;
const BG_STAR_FRAG = /* glsl */`
  varying vec3 vColor;
  varying float vA;
  void main() {
    float d = length(gl_PointCoord * 2.0 - 1.0);
    float a = (1.0 - smoothstep(0.0, 1.0, d)) * vA;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vColor * a, 1.0);
    #include <colorspace_fragment>
  }
`;

// Galaxy dust — world-sized soft points that dim when you're inside the galaxy
const DUST_VERT = /* glsl */`
  attribute vec3 aColor;
  attribute float aSize;
  uniform float uPxPerUnit;
  uniform float uDpr;
  uniform float uFade;
  varying vec3 vColor;
  varying float vA;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    float px = aSize * uPxPerUnit / max(-mv.z, 1e-4);
    gl_PointSize = clamp(px, 1.2, 7.0) * uDpr;
    vA = uFade * clamp(px * 1.4, 0.35, 1.0) * clamp(7.0 / max(px, 1.0), 0.15, 1.0);
    vColor = aColor;
  }
`;
const DUST_FRAG = /* glsl */`
  varying vec3 vColor;
  varying float vA;
  void main() {
    vec2 c = gl_PointCoord * 2.0 - 1.0;
    float a = exp(-dot(c, c) * 3.2) * vA;
    if (a < 0.004) discard;
    gl_FragColor = vec4(vColor * a, 1.0);
    #include <colorspace_fragment>
  }
`;

// Point glows for stars, galaxy cores and far-away planets/moons
const GLOW_VERT = /* glsl */`
  attribute float aRadius;    // world radius of the body
  attribute vec3 aColor;
  attribute float aBoost;     // hover / selection emphasis
  attribute float aKind;      // 0 star, 1 galaxy core, 2 planet/moon dot
  attribute float aExtent;    // galaxy cores: fade out once inside
  uniform float uPxPerUnit;
  uniform float uDpr;
  varying vec3 vColor;
  varying float vPx;
  varying float vA;
  varying float vKind;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    float depth = max(-mv.z, 1e-5);
    float rpx = aRadius * uPxPerUnit / depth;
    float px; float a = 1.0;
    if (aKind < 0.5) {
      px = rpx < 3.0 ? max(rpx * 7.0, 2.4 + aRadius * 2.6) : rpx * 2.4 + 14.0;
      px = clamp(px, 2.0, 240.0);
    } else if (aKind < 1.5) {
      px = clamp(rpx * 0.9, 2.0, 240.0);
      a = smoothstep(aExtent * 0.5, aExtent * 2.2, depth) * 0.75;
    } else {
      px = 2.4 + aRadius * 14.0;
      a = 1.0 - smoothstep(1.2, 3.5, rpx);     // hand off to the real sphere up close
    }
    px *= 1.0 + aBoost * 0.8;
    a = max(a, aBoost * 0.9);
    gl_PointSize = px * uDpr;
    vPx = px; vA = a; vColor = aColor; vKind = aKind;
  }
`;
const GLOW_FRAG = /* glsl */`
  varying vec3 vColor;
  varying float vPx;
  varying float vA;
  varying float vKind;
  void main() {
    if (vA < 0.01) discard;
    vec2 c = gl_PointCoord * 2.0 - 1.0;
    float d = length(c);
    float core = exp(-d * d * 26.0);
    float halo = exp(-d * 4.6) * 0.42;
    float spikes = 0.0;
    if (vKind < 0.5) {
      spikes = (exp(-abs(c.y) * 60.0) * exp(-abs(c.x) * 2.4) + exp(-abs(c.x) * 60.0) * exp(-abs(c.y) * 2.4))
             * 0.4 * smoothstep(4.0, 40.0, vPx);
    }
    float k = vKind < 1.5 ? (core * 2.4 + halo + spikes) : (core * 1.6 + halo * 0.6);
    k *= vA * (1.0 - smoothstep(0.85, 1.0, d));
    if (k < 0.003) discard;
    gl_FragColor = vec4(vColor * k, 1.0);
    #include <colorspace_fragment>
  }
`;

const STAR_VERT = /* glsl */`
  attribute vec3 aColor;
  varying vec3 vColor;
  varying vec3 vN;
  varying vec3 vObj;
  varying vec3 vWorld;
  void main() {
    vObj = position;
    vN = normalize(mat3(instanceMatrix) * normal);
    vec4 w = instanceMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vColor = aColor;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;
const STAR_FRAG = /* glsl */`
  ${NOISE_GLSL}
  uniform float uTime;
  varying vec3 vColor;
  varying vec3 vN;
  varying vec3 vObj;
  varying vec3 vWorld;
  void main() {
    vec3 V = normalize(cameraPosition - vWorld);
    float mu = clamp(dot(normalize(vN), V), 0.0, 1.0);
    float gran = fbm(vObj * 7.0 + vec3(uTime * 0.12));
    float spots = smoothstep(0.62, 0.75, fbm(vObj * 2.5 + 11.0));
    vec3 col = vColor * (0.55 + 0.75 * gran) * mix(0.55, 1.0, sqrt(mu)) * (1.0 - 0.35 * spots);
    col += vec3(1.0, 0.95, 0.85) * pow(mu, 3.0) * 0.4;
    gl_FragColor = vec4(col * 1.35, 1.0);
    #include <colorspace_fragment>
  }
`;

// Planets and moons — procedural surfaces lit by their parent star
const PLANET_VERT = /* glsl */`
  attribute float aType;
  attribute float aSeed;
  attribute vec3 aLight;
  attribute float aLit;
  attribute float aBoost;
  uniform float uTime;
  varying vec3 vTex;
  varying vec3 vN;
  varying vec3 vWorld;
  varying vec3 vLight;
  varying float vType;
  varying float vSeed;
  varying float vLit;
  varying float vBoost;
  void main() {
    float spin = uTime * (0.05 + aSeed * 0.12) + aSeed * 40.0;
    float cs = cos(spin), sn = sin(spin);
    vTex = vec3(cs * position.x - sn * position.z, position.y, sn * position.x + cs * position.z);
    vN = normalize(mat3(instanceMatrix) * normal);
    vec4 w = instanceMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vLight = aLight;
    vType = aType; vSeed = aSeed; vLit = aLit; vBoost = aBoost;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;
const PLANET_FRAG = /* glsl */`
  ${NOISE_GLSL}
  varying vec3 vTex;
  varying vec3 vN;
  varying vec3 vWorld;
  varying vec3 vLight;
  varying float vType;
  varying float vSeed;
  varying float vLit;
  varying float vBoost;
  uniform vec3 uAccent;
  vec3 hue(float h) { return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); }
  void main() {
    vec3 p = vTex;
    vec3 o = vec3(vSeed * 37.0, vSeed * 11.0, vSeed * 23.0);
    int t = int(vType + 0.5);
    vec3 albedo; vec3 emissive = vec3(0.0); vec3 atmo = vec3(0.0); float atmoK = 0.0;
    float n = fbm(p * 3.0 + o);
    if (t == 0) {            // rocky
      float r = fbm(p * 6.0 + o);
      albedo = mix(vec3(0.32, 0.27, 0.24), vec3(0.62, 0.52, 0.44), r);
      albedo *= 0.8 + 0.4 * smoothstep(0.3, 0.7, n);
      atmo = vec3(0.6, 0.65, 0.75); atmoK = 0.2;
    } else if (t == 1) {     // gas giant
      float bands = sin(p.y * (10.0 + vSeed * 8.0) + fbm(p * 2.5 + o) * 3.5);
      vec3 c1 = mix(vec3(0.85, 0.66, 0.42), hue(0.05 + vSeed * 0.1) * 0.9, 0.35);
      vec3 c2 = vec3(0.55, 0.36, 0.22);
      albedo = mix(c2, c1, bands * 0.5 + 0.5);
      float storm = smoothstep(0.12, 0.0, length(p.xz - vec2(0.5, 0.3)) + abs(p.y + 0.3) * 0.6);
      albedo = mix(albedo, vec3(0.75, 0.32, 0.2), storm);
      atmo = vec3(1.0, 0.75, 0.45); atmoK = 0.55;
    } else if (t == 2) {     // ocean
      float land = smoothstep(0.52, 0.56, n);
      albedo = mix(vec3(0.03, 0.14, 0.42), vec3(0.24, 0.42, 0.22), land);
      albedo = mix(albedo, vec3(0.92), smoothstep(0.78, 0.86, abs(p.y)));
      float cloud = smoothstep(0.55, 0.75, fbm(p * 4.0 + o + 5.0));
      albedo = mix(albedo, vec3(0.95), cloud * 0.7);
      atmo = vec3(0.35, 0.6, 1.0); atmoK = 0.9;
    } else if (t == 3) {     // desert
      float dunes = sin((p.x + p.z) * 24.0 + n * 8.0) * 0.5 + 0.5;
      albedo = mix(vec3(0.66, 0.40, 0.18), vec3(0.88, 0.66, 0.38), n) * (0.9 + 0.1 * dunes);
      atmo = vec3(1.0, 0.7, 0.45); atmoK = 0.35;
    } else if (t == 4) {     // ice giant
      float bands = sin(p.y * 7.0 + n * 2.0) * 0.5 + 0.5;
      albedo = mix(vec3(0.52, 0.78, 0.9), vec3(0.78, 0.92, 0.98), bands);
      atmo = vec3(0.55, 0.85, 1.0); atmoK = 0.8;
    } else if (t == 5) {     // lava
      float cracks = 1.0 - smoothstep(0.0, 0.06, abs(fbm(p * 5.0 + o) - 0.5));
      albedo = vec3(0.06, 0.04, 0.035) + n * 0.05;
      emissive = vec3(1.0, 0.36, 0.06) * cracks * 2.2;
      atmo = vec3(1.0, 0.4, 0.1); atmoK = 0.4;
    } else if (t == 6) {     // jungle
      albedo = mix(vec3(0.05, 0.22, 0.14), vec3(0.18, 0.42, 0.22), n);
      float cloud = smoothstep(0.5, 0.72, fbm(p * 3.5 + o + 9.0));
      albedo = mix(albedo, vec3(0.9), cloud * 0.75);
      atmo = vec3(0.45, 0.95, 0.75); atmoK = 0.7;
    } else if (t == 7) {     // cratered moon
      float craters = smoothstep(0.62, 0.7, fbm(p * 7.0 + o));
      albedo = vec3(0.5, 0.48, 0.46) * (0.7 + 0.5 * n) * (1.0 - craters * 0.35);
    } else if (t == 8) {     // icy moon
      albedo = mix(vec3(0.78, 0.86, 0.95), vec3(0.95), n);
      float lines = 1.0 - smoothstep(0.0, 0.03, abs(fbm(p * 4.0 + o) - 0.5));
      albedo = mix(albedo, vec3(0.6, 0.45, 0.35), lines * 0.6);
    } else if (t == 9) {     // volcanic moon
      albedo = mix(vec3(0.7, 0.6, 0.25), vec3(0.25, 0.18, 0.12), n);
      float vents = smoothstep(0.7, 0.78, fbm(p * 6.0 + o));
      emissive = vec3(1.0, 0.45, 0.1) * vents * 1.6;
    } else if (t == 10) {    // dusty moon
      albedo = mix(vec3(0.45, 0.32, 0.22), vec3(0.7, 0.55, 0.4), n);
    } else {                 // tidally locked
      albedo = mix(vec3(0.3, 0.27, 0.25), vec3(0.75, 0.7, 0.62), smoothstep(-0.2, 0.2, p.x)) * (0.85 + 0.3 * n);
    }

    vec3 N = normalize(vN);
    vec3 L = normalize(vLight - vWorld);
    vec3 V = normalize(cameraPosition - vWorld);
    float ndl = dot(N, L);
    float diff = smoothstep(-0.12, 1.0, ndl) * mix(0.35, 1.0, vLit);
    float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
    vec3 col = albedo * (0.035 + diff * 1.15) + emissive;
    col += atmo * atmoK * rim * (0.18 + diff);
    // Selection / hover rim in the accent colour
    col += uAccent * rim * vBoost * 1.4;
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

const LINE_VERT = /* glsl */`
  void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const LINE_FRAG = /* glsl */`
  uniform vec3 uColor;
  uniform float uOpacity;
  void main() {
    gl_FragColor = vec4(uColor * uOpacity, 1.0);
    #include <colorspace_fragment>
  }
`;

const BRIDGE_VERT = /* glsl */`
  attribute float aAlpha;
  varying float vA;
  void main() { vA = aAlpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const BRIDGE_FRAG = /* glsl */`
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vA;
  void main() {
    gl_FragColor = vec4(uColor * vA * uOpacity, 1.0);
    #include <colorspace_fragment>
  }
`;

const RING_VERT = /* glsl */`
  attribute float aSize;
  uniform float uPxPerUnit;
  uniform float uDpr;
  varying float vA;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    float px = aSize * uPxPerUnit / max(-mv.z, 1e-5);
    gl_PointSize = clamp(px, 1.0, 6.0) * uDpr;
    vA = clamp(px, 0.3, 1.0);
  }
`;
const RING_FRAG = /* glsl */`
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vA;
  void main() {
    float d = length(gl_PointCoord * 2.0 - 1.0);
    float a = (1.0 - smoothstep(0.4, 1.0, d)) * vA * uOpacity;
    if (a < 0.01) discard;
    gl_FragColor = vec4(uColor * a, 1.0);
    #include <colorspace_fragment>
  }
`;

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
  void main() {
    vec4 cA = projectionMatrix * modelViewMatrix * vec4(aA, 1.0);
    vec4 cB = projectionMatrix * modelViewMatrix * vec4(aB, 1.0);
    vec2 sA = cA.xy / max(cA.w, 1e-5) * uResolution * 0.5;
    vec2 sB = cB.xy / max(cB.w, 1e-5) * uResolution * 0.5;
    vec2 dir = sB - sA;
    dir = length(dir) < 1e-4 ? vec2(1.0, 0.0) : normalize(dir);
    vec4 c = aEnd < 0.5 ? cA : cB;
    c.xy += vec2(-dir.y, dir.x) * aSide * uWidth / uResolution * c.w;
    gl_Position = c;
    vSide = aSide; vT = aT; vColor = aColor;
  }
`;
const ARC_FRAG = /* glsl */`
  uniform float uTime;
  varying float vSide;
  varying float vT;
  varying vec3 vColor;
  void main() {
    float edge = 1.0 - smoothstep(0.35, 1.0, abs(vSide));
    float pulse = exp(-pow((fract(vT * 1.3 - uTime * 0.45) - 0.5) * 6.0, 2.0));
    float a = edge * (0.45 + 0.55 * pulse);
    if (a < 0.01) discard;
    gl_FragColor = vec4(mix(vColor, vec3(1.0), pulse * 0.5) * a * 1.3, 1.0);
    #include <colorspace_fragment>
  }
`;

// ─── Engine ───────────────────────────────────────────────────────────────────

function createEngine(mount: HTMLDivElement, u: Universe, live: { current: Live }): Engine {
  const bodies = u.bodies;
  const N = bodies.length;
  const dpr = Math.min(window.devicePixelRatio, 2);

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(dpr);
  renderer.setSize(mount.clientWidth, mount.clientHeight);
  renderer.domElement.style.display = "block";
  renderer.domElement.style.cursor = "grab";
  renderer.domElement.style.touchAction = "none";
  mount.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, mount.clientWidth / mount.clientHeight, 0.01, 1e5);

  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(dpr);
  composer.setSize(mount.clientWidth, mount.clientHeight);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(mount.clientWidth, mount.clientHeight), 0.85, 0.6, 0.55);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const accent = new THREE.Color(getComputedStyle(document.documentElement).getPropertyValue("--accent-warm").trim() || "#d97757");

  const uTime = { value: 0 };
  const uDpr = { value: dpr };
  const uPxPerUnit = { value: 1 };
  const uResolution = { value: new THREE.Vector2(1, 1) };

  const disposables: Array<{ dispose: () => void }> = [];
  const track = <T extends { dispose: () => void }>(x: T) => { disposables.push(x); return x; };

  // ── Sky + background stars (pinned to the camera) ──
  const sky = new THREE.Mesh(
    track(new THREE.SphereGeometry(1, 48, 24)),
    track(new THREE.ShaderMaterial({ vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false })),
  );
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  scene.add(sky);

  {
    const rand = mulberry32(42);
    const pos = new Float32Array(BG_STAR_COUNT * 3), col = new Float32Array(BG_STAR_COUNT * 3);
    const size = new Float32Array(BG_STAR_COUNT), tw = new Float32Array(BG_STAR_COUNT);
    for (let i = 0; i < BG_STAR_COUNT; i++) {
      const uu = rand() * 2 - 1, th = rand() * Math.PI * 2, s = Math.sqrt(1 - uu * uu);
      // Concentrate a share of stars into the same band as the nebula
      const band = rand() < 0.35 ? (rand() - 0.5) * 0.35 : uu;
      const ss = Math.sqrt(1 - band * band);
      const useBand = band !== uu;
      pos.set([Math.cos(th) * (useBand ? ss : s), useBand ? band : uu, Math.sin(th) * (useBand ? ss : s)], i * 3);
      const temp = rand();
      const c = temp < 0.2 ? [1, 0.82, 0.6] : temp < 0.7 ? [1, 1, 1] : [0.7, 0.82, 1];
      const b = 0.35 + Math.pow(rand(), 3) * 0.9;
      col.set([c[0] * b, c[1] * b, c[2] * b], i * 3);
      size[i] = 0.8 + Math.pow(rand(), 4) * 2.4;
      tw[i] = rand();
    }
    const geo = track(new THREE.BufferGeometry());
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aColor", new THREE.BufferAttribute(col, 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    geo.setAttribute("aTw", new THREE.BufferAttribute(tw, 1));
    const pts = new THREE.Points(geo, track(new THREE.ShaderMaterial({
      vertexShader: BG_STAR_VERT, fragmentShader: BG_STAR_FRAG, uniforms: { uTime, uDpr },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    })));
    pts.frustumCulled = false;
    pts.renderOrder = -9;
    scene.add(pts);
  }

  // ── Floating origin: everything world-space lives under `root`, offset by -origin ──
  const root = new THREE.Group();
  scene.add(root);

  // ── Galaxy dust (static per container, spun as a whole) ──
  type DustEntry = { body: number; spinner: THREE.Group; mat: THREE.ShaderMaterial };
  const dust: DustEntry[] = [];
  for (const ri of u.roots) {
    const b = bodies[ri];
    const R = b.extent;
    const isField = b.region === "asteroid-field";
    const count = Math.min(3200, (isField ? 900 : 380) + b.children.length * 26);
    const pos = new Float32Array(count * 3), col = new Float32Array(count * 3), size = new Float32Array(count);
    const base = new THREE.Color(b.color);
    const warm = new THREE.Color("#ffe2b8"), cool = new THREE.Color("#a9c6ff");
    const c = new THREE.Color();
    const rand = mulberry32(Math.floor(hashFloat(b.id) * 1e9));
    for (let i = 0; i < count; i++) {
      let p: { x: number; y: number; z: number };
      const bulge = !isField && i < count * 0.18;
      if (bulge) {
        const g = () => (rand() + rand() + rand() - 1.5) / 1.5;
        p = { x: g() * 0.16, y: g() * 0.07, z: g() * 0.16 };
      } else {
        p = sampleGalaxyShape(b.kind as Parameters<typeof sampleGalaxyShape>[0], b.id, `${b.id}#${i}`);
      }
      pos.set([p.x * R, p.y * R, p.z * R], i * 3);
      const r = Math.hypot(p.x, p.z);
      if (isField) c.set("#8a7f72").lerp(base, rand() * 0.5);
      else if (bulge) c.copy(warm).lerp(base, 0.25);
      else c.copy(base).lerp(r > 0.6 ? cool : warm, 0.25 + rand() * 0.2);
      const bright = (isField ? 0.5 : bulge ? 0.45 * Math.min(1, 900 / count + 0.3) : 0.55) * (0.6 + rand() * 0.7);
      col.set([c.r * bright, c.g * bright, c.b * bright], i * 3);
      size[i] = R * (isField ? 0.004 : bulge ? 0.03 : 0.018) * (0.5 + rand() * 1.2);
    }
    const geo = track(new THREE.BufferGeometry());
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aColor", new THREE.BufferAttribute(col, 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    const mat = track(new THREE.ShaderMaterial({
      vertexShader: DUST_VERT, fragmentShader: DUST_FRAG,
      uniforms: { uPxPerUnit, uDpr, uFade: { value: 1 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    const holder = new THREE.Group();
    holder.position.set(b.anchor.x, b.anchor.y, b.anchor.z);
    holder.rotation.set(b.plane.incl, b.plane.node, 0, "YXZ");
    const spinner = new THREE.Group();
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    spinner.add(pts);
    holder.add(spinner);
    root.add(holder);
    dust.push({ body: ri, spinner, mat });
  }

  // ── Bridges: aggregated links between top-level containers ──
  const bridgeMat = track(new THREE.ShaderMaterial({
    vertexShader: BRIDGE_VERT, fragmentShader: BRIDGE_FRAG,
    uniforms: { uColor: { value: accent.clone() }, uOpacity: { value: 0 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  if (u.bridges.length > 0) {
    const maxC = Math.max(...u.bridges.map((b) => b.count));
    const SEG = 24;
    const pos = new Float32Array(u.bridges.length * SEG * 2 * 3), alpha = new Float32Array(u.bridges.length * SEG * 2);
    let v = 0;
    const A = new THREE.Vector3(), B = new THREE.Vector3(), M = new THREE.Vector3(), P = new THREE.Vector3();
    const curve = new THREE.QuadraticBezierCurve3(A, M, B);
    for (const br of u.bridges) {
      const a = bodies[br.a].anchor, b = bodies[br.b].anchor;
      A.set(a.x, a.y, a.z); B.set(b.x, b.y, b.z);
      M.copy(A).add(B).multiplyScalar(0.5);
      M.y += A.distanceTo(B) * 0.18;
      const k = 0.25 + 0.75 * Math.sqrt(br.count / maxC);
      for (let s = 0; s < SEG; s++) {
        for (let e = 0; e < 2; e++) {
          const t = (s + e) / SEG;
          curve.getPoint(t, P);
          pos.set([P.x, P.y, P.z], v * 3);
          alpha[v] = k * Math.sin(Math.PI * t) * 0.9 + 0.1 * k;
          v++;
        }
      }
    }
    const geo = track(new THREE.BufferGeometry());
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aAlpha", new THREE.BufferAttribute(alpha, 1));
    const lines = new THREE.LineSegments(geo, bridgeMat);
    lines.frustumCulled = false;
    root.add(lines);
  }

  // ── Dynamic bodies ──
  const stars = bodies.filter((b) => b.tier === "star");
  const worlds = bodies.filter((b) => b.tier === "planet" || b.tier === "moon");

  // Star spheres
  const starMesh = new THREE.InstancedMesh(
    track(new THREE.SphereGeometry(1, 32, 20)),
    track(new THREE.ShaderMaterial({ vertexShader: STAR_VERT, fragmentShader: STAR_FRAG, uniforms: { uTime } })),
    Math.max(1, stars.length),
  );
  starMesh.count = stars.length;
  {
    const col = new Float32Array(Math.max(1, stars.length) * 3);
    const c = new THREE.Color();
    stars.forEach((s, i) => { c.set(s.color); col.set([c.r, c.g, c.b], i * 3); });
    starMesh.geometry.setAttribute("aColor", new THREE.InstancedBufferAttribute(col, 3));
  }
  starMesh.frustumCulled = false;
  scene.add(starMesh);

  // Planet + moon spheres
  const worldMesh = new THREE.InstancedMesh(
    track(new THREE.SphereGeometry(1, 28, 18)),
    track(new THREE.ShaderMaterial({ vertexShader: PLANET_VERT, fragmentShader: PLANET_FRAG, uniforms: { uTime, uAccent: { value: accent.clone() } } })),
    Math.max(1, worlds.length),
  );
  worldMesh.count = worlds.length;
  const worldLight = new Float32Array(Math.max(1, worlds.length) * 3);
  const worldBoost = new Float32Array(Math.max(1, worlds.length));
  {
    const type = new Float32Array(Math.max(1, worlds.length)), seed = new Float32Array(Math.max(1, worlds.length));
    const lit = new Float32Array(Math.max(1, worlds.length));
    worlds.forEach((w, i) => {
      type[i] = PLANET_TYPE_INDEX[w.kind] ?? 0;
      seed[i] = hashFloat(w.id);
      let p = w.parent; let hasStar = false;
      while (p >= 0) { if (bodies[p].tier === "star") { hasStar = true; break; } p = bodies[p].parent; }
      lit[i] = hasStar ? 1 : 0;
    });
    worldMesh.geometry.setAttribute("aType", new THREE.InstancedBufferAttribute(type, 1));
    worldMesh.geometry.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seed, 1));
    worldMesh.geometry.setAttribute("aLit", new THREE.InstancedBufferAttribute(lit, 1));
    worldMesh.geometry.setAttribute("aLight", new THREE.InstancedBufferAttribute(worldLight, 3).setUsage(THREE.DynamicDrawUsage));
    worldMesh.geometry.setAttribute("aBoost", new THREE.InstancedBufferAttribute(worldBoost, 1).setUsage(THREE.DynamicDrawUsage));
  }
  worldMesh.frustumCulled = false;
  scene.add(worldMesh);

  // Glow points: stars, galaxy cores (static, under root) and world dots
  const glowMat = track(new THREE.ShaderMaterial({
    vertexShader: GLOW_VERT, fragmentShader: GLOW_FRAG, uniforms: { uPxPerUnit, uDpr },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  const dynGlowBodies = [...stars, ...worlds];
  const DG = dynGlowBodies.length;
  const dynGlowPos = new Float32Array(Math.max(1, DG) * 3);
  const dynGlowBoost = new Float32Array(Math.max(1, DG));
  const dynGlowGeo = track(new THREE.BufferGeometry());
  {
    const radius = new Float32Array(Math.max(1, DG)), col = new Float32Array(Math.max(1, DG) * 3);
    const kind = new Float32Array(Math.max(1, DG)), ext = new Float32Array(Math.max(1, DG));
    const c = new THREE.Color();
    dynGlowBodies.forEach((b, i) => {
      radius[i] = b.radius;
      if (b.tier === "star") { c.set(b.color); kind[i] = 0; }
      else { c.set(TYPE_DOT_COLOR[PLANET_TYPE_INDEX[b.kind] ?? 0]).multiplyScalar(b.tier === "moon" ? 0.8 : 0.9); kind[i] = 2; }
      col.set([c.r, c.g, c.b], i * 3);
    });
    dynGlowGeo.setAttribute("position", new THREE.BufferAttribute(dynGlowPos, 3).setUsage(THREE.DynamicDrawUsage));
    dynGlowGeo.setAttribute("aRadius", new THREE.BufferAttribute(radius, 1));
    dynGlowGeo.setAttribute("aColor", new THREE.BufferAttribute(col, 3));
    dynGlowGeo.setAttribute("aKind", new THREE.BufferAttribute(kind, 1));
    dynGlowGeo.setAttribute("aExtent", new THREE.BufferAttribute(ext, 1));
    dynGlowGeo.setAttribute("aBoost", new THREE.BufferAttribute(dynGlowBoost, 1).setUsage(THREE.DynamicDrawUsage));
    dynGlowGeo.setDrawRange(0, DG);
  }
  const dynGlow = new THREE.Points(dynGlowGeo, glowMat);
  dynGlow.frustumCulled = false;
  dynGlow.renderOrder = 2;
  scene.add(dynGlow);

  {
    const R = u.roots.length;
    const pos = new Float32Array(R * 3), radius = new Float32Array(R), col = new Float32Array(R * 3);
    const kind = new Float32Array(R).fill(1), ext = new Float32Array(R), boost = new Float32Array(R);
    const c = new THREE.Color();
    u.roots.forEach((ri, i) => {
      const b = bodies[ri];
      pos.set([b.anchor.x, b.anchor.y, b.anchor.z], i * 3);
      radius[i] = b.extent * (b.region ? 0.16 : 0.2) * (0.7 + 0.3 * Math.min(1, b.children.length / 20));
      ext[i] = b.extent;
      c.set(b.color).lerp(new THREE.Color("#fff1dc"), 0.3).multiplyScalar(b.region ? 0.18 : 0.38);
      col.set([c.r, c.g, c.b], i * 3);
    });
    const geo = track(new THREE.BufferGeometry());
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aRadius", new THREE.BufferAttribute(radius, 1));
    geo.setAttribute("aColor", new THREE.BufferAttribute(col, 3));
    geo.setAttribute("aKind", new THREE.BufferAttribute(kind, 1));
    geo.setAttribute("aExtent", new THREE.BufferAttribute(ext, 1));
    geo.setAttribute("aBoost", new THREE.BufferAttribute(boost, 1));
    const cores = new THREE.Points(geo, glowMat);
    cores.frustumCulled = false;
    root.add(cores);
  }

  // ── Orbit lines (planets around stars, moons around planets) ──
  const circleGeo = track(new THREE.BufferGeometry().setFromPoints(
    Array.from({ length: 129 }, (_, i) => {
      const a = (i / 128) * Math.PI * 2;
      return new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    }),
  ));
  type OrbitLine = { body: number; line: THREE.Line; mat: THREE.ShaderMaterial; base: THREE.Color };
  const orbitLines: OrbitLine[] = [];
  for (const b of bodies) {
    if (!b.orbit || (b.tier !== "planet" && b.tier !== "moon") || bodies[b.parent].region) continue;
    const base = new THREE.Color(b.tier === "planet" ? TYPE_DOT_COLOR[PLANET_TYPE_INDEX[b.kind] ?? 0] : "#8e9ab0");
    const mat = track(new THREE.ShaderMaterial({
      vertexShader: LINE_VERT, fragmentShader: LINE_FRAG,
      uniforms: { uColor: { value: base.clone() }, uOpacity: { value: 0 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    const line = new THREE.Line(circleGeo, mat);
    line.matrixAutoUpdate = false;
    line.frustumCulled = false;
    line.visible = false;
    scene.add(line);
    orbitLines.push({ body: b.index, line, mat, base });
  }

  // ── Planetary rings and asteroid belts (data-driven particles) ──
  type Particles = { body: number; obj: THREE.Points; plane: { incl: number; node: number } };
  const particleSets: Particles[] = [];
  const ringMatFor = (color: string, opacity: number) => track(new THREE.ShaderMaterial({
    vertexShader: RING_VERT, fragmentShader: RING_FRAG,
    uniforms: { uPxPerUnit, uDpr, uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  for (const b of bodies) {
    const spec = b.rings ?? b.belt;
    if (!spec) continue;
    const count = Math.min(2400, 300 + spec.count * 30);
    const rand = mulberry32(Math.floor(hashFloat(b.id + "ring") * 1e9));
    const pos = new Float32Array(count * 3), size = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const r = spec.inner + (spec.outer - spec.inner) * Math.pow(rand(), 0.8);
      const a = rand() * Math.PI * 2;
      pos.set([Math.cos(a) * r, (rand() - 0.5) * (spec.outer - spec.inner) * (b.rings ? 0.02 : 0.15), Math.sin(a) * r], i * 3);
      size[i] = (spec.outer - spec.inner) * (b.rings ? 0.012 : 0.04) * (0.5 + rand());
    }
    const geo = track(new THREE.BufferGeometry());
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    const obj = new THREE.Points(geo, ringMatFor(spec.color, b.rings ? 0.75 : 0.6));
    obj.frustumCulled = false;
    scene.add(obj);
    const plane = b.rings
      ? { incl: (hashFloat(b.id + "ri") - 0.5) * 0.6, node: hashFloat(b.id + "rn") * Math.PI * 2 }
      : b.plane;
    particleSets.push({ body: b.index, obj, plane });
  }

  // ── Connection arcs (selection) ──
  const arcMat = track(new THREE.ShaderMaterial({
    vertexShader: ARC_VERT, fragmentShader: ARC_FRAG,
    uniforms: { uResolution, uTime, uWidth: { value: 1.6 * dpr } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  }));
  let arcMesh: THREE.Mesh | null = null;
  let arcTargets: number[] = [];
  let arcFor = -2;

  function rebuildArcs(sel: number | null) {
    if (arcMesh) { scene.remove(arcMesh); arcMesh.geometry.dispose(); arcMesh = null; }
    arcFor = sel ?? -1;
    // Parent/child links are already visible as orbits — arcs show only cross-links
    arcTargets = sel !== null && sel >= 0
      ? u.neighbors[sel].filter((n) => n !== bodies[sel].parent && bodies[n].parent !== sel)
      : [];
    if (arcTargets.length === 0) return;
    const quads = arcTargets.length * ARC_SEGMENTS;
    const geo = new THREE.BufferGeometry();
    const aA = new Float32Array(quads * 12), aB = new Float32Array(quads * 12);
    const aSide = new Float32Array(quads * 4), aEnd = new Float32Array(quads * 4), aT = new Float32Array(quads * 4);
    const aColor = new Float32Array(quads * 12), index = new Uint32Array(quads * 6);
    const c0 = accent.clone(), c1 = new THREE.Color(), cc = new THREE.Color();
    let q = 0;
    for (const t of arcTargets) {
      const tb = bodies[t];
      c1.set(tb.tier === "star" ? tb.color : tb.tier === "galaxy" ? tb.color : TYPE_DOT_COLOR[PLANET_TYPE_INDEX[tb.kind] ?? 0]);
      for (let s = 0; s < ARC_SEGMENTS; s++) {
        for (let k = 0; k < 4; k++) {
          const vi = q * 4 + k;
          const isEnd = k >= 2 ? 1 : 0;
          aEnd[vi] = isEnd;
          aSide[vi] = k % 2 === 0 ? -1 : 1;
          const tt = (s + isEnd) / ARC_SEGMENTS;
          aT[vi] = tt;
          cc.copy(c0).lerp(c1, tt);
          aColor.set([cc.r, cc.g, cc.b], vi * 3);
        }
        const b = q * 4;
        index.set([b, b + 1, b + 2, b + 1, b + 3, b + 2], q * 6);
        q++;
      }
    }
    geo.setAttribute("position", new THREE.BufferAttribute(aA, 3));
    geo.setAttribute("aA", new THREE.BufferAttribute(aA, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("aB", new THREE.BufferAttribute(aB, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("aSide", new THREE.BufferAttribute(aSide, 1));
    geo.setAttribute("aEnd", new THREE.BufferAttribute(aEnd, 1));
    geo.setAttribute("aT", new THREE.BufferAttribute(aT, 1));
    geo.setAttribute("aColor", new THREE.BufferAttribute(aColor, 3));
    geo.setIndex(new THREE.BufferAttribute(index, 1));
    arcMesh = new THREE.Mesh(geo, arcMat);
    arcMesh.frustumCulled = false;
    arcMesh.renderOrder = 5;
    scene.add(arcMesh);
  }

  // ── DOM overlays: labels, tooltip, selection rings ──
  const overlay = document.createElement("div");
  overlay.style.cssText = "position:absolute;inset:0;pointer-events:none;overflow:hidden;";
  mount.appendChild(overlay);
  const labels: Array<{ el: HTMLDivElement; title: HTMLSpanElement; sub: HTMLSpanElement; key: string }> = [];
  for (let i = 0; i < LABEL_POOL; i++) {
    const el = document.createElement("div");
    el.style.cssText = "position:absolute;left:0;top:0;display:flex;flex-direction:column;align-items:center;gap:1px;padding:2px 7px 3px;border-radius:6px;background:rgba(5,6,13,0.42);backdrop-filter:blur(3px);opacity:0;transition:opacity 0.25s ease;will-change:transform,opacity;white-space:nowrap;text-shadow:0 1px 4px rgba(0,0,0,0.8);";
    const title = document.createElement("span");
    const sub = document.createElement("span");
    sub.style.cssText = "font-family:'DM Mono',monospace;font-size:9.5px;letter-spacing:0.04em;color:rgba(255,255,255,0.48);";
    el.append(title, sub);
    overlay.appendChild(el);
    labels.push({ el, title, sub, key: "" });
  }
  const makeRing = (css: string) => {
    const el = document.createElement("div");
    el.style.cssText = `position:absolute;left:0;top:0;border-radius:50%;opacity:0;transition:opacity 0.2s ease;${css}`;
    overlay.appendChild(el);
    return el;
  };
  const selRing = makeRing("border:1.5px solid var(--accent-warm);box-shadow:0 0 14px color-mix(in srgb, var(--accent-warm) 60%, transparent);animation:orrery-pulse 2.2s ease-in-out infinite;");
  const hoverRing = makeRing("border:1px solid rgba(255,255,255,0.55);");
  const tooltip = document.createElement("div");
  tooltip.style.cssText = "position:absolute;left:0;top:0;padding:8px 11px;border-radius:9px;background:rgba(8,10,20,0.82);backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,0.12);box-shadow:0 8px 24px rgba(0,0,0,0.45);opacity:0;transition:opacity 0.12s ease;max-width:300px;";
  overlay.appendChild(tooltip);

  // ── Simulation & camera state ──
  let simT = 0;
  const wx = new Float64Array(N), wy = new Float64Array(N), wz = new Float64Array(N);
  const tmp = { x: 0, y: 0, z: 0 };

  function updateWorld() {
    for (let i = 0; i < N; i++) {
      const b = bodies[i];
      if (b.parent < 0) { wx[i] = b.anchor.x; wy[i] = b.anchor.y; wz[i] = b.anchor.z; continue; }
      orbitPosition(b.orbit!, simT, tmp);
      wx[i] = wx[b.parent] + tmp.x; wy[i] = wy[b.parent] + tmp.y; wz[i] = wz[b.parent] + tmp.z;
    }
  }

  const tanHalf = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
  const frameDistance = (i: number) => {
    if (i < 0) return (u.extent / tanHalf) * 1.05;
    const b = bodies[i];
    if (b.children.length > 0 || b.rings || b.belt) return Math.max(b.extent / tanHalf * 1.15, b.radius * 4);
    return Math.max(b.radius * (b.tier === "star" ? 22 : 9), 0.25);
  };
  // -1 = whole universe, -2 = free (panned) focus
  const minDistance = (i: number) => (i === -1 ? 20 : i === -2 ? 0.05 : Math.max(bodies[i].radius * 1.6, 0.03));
  const maxDistance = u.extent * 6 + 200;

  let focus = -1;
  const origin = { x: 0, y: 0, z: 0 };
  let dist = frameDistance(-1) * 3.2;
  let az = 0.6, el = 0.62;
  let velAz = 0, velEl = 0;
  let fly: { from: { x: number; y: number; z: number }; to: number; d0: number; d1: number; el0: number; el1: number; start: number; dur: number; hop: number } | null = null;
  let lastInteract = performance.now();

  function focusPos(i: number, out: { x: number; y: number; z: number }) {
    if (i < 0) { out.x = 0; out.y = 0; out.z = 0; } else { out.x = wx[i]; out.y = wy[i]; out.z = wz[i]; }
    return out;
  }

  function setFocus(i: number) {
    if (i === focus) return;
    focus = i;
    live.current.onFocusChange(i);
  }

  function flyTo(i: number) {
    if (i >= N) return;
    const from = { ...origin };
    const to = focusPos(i, { x: 0, y: 0, z: 0 });
    const travel = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
    const d1 = frameDistance(i);
    const near = Math.max(1e-3, Math.min(dist, d1));
    const ratio = travel / near;
    const isContainer = i < 0 || bodies[i].children.length > 0;
    fly = {
      from, to: i, d0: dist, d1,
      el0: el, el1: isContainer ? Math.min(1.1, Math.max(0.42, el)) : el,
      start: performance.now(),
      dur: Math.min(3400, 1100 + 520 * Math.log10(1 + ratio)),
      hop: Math.min(2.5, Math.max(0, Math.log10(1 + travel / Math.max(dist, d1)) * 1.6)),
    };
    velAz = velEl = 0;
    setFocus(i);
  }

  // ── Input ──
  const pointers = new Map<number, { x: number; y: number }>();
  let downAt = { x: 0, y: 0 };
  let dragMoved = false;
  let panMode = false;
  let pinch = 0;
  let mouse: { x: number; y: number } | null = null;

  const el2d = renderer.domElement;
  const local = (e: { clientX: number; clientY: number }) => {
    const r = el2d.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  function onPointerDown(e: PointerEvent) {
    const p = local(e);
    pointers.set(e.pointerId, p);
    try { el2d.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    if (pointers.size === 1) {
      downAt = p; dragMoved = false;
      panMode = e.button === 2 || e.shiftKey;
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = Math.hypot(a.x - b.x, a.y - b.y);
    }
    lastInteract = performance.now();
  }

  function onPointerMove(e: PointerEvent) {
    const p = local(e);
    mouse = p;
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    lastInteract = performance.now();
    if (pointers.size === 2) {
      pointers.set(e.pointerId, p);
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch > 0) zoomBy(pinch / d);
      pinch = d;
      dragMoved = true;
      return;
    }
    const dx = p.x - prev.x, dy = p.y - prev.y;
    pointers.set(e.pointerId, p);
    if (!dragMoved && Math.hypot(p.x - downAt.x, p.y - downAt.y) > 4) { dragMoved = true; el2d.style.cursor = "grabbing"; }
    if (!dragMoved) return;
    fly = null;
    if (panMode) {
      // Pan the focus point across the view plane; detaches from the focused body
      const s = dist * tanHalf * 2 / el2d.clientHeight;
      const rx = Math.cos(az), rz = -Math.sin(az);
      const fx = -Math.sin(az), fz = -Math.cos(az);
      origin.x += (-dx * rx + dy * fx) * s;
      origin.z += (-dx * rz + dy * fz) * s;
      setFocus(-2);
    } else {
      velAz = -dx * 0.005;
      velEl = dy * 0.005;
      az += velAz;
      el = Math.max(-1.45, Math.min(1.45, el + velEl));
    }
  }

  function onPointerUp(e: PointerEvent) {
    if (!pointers.delete(e.pointerId)) return;
    try { el2d.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    el2d.style.cursor = "grab";
    if (pointers.size > 0) return;
    if (!dragMoved && e.button === 0) {
      const hit = pick(local(e));
      if (hit >= 0) {
        live.current.onSelect(hit);
        flyTo(hit);
      } else {
        live.current.onSelect(null);
      }
    }
  }

  function zoomBy(f: number) {
    fly = null;
    const target = Math.max(minDistance(focus), Math.min(maxDistance, dist * f));
    dist = target;
    lastInteract = performance.now();
  }

  function onWheel(e: WheelEvent) {
    e.preventDefault();
    zoomBy(Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.0016)));
  }

  function onLeave() { mouse = null; }
  function onContext(e: MouseEvent) { e.preventDefault(); }

  el2d.addEventListener("pointerdown", onPointerDown);
  el2d.addEventListener("pointermove", onPointerMove);
  el2d.addEventListener("pointerup", onPointerUp);
  el2d.addEventListener("pointercancel", onPointerUp);
  el2d.addEventListener("pointerleave", onLeave);
  el2d.addEventListener("wheel", onWheel, { passive: false });
  el2d.addEventListener("contextmenu", onContext);

  // ── Projection cache for picking / labels ──
  const sx = new Float32Array(N), sy = new Float32Array(N), sDepth = new Float32Array(N);
  const rPx = new Float32Array(N), ePx = new Float32Array(N);
  const vis = new Uint8Array(N);
  const vp = new THREE.Matrix4();
  let W = mount.clientWidth, H = mount.clientHeight;

  function project() {
    vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const m = vp.elements;
    const ppu = uPxPerUnit.value;
    for (let i = 0; i < N; i++) {
      const x = wx[i] - origin.x, y = wy[i] - origin.y, z = wz[i] - origin.z;
      const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
      if (cw <= 1e-6) { vis[i] = 0; continue; }
      const cx = m[0] * x + m[4] * y + m[8] * z + m[12];
      const cy = m[1] * x + m[5] * y + m[9] * z + m[13];
      sx[i] = (cx / cw * 0.5 + 0.5) * W;
      sy[i] = (-cy / cw * 0.5 + 0.5) * H;
      sDepth[i] = cw;
      rPx[i] = bodies[i].radius * ppu / cw;
      ePx[i] = bodies[i].extent * ppu / cw;
      vis[i] = 1;
    }
  }

  /** Children become individually visible once their parent is big enough on screen. */
  const resolvable = (i: number) => bodies[i].parent < 0 || (vis[bodies[i].parent] === 1 && ePx[bodies[i].parent] > RESOLVE_PX);

  function pick(p: { x: number; y: number }): number {
    let best = -1, bestScore = Infinity;
    for (let i = 0; i < N; i++) {
      if (!vis[i] || !resolvable(i)) continue;
      const b = bodies[i];
      const containerOpen = b.children.length > 0 && ePx[i] > RESOLVE_PX;
      let hitR: number;
      if (b.tier === "galaxy") hitR = containerOpen ? 14 : Math.max(ePx[i] * 0.8, 10);
      else if (b.children.length > 0 && !containerOpen) hitR = Math.max(ePx[i] * 0.7, rPx[i] + 6, 9);
      else hitR = Math.max(rPx[i] + 6, 9);
      const d = Math.hypot(sx[i] - p.x, sy[i] - p.y);
      if (d > hitR) continue;
      const tierBias = b.tier === "moon" ? 0 : b.tier === "planet" ? 0.02 : b.tier === "star" ? 0.04 : 0.08;
      const score = d / hitR + tierBias;
      if (score < bestScore) { bestScore = score; best = i; }
    }
    return best;
  }

  // ── Labels ──
  const candidates: number[] = [];
  const placedRects: Array<[number, number, number, number]> = [];
  function updateLabels(hover: number) {
    const sel = live.current.selectedIndex ?? -1;
    const hl = live.current.highlightIndex ?? -1;
    candidates.length = 0;
    for (let i = 0; i < N; i++) {
      if (!vis[i] || !resolvable(i)) continue;
      if (sx[i] < -80 || sx[i] > W + 80 || sy[i] < -40 || sy[i] > H + 40) continue;
      const must = i === sel || i === hover || i === focus || i === hl;
      const minPx = bodies[i].tier === "galaxy" ? 11 : bodies[i].tier === "star" ? 18 : MIN_LABEL_EXTENT_PX;
      if (must || ePx[i] > minPx || (bodies[i].tier !== "galaxy" && rPx[i] > 7)) candidates.push(i);
    }
    const prio = (i: number) => (i === hover || i === hl ? 1e9 : i === sel ? 1e8 : i === focus ? 1e7 : 0) + ePx[i];
    candidates.sort((a, b) => prio(b) - prio(a));
    placedRects.length = 0;
    let used = 0;
    for (const i of candidates) {
      if (used >= LABEL_POOL) break;
      const b = bodies[i];
      const isGalaxy = b.tier === "galaxy";
      const above = isGalaxy && ePx[i] > RESOLVE_PX ? Math.min(ePx[i] * 0.62, H * 0.42) : Math.max(rPx[i], 3) + 8;
      const x = sx[i], y = sy[i] - above;
      const w = Math.min(260, b.name.length * (isGalaxy ? 7.4 : 6.4) + 16), h = 28;
      const rect: [number, number, number, number] = [x - w / 2, y - h, w, h];
      const forced = i === hover || i === sel || i === hl;
      if (!forced) {
        let overlap = false;
        for (const r of placedRects) {
          if (rect[0] < r[0] + r[2] && rect[0] + rect[2] > r[0] && rect[1] < r[1] + r[3] && rect[1] + rect[3] > r[1]) { overlap = true; break; }
        }
        if (overlap) continue;
      }
      placedRects.push(rect);
      const L = labels[used++];
      const key = `${i}`;
      if (L.key !== key) {
        L.key = key;
        L.title.textContent = b.name;
        L.title.style.cssText = isGalaxy
          ? "font-family:'Lora',Georgia,serif;font-size:14px;font-weight:600;color:rgba(255,255,255,0.92);letter-spacing:-0.01em;"
          : `font-family:'Geist',sans-serif;font-size:${b.tier === "star" ? 12 : 11}px;font-weight:500;color:rgba(255,255,255,0.88);`;
        L.sub.textContent = describeBody(b, u);
      }
      const emph = forced || i === focus;
      const fade = emph ? 1 : Math.min(1, (Math.max(ePx[i], rPx[i] * 3) - (isGalaxy ? 11 : MIN_LABEL_EXTENT_PX)) / 40 + 0.5);
      L.el.style.opacity = String(fade);
      L.title.style.color = i === sel ? "var(--accent-warm)" : isGalaxy ? "rgba(255,255,255,0.92)" : "rgba(255,255,255,0.88)";
      L.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -100%)`;
    }
    for (let k = used; k < LABEL_POOL; k++) {
      if (labels[k].el.style.opacity !== "0") labels[k].el.style.opacity = "0";
    }
  }

  function placeRing(el: HTMLDivElement, i: number, pad: number) {
    if (i < 0 || !vis[i]) { el.style.opacity = "0"; return; }
    const b = bodies[i];
    const r = b.tier === "galaxy" ? Math.min(ePx[i] * 0.9, 220) : Math.max(rPx[i] * 1.5 + pad, 9);
    el.style.width = el.style.height = `${r * 2}px`;
    el.style.transform = `translate3d(${(sx[i] - r).toFixed(1)}px, ${(sy[i] - r).toFixed(1)}px, 0)`;
    el.style.opacity = "1";
  }

  let tooltipFor = -1;
  function updateTooltip(hover: number) {
    if (hover < 0 || !mouse) { tooltip.style.opacity = "0"; tooltipFor = -1; return; }
    if (tooltipFor !== hover) {
      tooltipFor = hover;
      const b = bodies[hover];
      const tierName = b.region ? "deep space" : b.tier;
      const db = b.node?.databaseName ?? "unlinked records";
      const links = u.neighbors[hover].length;
      tooltip.innerHTML =
        `<div style="font-family:'Lora',Georgia,serif;font-size:13px;font-weight:600;color:rgba(255,255,255,0.94);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(b.name)}</div>` +
        `<div style="display:flex;gap:6px;align-items:center;margin-top:4px;font-family:'DM Mono',monospace;font-size:9.5px;letter-spacing:0.06em;">` +
        `<span style="color:var(--accent-warm);text-transform:uppercase">${esc(tierName)}</span>` +
        `<span style="color:rgba(255,255,255,0.4);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(db)}</span></div>` +
        `<div style="margin-top:3px;font-family:'DM Mono',monospace;font-size:9.5px;color:rgba(255,255,255,0.45)">${esc(describeBody(b, u))}${b.node ? ` · ${plural(links, "link")}` : ""}</div>` +
        `<div style="margin-top:5px;font-family:'DM Mono',monospace;font-size:9px;color:rgba(255,255,255,0.3)">click to fly here</div>`;
    }
    const x = Math.min(mouse.x + 16, W - 300), y = Math.min(mouse.y + 18, H - 90);
    tooltip.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    tooltip.style.opacity = "1";
  }

  // ── Resize ──
  function resize() {
    W = Math.max(1, mount.clientWidth); H = Math.max(1, mount.clientHeight);
    renderer.setSize(W, H);
    composer.setSize(W, H);
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    uPxPerUnit.value = (H / 2) / tanHalf;
    uResolution.value.set(W * dpr, H * dpr);
  }
  const ro = new ResizeObserver(resize);
  ro.observe(mount);
  resize();

  // ── Frame loop ──
  const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3();
  const euler = new THREE.Euler(0, 0, 0, "YXZ");
  const orbitOff = new THREE.Vector3();
  const arcP0 = new THREE.Vector3(), arcP1 = new THREE.Vector3(), arcM = new THREE.Vector3(), arcQ = new THREE.Vector3(), arcQ2 = new THREE.Vector3();
  const arcCurve = new THREE.QuadraticBezierCurve3(arcP0, arcM, arcP1);
  let prev = performance.now();
  let raf = 0;
  let hover = -1;
  let lastHoverCheck = 0;

  // Cinematic entrance: start far out and settle on the whole universe
  updateWorld();
  flyTo(-1);
  // (TS can't see the assignment inside flyTo, hence the cast)
  const intro = fly as { dur: number; hop: number } | null;
  if (intro) { intro.dur = 3200; intro.hop = 0; }

  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - prev) / 1000);
    prev = now;
    const L = live.current;
    uTime.value = now / 1000;
    if (!L.paused) simT += dt * L.speed;
    updateWorld();

    // Camera: scripted flight, else inertia + idle drift
    if (fly) {
      const t = Math.min(1, (now - fly.start) / fly.dur);
      const e = easeInOutCubic(t);
      const to = focusPos(fly.to, tmp);
      origin.x = fly.from.x + (to.x - fly.from.x) * e;
      origin.y = fly.from.y + (to.y - fly.from.y) * e;
      origin.z = fly.from.z + (to.z - fly.from.z) * e;
      const logD = Math.log(fly.d0) + (Math.log(fly.d1) - Math.log(fly.d0)) * e;
      dist = Math.exp(logD) * (1 + fly.hop * Math.sin(Math.PI * e));
      el = fly.el0 + (fly.el1 - fly.el0) * e;
      if (t >= 1) fly = null;
    } else {
      if (focus >= -1) focusPos(focus, origin);
      if (pointers.size === 0) {
        az += velAz; el = Math.max(-1.45, Math.min(1.45, el + velEl));
        velAz *= 0.9; velEl *= 0.9;
        if (Math.abs(velAz) < 1e-5) velAz = 0;
        if (Math.abs(velEl) < 1e-5) velEl = 0;
        if (now - lastInteract > IDLE_ORBIT_MS) az += dt * 0.025;
      }
      // Zoomed well past the focused system → hand focus to its parent
      if (focus >= 0 && dist > frameDistance(focus) * 3.4) {
        const camX = origin.x + Math.sin(az) * Math.cos(el) * dist;
        const camY = origin.y + Math.sin(el) * dist;
        const camZ = origin.z + Math.cos(az) * Math.cos(el) * dist;
        const parent = bodies[focus].parent;
        setFocus(parent);
        focusPos(parent, origin);
        const ox = camX - origin.x, oy = camY - origin.y, oz = camZ - origin.z;
        dist = Math.hypot(ox, oy, oz);
        el = Math.asin(Math.max(-1, Math.min(1, oy / dist)));
        az = Math.atan2(ox, oz);
      }
    }
    dist = Math.max(minDistance(focus), Math.min(maxDistance, dist));

    camera.position.set(Math.sin(az) * Math.cos(el) * dist, Math.sin(el) * dist, Math.cos(az) * Math.cos(el) * dist);
    camera.near = Math.max(dist * 0.0015, 1e-4);
    camera.far = dist * 40 + u.extent * 4 + 1000;
    camera.updateProjectionMatrix();
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    root.position.set(-origin.x, -origin.y, -origin.z);

    // Galaxy dust spin + fade once you're inside a galaxy
    for (const d of dust) {
      const b = bodies[d.body];
      d.spinner.rotation.y = -b.spin * simT;
      const dx = wx[d.body] - origin.x - camera.position.x, dy = wy[d.body] - origin.y - camera.position.y, dz = wz[d.body] - origin.z - camera.position.z;
      const cd = Math.hypot(dx, dy, dz);
      d.mat.uniforms.uFade.value = 0.28 + 0.72 * THREE.MathUtils.smoothstep(cd, b.extent * 0.6, b.extent * 2.2);
    }
    bridgeMat.uniforms.uOpacity.value = 0.2 * THREE.MathUtils.smoothstep(dist, u.extent * 0.35, u.extent * 1.2);

    // Hover (throttled CPU picking)
    project();
    if (now - lastHoverCheck > 50 && pointers.size === 0) {
      lastHoverCheck = now;
      const h = mouse ? pick(mouse) : -1;
      if (h !== hover) { hover = h; el2d.style.cursor = h >= 0 ? "pointer" : "grab"; }
    }
    const sel = L.selectedIndex ?? -1;
    const hl = L.highlightIndex ?? -1;

    // Instances: positions relative to the floating origin
    stars.forEach((s, k) => {
      const i = s.index;
      const r = s.radius * (1 + 0.04 * Math.sin(now * 0.0016 + hashFloat(s.id) * 20));
      ps.set(wx[i] - origin.x, wy[i] - origin.y, wz[i] - origin.z);
      mtx.compose(ps, q.identity(), sc.set(r, r, r));
      starMesh.setMatrixAt(k, mtx);
    });
    starMesh.instanceMatrix.needsUpdate = true;

    worlds.forEach((w, k) => {
      const i = w.index;
      ps.set(wx[i] - origin.x, wy[i] - origin.y, wz[i] - origin.z);
      mtx.compose(ps, q.identity(), sc.set(w.radius, w.radius, w.radius));
      worldMesh.setMatrixAt(k, mtx);
      let p = w.parent;
      while (p >= 0 && bodies[p].tier !== "star") p = bodies[p].parent;
      if (p >= 0) worldLight.set([wx[p] - origin.x, wy[p] - origin.y, wz[p] - origin.z], k * 3);
      else worldLight.set([ps.x + 500, ps.y + 300, ps.z + 200], k * 3);
      const target = i === sel ? 1 : i === hover || i === hl ? 0.6 : 0;
      worldBoost[k] += (target - worldBoost[k]) * Math.min(1, dt * 10);
    });
    worldMesh.instanceMatrix.needsUpdate = true;
    (worldMesh.geometry.getAttribute("aLight") as THREE.InstancedBufferAttribute).needsUpdate = true;
    (worldMesh.geometry.getAttribute("aBoost") as THREE.InstancedBufferAttribute).needsUpdate = true;

    dynGlowBodies.forEach((b, k) => {
      const i = b.index;
      dynGlowPos[k * 3] = wx[i] - origin.x; dynGlowPos[k * 3 + 1] = wy[i] - origin.y; dynGlowPos[k * 3 + 2] = wz[i] - origin.z;
      const target = i === sel ? 1 : i === hover || i === hl ? 0.6 : 0;
      dynGlowBoost[k] += (target - dynGlowBoost[k]) * Math.min(1, dt * 10);
    });
    (dynGlowGeo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    (dynGlowGeo.getAttribute("aBoost") as THREE.BufferAttribute).needsUpdate = true;

    // Orbit lines — only near the camera, brightest around the focus
    const camWX = camera.position.x + origin.x, camWY = camera.position.y + origin.y, camWZ = camera.position.z + origin.z;
    for (const ol of orbitLines) {
      const b = bodies[ol.body];
      const o = b.orbit!;
      const p = b.parent;
      const cd = Math.hypot(wx[p] - camWX, wy[p] - camWY, wz[p] - camWZ);
      const ratio = cd / Math.max(bodies[p].extent, o.a);
      const crowd = 1 / Math.sqrt(Math.max(1, bodies[p].children.length / 8));
      let op = (b.tier === "planet" ? 0.3 : 0.16) * crowd * (1 - THREE.MathUtils.smoothstep(ratio, 2.5, 7));
      const related = focus === p || focus === ol.body || bodies[p].parent === focus;
      if (related) op *= 1.5;
      if (ol.body === sel) op = 0.85;
      if (op < 0.01) { ol.line.visible = false; continue; }
      ol.line.visible = true;
      ol.mat.uniforms.uOpacity.value = op;
      (ol.mat.uniforms.uColor.value as THREE.Color).copy(ol.body === sel ? accent : ol.base);
      euler.set(o.incl, o.node, 0, "YXZ");
      q.setFromEuler(euler);
      ps.set(wx[p] - origin.x, wy[p] - origin.y, wz[p] - origin.z);
      ps.add(orbitOff.set(-o.a * o.e, o.y, 0).applyQuaternion(q));
      ol.line.matrix.compose(ps, q, sc.set(o.a, 1, o.b));
      ol.line.matrixWorldNeedsUpdate = true;
    }

    for (const set of particleSets) {
      const i = set.body;
      set.obj.position.set(wx[i] - origin.x, wy[i] - origin.y, wz[i] - origin.z);
      set.obj.rotation.set(set.plane.incl, set.plane.node + simT * 0.02, 0, "YXZ");
    }

    // Connection arcs follow their (moving) endpoints
    if (arcFor !== sel) rebuildArcs(sel >= 0 ? sel : null);
    if (arcMesh && sel >= 0) {
      const aA = (arcMesh.geometry.getAttribute("aA") as THREE.BufferAttribute);
      const aB = (arcMesh.geometry.getAttribute("aB") as THREE.BufferAttribute);
      const A = aA.array as Float32Array, B = aB.array as Float32Array;
      arcP0.set(wx[sel] - origin.x, wy[sel] - origin.y, wz[sel] - origin.z);
      let qd = 0;
      for (const t of arcTargets) {
        arcP1.set(wx[t] - origin.x, wy[t] - origin.y, wz[t] - origin.z);
        const span = arcP0.distanceTo(arcP1);
        arcM.copy(arcP0).add(arcP1).multiplyScalar(0.5);
        arcM.y += span * 0.28;
        for (let s = 0; s < ARC_SEGMENTS; s++) {
          arcCurve.getPoint(s / ARC_SEGMENTS, arcQ);
          arcCurve.getPoint((s + 1) / ARC_SEGMENTS, arcQ2);
          for (let k = 0; k < 4; k++) {
            const vi = (qd * 4 + k) * 3;
            A[vi] = arcQ.x; A[vi + 1] = arcQ.y; A[vi + 2] = arcQ.z;
            B[vi] = arcQ2.x; B[vi + 1] = arcQ2.y; B[vi + 2] = arcQ2.z;
          }
          qd++;
        }
      }
      aA.needsUpdate = true; aB.needsUpdate = true;
    }

    composer.render();

    updateLabels(hover);
    placeRing(selRing, sel, 6);
    placeRing(hoverRing, hover >= 0 && hover !== sel ? hover : hl !== sel ? hl : -1, 4);
    updateTooltip(hover);
  }
  raf = requestAnimationFrame(frame);

  return {
    flyTo,
    dispose: () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      el2d.removeEventListener("pointerdown", onPointerDown);
      el2d.removeEventListener("pointermove", onPointerMove);
      el2d.removeEventListener("pointerup", onPointerUp);
      el2d.removeEventListener("pointercancel", onPointerUp);
      el2d.removeEventListener("pointerleave", onLeave);
      el2d.removeEventListener("wheel", onWheel);
      el2d.removeEventListener("contextmenu", onContext);
      if (arcMesh) arcMesh.geometry.dispose();
      for (const d of disposables) d.dispose();
      starMesh.dispose(); worldMesh.dispose();
      composer.dispose(); bloom.dispose();
      renderer.dispose();
      overlay.remove();
      el2d.remove();
    },
  };
}

// ─── Component ────────────────────────────────────────────────────────────────

export function OrreryCanvas({ universe, focusRequest, ...rest }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const live = useRef<Live>(rest);
  live.current = rest;

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const engine = createEngine(mount, universe, live);
    engineRef.current = engine;
    return () => { engine.dispose(); engineRef.current = null; };
  }, [universe]);

  useEffect(() => {
    if (focusRequest) engineRef.current?.flyTo(focusRequest.index);
  }, [focusRequest]);

  return (
    <div ref={mountRef} style={{ position: "absolute", inset: 0, background: "#05060d" }}>
      <style>{`@keyframes orrery-pulse { 0%,100% { transform-origin: center; filter: brightness(1); } 50% { filter: brightness(1.6); } }`}</style>
    </div>
  );
}
