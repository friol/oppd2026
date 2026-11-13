// GLSL sources for Mandelbülben (WebGL2 / GLSL ES 3.00).
// The scene shader is compiled once per fractal type (FRACTAL define).

const SHADERS = (() => {
  'use strict';

  // Fullscreen triangle, no vertex buffer needed
  const VERT = `#version 300 es
const vec2 P[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
out vec2 vUv;
void main() {
  vec2 p = P[gl_VertexID];
  vUv = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}`;

  // ---------------------------------------------------------------------------
  // Distance estimators. Each writes an orbit trap into gTrap.
  // ---------------------------------------------------------------------------
  const DE = `
#if FRACTAL == 0 || FRACTAL == 1
// Mandelbulb (0) and its Julia variant (1)
float map(vec3 p) {
  vec3 w = p;
#if FRACTAL == 1
  vec3 c = uJulia.xyz;
#else
  vec3 c = p;
#endif
  float P = uParamA;
  float m = dot(w, w);
  float dz = 1.0;
  gTrap = vec4(abs(w), m);
  for (int i = 0; i < 64; i++) {
    if (i >= uIter) break;
    float r = sqrt(m);
#if FRACTAL == 1
    dz = P * pow(r, P - 1.0) * dz;
#else
    dz = P * pow(r, P - 1.0) * dz + 1.0;
#endif
    float th = acos(clamp(w.y / max(r, 1e-12), -1.0, 1.0)) * P;
    float ph = atan(w.x, w.z) * P;
    w = c + pow(r, P) * vec3(sin(th) * sin(ph), cos(th), sin(th) * cos(ph));
    m = dot(w, w);
    gTrap = min(gTrap, vec4(abs(w), m));
    if (m > 256.0) break;
  }
  return 0.25 * log(m) * sqrt(m) / dz;
}

#elif FRACTAL == 2
// Mandelbox
float map(vec3 p) {
  float S = uParamA;
  float mr2 = uParamB * uParamB;
  vec4 z = vec4(p, 1.0);
  gTrap = vec4(1e9);
  for (int i = 0; i < 64; i++) {
    if (i >= uIter) break;
    z.xyz = clamp(z.xyz, -1.0, 1.0) * 2.0 - z.xyz;
    float r2 = dot(z.xyz, z.xyz);
    gTrap = min(gTrap, vec4(abs(z.xyz), r2));
    z *= clamp(1.0 / r2, 1.0, 1.0 / mr2);
    z = z * vec4(vec3(S), abs(S)) + vec4(p, 1.0);
  }
  return (length(z.xyz) - abs(S - 1.0)) / z.w - pow(abs(S), float(1 - uIter));
}

#elif FRACTAL == 3
// Quaternion Julia set, 3D slice at w = uParamA
float map(vec3 p) {
  vec4 z = vec4(p, uParamA);
  float md2 = 1.0;
  float mz2 = dot(z, z);
  gTrap = vec4(abs(z.xyz), mz2);
  for (int i = 0; i < 64; i++) {
    if (i >= uIter) break;
    md2 *= 4.0 * mz2;
    z = vec4(z.x * z.x - dot(z.yzw, z.yzw), 2.0 * z.x * z.yzw) + uJulia;
    mz2 = dot(z, z);
    gTrap = min(gTrap, vec4(abs(z.xyz), mz2));
    if (mz2 > 16.0) break;
  }
  return 0.25 * sqrt(mz2 / md2) * log(mz2);
}

#elif FRACTAL == 4
// Menger sponge as a folding IFS, with twist (uRot) and scale (uParamB)
float map(vec3 p) {
  float S = uParamB;
  vec3 z = p;
  float sc = 1.0;
  gTrap = vec4(1e9);
  for (int i = 0; i < 64; i++) {
    if (i >= uIter) break;
    z = abs(z);
    if (z.x < z.y) z.xy = z.yx;
    if (z.x < z.z) z.xz = z.zx;
    if (z.y < z.z) z.yz = z.zy;
    z = uRot * z;
    z = z * S - vec3(S - 1.0);
    if (z.z < -0.5 * (S - 1.0)) z.z += S - 1.0;
    sc *= S;
    gTrap = min(gTrap, vec4(abs(z), dot(z, z)));
  }
  vec3 q = abs(z) - vec3(1.0);
  return (length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0)) / sc;
}

#elif FRACTAL == 5
// Sierpinski tetrahedron, with twist (uRot) and scale (uParamB)
float map(vec3 p) {
  float S = uParamB;
  vec3 z = p;
  float sc = 1.0;
  gTrap = vec4(1e9);
  for (int i = 0; i < 64; i++) {
    if (i >= uIter) break;
    if (z.x + z.y < 0.0) z.xy = -z.yx;
    if (z.x + z.z < 0.0) z.xz = -z.zx;
    if (z.y + z.z < 0.0) z.zy = -z.yz;
    z = uRot * z;
    z = z * S - vec3(S - 1.0);
    sc *= S;
    gTrap = min(gTrap, vec4(abs(z), dot(z, z)));
  }
  float d = max(max(-z.x - z.y - z.z, z.x + z.y - z.z), max(-z.x + z.y + z.z, z.x - z.y + z.z));
  return (d - 1.0) * 0.57735 / sc;
}

#elif FRACTAL == 6
// Kaleidoscopic IFS with octahedral folds, scale (uParamA) and twist (uRot)
float map(vec3 p) {
  float S = uParamA;
  vec3 off = vec3(1.0, 0.55, 0.25);
  vec3 z = p;
  float sc = 1.0;
  gTrap = vec4(1e9);
  for (int i = 0; i < 64; i++) {
    if (i >= uIter) break;
    z = abs(z);
    if (z.x < z.y) z.xy = z.yx;
    if (z.x < z.z) z.xz = z.zx;
    if (z.y < z.z) z.yz = z.zy;
    z = uRot * z;
    z = z * S - off * (S - 1.0);
    sc *= S;
    gTrap = min(gTrap, vec4(abs(z), dot(z, z)));
  }
  vec3 a = abs(z);
  return (a.x + a.y + a.z - 1.0) * 0.57735 / sc;
}

#elif FRACTAL == 7
// Apollonian gasket (sphere inversions), cut by a sphere of radius uParamB
float map(vec3 p) {
  float s = 1.0;
  vec3 z = p;
  gTrap = vec4(1e9);
  for (int i = 0; i < 64; i++) {
    if (i >= uIter) break;
    z = -1.0 + 2.0 * fract(0.5 * z + 0.5);
    float r2 = dot(z, z);
    gTrap = min(gTrap, vec4(abs(z), r2));
    float k = uParamA / r2;
    z *= k;
    s *= k;
  }
  return max(0.25 * abs(z.y) / s, length(p) - uParamB);
}

#elif FRACTAL == 8 || FRACTAL == 10
// Mandelbulb variants: cosine / latitude form (8), Mandelbar 3D (10)
float map(vec3 p) {
  vec3 w = p;
  float P = uParamA;
  float m = dot(w, w);
  float dz = 1.0;
  gTrap = vec4(abs(w), m);
  for (int i = 0; i < 64; i++) {
    if (i >= uIter) break;
    float r = sqrt(m);
    dz = P * pow(r, P - 1.0) * dz + 1.0;
    float rp = pow(r, P);
#if FRACTAL == 8
    float th = atan(w.y, w.x) * P;
    float ph = asin(clamp(w.z / max(r, 1e-12), -1.0, 1.0)) * P;
    w = p + rp * vec3(cos(th) * cos(ph), sin(th) * cos(ph), -sin(ph));
#else
    float th = acos(clamp(w.y / max(r, 1e-12), -1.0, 1.0)) * P;
    float ph = atan(w.x, w.z) * P;
#if FRACTAL == 10
    ph = -ph;
#endif
    w = p + rp * vec3(sin(th) * sin(ph), cos(th), sin(th) * cos(ph));
#endif
    m = dot(w, w);
    gTrap = min(gTrap, vec4(abs(w), m));
    if (m > 256.0) break;
  }
  return 0.25 * log(m) * sqrt(m) / dz;
}

#elif FRACTAL == 11
// Bristorbrot: polynomial triplex square
float map(vec3 p) {
  vec3 w = p;
  float dr = 1.0;
  float r = length(w);
  gTrap = vec4(abs(w), r * r);
  for (int i = 0; i < 64; i++) {
    if (i >= uIter) break;
    dr = 2.0 * r * dr + 1.0;
    w = vec3(w.x * w.x - w.y * w.y - w.z * w.z, w.y * (2.0 * w.x - w.z), w.z * (2.0 * w.x + w.y)) + p;
    r = length(w);
    gTrap = min(gTrap, vec4(abs(w), r * r));
    if (r > 16.0) break;
  }
  return 0.5 * log(r) * r / dr;
}

#elif FRACTAL == 12
// Mandeltorus: power map in toroidal coordinates around a ring of radius uParamB
float map(vec3 p) {
  float P = uParamA, R0 = uParamB;
  vec3 w = p;
  float dr = 1.0;
  float ru = length(vec2(length(w.xz) - R0, w.y));
  gTrap = vec4(abs(w), ru * ru);
  for (int i = 0; i < 64; i++) {
    if (i >= uIter) break;
    float th = atan(w.z, w.x) * P;
    vec2 u = vec2(length(w.xz) - R0, w.y);
    ru = length(u);
    float a = atan(u.y, u.x) * P;
    float rp = pow(ru, P);
    dr = P * pow(ru, P - 1.0) * dr + 1.0;
    float rho = R0 + rp * cos(a);
    w = vec3(rho * cos(th), rp * sin(a), rho * sin(th)) + p;
    ru = length(vec2(length(w.xz) - R0, w.y));
    gTrap = min(gTrap, vec4(abs(w), ru * ru));
    if (ru > 16.0) break;
  }
  return 0.5 * log(ru) * ru / dr;
}

#elif FRACTAL == 14 || FRACTAL == 15
// Bicomplex numbers split into two independent complex iterations (idempotent basis):
// Tetrabrot (14) and bicomplex Julia (15); 3D slice at fourth coordinate uParamA
vec2 cmul(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
float complexDE(vec2 z, vec2 c, float mandel) {
  vec2 dz = vec2(1.0, 0.0);
  float m = dot(z, z);
  for (int i = 0; i < 128; i++) {
    if (i >= uIter) break;
    dz = 2.0 * cmul(z, dz) + vec2(mandel, 0.0);
    z = cmul(z, z) + c;
    m = dot(z, z);
    gTrap = min(gTrap, vec4(abs(z), abs(z.x * z.y), m));
    if (m > 1e4) break;
  }
  return 0.25 * sqrt(m / max(dot(dz, dz), 1e-30)) * log(m);
}
float map(vec3 p) {
  float w = uParamA;
  gTrap = vec4(1e9);
#if FRACTAL == 14
  vec2 a = vec2(p.x - 0.4 + w, p.y - p.z), b = vec2(p.x - 0.4 - w, p.y + p.z);
  float da = complexDE(a, a, 1.0), db = complexDE(b, b, 1.0);
#else
  vec2 a = vec2(p.x + w, p.y - p.z), b = vec2(p.x - w, p.y + p.z);
  float da = complexDE(a, uJulia.xy, 0.0), db = complexDE(b, uJulia.zw, 0.0);
#endif
  return max(da, db) * 0.7071;
}

#elif FRACTAL == 18
// Twisted Mandelbox: full box fold followed by a rotation
float map(vec3 p) {
  float S = uParamA;
  vec4 z = vec4(p, 1.0);
  gTrap = vec4(1e9);
  for (int i = 0; i < 64; i++) {
    if (i >= uIter) break;
    z.xyz = clamp(z.xyz, -1.0, 1.0) * 2.0 - z.xyz;
    z.xyz = uRot * z.xyz;
    float r2 = dot(z.xyz, z.xyz);
    gTrap = min(gTrap, vec4(abs(z.xyz), r2));
    z *= clamp(1.0 / r2, 1.0, 4.0);
    z = z * vec4(vec3(S), abs(S)) + vec4(p, 1.0);
  }
  return (length(z.xyz) - abs(S - 1.0)) / z.w - pow(abs(S), float(1 - uIter));
}

#elif FRACTAL == 19 || FRACTAL == 20
// Polyhedral kaleidoscopic IFS (Knighty's fold for the icosahedral group):
// offset toward an icosahedron vertex (19) or a dodecahedron vertex (20)
const vec3 NC = vec3(-0.5, -0.809017, 0.309017);  // (-1/2, -cos(pi/5), sqrt(3/4 - cos²(pi/5)))
vec3 icoFold(vec3 z) {
  for (int k = 0; k < 5; k++) {
    z.xy = abs(z.xy);
    z -= 2.0 * min(0.0, dot(z, NC)) * NC;
  }
  return z;
}
float map(vec3 p) {
  float S = uParamA;
#if FRACTAL == 19
  const vec3 off = vec3(0.0, 0.0, 1.0);
#else
  const vec3 off = vec3(0.0, 0.356822, 0.934172);
#endif
  vec3 z = p;
  float sc = 1.0;
  gTrap = vec4(1e9);
  for (int i = 0; i < 64; i++) {
    if (i >= uIter) break;
    z = icoFold(z);
    z = uRot * z;
    z = z * S - off * (S - 1.0);
    sc *= S;
    gTrap = min(gTrap, vec4(abs(z), dot(z, z)));
  }
  return (length(z) - 1.0) / sc;
}

#elif FRACTAL == 21
// Octahedron flake
float map(vec3 p) {
  float S = uParamB;
  vec3 z = p;
  float sc = 1.0;
  gTrap = vec4(1e9);
  for (int i = 0; i < 64; i++) {
    if (i >= uIter) break;
    z = abs(z);
    if (z.x < z.y) z.xy = z.yx;
    if (z.x < z.z) z.xz = z.zx;
    if (z.y < z.z) z.yz = z.zy;
    z = uRot * z;
    z = z * S - vec3(1.0, 0.0, 0.0) * (S - 1.0);
    sc *= S;
    gTrap = min(gTrap, vec4(abs(z), dot(z, z)));
  }
  vec3 a = abs(z);
  return (a.x + a.y + a.z - 1.0) * 0.57735 / sc;
}

#elif FRACTAL == 22
// Jerusalem cube: 8 corner cubes (ratio √2−1) and 12 edge cubes (ratio (√2−1)²)
float map(vec3 p) {
  const float K = 0.41421356, K2 = 0.17157288;
  const vec3 C1 = vec3(1.0 - K);
  const vec3 C2 = vec3(1.0 - K2, 1.0 - K2, 0.0);
  vec3 z = p;
  float sc = 1.0;
  gTrap = vec4(1e9);
  for (int i = 0; i < 64; i++) {
    if (i >= uIter) break;
    z = abs(z);
    if (z.x < z.y) z.xy = z.yx;
    if (z.x < z.z) z.xz = z.zx;
    if (z.y < z.z) z.yz = z.zy;
    if (length(z - C1) - K * 1.4 < length(z - C2) - K2 * 1.4) { z = (z - C1) / K; sc /= K; }
    else { z = (z - C2) / K2; sc /= K2; }
    gTrap = min(gTrap, vec4(abs(z), dot(z, z)));
  }
  vec3 q = abs(z) - vec3(1.0);
  return (length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0)) / sc;
}

#elif FRACTAL == 25
// Pseudo-Kleinian (Knighty): infinite, explore by flying
float map(vec3 p) {
  vec3 csize = vec3(0.92436, 0.90756, 0.92436) * uParamB;
  float df = 1.0;
  gTrap = vec4(1e9);
  for (int i = 0; i < 64; i++) {
    if (i >= uIter) break;
    p = 2.0 * clamp(p, -csize, csize) - p;
    float r2 = dot(p, p);
    float k = max(uParamA / r2, 1.0);
    p *= k;
    df *= k;
    gTrap = min(gTrap, vec4(abs(p), r2));
  }
  float rxy = length(p.xy);
  return max(rxy - 0.92784, abs(rxy * p.z) / length(p)) / df;
}

#elif FRACTAL == 26
// Kleinian group limit set (Jos Leys / Knighty): infinite slab, explore by flying
vec2 wrap(vec2 x, vec2 a, vec2 s) { x -= s; return (x - a * floor(x / a)) + s; }
float map(vec3 z) {
  float a = uParamA, b = uParamB;
  float f = sign(b) * 0.45;
  vec3 lz = z + vec3(1.0), llz = z + vec3(-1.0);
  float df = 1.0;
  gTrap = vec4(1e9);
  for (int i = 0; i < 128; i++) {
    if (i >= uIter) break;
    z.x = z.x + b / a * z.y;
    z.xz = wrap(z.xz, vec2(2.0), vec2(-1.0));
    z.x = z.x - b / a * z.y;
    if (z.y >= a * 0.5 + f * (2.0 * a - 1.95) / 4.0 * sign(z.x + b * 0.5) *
        (1.0 - exp(-(7.2 - (1.95 - a) * 15.0) * abs(z.x + b * 0.5)))) {
      z = vec3(-b, a, 0.0) - z;
    }
    float iR = 1.0 / dot(z, z);
    z *= -iR;
    z.x = -b - z.x;
    z.y = a + z.y;
    df *= max(1.0, iR);
    gTrap = min(gTrap, vec4(abs(z), dot(z, z)));
    if (dot(z - llz, z - llz) < 1e-5) break;
    llz = lz;
    lz = z;
  }
  return min(min(z.y, a - z.y), 0.3) / max(df, 2.0);
}

#elif FRACTAL == 27
// Kaliset-style box: abs fold + inversion, tiled through space; explore by flying
float map(vec3 p) {
  vec3 z = mod(p + 2.0, 4.0) - 2.0;
  vec4 q = vec4(z, 1.0);
  vec3 c = vec3(uParamB, uParamB * 0.85, uParamB * 1.15);
  gTrap = vec4(1e9);
  for (int i = 0; i < 64; i++) {
    if (i >= uIter) break;
    q.xyz = abs(q.xyz) - c;
    q.xyz = uRot * q.xyz;
    float r2 = dot(q.xyz, q.xyz);
    gTrap = min(gTrap, vec4(abs(q.xyz), r2));
    q *= uParamA / clamp(r2, 0.25, 1.0);
  }
  return (length(q.xyz) - 1.0) / abs(q.w);
}

#else
// Apollonian gasket, uncut and infinite (iq): explore by flying
float map(vec3 p) {
  float s = 1.0;
  vec3 z = p;
  gTrap = vec4(1e9);
  for (int i = 0; i < 64; i++) {
    if (i >= uIter) break;
    z = -1.0 + 2.0 * fract(0.5 * z + 0.5);
    float r2 = dot(z, z);
    gTrap = min(gTrap, vec4(abs(z), r2));
    float k = uParamA / r2;
    z *= k;
    s *= k;
  }
  return 0.25 * abs(z.y) / s;
}
#endif
`;

  const SCENE = `#version 300 es
precision highp float;
precision highp int;
#define FRACTAL __FRACTAL__

uniform vec2 uRes;
uniform vec3 uCamPos, uCamRight, uCamUp, uCamFwd, uTarget;
uniform float uTanHalf, uCamDist, uTime;
uniform float uParamA, uParamB, uBound, uFudge;
uniform int uIter, uMaxSteps, uShadows, uInfinite;
uniform float uFar;
uniform vec4 uJulia;
uniform mat3 uRot;
uniform sampler2D uPal;
uniform float uHue, uSpread, uGlow, uEmissive;
uniform float uFocusRel, uCocInf, uMaxCoc, uOrbs, uNebula;

in vec2 vUv;
out vec4 outColor;

vec4 gTrap;

// Cyclic gradient, stored as sRGB: sampling returns linear color
vec3 pal(float t) { return texture(uPal, vec2(fract(t), 0.5)).rgb; }
float hash(float n) { return fract(sin(n) * 43758.5453123); }
${DE}

vec3 calcNormal(vec3 p, float h) {
  const vec2 k = vec2(1.0, -1.0);
  return normalize(k.xyy * map(p + k.xyy * h) + k.yyx * map(p + k.yyx * h) +
                   k.yxy * map(p + k.yxy * h) + k.xxx * map(p + k.xxx * h));
}

float calcAO(vec3 p, vec3 n, float s) {
  float occ = 0.0, sca = 1.0;
  for (int i = 0; i < 5; i++) {
    float h = (0.01 + 0.12 * float(i) / 4.0) * s;
    occ += (h - map(p + n * h)) * sca;
    sca *= 0.75;
  }
  return clamp(1.0 - 3.0 * occ / s, 0.0, 1.0);
}

float softShadow(vec3 ro, vec3 rd, float tmin, float tmax) {
  float res = 1.0, t = tmin;
  for (int i = 0; i < 56; i++) {
    float h = map(ro + rd * t);
    res = min(res, 10.0 * h / t);
    t += clamp(h, tmin, tmax * 0.1);
    if (res < 0.002 || t > tmax) break;
  }
  return clamp(res, 0.0, 1.0);
}

// ---------------------------------------------------------------------------
// Background: a slow nebula plus a dense field of out-of-focus lights
// ---------------------------------------------------------------------------

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
vec3 hash33(vec3 p) {
  return vec3(hash13(p), hash13(p + 17.31), hash13(p + 41.97));
}
float noise3(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x),
                 mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x),
                 mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float fbm(vec3 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) {
    s += a * noise3(p);
    p = p * 2.03 + vec3(1.7, 9.2, 3.1);
    a *= 0.5;
  }
  return s;
}

// Rotation of the sky around the vertical axis (slow drift)
vec3 skyDir(vec3 rd) {
  float a = uTime * 0.012;
  float c = cos(a), s = sin(a);
  return vec3(c * rd.x - s * rd.z, rd.y, s * rd.x + c * rd.z);
}

// Domain-warped fbm clouds in palette colors, with darker dust lanes
vec3 nebula(vec3 d) {
  vec3 q = d * 1.8;
  float n1 = fbm(q);
  float n2 = fbm(q * 1.6 + n1 * 1.8 + 4.0);
  float dens = smoothstep(0.32, 0.82, n2);
  vec3 c = pal(n1 * 1.3 + uHue * 0.5) * dens * 0.16;
  c += pal(n2 * 1.1 + 0.45 + uHue * 0.5) * dens * dens * dens * 0.30;
  c *= 0.35 + 0.65 * smoothstep(0.28, 0.62, fbm(q * 3.2 + 7.0));
  return c;
}

// Point lights on three shells of directions; each shell has its own depth,
// hence its own circle of confusion. Jittered 3D cells around a sphere of
// radius K give an even, seamless spread; only the 27 cells around the ray
// are visited, so the cost does not depend on the number of lights.
vec3 bokehField(vec2 fc, vec3 rd) {
  vec3 acc = vec3(0.0);
  float focalPx = 0.5 * uRes.y / uTanHalf;
  float pixA = 2.0 * uTanHalf / uRes.y;
  float unit = uRes.y / 900.0;
  vec3 sd = skyDir(rd);
  for (int layer = 0; layer < 3; layer++) {
    float K = layer == 0 ? 15.0 : (layer == 1 ? 9.5 : 6.0);
    float rel = layer == 0 ? 12.0 : (layer == 1 ? 4.0 : 2.0);
    float coc = min(uCocInf * abs(1.0 - uFocusRel / rel), uMaxCoc * 2.0);
    // Disc radius in pixels, capped so it never spills past the neighbouring cells
    float R = min(max(coc, 1.0 * unit) + 0.8 * unit, 0.85 / (K * pixA));
    float energy = clamp(5.0 * unit / R, 0.05, 1.8);
    vec3 cell = floor(sd * K);
    for (int z = -1; z <= 1; z++)
    for (int y = -1; y <= 1; y++)
    for (int x = -1; x <= 1; x++) {
      vec3 c = cell + vec3(x, y, z);
      vec3 h = hash33(c + float(layer) * 113.0);
      vec3 pos = c + h;
      float r = length(pos);
      if (abs(r - K) > 0.5 || h.x > 0.1 + 0.5 * min(uOrbs, 1.0)) continue;
      // Back from sky space to world space, then project to the screen
      vec3 d = pos / r;
      float a = -uTime * 0.012;
      float ca = cos(a), sa = sin(a);
      d = vec3(ca * d.x - sa * d.z, d.y, sa * d.x + ca * d.z);
      float zc = dot(d, uCamFwd);
      if (zc <= 0.05) continue;
      vec2 sp = vec2(dot(d, uCamRight), dot(d, uCamUp)) / zc * focalPx + 0.5 * uRes;
      float L = length(fc - sp);
      if (L > R + 1.5) continue;
      float m = L / R;
      float disc = clamp((1.0 - m) * R * 0.5 + 0.5, 0.0, 1.0);
      float rim = 1.0 + 0.45 * smoothstep(0.55, 1.0, m);
      float bright = 0.35 + 1.6 * h.y * h.y * h.y;  // a few lights are much brighter
      vec3 col = h.z > 0.85 ? vec3(1.0, 0.85, 0.65) : pal(h.z * 1.7 + uHue * 0.5) * 1.3;
      acc += col * disc * rim * energy * bright;
    }
  }
  return acc * max(uOrbs, 0.0);
}

void main() {
  vec2 fc = gl_FragCoord.xy;
  vec2 q = (2.0 * fc - uRes) / uRes.y;
  vec3 rd = normalize(uCamFwd + (q.x * uCamRight + q.y * uCamUp) * uTanHalf);
  vec3 ro = uCamPos;
  float pixA = 2.0 * uTanHalf / uRes.y;
  float minEps = 1.5e-7 * (1.0 + length(ro));

  // Bounded fractals: march inside an enlarged bounding sphere, so the halo
  // fades out smoothly. Infinite ones: march up to uFar and fade into fog.
  bool hit = false;
  float t = 0.0, tEnd = -1.0;
  float glowQ = 1e9;
  vec4 trap = vec4(0.0);
  if (uInfinite > 0) {
    tEnd = uFar;
  } else {
    float R = uBound * 2.5;
    float b = dot(ro, rd);
    float h = b * b - (dot(ro, ro) - R * R);
    if (h > 0.0) {
      h = sqrt(h);
      t = max(-b - h, 0.0);
      tEnd = -b + h;
    }
  }
  if (tEnd > 0.0) {
    int i = 0;
    for (; i < 2000; i++) {
      if (i >= uMaxSteps) break;
      float d = map(ro + rd * t) * uFudge;
      float eps = max(t * pixA * 0.5, minEps);
      glowQ = min(glowQ, d / max(t, 1e-6));
      if (d < eps) { hit = true; trap = gTrap; break; }
      t += d;
      if (t > tEnd) break;
    }
    // Out of steps close to the surface: treat as a (dark, occluded) hit
    if (!hit && i >= uMaxSteps && t < tEnd) { hit = true; trap = gTrap; }
  }

  vec3 bg = vec3(0.008, 0.007, 0.02) + vec3(0.02, 0.01, 0.045) * (0.5 + 0.5 * dot(rd, uCamUp));
  bg += nebula(skyDir(rd)) * uNebula;
  vec3 col;
  float depth = 1000.0;
  if (hit) {
    vec3 p = ro + rd * t;
    float eps = max(t * pixA * 0.5, minEps);
    vec3 n = calcNormal(p, eps);
    float ao = calcAO(p, n, t * 0.35);

    float ct = uSpread * (0.55 * sqrt(trap.w) + 0.9 * trap.x - 0.4 * trap.y + 0.35 * trap.z) + uHue;
    vec3 base = pal(ct);

    vec3 L = normalize(-0.45 * uCamRight + 0.75 * uCamUp - 0.5 * uCamFwd);
    vec3 L2 = normalize(0.8 * uCamRight - 0.3 * uCamUp - 0.2 * uCamFwd);
    float dif = clamp(dot(n, L), 0.0, 1.0);
    float sh = 1.0;
    if (uShadows > 0 && dif > 0.001) sh = softShadow(p + n * eps * 2.0, L, eps * 4.0, uBound * 2.0);
    float fil = clamp(dot(n, L2), 0.0, 1.0);
    float amb = 0.5 + 0.5 * dot(n, uCamUp);
    float fre = pow(clamp(1.0 + dot(n, rd), 0.0, 1.0), 3.0);
    float spe = pow(clamp(dot(n, normalize(L - rd)), 0.0, 1.0), 40.0) * dif * sh;

    vec3 keyC = vec3(1.0, 0.92, 0.82) * 1.15;
    col = base * (0.10 + 0.25 * amb) * ao;
    col += base * keyC * dif * sh;
    col += base * pal(ct + 0.5) * 0.5 * fil * ao;
    col += pal(ct + 0.25) * 0.9 * fre * ao;
    col += keyC * spe * 2.5;  // HDR highlights: these become bokeh discs and bloom
    col += uEmissive * pal(ct + 0.33) * (1.0 - ao) * (1.0 - ao) * 1.2;

    depth = t * dot(rd, uCamFwd) / uCamDist;
    if (uInfinite > 0) col = mix(col, bg, 1.0 - exp(-3.0 * t / uFar));  // distance fog
  } else if (uInfinite > 0) {
    col = bg;
  } else {
    col = bg;
    float g1 = exp(-glowQ * 40.0), g2 = exp(-glowQ * 160.0);
    col += uGlow * (pal(uHue + 0.6) * g1 * 0.18 + pal(uHue + 0.1 + glowQ * 4.0) * g2 * 0.9);
    if (uOrbs > 0.0) col += bokehField(fc, rd);
  }
  // A single NaN/Inf pixel would spread over the whole frame through the bloom chain
  if (any(isnan(col)) || any(isinf(col))) col = vec3(0.0);
  if (isnan(depth) || isinf(depth)) depth = 1000.0;
  outColor = vec4(min(col, vec3(1e3)), depth);
}`;

  // ---------------------------------------------------------------------------
  // Depth of field: single-pass scatter-as-gather with a golden-angle spiral.
  // uTile holds, per 16×16 tile, the largest CoC within reach (COC_TILE +
  // COC_DILATE): no sample farther than that can land here, so the spiral
  // stops early in focused areas and in the background far from the fractal.
  // ---------------------------------------------------------------------------
  const DOF = `#version 300 es
precision highp float;
uniform sampler2D uScene, uTile;
uniform vec2 uTexel;
uniform float uFocusRel, uCocInf, uMaxCoc, uRadScale, uBoost;
in vec2 vUv;
out vec4 outColor;
float coc(float z) {
  return z > 500.0 ? 0.0 : min(uCocInf * abs(1.0 - uFocusRel / max(z, 1e-4)), uMaxCoc);
}
float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
void main() {
  vec4 c0 = texture(uScene, vUv);
  float s0 = coc(c0.a);
  vec3 acc = c0.rgb;
  float ws = 1.0;
  float rmax = min(uMaxCoc, max(s0, texelFetch(uTile, ivec2(gl_FragCoord.xy) / 16, 0).r) + 0.5);
  float r = uRadScale;
  // Per-pixel spiral rotation (interleaved gradient noise) breaks up sampling patterns
  float ang = 6.2831853 * fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  for (int i = 0; i < 2000; i++) {
    if (r >= rmax) break;
    vec4 s = texture(uScene, vUv + vec2(cos(ang), sin(ang)) * r * uTexel);
    float ss = coc(s.a);
    if (s.a > c0.a) ss = min(ss, s0 * 2.0);  // background must not bleed over sharper foreground
    float m = smoothstep(r - 0.5, r + 0.5, ss);
    float w = 1.0 + uBoost * max(lum(s.rgb) - 0.8, 0.0);  // highlights dominate: bright bokeh discs
    acc += mix(acc / ws, s.rgb * w, m);
    ws += mix(1.0, w, m);
    ang += 2.39996323;
    r += uRadScale / r;
  }
  outColor = vec4(acc / ws, 1.0);
}`;

  // Largest CoC inside each 16×16 tile of the scene
  const COC_TILE = `#version 300 es
precision highp float;
uniform sampler2D uScene;
uniform float uFocusRel, uCocInf, uMaxCoc;
out vec4 outColor;
float coc(float z) {
  return z > 500.0 ? 0.0 : min(uCocInf * abs(1.0 - uFocusRel / max(z, 1e-4)), uMaxCoc);
}
void main() {
  ivec2 size = textureSize(uScene, 0);
  ivec2 base = ivec2(gl_FragCoord.xy) * 16;
  float m = 0.0;
  for (int y = 0; y < 16; y++) {
    for (int x = 0; x < 16; x++) {
      ivec2 p = min(base + ivec2(x, y), size - 1);
      m = max(m, coc(texelFetch(uScene, p, 0).a));
    }
  }
  outColor = vec4(m);
}`;

  // Spread each tile's CoC to the tiles it can reach (uR tiles around)
  const COC_DILATE = `#version 300 es
precision highp float;
uniform sampler2D uTiles;
uniform int uR;
out vec4 outColor;
void main() {
  ivec2 size = textureSize(uTiles, 0);
  ivec2 c = ivec2(gl_FragCoord.xy);
  float m = 0.0;
  for (int y = -4; y <= 4; y++) {
    for (int x = -4; x <= 4; x++) {
      if (abs(x) > uR || abs(y) > uR) continue;
      m = max(m, texelFetch(uTiles, clamp(c + ivec2(x, y), ivec2(0), size - 1), 0).r);
    }
  }
  outColor = vec4(m);
}`;

  // ---------------------------------------------------------------------------
  // Bloom: thresholded downsample chain + tent upsample (additive blending)
  // ---------------------------------------------------------------------------
  const DOWN = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uTexel;
uniform float uThreshold;
uniform int uPrefilter;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec4 d = uTexel.xyxy * vec4(-1.0, -1.0, 1.0, 1.0);
  vec3 s = (texture(uSrc, vUv + d.xy).rgb + texture(uSrc, vUv + d.zy).rgb +
            texture(uSrc, vUv + d.xw).rgb + texture(uSrc, vUv + d.zw).rgb) * 0.25;
  if (uPrefilter == 1) {
    s = min(s, vec3(40.0));
    float br = max(s.r, max(s.g, s.b));
    float knee = uThreshold * 0.5 + 1e-4;
    float soft = clamp(br - uThreshold + knee, 0.0, 2.0 * knee);
    soft = soft * soft / (4.0 * knee);
    s *= max(soft, br - uThreshold) / max(br, 1e-4);
  }
  outColor = vec4(s, 1.0);
}`;

  const UP = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uTexel;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec4 d = uTexel.xyxy * vec4(1.0, 1.0, -1.0, 0.0);
  vec3 s = texture(uSrc, vUv - d.xy).rgb;
  s += texture(uSrc, vUv - d.wy).rgb * 2.0;
  s += texture(uSrc, vUv - d.zy).rgb;
  s += texture(uSrc, vUv + d.zw).rgb * 2.0;
  s += texture(uSrc, vUv).rgb * 4.0;
  s += texture(uSrc, vUv + d.xw).rgb * 2.0;
  s += texture(uSrc, vUv + d.zy).rgb;
  s += texture(uSrc, vUv + d.wy).rgb * 2.0;
  s += texture(uSrc, vUv + d.xy).rgb;
  outColor = vec4(s / 16.0, 1.0);
}`;

  // ---------------------------------------------------------------------------
  // Final composite: lens fringing, bloom, exposure, ACES, vignette, dither
  // ---------------------------------------------------------------------------
  const COMPOSITE = `#version 300 es
precision highp float;
uniform sampler2D uImg, uBloom;
uniform vec2 uRes;
uniform float uBloomInt, uExposure, uFringe, uTime;
in vec2 vUv;
out vec4 outColor;
vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}
// Sharp full-resolution scene where in focus, half-resolution blur elsewhere
void main() {
  vec2 dc = vUv - 0.5;
  vec2 off = dc * uFringe;
  vec3 c = vec3(texture(uImg, vUv - off).r, texture(uImg, vUv).g, texture(uImg, vUv + off).b);
  vec3 b = vec3(texture(uBloom, vUv - off * 2.0).r, texture(uBloom, vUv).g, texture(uBloom, vUv + off * 2.0).b);
  c += b * uBloomInt;
  c *= uExposure;
  c = max(mix(vec3(dot(c, vec3(0.2126, 0.7152, 0.0722))), c, 1.25), 0.0);  // a little extra saturation
  float v = length(dc * vec2(uRes.x / uRes.y, 1.0));
  c *= mix(1.0, 0.45, smoothstep(0.35, 1.05, v));
  c = pow(aces(c), vec3(1.0 / 2.2));
  float n = fract(sin(dot(gl_FragCoord.xy + uTime, vec2(12.9898, 78.233))) * 43758.5453);
  c += (n - 0.5) / 128.0;
  outColor = vec4(c, 1.0);
}`;

  return {
    VERT, DOF, COC_TILE, COC_DILATE, DOWN, UP, COMPOSITE,
    scene: (id) => SCENE.replace('__FRACTAL__', String(id)),
  };
})();
