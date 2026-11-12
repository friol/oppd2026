// Worker code for the fractal explorer.
//
// Everything lives inside one self-contained function: app.js turns its source
// into a Blob URL and starts the workers from it, so the app also works when
// opened straight from the file system (where external worker scripts are blocked).
//
// The same code serves two roles:
//  - "orbit": compute a high-precision reference orbit with BigInt fixed-point math
//  - "tile":  render a tile with perturbation theory, using plain doubles for the
//             per-pixel deltas relative to that reference orbit
function fractalWorkerMain() {
  'use strict';

  const BAIL = 65536;               // squared escape radius (radius 256)
  const LOG_RADIUS = Math.log(256);
  const LN2 = Math.log(2), LN3 = Math.log(3);

  // Formula ids (must match the `fid` of FORMULAS in app.js)
  //   MANDEL   z^2 + c
  //   CUBIC    z^3 + c
  //   SHIP     Burning Ship: x' = x^2 - y^2 + cx, y' = -2|xy| + cy
  //   TRICORN  conj(z)^2 + c
  //   CELTIC   x' = |x^2 - y^2| + cx, y' = 2xy + cy
  //   BUFFALO  x' = |x^2 - y^2| + cx, y' = -2|xy| + cy
  //   MULTI    z^p + c (Multibrot, power p = 4..8)
  //   LAMBDA   c * z * (1 - z), critical point 1/2
  const MANDEL = 0, CUBIC = 1, SHIP = 2, TRICORN = 3, CELTIC = 4, BUFFALO = 5, MULTI = 6, LAMBDA = 7;

  // Current reference orbits: {id, ax, ay, alen, bx, by, blen, cx, cy, power}.
  // (cx, cy) is the reference parameter c as doubles (used by LAMBDA).
  let refs = null;

  self.onmessage = (e) => {
    const m = e.data;
    if (m.type === 'ref') { refs = m; refs.ta = refs.tb = null; refs.blaKey = NaN; }
    else if (m.type === 'tile') renderTile(m);
    else if (m.type === 'orbit') orbitRequest(m);
  };

  // ---------------------------------------------------------------------------
  // High-precision reference orbit (BigInt fixed point, P fractional bits)
  // ---------------------------------------------------------------------------

  // Convert a fixed-point BigInt to a double keeping full relative precision,
  // even when the value is far below 2^-1022 * 2^P or P is larger than 1023.
  function toDouble(x, P) {
    if (x === 0n) return 0;
    const neg = x < 0n;
    if (neg) x = -x;
    const bits = x.toString(16).length * 4;
    const sh = bits > 60 ? bits - 60 : 0;
    let v = Number(x >> BigInt(sh));
    let e = sh - P;
    while (e < -1000) { v *= 2 ** -1000; e += 1000; }
    v *= 2 ** e;
    return neg ? -v : v;
  }

  // Iterate the formula with parameter c starting from (zx, zy). Stores every
  // iterate as doubles. Stops at maxIter or right after the orbit escapes.
  // Always yields >= 2 entries.
  function computeOrbit(formula, power, P, zx, zy, cx, cy, maxIter, onProgress) {
    const Pn = BigInt(P);
    const ox = new Float64Array(maxIter + 1);
    const oy = new Float64Array(maxIter + 1);
    const fast = P <= 960;
    const inv = 2 ** -P;
    let x = zx, y = zy, i = 0, escaped = false;
    for (;;) {
      const fx = fast ? Number(x) * inv : toDouble(x, P);
      const fy = fast ? Number(y) * inv : toDouble(y, P);
      ox[i] = fx;
      oy[i] = fy;
      if (i >= 1 && fx * fx + fy * fy > BAIL) { escaped = true; break; }
      if (i >= maxIter) break;

      const x2 = (x * x) >> Pn;
      const y2 = (y * y) >> Pn;
      if (formula === CUBIC) {
        const nx = ((x * (x2 - 3n * y2)) >> Pn) + cx;
        y = ((y * (3n * x2 - y2)) >> Pn) + cy;
        x = nx;
      } else if (formula === MULTI) {
        let px = x, py = y;
        for (let k = 1; k < power; k++) {
          const t = (px * x - py * y) >> Pn;
          py = (px * y + py * x) >> Pn;
          px = t;
        }
        x = px + cx;
        y = py + cy;
      } else if (formula === LAMBDA) {
        const wx = x - (x2 - y2);                    // w = z - z^2
        const wy = y - (((x * y) >> Pn) << 1n);
        x = (cx * wx - cy * wy) >> Pn;               // z' = c * w
        y = (cx * wy + cy * wx) >> Pn;
      } else {
        let xy2 = ((x * y) >> Pn) << 1n;
        if (formula === SHIP || formula === BUFFALO) xy2 = xy2 < 0n ? xy2 : -xy2;   // -2|xy|
        else if (formula === TRICORN) xy2 = -xy2;
        let re = x2 - y2;
        if ((formula === CELTIC || formula === BUFFALO) && re < 0n) re = -re;      // |x^2 - y^2|
        x = re + cx;
        y = xy2 + cy;
      }
      i++;
      if ((i & 1023) === 0) onProgress(i);
    }
    const len = i + 1;
    return { x: ox.slice(0, len), y: oy.slice(0, len), len, escaped };
  }

  function orbitRequest(m) {
    const total = m.julia ? 2 * m.maxIter : m.maxIter;
    const progress = (base) => (i) =>
      self.postMessage({ type: 'orbitProgress', reqId: m.reqId, frac: (base + i) / total });

    // Orbit B starts from the critical point (0, or 1/2 for LAMBDA): it is the
    // rebase target.
    const crit = m.formula === LAMBDA ? 1n << BigInt(m.P - 1) : 0n;
    const b = computeOrbit(m.formula, m.power, m.P, crit, 0n, m.cre, m.cim, m.maxIter, progress(0));
    // Orbit A is where pixels start. For the parameter plane it is the same orbit;
    // for Julia sets it starts from the view center.
    const a = m.julia
      ? computeOrbit(m.formula, m.power, m.P, m.zre, m.zim, m.cre, m.cim, m.maxIter, progress(m.maxIter))
      : b;
    self.postMessage({
      type: 'orbit', reqId: m.reqId,
      ax: a.x, ay: a.y, alen: a.len, aEsc: a.escaped,
      bx: b.x, by: b.y, blen: b.len, bEsc: b.escaped,
      cx: toDouble(m.cre, m.P), cy: toDouble(m.cim, m.P), power: m.power,
    });
  }

  // ---------------------------------------------------------------------------
  // Perturbation rendering
  // ---------------------------------------------------------------------------

  // |c + d| - |c| computed without cancellation (needed by the Burning Ship).
  function diffabs(c, d) {
    if (c >= 0) return c + d >= 0 ? d : -(2 * c + d);
    return c + d > 0 ? 2 * c + d : -d;
  }

  // ---------------------------------------------------------------------------
  // Bilinear approximation (BLA)
  // ---------------------------------------------------------------------------
  //
  // While the delta d is tiny compared with the reference iterate Z, the d^2 term
  // of the perturbed iteration is below rounding noise and the step is linear:
  //     d' = A*d + B*dc
  // Linear steps compose, so l consecutive steps collapse into a single (A, B)
  // pair, valid while |d| stays below a radius r. The table holds such pairs for
  // every reference index and every power-of-two length: level k, entry j covers
  // the 2^k steps starting at index m = 1 + j * 2^k. A pixel then jumps over most
  // of its orbit instead of walking it. A and B are real 2x2 matrices, so that the
  // non-analytic formulas (Burning Ship, Tricorn) are covered too.

  // Relative size of the neglected term at the validity radius. Two radii are kept:
  //  - r  (strict, machine precision): after a rebase the delta is the pixel orbit
  //    itself, and what tells neighbouring pixels apart sits in its last bits;
  //  - r1 (loose): before the first rebase the delta is still proportional to the
  //    pixel offset, so a relative error only moves the pixel by a tiny fraction
  //    of that offset. This lets the first, longest stretch be skipped further.
  const BLA_EPS = 2 ** -53, BLA_EPS1 = 1e-7;

  // Largest singular value of a 2x2 matrix (hypot keeps it free of overflow).
  const norm2 = (a, b, c, d) => 0.5 * (Math.hypot(a + d, b - c) + Math.hypot(a - d, b + c));

  // cmax: largest |dc| of any pixel in the view (0 for Julia sets).
  // R: the reference (power and parameter c are read from it).
  function buildBla(X, Y, len, formula, cmax, R) {
    const n0 = len - 2;   // steps m -> m+1 for m = 1 .. len-2
    if (n0 < 16) return null;
    const cnt = [], off = [];
    let total = 0;
    for (let c = n0; c >= 1; c >>= 1) { off.push(total); cnt.push(c); total += c; }
    const T = {
      levels: cnt.length, cnt, off,
      a: new Float64Array(total), b: new Float64Array(total), c: new Float64Array(total), d: new Float64Array(total),
      e: new Float64Array(total), f: new Float64Array(total), g: new Float64Array(total), h: new Float64Array(total),
      r: new Float64Array(total), r1: new Float64Array(total),
    };

    const pw = R.power, CX = R.cx, CY = R.cy;

    // Level 0: single steps. Rows of A: (a, b) and (c, d); B = (e, f; g, h).
    for (let i = 0; i < n0; i++) {
      const x = X[i + 1], y = Y[i + 1];
      const mag = Math.hypot(x, y);
      let r = BLA_EPS * mag, r1 = BLA_EPS1 * mag;
      let fold = Infinity;   // radius beyond which an |...| changes branch
      T.e[i] = 1; T.h[i] = 1;
      if (formula === CUBIC) {
        const u = 3 * (x * x - y * y), v = 6 * x * y;
        T.a[i] = u; T.b[i] = -v; T.c[i] = v; T.d[i] = u;
      } else if (formula === MULTI) {
        // A = p Z^(p-1). The neglected term is ((p-1)/2) |d| / |Z| of the linear one.
        let ux = 1, uy = 0;
        for (let k = 1; k < pw; k++) { const t = ux * x - uy * y; uy = ux * y + uy * x; ux = t; }
        T.a[i] = pw * ux; T.b[i] = -pw * uy; T.c[i] = pw * uy; T.d[i] = pw * ux;
        r *= 2 / (pw - 1);
        r1 *= 2 / (pw - 1);
      } else if (formula === LAMBDA) {
        // d' = C (1 - 2Z) d + W dc, with W = Z - Z^2. Neglected: C d^2 (relative
        // |d| / |1 - 2Z|) and dc * dw (relative |dc| / |C|).
        const ux = 1 - 2 * x, uy = -2 * y;
        const ax = CX * ux - CY * uy, ay = CX * uy + CY * ux;
        T.a[i] = ax; T.b[i] = -ay; T.c[i] = ay; T.d[i] = ax;
        const wx = x - (x * x - y * y), wy = y - 2 * x * y;
        T.e[i] = wx; T.f[i] = -wy; T.g[i] = wy; T.h[i] = wx;
        const um = Math.hypot(ux, uy), cm = Math.hypot(CX, CY);
        r = cmax <= BLA_EPS * cm ? BLA_EPS * um : 0;
        r1 = cmax <= BLA_EPS1 * cm ? BLA_EPS1 * um : 0;
      } else if (formula === TRICORN) {
        T.a[i] = 2 * x; T.b[i] = -2 * y; T.c[i] = -2 * y; T.d[i] = -2 * x;
      } else {
        // z^2 family: MANDEL, SHIP, CELTIC, BUFFALO. The absolute values flip the
        // sign of a row of A; the step stays linear only while the delta does not
        // carry x^2 - y^2 (or xy) across zero.
        const s1 = (formula === CELTIC || formula === BUFFALO) && x * x - y * y < 0 ? -1 : 1;
        const s2 = formula === SHIP || formula === BUFFALO ? (x * y >= 0 ? -1 : 1) : 1;
        T.a[i] = 2 * s1 * x; T.b[i] = -2 * s1 * y; T.c[i] = 2 * s2 * y; T.d[i] = 2 * s2 * x;
        const ax = Math.abs(x), ay = Math.abs(y);
        if (formula === SHIP || formula === BUFFALO) fold = 0.5 * ax * ay / (ax + ay);
        if (formula === CELTIC || formula === BUFFALO) fold = Math.min(fold, 0.25 * Math.abs(x * x - y * y) / (ax + ay));
      }
      if (!(fold >= r)) r = fold > 0 ? fold : 0;
      if (!(fold >= r1)) r1 = fold > 0 ? fold : 0;
      T.r[i] = r;
      T.r1[i] = r1;
    }

    // Higher levels: entry = second half (y) applied after first half (x).
    for (let k = 1; k < T.levels; k++) {
      for (let j = 0; j < cnt[k]; j++) {
        const px = off[k - 1] + 2 * j, py = px + 1, q = off[k] + j;
        const ax = T.a[px], bx = T.b[px], cx = T.c[px], dx = T.d[px];
        const ex = T.e[px], fx = T.f[px], gx = T.g[px], hx = T.h[px];
        const ay = T.a[py], by = T.b[py], cy = T.c[py], dy = T.d[py];
        const a = ay * ax + by * cx, b = ay * bx + by * dx;
        const c = cy * ax + dy * cx, d = cy * bx + dy * dx;
        const e = ay * ex + by * gx + T.e[py], f = ay * fx + by * hx + T.f[py];
        const g = cy * ex + dy * gx + T.g[py], h = cy * fx + dy * hx + T.h[py];
        T.a[q] = a; T.b[q] = b; T.c[q] = c; T.d[q] = d;
        T.e[q] = e; T.f[q] = f; T.g[q] = g; T.h[q] = h;
        // The delta must be inside the first radius, and still inside the second
        // one after the first half has been applied.
        const nb = norm2(ex, fx, gx, hx) * cmax, na = norm2(ax, bx, cx, dx);
        const ok = isFinite(a + b + c + d + e + f + g + h);
        let r = (T.r[py] - nb) / na, r1 = (T.r1[py] - nb) / na;
        if (r > T.r[px]) r = T.r[px];
        if (r1 > T.r1[px]) r1 = T.r1[px];
        T.r[q] = ok && r > 0 ? r : 0;
        T.r1[q] = ok && r1 > 0 ? r1 : 0;
      }
    }
    // Jumps start at level 3 (see iterate). Radii shrink with the level, so a table
    // whose level-3 jumps are never valid is useless (typical of shallow views,
    // where dc is large).
    T.off3 = off[3];
    T.end3 = 8 * cnt[3];   // level-3 jumps start at m = 1 (mod 8) below this index
    let usable = false;
    for (let j = 0; j < cnt[3] && !usable; j++) usable = T.r1[off[3] + j] > 0;
    return usable ? T : null;
  }

  // ---------------------------------------------------------------------------
  // 3D relief: Jacobian of the pixel orbit
  // ---------------------------------------------------------------------------
  //
  // For the relief shading every pixel also tracks J = dz/dp, the 2x2 Jacobian of
  // its orbit with respect to the pixel position p (c in the parameter plane, z0
  // for Julia sets). At escape, u = J^T z is the gradient of log|z| along the
  // screen, i.e. the direction in which the escape-time "landscape" rises; the
  // main thread lights that surface. Real 2x2 matrices cover the non-analytic
  // formulas too. Only the direction of u matters, so J is kept as JK * (true J)
  // and rescaled when it grows: the additive term of each step is scaled by JK.
  // The Jacobian is kept in local variables of iterate(): as closure variables or
  // behind helper calls the per-step update ran some 20x slower.
  let NX = NaN, NY = NaN;   // unit normal of the last pixel (NaN when inside)

  // Df(z) for the formulas without an inline case, left in DF[0..3] = [a b; c d];
  // (cx, cy) is the full parameter c of the pixel (used by LAMBDA only).
  const DF = new Float64Array(4);
  function dfOther(formula, x, y, pw, cx, cy) {
    if (formula === CUBIC) { const u = 3 * (x * x - y * y), v = 6 * x * y; DF[0] = u; DF[1] = -v; DF[2] = v; DF[3] = u; }
    else if (formula === MULTI) {
      let ux = 1, uy = 0;
      for (let k = 1; k < pw; k++) { const t = ux * x - uy * y; uy = ux * y + uy * x; ux = t; }
      DF[0] = pw * ux; DF[1] = -pw * uy; DF[2] = pw * uy; DF[3] = pw * ux;
    } else if (formula === LAMBDA) {
      const ux = 1 - 2 * x, uy = -2 * y;
      const px = cx * ux - cy * uy, py = cx * uy + cy * ux;
      DF[0] = px; DF[1] = -py; DF[2] = py; DF[3] = px;
    } else {
      const s1 = (formula === CELTIC || formula === BUFFALO) && x * x - y * y < 0 ? -1 : 1;
      const s2 = formula === TRICORN ? -1 : formula === SHIP || formula === BUFFALO ? (x * y >= 0 ? -1 : 1) : 1;
      DF[0] = 2 * s1 * x; DF[1] = -2 * s1 * y; DF[2] = 2 * s2 * y; DF[3] = 2 * s2 * x;
    }
  }

  // Iterate one pixel. The pixel orbit is z_n = Z_m + d_n, where Z is the reference
  // orbit and d a small delta held in a double. (dx, dy) is the initial delta,
  // (dcx, dcy) the delta of the parameter c.
  // relief: 0 = none, 1 = parameter plane, 2 = Julia set; when set, the normal of
  // the escape landscape is left in (NX, NY).
  // Returns sqrt(smooth iteration count), or -1 when the point never escapes.
  function iterate(dx, dy, dcx, dcy, formula, maxIter, R, relief) {
    let rx = R.ax, ry = R.ay, last = R.alen - 1, T = R.ta;
    const bx = R.bx, by = R.by, blast = R.blen - 1, tb = R.tb;
    let rad = T !== null ? T.r1 : null;   // radii in use: loose until the first rebase
    let m = 0, n = 0;
    let ad = (dx < 0 ? -dx : dx) + (dy < 0 ? -dy : dy);   // L1 norm of d (>= |d|)
    let tiny = false;   // |d| so small that d^2 is negligible (see below)
    const pw = R.power, CX = R.cx, CY = R.cy;
    const b0x = bx[0], b0y = by[0];   // critical point: start of the rebase orbit
    const lnp = formula === CUBIC ? LN3 : formula === MULTI ? Math.log(pw) : LN2;
    // Relief: J = jk * dz/dp. The parameter plane starts from the critical point,
    // which does not depend on c (J = 0); a Julia orbit starts at the pixel itself
    // (J = identity) and has no additive term (jk = 0).
    let j00 = relief === 2 ? 1 : 0, j01 = 0, j10 = 0, j11 = j00, jk = relief === 1 ? 1 : 0;
    if (relief) NX = NY = NaN;
    while (n < maxIter) {
      // BLA: look for the longest jump that starts here and is still valid.
      // Only jumps of at least 8 steps (level 3) are considered: shorter ones do
      // not pay for themselves, and probing the table at one index out of eight
      // keeps the loop fast where there is nothing to skip.
      let k = 0;
      if (T !== null && (m & 7) === 1 && m < T.end3 && ad < rad[T.off3 + ((m - 1) >> 3)]) {
        let j = (m - 1) >> 3;
        k = 3;
        while ((j & 1) === 0 && k + 1 < T.levels) {
          const j2 = j >> 1;
          if (j2 >= T.cnt[k + 1] || !(ad < rad[T.off[k + 1] + j2])) break;
          k++;
          j = j2;
        }
        if (n + (1 << k) > maxIter) k = 0;   // near the iteration limit: walk
      }
      if (k > 0) {
        const p = T.off[k] + ((m - 1) >> k);
        const nx = T.a[p] * dx + T.b[p] * dy + T.e[p] * dcx + T.f[p] * dcy;
        dy = T.c[p] * dx + T.d[p] * dy + T.g[p] * dcx + T.h[p] * dcy;
        dx = nx;
        if (relief) {   // J <- A J + jk B
          const a = T.a[p], b = T.b[p], c = T.c[p], d = T.d[p];
          const n00 = a * j00 + b * j10, n01 = a * j01 + b * j11;
          const n10 = c * j00 + d * j10, n11 = c * j01 + d * j11;
          j00 = n00 + jk * T.e[p]; j01 = n01 + jk * T.f[p]; j10 = n10 + jk * T.g[p]; j11 = n11 + jk * T.h[p];
        }
        m += 1 << k;
        n += 1 << k;
      } else {
        const X = rx[m], Y = ry[m];
        if (relief) {   // J <- Df(z) J + jk df/dc, z being the full iterate
          const x = X + dx, y = Y + dy;
          let a, b, c, d;
          if (formula === MANDEL) { a = 2 * x; b = -2 * y; c = 2 * y; d = 2 * x; }
          else { dfOther(formula, x, y, pw, CX + dcx, CY + dcy); a = DF[0]; b = DF[1]; c = DF[2]; d = DF[3]; }
          const n00 = a * j00 + b * j10, n01 = a * j01 + b * j11;
          const n10 = c * j00 + d * j10, n11 = c * j01 + d * j11;
          if (formula === LAMBDA) {   // df/dc = w = z - z^2
            const wx = x - (x * x - y * y), wy = y - 2 * x * y;
            j00 = n00 + jk * wx; j01 = n01 - jk * wy; j10 = n10 + jk * wy; j11 = n11 + jk * wx;
          } else {                    // df/dc = identity
            j00 = n00 + jk; j01 = n01; j10 = n10; j11 = n11 + jk;
          }
        }
        // d^2. While the delta is tiny this term is far below the precision of the
        // linear one, and its value would land in the subnormal range, where
        // arithmetic is dramatically slower: skip it.
        let qx = 0, qy = 0;
        if (!tiny) {
          qx = dx * dx - dy * dy;
          qy = 2 * dx * dy;
        }
        let nx, ny;
        if (formula === MANDEL) {
          nx = 2 * (X * dx - Y * dy) + qx + dcx;
          ny = 2 * (X * dy + Y * dx) + qy + dcy;
        } else if (formula === CUBIC) {
          // d' = d * (3Z^2 + 3Z*d + d^2) + dc
          const tx = 3 * (X * X - Y * Y) + 3 * (X * dx - Y * dy) + qx;
          const ty = 6 * X * Y + 3 * (X * dy + Y * dx) + qy;
          nx = dx * tx - dy * ty + dcx;
          ny = dx * ty + dy * tx + dcy;
        } else if (formula === SHIP) {
          nx = 2 * (X * dx - Y * dy) + qx + dcx;
          ny = -2 * diffabs(X * Y, X * dy + Y * dx + 0.5 * qy) + dcy;
        } else if (formula === TRICORN) {
          nx = 2 * (X * dx - Y * dy) + qx + dcx;
          ny = -(2 * (X * dy + Y * dx) + qy) + dcy;
        } else {
          [nx, ny] = stepOther(formula, X, Y, dx, dy, qx, qy, dcx, dcy, pw, CX, CY);
        }
        dx = nx;
        dy = ny;
        m++;
        n++;
      }

      if (relief) {
        // Keep J in the double range: only its direction is used. After a rescale
        // J is ~1 and jk <= 1e-150, so jk is then simply dropped (it would soon
        // reach the subnormal range, where arithmetic is dramatically slower).
        const sj = (j00 < 0 ? -j00 : j00) + (j01 < 0 ? -j01 : j01) + (j10 < 0 ? -j10 : j10) + (j11 < 0 ? -j11 : j11);
        if (sj > 1e150) {
          j00 *= 1e-150; j01 *= 1e-150; j10 *= 1e-150; j11 *= 1e-150;
          jk = jk < 1e-50 ? 0 : jk * 1e-150;
        }
      }

      const zx = rx[m] + dx, zy = ry[m] + dy;
      const mag = zx * zx + zy * zy;
      if (mag > BAIL) {
        const nu = n - Math.log(0.5 * Math.log(mag) / LOG_RADIUS) / lnp;
        if (relief) {
          // u = J^T z, then normalized. The real axis of the plane points right on
          // the screen and the imaginary axis points up.
          const ux = zx * j00 + zy * j10, uy = zx * j01 + zy * j11;
          const ul = Math.hypot(ux, uy);
          if (ul > 0 && isFinite(ul)) { NX = ux / ul; NY = uy / ul; }
        }
        return nu > 0 ? Math.sqrt(nu) : 0;
      }

      // Rebasing: when the pixel orbit gets closer to the critical point than to
      // the reference orbit (or the reference orbit ends), restart from the first
      // iterate of the critical orbit. This removes perturbation glitches with a
      // single reference. L1 norms keep the test free of underflow at any depth.
      // (z itself does not change, so the Jacobian carries on unaffected.)
      ad = (dx < 0 ? -dx : dx) + (dy < 0 ? -dy : dy);
      const ex = zx - b0x, ey = zy - b0y;
      if (m === last || (ex < 0 ? -ex : ex) + (ey < 0 ? -ey : ey) < ad) {
        dx = ex;
        dy = ey;
        ad = (dx < 0 ? -dx : dx) + (dy < 0 ? -dy : dy);
        m = 0;
        rx = bx; ry = by; last = blast; T = tb;
        rad = T !== null ? T.r : null;
        tiny = false;   // Z is exactly 0 at m = 0: there d^2 is the whole result
      } else {
        tiny = ad < 1e-150;
      }
    }
    return -1;
  }

  // One perturbed step for the formulas added later (CELTIC, BUFFALO, MULTI,
  // LAMBDA). Kept out of the main loops so that the classic formulas keep their
  // tight inner loop. Returns the new delta [dx, dy].
  function stepOther(formula, X, Y, dx, dy, qx, qy, dcx, dcy, pw, CX, CY) {
    if (formula === CELTIC) {
      return [
        diffabs(X * X - Y * Y, 2 * (X * dx - Y * dy) + qx) + dcx,
        2 * (X * dy + Y * dx) + qy + dcy,
      ];
    }
    if (formula === BUFFALO) {
      return [
        diffabs(X * X - Y * Y, 2 * (X * dx - Y * dy) + qx) + dcx,
        -2 * diffabs(X * Y, X * dy + Y * dx + 0.5 * qy) + dcy,
      ];
    }
    if (formula === MULTI) {
      // z^p - Z^p = d * S with S = sum_{k<p} z^k Z^(p-1-k), built as
      // S_j = z S_(j-1) + Z^j. No cancellation, whatever the size of d.
      const wx = X + dx, wy = Y + dy;
      let sx = 1, sy = 0, px = 1, py = 0;
      for (let j = 1; j < pw; j++) {
        let t = px * X - py * Y; py = px * Y + py * X; px = t;
        t = sx * wx - sy * wy + px; sy = sx * wy + sy * wx + py; sx = t;
      }
      return [dx * sx - dy * sy + dcx, dx * sy + dy * sx + dcy];
    }
    // LAMBDA: z' = c w with w = z - z^2. With dw = d (1 - 2Z - d):
    //   dz' = C dw + dc (W + dw)
    const ux = 1 - 2 * X - dx, uy = -2 * Y - dy;
    const wx = dx * ux - dy * uy, wy = dx * uy + dy * ux;
    const tx = X - (X * X - Y * Y) + wx, ty = Y - 2 * X * Y + wy;
    return [
      CX * wx - CY * wy + dcx * tx - dcy * ty,
      CX * wy + CY * wx + dcx * ty + dcy * tx,
    ];
  }

  // Plain perturbation loop, without BLA: same contract as iterate(). Used when
  // no jump table is available; kept separate because the lean loop is markedly
  // faster than the general one when there is nothing to skip.
  function iteratePlain(dx, dy, dcx, dcy, formula, maxIter, R) {
    let rx = R.ax, ry = R.ay, last = R.alen - 1;
    const bx = R.bx, by = R.by, blast = R.blen - 1;
    let m = 0;
    let tiny = false;
    const pw = R.power, CX = R.cx, CY = R.cy;
    const b0x = bx[0], b0y = by[0];
    const lnp = formula === CUBIC ? LN3 : formula === MULTI ? Math.log(pw) : LN2;
    for (let n = 1; n <= maxIter; n++) {
      const X = rx[m], Y = ry[m];
      let qx = 0, qy = 0;
      if (!tiny) {
        qx = dx * dx - dy * dy;
        qy = 2 * dx * dy;
      }
      let nx, ny;
      if (formula === MANDEL) {
        nx = 2 * (X * dx - Y * dy) + qx + dcx;
        ny = 2 * (X * dy + Y * dx) + qy + dcy;
      } else if (formula === CUBIC) {
        const tx = 3 * (X * X - Y * Y) + 3 * (X * dx - Y * dy) + qx;
        const ty = 6 * X * Y + 3 * (X * dy + Y * dx) + qy;
        nx = dx * tx - dy * ty + dcx;
        ny = dx * ty + dy * tx + dcy;
      } else if (formula === SHIP) {
        nx = 2 * (X * dx - Y * dy) + qx + dcx;
        ny = -2 * diffabs(X * Y, X * dy + Y * dx + 0.5 * qy) + dcy;
      } else if (formula === TRICORN) {
        nx = 2 * (X * dx - Y * dy) + qx + dcx;
        ny = -(2 * (X * dy + Y * dx) + qy) + dcy;
      } else {
        [nx, ny] = stepOther(formula, X, Y, dx, dy, qx, qy, dcx, dcy, pw, CX, CY);
      }
      dx = nx;
      dy = ny;
      m++;

      const zx = rx[m] + dx, zy = ry[m] + dy;
      const mag = zx * zx + zy * zy;
      if (mag > BAIL) {
        const nu = n - Math.log(0.5 * Math.log(mag) / LOG_RADIUS) / lnp;
        return nu > 0 ? Math.sqrt(nu) : 0;
      }
      const ad = (dx < 0 ? -dx : dx) + (dy < 0 ? -dy : dy);
      const ex = zx - b0x, ey = zy - b0y;
      if (m === last || (ex < 0 ? -ex : ex) + (ey < 0 ? -ey : ey) < ad) {
        dx = ex;
        dy = ey;
        m = 0;
        rx = bx; ry = by; last = blast;
        tiny = false;
      } else {
        tiny = ad < 1e-150;
      }
    }
    return -1;
  }

  function renderTile(t) {
    const { x0, y0, w, h, step, scale, offx, offy, maxIter, formula, julia } = t;
    const cols = Math.ceil(w / step), rows = Math.ceil(h / step);
    const out = new Float32Array(cols * rows).fill(NaN);   // NaN = not computed yet
    // Relief: unit normal per sample, interleaved (x, y); NaN where there is none.
    const relief = t.relief ? (julia ? 2 : 1) : 0;
    const nrm = relief ? new Float32Array(2 * cols * rows).fill(NaN) : null;
    const R = refs;

    // (Re)build the BLA tables when the reference or the extent of the view changes.
    // Without t.cmax the plain perturbation loop is used.
    if (R && R.id === t.refId && R.blaKey !== t.cmax) {
      R.blaKey = t.cmax;
      R.ta = R.tb = null;
      if (t.cmax !== undefined) {
        R.tb = buildBla(R.bx, R.by, R.blen, formula, t.cmax, R);
        R.ta = julia ? buildBla(R.ax, R.ay, R.alen, formula, t.cmax, R) : R.tb;
      }
    }

    // The relief needs the general loop (it tracks the Jacobian).
    const iter = R && (relief || R.ta !== null || R.tb !== null) ? iterate : iteratePlain;

    // Compute a sample once and remember it.
    const sample = (i, j) => {
      const k = j * cols + i;
      let v = out[k];
      if (v !== v) {
        const ox = offx + (x0 + i * step + step * 0.5 - t.W * 0.5) * scale;
        const oy = offy - (y0 + j * step + step * 0.5 - t.H * 0.5) * scale;
        v = julia ? iter(ox, oy, 0, 0, formula, maxIter, R, relief) : iter(0, 0, ox, oy, formula, maxIter, R, relief);
        out[k] = v;
        if (relief && v >= 0) { nrm[2 * k] = NX; nrm[2 * k + 1] = NY; }
      }
      return v;
    };

    // Rectangle checking (Mariani-Silver). Points that never escape are by far the
    // most expensive ones, and the non-escaping set has no holes: when the whole
    // border of a rectangle is inside, so is everything it encloses. So only
    // borders are iterated, and rectangles that are not uniform are split in four.
    const rect = (i0, j0, i1, j1) => {
      let inside = true;
      for (let i = i0; i <= i1; i++) {
        if (sample(i, j0) >= 0) inside = false;
        if (sample(i, j1) >= 0) inside = false;
      }
      for (let j = j0 + 1; j < j1; j++) {
        if (sample(i0, j) >= 0) inside = false;
        if (sample(i1, j) >= 0) inside = false;
      }
      if (i1 - i0 < 2 || j1 - j0 < 2) return;
      if (inside) {
        for (let j = j0 + 1; j < j1; j++) out.fill(-1, j * cols + i0 + 1, j * cols + i1);
      } else if (i1 - i0 <= 8 || j1 - j0 <= 8) {
        for (let j = j0 + 1; j < j1; j++) {
          for (let i = i0 + 1; i < i1; i++) sample(i, j);
        }
      } else {
        const im = (i0 + i1) >> 1, jm = (j0 + j1) >> 1;   // shared edges are memoized
        rect(i0, j0, im, jm);
        rect(im, j0, i1, jm);
        rect(i0, jm, im, j1);
        rect(im, jm, i1, j1);
      }
    };

    if (R && R.id === t.refId) rect(0, 0, cols - 1, rows - 1);
    else out.fill(0);
    self.postMessage({ type: 'tile', jobId: t.jobId, x0, y0, w, h, step, cols, out, nrm },
      nrm ? [out.buffer, nrm.buffer] : [out.buffer]);
  }
}
