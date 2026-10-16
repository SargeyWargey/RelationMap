/**
 * Orrery appearance helpers — pure, deterministic per record ID.
 * Placement and orbits live in `orreryUniverse.ts`.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type GalaxyShape =
  | "spiral"
  | "barred-spiral"
  | "elliptical"
  | "irregular"
  | "ring"
  | "lenticular";

export type PlanetType =
  | "rocky"
  | "gas-giant"
  | "ocean"
  | "desert"
  | "ice-giant"
  | "lava"
  | "jungle";

export type MoonType =
  | "cratered"
  | "icy"
  | "volcanic"
  | "dusty"
  | "tidally-locked";

// ─── Internal hash utilities ──────────────────────────────────────────────────

/** FNV-1a 32-bit hash → float in [0, 1) */
function hashFloat(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 0x100000000;
}

/** Salted hash — derive multiple independent floats from the same ID */
function h(id: string, salt: string): number {
  return hashFloat(id + "\x00" + salt);
}

// ─── 3.3 assignGalaxyShape ───────────────────────────────────────────────────

const GALAXY_SHAPES: GalaxyShape[] = [
  "spiral",
  "barred-spiral",
  "elliptical",
  "irregular",
  "ring",
  "lenticular",
];

/**
 * Returns a deterministic galaxy shape seeded from the galaxy's record ID.
 * Same galaxy always gets the same shape across sessions.
 */
export function assignGalaxyShape(galaxyId: string): GalaxyShape {
  const idx = Math.floor(h(galaxyId, "shape") * GALAXY_SHAPES.length);
  return GALAXY_SHAPES[Math.min(idx, GALAXY_SHAPES.length - 1)];
}

// ─── 3.6 assignPlanetType ────────────────────────────────────────────────────

const PLANET_TYPES: PlanetType[] = [
  "rocky", "gas-giant", "ocean", "desert", "ice-giant", "lava", "jungle",
];

/**
 * Returns a deterministic planet visual type seeded from the planet's record ID.
 */
export function assignPlanetType(planetId: string): PlanetType {
  const idx = Math.floor(h(planetId, "planet-type") * PLANET_TYPES.length);
  return PLANET_TYPES[Math.min(idx, PLANET_TYPES.length - 1)];
}

// ─── 3.7 assignMoonType ──────────────────────────────────────────────────────

const MOON_TYPES: MoonType[] = [
  "cratered", "icy", "volcanic", "dusty", "tidally-locked",
];

/**
 * Returns a deterministic moon visual type seeded from the moon's record ID.
 */
export function assignMoonType(moonId: string): MoonType {
  const idx = Math.floor(h(moonId, "moon-type") * MOON_TYPES.length);
  return MOON_TYPES[Math.min(idx, MOON_TYPES.length - 1)];
}

// ─── 3.8 assignStarColor ─────────────────────────────────────────────────────

// Stellar classification colour table: normalizedSize 0 (tiny) → deep red; 1 (huge) → blue-white
const STAR_COLOR_STOPS = [
  { t: 0.00, r: 0xcc, g: 0x44, b: 0x00 }, // deep red
  { t: 0.30, r: 0xff, g: 0x8c, b: 0x42 }, // orange-red
  { t: 0.55, r: 0xff, g: 0xd5, b: 0x80 }, // yellow-orange
  { t: 0.72, r: 0xff, g: 0xf5, b: 0xcc }, // white-yellow
  { t: 1.00, r: 0xa8, g: 0xd8, b: 0xff }, // blue-white
];

/**
 * Returns a hex colour for a star based on its normalised size (0–1).
 * Larger/hotter stars → blue-white; smaller/cooler → deep red.
 */
export function assignStarColor(normalizedSize: number): string {
  const t = Math.max(0, Math.min(1, normalizedSize));

  let lo = STAR_COLOR_STOPS[0];
  let hi = STAR_COLOR_STOPS[STAR_COLOR_STOPS.length - 1];

  for (let i = 0; i < STAR_COLOR_STOPS.length - 1; i++) {
    if (t >= STAR_COLOR_STOPS[i].t && t <= STAR_COLOR_STOPS[i + 1].t) {
      lo = STAR_COLOR_STOPS[i];
      hi = STAR_COLOR_STOPS[i + 1];
      break;
    }
  }

  const range = hi.t - lo.t || 1;
  const f     = (t - lo.t) / range;
  const r     = Math.round(lo.r + (hi.r - lo.r) * f);
  const g     = Math.round(lo.g + (hi.g - lo.g) * f);
  const b     = Math.round(lo.b + (hi.b - lo.b) * f);
  return toHex(r, g, b);
}

// ─── 3.9 assignGalaxyColor ───────────────────────────────────────────────────

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace("#", "");
  const full  = clean.length === 3
    ? clean.split("").map((c) => c + c).join("")
    : clean.padEnd(6, "0");
  return {
    r: parseInt(full.slice(0, 2), 16) || 0,
    g: parseInt(full.slice(2, 4), 16) || 0,
    b: parseInt(full.slice(4, 6), 16) || 0,
  };
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l   = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let hh = 0;
  if (max === rn)      hh = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) hh = ((bn - rn) / d + 2) / 6;
  else                 hh = ((rn - gn) / d + 4) / 6;
  return { h: hh, s, l };
}

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  function hue2rgb(p: number, q: number, t: number): number {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    r: Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    g: Math.round(hue2rgb(p, q, h) * 255),
    b: Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  };
}

function toHex(r: number, g: number, b: number): string {
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

/**
 * Returns a galaxy colour derived from its database base colour.
 * - Per-record hue shift ±15° (seeded from record ID)
 * - Age-based temperature shift: older → warmer (amber); newer → cooler (blue)
 *
 * @param baseColor     - database hex colour
 * @param recordId      - galaxy record ID (seeds the hue jitter)
 * @param normalizedAge - 0 = newest record in tier, 1 = oldest
 */
export function assignGalaxyColor(
  baseColor: string,
  recordId: string,
  normalizedAge: number,
): string {
  const { r, g, b }  = hexToRgb(baseColor);
  const { h: baseH, s, l } = rgbToHsl(r, g, b);

  // Per-record hue jitter ±15° (±0.042 in [0,1] units)
  const hueShift = (h(recordId, "hue") - 0.5) * (30 / 360);

  // Temperature shift: older → toward amber (0.08); newer → toward blue (0.60)
  const tempTarget   = normalizedAge > 0.5 ? 0.08 : 0.60;
  const tempStrength = Math.abs(normalizedAge - 0.5) * 0.10; // max ±0.05 hue shift
  const tempShift    = (tempTarget - baseH) * tempStrength;

  const newH = ((baseH + hueShift + tempShift) % 1 + 1) % 1;
  const newS = Math.min(1, s * (0.90 + h(recordId, "sat") * 0.20));
  const newL = Math.min(0.85, Math.max(0.20, l * (0.90 + h(recordId, "lit") * 0.20)));

  const rgb = hslToRgb(newH, newS, newL);
  return toHex(rgb.r, rgb.g, rgb.b);
}
