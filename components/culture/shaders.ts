// GLSL for The Culture. Every layer reads organism state from three float
// textures indexed by organism (see engine.ts), so cells, filaments and
// biofilm halos always agree on where each organism is and how it's doing:
//   uS0  x, y, radius, visibility
//   uS1  birth (0→1), dormancy (0→1), mood (+active / −blocked), focus + 4 × links
//        (focus: 0 dim · 1 normal · 2 related · 3 hovered/selected)
//   uS2  seed, angle, morph, species + age (static; age = birth as a 0–1 fraction of the history)

export const TEX_W = 128;

export const COMMON = /* glsl */ `
  uniform float uTime;
  uniform float uDark;
  uniform float uPx;
  uniform float uStain;   // 0 species colour · 1 amber · 2 age
  uniform float uFocusMode;
  uniform sampler2D uS0;
  uniform sampler2D uS1;
  uniform sampler2D uS2;
  uniform vec3 uSpecies[32];

  ivec2 tcOf(int i) { return ivec2(i % ${TEX_W}, i / ${TEX_W}); }
  float focusOf(float w) { return mod(w + 0.01, 4.0) - 0.01; }
  float linksOf(float w) { return floor((w + 0.01) / 4.0); }

  /** Small Brownian drift around the home position (stops when dormant). */
  vec2 jiggle(float seed, float dorm) {
    float t = uTime;
    vec2 j = vec2(sin(t * 0.63 + seed * 41.0) + 0.5 * sin(t * 1.37 + seed * 17.0),
                  cos(t * 0.57 + seed * 23.0) + 0.5 * cos(t * 1.21 + seed * 31.0));
    return j * 0.045 * (1.0 - dorm);
  }

  /** Viridis, oldest (deep violet) → newest (bright yellow), in linear colour. */
  vec3 ageColor(float t) {
    t = clamp(t, 0.0, 1.0);
    vec3 c0 = vec3(0.0627, 0.0007, 0.0887), c1 = vec3(0.0423, 0.0844, 0.2596), c2 = vec3(0.0152, 0.2832, 0.2623),
         c3 = vec3(0.1101, 0.5841, 0.1221), c4 = vec3(0.9822, 0.7913, 0.0194);
    if (t < 0.25) return mix(c0, c1, t * 4.0);
    if (t < 0.5) return mix(c1, c2, (t - 0.25) * 4.0);
    if (t < 0.75) return mix(c2, c3, (t - 0.5) * 4.0);
    return mix(c3, c4, (t - 0.75) * 4.0);
  }

  vec3 speciesColor(float s) {
    float sp = floor(s + 0.0005);
    vec3 c = uSpecies[int(sp) % 32];
    if (uStain < 0.5) return c;
    if (uStain < 1.5) {
      // Amber: keep each species' brightness, tint it like the tile art
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      return mix(vec3(0.55, 0.16, 0.02), vec3(1.0, 0.72, 0.28), clamp(l * 1.6, 0.0, 1.0));
    }
    return ageColor(s - sp);
  }

  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  vec2 hash22(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.xx + p3.yz) * p3.zy);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
  }
`;

// ─── Organisms ────────────────────────────────────────────────────────────────

/** How far (in body radii) each body plan reaches beyond its body: flagella, spines, cilia. */
export const MORPH_EXTENT = [1.06, 1.85, 1.16, 1.04, 1.32, 1.22, 1.24, 1.06, 1.36, 1.6];

export const ORGANISM_VERT = /* glsl */ `
  ${COMMON}
  uniform float uExtent[10];
  uniform float uMinPx;
  varying vec2 vP;
  varying float vPxR;
  flat varying vec4 vA;
  flat varying vec4 vB;
  flat varying float vLinks;

  void main() {
    int i = gl_InstanceID;
    vec4 s0 = texelFetch(uS0, tcOf(i), 0);
    vec4 s1 = texelFetch(uS1, tcOf(i), 0);
    vec4 s2 = texelFetch(uS2, tcOf(i), 0);
    if (s0.w < 0.003 || s0.z <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    int morph = int(s2.z + 0.5);
    float extent = uExtent[morph];
    float birth = s1.x;
    if (birth < 1.0) extent = max(extent, 1.3 + birth * 2.6);
    float focus = focusOf(s1.w);
    if (focus > 2.5) extent = max(extent, 1.5);
    float r = max(s0.z, uMinPx / uPx);
    float dorm = s1.y;
    float rot = s2.y + uTime * 0.05 * (s2.x - 0.5) * (1.0 - dorm);
    vec2 cs = vec2(cos(rot), sin(rot));
    vec2 local = position.xy * extent;
    vec2 world = s0.xy + jiggle(s2.x, dorm) * s0.z + vec2(cs.x * local.x - cs.y * local.y, cs.y * local.x + cs.x * local.y) * r;
    vP = local;
    vPxR = r * uPx;
    vA = vec4(s1.xyz, focus);
    vB = vec4(s2.x, s2.z, s2.w, s0.w);
    vLinks = linksOf(s1.w);
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 0.0, 1.0);
  }
`;

export const ORGANISM_FRAG = /* glsl */ `
  ${COMMON}
  uniform vec3 uAccent;
  varying vec2 vP;
  varying float vPxR;
  flat varying vec4 vA;
  flat varying vec4 vB;
  flat varying float vLinks;

  float sdCapsule(vec2 p, vec2 a, vec2 b, float r) {
    vec2 pa = p - a, ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h) - r;
  }
  float sdSeg(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a, ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h);
  }
  float sdEllipse(vec2 p, vec2 ab) {
    float k0 = length(p / ab);
    float k1 = length(p / (ab * ab));
    return k0 * (k0 - 1.0) / max(k1, 1e-4);
  }
  float angDiff(float a, float b) { return abs(mod(a - b + 3.14159265, 6.2831853) - 3.14159265); }
  float wob(float a, float t, float seed) {
    return sin(a * 3.0 + t * 1.1 + seed * 6.28) * 0.55 + sin(a * 5.0 - t * 1.7 + seed * 12.1) * 0.3 + sin(a * 2.0 + t * 0.6 + seed * 3.3) * 0.4;
  }
  /** Sparse round inclusions on a jittered grid. */
  float dots(vec2 p, float density, float size, float seed) {
    vec2 g = p * density + seed * 17.0;
    vec2 ip = floor(g), fp = fract(g);
    float m = 0.0;
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec2 o = vec2(float(x), float(y));
        vec2 h = hash22(ip + o);
        if (h.x > 0.6) continue;
        float d = length(fp - (o + 0.15 + 0.7 * h));
        m = max(m, 1.0 - smoothstep(size * 0.55, size, d));
      }
    }
    return m;
  }
  #define DOTS(p, dn, sz, sd) (detail > 0.01 ? dots(p, dn, sz, sd) : 0.0)
  float hexLines(vec2 p) {
    vec2 r = vec2(1.0, 1.7320508);
    vec2 h = r * 0.5;
    vec2 a = mod(p, r) - h;
    vec2 b = mod(p - h, r) - h;
    vec2 gv = dot(a, a) < dot(b, b) ? a : b;
    vec2 q = abs(gv);
    float edge = 0.5 - max(dot(q, normalize(vec2(1.0, 1.7320508))), q.x);
    return 1.0 - smoothstep(0.02, 0.07, edge);
  }
  float ring(float d, float w) { return 1.0 - smoothstep(0.0, w, abs(d)); }

  void main() {
    vec2 p = vP;
    float seed = vB.x;
    int morph = int(vB.y + 0.5);
    vec3 col = speciesColor(vB.z);
    float vis = vB.w;
    float birth = vA.x, dorm = vA.y, mood = vA.z, focus = vA.w;
    float actv = max(mood, 0.0) * (1.0 - dorm);
    float blocked = max(-mood, 0.0) * (1.0 - dorm);
    float alive = 1.0 - dorm;
    float T = uTime * (0.25 + 0.75 * alive) * (1.0 + 0.8 * actv) + seed * 40.0;
    float wobK = alive * (1.0 + blocked * 1.4);
    float rr = length(p);
    float a = atan(p.y, p.x);
    float detail = smoothstep(5.0, 16.0, vPxR);   // organelles only once the cell is big enough to see them

    float d = 1.0;          // body SDF (body radii; < 0 inside)
    float feat = 0.0;       // thin structures outside the body: flagella, cilia, spikes, spines
    float featGlow = 0.0;   // bright bits within those (virus knobs, spine tips)
    float pat = 0.0;        // interior structure brightness (0..1)
    float clear = 0.0;      // see-through interior (vacuoles, glass)
    vec2 nucC = vec2(0.0);
    float nucR = 0.0;

    if (morph == 0) {
      // Coccus — a plump round cell
      d = rr - (0.9 + 0.03 * wobK * wob(a, T, seed));
      nucC = 0.22 * vec2(cos(seed * 6.28), sin(seed * 6.28)); nucR = 0.32;
      pat = DOTS(p, 4.2, 0.22, seed) * 0.7;
    } else if (morph == 1) {
      // Bacillus — a rod with trailing flagella
      d = sdCapsule(p, vec2(-0.5, 0.0), vec2(0.5, 0.0), 0.4 + 0.012 * wobK * sin(p.x * 6.0 + T));
      float side = sign(p.x + 1e-4);
      float x = abs(p.x) - 0.86;
      if (x > 0.0 && x < 0.95) {
        float k = x * 1.25;
        float y1 = 0.13 * sin(x * 9.0 - T * 6.0 * side) * k + 0.08 * k * side;
        float y2 = 0.13 * sin(x * 9.0 - T * 6.0 * side + 2.1) * k - 0.11 * k * side;
        float fl = min(abs(p.y - y1), abs(p.y - y2));
        feat = (1.0 - smoothstep(0.018, 0.045, fl)) * (1.0 - smoothstep(0.55, 0.95, x)) * alive;
      }
      nucC = vec2(0.08 * sin(seed * 9.0), 0.0); nucR = 0.0;
      pat = (1.0 - smoothstep(0.05, 0.14, abs(p.y + 0.03 * sin(p.x * 5.0 + seed * 7.0)))) * step(abs(p.x), 0.62) * 0.45
          + DOTS(p, 5.5, 0.2, seed) * 0.6;
    } else if (morph == 2) {
      // Virus — capsid with knob-tipped spikes (more links, more spikes)
      d = rr - (0.62 + 0.012 * wobK * wob(a, T, seed));
      float n = clamp(8.0 + vLinks * 0.6, 8.0, 30.0);
      float sec = 6.2831853 / n;
      float ka = mod(a + seed * 3.0, sec) - sec * 0.5;
      float idx = floor((a + seed * 3.0) / sec);
      vec2 q = rr * vec2(cos(ka), sin(ka));
      float sway = 0.03 * sin(T * 1.6 + idx * 1.7) * alive;
      vec2 tip = vec2(0.93, sway);
      float stalk = sdSeg(q, vec2(0.58, 0.0), tip) - mix(0.045, 0.028, clamp((q.x - 0.6) / 0.33, 0.0, 1.0));
      float knob = length(q - tip) - 0.085;
      feat = 1.0 - smoothstep(-0.006, 0.02, min(stalk, knob));
      featGlow = 1.0 - smoothstep(-0.02, 0.03, knob);
      pat = hexLines(p * 6.5 + seed * 3.0) * 0.55 * smoothstep(0.62, 0.3, rr) + DOTS(p, 6.0, 0.25, seed) * 0.35;
    } else if (morph == 3) {
      // Diatom — a rigid glass frustule with ribs and pores
      d = rr - 0.92;
      float K = 22.0 + floor(seed * 14.0);
      float rib = 1.0 - smoothstep(0.08, 0.2, abs(fract(a * K / 6.2831853) - 0.5));
      float pores = (1.0 - smoothstep(0.18, 0.3, length(vec2(fract(rr * 10.0) - 0.5, (fract(a * K / 6.2831853 + 0.5) - 0.5) * 0.9))));
      float zone = smoothstep(0.2, 0.28, rr);
      pat = (rib * 0.55 + pores * 0.4) * zone + ring(rr - 0.2, 0.025) * 0.7 + ring(rr - 0.8, 0.02) * 0.5;
      clear = 0.55;
    } else if (morph == 4) {
      // Amoeba — a shape-shifting blob with pseudopods
      float bumps = 0.0;
      for (int k = 0; k < 3; k++) {
        float fk = float(k);
        float ang = seed * 6.28 + fk * 2.3 + 0.35 * sin(T * 0.3 + fk) * alive;
        bumps += 0.24 * exp(-pow(angDiff(a, ang), 2.0) / 0.09) * (0.55 + 0.45 * sin(T * 0.45 + fk * 2.0));
      }
      d = rr - (0.72 + 0.07 * wobK * wob(a, T * 0.6, seed) + bumps * (0.4 + 0.6 * alive));
      nucC = 0.18 * vec2(cos(seed * 9.0 + 1.0), sin(seed * 9.0 + 1.0)); nucR = 0.27;
      vec2 v1 = 0.38 * vec2(cos(seed * 4.0 + 2.6), sin(seed * 4.0 + 2.6));
      float vac = ring(length(p - v1) - 0.13, 0.03) + ring(length(p + v1 * 0.8) - (0.08 + 0.03 * sin(T * 1.5)), 0.025);
      pat = DOTS(p, 7.0, 0.22, seed) * 0.55 * smoothstep(-0.02, -0.14, d) + vac * 0.7;
      clear = (1.0 - smoothstep(0.0, 0.14, -d)) * 0.35;
    } else if (morph == 5) {
      // Spirillum — a corkscrew
      float A = 0.27, k = 6.8;
      float x = clamp(p.x, -0.92, 0.92);
      float ph = k * x + T * 2.6 * alive + seed * 6.0;
      float dy = p.y - A * sin(ph);
      float slope = A * k * cos(ph);
      float dist = abs(dy) / sqrt(1.0 + slope * slope);
      dist = length(vec2(p.x - x, dist));
      d = dist - 0.12 * (1.0 - 0.45 * smoothstep(0.7, 0.95, abs(p.x)));
      pat = (0.5 + 0.5 * sin(ph * 2.0)) * 0.5;
      float tuft = 0.0;
      float tx = abs(p.x) - 0.92;
      if (tx > 0.0 && tx < 0.3) {
        float ty = A * sin(k * 0.92 * sign(p.x) + T * 2.6 * alive + seed * 6.0);
        tuft = 1.0 - smoothstep(0.015, 0.04, abs(p.y - ty - 0.12 * sin(tx * 14.0 - T * 5.0) * tx * 2.0));
        tuft *= 1.0 - smoothstep(0.15, 0.3, tx);
      }
      feat = tuft * alive;
    } else if (morph == 6) {
      // Paramecium — a slipper fringed with beating cilia
      vec2 q = vec2(p.x, p.y + 0.05 * p.x * p.x);
      d = sdEllipse(q, vec2(0.92, 0.5)) + 0.01 * wobK * wob(a, T, seed);
      float pa = atan(q.y / 0.5, q.x / 0.92);
      float hairs = smoothstep(0.35, 0.95, sin(pa * 46.0 + T * 7.0 + sin(pa * 3.0 + T) * 2.0));
      feat = hairs * step(0.0, d) * (1.0 - smoothstep(0.0, 0.17, d)) * alive;
      nucC = vec2(-0.12, 0.04); nucR = 0.0;
      float macro = 1.0 - smoothstep(0.0, 0.04, sdEllipse(p - vec2(-0.1, 0.02), vec2(0.3, 0.16)));
      float groove = 1.0 - smoothstep(0.02, 0.06, abs(length(p - vec2(0.55, -0.55)) - 0.62)) ;
      groove *= step(0.05, p.x) * step(p.y, 0.1);
      float cv1 = ring(length(p - vec2(0.55, 0.0)) - 0.08 * (0.6 + 0.4 * sin(T * 2.0)), 0.025);
      float cv2 = ring(length(p - vec2(-0.6, 0.02)) - 0.08 * (0.6 + 0.4 * sin(T * 2.0 + 3.1)), 0.025);
      pat = macro * 0.75 + groove * 0.35 + (cv1 + cv2) * 0.6 + DOTS(p, 8.0, 0.18, seed) * 0.35;
    } else if (morph == 7) {
      // Volvox — a hollow globe carrying daughter colonies
      d = rr - (0.94 + 0.01 * wobK * wob(a, T, seed));
      vec2 rp = mat2(cos(T * 0.12), sin(T * 0.12), -sin(T * 0.12), cos(T * 0.12)) * p;
      float shell = (1.0 - smoothstep(0.0, 0.12, -d)) * DOTS(rp, 13.0, 0.3, seed);
      float kids = 0.0;
      for (int k = 0; k < 5; k++) {
        float fk = float(k);
        vec2 c = (0.25 + 0.3 * fract(seed * 7.0 + fk * 0.37)) * vec2(cos(fk * 2.4 + seed * 6.0), sin(fk * 2.4 + seed * 6.0));
        float rk = 0.12 + 0.07 * fract(seed * 13.0 + fk * 0.61);
        float dk = length(rp - c) - rk;
        kids = max(kids, (1.0 - smoothstep(-0.02, 0.01, dk)) * (0.5 + 0.5 * DOTS(rp - c, 26.0, 0.35, fk)));
      }
      pat = shell * 0.8 + kids * 0.9;
      clear = 0.6;
    } else if (morph == 8) {
      // Radiolarian — a latticed capsule bristling with long spines
      d = rr - (0.46 + 0.01 * wobK * wob(a, T, seed));
      float n = clamp(10.0 + vLinks * 0.4, 10.0, 24.0);
      float sec = 6.2831853 / n;
      float ka = mod(a + seed * 2.0, sec) - sec * 0.5;
      float idx = floor((a + seed * 2.0) / sec);
      vec2 q = rr * vec2(cos(ka), sin(ka));
      float len = 1.12 + 0.18 * fract(sin(idx * 12.9898 + seed * 78.233) * 43758.5453);
      vec2 tip = vec2(len, 0.025 * sin(T * 1.1 + idx) * alive);
      float sp = sdSeg(q, vec2(0.4, 0.0), tip) - mix(0.03, 0.006, clamp((q.x - 0.4) / (len - 0.4), 0.0, 1.0));
      feat = 1.0 - smoothstep(-0.004, 0.012, sp);
      featGlow = 1.0 - smoothstep(0.0, 0.06, length(q - tip));
      float froth = (smoothstep(0.46, 0.5, rr) * (1.0 - smoothstep(0.66, 0.8, rr))) * (0.4 + 0.6 * DOTS(p, 11.0, 0.45, seed + 3.0));
      feat = max(feat, froth * 0.45);
      pat = hexLines(p * 9.0 + seed) * 0.7;
    } else {
      // Vibrio — a curved comma with one whip
      vec2 c = vec2(0.0, -0.95);
      vec2 q = p - c;
      float ang = clamp(atan(q.y, q.x), 1.5708 - 0.72, 1.5708 + 0.72);
      vec2 near = c + 1.08 * vec2(cos(ang), sin(ang));
      float tpos = (ang - (1.5708 - 0.72)) / 1.44;
      d = length(p - near) - 0.27 * (1.0 - 0.35 * smoothstep(0.55, 1.0, abs(tpos * 2.0 - 1.0)));
      vec2 e = c + 1.08 * vec2(cos(1.5708 - 0.72), sin(1.5708 - 0.72));
      vec2 tdir = normalize(vec2(sin(1.5708 - 0.72), -cos(1.5708 - 0.72)));
      vec2 lp = p - e;
      float along = dot(lp, tdir);
      if (along > 0.12 && along < 0.85) {
        vec2 nrm = vec2(-tdir.y, tdir.x);
        float off = dot(lp, nrm) - 0.11 * sin(along * 11.0 - T * 7.0) * along;
        feat = (1.0 - smoothstep(0.015, 0.04, abs(off))) * (1.0 - smoothstep(0.6, 0.85, along)) * alive;
      }
      pat = DOTS(p, 6.0, 0.22, seed) * 0.6;
    }

    // Blocked cells crinkle
    d += blocked * 0.02 * sin(a * 13.0 + T * 2.0);

    // ── Shading ──
    float aa = max(fwidth(d), 1e-4) * 1.1;
    float inside = 1.0 - smoothstep(-aa, aa, d);
    float depth = clamp(-d / 0.42, 0.0, 1.0);
    float rim = pow(1.0 - depth, 3.0) * inside;
    vec2 g = vec2(dFdx(d), dFdy(d));
    g /= max(length(g), 1e-6);
    vec3 n = normalize(vec3(g * (1.0 - depth) * 1.5, 1.0));
    vec3 L = normalize(vec3(-0.5, 0.65, 0.75));
    float dif = max(dot(n, L), 0.0);
    float spec = pow(max(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0), 26.0) * inside;

    // Nucleus
    float nuc = 0.0;
    if (nucR > 0.0) {
      vec2 nc = nucC + 0.03 * vec2(sin(T * 0.4), cos(T * 0.33)) * alive;
      float dn = length(p - nc) - nucR;
      nuc = (1.0 - smoothstep(-0.03, 0.02, dn)) * 0.75 + ring(dn, 0.03) * 0.5 + (1.0 - smoothstep(0.0, 0.07, length(p - nc - nucR * 0.25))) * 0.6;
    }
    pat = clamp(pat * detail + nuc * detail, 0.0, 1.0) * inside;

    // ── Colour by state ──
    vec3 base = col;
    float lum = dot(base, vec3(0.299, 0.587, 0.114));
    vec3 sick = vec3(0.62, 0.62, 0.24) * (0.6 + lum);
    base = mix(base, sick, blocked * 0.6);
    base *= 1.0 - blocked * 0.45 * smoothstep(0.55, 0.75, vnoise(p * 4.0 + seed * 9.0));
    vec3 bone = mix(vec3(lum), base, 0.3) * vec3(1.0, 0.95, 0.86);
    vec3 live = base;
    base = mix(base, bone, dorm * 0.8);

    float pulse = 0.5 + 0.5 * sin(uTime * 3.4 + seed * 6.28);
    float flicker = 1.0 - blocked * 0.25 * (0.5 + 0.5 * sin(uTime * 11.0 + seed * 30.0));
    float shellBand = smoothstep(-0.2, -0.13, d) * (1.0 - smoothstep(-0.05, -0.01, d));
    float shell = shellBand * dorm;

    vec3 rgb;
    float alpha;
    float glow;
    if (uDark > 0.5) {
      // Dark-field, alive: lit like a translucent sphere, edges scatter light, the core glows from within
      vec3 body = live * (0.08 + 0.6 * dif);
      body += live * 0.2 * depth;
      body += mix(live, vec3(1.0), 0.15) * pat * 0.5;
      body += mix(live, vec3(1.0), 0.25) * rim * (0.4 + 0.6 * dif) * (0.85 + 0.6 * actv * pulse);
      body += spec * 0.3;
      // Dormant: a dim, matte husk inside a thin pale wall
      vec3 husk = bone * (0.1 + 0.26 * dif) * (1.0 - 0.35 * pat) + bone * 0.42 * shellBand + bone * 0.18 * rim;
      rgb = mix(body, husk, dorm) * flicker;
      alpha = inside * mix(clamp(0.8 + 0.2 * rim + 0.2 * pat - clear * 0.5 * (1.0 - rim), 0.0, 1.0), 0.66, dorm);
      glow = exp(-max(d, 0.0) * 9.0) * (1.0 - inside) * (0.1 + actv * (0.3 + 0.4 * pulse)) * (1.0 - 0.85 * dorm);
    } else {
      // Bright-field: stained, translucent cells with dark membranes
      vec3 body = mix(vec3(1.0), base, 0.32 + 0.3 * depth);
      body *= 0.82 + 0.24 * dif;
      body = mix(body, base * 0.42, clamp(rim * 0.9 + shell * 0.8, 0.0, 1.0));
      body = mix(body, base * 0.5, pat * 0.55);
      body += spec * 0.3 * alive;
      rgb = body * mix(1.0, 0.86, dorm) * flicker;
      alpha = inside * clamp(0.5 + 0.42 * rim + 0.25 * pat - clear * 0.28 * (1.0 - rim), 0.0, 1.0) * (1.0 - 0.15 * dorm);
      glow = 0.0;
      // A faint phase halo on the agar
      alpha = max(alpha, (1.0 - smoothstep(0.0, 0.22, d)) * (1.0 - inside) * 0.1);
    }

    // Too small to resolve: a solid, saturated dot reads better than a faint outline
    float tiny = 1.0 - smoothstep(2.0, 6.5, vPxR);
    if (tiny > 0.0) {
      vec3 dotCol = uDark > 0.5 ? base * (0.55 + 0.45 * dif) + base * 0.25 * (1.0 - dorm) + mix(base, vec3(1.0), 0.5) * actv * pulse * 0.9 : base * (0.78 + 0.22 * dif);
      rgb = mix(rgb, dotCol, tiny * 0.8);
      alpha = mix(alpha, inside * (uDark > 0.5 ? 0.95 : 0.92) * (1.0 - 0.35 * dorm), tiny);
    }

    // Thin structures
    vec3 featCol = uDark > 0.5 ? mix(base, vec3(1.0), 0.15) * (0.7 + 0.7 * featGlow) : base * 0.55;
    float featA = feat * (1.0 - inside) * (uDark > 0.5 ? 0.75 : 0.7) * (1.0 - 0.6 * dorm);
    rgb = mix(rgb, featCol, featA * (1.0 - alpha));
    alpha = max(alpha, featA);

    // Birth: a flash and a ripple through the agar
    float bornF = 1.0 - birth;
    if (bornF > 0.0) {
      rgb += mix(base, vec3(1.0), 0.6) * bornF * bornF * 0.9 * inside;
      float rr2 = 1.15 + birth * 2.5;
      float rip = exp(-abs(rr - rr2) * 18.0) * pow(bornF, 1.4) * 0.55;
      if (uDark > 0.5) { rgb += mix(base, vec3(1.0), 0.4) * rip; alpha = max(alpha, rip * 0.4); }
      else { rgb = mix(rgb, base * 0.5, rip * (1.0 - alpha)); alpha = max(alpha, rip * 0.5); }
    }

    // Focus: hovered/selected get a reticle ring; related brighten; the rest dim
    float sel = step(2.5, focus);
    float rel = step(1.5, focus) * (1.0 - sel);
    if (sel > 0.0) {
      float ext = (morph == 8 ? 1.42 : morph == 1 || morph == 9 ? 1.25 : 1.18);
      float rd = rr - ext;
      float ticks = step(0.8, abs(cos(a * 2.0 + uTime * 0.6)));
      float ringA = ring(rd, 0.035) * (0.55 + 0.45 * ticks) * (0.75 + 0.25 * sin(uTime * 4.0));
      vec3 rc = uDark > 0.5 ? mix(uAccent, vec3(1.0), 0.35) : uAccent;
      rgb = mix(rgb, rc, ringA * (1.0 - alpha)) + rc * ringA * alpha * 0.4;
      alpha = max(alpha, ringA);
      glow *= 1.6;
      rgb += rim * 0.25;
    }
    if (rel > 0.0) { rgb += rim * 0.35 * base; glow *= 1.5; }
    float dim = uFocusMode * step(focus, 0.5);
    if (dim > 0.0) {
      float l2 = dot(rgb, vec3(0.299, 0.587, 0.114));
      rgb = mix(rgb, vec3(l2), 0.6);
      alpha *= 0.28;
      glow *= 0.15;
    }

    alpha *= vis;
    glow *= vis;
    vec3 glowCol = mix(base, vec3(1.0), 0.15) * glow;
    gl_FragColor = vec4(rgb * alpha + glowCol, alpha);
    if (gl_FragColor.a < 0.002 && glow < 0.002) discard;
  }
`;

// ─── Filaments ────────────────────────────────────────────────────────────────

export const FILAMENT_VERT = /* glsl */ `
  ${COMMON}
  attribute float aS;
  attribute float aSide;
  attribute vec2 aEnds;
  attribute vec4 aInfo;   // formed day, cross-colony, weight, seed
  uniform float uDay;
  uniform float uAnimDays;
  uniform float uOnlyFocus;
  varying float vS;
  varying float vSide;
  varying float vAlpha;
  varying float vHi;
  varying float vSeed;
  varying float vAlive;
  varying vec3 vColA;
  varying vec3 vColB;
  varying float vLen;

  void main() {
    int ia = int(aEnds.x + 0.5), ib = int(aEnds.y + 0.5);
    vec4 A = texelFetch(uS0, tcOf(ia), 0), B = texelFetch(uS0, tcOf(ib), 0);
    float vis = min(A.w, B.w);
    float grow = uAnimDays < 1e-3 ? step(aInfo.x, uDay) : clamp((uDay - aInfo.x) / uAnimDays, 0.0, 1.0);
    bool cross = aInfo.y > 0.5;
    if (vis < 0.01 || grow <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    vec4 A1 = texelFetch(uS1, tcOf(ia), 0), B1 = texelFetch(uS1, tcOf(ib), 0);
    float fa = focusOf(A1.w), fb = focusOf(B1.w);
    float hi = max(step(2.5, fa), step(2.5, fb));
    float rel = max(step(1.5, fa), step(1.5, fb));
    // Filaments switched off: only the hovered / selected cell's links show
    if (uOnlyFocus > 0.5 && hi < 0.5) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    vec4 A2 = texelFetch(uS2, tcOf(ia), 0), B2 = texelFetch(uS2, tcOf(ib), 0);
    vec2 pa = A.xy + jiggle(A2.x, A1.y) * A.z;
    vec2 pb = B.xy + jiggle(B2.x, B1.y) * B.z;
    vec2 dv = pb - pa;
    float len = max(length(dv), 1e-4);
    vec2 u = dv / len;
    pa += u * A.z * 1.02;
    pb -= u * B.z * 1.02;
    float L2 = max(length(pb - pa), 0.02);
    vec2 nrm = vec2(-u.y, u.x);
    float seed = aInfo.w;
    float bow = (seed - 0.5) * (cross ? 0.45 : 0.7) * L2 * 0.5;
    vec2 ctrl = (pa + pb) * 0.5 + nrm * bow;
    float s = aS * grow;
    vec2 P = mix(mix(pa, ctrl, s), mix(ctrl, pb, s), s);
    vec2 Tg = normalize(mix(ctrl - pa, pb - ctrl, s) + 1e-5);
    vec2 N = vec2(-Tg.y, Tg.x);
    float alive = 1.0 - 0.5 * (A1.y + B1.y);
    float env = smoothstep(0.0, 0.15, aS) * smoothstep(1.0, 0.85, aS);
    P += N * sin(aS * 11.0 - uTime * 1.8 + seed * 30.0) * 0.05 * alive * env * min(L2 * 0.06, 1.5);

    float wPx = mix(0.9, 2.2, hi) * (1.0 + 0.25 * min(aInfo.z - 1.0, 3.0));
    float w = max(wPx / uPx, 0.07 * (1.0 + hi));
    P += N * aSide * w;

    // From afar thousands of strands would pile into white; they come up as you zoom in
    float zk = smoothstep(2.0, 14.0, uPx);
    float base = cross ? mix(0.025, 0.16, zk) : mix(0.07, 0.5, zk);
    if (hi > 0.5) base = cross ? 0.55 : 0.85;
    float dim = uFocusMode * (1.0 - rel);
    vAlpha = vis * base * mix(1.0, 0.1, dim) * mix(1.0, 0.55, 0.5 * (A1.y + B1.y));
    vS = aS;
    vSide = aSide;
    vHi = hi;
    vSeed = seed;
    vAlive = alive;
    vColA = speciesColor(A2.w);
    vColB = speciesColor(B2.w);
    vLen = L2 * grow;
    gl_Position = projectionMatrix * viewMatrix * vec4(P, 0.0, 1.0);
  }
`;

export const FILAMENT_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uDark;
  uniform float uPx;
  uniform vec3 uAccent;
  varying float vLen;
  varying float vS;
  varying float vSide;
  varying float vAlpha;
  varying float vHi;
  varying float vSeed;
  varying float vAlive;
  varying vec3 vColA;
  varying vec3 vColB;

  void main() {
    float prof = 1.0 - vSide * vSide;
    vec3 c = mix(vColA, vColB, smoothstep(0.2, 0.8, vS));
    float p = fract(uTime * 0.16 + vSeed * 7.0);
    float pulse = (1.0 - smoothstep(0.0, 0.05, abs(vS - p))) * step(0.68, fract(vSeed * 13.7)) * vAlive;
    // Beads along longer strands once you're close enough to see them
    float beadT = vS * vLen / 2.6;
    float bead = (1.0 - smoothstep(0.08, 0.2, abs(fract(beadT) - 0.5))) * smoothstep(6.0, 14.0, uPx) * step(3.0, vLen);
    prof = max(prof, bead * 0.9);
    if (uDark > 0.5) {
      float a = vAlpha * pow(prof, 1.6);
      vec3 rgb = mix(c, vec3(1.0, 0.92, 0.8), 0.15) * (0.6 + 0.7 * vHi) + vec3(1.0, 0.9, 0.75) * pulse * 1.2;
      rgb = mix(rgb, mix(uAccent, vec3(1.0), 0.3), vHi * 0.45);
      gl_FragColor = vec4(rgb * a, 0.0);
    } else {
      float a = vAlpha * pow(prof, 1.1) * 0.85;
      vec3 rgb = c * 0.5 + pulse * 0.3;
      rgb = mix(rgb, uAccent * 0.85, vHi * 0.6);
      gl_FragColor = vec4(rgb * a, a);
    }
  }
`;

// ─── Biofilm halos ────────────────────────────────────────────────────────────

export const HALO_VERT = /* glsl */ `
  ${COMMON}
  varying vec2 vUv;
  varying vec3 vCol;
  varying float vA;
  void main() {
    int i = gl_InstanceID;
    vec4 s0 = texelFetch(uS0, tcOf(i), 0);
    if (s0.w < 0.01) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    vec4 s1 = texelFetch(uS1, tcOf(i), 0);
    vec4 s2 = texelFetch(uS2, tcOf(i), 0);
    float R = s0.z * 2.4 + 2.2;
    vec2 world = s0.xy + position.xy * R;
    vUv = position.xy;
    vCol = speciesColor(s2.w);
    float dim = uFocusMode * (1.0 - step(1.5, focusOf(s1.w)));
    // Biofilm reads at a distance; up close it would only fog the cells
    vA = s0.w * (1.0 - 0.6 * s1.y) * mix(1.0, 0.25, dim) * (1.0 + 0.6 * max(s1.z, 0.0)) * mix(1.0, 0.35, smoothstep(8.0, 30.0, uPx));
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 0.0, 1.0);
  }
`;

export const HALO_FRAG = /* glsl */ `
  uniform float uDark;
  varying vec2 vUv;
  varying vec3 vCol;
  varying float vA;
  // Blended with MAX (dark) / MIN (light), so a dense colony glows evenly instead of piling up
  void main() {
    float f = exp(-dot(vUv, vUv) * 3.0) - 0.05;
    if (f <= 0.0) discard;
    float k = f * vA;
    if (uDark > 0.5) gl_FragColor = vec4(vCol * k * 0.16, 0.0);
    else gl_FragColor = vec4(mix(vec3(1.0), vCol, k * 0.42), 1.0);
  }
`;

// ─── The dish ─────────────────────────────────────────────────────────────────

export const DISH_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = position.xy * 0.5 + 0.5;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

export const DISH_FRAG = /* glsl */ `
  uniform vec2 uCenter;
  uniform vec2 uView;
  uniform float uPx;
  uniform float uDishR;
  uniform float uDark;
  uniform float uTime;
  uniform vec3 uAgarA;
  uniform vec3 uAgarB;
  uniform vec3 uOutside;
  uniform vec3 uRimCol;
  varying vec2 vUv;

  float h12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  float vn(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(h12(i), h12(i + vec2(1.0, 0.0)), u.x), mix(h12(i + vec2(0.0, 1.0)), h12(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float s = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) { s += a * vn(p); p = p * 2.03 + 17.1; a *= 0.5; }
    return s;
  }

  void main() {
    vec2 frag = vUv * uView;
    vec2 w = uCenter + (frag - uView * 0.5) / uPx;
    float d = length(w) - uDishR;
    float ang = atan(w.y, w.x);
    float light = pow(max(cos(ang - 2.25), 0.0), 5.0);

    // Agar: mottled, faintly caustic
    float m = fbm(w * 0.018);
    float m2 = fbm(w * 0.07 + 5.0);
    vec3 agar = mix(uAgarA, uAgarB, (smoothstep(0.25, 0.8, m) * 0.85 + m2 * 0.15) * (uDark > 0.5 ? 1.0 : 0.45));
    // Lamp falloff: a touch brighter toward the light, top-left
    agar *= 0.9 + 0.2 * smoothstep(-1.0, 1.0, (-w.x + w.y) / max(uDishR, 1.0));
    // Fine grain, steady in screen space
    agar *= 0.97 + 0.06 * h12(floor(frag));
    // Counting grid, only when zoomed in
    float gridA = smoothstep(5.0, 14.0, uPx) * (uDark > 0.5 ? 0.05 : 0.07);
    if (gridA > 0.0) {
      vec2 gv = abs(fract(w / 10.0 + 0.5) - 0.5) * 10.0 * uPx;
      float line = 1.0 - smoothstep(0.4, 1.3, min(gv.x, gv.y));
      vec2 gv5 = abs(fract(w / 50.0 + 0.5) - 0.5) * 50.0 * uPx;
      line = max(line * 0.6, 1.0 - smoothstep(0.6, 1.8, min(gv5.x, gv5.y)));
      agar = mix(agar, uDark > 0.5 ? vec3(0.9, 0.7, 0.5) : vec3(0.25, 0.2, 0.15), line * gridA);
    }
    // Inner wall: agar climbs the glass, darker near the edge
    agar *= mix(1.0, uDark > 0.5 ? 0.45 : 0.86, smoothstep(-26.0, 0.0, d));

    vec3 col;
    float rimW = 5.0;
    if (d < 0.0) {
      col = agar;
      col += uRimCol * (1.0 - smoothstep(0.0, 1.6, -d)) * (0.25 + 0.75 * light) * (uDark > 0.5 ? 0.8 : 0.5);
    } else if (d < rimW) {
      // Glass rim
      float t = d / rimW;
      vec3 glass = mix(agar * (uDark > 0.5 ? 0.6 : 1.02), uOutside, t * 0.6);
      float lip1 = 1.0 - smoothstep(0.0, 1.4 / uPx + 0.05, abs(d - 0.3));
      float lip2 = 1.0 - smoothstep(0.0, 1.6 / uPx + 0.05, abs(d - rimW + 0.4));
      float spec = pow(1.0 - abs(t - 0.45) * 2.0, 3.0) * light;
      col = glass + uRimCol * (lip1 * 0.55 + lip2 * 0.35 + spec * 0.6) * (0.35 + 0.65 * light) + uRimCol * 0.06;
    } else {
      // Outside the dish
      float vign = smoothstep(uDishR * 2.4, uDishR * 0.9, length(w));
      col = uOutside * (0.55 + 0.45 * vign);
      if (uDark < 0.5) col *= 1.0 - 0.18 * exp(-(d - rimW) * 0.06);
    }
    gl_FragColor = vec4(col, 1.0);
  }
`;

// ─── Drifting motes (parallax depth) ─────────────────────────────────────────

export const MOTE_VERT = /* glsl */ `
  uniform float uTime;
  uniform float uPx;
  uniform vec2 uCenter;
  uniform float uDpr;
  attribute vec4 aInfo;   // size, layer (0 deep · 1 plane · 2 foreground bokeh), seed, brightness
  varying float vLayer;
  varying float vBright;
  void main() {
    float layer = aInfo.y;
    float seed = aInfo.z;
    vec2 p = position.xy;
    p += vec2(sin(uTime * 0.05 + seed * 30.0), cos(uTime * 0.043 + seed * 21.0)) * (2.0 + 4.0 * layer);
    float par = layer < 0.5 ? 0.22 : layer < 1.5 ? 0.0 : -0.35;
    p += uCenter * par;
    float size = aInfo.x * uPx * (layer > 1.5 ? 1.0 : 1.0);
    gl_PointSize = clamp(size, layer > 1.5 ? 6.0 : 1.2, layer > 1.5 ? 90.0 : 9.0) * uDpr;
    vLayer = layer;
    vBright = aInfo.w;
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 0.0, 1.0);
  }
`;

export const MOTE_FRAG = /* glsl */ `
  uniform float uDark;
  uniform float uMoteA;
  varying float vLayer;
  varying float vBright;
  void main() {
    vec2 c = gl_PointCoord * 2.0 - 1.0;
    float r = length(c);
    if (r > 1.0) discard;
    float a;
    if (vLayer > 1.5) a = (1.0 - smoothstep(0.55, 1.0, r)) * (0.6 + 0.4 * smoothstep(0.4, 0.95, r)) * 0.05;
    else a = (1.0 - smoothstep(0.0, 1.0, r)) * (vLayer < 0.5 ? 0.22 : 0.45);
    a *= vBright * uMoteA;
    if (uDark > 0.5) gl_FragColor = vec4(vec3(1.0, 0.78, 0.5) * a, 0.0);
    else gl_FragColor = vec4(vec3(0.35, 0.28, 0.2) * a, a * 0.6);
  }
`;

// ─── Lens: vignette, a touch of chromatic aberration, grain ──────────────────

export const LENS_FRAG = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform float uTime;
  uniform float uDark;
  uniform vec2 uRes;
  varying vec2 vUv;
  float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  void main() {
    vec2 uv = vUv;
    vec2 c = uv - 0.5;
    float r2 = dot(c, c);
    vec2 off = c * r2 * 0.006;
    vec4 base = texture2D(tDiffuse, uv);
    vec3 col = vec3(texture2D(tDiffuse, uv + off).r, base.g, texture2D(tDiffuse, uv - off).b);
    float vig = 1.0 - smoothstep(0.18, 0.75, r2 * (uRes.x / uRes.y > 1.0 ? 1.0 : 1.3)) * (uDark > 0.5 ? 0.55 : 0.22);
    col *= vig;
    float g = h(uv * uRes + fract(uTime) * 91.7) - 0.5;
    col += g * (uDark > 0.5 ? 0.025 : 0.018);
    gl_FragColor = vec4(col, base.a);
  }
`;

export const LENS_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
