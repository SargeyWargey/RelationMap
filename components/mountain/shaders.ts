// GLSL for The Mountain. All materials share the lighting/fog chunk so the
// terrain, water, trees and props sit in the same atmosphere.

export const LIGHT = /* glsl */ `
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uSkyAmb;
  uniform vec3 uGroundAmb;
  uniform vec3 uFogColor;
  uniform vec3 uFogSun;
  uniform float uFogDensity;
  uniform vec3 uCamPos;
  uniform float uTime;
  uniform float uNight;
  uniform vec3 uLampPos;
  uniform float uLamp;

  /** Warm headlamp pool around the hiker at night. */
  vec3 lampLight(vec3 wp, vec3 n) {
    if (uLamp <= 0.0) return vec3(0.0);
    vec3 d = uLampPos - wp;
    float d2 = dot(d, d);
    float att = uLamp / (1.0 + d2 * 0.035) * (1.0 - smoothstep(200.0, 500.0, d2));
    return vec3(1.0, 0.76, 0.48) * att * max(dot(n, d * inversesqrt(max(d2, 1e-4))), 0.0);
  }

  vec3 applyFog(vec3 col, vec3 wp) {
    vec3 d = wp - uCamPos;
    float dist = length(d);
    float low = exp(-max(wp.y, 0.0) * 0.0065);
    float f = 1.0 - exp(-dist * uFogDensity * (0.5 + 1.1 * low));
    float sunAmt = pow(max(dot(d / max(dist, 1e-3), uSunDir), 0.0), 6.0);
    return mix(col, mix(uFogColor, uFogSun, sunAmt), clamp(f, 0.0, 1.0));
  }
`;

export const DETAIL_FN = /* glsl */ `
  uniform sampler2D uNoise;
  float detailAt(vec2 xz, float hb) {
    float amp = 0.3 + 0.7 * smoothstep(3.0, 50.0, hb);
    float a = textureLod(uNoise, xz * 0.045, 0.0).r;
    float b = textureLod(uNoise, xz * 0.17, 0.0).g;
    return ((a - 0.5) * 5.0 + (b - 0.5) * 1.4) * amp;
  }
`;

/** Sun/moon visibility from the 8-direction horizon map — works for any light direction. */
export const HORIZON_FN = /* glsl */ `
  uniform sampler2D uHorA;
  uniform sampler2D uHorB;
  float horizonPick(vec4 a, vec4 b, float k) {
    k = mod(k, 8.0);
    if (k < 4.0) return k < 1.0 ? a.x : k < 2.0 ? a.y : k < 3.0 ? a.z : a.w;
    return k < 5.0 ? b.x : k < 6.0 ? b.y : k < 7.0 ? b.z : b.w;
  }
  float lightVisibility(vec2 uv, vec3 L) {
    if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return smoothstep(-0.02, 0.06, L.y);
    float az = atan(L.z, L.x);
    if (az < 0.0) az += 6.2831853;
    float f = az / 6.2831853 * 8.0;
    float i0 = floor(f);
    vec4 a = texture2D(uHorA, uv);
    vec4 b = texture2D(uHorB, uv);
    float hz = mix(horizonPick(a, b, i0), horizonPick(a, b, i0 + 1.0), f - i0) * 1.5707963;
    float el = asin(clamp(L.y, -1.0, 1.0));
    return smoothstep(hz - 0.015, hz + 0.075, el);
  }
`;

export const HEIGHT_FN = /* glsl */ `
  uniform sampler2D uHeight;
  uniform float uN;
  uniform float uCell;
  uniform vec2 uMin;
  float hTexel(ivec2 c) {
    c = clamp(c, ivec2(0), ivec2(int(uN) - 1));
    return texelFetch(uHeight, c, 0).r;
  }
  /** Bilinear height at world xz (matches the CPU sampler). */
  float terrainHeight(vec2 xz) {
    vec2 g = (xz - uMin) / uCell;
    if (g.x < 0.0 || g.y < 0.0 || g.x > uN - 1.0 || g.y > uN - 1.0) return -60.0;
    vec2 f = floor(g);
    vec2 t = g - f;
    ivec2 c = ivec2(f);
    return mix(mix(hTexel(c), hTexel(c + ivec2(1, 0)), t.x), mix(hTexel(c + ivec2(0, 1)), hTexel(c + ivec2(1, 1)), t.x), t.y);
  }
`;

// ── Terrain ───────────────────────────────────────────────────────────────────

export const TERRAIN_VERT = /* glsl */ `
  ${HEIGHT_FN}
  ${DETAIL_FN}
  attribute vec2 aChunk;
  uniform float uChunkCells;
  uniform float uSkirt;
  varying vec2 vUv;
  varying vec3 vWorld;
  void main() {
    vec2 g = aChunk + position.xz * uChunkCells;
    vec2 xz = uMin + g * uCell;
    float hb = terrainHeight(xz);
    float h = hb + detailAt(xz, hb) - position.y * uSkirt;
    vec3 wp = vec3(xz.x, h, xz.y);
    vUv = (g + 0.5) / uN;
    vWorld = wp;
    gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  }
`;

export const TERRAIN_FRAG = /* glsl */ `
  ${LIGHT}
  ${DETAIL_FN}
  ${HORIZON_FN}
  uniform sampler2D uNS;
  uniform sampler2D uAO;
  uniform sampler2D uTint;
  uniform float uSnowLine;
  uniform float uTreeLine;
  uniform float uCloudShadow;
  uniform vec2 uWind;
  uniform vec3 uGrassA;
  uniform vec3 uGrassB;
  uniform vec3 uForestFloor;
  uniform vec3 uDirt;
  uniform vec3 uSand;
  uniform vec3 uRockA;
  uniform vec3 uRockB;
  uniform vec3 uSnow;
  varying vec2 vUv;
  varying vec3 vWorld;

  void main() {
    vec4 ns = texture2D(uNS, vUv);
    vec3 n = normalize(ns.xyz * 2.0 - 1.0);
    vec3 nMacro = n;
    float shadow = lightVisibility(vUv, uSunDir);
    // Add the displacement's slope to the baked normal (close range only)
    {
      float e = 0.6;
      float hb = vWorld.y;
      float gx = (detailAt(vWorld.xz + vec2(e, 0.0), hb) - detailAt(vWorld.xz - vec2(e, 0.0), hb)) / (2.0 * e);
      float gz = (detailAt(vWorld.xz + vec2(0.0, e), hb) - detailAt(vWorld.xz - vec2(0.0, e), hb)) / (2.0 * e);
      float k = 1.0 - smoothstep(300.0, 1200.0, length(vWorld - uCamPos));
      n = normalize(vec3(n.x / max(n.y, 0.2) - gx * k, 1.0, n.z / max(n.y, 0.2) - gz * k));
    }
    vec4 aoF = texture2D(uAO, vUv);
    float ao = aoF.r;
    float forest = aoF.g;
    vec4 tint = texture2D(uTint, vUv);
    vec2 p = vWorld.xz;
    float dist = length(vWorld - uCamPos);

    vec4 n1 = texture2D(uNoise, p * 0.0037);
    vec4 n2 = texture2D(uNoise, p * 0.029);
    float nearDetail = 1.0 - smoothstep(250.0, 900.0, dist);
    float closeDetail = 1.0 - smoothstep(40.0, 220.0, dist);
    // Triplanar fine noise so cliffs don't streak
    vec3 tw = pow(abs(n), vec3(4.0));
    tw /= (tw.x + tw.y + tw.z);
    vec3 wp3 = vWorld;
    vec4 n3 = texture2D(uNoise, wp3.xz * 0.19) * tw.y + texture2D(uNoise, wp3.xy * 0.19) * tw.z + texture2D(uNoise, wp3.zy * 0.19) * tw.x;
    vec4 n4 = texture2D(uNoise, wp3.xz * 0.83) * tw.y + texture2D(uNoise, wp3.xy * 0.83) * tw.z + texture2D(uNoise, wp3.zy * 0.83) * tw.x;

    // Micro relief: perturb the baked normal with layered noise (fades with distance)
    vec2 dn = (n2.rg - 0.5) * 0.42 + (n3.rg - 0.5) * 0.32 * nearDetail + (n4.rg - 0.5) * 0.3 * closeDetail;
    vec3 nd = normalize(n + vec3(dn.x, 0.0, dn.y) * (0.35 + 0.65 * (1.0 - n.y)));
    float h = vWorld.y;
    float slope = 1.0 - mix(nMacro.y, n.y, 0.35);   // materials follow the broad slope; detail only lights

    float v = n1.b * 0.6 + n2.b * 0.4;
    vec3 grass = mix(uGrassA, uGrassB, v);
    grass *= 0.88 + 0.24 * mix(0.5, n4.a, closeDetail) + 0.1 * (n3.b - 0.5) * nearDetail;
    grass = mix(grass, uForestFloor, forest * 0.75 * (1.0 - smoothstep(uTreeLine * 0.7, uTreeLine, h)));
    vec3 rock = mix(uRockA, uRockB, n2.r * 0.55 + n3.g * 0.3 * nearDetail + n4.b * 0.25 * closeDetail);
    rock *= 0.86 + 0.18 * sin(h * 0.42 + n2.g * 4.0);                  // strata
    rock = mix(rock, rock * (0.55 + tint.rgb * 0.9), tint.a * 0.32);   // the range's mineral tint

    float rockAmt = smoothstep(0.24, 0.42, slope + (n1.g - 0.5) * 0.12 + (n2.r - 0.5) * 0.05) + smoothstep(uTreeLine + 8.0, uTreeLine + 48.0, h) * 0.7;
    rockAmt = clamp(rockAmt, 0.0, 1.0);
    vec3 col = mix(grass, rock, rockAmt);
    col = mix(col, uDirt, smoothstep(0.17, 0.3, slope) * (1.0 - rockAmt) * 0.65);

    float sandAmt = 1.0 - smoothstep(1.2, 4.5, h + (n2.g - 0.5) * 3.0);
    col = mix(col, uSand, sandAmt);
    col = mix(col, uSand * 0.5, smoothstep(0.0, -7.0, h));             // lake / sea bed

    float snowLine = uSnowLine + (n1.r - 0.5) * 40.0 + (n2.g - 0.5) * 12.0;
    float snow = smoothstep(snowLine - 5.0, snowLine + 7.0, h) * (1.0 - smoothstep(0.48, 0.7, slope));
    snow = max(snow, smoothstep(snowLine + 30.0, snowLine + 50.0, h) * 0.85);  // high faces dusted even when steep
    col = mix(col, uSnow, snow);
    col = mix(col, tint.rgb, tint.a * 0.05 * (1.0 - snow));

    // Clouds drifting over the land (day)
    float cloud = texture2D(uNoise, p * 0.00055 + uWind * uTime).r;
    float cloudShade = 1.0 - smoothstep(0.52, 0.72, cloud) * uCloudShadow;

    float ndl = max(dot(nd, uSunDir), 0.0);
    float sh = shadow * cloudShade;
    vec3 amb = mix(uGroundAmb, uSkyAmb, nd.y * 0.5 + 0.5) * (0.35 + 0.65 * ao) * (1.0 + snow * 0.9);
    vec3 lit = col * (uSunColor * ndl * sh + amb + lampLight(vWorld, nd));
    vec3 v2c = normalize(uCamPos - vWorld);
    lit += uSunColor * snow * pow(max(dot(reflect(-uSunDir, nd), v2c), 0.0), 20.0) * 0.18 * sh;
    // Rim light on ridges facing away from the sun, so silhouettes read
    lit += uSkyAmb * pow(1.0 - max(dot(nd, v2c), 0.0), 4.0) * 0.18;

    gl_FragColor = vec4(applyFog(lit, vWorld), 1.0);
    #include <colorspace_fragment>
  }
`;

// ── Water ─────────────────────────────────────────────────────────────────────

export const WATER_VERT = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

export const WATER_FRAG = /* glsl */ `
  ${LIGHT}
  ${HEIGHT_FN}
  ${HORIZON_FN}
  uniform sampler2D uNoise;
  uniform vec3 uShallow;
  uniform vec3 uDeep;
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  varying vec3 vWorld;
  void main() {
    float depth = -terrainHeight(vWorld.xz);
    vec2 p = vWorld.xz;
    vec4 a = texture2D(uNoise, p * 0.018 + uTime * vec2(0.010, 0.006));
    vec4 b = texture2D(uNoise, p * 0.043 - uTime * vec2(0.008, 0.013));
    vec2 w = (a.rg + b.gr - 1.0) * 0.32;
    vec3 n = normalize(vec3(w.x, 1.0, w.y));
    vec3 v = normalize(uCamPos - vWorld);
    float fres = 0.03 + 0.97 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
    vec3 r = reflect(-v, n);
    vec3 sky = mix(uHorizon, uZenith, pow(clamp(r.y, 0.0, 1.0), 0.5));
    vec3 body = mix(uShallow, uDeep, smoothstep(0.0, 16.0, depth));
    vec2 uv = (p - uMin) / uCell / uN;
    float shadow = lightVisibility(uv, uSunDir);
    vec3 amb = mix(uGroundAmb, uSkyAmb, 0.8);
    vec3 col = body * (uSunColor * 0.45 * shadow + amb);
    col = mix(col, sky, fres * 0.85);
    col += uSunColor * pow(max(dot(reflect(-uSunDir, n), v), 0.0), 140.0) * 2.2 * shadow;
    float foam = (1.0 - smoothstep(0.0, 1.4, depth)) * (0.55 + 0.45 * sin(uTime * 1.6 + depth * 7.0 + a.b * 9.0));
    col = mix(col, vec3(0.92, 0.95, 0.97) * (amb + uSunColor * 0.6 * shadow), clamp(foam, 0.0, 1.0) * 0.55);
    float alpha = mix(0.5, 0.96, smoothstep(0.0, 5.0, depth));
    if (depth < -0.3) discard;
    gl_FragColor = vec4(applyFog(col, vWorld), alpha);
    #include <colorspace_fragment>
  }
`;

// ── Sky ───────────────────────────────────────────────────────────────────────

export const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww;
  }
`;

export const SKY_FRAG = /* glsl */ `
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uSunPos;
  uniform vec3 uMoonPos;
  uniform vec3 uSunDisc;
  uniform vec3 uFogSun;
  uniform vec3 uCloudColor;
  uniform float uNight;
  uniform float uTime;
  uniform vec2 uWind;
  uniform sampler2D uNoise;
  varying vec3 vDir;

  float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }

  void main() {
    vec3 d = normalize(vDir);
    float y = d.y;
    vec3 col = mix(uHorizon, uZenith, pow(clamp(y, 0.0, 1.0), 0.48));
    col = mix(col, uHorizon * 0.85, clamp(-y * 3.0, 0.0, 1.0));
    float sd = max(dot(d, uSunPos), 0.0);
    float md = max(dot(d, uMoonPos), 0.0);
    float above = smoothstep(-0.04, 0.02, y);
    // Sun: disc + scattering halo (warm near the horizon)
    col += uSunDisc * smoothstep(0.99955, 1.0, sd) * 10.0 * above;
    col += uFogSun * (pow(sd, 8.0) * 0.45 + pow(sd, 64.0) * 0.6) * smoothstep(-0.25, 0.05, uSunPos.y);
    // Moon: pale disc with a soft glow
    vec3 moonCol = vec3(0.86, 0.9, 1.0);
    col += moonCol * smoothstep(0.99965, 0.99985, md) * 2.4 * above * uNight;
    col += moonCol * pow(md, 90.0) * 0.18 * uNight;

    if (y > 0.0) {
      // Stars + aurora at night
      if (uNight > 0.01) {
        vec3 sp = floor(d * 380.0);
        float s = hash(sp);
        float star = step(0.9965, s) * (0.5 + 0.5 * sin(uTime * (1.0 + s * 3.0) + s * 40.0));
        col += vec3(0.85, 0.9, 1.0) * star * smoothstep(0.02, 0.25, y) * 0.9 * uNight;
        float band = texture2D(uNoise, vec2(d.x * 0.35 + uTime * 0.004, d.z * 0.08)).r;
        float curtain = smoothstep(0.45, 0.8, band) * smoothstep(0.12, 0.3, y) * (1.0 - smoothstep(0.45, 0.75, y));
        float ripple = 0.6 + 0.4 * sin(d.x * 40.0 + uTime * 0.6 + band * 10.0);
        col += mix(vec3(0.1, 0.9, 0.55), vec3(0.45, 0.25, 0.9), smoothstep(0.25, 0.6, y)) * curtain * ripple * 0.22 * uNight;
      }
      // Clouds on a plane overhead
      vec2 cp = d.xz / (y + 0.06) * 0.22 + uWind * uTime * 6.0;
      float c = texture2D(uNoise, cp).r * 0.62 + texture2D(uNoise, cp * 2.7 + 0.3).g * 0.38;
      float cover = smoothstep(0.5, 0.8, c) * smoothstep(0.0, 0.22, y);
      float lit = 0.75 + 0.35 * pow(sd, 3.0) + 0.6 * pow(sd, 12.0) * smoothstep(0.3, 0.0, uSunPos.y);
      col = mix(col, uCloudColor * lit, cover * mix(0.85, 0.55, uNight));
    }
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

// ── Instanced props: trees, flags, poles, cairns ──────────────────────────────

export const PROP_VERT = /* glsl */ `
  ${HORIZON_FN}
  attribute float aTop;
  uniform float uWave;
  uniform float uSway;
  uniform float uTime;
  uniform vec3 uSunDir;
  uniform vec2 uMin;
  uniform float uSize;
  varying vec3 vColor;
  varying vec3 vNormal;
  varying vec3 vWorld;
  varying float vShadow;
  void main() {
    vec3 p = position;
    vec4 base = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    if (uWave > 0.5) {
      // Flag cloth: ripple grows away from the pole
      float k = p.x;
      p.z += sin(p.x * 3.2 - uTime * 6.0 + base.x * 0.3) * 0.22 * k;
      p.y += sin(p.x * 2.1 - uTime * 4.0) * 0.06 * k;
    }
    vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
    if (uSway > 0.0) {
      float s = sin(uTime * 1.2 + base.x * 0.045 + base.z * 0.06) + 0.4 * sin(uTime * 2.3 + base.z * 0.1);
      wp.x += s * uSway * aTop;
      wp.z += s * uSway * aTop * 0.6;
    }
    vWorld = wp.xyz;
    vNormal = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
    #ifdef USE_INSTANCING_COLOR
      vColor = color * instanceColor;
    #else
      vColor = color;
    #endif
    vec2 uv = (base.xz - uMin) / uSize;
    vShadow = lightVisibility(uv, uSunDir);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

export const PROP_FRAG = /* glsl */ `
  ${LIGHT}
  uniform float uEmissive;
  varying vec3 vColor;
  varying vec3 vNormal;
  varying vec3 vWorld;
  varying float vShadow;
  void main() {
    vec3 n = normalize(vNormal);
    if (!gl_FrontFacing) n = -n;
    float ndl = max(dot(n, uSunDir), 0.0) * 0.85 + 0.15 * max(dot(-n, uSunDir), 0.0);
    vec3 amb = mix(uGroundAmb, uSkyAmb, n.y * 0.5 + 0.5);
    vec3 col = vColor * (uSunColor * ndl * vShadow + amb + lampLight(vWorld, n)) + vColor * uEmissive;
    gl_FragColor = vec4(applyFog(col, vWorld), 1.0);
    #include <colorspace_fragment>
  }
`;

// ── Summit beacons (map view dots) ───────────────────────────────────────────

export const DOT_VERT = /* glsl */ `
  attribute float aSize;
  attribute vec3 aColor;
  attribute float aPeak;
  uniform float uPxScale;
  uniform float uSel;
  uniform float uHover;
  uniform float uFadeNear;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vEmph;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float d = -mv.z;
    float emph = max(step(abs(aPeak - uSel), 0.5), step(abs(aPeak - uHover), 0.5) * 0.7);
    float px = clamp(aSize * uPxScale / d * 0.22, 1.1, 4.5) * (1.0 + emph * 1.2);
    gl_PointSize = px * 2.6;
    vColor = aColor;
    vEmph = emph;
    // Only notable summits carry a beacon; hovered/selected always do
    float notable = smoothstep(90.0, 170.0, aSize);
    vAlpha = smoothstep(uFadeNear, uFadeNear * 2.2, d) * max(notable * 0.85, emph);
    gl_Position = projectionMatrix * mv;
  }
`;

export const DOT_FRAG = /* glsl */ `
  uniform float uNight;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vEmph;
  void main() {
    vec2 c = gl_PointCoord * 2.0 - 1.0;
    float d = length(c) * 2.6;
    float core = 1.0 - smoothstep(0.75, 1.0, d);
    float ring = (1.0 - smoothstep(0.0, 0.18, abs(d - 1.35))) * 0.9;
    float glow = exp(-d * d * 0.9) * mix(0.12, 0.5, uNight);
    float a = max(core, max(glow, ring * 0.0));
    vec3 col = mix(vColor, vec3(1.0), core * 0.35);
    col = mix(col, vec3(1.0), (1.0 - smoothstep(0.0, 0.2, abs(d - 1.8))) * vEmph);
    a = max(a, (1.0 - smoothstep(0.0, 0.2, abs(d - 1.8))) * vEmph);
    a *= vAlpha;
    if (a < 0.01) discard;
    gl_FragColor = vec4(col, a);
    #include <colorspace_fragment>
  }
`;

// ── Light beams over summits ──────────────────────────────────────────────────

export const BEAM_VERT = /* glsl */ `
  varying float vY;
  varying vec3 vColor;
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
    vY = position.y;
    #ifdef USE_INSTANCING_COLOR
      vColor = instanceColor;
    #else
      vColor = vec3(1.0);
    #endif
    vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
    vV = normalize(cameraPosition - wp.xyz);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

export const BEAM_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uIntensity;
  varying float vY;
  varying vec3 vColor;
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    float edge = pow(abs(dot(normalize(vN), normalize(vV))), 1.5);
    float fade = (1.0 - smoothstep(0.0, 1.0, vY)) * smoothstep(0.0, 0.02, vY);
    float flow = 0.75 + 0.25 * sin(vY * 40.0 - uTime * 3.0);
    float a = edge * fade * flow * uIntensity;
    gl_FragColor = vec4(vColor * (1.0 + a), a);
    #include <colorspace_fragment>
  }
`;

// ── Relation arcs ─────────────────────────────────────────────────────────────

export const ARC_VERT = /* glsl */ `
  attribute float aU;
  varying float vU;
  void main() {
    vU = aU;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const ARC_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  varying float vU;
  void main() {
    float pulse = exp(-pow((fract(vU * 1.5 - uTime * 0.45) - 0.5) * 6.0, 2.0));
    float a = (0.35 + 0.65 * pulse) * (0.4 + 0.6 * sin(3.14159 * vU));
    gl_FragColor = vec4(mix(uColor, vec3(1.0), pulse * 0.5), a);
    #include <colorspace_fragment>
  }
`;

// ── Blob shadow under the hiker ───────────────────────────────────────────────

export const BLOB_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
export const BLOB_FRAG = /* glsl */ `
  uniform float uOpacity;
  varying vec2 vUv;
  void main() {
    float d = length(vUv - 0.5) * 2.0;
    float a = (1.0 - smoothstep(0.2, 1.0, d)) * uOpacity;
    gl_FragColor = vec4(0.0, 0.0, 0.0, a);
  }
`;
