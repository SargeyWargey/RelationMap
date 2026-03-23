/**
 * Orrery layout engine — pure math, no Three.js dependencies.
 * All functions are deterministic given the same inputs.
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

export type TierSizeConstants = { minSize: number; maxSize: number };

/** Tier-specific size ranges — moons always smaller than planets, planets smaller than stars, etc. */
export const TIER_SIZE: Record<"galaxy" | "star" | "planet" | "moon", TierSizeConstants> = {
  galaxy: { minSize: 8,    maxSize: 40   },
  star:   { minSize: 0.8,  maxSize: 5.0  },
  planet: { minSize: 0.3,  maxSize: 2.0  },
  moon:   { minSize: 0.08, maxSize: 0.5  },
};

export type OrbitalParams = {
  orbitalRadius: number;  // world units from focal point
  angularSpeed:  number;  // rad/s at 1× speed multiplier
  inclination:   number;  // radians — orbit tilt from reference plane
  eccentricity:  number;  // 0 = circle, max 0.25
  initialPhase:  number;  // starting angle in radians
};

export type Vec3 = { x: number; y: number; z: number };

export type TierNode = {
  id: string;
  createdTime: string;    // ISO date string (may be empty)
  connectionCount: number;
};

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

// ─── 3.2 computeSize ─────────────────────────────────────────────────────────

/**
 * Computes the final rendered size for a cosmic object using:
 *   rawSize = (connectionCount / maxConn) × 0.6 + (ageScore) × 0.4
 *   finalSize = minSize + rawSize × (maxSize − minSize)
 *
 * ageScore: 0 = newest record in tier, 1 = oldest — older → larger.
 */
export function computeSize(
  node: TierNode,
  allTierNodes: TierNode[],
  tierConstants: TierSizeConstants,
): number {
  const now = Date.now();

  function parseMs(iso: string): number {
    if (!iso) return now;
    const t = new Date(iso).getTime();
    return Number.isNaN(t) ? now : t;
  }

  // Connection count signal
  const maxConn = Math.max(1, ...allTierNodes.map((n) => n.connectionCount));
  const connScore = node.connectionCount / maxConn;

  // Age signal: older (smaller createdMs) → higher ageScore
  const createdMs = parseMs(node.createdTime);
  const allCreatedMs = allTierNodes.map((n) => parseMs(n.createdTime));
  const oldestMs = Math.min(...allCreatedMs);
  const newestMs = Math.max(...allCreatedMs);
  const ageRange = newestMs - oldestMs || 1;
  const ageScore = (newestMs - createdMs) / ageRange; // 0 = newest, 1 = oldest

  const rawSize = connScore * 0.6 + ageScore * 0.4;
  const { minSize, maxSize } = tierConstants;
  return minSize + rawSize * (maxSize - minSize);
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

// ─── 3.4 distributeStarsInGalaxy ─────────────────────────────────────────────

/**
 * Returns 3D positions in galaxy-local space (galactic center = origin).
 * XZ = galactic plane, Y = out-of-plane scatter (small).
 *
 * These positions define each star's initial location within the galaxy shape.
 * The canvas derives orbital radii from the XZ distance to origin.
 */
export function distributeStarsInGalaxy(
  starIds: string[],
  shape: GalaxyShape,
  galaxyId: string,
): Vec3[] {
  const N = starIds.length;
  if (N === 0) return [];

  // Galaxy-level parameters — seeded from galaxy ID for consistency
  const galaxySize      = 80 + h(galaxyId, "size") * 120;      // 80–200 world units radius
  const numArms         = h(galaxyId, "arms") < 0.5 ? 2 : 4;
  const windingTight    = 0.4 + h(galaxyId, "winding") * 0.8; // logarithmic spiral tightness
  const numClumps       = 3 + Math.floor(h(galaxyId, "clumps") * 4); // 3–6 for irregular
  const ringRatio       = 0.4 + h(galaxyId, "ring") * 0.25;    // ring radius as fraction of galaxySize

  const positions: Vec3[] = [];

  for (let i = 0; i < N; i++) {
    const id = starIds[i];
    const t1 = h(id, "t1");
    const t2 = h(id, "t2");
    const t3 = h(id, "t3");
    const t4 = h(id, "t4");
    const t5 = h(id, "t5");

    let x = 0, y = 0, z = 0;

    switch (shape) {
      case "spiral": {
        // Logarithmic spiral arms — each star assigned to one arm
        const arm      = Math.floor(t1 * numArms);
        const armAngle = (arm / numArms) * Math.PI * 2;
        const r        = (0.05 + t2 * 0.95) * galaxySize;
        const theta    = armAngle + windingTight * Math.log(r / 10 + 1) + (t3 - 0.5) * 0.8;
        const scatter  = (t4 - 0.5) * galaxySize * 0.12;
        x = r * Math.cos(theta) + scatter * Math.cos(theta + Math.PI / 2);
        z = r * Math.sin(theta) + scatter * Math.sin(theta + Math.PI / 2);
        y = (t5 - 0.5) * galaxySize * 0.06;
        break;
      }

      case "barred-spiral": {
        if (t1 < 0.35) {
          // Central bar along X axis
          const barLength = galaxySize * 0.4;
          x = (t2 - 0.5) * 2 * barLength;
          z = (t3 - 0.5) * barLength * 0.18;
          y = (t4 - 0.5) * galaxySize * 0.05;
        } else {
          // Arms from bar ends (two arms: +X end and −X end)
          const armIdx   = t1 < 0.675 ? 0 : 1;
          const barEnd   = (armIdx === 0 ? 1 : -1) * galaxySize * 0.4;
          const armAngle = armIdx === 0 ? 0.1 : Math.PI + 0.1;
          const r        = (0.1 + t2 * 0.9) * galaxySize * 0.7;
          const theta    = armAngle + windingTight * Math.log(r / 10 + 1) + (t3 - 0.5) * 0.7;
          x = barEnd + r * Math.cos(theta);
          z = r * Math.sin(theta) * 0.9;
          y = (t4 - 0.5) * galaxySize * 0.06;
        }
        break;
      }

      case "elliptical": {
        // 3D ellipsoidal density via sum-of-uniforms approximation of Gaussian
        const gx = (t1 + t2 + t3 - 1.5) * galaxySize * 0.4;
        const gz = (t2 + t3 + t4 - 1.5) * galaxySize * 0.3;
        const gy = (t3 + t4 + t5 - 1.5) * galaxySize * 0.2;
        x = gx; z = gz; y = gy;
        break;
      }

      case "irregular": {
        // Chaotic clumpy distribution — a few seeded clump centers
        const clumpIdx  = Math.floor(t1 * numClumps);
        const clumpCx   = (h(galaxyId, `cx${clumpIdx}`) - 0.5) * galaxySize * 1.2;
        const clumpCz   = (h(galaxyId, `cz${clumpIdx}`) - 0.5) * galaxySize * 1.2;
        const clumpSize = galaxySize * (0.15 + h(galaxyId, `cs${clumpIdx}`) * 0.25);
        x = clumpCx + (t2 - 0.5) * clumpSize * 2;
        z = clumpCz + (t3 - 0.5) * clumpSize * 2;
        y = (t4 - 0.5) * galaxySize * 0.12;
        break;
      }

      case "ring": {
        // Dense stellar ring around a sparse center
        const ringRadius = galaxySize * ringRatio;
        const ringWidth  = galaxySize * 0.15;
        const r          = ringRadius + (t1 - 0.5) * ringWidth;
        const theta      = t2 * Math.PI * 2;
        x = r * Math.cos(theta);
        z = r * Math.sin(theta);
        y = (t3 - 0.5) * galaxySize * 0.08;
        break;
      }

      case "lenticular": {
        // Flat disc, uniform density, no spiral arms
        // sqrt(t) maps uniform to radially-uniform disc density
        const r     = Math.sqrt(t1) * galaxySize * 0.85;
        const theta = t2 * Math.PI * 2;
        x = r * Math.cos(theta);
        z = r * Math.sin(theta);
        y = (t3 - 0.5) * galaxySize * 0.04; // very flat
        break;
      }
    }

    positions.push({ x, y, z });
  }

  return positions;
}

// ─── 3.5 computeOrbitalParams ────────────────────────────────────────────────

/**
 * Returns orbital parameters for an array of objects (planets around a star,
 * moons around a planet, or stars around a galactic center).
 *
 * Objects are ordered by index — index 0 = innermost orbit.
 * Kepler approximation: ω ∝ r^(−3/2) so inner objects orbit faster.
 *
 * @param objectIds       - per-object ID strings for seeding
 * @param baseRadius      - orbital radius of the innermost object
 * @param radiusSpread    - total radial range (outermost = baseRadius + radiusSpread)
 * @param speedBase       - angular speed of innermost orbit (rad/s at 1× multiplier)
 * @param maxInclination  - max orbit tilt in radians (± this value)
 */
export function computeOrbitalParams(
  objectIds: string[],
  baseRadius: number,
  radiusSpread: number,
  speedBase: number,
  maxInclination: number,
): OrbitalParams[] {
  const N = objectIds.length;
  if (N === 0) return [];

  const step = N > 1 ? radiusSpread / (N - 1) : 0;

  return objectIds.map((id, i) => {
    const jitter       = (h(id, "rjitter") - 0.5) * step * 0.4;
    const orbitalRadius = Math.max(baseRadius * 0.5, baseRadius + i * step + jitter);

    // Kepler: ω ∝ r^(-3/2) — normalised to innermost orbit
    const angularSpeed  = speedBase * Math.pow(baseRadius / orbitalRadius, 1.5);

    const inclination   = (h(id, "incl")  - 0.5) * 2 * maxInclination;
    const eccentricity  =  0.05 + h(id, "ecc")   * 0.20; // 0.05 – 0.25
    const initialPhase  =  h(id, "phase") * Math.PI * 2;

    return { orbitalRadius, angularSpeed, inclination, eccentricity, initialPhase };
  });
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

// ─── 3.10 distributeGalaxies ─────────────────────────────────────────────────

/**
 * Places galaxies in 3D universe space using a Fibonacci sphere distribution.
 * Galaxy IDs are sorted before indexing so positions are stable across
 * additions/removals of other galaxies.
 *
 * @param galaxyIds  - list of galaxy record IDs
 * @param spread     - universe radius in world units (default 2000)
 */
export function distributeGalaxies(galaxyIds: string[], spread = 2000): Vec3[] {
  const N = galaxyIds.length;
  if (N === 0) return [];

  // Sort IDs to assign stable indices regardless of insertion order
  const sorted   = [...galaxyIds].sort();
  const indexMap = new Map(sorted.map((id, i) => [id, i]));

  const goldenRatio = (1 + Math.sqrt(5)) / 2;

  return galaxyIds.map((id) => {
    const i = indexMap.get(id)!;

    // Fibonacci sphere — evenly distributes points on a sphere surface
    const theta = Math.acos(1 - (2 * (i + 0.5)) / N);
    const phi   = 2 * Math.PI * (i / goldenRatio);

    // Per-ID radial jitter ±15% so galaxies sit at varied distances
    const radialJitter = 0.85 + h(id, "radial") * 0.30;
    const r            = spread * radialJitter;

    // Small angular jitter for organic feel (won't break distribution noticeably)
    const tFinal = theta + (h(id, "tj") - 0.5) * 0.20;
    const pFinal = phi   + (h(id, "pj") - 0.5) * 0.40;

    return {
      x: r * Math.sin(tFinal) * Math.cos(pFinal),
      y: r * Math.cos(tFinal) * 0.30, // flatten to disc-like universe shape
      z: r * Math.sin(tFinal) * Math.sin(pFinal),
    };
  });
}
