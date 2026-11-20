// noise.js - CPU noise helpers (seeded RNG, 2D simplex, fBm, tileable 3D cloud noise).
// Plain script: exposes the global NOISE (also works inside a Node vm context for testing).
(function (root) {
  'use strict';

  // Small fast seeded PRNG, returns floats in [0, 1)
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  // Integer hash -> [0, 1)
  function hash3i(x, y, z, seed) {
    let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 2147483647) ^ Math.imul(seed | 0, 1274126177);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  // 2D simplex noise (Gustavson), output roughly in [-1, 1]
  function makeSimplex2(seed) {
    const rnd = mulberry32(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
    const perm = new Uint8Array(512), pm12 = new Uint8Array(512);
    for (let i = 0; i < 512; i++) { perm[i] = p[i & 255]; pm12[i] = perm[i] % 12; }
    const g = new Float32Array([1, 1, -1, 1, 1, -1, -1, -1, 1, 0, -1, 0, 1, 0, -1, 0, 0, 1, 0, -1, 0, 1, 0, -1]);
    const F2 = 0.5 * (Math.sqrt(3) - 1), G2 = (3 - Math.sqrt(3)) / 6;
    return function (xin, yin) {
      let n0 = 0, n1 = 0, n2 = 0;
      const s = (xin + yin) * F2;
      const i = Math.floor(xin + s), j = Math.floor(yin + s);
      const t = (i + j) * G2;
      const x0 = xin - (i - t), y0 = yin - (j - t);
      let i1, j1;
      if (x0 > y0) { i1 = 1; j1 = 0; } else { i1 = 0; j1 = 1; }
      const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
      const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
      const ii = i & 255, jj = j & 255;
      let t0 = 0.5 - x0 * x0 - y0 * y0;
      if (t0 > 0) { const k = pm12[ii + perm[jj]] * 2; t0 *= t0; n0 = t0 * t0 * (g[k] * x0 + g[k + 1] * y0); }
      let t1 = 0.5 - x1 * x1 - y1 * y1;
      if (t1 > 0) { const k = pm12[ii + i1 + perm[jj + j1]] * 2; t1 *= t1; n1 = t1 * t1 * (g[k] * x1 + g[k + 1] * y1); }
      let t2 = 0.5 - x2 * x2 - y2 * y2;
      if (t2 > 0) { const k = pm12[ii + 1 + perm[jj + 1]] * 2; t2 *= t2; n2 = t2 * t2 * (g[k] * x2 + g[k + 1] * y2); }
      return 70 * (n0 + n1 + n2);
    };
  }

  // Fractal Brownian motion helper on top of a 2D noise function
  function fbm2(fn, x, y, oct, lac, gain) {
    let a = 0.5, f = 1, s = 0, n = 0;
    for (let i = 0; i < oct; i++) { s += a * fn(x * f, y * f); n += a; a *= gain; f *= lac; }
    return s / n;
  }

  // Ridged multifractal (sharp mountain crests), output in [0, 1]
  function ridged2(fn, x, y, oct) {
    let a = 0.5, f = 1, s = 0, n = 0, w = 1;
    for (let i = 0; i < oct; i++) {
      let r = 1 - Math.abs(fn(x * f, y * f));
      r *= r;
      r *= w;
      w = Math.min(1, Math.max(0, r * 2));
      s += r * a; n += a;
      a *= 0.5; f *= 2.03;
    }
    return s / n;
  }

  // ---- Tileable 3D noise for the volumetric clouds ----

  function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }

  // Periodic gradient noise, period P lattice cells
  function perlin3p(x, y, z, P, seed) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const xf = x - xi, yf = y - yi, zf = z - zi;
    const u = fade(xf), v = fade(yf), w = fade(zf);
    let res = 0;
    for (let c = 0; c < 8; c++) {
      const dx = c & 1, dy = (c >> 1) & 1, dz = (c >> 2) & 1;
      const X = ((xi + dx) % P + P) % P, Y = ((yi + dy) % P + P) % P, Z = ((zi + dz) % P + P) % P;
      // pseudo random unit gradient
      const th = hash3i(X, Y, Z, seed) * Math.PI * 2;
      const cz = hash3i(X, Y, Z, seed + 17) * 2 - 1;
      const r = Math.sqrt(1 - cz * cz);
      const gx = r * Math.cos(th), gy = r * Math.sin(th), gz = cz;
      const d = gx * (xf - dx) + gy * (yf - dy) + gz * (zf - dz);
      const wx = dx ? u : 1 - u, wy = dy ? v : 1 - v, wz = dz ? w : 1 - w;
      res += d * wx * wy * wz;
    }
    return res; // ~[-0.9, 0.9]
  }

  // Periodic Worley (cellular) noise, returns 1 - F1 distance (1 = at a feature point)
  function worley3p(x, y, z, C, seed) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    let best = 9;
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const cx = xi + dx, cy = yi + dy, cz = zi + dz;
      const X = (cx % C + C) % C, Y = (cy % C + C) % C, Z = (cz % C + C) % C;
      const px = cx + hash3i(X, Y, Z, seed), py = cy + hash3i(X, Y, Z, seed + 1), pz = cz + hash3i(X, Y, Z, seed + 2);
      const ex = px - x, ey = py - y, ez = pz - z;
      const d = ex * ex + ey * ey + ez * ez;
      if (d < best) best = d;
    }
    return 1 - Math.min(1, Math.sqrt(best));
  }

  function remap(v, a, b, c, d) { return c + (v - a) / (b - a) * (d - c); }

  // Base cloud shape: Perlin-Worley in R, Worley fBm in G (size^3 voxels, tileable)
  function cloudShapeTexture(size) {
    const out = new Uint8Array(size * size * size * 4);
    let o = 0;
    for (let z = 0; z < size; z++) for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size, w = z / size;
      let p = 0, amp = 1, tot = 0;
      for (let k = 0; k < 4; k++) { const f = 4 << k; p += perlin3p(u * f, v * f, w * f, f, 11 + k) * amp; tot += amp; amp *= 0.5; }
      p = p / tot * 0.5 + 0.5;
      const w1 = worley3p(u * 4, v * 4, w * 4, 4, 101), w2 = worley3p(u * 8, v * 8, w * 8, 8, 202), w3 = worley3p(u * 16, v * 16, w * 16, 16, 303);
      const wf = w1 * 0.625 + w2 * 0.25 + w3 * 0.125;
      let pw = remap(p, wf - 1, 1, 0, 1);
      pw = Math.max(0, Math.min(1, pw));
      const w4 = worley3p(u * 32, v * 32, w * 32, 32, 404);
      const g = w2 * 0.625 + w3 * 0.25 + w4 * 0.125;
      out[o++] = Math.round(pw * 255);
      out[o++] = Math.round(g * 255);
      out[o++] = Math.round(wf * 255);
      out[o++] = 255;
    }
    return out;
  }

  // Detail erosion noise: Worley fBm (size^3, tileable)
  function cloudDetailTexture(size) {
    const out = new Uint8Array(size * size * size);
    let o = 0;
    for (let z = 0; z < size; z++) for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size, w = z / size;
      const a = worley3p(u * 4, v * 4, w * 4, 4, 505), b = worley3p(u * 8, v * 8, w * 8, 8, 606), c = worley3p(u * 16, v * 16, w * 16, 16, 707);
      out[o++] = Math.round((a * 0.625 + b * 0.25 + c * 0.125) * 255);
    }
    return out;
  }

  root.NOISE = { mulberry32, hash3i, makeSimplex2, fbm2, ridged2, cloudShapeTexture, cloudDetailTexture };
})(typeof window !== 'undefined' ? window : globalThis);
