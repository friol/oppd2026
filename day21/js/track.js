// TRACK: layout, smoothing, frames with heartline banking, zones and train physics.
// Pure math (no three.js) so it also runs in Node for testing (tools/testtrack.js).
(function (G) {
  'use strict';
  const U = G.UTIL || require('./util.js');
  const V = U.v3;

  const GRAV = 9.81;
  const DS = 0.25;              // sample spacing (m)
  const N_CARS = 5;
  const SPACING = 2.8;          // car pitch (m)
  const CR = 0.010;             // rolling resistance coefficient
  const CD = 0.00035;           // aerodynamic drag (1/m)
  const CHAIN = 5.5;            // lift chain speed (m/s)
  const MOTOR = 6.5;            // linear motor acceleration at rest (m/s^2), time trial only
  const VMOTOR = 46;            // speed where the motor gives no more thrust
  const BRAKE = 11;             // player brake deceleration
  const LIMITS = { vmax: 6.0, vmin: -1.0, lat: 2.0 };   // derailment limits (g)

  // Zone codes (per segment, starting at a control point)
  const Z = { free: 0, station: 1, tires: 2, lift: 3, brake: 4, final: 5, loop: 6 };

  function controlPoints() {
    const cp = [];
    const add = (x, y, z, zone) => cp.push({ p: [x, y, z], zone: Z[zone || 'free'] });
    // Station (heading +X)
    add(-48, 1.2, 0, 'station'); add(-34, 1.2, 0, 'station'); add(-20, 1.2, 0, 'tires'); add(-8, 1.3, 0, 'tires');
    // Lift hill (30 degrees)
    add(4, 2.6, 0, 'lift'); add(17, 8.6, 0, 'lift'); add(40, 21.9, 0, 'lift'); add(62, 34.6, 0, 'lift'); add(78, 43.4, 0, 'lift');
    // Crest and first drop
    add(91, 46.8, 0); add(101, 45.2, 0); add(111, 34, 0); add(121, 17, 0); add(132, 5.5, 0);
    // First turn: overbanked right-hander, 180 degrees, rising to 24 m
    const h1 = [2.2, 7, 15, 20, 15, 7, 3];
    for (let k = 0; k <= 6; k++) {
      const f = k * Math.PI / 6;
      add(150 + 33 * Math.sin(f), h1[k], 33 - 33 * Math.cos(f));
    }
    // Airtime hill (heading -X)
    for (let k = 0; k <= 8; k++) {
      const x = 140 - k * 9.5, f = (x - 102) / 38;
      add(x, 2.5 + 7 * (1 + Math.cos(Math.PI * f)) / 2, 66);
    }
    add(56, 2, 66);
    // Vertical loop (clothoid-like curvature profile), drifting 5 m sideways
    const lp = loopPoints(50, 2, 66, 92, 0.03, 5, 15);
    lp.forEach((p, k) => add(p[0], p[1], p[2], k < lp.length - 1 ? 'loop' : 'free'));
    const xe = lp[lp.length - 1][0];
    // Camelback
    for (let k = 0; k <= 8; k++) {
      const x = xe - 10 - k * 10, f = (k - 4) / 4;
      add(x, 2.3 + 9.5 * (1 + Math.cos(Math.PI * f)) / 2 + (k === 8 ? 3 : k === 7 ? 1 : 0), 71);
    }
    // Final helix turn back to the station (right-hander), with trim and final brakes
    const h2 = [7, 11, 14, 15, 13, 8, 4];
    for (let k = 0; k <= 6; k++) {
      const f = k * Math.PI / 6;
      add(-76 - 35.5 * Math.sin(f), h2[k], 35.5 + 35.5 * Math.cos(f), k >= 3 ? (k >= 5 ? 'final' : 'brake') : 'free');
    }
    add(-62, 1.6, 0, 'final');
    return cp;
  }

  // Loop entering at (x0,y0,z0) heading -X. Curvature grows linearly from k0 at the bottom to the top and back.
  function loopPoints(x0, y0, z0, S, k0, shift, n) {
    const c = (2 * Math.PI - k0 * S) * 4 / (S * S);
    const pts = [];
    let x = x0, y = y0, a = Math.PI;
    const steps = 4000, ds = S / steps;
    let next = 0;
    for (let i = 0; i <= steps; i++) {
      const s = i * ds;
      if (i === Math.round(next * steps / n)) {
        next++;
        const t = s / S;
        pts.push([x, y, z0 + shift * t * t * (3 - 2 * t)]);
      }
      const k = k0 + c * (s < S / 2 ? s : S - s);
      a -= k * ds;
      x += Math.cos(a) * ds; y += Math.sin(a) * ds;
    }
    return pts;
  }

  function catmull(p0, p1, p2, p3, t) {
    const t2 = t * t, t3 = t2 * t;
    const out = [0, 0, 0];
    for (let k = 0; k < 3; k++) {
      out[k] = 0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3);
    }
    return out;
  }

  // Resample a closed polyline to uniform arc length. attr[] is carried (nearest).
  function resample(pts, attr) {
    const n = pts.length;
    const cum = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) cum[i + 1] = cum[i] + V.len(V.sub(pts[(i + 1) % n], pts[i]));
    const L = cum[n];
    const N = Math.round(L / DS);
    const ds = L / N;
    const P = [], A = [];
    let j = 0;
    for (let i = 0; i < N; i++) {
      const s = i * ds;
      while (cum[j + 1] < s) j++;
      const t = (s - cum[j]) / (cum[j + 1] - cum[j] || 1);
      const a = pts[j], b = pts[(j + 1) % n];
      P.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
      A.push(t < 0.5 ? attr[j] : attr[(j + 1) % n]);
    }
    return { P, A, L, ds };
  }

  // Circular gaussian blur of an array of vec3 (or numbers)
  function blur(arr, sigma, isVec) {
    const n = arr.length, r = Math.ceil(sigma * 3);
    const w = []; let ws = 0;
    for (let k = -r; k <= r; k++) { const v = Math.exp(-k * k / (2 * sigma * sigma)); w.push(v); ws += v; }
    const out = new Array(n);
    for (let i = 0; i < n; i++) {
      if (isVec) {
        let x = 0, y = 0, z = 0;
        for (let k = -r; k <= r; k++) { const p = arr[(i + k + n) % n], q = w[k + r]; x += p[0] * q; y += p[1] * q; z += p[2] * q; }
        out[i] = [x / ws, y / ws, z / ws];
      } else {
        let x = 0;
        for (let k = -r; k <= r; k++) x += arr[(i + k + n) % n] * w[k + r];
        out[i] = x / ws;
      }
    }
    return out;
  }

  const T = {
    GRAV, DS, N_CARS, SPACING, CHAIN, LIMITS, Z,
    L: 0, N: 0, ds: DS,
  };

  T.build = function () {
    const cp = controlPoints();
    const n = cp.length, SUB = 48;
    const dense = [], dz = [];
    for (let i = 0; i < n; i++) {
      const p0 = cp[(i - 1 + n) % n].p, p1 = cp[i].p, p2 = cp[(i + 1) % n].p, p3 = cp[(i + 2) % n].p;
      for (let j = 0; j < SUB; j++) { dense.push(catmull(p0, p1, p2, p3, j / SUB)); dz.push(cp[i].zone); }
    }
    let r = resample(dense, dz);
    // Smooth positions (curvature continuity), but keep the straight station exactly level
    let P = blur(r.P, 2.6 / r.ds, true);
    P = blur(P, 1.6 / r.ds, true);
    r = resample(P, r.A);
    P = r.P;
    const N = P.length, ds = r.ds, Zn = r.A;
    T.L = r.L; T.N = N; T.ds = ds;
    T.controlPoints = cp;

    // Tangents and curvature vectors
    const Tn = new Array(N), K = new Array(N);
    for (let i = 0; i < N; i++) Tn[i] = V.norm(V.sub(P[(i + 1) % N], P[(i - 1 + N) % N]));
    for (let i = 0; i < N; i++) K[i] = V.scale(V.sub(Tn[(i + 1) % N], Tn[(i - 1 + N) % N]), 1 / (2 * ds));
    const Ks = blur(K, 0.8 / ds, true);

    // Reference up: world-up projected, except inside loops where it is parallel-transported
    const Uref = new Array(N);
    let nrm = [0, 1, 0];
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < N; i++) {
        const t = Tn[i];
        nrm = V.norm(V.sub(nrm, V.scale(t, V.dot(nrm, t))));
        if (Zn[i] !== Z.loop) {
          const up = V.norm(V.sub([0, 1, 0], V.scale(t, t[1])));
          nrm = V.norm(V.add(V.scale(nrm, 0.85), V.scale(up, 0.15)));
        }
        Uref[i] = nrm;
      }
    }

    // Store pre-bank geometry so the ride simulation can run
    T.P = P; T.T = Tn; T.K = Ks; T.zone = Zn;
    T.sStop = findS([-22.5, 1.2, 0]);   // front car stop position in the station

    // Simulate one free ride to get the design speed at each sample
    const vDesign = T.designSpeeds();

    // Heartline banking: tilt so that the felt force points into the seat at design speed
    let bank = new Array(N);
    for (let i = 0; i < N; i++) {
      const t = Tn[i], ur = Uref[i], rr = V.cross(t, ur);
      const v = vDesign[i];
      let f = V.add(V.scale(Ks[i], v * v), [0, GRAV, 0]);
      f = V.sub(f, V.scale(t, V.dot(f, t)));
      const z = Zn[i];
      bank[i] = (z === Z.station || z === Z.lift || z === Z.tires) ? 0
        : Math.atan2(V.dot(f, rr), Math.max(V.dot(f, ur), 0.1 * GRAV));
    }
    bank = blur(bank, 3.0 / ds, false);
    bank = blur(bank, 2.0 / ds, false);

    const Up = new Array(N), Rt = new Array(N);
    const kU = new Float32Array(N), kR = new Float32Array(N), uy = new Float32Array(N), ry = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const b = U.clamp(bank[i], -1.55, 1.55);
      const t = Tn[i], ur = Uref[i], rr = V.cross(t, ur);
      const u = V.norm(V.add(V.scale(ur, Math.cos(b)), V.scale(rr, Math.sin(b))));
      Up[i] = u; Rt[i] = V.cross(t, u);
      kU[i] = V.dot(Ks[i], u); kR[i] = V.dot(Ks[i], Rt[i]); uy[i] = u[1]; ry[i] = Rt[i][1];
    }
    T.U = Up; T.R = Rt; T.bank = bank; T.kU = kU; T.kR = kR; T.uy = uy; T.ry = ry; T.vDesign = vDesign;

    // Max safe speed (derailment limits) and braking-aware speed cap
    const vSafe = new Float32Array(N), vCap = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      let xmax = 60 * 60;
      const lim = (a, b, c) => { if (a > 1e-6) xmax = Math.min(xmax, (c - b) / a); };
      lim(kU[i], uy[i] * GRAV, LIMITS.vmax * GRAV);          // vert <= vmax
      lim(-kU[i], -uy[i] * GRAV, -LIMITS.vmin * GRAV);       // vert >= vmin
      lim(kR[i], ry[i] * GRAV, LIMITS.lat * GRAV);
      lim(-kR[i], -ry[i] * GRAV, LIMITS.lat * GRAV);
      vSafe[i] = Math.sqrt(Math.max(xmax, 0));
    }
    for (let i = 0; i < N; i++) vCap[i] = vSafe[i];
    for (let pass = 0; pass < 3; pass++) {
      for (let i = N - 1; i >= 0; i--) {
        const nx = vCap[(i + 1) % N];
        const dec = Math.max(1, BRAKE * 0.8 + GRAV * Tn[i][1]);
        vCap[i] = Math.min(vSafe[i], Math.sqrt(nx * nx + 2 * dec * ds));
      }
    }
    T.vSafe = vSafe; T.vCap = vCap;
    return T;
  };

  function findS(p) {
    let best = 1e9, bi = 0;
    for (let i = 0; i < T.N; i++) { const d = V.len(V.sub(T.P[i], p)); if (d < best) { best = d; bi = i; } }
    return bi * T.ds;
  }
  T.findS = findS;

  T.wrap = function (s) { s %= T.L; return s < 0 ? s + T.L : s; };
  T.idx = function (s) { return Math.round(T.wrap(s) / T.ds) % T.N; };
  T.zoneAt = function (s) { return T.zone[T.idx(s)]; };
  T.tyAt = function (s) { return T.T[T.idx(s)][1]; };

  // Interpolated frame at arc length s: writes pos, t, u, r arrays in out
  T.frameAt = function (s, out) {
    s = T.wrap(s);
    const f = s / T.ds, i = Math.floor(f) % T.N, j = (i + 1) % T.N, a = f - Math.floor(f);
    out = out || { pos: [0, 0, 0], t: [0, 0, 0], u: [0, 0, 0], r: [0, 0, 0] };
    const lerp3 = (A, B, o) => { for (let k = 0; k < 3; k++) o[k] = A[k] + (B[k] - A[k]) * a; };
    lerp3(T.P[i], T.P[j], out.pos);
    lerp3(T.T[i], T.T[j], out.t); norm(out.t);
    if (T.U) {
      lerp3(T.U[i], T.U[j], out.u);
      // re-orthogonalize
      const d = out.u[0] * out.t[0] + out.u[1] * out.t[1] + out.u[2] * out.t[2];
      for (let k = 0; k < 3; k++) out.u[k] -= out.t[k] * d;
      norm(out.u);
      const c = V.cross(out.t, out.u); out.r[0] = c[0]; out.r[1] = c[1]; out.r[2] = c[2];
    }
    return out;
  };
  function norm(a) { const l = Math.hypot(a[0], a[1], a[2]) || 1; a[0] /= l; a[1] /= l; a[2] /= l; }

  // Felt g-forces at s for speed v: { vert, lat }
  T.gAt = function (s, v) {
    const i = T.idx(s), x = v * v;
    return { vert: (x * T.kU[i] + GRAV * T.uy[i]) / GRAV, lat: (x * T.kR[i] + GRAV * T.ry[i]) / GRAV };
  };

  // Car c (0 = front) center arc length
  T.carS = function (sFront, c) { return sFront - c * SPACING; };
  T.centerS = function (sFront) { return sFront - (N_CARS - 1) * SPACING / 2; };

  // Lowest speed cap over the cars of the train
  T.trainCap = function (sFront, look) {
    let m = 1e9;
    for (let d = -(N_CARS - 1) * SPACING; d <= (look || 0); d += 1) m = Math.min(m, T.vCap[T.idx(sFront + d)]);
    return m;
  };

  T.newState = function (mode) {
    return { s: T.sStop, v: 0, mode: mode || 'ride', auto: mode !== 'game', dispatched: false, hold: 0, dwell: 7, dist: 0, prevZone: Z.station, brakeOn: 0, motorOn: 0 };
  };

  // Advance the train physics. ctl = { throttle: 0..1, brake: 0..1 }
  T.step = function (st, dt, ctl) {
    let slope = 0;
    for (let c = 0; c < N_CARS; c++) slope += T.tyAt(st.s - c * SPACING);
    slope /= N_CARS;
    let v = st.v;
    let a = -GRAV * slope - Math.sign(v) * (CR * GRAV + CD * v * v);
    const zone = T.zoneAt(T.centerS(st.s));
    if (st.prevZone === Z.station && zone !== Z.station) st.dispatched = false;
    st.prevZone = zone;
    st.brakeOn = 0; st.motorOn = 0;
    const auto = st.auto;

    if (zone === Z.lift) {
      if (v < CHAIN + 0.05) a = U.clamp((CHAIN - v) * 3, -1, 3);
    } else if (auto) {
      if (zone === Z.station) {
        if (!st.dispatched) {
          let d = T.wrap(T.sStop - st.s); if (d > T.L / 2) d -= T.L;
          const vt = d > 0 ? Math.min(3.5, Math.sqrt(2 * 1.2 * d)) : 0;
          a = U.clamp((vt - v) * 3, -5, 3);
          st.brakeOn = v > vt + 0.2 ? 1 : 0;
          if (d < 0.06 && d > -2 && Math.abs(v) < 0.2) {
            v = 0; a = 0; st.s = T.sStop; st.hold += dt;
            if (st.hold > st.dwell && st.mode === 'ride') { st.dispatched = true; st.hold = 0; }
          }
        } else a = U.clamp((3.5 - v) * 1.5, -2, 2);
      } else if (zone === Z.tires) {
        a = U.clamp((4.5 - v) * 2, -3, 3);
      } else if (zone === Z.brake) {
        if (v > 10) { a -= 5; st.brakeOn = 1; }
      } else if (zone === Z.final) {
        if (v > 4) { a -= 6; st.brakeOn = 1; } else if (v < 3) a = Math.max(a, 1.5);
      }
    }
    if (!auto && ctl) {
      if (ctl.throttle > 0) { const m = MOTOR * Math.max(0, 1 - v / VMOTOR) * ctl.throttle; a += m; st.motorOn = m / MOTOR; }
      if (ctl.brake > 0 && v > 0) {
        a -= BRAKE * ctl.brake; st.brakeOn = ctl.brake;
        if (v + a * dt < 0) { v = 0; a = 0; }
      }
    }
    v += a * dt;
    st.v = v;
    st.acc = a;
    st.s = T.wrap(st.s + v * dt);
    st.dist += v * dt;
    return st;
  };

  // One full automatic lap from dispatch; returns speed at each sample (as the train center passes)
  T.designSpeeds = function () {
    const st = T.newState('ride');
    st.hold = st.dwell + 1;
    const N = T.N, vd = new Float32Array(N).fill(-1);
    const dt = 1 / 120;
    let t = 0;
    let lastI = T.idx(T.centerS(st.s));
    while (st.dist < T.L + 5 && t < 600) {
      T.step(st, dt, null);
      t += dt;
      const i = T.idx(T.centerS(st.s));
      // fill all samples crossed this step
      const dk = (i - lastI + N) % N;
      if (dk < N / 2) { let k = lastI; while (k !== i) { k = (k + 1) % N; vd[k] = Math.max(0, st.v); } }
      lastI = i;
    }
    for (let i = 0; i < N; i++) if (vd[i] < 0) vd[i] = 3;
    T.rideTime = t;
    return blur(Array.from(vd), 2 / T.ds, false);
  };

  G.TRACK = T;
  if (typeof module !== 'undefined') module.exports = T;
})(typeof window !== 'undefined' ? window : globalThis);
