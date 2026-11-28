// WebGL renderer of the cylinder (no libraries). Same interface as the canvas 2D fallback (VIEW2D):
// init(canvas, frame), resize(), draw(s), hit(x, y, s), onBody(x, y), burst(), G.
//
// World units: cylinder radius 1, y axis up. A point at angle a (0 = facing the viewer when the view
// angle is 0) and radius r is at x = r sin a, z = r cos a. The camera looks at the axis from distance
// DIST, tilted down by the pitch; screen x = cx + f X / (DIST - Z), y = cy - f Y / (DIST - Z) in camera
// space. The same projection is used by the shaders, by the picking ray and by the 2D layers.
//
// Every piece of a ring (tile, rib, bar between columns, filler behind a tile) is a rounded box built
// once in "unrolled" coordinates (arc length s, height y, radius d) and bent onto the cylinder by the
// vertex shader at the angle of its column, so a whole ring turns by changing one uniform.
// Caps and the dark inner core are solids of revolution with rounded edges.
//
// One frame:
//   1. shadow map: depth of the scene seen from the key light (packed into an RGBA texture)
//   2. studio backdrop: a curved sweep (floor turning into a wall), ray-traced per pixel, lit by the
//      softbox, with ray-traced soft shadow and ambient occlusion of the cylinder
//   3. glow halo (drawn on a hidden 2D canvas, composited as a texture)
//   4. reflection: the cylinder mirrored under the floor, fading with the distance from it
//   6. the cylinder: per-pixel light, shadows, ambient occlusion in the crevices, plastic grain,
//      light on the rounded edges, embossed stars
// Confetti go on a 2D canvas over everything.
const VIEW = (() => {
  const RAD = Math.PI / 180;
  const HALF = 23;                 // half width of a tile slot in degrees (the rest is black bar)
  const RB = 1.0, RT = 1.05, RC = 1.07, RH = 0.9;   // body, tile face, caps, inner core
  const ROWH = 0.74, TOP = 1.11, BOT = TOP - 3 * ROWH;
  const M = 0.005, GM = 0.006;     // tile inset from the ring edges, half width of the grooves between rings
  const CAP_T = 0.3, CAP_B = 0.34;
  const FLOOR = BOT - CAP_B;       // the floor the cylinder stands on
  const DIST = 6.2, NEAR = DIST - 3.2, FAR = DIST + 3.6;
  const RIB = 4.5;                 // half width of a rib in degrees
  const SM = 2048, LS = 3.4;       // shadow map size, half size of the light's view
  const SWEEP_Z = -4.2, SWEEP_R = 2.2;   // backdrop: wall position and radius of the curve to the floor
  // The one light of the scene (world space): a big spherical softbox above, on the left and a bit in front.
  // It lights the cylinder and the backdrop and casts every shadow (shadow map on the cylinder,
  // ray-traced soft shadow on the floor). In dark mode it is a spot aimed at the cylinder.
  const LIGHT_P = [-2.6, 9.0, 3.4], LIGHT_R = 2.6;
  const FILL_D = [0.8, 0.25, 0.55];   // weak fill from the right (no shadows)
  const SHADOW_TOP = TOP + CAP_T;     // the cylinder as an occluder for the floor: radius RC, FLOOR..SHADOW_TOP

  let cv, gl = null, under, over, uctx, octx, frame, dpr = 1, W = 0, H = 0, f = 1, cx = 0, cy = 0, cp = 1, sp = 0;
  let light = false, glow = 0, fallback = null, edgeFade = 0;
  const G = { R: 100, cx: 0, cy: 0 };
  const confetti = [];

  // ---------- shaders ----------
  const CONST = `
#define TOP ${TOP.toFixed(4)}
#define BOT ${BOT.toFixed(4)}
#define ROWH ${ROWH.toFixed(4)}
#define RIBHS ${(RIB * RAD * 1.03).toFixed(4)}
`;
  // camera, projection and light space, shared by the vertex shaders
  const VCOMMON = `
uniform vec2 uCS;      // cos, sin of the pitch
uniform vec4 uProj;    // 2cx/W-1, 1-2cy/H, 2f/W, 2f/H
uniform vec3 uDepth;   // DIST, A, B (depth = A + B / w)
uniform vec3 uLX, uLY, uLZ;   // light space axes (camera space), uLZ points to the light
uniform float uLS, uFloorY;
vec3 toCam(vec3 w) { return vec3(w.x, w.y * uCS.x - w.z * uCS.y, w.y * uCS.y + w.z * uCS.x); }
vec4 project(vec3 c) {
  float ww = uDepth.x - c.z;
  return vec4(uProj.x * ww + uProj.z * c.x, uProj.y * ww + uProj.w * c.y, uDepth.y * ww + uDepth.z, ww);
}
vec3 lightNDC(vec3 c) { return vec3(dot(c, uLX), dot(c, uLY), dot(c, uLZ)) / uLS; }
vec3 lightUV(vec3 c) { vec3 l = lightNDC(c); return vec3(l.xy * 0.5 + 0.5, -l.z * 0.5 + 0.5); }
`;
  // bend a piece onto the cylinder (optionally mirrored under the floor)
  const VBEND = `
attribute vec3 aPos; attribute vec3 aNrm;
uniform float uTheta, uRref, uY, uMirror;
float gWY;
void bend(out vec3 c, out vec3 n) {
  float th = uTheta + aPos.x / uRref;
  float r = aPos.z;
  vec3 w = vec3(r * sin(th), uY + aPos.y, r * cos(th));
  vec3 t = vec3(cos(th), 0.0, -sin(th)), rd = vec3(sin(th), 0.0, cos(th));
  vec3 nw = aNrm.x * t + vec3(0.0, aNrm.y, 0.0) + aNrm.z * rd;
  if (uMirror > 0.5) { w.y = 2.0 * uFloorY - w.y; nw.y = -nw.y; }
  gWY = w.y;
  c = toCam(w); n = toCam(nw);
}
`;
  // soft shadow lookup, shared by the fragment shaders
  const FSHADOW = `
uniform sampler2D uShadow;
uniform float uTexel, uShadowOn;
float unpackD(vec4 c) { return dot(c, vec4(1.0, 1.0 / 255.0, 1.0 / 65025.0, 1.0 / 16581375.0)); }
float shadowAt(vec3 s, float bias) {
  if (uShadowOn < 0.5 || s.x < 0.0 || s.x > 1.0 || s.y < 0.0 || s.y > 1.0) return 1.0;
  float sum = 0.0;
  for (int i = -2; i <= 2; i++) for (int j = -2; j <= 2; j++) {
    float d = unpackD(texture2D(uShadow, s.xy + vec2(float(i), float(j)) * uTexel * 1.6));
    sum += s.z - bias > d ? 0.0 : 1.0;
  }
  return sum / 25.0;
}
`;

  const VS_SHADOW = VCOMMON + VBEND + `
void main() {
  vec3 c, n; bend(c, n);
  vec3 l = lightNDC(c);
  gl_Position = vec4(l.xy, -l.z, 1.0);
}`;
  const FS_SHADOW = `
precision highp float;
void main() {
  vec4 e = fract(vec4(1.0, 255.0, 65025.0, 16581375.0) * gl_FragCoord.z);
  e -= e.yzww * vec4(1.0 / 255.0, 1.0 / 255.0, 1.0 / 255.0, 0.0);
  gl_FragColor = e;
}`;

  const VS = VCOMMON + VBEND + `
varying vec3 vP, vN, vL, vLN, vS;
varying float vWY;
void main() {
  vec3 c, n; bend(c, n);
  vP = c; vN = n; vL = aPos; vLN = aNrm; vWY = gWY;
  vS = lightUV(c + normalize(n) * 0.012);    // small normal offset against shadow acne
  gl_Position = project(c);
}`;

  const FS = `
precision highp float;
` + CONST + FSHADOW + `
varying vec3 vP, vN, vL, vLN, vS;
varying float vWY;
uniform vec3 uColor, uKeyP, uFill;   // light position and fill direction (camera space)
uniform float uLR;
uniform float uSpec, uShin, uGlow, uStar, uHi, uDist, uAmb, uEnv, uKind, uRefl, uFloorY;
uniform vec2 uHalf;            // half size of the piece's outer face (arc length, height)

float sdStar5(vec2 p, float r, float rf) {
  const vec2 k1 = vec2(0.809016994375, -0.587785252292);
  const vec2 k2 = vec2(-0.809016994375, -0.587785252292);
  p.x = abs(p.x);
  p -= 2.0 * max(dot(k1, p), 0.0) * k1;
  p -= 2.0 * max(dot(k2, p), 0.0) * k2;
  p.x = abs(p.x);
  p.y -= r;
  vec2 ba = rf * vec2(-k1.y, k1.x) - vec2(0.0, 1.0);
  float h = clamp(dot(p, ba) / dot(ba, ba), 0.0, r);
  return length(p - ba * h) * sign(p.y * ba.x - p.x * ba.y);
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), q = fract(p);
  q = q * q * (3.0 - 2.0 * q);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), q.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), q.x), q.y);
}

void main() {
  int k = int(uKind + 0.5);      // 1 tile, 2 rib, 3 bar, 4 filler, 5 cap, 6 core
  vec3 N = normalize(vN);
  vec3 V = normalize(vec3(0.0, 0.0, uDist) - vP);
  if (dot(N, V) < 0.0) N = -N;
  vec3 toL = uKeyP - vP;
  float dL = length(toL);
  vec3 L1 = toL / dL;                            // the softbox (casts the shadows)
  vec3 L2 = normalize(uFill);                    // weak fill from the right
  vec3 base = uColor;
  float spec = uSpec, shin = uShin;
  float front = step(0.7, vLN.z);                // on the outer face of a piece

  // plastic: fine grain, and softer reflections on the rounded edges
  if (k == 1 || k == 3) {
    float g = vnoise(vL.xy * 260.0) * 0.6 + vnoise(vL.xy * 70.0 + 13.0) * 0.4;
    base *= 1.0 + (g - 0.5) * (k == 1 ? 0.06 : 0.1);
    spec *= 0.8 + 0.4 * g;
  }
  if (k == 1 || k == 2) shin = mix(uShin * 0.3, uShin, smoothstep(0.75, 0.98, vLN.z));

  // ambient occlusion in the crevices
  float ao = 1.0;
  if (k == 1) { if (front < 0.5) ao = mix(0.4, 1.0, smoothstep(0.985, 1.05, vL.z)); }
  else if (k == 2) { if (vLN.z < 0.7) ao = mix(0.45, 1.0, smoothstep(0.97, 1.05, vL.z)); }
  else if (k == 3 || k == 4) {
    if (front > 0.5) {
      float es = uHalf.x - abs(vL.x), ey = uHalf.y - abs(vL.y);
      ao = mix(0.4, 1.0, smoothstep(0.0, 0.055, es)) * mix(0.5, 1.0, smoothstep(0.0, 0.04, ey));
      if (k == 3) ao *= mix(0.45, 1.0, smoothstep(0.0, 0.05, abs(vL.x) - RIBHS));
    } else ao = 0.4;
  }
  else if (k == 5) {
    if (abs(vLN.y) > 0.5 && (abs(vL.y - TOP) < 0.02 || abs(vL.y - BOT) < 0.02))
      ao = mix(0.35, 1.0, smoothstep(1.0, 1.07, vL.z));
  }
  else if (k == 6) {
    float fr = fract((TOP - vL.y) / ROWH);
    ao = mix(0.3, 1.0, smoothstep(0.0, 0.25, fr) * smoothstep(0.0, 0.25, 1.0 - fr));
  }

  // embossed star: a thin groove with a light edge above-left of it
  float groove = 0.0, ridge = 0.0;
  if (uStar > 0.5 && front > 0.5) {
    float sz = uHalf.y * 0.55;
    float d0 = sdStar5(vL.xy, sz, 0.42);
    float d1s = sdStar5(vL.xy + vec2(0.007, -0.007), sz, 0.42);
    groove = 1.0 - smoothstep(0.004, 0.009, abs(d0));
    ridge = (1.0 - smoothstep(0.004, 0.009, abs(d1s))) * (1.0 - groove);
  }

  float ndl = max(dot(N, L1), 0.0);
  float sh = shadowAt(vS, 0.0015 + 0.004 * (1.0 - ndl));
  float d1 = ndl * sh, d2 = max(dot(N, L2), 0.0);
  float hemi = 0.5 + 0.5 * N.y;
  vec3 col = base * (uAmb * (0.35 + 0.65 * hemi) * ao + 0.85 * d1 * (0.4 + 0.6 * ao) + 0.22 * d2 * ao);
  float sp = pow(max(dot(N, normalize(L1 + V)), 0.0), shin) * spec * sh
           + pow(max(dot(N, normalize(L2 + V)), 0.0), shin) * spec * 0.35;
  // studio reflection: brighter above, a soft window up on the left, Fresnel rim
  vec3 R = reflect(-V, N);
  float env = smoothstep(-0.2, 0.9, R.y);
  // reflection of the softbox itself: a highlight as big as the light seen from here
  float cosA = cos(atan(uLR / dL));
  float win = smoothstep(cosA - 0.03, cosA + 0.005, dot(R, L1));
  float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  col += (vec3(sp) + spec * uEnv * (0.06 * env + 0.35 * win * (0.5 + 0.5 * sh) + 0.3 * fres)) * ao;
  // a thread of light along the rounded edges of tiles and ribs
  if (k == 1 || k == 2) {
    float e = smoothstep(0.2, 0.7, vLN.z) * (1.0 - smoothstep(0.7, 0.96, vLN.z));
    col += e * (0.03 + 0.2 * d1) * uEnv * vec3(1.0, 0.98, 0.94);
  }
  col *= 1.0 - 0.45 * groove;
  col += ridge * 0.05 * uEnv;
  col += uGlow * (base * 0.45 + vec3(0.10, 0.10, 0.08));
  if (uHi > 0.5 && front > 0.5) {
    float e = min(uHalf.x - abs(vL.x), uHalf.y - abs(vL.y));
    col = mix(col, vec3(1.0), (1.0 - smoothstep(0.012, 0.022, e)) * 0.9);
  }
  col = pow(max(col, 0.0), vec3(1.0 / 2.2));
  if (uRefl > 0.0) {             // reflection under the floor: fades with the distance from it
    float a = uRefl * (1.0 - smoothstep(0.0, 0.9, uFloorY - vWY));
    gl_FragColor = vec4(col * a, a);
  } else gl_FragColor = vec4(col, 1.0);
}`;

  // Studio backdrop: per pixel, a ray from the camera against a sweep (floor turning into a wall).
  // The hit point is lit by the softbox (cosine / distance^2; a cone in dark mode) and by the sky.
  // Shadows are ray traced against the cylinder (a solid cylinder, radius RC, from the floor to the
  // top of the lid): 64 rays to points spread over the light (umbra and penumbra exactly as that light
  // makes them) and 16 cosine-weighted rays to the sky (ambient occlusion: the dark contact at the base).
  const VS_QUAD = `
attribute vec2 aQ;
void main() { gl_Position = vec4(aQ, 0.0, 1.0); }`;
  const FS_BACK = `
precision highp float;
uniform vec4 uScr;     // cx, cy, f, dpr
uniform vec2 uWH;      // css size of the canvas
uniform vec2 uCS;
uniform float uDist, uFloorY, uLightMode, uEdge;
uniform vec3 uLP; uniform float uLR;   // the light (world)
const float ZW = ${SWEEP_Z.toFixed(3)}, RS = ${SWEEP_R.toFixed(3)};
const float CR = ${RC.toFixed(3)}, CTOP = ${SHADOW_TOP.toFixed(3)};

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
// Does the ray o + t d (0 < t < tmax) hit the solid cylinder? (inside the circle AND inside the height range)
bool hitsCyl(vec3 o, vec3 d, float tmax) {
  float a = d.x * d.x + d.z * d.z, b = 2.0 * (o.x * d.x + o.z * d.z), c = o.x * o.x + o.z * o.z - CR * CR;
  float t0 = -1e9, t1 = 1e9;
  if (a > 1e-8) {
    float disc = b * b - 4.0 * a * c;
    if (disc < 0.0) return false;
    float q = sqrt(disc);
    t0 = (-b - q) / (2.0 * a); t1 = (-b + q) / (2.0 * a);
  } else if (c > 0.0) return false;
  float s0 = -1e9, s1 = 1e9;
  if (abs(d.y) > 1e-8) {
    s0 = (uFloorY - o.y) / d.y; s1 = (CTOP - o.y) / d.y;
    if (s0 > s1) { float tt = s0; s0 = s1; s1 = tt; }
  } else if (o.y < uFloorY || o.y > CTOP) return false;
  return max(max(t0, s0), 1e-3) < min(min(t1, s1), tmax);
}
vec2 concentric(vec2 u) {             // square [-1,1]^2 -> unit disc, uniform by area
  if (u.x == 0.0 && u.y == 0.0) return vec2(0.0);
  float r, ph;
  if (abs(u.x) > abs(u.y)) { r = u.x; ph = 0.785398 * (u.y / u.x); }
  else { r = u.y; ph = 1.570796 - 0.785398 * (u.x / u.y); }
  return r * vec2(cos(ph), sin(ph));
}
// fraction of the light visible from p
float lightVis(vec3 p) {
  vec3 w = normalize(uLP - p);
  {  // quick test: the central ray misses the cylinder enlarged by the light radius -> fully lit
    float a = w.x * w.x + w.z * w.z, b = 2.0 * (p.x * w.x + p.z * w.z), c = p.x * p.x + p.z * p.z - (CR + uLR) * (CR + uLR);
    if (b * b - 4.0 * a * c < 0.0) return 1.0;
  }
  vec3 u = normalize(cross(vec3(0.0, 1.0, 0.0), w)), v = cross(w, u);
  float ang = hash(gl_FragCoord.xy) * 6.2832, ca = cos(ang), sa = sin(ang);
  float vis = 0.0;
  for (int i = 0; i < 8; i++) for (int j = 0; j < 8; j++) {
    vec2 r = (vec2(float(i), float(j)) + vec2(hash(gl_FragCoord.xy + vec2(float(i), 7.0)), hash(gl_FragCoord.yx + vec2(float(j), 3.0)))) / 8.0;
    vec2 dk = concentric(r * 2.0 - 1.0);
    dk = vec2(ca * dk.x - sa * dk.y, sa * dk.x + ca * dk.y);
    vec3 q = uLP + (u * dk.x + v * dk.y) * uLR - p;
    float l = length(q);
    if (!hitsCyl(p, q / l, l)) vis += 1.0;
  }
  return vis / 64.0;
}
// fraction of the sky (cosine weighted) not hidden by the cylinder
float skyVis(vec3 p, vec3 n) {
  float r = length(p.xz);
  if (r > 5.0) return 1.0;
  vec3 t = normalize(cross(abs(n.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0), n)), b = cross(n, t);
  float h1 = hash(gl_FragCoord.xy * 1.7), h2 = hash(gl_FragCoord.yx * 2.3);
  float vis = 0.0;
  for (int i = 0; i < 16; i++) {
    float e1 = (float(i) + h1) / 16.0, e2 = fract(float(i) * 0.618034 + h2);
    float rr = sqrt(e1), ph = 6.2832 * e2;
    vec3 d = t * rr * cos(ph) + b * rr * sin(ph) + n * sqrt(1.0 - e1);
    if (!hitsCyl(p, d, 8.0)) vis += 1.0;
  }
  return mix(vis / 16.0, 1.0, smoothstep(4.0, 5.0, r));
}

void main() {
  vec2 px = vec2(gl_FragCoord.x, uWH.y * uScr.w - gl_FragCoord.y) / uScr.w;
  vec3 dc = vec3((px.x - uScr.x) / uScr.z, -(px.y - uScr.y) / uScr.z, -1.0);
  vec3 o = vec3(0.0, uDist * uCS.y, uDist * uCS.x);
  vec3 d = normalize(vec3(dc.x, dc.y * uCS.x + dc.z * uCS.y, -dc.y * uCS.y + dc.z * uCS.x));
  float zc = ZW + RS, yc = uFloorY + RS;
  float t = 1e9; vec3 n = vec3(0.0, 0.0, 1.0);
  if (d.y < 0.0) {                                   // floor
    float tf = (uFloorY - o.y) / d.y;
    if (o.z + tf * d.z >= zc) { t = tf; n = vec3(0.0, 1.0, 0.0); }
  }
  if (d.z < 0.0) {                                   // wall
    float tw = (ZW - o.z) / d.z;
    if (o.y + tw * d.y >= yc && tw < t) { t = tw; n = vec3(0.0, 0.0, 1.0); }
  }
  {                                                  // curve between them (seen from the inside)
    vec2 oo = vec2(o.z - zc, o.y - yc), dd = vec2(d.z, d.y);
    float a = dot(dd, dd), b = 2.0 * dot(oo, dd), c = dot(oo, oo) - RS * RS, disc = b * b - 4.0 * a * c;
    if (disc > 0.0) {
      float tc = (-b + sqrt(disc)) / (2.0 * a);
      vec3 p = o + tc * d;
      if (tc > 0.0 && p.z <= zc && p.y <= yc && tc < t) { t = tc; n = normalize(vec3(0.0, yc - p.y, zc - p.z)); }
    }
  }
  vec3 p = o + min(t, 40.0) * d;

  bool lm = uLightMode > 0.5;
  vec3 albedo = lm ? vec3(0.87, 0.86, 0.84) : vec3(0.23, 0.26, 0.31);
  vec3 keyCol = lm ? vec3(1.0, 0.975, 0.94) : vec3(1.0, 0.96, 0.9);
  vec3 skyCol = lm ? vec3(0.56, 0.57, 0.59) : vec3(0.11, 0.12, 0.15);
  // softbox: cosine / distance^2, normalised to 1 on the floor at the foot of the cylinder
  vec3 v0 = uLP - vec3(0.0, uFloorY, 0.0);
  float K = dot(v0, v0) / (v0.y / length(v0));
  vec3 lv = uLP - p;
  float E = K * max(dot(n, normalize(lv)), 0.0) / dot(lv, lv);
  if (!lm) E *= smoothstep(0.90, 0.975, dot(normalize(p - uLP), normalize(-v0)));   // stage spot
  float vis = E > 0.001 ? lightVis(p) : 1.0;
  float sky = skyVis(p, n);
  vec3 col = albedo * (keyCol * E * vis * (lm ? 0.5 : 0.92) + skyCol * mix(1.0, sky, 0.75));
  vec2 uv = px / uWH - 0.5;
  col *= 1.0 - (lm ? 0.10 : 0.2) * dot(uv, uv);
  col += (hash(gl_FragCoord.xy + 0.5) - 0.5) / 255.0;   // dithering against banding
  float a = 1.0;
  if (uEdge > 0.5) {                                 // canvas inside the page: blend into it at the borders
    float e = min(min(px.x, uWH.x - px.x), min(px.y, uWH.y - px.y));
    a = smoothstep(0.0, 50.0, e);
  }
  gl_FragColor = vec4(col * a, a);
}`;
  // the glow halo, drawn on a 2D canvas and composited as a texture
  const FS_TEX = `
precision mediump float;
uniform sampler2D uTex; uniform vec2 uRes;
void main() { gl_FragColor = texture2D(uTex, gl_FragCoord.xy / uRes); }`;

  let prog, progS, progB, progT, meshes = {}, quadBuf, sfb, stex, htex;
  let U = {}, US = {}, UB = {}, UT = {};

  function compile(vs, fs, attrs) {
    const sh = (type, src) => {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    attrs.forEach((a, i) => gl.bindAttribLocation(p, i, a));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return p;
  }
  const uniforms = (p, names) => { const o = {}; names.forEach(n => o[n] = gl.getUniformLocation(p, n)); return o; };
  const COMMON_U = ['uCS', 'uProj', 'uDepth', 'uLX', 'uLY', 'uLZ', 'uLS', 'uFloorY'];
  const BEND_U = ['uTheta', 'uRref', 'uY', 'uMirror'];

  // ---------- meshes ----------
  // Samples along an axis lo..hi: denser in the rounded zones at the two ends.
  function samples(lo, hi, rad, nFlat, nR) {
    const a = [];
    for (let k = 0; k <= nR; k++) a.push(lo + rad * k / nR);
    for (let k = 1; k < nFlat; k++) a.push(lo + rad + (hi - lo - 2 * rad) * k / nFlat);
    for (let k = 0; k <= nR; k++) a.push(hi - rad + rad * k / nR);
    return a;
  }
  // Rounded box in unrolled coordinates: s (arc length) x y x d (radius), edge radius rad.
  // Grid on the 6 faces of the box, then each point is pushed onto the rounded surface:
  // q = point clamped to the inner box, normal = direction from q, position = q + normal * rad.
  function roundedBox(s, y, d, rad, n) {
    const ax = [samples(s[0], s[1], rad, n[0], 4), samples(y[0], y[1], rad, n[1], 4), samples(d[0], d[1], rad, n[2], 3)];
    const lo = [s[0], y[0], d[0]], hi = [s[1], y[1], d[1]];
    const pos = [], nrm = [], idx = [];
    const face = (fixed, val, u, v) => {
      const base = pos.length / 3, Ua = ax[u], Va = ax[v];
      for (let j = 0; j < Va.length; j++) for (let i = 0; i < Ua.length; i++) {
        const p = [0, 0, 0]; p[fixed] = val; p[u] = Ua[i]; p[v] = Va[j];
        const q = p.map((x, k) => Math.min(hi[k] - rad, Math.max(lo[k] + rad, x)));
        let dx = p[0] - q[0], dy = p[1] - q[1], dz = p[2] - q[2];
        const l = Math.hypot(dx, dy, dz) || 1;
        dx /= l; dy /= l; dz /= l;
        pos.push(q[0] + dx * rad, q[1] + dy * rad, q[2] + dz * rad);
        nrm.push(dx, dy, dz);
      }
      for (let j = 0; j < Va.length - 1; j++) for (let i = 0; i < Ua.length - 1; i++) {
        const a = base + j * Ua.length + i, b = a + 1, c = a + Ua.length, e = c + 1;
        idx.push(a, b, e, a, e, c);
      }
    };
    face(2, hi[2], 0, 1); face(2, lo[2], 0, 1);
    face(0, lo[0], 1, 2); face(0, hi[0], 1, 2);
    face(1, lo[1], 0, 2); face(1, hi[1], 0, 2);
    return { pos, nrm, idx };
  }
  // Solid of revolution from a profile of [r, y, nr, ny] points (normals in the profile plane).
  function lathe(profile, seg = 96) {
    const pos = [], nrm = [], idx = [];
    for (let i = 0; i <= seg; i++) {
      const phi = (i / seg) * Math.PI * 2;
      for (const [r, y, nr, ny] of profile) { pos.push(phi, y, r); nrm.push(0, ny, nr); }
    }
    const n = profile.length;
    for (let i = 0; i < seg; i++) for (let k = 0; k < n - 1; k++) {
      const a = i * n + k, b = a + 1, c = a + n, e = c + 1;
      idx.push(a, b, e, a, e, c);
    }
    return { pos, nrm, idx };
  }
  // Quarter arc of a rounded edge: centre (r0, y0), radius rr, from angle a0 to a1 (degrees).
  function arc(r0, y0, rr, a0, a1, n = 6) {
    const out = [];
    for (let k = 0; k <= n; k++) {
      const a = (a0 + (a1 - a0) * k / n) * RAD;
      out.push([r0 + rr * Math.cos(a), y0 + rr * Math.sin(a), Math.cos(a), Math.sin(a)]);
    }
    return out;
  }
  function upload(m) {
    const o = { n: m.idx.length };
    o.pos = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, o.pos); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(m.pos), gl.STATIC_DRAW);
    o.nrm = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, o.nrm); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(m.nrm), gl.STATIC_DRAW);
    o.idx = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, o.idx);
    const big = m.pos.length / 3 > 65535;
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, big ? new Uint32Array(m.idx) : new Uint16Array(m.idx), gl.STATIC_DRAW);
    o.type = big ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
    return o;
  }

  const TILE_REF = (0.985 + RT) / 2;
  const TILE_HS = HALF * RAD * TILE_REF, TILE_HY = ROWH / 2 - M;
  const HY = ROWH / 2 - GM, BAR_HS = (30 - HALF) * RAD * RB, FILL_HS = HALF * RAD * RB;
  function buildMeshes() {
    meshes.tile = upload(roundedBox([-TILE_HS, TILE_HS], [-TILE_HY, TILE_HY], [0.985, RT], 0.022, [14, 8, 1]));
    meshes.rib = upload(roundedBox([-RIB * RAD * 1.03, RIB * RAD * 1.03], [-HY, HY], [0.97, RT], 0.012, [2, 8, 1]));
    meshes.bar = upload(roundedBox([-BAR_HS, BAR_HS], [-HY, HY], [RH, RB], 0.003, [4, 4, 1]));
    meshes.filler = upload(roundedBox([-FILL_HS, FILL_HS], [-HY, HY], [RH, RB], 0.003, [6, 4, 1]));
    // inner core, seen through the empty slot and the grooves
    meshes.core = upload(lathe([[RH * 0.99, BOT, 1, 0], [RH * 0.99, (BOT + TOP) / 2, 1, 0], [RH * 0.99, TOP, 1, 0]]));
    // top cap: underside, small rounded lower edge, side, rounded upper edge, lid with a raised ring
    const yT = TOP + CAP_T, r1 = 0.012, r2 = 0.045;
    meshes.top = upload(lathe([
      [0.95, TOP, 0, -1], [RC - r1, TOP, 0, -1],
      ...arc(RC - r1, TOP + r1, r1, -90, 0, 3),
      [RC, yT - r2, 1, 0],
      ...arc(RC - r2, yT - r2, r2, 0, 90, 8),
      [0.82, yT, 0, 1], [0.80, yT - 0.004, -0.5, 0.86], [0.78, yT - 0.004, 0, 1], [0.76, yT, 0.5, 0.86], [0.75, yT, 0, 1], [0, yT, 0, 1],
    ]));
    // bottom cap: bottom, rounded lower edge, side, rounded upper edge, ledge around the body
    const yB = BOT - CAP_B;
    meshes.bottom = upload(lathe([
      [0, yB, 0, -1], [RC - r1, yB, 0, -1],
      ...arc(RC - r1, yB + r1, r1, -90, 0, 3),
      [RC, BOT - r2, 1, 0],
      ...arc(RC - r2, BOT - r2, r2, 0, 90, 8),
      [0.95, BOT, 0, 1],
    ]));
    quadBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);
  }

  function buildTargets() {
    // shadow map: RGBA texture holding the packed depth + a depth renderbuffer
    stex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, stex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, SM, SM, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER].forEach(p => gl.texParameteri(gl.TEXTURE_2D, p, gl.NEAREST));
    [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T].forEach(p => gl.texParameteri(gl.TEXTURE_2D, p, gl.CLAMP_TO_EDGE));
    const rb = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, SM, SM);
    sfb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, sfb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, stex, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('shadow framebuffer');
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    // halo texture (filled from the 2D canvas when the glow is on)
    htex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, htex);
    [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER].forEach(p => gl.texParameteri(gl.TEXTURE_2D, p, gl.LINEAR));
    [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T].forEach(p => gl.texParameteri(gl.TEXTURE_2D, p, gl.CLAMP_TO_EDGE));
  }

  // ---------- setup ----------
  // frame: the element whose area the cylinder is fitted and centred in (the canvas may be larger,
  // e.g. the whole window, so the cylinder is never cut off at the edges).
  function init(canvas, frameEl) {
    cv = canvas; frame = frameEl || canvas;
    try {
      gl = cv.getContext('webgl', { antialias: true, alpha: true, premultipliedAlpha: true });
      if (gl) {
        gl.getExtension('OES_element_index_uint');
        prog = compile(VS, FS, ['aPos', 'aNrm']);
        progS = compile(VS_SHADOW, FS_SHADOW, ['aPos', 'aNrm']);
        progB = compile(VS_QUAD, FS_BACK, ['aQ']);
        progT = compile(VS_QUAD, FS_TEX, ['aQ']);
        U = uniforms(prog, [...COMMON_U, ...BEND_U, 'uColor', 'uKeyP', 'uFill', 'uLR', 'uSpec', 'uShin', 'uGlow', 'uStar', 'uHi', 'uDist', 'uAmb',
          'uEnv', 'uKind', 'uRefl', 'uHalf', 'uShadow', 'uTexel', 'uShadowOn']);
        US = uniforms(progS, [...COMMON_U, ...BEND_U]);
        UB = uniforms(progB, ['uScr', 'uWH', 'uCS', 'uDist', 'uFloorY', 'uLightMode', 'uEdge', 'uLP', 'uLR']);
        UT = uniforms(progT, ['uTex', 'uRes']);
        buildMeshes();
        buildTargets();
      }
    } catch (e) { console.error(e); gl = null; }
    if (!gl) {   // no WebGL: the canvas 2D renderer takes over
      fallback = VIEW2D;
      VIEW2D.init(canvas, frameEl);
      Object.assign(G, VIEW2D.G);
      return;
    }
    under = document.getElementById('under'); over = document.getElementById('over');
    uctx = under.getContext('2d'); octx = over.getContext('2d');
    resize();
  }

  function resize() {
    if (fallback) { fallback.resize(); Object.assign(G, fallback.G); return; }
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = cv.getBoundingClientRect();
    W = Math.max(1, r.width); H = Math.max(1, r.height);
    for (const c of [cv, under, over]) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    gl.viewport(0, 0, cv.width, cv.height);
    // the backdrop fades out at the borders when the canvas is only a part of the page (narrow screens)
    edgeFade = getComputedStyle(cv).position === 'fixed' ? 0 : 1;
    // fitting area in canvas coordinates (minus the view bar under it, when shown)
    const fr = frame.getBoundingClientRect(), bar = document.querySelector('.viewbar');
    const barH = bar && bar.offsetParent !== null ? 48 : 0;
    const fw = Math.max(1, fr.width), fh = Math.max(1, fr.height - barH);
    f = Math.min(fw / 2.75, fh / 3.75) * DIST;
    cx = fr.left - r.left + fw / 2;
    cy = fr.top - r.top + fh / 2 - fh * 0.065;   // a little above the middle
    G.R = f / DIST; G.cx = cx; G.cy = cy;
  }

  // ---------- projection in JS (same as the shaders) ----------
  function cam(x, y, z) { return [x, y * cp - z * sp, y * sp + z * cp]; }
  function scr(c) { const d = DIST - c[2]; return [cx + f * c[0] / d, cy - f * c[1] / d]; }
  const pol = (a, y, r) => cam(r * Math.sin(a * RAD), y, r * Math.cos(a * RAD));
  const wrap = a => ((a + 180) % 360 + 360) % 360 - 180;
  const lin = hex => [1, 3, 5].map(i => Math.pow(parseInt(hex.substr(i, 2), 16) / 255, 2.2));
  const norm = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const BODY = lin('#121214'), CAPC = lin('#1b1b1f'), RIBC = lin('#202025'), CORE = lin('#0a0a0b');

  // ---------- drawing ----------
  let key = [0, 1, 0], LX = [1, 0, 0], LY = [0, 1, 0], keyCam = [0, 1, 0], keyMirror = [0, -1, 0], fillCam = [1, 0, 0];
  function setCommon(u, mirror) {
    gl.uniform2f(u.uCS, cp, sp);
    gl.uniform4f(u.uProj, 2 * cx / W - 1, 1 - 2 * cy / H, 2 * f / W, 2 * f / H);
    gl.uniform3f(u.uDepth, DIST, (FAR + NEAR) / (FAR - NEAR), -2 * FAR * NEAR / (FAR - NEAR));
    gl.uniform3fv(u.uLX, LX); gl.uniform3fv(u.uLY, LY); gl.uniform3fv(u.uLZ, key);
    gl.uniform1f(u.uLS, LS); gl.uniform1f(u.uFloorY, FLOOR);
    if (u.uMirror) gl.uniform1f(u.uMirror, mirror ? 1 : 0);
  }
  function bindShadow(u, on) {
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, stex);
    gl.uniform1i(u.uShadow, 0); gl.uniform1f(u.uTexel, 1 / SM); gl.uniform1f(u.uShadowOn, on ? 1 : 0);
  }
  // Everything to draw this frame: { m: mesh, th, rr, y, col, spec, shin, kind, half, star, hi, glow }
  function scene(s) {
    const L = [
      { m: meshes.core, th: 0, rr: 1, y: 0, col: CORE, spec: 0.1, shin: 20, kind: 6 },
      { m: meshes.bottom, th: 0, rr: 1, y: 0, col: CAPC, spec: 0.55, shin: 50, kind: 5 },
      { m: meshes.top, th: 0, rr: 1, y: 0, col: CAPC, spec: 0.55, shin: 50, kind: 5 },
    ];
    const rowTop = k => TOP - k * ROWH;
    const isHole = (r, c) => s.grid[r][c] === PUZZLE.GAP || (s.slide && s.slide.c === c && (s.slide.r === r || s.slide.to === r));
    for (let r = 0; r < 3; r++) {
      const yc = rowTop(r) - ROWH / 2;
      for (let c = 0; c < 6; c++) {
        const a = wrap(c * 60 + s.ring[r] - s.view), th = a * RAD, thb = (a + 30) * RAD;
        L.push({ m: meshes.bar, th: thb, rr: RB, y: yc, col: BODY, spec: 0.28, shin: 25, kind: 3, half: [BAR_HS, HY] });
        L.push({ m: meshes.rib, th: thb, rr: 1.03, y: yc, col: RIBC, spec: 0.7, shin: 80, kind: 2 });
        if (isHole(r, c)) continue;
        L.push({ m: meshes.filler, th, rr: RB, y: yc, col: BODY, spec: 0.28, shin: 25, kind: 4, half: [FILL_HS, HY] });
        L.push({ m: meshes.tile, th, rr: TILE_REF, y: yc, col: lin(PUZZLE.COLOURS[s.grid[r][c]].hex), spec: 0.45, shin: 45,
          kind: 1, half: [TILE_HS, TILE_HY], star: true, glow, hi: s.hover && s.hover.r === r && s.hover.c === c });
      }
    }
    if (s.slide) {
      const sl = s.slide, yy = rowTop(sl.r) + (rowTop(sl.to) - rowTop(sl.r)) * sl.p - ROWH / 2;
      L.push({ m: meshes.tile, th: wrap(sl.c * 60 + s.ring[sl.r] - s.view) * RAD, rr: TILE_REF, y: yy,
        col: lin(PUZZLE.COLOURS[s.grid[sl.r][sl.c]].hex), spec: 0.45, shin: 45, kind: 1, half: [TILE_HS, TILE_HY], star: true });
    }
    return L;
  }
  function drawList(L, u, full) {
    for (const it of L) {
      gl.uniform1f(u.uTheta, it.th); gl.uniform1f(u.uRref, it.rr); gl.uniform1f(u.uY, it.y);
      if (full) {
        gl.uniform3fv(u.uColor, it.col); gl.uniform1f(u.uSpec, it.spec); gl.uniform1f(u.uShin, it.shin);
        gl.uniform1f(u.uKind, it.kind); gl.uniform2fv(u.uHalf, it.half || [1, 1]);
        gl.uniform1f(u.uGlow, it.glow || 0); gl.uniform1f(u.uStar, it.star ? 1 : 0); gl.uniform1f(u.uHi, it.hi ? 1 : 0);
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, it.m.pos); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, it.m.nrm); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, it.m.idx);
      gl.drawElements(gl.TRIANGLES, it.m.n, it.m.type, 0);
    }
  }
  function quad(attrBuf) {
    gl.bindBuffer(gl.ARRAY_BUFFER, attrBuf);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  // s = { grid, view, pitch, ring: [3 offsets], slide: {c, r, to, p} | null, hover: {r, c} | null, glow }
  function draw(s) {
    if (fallback) return fallback.draw(s);
    const pitch = (s.pitch === undefined ? 24 : s.pitch) * RAD;
    cp = Math.cos(pitch); sp = Math.sin(pitch);
    light = document.documentElement.classList.contains('light');
    glow = s.glow || 0;
    // the light in camera space; the shadow map looks from it towards the cylinder
    keyCam = cam(...LIGHT_P);
    keyMirror = cam(LIGHT_P[0], 2 * FLOOR - LIGHT_P[1], LIGHT_P[2]);   // for the reflection
    fillCam = cam(...FILL_D);
    key = norm(keyCam);
    LX = norm(cross([0, 1, 0], key)); LY = cross(key, LX);
    const L = scene(s);
    gl.enableVertexAttribArray(0);

    // 1. shadow map
    gl.bindFramebuffer(gl.FRAMEBUFFER, sfb);
    gl.viewport(0, 0, SM, SM);
    gl.clearColor(1, 1, 1, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.BLEND); gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.depthFunc(gl.LESS);
    gl.useProgram(progS); setCommon(US, false);
    gl.enableVertexAttribArray(1);
    drawList(L, US, false);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, cv.width, cv.height);

    // 2. backdrop
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.disableVertexAttribArray(1);
    gl.useProgram(progB);
    gl.uniform4f(UB.uScr, cx, cy, f, dpr); gl.uniform2f(UB.uWH, W, H); gl.uniform2f(UB.uCS, cp, sp);
    gl.uniform1f(UB.uDist, DIST); gl.uniform1f(UB.uFloorY, FLOOR);
    gl.uniform1f(UB.uLightMode, light ? 1 : 0); gl.uniform1f(UB.uEdge, edgeFade);
    gl.uniform3fv(UB.uLP, LIGHT_P); gl.uniform1f(UB.uLR, LIGHT_R);
    quad(quadBuf);

    // 3. glow halo
    if (glow > 0) {
      uctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      uctx.clearRect(0, 0, W, H);
      halo();
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, htex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, under);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.useProgram(progT);
      gl.uniform1i(UT.uTex, 0); gl.uniform2f(UT.uRes, cv.width, cv.height);
      quad(quadBuf);
    }

    // 4. reflection: depth only first, then colour on the nearest surfaces only (no double blending)
    gl.useProgram(prog);
    setCommon(U, true);
    bindShadow(U, false);
    gl.uniform3fv(U.uKeyP, keyMirror); gl.uniform3fv(U.uFill, [fillCam[0], -fillCam[1], fillCam[2]]);
    gl.uniform1f(U.uLR, LIGHT_R); gl.uniform1f(U.uDist, DIST);
    gl.uniform1f(U.uAmb, light ? 0.55 : 0.38); gl.uniform1f(U.uEnv, light ? 1.0 : 0.65);
    gl.enableVertexAttribArray(1);
    gl.enable(gl.DEPTH_TEST);
    gl.colorMask(false, false, false, false);
    gl.uniform1f(U.uRefl, 0);
    drawList(L, U, true);
    gl.colorMask(true, true, true, true);
    gl.depthFunc(gl.LEQUAL);
    gl.uniform1f(U.uRefl, light ? 0.3 : 0.2);
    drawList(L, U, true);
    gl.depthFunc(gl.LESS);
    gl.clear(gl.DEPTH_BUFFER_BIT);

    // 6. the cylinder
    gl.enable(gl.DEPTH_TEST);
    gl.useProgram(prog);
    setCommon(U, false);
    bindShadow(U, true);
    gl.uniform1f(U.uRefl, 0);
    gl.uniform3fv(U.uKeyP, keyCam); gl.uniform3fv(U.uFill, fillCam);
    gl.enableVertexAttribArray(1);
    drawList(L, U, true);
    gl.disableVertexAttribArray(1);

    // 2D layer over the cylinder: confetti
    octx.setTransform(dpr, 0, 0, dpr, 0, 0);
    octx.clearRect(0, 0, W, H);
    drawConfetti();
  }

  // ---------- glow halo ----------
  // Outline of the cylinder (hull of the two caps) stroked many times, wider and fainter each time.
  function halo() {
    const pts = [];
    for (let i = 0; i < 48; i++) {
      const a = 360 * i / 48;
      pts.push(scr(pol(a, TOP + CAP_T, RC)), scr(pol(a, BOT - CAP_B, RC)));
    }
    const h = hull(pts), n = 24, maxW = G.R * (0.035 + 0.045 * glow);
    const c = uctx;
    c.save();
    c.beginPath(); h.forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); c.closePath();
    c.lineJoin = 'round';
    c.strokeStyle = light ? `rgba(255, 253, 238, ${0.07 + 0.09 * glow})` : `rgba(255, 250, 215, ${0.02 + 0.04 * glow})`;
    for (let i = 0; i < n; i++) { c.lineWidth = maxW * (1 - i / n) * 2; c.stroke(); }
    c.restore();
  }
  function hull(p) {
    p = p.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], up = [];
    for (const q of p) { while (lo.length > 1 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
    for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length > 1 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
    return lo.slice(0, -1).concat(up.slice(0, -1));
  }

  // ---------- picking: cast a ray from the screen point into the world ----------
  function ray(x, y) {
    const d = [(x - cx) / f, -(y - cy) / f, -1], o = [0, 0, DIST];
    const un = v => [v[0], v[1] * cp + v[2] * sp, -v[1] * sp + v[2] * cp];   // camera space -> world
    return { o: un(o), d: un(d) };
  }
  function hitCyl(x, y, R) {
    const { o, d } = ray(x, y);
    const A2 = d[0] * d[0] + d[2] * d[2], B = 2 * (o[0] * d[0] + o[2] * d[2]), C = o[0] * o[0] + o[2] * o[2] - R * R;
    const disc = B * B - 4 * A2 * C;
    if (disc < 0) return null;
    const t = (-B - Math.sqrt(disc)) / (2 * A2);
    const p = [o[0] + t * d[0], o[1] + t * d[1], o[2] + t * d[2]];
    return { y: p[1], a: Math.atan2(p[0], p[2]) / RAD, o, d };
  }
  // Screen point -> { r, c } of the cell under it (c = puzzle column), or null.
  function hit(x, y, s) {
    if (fallback) return fallback.hit(x, y, s);
    const h = hitCyl(x, y, RT);
    if (!h || h.y > TOP || h.y < BOT) return null;
    const r = Math.floor((TOP - h.y) / ROWH);
    if (r < 0 || r > 2) return null;
    const c = PUZZLE.mod(Math.round((h.a + s.view - s.ring[r]) / 60));
    return { r, c, a: h.a };
  }
  // Is the point on the cylinder at all (body, caps, lid)?
  function onBody(x, y) {
    if (fallback) return fallback.onBody(x, y);
    const h = hitCyl(x, y, RC);
    if (h && h.y < TOP + CAP_T && h.y > BOT - CAP_B) return true;
    if (!h) return false;
    const t = (TOP + CAP_T - h.o[1]) / h.d[1], px = h.o[0] + t * h.d[0], pz = h.o[2] + t * h.d[2];
    return t > 0 && px * px + pz * pz < RC * RC;
  }

  // ---------- confetti stars for the win (2D, over the WebGL canvas) ----------
  function burst() {
    if (fallback) return fallback.burst();
    const top = scr(pol(0, TOP + CAP_T, 0));
    for (let i = 0; i < 140; i++) {
      confetti.push({
        x: top[0] + (Math.random() - 0.5) * G.R, y: top[1],
        vx: (Math.random() - 0.5) * 9, vy: -4 - Math.random() * 9,
        rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3,
        s: 4 + Math.random() * 6, col: PUZZLE.COLOURS[i % 6].hex,
      });
    }
  }
  function drawConfetti() {
    const c = octx;
    for (let i = confetti.length - 1; i >= 0; i--) {
      const p = confetti[i];
      p.vy += 0.22; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.rot += p.vr;
      if (p.y > H + 20) { confetti.splice(i, 1); continue; }
      c.save(); c.translate(p.x, p.y); c.rotate(p.rot); c.scale(1, Math.cos(p.rot * 2));
      c.beginPath();
      for (let k = 0; k < 10; k++) {
        const t = -Math.PI / 2 + k * Math.PI / 5, rr = k % 2 ? p.s * 0.45 : p.s;
        k ? c.lineTo(rr * Math.cos(t), rr * Math.sin(t)) : c.moveTo(rr * Math.cos(t), rr * Math.sin(t));
      }
      c.fillStyle = p.col; c.fill();
      c.restore();
    }
  }

  return { init, resize, draw, hit, onBody, burst, G, get webgl() { return !!gl; } };
})();
