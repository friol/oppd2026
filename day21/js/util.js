// Shared helpers: PRNG, value noise, small vector math, GLSL noise chunk.
(function (G) {
  'use strict';
  const U = {};

  // Mulberry32 PRNG
  U.rng = function (seed) {
    let s = seed >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  function hash2(ix, iy) {
    let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  // Smooth value noise in [0,1]
  U.noise2 = function (x, y) {
    const ix = Math.floor(x), iy = Math.floor(y);
    let fx = x - ix, fy = y - iy;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    const a = hash2(ix, iy), b = hash2(ix + 1, iy), c = hash2(ix, iy + 1), d = hash2(ix + 1, iy + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
  U.fbm2 = function (x, y, oct) {
    let s = 0, a = 0.5, n = 0;
    for (let i = 0; i < (oct || 5); i++) {
      s += a * U.noise2(x, y); n += a;
      const nx = x * 1.6 - y * 1.2, ny = x * 1.2 + y * 1.6;
      x = nx + 17.3; y = ny - 9.1; a *= 0.5;
    }
    return s / n;
  };
  U.ridged2 = function (x, y, oct) {
    let s = 0, a = 0.5, n = 0;
    for (let i = 0; i < (oct || 5); i++) {
      const r = 1 - Math.abs(U.noise2(x, y) * 2 - 1);
      s += a * r * r; n += a;
      const nx = x * 1.7 - y * 1.1, ny = x * 1.1 + y * 1.7;
      x = nx + 5.7; y = ny + 3.3; a *= 0.5;
    }
    return s / n;
  };

  U.clamp = (x, a, b) => x < a ? a : x > b ? b : x;
  U.lerp = (a, b, t) => a + (b - a) * t;
  U.smooth = (a, b, x) => { const t = U.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

  // vec3 as plain arrays
  U.v3 = {
    add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
    sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
    scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
    dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
    cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
    len: (a) => Math.hypot(a[0], a[1], a[2]),
    norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  };

  // GLSL: hash, value noise and fbm (2D), plus the shared cloud layer used by sky and ground shadows.
  U.GLSL_NOISE = `
  float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    float a = hash12(i), b = hash12(i + vec2(1.0, 0.0)), c = hash12(i + vec2(0.0, 1.0)), d = hash12(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
  float fbm4(vec2 p) {
    float s = 0.0, a = 0.5;
    mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
    for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = m * p + 7.1; a *= 0.5; }
    return s / 0.9375;
  }
  float fbm6(vec2 p) {
    float s = 0.0, a = 0.5;
    mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
    for (int i = 0; i < 6; i++) { s += a * vnoise(p); p = m * p + 7.1; a *= 0.5; }
    return s / 0.984375;
  }
  // Cloud layer density at a point of the cloud plane (meters), wispy and stretched.
  uniform float uCloudTime;
  uniform float uCloudCover;
  float cloudDensity(vec2 p, bool hq) {
    p += uCloudTime * vec2(7.0, 2.5);
    vec2 q = p * vec2(0.00042, 0.0010);
    float w = fbm4(q * 0.6 + 3.0);
    q += vec2(w * 1.3, w * 0.5);
    float n = hq ? fbm6(q) : fbm4(q);
    return smoothstep(uCloudCover, uCloudCover + 0.32, n);
  }
  `;

  G.UTIL = U;
  if (typeof module !== 'undefined') module.exports = U;
})(typeof window !== 'undefined' ? window : globalThis);
