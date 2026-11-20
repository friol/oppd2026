// world.js - procedural island: heightmap, hydraulic erosion, masks (forest / fields),
// lakes, town sites and the spawn point. Pure data, no three.js (testable in Node).
(function (root) {
  'use strict';

  const N = 2049;              // heightmap samples per side
  const CELL = 16;             // meters between samples
  const SIZE = (N - 1) * CELL; // 32768 m
  const HALF = SIZE / 2;

  const W = {
    N, CELL, SIZE, HALF,
    height: null,   // Float32Array N*N (meters, sea level = 0)
    normal: null,   // Uint8Array N*N*4: nx, nz, forest density, fields mask
    lakes: [],      // {x, z, r}
    towns: [],      // {x, z, r, angle, seed}
    spawn: null,    // {x, y, z, heading}
    seed: 1977
  };

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function smooth(e0, e1, x) { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); }

  // Bilinear height lookup in world meters (outside the map = deep sea)
  W.heightAt = function (x, z) {
    const h = W.height;
    const fx = (x + HALF) / CELL, fz = (z + HALF) / CELL;
    if (fx < 0 || fz < 0 || fx >= N - 1 || fz >= N - 1) return -120;
    const ix = fx | 0, iz = fz | 0, tx = fx - ix, tz = fz - iz;
    const i = iz * N + ix;
    const a = h[i], b = h[i + 1], c = h[i + N], d = h[i + N + 1];
    return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
  };

  // Nearest-sample lookup of the 8-bit masks (channel 2 = forest, 3 = fields)
  W.maskAt = function (x, z, ch) {
    const fx = Math.round((x + HALF) / CELL), fz = Math.round((z + HALF) / CELL);
    if (fx < 0 || fz < 0 || fx >= N || fz >= N) return 0;
    return W.normal[(fz * N + fx) * 4 + ch] / 255;
  };

  // Terrain normal (y up) at a world position
  W.normalAt = function (x, z) {
    const e = CELL;
    const dx = W.heightAt(x + e, z) - W.heightAt(x - e, z);
    const dz = W.heightAt(x, z + e) - W.heightAt(x, z - e);
    const l = Math.hypot(dx, 2 * e, dz);
    return { x: -dx / l, y: 2 * e / l, z: -dz / l };
  };

  // ---------------------------------------------------------------------
  // Generation, written as a generator so the page can show progress.
  // Each `yield` returns a [0..1] progress value and a label.
  W.generate = function* () {
    const S = root.NOISE;
    const n1 = S.makeSimplex2(W.seed), n2 = S.makeSimplex2(W.seed + 1), n3 = S.makeSimplex2(W.seed + 2);
    const n4 = S.makeSimplex2(W.seed + 3), n5 = S.makeSimplex2(W.seed + 4);
    const fbm = S.fbm2, ridged = S.ridged2;
    const H = new Float32Array(N * N);
    const mtn = new Float32Array(N * N); // mountain mask, used to pick lake sites
    W.height = H;

    // --- 1. base relief ---
    // Low-frequency fields (island shape, masks, domain warp) on a coarse grid,
    // detail noise on a half-resolution grid; then upsampled to N (erosion adds the fine detail).
    const CN = 257, CC = SIZE / (CN - 1);          // coarse grid, 128 m
    const coarse = new Float32Array(CN * CN * 7);  // land, inner, plains, hillMask, warpX, warpZ, mMask
    for (let j = 0; j < CN; j++) for (let i = 0; i < CN; i++) {
      const qx = (-HALF + i * CC) / 1000, qz = (-HALF + j * CC) / 1000;
      let d = Math.hypot(qx, qz * 1.08) / 16.4;
      d += 0.16 * fbm(n1, qx * 0.13, qz * 0.13, 4, 2.1, 0.5) + 0.05 * fbm(n2, qx * 0.6, qz * 0.6, 3, 2, 0.5);
      const o = (j * CN + i) * 7;
      coarse[o] = smooth(0.97, 0.74, d);
      coarse[o + 1] = smooth(0.95, 0.62, d);
      coarse[o + 2] = fbm(n2, qx * 0.22 + 3.1, qz * 0.22 - 1.7, 4, 2, 0.5);
      coarse[o + 3] = smooth(-0.25, 0.45, fbm(n3, qx * 0.11 + 9.0, qz * 0.11 + 2.0, 3, 2, 0.5));
      coarse[o + 4] = 1.6 * fbm(n4, qx * 0.2, qz * 0.2, 3, 2, 0.5);
      coarse[o + 5] = 1.6 * fbm(n4, qx * 0.2 + 17, qz * 0.2 - 5, 3, 2, 0.5);
      coarse[o + 6] = smooth(0.0, 0.42, fbm(n5, qx * 0.075 + 4.0, qz * 0.075 - 8.0, 3, 2, 0.5)) * coarse[o + 1];
    }
    const cv = new Float32Array(7);
    function coarseAt(x, z) {
      const fx = Math.min(CN - 1.001, (x + HALF) / CC), fz = Math.min(CN - 1.001, (z + HALF) / CC);
      const ix = fx | 0, iz = fz | 0, tx = fx - ix, tz = fz - iz;
      const a = (iz * CN + ix) * 7, b = a + 7, c = a + CN * 7, d = c + 7;
      for (let k = 0; k < 7; k++) cv[k] = (coarse[a + k] * (1 - tx) + coarse[b + k] * tx) * (1 - tz) + (coarse[c + k] * (1 - tx) + coarse[d + k] * tx) * tz;
      return cv;
    }
    yield [0.03, 'Raising mountains'];
    const HN = (N + 1) / 2, HC = CELL * 2;          // half-res grid, 32 m
    const half = new Float32Array(HN * HN), halfM = new Float32Array(HN * HN);
    for (let j = 0; j < HN; j++) {
      const z = -HALF + j * HC, qz = z / 1000;
      for (let i = 0; i < HN; i++) {
        const x = -HALF + i * HC, qx = x / 1000;
        const c = coarseAt(x, z);
        const land = c[0], plains = c[2], hillMask = c[3], mMask = c[6];
        let h = 18 + plains * 22;
        let hillN = 0.5;
        if (land > 0.001 && (hillMask > 0.002 || mMask > 0.002)) {
          hillN = fbm(n3, qx * 0.55, qz * 0.55, 5, 2.05, 0.5) * 0.5 + 0.5;
          h += Math.pow(hillN, 1.7) * 260 * hillMask * land;
        }
        if (mMask > 0.002) {
          // ranges: ridged crests on a broad massif. Raising the ridged noise to a power > 1 gives
          // sharp crests with concave flanks and wide valleys (the profile of real eroded
          // mountains); the ~6 km wavelength keeps them from being needles or heavy lumps.
          const r = ridged(n4, (qx + c[4]) * 0.16, (qz + c[5]) * 0.16, 7);
          const massif = smooth(0.0, 1.0, mMask) * (0.5 + 0.5 * fbm(n5, qx * 0.3 + 3, qz * 0.3, 3, 2, 0.5));
          h += (Math.pow(r, 1.6) * 2900 + massif * 700) * mMask * (0.65 + 0.35 * hillN);
        }
        h = h * land + (-95 + 40 * plains) * (1 - land);
        half[j * HN + i] = h;
        halfM[j * HN + i] = mMask;
      }
      if ((j & 31) === 0) yield [0.03 + 0.25 * j / HN, 'Raising mountains'];
    }
    // thermal erosion (scree): no slope steeper than ~40 degrees, peaks become ridges and pyramids
    yield* thermal(half, HN, HC, 45, 25);
    // upsample (bilinear) to full resolution
    for (let j = 0; j < N; j++) {
      const hj = j >> 1, tz = (j & 1) * 0.5, hj1 = Math.min(HN - 1, hj + 1);
      for (let i = 0; i < N; i++) {
        const hi = i >> 1, tx = (i & 1) * 0.5, hi1 = Math.min(HN - 1, hi + 1);
        const a = hj * HN + hi, b = hj * HN + hi1, c = hj1 * HN + hi, d = hj1 * HN + hi1;
        H[j * N + i] = (half[a] * (1 - tx) + half[b] * tx) * (1 - tz) + (half[c] * (1 - tx) + half[d] * tx) * tz;
        mtn[j * N + i] = halfM[a];
      }
    }
    // a touch of fine noise so the upsampled grid does not look smooth
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = j * N + i, h = H[k];
      if (h > 30) H[k] += n5(i * 0.11, j * 0.11) * Math.min(14, h * 0.012);
    }

    // --- 2. lakes in the foothills, next to the ranges (so the water mirrors peaks) ---
    const rnd = S.mulberry32(W.seed + 99);
    const cand = [];
    for (let t = 0; t < 4000; t++) {
      const x = (rnd() - 0.5) * SIZE * 0.7, z = (rnd() - 0.5) * SIZE * 0.7;
      const i = Math.round((x + HALF) / CELL), j = Math.round((z + HALF) / CELL);
      const m = mtn[j * N + i], h = H[j * N + i];
      if (m > 0.2 && m < 0.6 && h > 10 && h < 260) {
        // mountains nearby?
        let peak = 0;
        for (let a = 0; a < 12; a++) {
          const ang = a / 12 * Math.PI * 2;
          for (let rr = 1500; rr <= 4500; rr += 1500) peak = Math.max(peak, W.heightAt(x + Math.cos(ang) * rr, z + Math.sin(ang) * rr));
        }
        if (peak > 1100) cand.push({ x, z, score: peak - h * 2 });
      }
    }
    cand.sort((a, b) => b.score - a.score);
    for (const c of cand) {
      if (W.lakes.length >= 5) break;
      if (W.lakes.some(l => Math.hypot(l.x - c.x, l.z - c.z) < 6000)) continue;
      W.lakes.push({ x: c.x, z: c.z, r: 700 + rnd() * 700 });
    }
    for (const L of W.lakes) {
      const R = L.r * 2.2;
      const i0 = Math.max(0, Math.floor((L.x - R + HALF) / CELL)), i1 = Math.min(N - 1, Math.ceil((L.x + R + HALF) / CELL));
      const j0 = Math.max(0, Math.floor((L.z - R + HALF) / CELL)), j1 = Math.min(N - 1, Math.ceil((L.z + R + HALF) / CELL));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const x = -HALF + i * CELL, z = -HALF + j * CELL;
        const dx = (x - L.x) / 1000, dz = (z - L.z) / 1000;
        // irregular shoreline
        const d = Math.hypot(x - L.x, z - L.z) * (1 + 0.35 * n1(dx * 1.3 + 40, dz * 1.3) + 0.12 * n2(dx * 4, dz * 4));
        const bowl = -3 - 30 * smooth(L.r * 1.05, L.r * 0.35, d);
        const m = smooth(L.r * 2.0, L.r * 0.85, d);
        const k = j * N + i;
        H[k] = H[k] * (1 - m) + bowl * m;
      }
    }
    yield [0.33, 'Filling lakes'];

    // --- 3. hydraulic erosion (droplet model) ---
    yield* erode(H, rnd);

    // a final scree pass at full resolution: the droplets must not leave vertical slots and pillars
    yield* thermal(H, N, CELL, 47, 8);

    // --- 4. shore shaping: the ground must cross sea level with a clear slope,
    // otherwise terrain and water are nearly coplanar and z-fight along the beaches
    for (let k = 0; k < N * N; k++) {
      const h = H[k];
      if (h > -8 && h < 1.5) H[k] = h - 1.4 * smooth(1.5, -2, h);
    }

    // --- 5. towns on flat, low ground ---
    pickTowns(rnd);
    yield [0.86, 'Founding villages'];

    // --- 6. normals and masks ---
    const NM = new Uint8Array(N * N * 4);
    W.normal = NM;
    // forest patches on a 64 m grid (kilometer-scale features)
    const PN = 513, PC = SIZE / (PN - 1), patch = new Float32Array(PN * PN);
    for (let j = 0; j < PN; j++) for (let i = 0; i < PN; i++)
      patch[j * PN + i] = fbm(n3, (-HALF + i * PC) / 1000 * 0.9 + 50, (-HALF + j * PC) / 1000 * 0.9, 4, 2, 0.5);
    yield [0.88, 'Planting forests'];
    for (let j = 0; j < N; j++) {
      const pz = j * CELL / PC, pj = Math.min(PN - 2, pz | 0), tz = pz - pj;
      for (let i = 0; i < N; i++) {
        const k = j * N + i;
        const hl = H[k - (i > 0 ? 1 : 0)], hr = H[k + (i < N - 1 ? 1 : 0)];
        const hd = H[k - (j > 0 ? N : 0)], hu = H[k + (j < N - 1 ? N : 0)];
        let nx = hl - hr, ny = 2 * CELL, nz = hd - hu;
        const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
        NM[k * 4] = Math.round((nx * 0.5 + 0.5) * 255);
        NM[k * 4 + 1] = Math.round((nz * 0.5 + 0.5) * 255);
        // forest: mid altitudes, gentle slopes, patchy
        const px = i * CELL / PC, pi = Math.min(PN - 2, px | 0), tx = px - pi, q = pj * PN + pi;
        const pt = (patch[q] * (1 - tx) + patch[q + 1] * tx) * (1 - tz) + (patch[q + PN] * (1 - tx) + patch[q + PN + 1] * tx) * tz;
        const h = H[k];
        const f = smooth(-0.05, 0.25, pt) * smooth(6, 30, h) * smooth(1000, 760, h) * smooth(0.72, 0.86, ny);
        NM[k * 4 + 2] = Math.round(f * 255);
        NM[k * 4 + 3] = Math.round(smooth(2, 8, h) * smooth(0.9, 0.97, ny) * 255); // flat lowland, scaled by town distance below
      }
      if ((j & 127) === 0) yield [0.88 + 0.08 * j / N, 'Planting forests'];
    }
    // towns: clear the forest in the village, farmland fields around it
    const fieldsMul = new Float32Array(N * N), forestMul = new Float32Array(N * N).fill(1);
    for (const t of W.towns) {
      const R = t.r * 6;
      const i0 = Math.max(0, Math.floor((t.x - R + HALF) / CELL)), i1 = Math.min(N - 1, Math.ceil((t.x + R + HALF) / CELL));
      const j0 = Math.max(0, Math.floor((t.z - R + HALF) / CELL)), j1 = Math.min(N - 1, Math.ceil((t.z + R + HALF) / CELL));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const k = j * N + i, d = Math.hypot(-HALF + i * CELL - t.x, -HALF + j * CELL - t.z);
        fieldsMul[k] = Math.max(fieldsMul[k], smooth(t.r * 6, t.r * 1.2, d));
        forestMul[k] = Math.min(forestMul[k], d < t.r * 0.9 ? 0 : smooth(t.r * 0.9, t.r * 3.5, d));
      }
    }
    for (let k = 0; k < N * N; k++) {
      NM[k * 4 + 2] = Math.round(NM[k * 4 + 2] * forestMul[k]);
      NM[k * 4 + 3] = Math.round(NM[k * 4 + 3] * fieldsMul[k]);
    }

    pickSpawn();
    yield [1, 'Ready'];
  };

  // Thermal erosion: material slides from a cell to its steepest lower neighbour (8-connected)
  // whenever the drop exceeds the talus angle. In place, alternating sweep direction.
  function* thermal(H, n, cell, angleDeg, iters) {
    const T = Math.tan(angleDeg * Math.PI / 180) * cell, TD = T * Math.SQRT2;
    const off = [-1, 1, -n, n, -n - 1, -n + 1, n - 1, n + 1];
    for (let it = 0; it < iters; it++) {
      const rev = it & 1;
      for (let jj = 1; jj < n - 1; jj++) {
        const j = rev ? n - 1 - jj : jj;
        for (let ii = 1; ii < n - 1; ii++) {
          const i = rev ? n - 1 - ii : ii;
          const k = j * n + i, h = H[k];
          if (h < 80) continue;
          let best = 0, bk = -1;
          for (let o = 0; o < 8; o++) {
            const d = h - H[k + off[o]] - (o < 4 ? T : TD);
            if (d > best) { best = d; bk = k + off[o]; }
          }
          if (bk >= 0) { const m = best * 0.45; H[k] -= m; H[bk] += m; }
        }
      }
      if ((it & 3) === 0) yield [n > 1100 ? 0.84 : 0.28 + 0.03 * it / iters, 'Shaping slopes'];
    }
  }

  // Droplet hydraulic erosion (after S. Lague). Heights are scaled to "cell units".
  function* erode(H, rnd) {
    const SC = 1 / 48;                 // meters -> erosion units
    const drops = 320000, life = 45;
    const inertia = 0.06, capF = 5, minSlope = 0.01, depS = 0.3, eroS = 0.35, evap = 0.015, grav = 6;
    const R = 2;
    // brush weights
    const bOff = [], bW = [];
    let sw = 0;
    for (let y = -R; y <= R; y++) for (let x = -R; x <= R; x++) {
      const d = Math.hypot(x, y);
      if (d <= R) { const w = 1 - d / R + 0.05; bOff.push([x, y]); bW.push(w); sw += w; }
    }
    for (let k = 0; k < bW.length; k++) bW[k] /= sw;
    for (let k = 0; k < N * N; k++) H[k] *= SC;

    function hg(px, pz) {
      const ix = px | 0, iz = pz | 0, u = px - ix, v = pz - iz, i = iz * N + ix;
      const a = H[i], b = H[i + 1], c = H[i + N], d = H[i + N + 1];
      return [(b - a) * (1 - v) + (d - c) * v, (c - a) * (1 - u) + (d - b) * u, a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v];
    }
    for (let n = 0; n < drops; n++) {
      let px = 2 + rnd() * (N - 5), pz = 2 + rnd() * (N - 5);
      const h0 = H[(pz | 0) * N + (px | 0)] / SC;
      if (h0 <= 4) continue; // skip sea floor
      // spend most droplets on the high ground, where the gullies show
      if (rnd() > 0.2 + 0.8 * Math.min(1, h0 / 700)) continue;
      let dx = 0, dz = 0, speed = 1, water = 1, sed = 0;
      for (let s = 0; s < life; s++) {
        const ix = px | 0, iz = pz | 0, u = px - ix, v = pz - iz;
        const g = hg(px, pz);
        dx = dx * inertia - g[0] * (1 - inertia);
        dz = dz * inertia - g[1] * (1 - inertia);
        const len = Math.hypot(dx, dz);
        if (len < 1e-6) break;
        dx /= len; dz /= len;
        px += dx; pz += dz;
        if (px < 2 || pz < 2 || px >= N - 3 || pz >= N - 3) break;
        const nh = hg(px, pz)[2];
        if (nh < 1 * SC) break; // reached the sea: stop carving
        const dh = nh - g[2];
        const cap = Math.max(-dh, minSlope) * speed * water * capF;
        const i = iz * N + ix;
        if (sed > cap || dh > 0) {
          const amt = dh > 0 ? Math.min(dh, sed) : (sed - cap) * depS;
          sed -= amt;
          H[i] += amt * (1 - u) * (1 - v); H[i + 1] += amt * u * (1 - v);
          H[i + N] += amt * (1 - u) * v; H[i + N + 1] += amt * u * v;
        } else {
          const amt = Math.min((cap - sed) * eroS, -dh);
          for (let k = 0; k < bOff.length; k++) {
            const bx = ix + bOff[k][0], bz = iz + bOff[k][1];
            const bi = bz * N + bx;
            const w = amt * bW[k];
            const take = H[bi] < w ? H[bi] : w;
            H[bi] -= take; sed += take;
          }
        }
        speed = Math.min(6, Math.sqrt(Math.max(0, speed * speed + dh * -grav)));
        water *= 1 - evap;
        if (water < 0.01) break;
      }
      if ((n & 8191) === 0) yield [0.33 + 0.5 * n / drops, 'Eroding valleys'];
    }
    for (let k = 0; k < N * N; k++) H[k] /= SC;
  }

  function pickTowns(rnd) {
    const names = ['Alderbrook', 'Westmere', 'Hollowell', 'Brindle', 'Kestrel Bay', 'Ashby', 'Fernwick', 'Larkspur', 'Millhaven', 'Stonecross',
      'Thornbury', 'Elmstead', 'Wrenford', 'Oakhurst', 'Pinecrest', 'Ravensby', 'Seaholm', 'Dunmore', 'Glenrock', 'Highfold', 'Lowmoor', 'Marbleton'];
    for (let t = 0; t < 6000 && W.towns.length < 22; t++) {
      const x = (rnd() - 0.5) * SIZE * 0.8, z = (rnd() - 0.5) * SIZE * 0.8;
      const h = W.heightAt(x, z);
      if (h < 6 || h > 420) continue;
      // flat enough around?
      let ok = true, hmin = h, hmax = h;
      for (let a = 0; a < 8 && ok; a++) for (let r = 100; r <= 300; r += 100) {
        const hh = W.heightAt(x + Math.cos(a * 0.785) * r, z + Math.sin(a * 0.785) * r);
        hmin = Math.min(hmin, hh); hmax = Math.max(hmax, hh);
        if (hh < 3) ok = false;
      }
      if (!ok || hmax - hmin > 28) continue;
      if (W.towns.some(o => Math.hypot(o.x - x, o.z - z) < 2600)) continue;
      if (W.lakes.some(l => Math.hypot(l.x - x, l.z - z) < l.r * 1.3)) continue;
      W.towns.push({ x, z, r: 160 + rnd() * 140, angle: rnd() * Math.PI, seed: Math.floor(rnd() * 1e9), name: names[W.towns.length % names.length] });
    }
  }

  // Start near the most scenic lake, looking across the water at the mountains
  function pickSpawn() {
    const L = W.lakes[0] || { x: 0, z: 0, r: 500 };
    let best = 0, bestAng = 0;
    for (let a = 0; a < 36; a++) {
      const ang = a / 36 * Math.PI * 2;
      let pk = 0;
      for (let r = 1500; r <= 5000; r += 500) pk = Math.max(pk, W.heightAt(L.x + Math.cos(ang) * r, L.z + Math.sin(ang) * r));
      if (pk > best) { best = pk; bestAng = ang; }
    }
    const back = bestAng + Math.PI, dist = L.r + 3200;
    const x = L.x + Math.cos(back) * dist, z = L.z + Math.sin(back) * dist;
    let ground = 0;
    for (let r = 0; r <= dist; r += 200) ground = Math.max(ground, W.heightAt(L.x + Math.cos(back) * r, L.z + Math.sin(back) * r));
    // heading: the direction of travel, measured from -Z toward +X
    const dirx = Math.cos(bestAng), dirz = Math.sin(bestAng);
    W.spawn = { x, y: Math.max(ground, W.heightAt(x, z)) + 220, z, dirx, dirz };
  }

  root.WORLD = W;
})(typeof window !== 'undefined' ? window : globalThis);
