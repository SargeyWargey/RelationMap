import * as THREE from "three";

/**
 * Time of day for The Mountain. `tod` is a fraction of a day: 0 = midnight,
 * 0.25 = sunrise (east), 0.5 = noon (sun high in the south), 0.75 = sunset.
 * Sky colours are keyed on the sun's elevation, so dawn and dusk both pass
 * through twilight and golden hour.
 */

export function sunDirection(tod: number, out: THREE.Vector3): THREE.Vector3 {
  const th = (tod - 0.25) * Math.PI * 2;
  return out.set(Math.cos(th), Math.sin(th) * 0.8, Math.sin(th) * 0.5 + 0.12).normalize();
}

/** Roughly opposite the sun, so the moon rises as the sun sets. */
export function moonDirection(tod: number, out: THREE.Vector3): THREE.Vector3 {
  const th = (tod - 0.25) * Math.PI * 2;
  return out.set(-Math.cos(th), -Math.sin(th) * 0.8, -Math.sin(th) * 0.35 + 0.2).normalize();
}

export function formatClock(tod: number): string {
  const mins = Math.floor((((tod % 1) + 1) % 1) * 24 * 60);
  return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
}

type SkyKey = {
  s: number;
  zenith: string; horizon: string; fog: string; fogSun: string; cloud: string;
  skyAmb: string; skyAmbI: number; groundAmb: string; groundAmbI: number;
  exposure: number; fogDensity: number; shallow: string; deep: string;
};

const KEYS: SkyKey[] = [
  { s: -0.22, zenith: "#02040b", horizon: "#141c33", fog: "#0f1629", fogSun: "#26304d", cloud: "#1e2438", skyAmb: "#33467a", skyAmbI: 0.95, groundAmb: "#1a1820", groundAmbI: 0.45, exposure: 1.45, fogDensity: 0.00026, shallow: "#1a5d6b", deep: "#050f22" },
  { s: -0.07, zenith: "#131d45", horizon: "#5a4470", fog: "#3b3554", fogSun: "#c06a4a", cloud: "#584260", skyAmb: "#4b5486", skyAmbI: 0.85, groundAmb: "#2a2028", groundAmbI: 0.42, exposure: 1.32, fogDensity: 0.00024, shallow: "#1f5f6e", deep: "#071a30" },
  { s: 0.05, zenith: "#3a5b9a", horizon: "#f2a86a", fog: "#d7a681", fogSun: "#ffb067", cloud: "#ffcf9e", skyAmb: "#8ba3cf", skyAmbI: 0.6, groundAmb: "#6b5040", groundAmbI: 0.36, exposure: 1.05, fogDensity: 0.00022, shallow: "#2a7f80", deep: "#0a2f4a" },
  { s: 0.3, zenith: "#3b6fb4", horizon: "#c3d6e4", fog: "#bfd2e0", fogSun: "#f6e2bd", cloud: "#ffffff", skyAmb: "#9ec0e8", skyAmbI: 0.62, groundAmb: "#6b5b45", groundAmbI: 0.38, exposure: 0.95, fogDensity: 0.00021, shallow: "#2d8f8b", deep: "#0a3550" },
];
const KEY_COLORS = KEYS.map((k) => ({
  zenith: new THREE.Color(k.zenith), horizon: new THREE.Color(k.horizon), fog: new THREE.Color(k.fog), fogSun: new THREE.Color(k.fogSun),
  cloud: new THREE.Color(k.cloud), skyAmb: new THREE.Color(k.skyAmb).multiplyScalar(k.skyAmbI), groundAmb: new THREE.Color(k.groundAmb).multiplyScalar(k.groundAmbI),
  shallow: new THREE.Color(k.shallow), deep: new THREE.Color(k.deep),
}));

export type SkyState = {
  zenith: THREE.Color; horizon: THREE.Color; fog: THREE.Color; fogSun: THREE.Color; cloud: THREE.Color;
  skyAmb: THREE.Color; groundAmb: THREE.Color; shallow: THREE.Color; deep: THREE.Color;
  exposure: number; fogDensity: number;
  /** Active light (sun by day, moon by night): direction, colour × intensity. */
  lightDir: THREE.Vector3; light: THREE.Color;
  sunDir: THREE.Vector3; moonDir: THREE.Vector3; sunDisc: THREE.Color;
  /** 0 = full day, 1 = full night. */
  night: number;
  /** 0..1 how much it's proper daylight (cloud shadows etc.). */
  day: number;
};

export function createSkyState(): SkyState {
  return {
    zenith: new THREE.Color(), horizon: new THREE.Color(), fog: new THREE.Color(), fogSun: new THREE.Color(), cloud: new THREE.Color(),
    skyAmb: new THREE.Color(), groundAmb: new THREE.Color(), shallow: new THREE.Color(), deep: new THREE.Color(),
    exposure: 1, fogDensity: 0.0002, lightDir: new THREE.Vector3(), light: new THREE.Color(),
    sunDir: new THREE.Vector3(), moonDir: new THREE.Vector3(), sunDisc: new THREE.Color(), night: 0, day: 1,
  };
}

function smoothstep(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

const SUN_LOW = new THREE.Color("#ff8a45");
const SUN_MID = new THREE.Color("#ffd2a0");
const SUN_HIGH = new THREE.Color("#fff0d8");
const MOON = new THREE.Color("#a9bcff");
const DISC_LOW = new THREE.Color("#ff9a50");
const DISC_HIGH = new THREE.Color("#fff6e6");

export function computeSky(tod: number, out: SkyState): SkyState {
  sunDirection(tod, out.sunDir);
  moonDirection(tod, out.moonDir);
  const s = out.sunDir.y;

  // Piecewise-linear blend between the elevation keys
  let k = 0;
  while (k < KEYS.length - 2 && s > KEYS[k + 1].s) k++;
  const a = KEYS[k], b = KEYS[k + 1];
  const t = Math.min(1, Math.max(0, (s - a.s) / (b.s - a.s)));
  const ca = KEY_COLORS[k], cb = KEY_COLORS[k + 1];
  for (const key of ["zenith", "horizon", "fog", "fogSun", "cloud", "skyAmb", "groundAmb", "shallow", "deep"] as const) {
    out[key].copy(ca[key]).lerp(cb[key], t);
  }
  out.exposure = a.exposure + (b.exposure - a.exposure) * t;
  out.fogDensity = a.fogDensity + (b.fogDensity - a.fogDensity) * t;

  // Sun or moon lights the land; both fade to nothing at the horizon so the hand-off is seamless
  if (s > 0) {
    out.lightDir.copy(out.sunDir);
    const warm = smoothstep(0.0, 0.3, s);
    out.light.copy(SUN_LOW).lerp(SUN_MID, Math.min(1, warm * 2)).lerp(SUN_HIGH, Math.max(0, warm * 2 - 1));
    out.light.multiplyScalar(2.5 * smoothstep(-0.02, 0.1, s));
  } else {
    out.lightDir.copy(out.moonDir);
    out.light.copy(MOON).multiplyScalar(1.35 * smoothstep(-0.02, 0.14, out.moonDir.y));
  }
  out.sunDisc.copy(DISC_LOW).lerp(DISC_HIGH, smoothstep(0.02, 0.25, s));
  out.night = 1 - smoothstep(-0.2, 0.02, s);
  out.day = smoothstep(0.04, 0.3, s);
  return out;
}
