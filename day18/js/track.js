// Procedural tracks: closed spline generation, validation and toon scenery.
'use strict';

const SPACING = 2;      // meters between track samples
const BARRIER = 14;     // distance of the side barriers from the asphalt edge

const THEMES = {
  meadow: {
    // early afternoon
    skyTop: 0x2f7ff0, skyHorizon: 0xcfe8f6, fog: 0xbcd6e6, fogNear: 450, fogFar: 2200,
    sun: 0xfff1dc, sunInt: 1.05, sunDir: [-0.45, 0.78, 0.35], hemiSky: 0xd8f0ff, hemiGround: 0x5c8a3a, hemiInt: 0.25,
    grade: { tint: [1.0, 1.0, 0.98], exposure: 0.88, saturation: 1.1 },
    grass: [0x6bcb4f, 0x5bb944], grassFar: 0x7cc65a, shoulder: 0x8a6a45, hillAmp: 16,
    barrier: [0xe8302a, 0xffffff], kerb: [0xe8302a, 0xffffff], mountain: 0x6c9a5e, snowCap: false,
    rock: 0x7d7a6c, water: 0x3aa7e8, props: { round: 380, pine: 260, bush: 260, rock: 90, flower: 0 }, clouds: 26
  },
  desert: {
    // late afternoon, golden hour: low warm sun, long shadows
    skyTop: 0x3463b8, skyHorizon: 0xffbe82, fog: 0xe0a77c, fogNear: 400, fogFar: 2000,
    sun: 0xffb46a, sunInt: 1.15, sunDir: [-0.72, 0.3, 0.45], hemiSky: 0xffd2a8, hemiGround: 0x9a6236, hemiInt: 0.22,
    grade: { tint: [1.05, 0.99, 0.9], exposure: 0.92, saturation: 1.12 },
    grass: [0xe8c27a, 0xdcb06a], grassFar: 0xd9a660, shoulder: 0xb8834a, hillAmp: 20,
    barrier: [0xff8a1e, 0xffffff], kerb: [0xff8a1e, 0xffffff], mountain: 0xc0673c, snowCap: false,
    rock: 0x9a4a2a, water: null, props: { cactus: 300, rock: 260, deadbush: 220, mesa: 26 }, clouds: 10
  },
  snow: {
    // cold clear morning: low pale sun, blue shadows
    skyTop: 0x3f6fd0, skyHorizon: 0xe2e8fa, fog: 0xcdd6ec, fogNear: 400, fogFar: 1900,
    sun: 0xfff2e6, sunInt: 1.0, sunDir: [0.5, 0.38, -0.6], hemiSky: 0xcfdcff, hemiGround: 0x7080a8, hemiInt: 0.3,
    grade: { tint: [0.95, 0.99, 1.06], exposure: 0.8, saturation: 1.0 },
    grass: [0xf4f8ff, 0xdfe8f6], grassFar: 0xe8eefa, shoulder: 0x9aa6bc, hillAmp: 34,
    barrier: [0x2a7bff, 0xffffff], kerb: [0x2a7bff, 0xffffff], mountain: 0x8a96b8, snowCap: true,
    rock: 0x6c7690, water: null, props: { snowpine: 620, rock: 120, snowman: 14, bush: 0 }, clouds: 20
  }
};

const TRACKS = [
  { name: 'Green Valley', theme: 'meadow', seed: 5, pts: 10, radius: 230, stretch: 1.3, wobble: 0.34, elev: 4, width: 20, laps: 3,
    blurb: 'Rolling meadows, lakes and leafy trees. A friendly track to learn drifting.', music: 'muzik/drifting.ai.mp3' },
  { name: 'Canyon Run', theme: 'desert', seed: 23, pts: 12, radius: 270, stretch: 1.15, wobble: 0.42, elev: 13, width: 19, laps: 3,
    blurb: 'Sun-baked sand, cacti and red mesas. Fast sweepers with some sneaky hairpins.' },
  { name: 'Frosty Peaks', theme: 'snow', seed: 61, pts: 12, radius: 300, stretch: 1.2, wobble: 0.45, elev: 20, width: 18, laps: 3,
    blurb: 'Steep climbs and plunging descents between snowy pines. For experts only.' }
];

// ---------------------------------------------------------------- generation

function genTrack(def) {
  const hw = def.width / 2;
  const minRadius = hw + BARRIER + 12;
  const minSep = 2 * (hw + BARRIER) + 18;
  for (let attempt = 0; attempt < 600; attempt++) {
    const rng = RNG(def.seed * 7919 + attempt);
    const n = def.pts, ctrl = [];
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2 + (rng() - 0.5) * (Math.PI * 2 / n) * 0.6;
      const r = def.radius * (1 + def.wobble * (rng() * 2 - 1));
      ctrl.push(new THREE.Vector3(Math.cos(ang) * r * def.stretch, def.elev * (rng() * 2 - 1), Math.sin(ang) * r));
    }
    const curve = new THREE.CatmullRomCurve3(ctrl, true, 'centripetal');
    const len = curve.getLength();
    const N = Math.round(len / SPACING);
    const pts = curve.getSpacedPoints(N);
    pts.length = N;
    const x = new Float32Array(N), y = new Float32Array(N), z = new Float32Array(N);
    for (let i = 0; i < N; i++) { x[i] = pts[i].x; y[i] = pts[i].y; z[i] = pts[i].z; }
    // smooth heights so the road never gets bumpy
    for (let pass = 0; pass < 6; pass++) {
      const c = y.slice();
      for (let i = 0; i < N; i++) {
        let s = 0;
        for (let j = -6; j <= 6; j++) s += c[(i + j + N) % N];
        y[i] = s / 13;
      }
    }
    const tx = new Float32Array(N), tz = new Float32Array(N), ang = new Float32Array(N), k = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = (i + 1) % N, b = (i - 1 + N) % N;
      const dx = x[a] - x[b], dz = z[a] - z[b], l = Math.hypot(dx, dz);
      tx[i] = dx / l; tz[i] = dz / l; ang[i] = Math.atan2(tz[i], tx[i]);
    }
    for (let i = 0; i < N; i++) {
      k[i] = wrapAngle(ang[(i + 2) % N] - ang[(i - 2 + N) % N]) / (4 * SPACING);
    }
    // validation: curvature, slope, self separation
    let ok = true;
    for (let i = 0; i < N && ok; i++) {
      if (Math.abs(k[i]) > 1 / minRadius) ok = false;
      const slope = Math.abs(y[(i + 1) % N] - y[i]) / SPACING;
      if (slope > 0.16) ok = false;
    }
    const sepIdx = Math.ceil((minSep * 2.2) / SPACING);
    for (let i = 0; i < N && ok; i += 2) {
      for (let j = i + sepIdx; j < N; j += 2) {
        const d = Math.min(j - i, N - (j - i));
        if (d < sepIdx) continue;
        const dx = x[i] - x[j], dz = z[i] - z[j];
        if (dx * dx + dz * dz < minSep * minSep) { ok = false; break; }
      }
    }
    // the winding must not be twisted (total turning +-2pi)
    let turn = 0;
    for (let i = 0; i < N; i++) turn += wrapAngle(ang[(i + 1) % N] - ang[i]);
    if (Math.abs(Math.abs(turn) - Math.PI * 2) > 0.5) ok = false;
    if (!ok) continue;
    return finishTrack(def, { N, x, y, z, tx, tz, k });
  }
  throw new Error('Could not generate track ' + def.name);
}

function finishTrack(def, t) {
  const N = t.N;
  // put the start line on the straightest stretch
  const win = 60;
  let best = 0, bestSum = 1e9;
  for (let i = 0; i < N; i++) {
    let s = 0;
    for (let j = 0; j < win; j++) s += Math.abs(t.k[(i + j) % N]);
    if (s < bestSum) { bestSum = s; best = i; }
  }
  const start = (best + 38) % N;
  const rot = arr => { const o = new Float32Array(N); for (let i = 0; i < N; i++) o[i] = arr[(i + start) % N]; return o; };
  const tr = {
    def, N, hw: def.width / 2, length: N * SPACING,
    x: rot(t.x), y: rot(t.y), z: rot(t.z), tx: rot(t.tx), tz: rot(t.tz), k: rot(t.k)
  };
  // smoothed curvature, racing line (inner side of corners) and kerb flags
  const ks = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    let s = 0;
    for (let j = -8; j <= 8; j++) s += tr.k[(i + j + N) % N];
    ks[i] = s / 17;
  }
  tr.ks = ks;
  const raw = new Float32Array(N);
  for (let i = 0; i < N; i++) raw[i] = clamp(ks[i] * 70, -1, 1) * tr.hw * 0.62;
  tr.racing = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    let s = 0;
    // look ahead a bit so the line reaches the apex early
    for (let j = -14; j <= 22; j++) s += raw[(i + j + N) % N];
    tr.racing[i] = s / 37;
  }
  tr.kerb = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (Math.abs(ks[i]) > 1 / 110) for (let j = -7; j <= 7; j++) tr.kerb[(i + j + N) % N] = 1;
  }
  // spatial hash of samples for global nearest queries
  let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9, sumY = 0;
  for (let i = 0; i < N; i++) {
    minX = Math.min(minX, tr.x[i]); maxX = Math.max(maxX, tr.x[i]);
    minZ = Math.min(minZ, tr.z[i]); maxZ = Math.max(maxZ, tr.z[i]);
    sumY += tr.y[i];
  }
  tr.bounds = { minX, maxX, minZ, maxZ };
  tr.meanY = sumY / N;
  tr.cell = 32;
  tr.grid = new Map();
  for (let i = 0; i < N; i++) {
    const key = Math.floor(tr.x[i] / tr.cell) + ',' + Math.floor(tr.z[i] / tr.cell);
    if (!tr.grid.has(key)) tr.grid.set(key, []);
    tr.grid.get(key).push(i);
  }
  // item box rows and boost pads
  const rng = RNG(def.seed * 31 + 7);
  tr.itemRows = [0.13, 0.38, 0.62, 0.86].map(f => Math.floor(f * N));
  tr.pads = [];
  const straight = i => { for (let j = -10; j <= 10; j++) if (Math.abs(tr.ks[(i + j + N) % N]) > 1 / 300) return false; return true; };
  for (let f = 0.24; f < 0.98; f += 0.17) {
    let i = Math.floor(f * N);
    for (let tries = 0; tries < 80 && !straight(i); tries++) i = (i + 3) % N;
    if (straight(i) && tr.itemRows.every(r => Math.abs(r - i) > 25) && i > 40 && i < N - 60 &&
        tr.pads.every(p => Math.abs(p.idx - i) > 60)) {
      tr.pads.push({ idx: i, lat: (rng() * 2 - 1) * tr.hw * 0.5 });
    }
  }
  return tr;
}

// Global nearest sample (via spatial hash); returns {idx, d}
function trackNearest(tr, x, z, maxR) {
  const R = maxR || 160;
  const c = tr.cell, cx = Math.floor(x / c), cz = Math.floor(z / c), rc = Math.ceil(R / c);
  let best = -1, bd = R * R;
  for (let i = -rc; i <= rc; i++) for (let j = -rc; j <= rc; j++) {
    const list = tr.grid.get((cx + i) + ',' + (cz + j));
    if (!list) continue;
    for (const s of list) {
      const dx = tr.x[s] - x, dz = tr.z[s] - z, d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = s; }
    }
  }
  return { idx: best, d: best < 0 ? Infinity : Math.sqrt(bd) };
}
function trackNearestFull(tr, x, z) {
  let best = 0, bd = 1e18;
  for (let i = 0; i < tr.N; i++) {
    const dx = tr.x[i] - x, dz = tr.z[i] - z, d = dx * dx + dz * dz;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}
// Local search around a hint index
function trackLocal(tr, x, z, hint, win) {
  const N = tr.N;
  let best = hint, bd = 1e18;
  for (let j = -win; j <= win; j++) {
    const i = (hint + j + N) % N;
    const dx = tr.x[i] - x, dz = tr.z[i] - z, d = dx * dx + dz * dz;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}
// Projection onto the centerline near sample idx: lateral offset, height, fraction
function trackProject(tr, x, z, idx, out) {
  const N = tr.N;
  let i = idx;
  // choose the segment (i -> i+1) that contains the projection
  const dx0 = x - tr.x[i], dz0 = z - tr.z[i];
  if (dx0 * tr.tx[i] + dz0 * tr.tz[i] < 0) i = (i - 1 + N) % N;
  const j = (i + 1) % N;
  const sx = tr.x[j] - tr.x[i], sz = tr.z[j] - tr.z[i];
  const sl = sx * sx + sz * sz;
  const f = clamp(((x - tr.x[i]) * sx + (z - tr.z[i]) * sz) / sl, 0, 1);
  const cx = tr.x[i] + sx * f, cz = tr.z[i] + sz * f;
  const txx = lerp(tr.tx[i], tr.tx[j], f), tzz = lerp(tr.tz[i], tr.tz[j], f);
  out.i = i; out.f = f;
  out.lat = (x - cx) * (-tzz) + (z - cz) * txx;
  out.h = lerp(tr.y[i], tr.y[j], f);
  out.tx = txx; out.tz = tzz;
  out.slope = (tr.y[j] - tr.y[i]) / SPACING;
  return out;
}

// ---------------------------------------------------------------- terrain height

function makeTerrainFn(tr, theme) {
  const hw = tr.hw, flat = hw + BARRIER + 6, blend = flat + 110;
  const cx = (tr.bounds.minX + tr.bounds.maxX) / 2, cz = (tr.bounds.minZ + tr.bounds.maxZ) / 2;
  const rad = Math.max(tr.bounds.maxX - tr.bounds.minX, tr.bounds.maxZ - tr.bounds.minZ) / 2;
  const seed = tr.def.seed;
  const natural = (x, z) => {
    let h = tr.meanY - 3 + (fbm(x / 230, z / 230, seed, 4) - 0.45) * 2 * theme.hillAmp;
    const dc = Math.hypot(x - cx, z - cz);
    h += smooth(rad + 120, rad + 600, dc) * 70 * (0.6 + fbm(x / 120, z / 120, seed + 5, 3));
    return h;
  };
  const fn = (x, z) => {
    const n = trackNearest(tr, x, z, blend + 10);
    if (n.idx < 0) return { h: natural(x, z), d: Infinity, idx: -1 };
    const th = tr.y[n.idx] - 0.3;
    if (n.d < flat) return { h: th, d: n.d, idx: n.idx };
    return { h: lerp(th, natural(x, z), smooth(flat, blend, n.d)), d: n.d, idx: n.idx };
  };
  fn.center = { x: cx, z: cz, r: rad };
  return fn;
}

// ---------------------------------------------------------------- geometry helpers

// Merge geometries (each with a solid color) into one non-indexed geometry with vertex colors
function mergeColored(parts) {
  const pos = [], nor = [], col = [];
  const c = new THREE.Color();
  for (const p of parts) {
    let g = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone();
    if (p.m) g.applyMatrix4(p.m);
    g.computeVertexNormals();
    c.set(p.color);
    const P = g.attributes.position.array, Nn = g.attributes.normal.array;
    for (let i = 0; i < P.length; i++) { pos.push(P[i]); nor.push(Nn[i]); }
    for (let i = 0; i < P.length / 3; i++) col.push(c.r, c.g, c.b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}
const M4 = (x, y, z, sx, sy, sz, ry, rx, rz) => {
  const m = new THREE.Matrix4();
  m.compose(new THREE.Vector3(x || 0, y || 0, z || 0),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx || 0, ry || 0, rz || 0)),
    new THREE.Vector3(sx || 1, sy || 1, sz || 1));
  return m;
};

function jitterGeo(geo, amt, seed) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = hash2(Math.round(x * 100), Math.round(y * 100) + Math.round(z * 37), seed) - 0.5;
    const m = hash2(Math.round(z * 100), Math.round(x * 100) + Math.round(y * 53), seed + 1) - 0.5;
    p.setXYZ(i, x + n * amt, y + m * amt * 0.6, z + (n - m) * amt * 0.5);
  }
  return g;
}

// Prop library (each one a single vertex-colored geometry, origin at the ground)
function propGeometry(type) {
  const G = THREE;
  switch (type) {
    case 'round': return mergeColored([
      { geo: new G.CylinderGeometry(0.35, 0.55, 3.2, 6), m: M4(0, 1.6, 0), color: 0x7a4a26 },
      { geo: jitterGeo(new G.IcosahedronGeometry(2.7, 0), 0.6, 3), m: M4(0, 4.6, 0, 1, 0.9, 1), color: 0x3fae3a },
      { geo: jitterGeo(new G.IcosahedronGeometry(1.7, 0), 0.4, 4), m: M4(1.2, 5.8, 0.6), color: 0x55c447 }
    ]);
    case 'pine': return mergeColored([
      { geo: new G.CylinderGeometry(0.3, 0.45, 2.2, 6), m: M4(0, 1.1, 0), color: 0x6b4022 },
      { geo: new G.ConeGeometry(2.6, 3.6, 7), m: M4(0, 3.6, 0), color: 0x24834a },
      { geo: new G.ConeGeometry(2.0, 3.2, 7), m: M4(0, 5.6, 0, 1, 1, 1, 0.4), color: 0x2a9655 },
      { geo: new G.ConeGeometry(1.3, 2.8, 7), m: M4(0, 7.5, 0, 1, 1, 1, 0.8), color: 0x31a862 }
    ]);
    case 'snowpine': return mergeColored([
      { geo: new G.CylinderGeometry(0.3, 0.45, 2.2, 6), m: M4(0, 1.1, 0), color: 0x5a3820 },
      { geo: new G.ConeGeometry(2.7, 3.6, 7), m: M4(0, 3.6, 0), color: 0x1f6a48 },
      { geo: new G.ConeGeometry(2.1, 1.2, 7), m: M4(0, 4.85, 0), color: 0xf4f8ff },
      { geo: new G.ConeGeometry(2.0, 3.2, 7), m: M4(0, 5.7, 0, 1, 1, 1, 0.4), color: 0x23784f },
      { geo: new G.ConeGeometry(1.45, 1.0, 7), m: M4(0, 6.85, 0, 1, 1, 1, 0.4), color: 0xf4f8ff },
      { geo: new G.ConeGeometry(1.3, 2.8, 7), m: M4(0, 7.6, 0, 1, 1, 1, 0.8), color: 0x288656 },
      { geo: new G.ConeGeometry(0.75, 1.3, 7), m: M4(0, 8.4, 0, 1, 1, 1, 0.8), color: 0xffffff }
    ]);
    case 'bush': return mergeColored([
      { geo: jitterGeo(new G.IcosahedronGeometry(1.3, 0), 0.3, 9), m: M4(0, 0.7, 0, 1.3, 0.8, 1.1), color: 0x48b23e },
      { geo: jitterGeo(new G.IcosahedronGeometry(0.9, 0), 0.2, 10), m: M4(0.9, 0.6, 0.3), color: 0x5cc64c }
    ]);
    case 'rock': return mergeColored([
      { geo: jitterGeo(new G.DodecahedronGeometry(1.6, 0), 0.7, 12), m: M4(0, 0.6, 0, 1.2, 0.8, 1), color: 0x9a9aa4 }
    ]);
    case 'redrock': return mergeColored([
      { geo: jitterGeo(new G.DodecahedronGeometry(1.8, 0), 0.8, 13), m: M4(0, 0.7, 0, 1.2, 0.8, 1), color: 0xc4673f }
    ]);
    case 'snowrock': return mergeColored([
      { geo: jitterGeo(new G.DodecahedronGeometry(1.7, 0), 0.7, 14), m: M4(0, 0.6, 0, 1.2, 0.8, 1), color: 0x7e869a },
      { geo: jitterGeo(new G.DodecahedronGeometry(1.4, 0), 0.4, 15), m: M4(0, 1.1, 0, 1.15, 0.45, 0.95), color: 0xf6f9ff }
    ]);
    case 'cactus': return mergeColored([
      { geo: new G.CylinderGeometry(0.5, 0.55, 5, 7), m: M4(0, 2.5, 0), color: 0x3f9a4a },
      { geo: new G.SphereGeometry(0.5, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2), m: M4(0, 5, 0), color: 0x3f9a4a },
      { geo: new G.CylinderGeometry(0.32, 0.32, 1.4, 6), m: M4(0.9, 2.2, 0, 1, 1, 1, 0, 0, Math.PI / 2), color: 0x47a852 },
      { geo: new G.CylinderGeometry(0.32, 0.32, 1.8, 6), m: M4(1.55, 3.0, 0), color: 0x47a852 },
      { geo: new G.CylinderGeometry(0.3, 0.3, 1.2, 6), m: M4(-0.8, 3.0, 0, 1, 1, 1, 0, 0, Math.PI / 2), color: 0x47a852 },
      { geo: new G.CylinderGeometry(0.3, 0.3, 1.4, 6), m: M4(-1.3, 3.6, 0), color: 0x47a852 }
    ]);
    case 'deadbush': return mergeColored([
      { geo: jitterGeo(new G.IcosahedronGeometry(0.9, 0), 0.4, 16), m: M4(0, 0.5, 0, 1.3, 0.7, 1.3), color: 0xa27c48 }
    ]);
    case 'mesa': return mergeColored([
      { geo: jitterGeo(new G.CylinderGeometry(20, 26, 14, 8), 2.5, 17), m: M4(0, 7, 0), color: 0xc0623a },
      { geo: jitterGeo(new G.CylinderGeometry(17, 20, 12, 8), 2, 18), m: M4(0, 19, 0, 1, 1, 1, 0.3), color: 0xd98250 },
      { geo: jitterGeo(new G.CylinderGeometry(15, 17, 6, 8), 1.5, 19), m: M4(0, 28, 0, 1, 1, 1, 0.6), color: 0xe89a62 }
    ]);
    case 'snowman': return mergeColored([
      { geo: new G.IcosahedronGeometry(1.2, 1), m: M4(0, 1.1, 0), color: 0xffffff },
      { geo: new G.IcosahedronGeometry(0.85, 1), m: M4(0, 2.75, 0), color: 0xffffff },
      { geo: new G.IcosahedronGeometry(0.6, 1), m: M4(0, 3.95, 0), color: 0xffffff },
      { geo: new G.ConeGeometry(0.13, 0.7, 5), m: M4(0.6, 3.95, 0, 1, 1, 1, 0, 0, -Math.PI / 2), color: 0xff7a1a },
      { geo: new G.CylinderGeometry(0.45, 0.45, 0.6, 8), m: M4(0, 4.6, 0), color: 0x222233 },
      { geo: new G.CylinderGeometry(0.7, 0.7, 0.08, 8), m: M4(0, 4.32, 0), color: 0x222233 }
    ]);
  }
  return null;
}

// ---------------------------------------------------------------- vegetation, wind, detail

// Wind shared by all swaying vegetation. The vertex shader bends a vertex by (height^2 * amp),
// with a phase from the world position of the instance, so neighbours sway out of step.
const WIND = { time: { value: 0 } };
function windMaterial(opts, amp, key) {
  const m = toon(opts);
  m.onBeforeCompile = sh => {
    sh.uniforms.windTime = WIND.time;
    sh.vertexShader = 'uniform float windTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `
      vec3 transformed = vec3(position);
      vec3 ip = vec3(modelMatrix[3]);
      #ifdef USE_INSTANCING
        ip += vec3(instanceMatrix[3]);
      #endif
      float sway = max(position.y, 0.0); sway = sway * sway * ${amp.toFixed(4)};
      float ph = windTime * 1.6 + ip.x * 0.045 + ip.z * 0.037;
      float gust = 0.8 + 0.4 * sin(windTime * 0.35 + ip.x * 0.01);
      transformed.x += (sin(ph) + 0.5 * sin(ph * 2.3 + 1.7)) * sway * gust;
      transformed.z += (cos(ph * 0.8) + 0.4 * sin(ph * 1.9)) * sway * 0.6 * gust;
    `);
  };
  m.customProgramCacheKey = () => 'wind' + amp + (key || '');
  return m;
}

// A tuft of grass: `blades` tapered, slightly bent blades (base colour -> tip colour). Each blade is
// drawn twice with opposite winding (both sides visible) and up-facing normals, so the lighting
// of the two faces matches the ground.
function tuftGeometry(baseHex, tipHex, blades, height, spread, seed) {
  const r = RNG(seed), pos = [], nor = [], col = [];
  const cb = new THREE.Color(baseHex), ct = new THREE.Color(tipHex);
  const push = (p, c) => { pos.push(p[0], p[1], p[2]); nor.push(0, 1, 0); col.push(c.r, c.g, c.b); };
  for (let i = 0; i < blades; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * spread;
    const bx = Math.cos(a) * d, bz = Math.sin(a) * d;
    const f = r() * Math.PI * 2, wx = -Math.sin(f), wz = Math.cos(f);
    const hh = height * (0.55 + r() * 0.6), w = 0.05 + r() * 0.04;
    const la = a + (r() - 0.5) * 1.2, lean = 0.15 + r() * 0.35;
    const lx = Math.cos(la) * lean * hh, lz = Math.sin(la) * lean * hh;
    const tint = 0.85 + r() * 0.3;
    const cB = cb.clone().multiplyScalar(tint), cT = ct.clone().multiplyScalar(tint), cM = cb.clone().lerp(ct, 0.5).multiplyScalar(tint);
    const bl = [bx - wx * w, 0, bz - wz * w], br = [bx + wx * w, 0, bz + wz * w];
    const ml = [bx + lx * 0.35 - wx * w * 0.7, hh * 0.5, bz + lz * 0.35 - wz * w * 0.7];
    const mr = [bx + lx * 0.35 + wx * w * 0.7, hh * 0.5, bz + lz * 0.35 + wz * w * 0.7];
    const tip = [bx + lx, hh, bz + lz];
    const tris = [[bl, cB, br, cB, mr, cM], [bl, cB, mr, cM, ml, cM], [ml, cM, mr, cM, tip, cT]];
    for (const t of tris) {
      push(t[0], t[1]); push(t[2], t[3]); push(t[4], t[5]);     // one side
      push(t[0], t[1]); push(t[4], t[5]); push(t[2], t[3]);     // the other side
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}
function flowerGeometry(headHex, seed) {
  const r = RNG(seed), parts = [];
  for (let i = 0; i < 3; i++) {
    const x = (r() - 0.5) * 0.4, z = (r() - 0.5) * 0.4, h = 0.4 + r() * 0.3;
    parts.push({ geo: new THREE.CylinderGeometry(0.012, 0.016, h, 4), m: M4(x, h / 2, z), color: 0x3a7a30 });
    parts.push({ geo: new THREE.OctahedronGeometry(0.1 + r() * 0.04, 0), m: M4(x, h + 0.02, z, 1, 0.7, 1), color: headHex });
    parts.push({ geo: new THREE.OctahedronGeometry(0.04, 0), m: M4(x, h + 0.06, z), color: 0xffd23a });
  }
  return mergeColored(parts);
}
// Ground cover per theme: [{name, geo, share, wind (sway amplitude, 0 = rigid), scale}]
function groundKinds(theme) {
  if (theme === 'meadow') return [
    { name: 'gA', geo: tuftGeometry(0x2c7a28, 0x86d85a, 6, 0.95, 0.35, 1), share: 0.4, wind: 0.30, scale: 1.0 },
    { name: 'gB', geo: tuftGeometry(0x3a8c2c, 0xb6e86a, 5, 0.7, 0.3, 2), share: 0.42, wind: 0.30, scale: 1.0 },
    { name: 'fW', geo: flowerGeometry(0xffffff, 3), share: 0.06, wind: 0.5, scale: 1.0 },
    { name: 'fY', geo: flowerGeometry(0xffd84a, 4), share: 0.06, wind: 0.5, scale: 1.0 },
    { name: 'fP', geo: flowerGeometry(0xff7ab8, 5), share: 0.06, wind: 0.5, scale: 1.0 }
  ];
  if (theme === 'desert') return [
    { name: 'dA', geo: tuftGeometry(0x8a6a2c, 0xdcc070, 6, 0.9, 0.35, 6), share: 0.5, wind: 0.30, scale: 1.0 },
    { name: 'dB', geo: tuftGeometry(0x7a5a24, 0xc8a85a, 4, 0.6, 0.3, 7), share: 0.3, wind: 0.30, scale: 1.0 },
    { name: 'pb', geo: mergeColored([
      { geo: new THREE.DodecahedronGeometry(0.2, 0), m: M4(0, 0.08, 0, 1.2, 0.6, 1), color: 0xa88a62 },
      { geo: new THREE.DodecahedronGeometry(0.13, 0), m: M4(0.28, 0.05, 0.1, 1, 0.6, 1), color: 0x8a6a48 }]), share: 0.2, wind: 0, scale: 1.3 }
  ];
  return [   // snow: little drifts and a few straws poking out
    { name: 'mA', geo: mergeColored([
      { geo: new THREE.IcosahedronGeometry(0.6, 1), m: M4(0, 0.02, 0, 1.4, 0.32, 1.1), color: 0xf4f8ff },
      { geo: new THREE.IcosahedronGeometry(0.4, 1), m: M4(0.55, 0, 0.2, 1.2, 0.3, 1), color: 0xe6eefb }]), share: 0.55, wind: 0, scale: 0.85 },
    { name: 'sA', geo: tuftGeometry(0x6f5d3a, 0xc2ac6c, 5, 0.8, 0.3, 8), share: 0.4, wind: 0.30, scale: 1.0 }
  ];
}

// Tileable greyscale noise (fine grain + soft blotches): a detail layer for road and terrain
function detailTexture() {
  const S = 256, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d'), img = g.createImageData(S, S);
  // value noise whose lattice wraps every F cells, so the texture tiles exactly
  const tnoise = (x, y, F, seed) => {
    const fx = x * F, fy = y * F, xi = Math.floor(fx), yi = Math.floor(fy), xf = fx - xi, yf = fy - yi;
    const u = xf * xf * (3 - 2 * xf), vv = yf * yf * (3 - 2 * yf);
    const h = (a, b) => hash2(((a % F) + F) % F, ((b % F) + F) % F, seed);
    return (h(xi, yi) * (1 - u) + h(xi + 1, yi) * u) * (1 - vv) + (h(xi, yi + 1) * (1 - u) + h(xi + 1, yi + 1) * u) * vv;
  };
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let v = 0, a = 0.5, F = 4, n = 0;
    for (let o = 0; o < 5; o++) { v += a * tnoise(x / S, y / S, F, 21 + o); n += a; a *= 0.55; F *= 2; }
    const k = Math.max(0, Math.min(255, ((v / n) - 0.5) * 2.4 * 255 + 128));
    const o4 = (y * S + x) * 4;
    img.data[o4] = img.data[o4 + 1] = img.data[o4 + 2] = k; img.data[o4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

// ---------------------------------------------------------------- scene building

function buildTrackScene(tr, scene, renderer) {
  const def = tr.def, th = THEMES[def.theme], N = tr.N, hw = tr.hw;
  const group = new THREE.Group();
  scene.add(group);
  const terrainH = makeTerrainFn(tr, th);
  const anim = [];

  // sky dome: gradient, sun disc with a glow (HDR, it blooms), haze near the horizon,
  // ground colour below (seen only in reflections)
  const sunDir = new THREE.Vector3(...th.sunDir).normalize();
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      top: { value: new THREE.Color(th.skyTop) }, hor: { value: new THREE.Color(th.skyHorizon) },
      ground: { value: new THREE.Color(th.hemiGround).multiplyScalar(0.6) },
      sunDir: { value: sunDir }, sunCol: { value: new THREE.Color(th.sun) }
    },
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 top; uniform vec3 hor; uniform vec3 ground; uniform vec3 sunDir; uniform vec3 sunCol; varying vec3 vP;
      void main(){
        vec3 d = normalize(vP);
        float t = smoothstep(-0.02, 0.5, d.y);
        vec3 c = mix(hor, top, pow(t, 0.8));
        float s = max(dot(d, sunDir), 0.0);
        c += sunCol * (pow(s, 6.0) * 0.35 + pow(s, 64.0) * 0.6);   // glow around the sun
        c += sunCol * smoothstep(0.9993, 0.9997, s) * 30.0;        // the disc
        c = mix(c, ground, smoothstep(0.0, -0.08, d.y));
        gl_FragColor = vec4(c, 1.0);
      }`
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(3200, 48, 24), skyMat);
  sky.renderOrder = -10;
  group.add(sky);
  anim.push((dt, t, cam) => sky.position.copy(cam.position));
  anim.push((dt, t) => { WIND.time.value = t; });
  scene.fog = new THREE.Fog(th.fog, th.fogNear, th.fogFar);
  scene.background = new THREE.Color(th.fog);

  // environment map (image based lighting + reflections) prefiltered from the same sky
  let envTex = null;
  if (renderer) {
    const envScene = new THREE.Scene();
    const envSky = new THREE.Mesh(new THREE.SphereGeometry(100, 48, 24), skyMat.clone());
    envSky.material.uniforms.sunCol.value = new THREE.Color(th.sun).multiplyScalar(0.25);   // softer sun in reflections
    envScene.add(envSky);
    const pm = new THREE.PMREMGenerator(renderer);
    envTex = pm.fromScene(envScene, 0.02, 0.1, 500).texture;
    pm.dispose();
    envSky.geometry.dispose();
    scene.environment = envTex;
  }

  // lights: the sun (shadows), a weak hemisphere fill (most ambient light comes from the env map)
  const hemi = new THREE.HemisphereLight(th.hemiSky, th.hemiGround, th.hemiInt);
  group.add(hemi);
  const sun = new THREE.DirectionalLight(th.sun, th.sunInt);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  const sc = sun.shadow.camera;
  sc.left = -60; sc.right = 60; sc.top = 60; sc.bottom = -60; sc.near = 1; sc.far = 500;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  sun.shadow.radius = 3;
  group.add(sun); group.add(sun.target);

  // ---- road ribbon with sloped shoulders
  const detailTex = detailTexture();
  // asphalt, repeats every 22 m: grain, darker rubbered wheel tracks in both lanes, repaired
  // patches, cracks, oil stains, and lane lines worn by tyres and weather
  const roadTex = canvasTex(512, 512, (g, w, h) => {
    const r = RNG(99);
    g.fillStyle = '#5b5e6b'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 9000; i++) {
      const v = 62 + Math.floor(r() * 52);
      g.fillStyle = `rgb(${v},${v + 2},${v + 12})`;
      g.fillRect(r() * w, r() * h, 1 + (r() < 0.3 ? 1 : 0), 1 + (r() < 0.3 ? 1 : 0));
    }
    // wheel tracks (two lanes, two tracks each): soft darker bands
    for (const cx of [0.205, 0.295, 0.705, 0.795]) {
      const x0 = (cx - 0.035) * w, gr = g.createLinearGradient(x0, 0, x0 + 0.07 * w, 0);
      gr.addColorStop(0, 'rgba(18,18,26,0)'); gr.addColorStop(0.5, 'rgba(18,18,26,0.26)'); gr.addColorStop(1, 'rgba(18,18,26,0)');
      g.fillStyle = gr; g.fillRect(x0, 0, 0.07 * w, h);
    }
    // oil stains on the tracks
    for (let i = 0; i < 5; i++) {
      const x = [0.2, 0.3, 0.7, 0.8][Math.floor(r() * 4)] * w, y = r() * h, rad = 14 + r() * 22;
      const gr = g.createRadialGradient(x, y, 0, x, y, rad);
      gr.addColorStop(0, 'rgba(10,10,14,0.4)'); gr.addColorStop(1, 'rgba(10,10,14,0)');
      g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    // repaired patches: slightly different shade, sealant outline
    for (let i = 0; i < 3; i++) {
      const pw = 24 + r() * 44, ph = 16 + r() * 34, px = 30 + r() * (w - pw - 60), py = 30 + r() * (h - ph - 60);
      const v = 70 + Math.floor(r() * 22);
      g.fillStyle = `rgb(${v},${v + 1},${v + 9})`; g.fillRect(px, py, pw, ph);
      g.strokeStyle = 'rgba(14,14,18,0.3)'; g.lineWidth = 1.5; g.strokeRect(px, py, pw, ph);
      for (let k = 0; k < 260; k++) { g.fillStyle = `rgba(${v + 30},${v + 32},${v + 42},0.5)`; g.fillRect(px + r() * pw, py + r() * ph, 1, 1); }
    }
    // cracks: random walks with a few branches (kept away from the tile border: it must tile)
    const crack = (x, y, ang, len, wd) => {
      g.strokeStyle = 'rgba(14,14,20,0.6)'; g.lineWidth = wd; g.beginPath(); g.moveTo(x, y);
      for (let k = 0; k < len; k++) {
        ang += (r() - 0.5) * 0.9; x += Math.cos(ang) * 5; y += Math.sin(ang) * 5;
        if (x < 24 || x > w - 24 || y < 24 || y > h - 24) break;
        g.lineTo(x, y);
        if (r() < 0.07 && len > 8) { g.stroke(); crack(x, y, ang + (r() < 0.5 ? 1 : -1) * 0.9, len * 0.45, wd * 0.7); g.beginPath(); g.moveTo(x, y); }
      }
      g.stroke();
    };
    for (let i = 0; i < 12; i++) crack(40 + r() * (w - 80), 40 + r() * (h - 80), r() * 6.28, 8 + r() * 22, 1 + r() * 0.8);
    // lane lines + dashed centre line
    g.fillStyle = '#f2f2f2';
    g.fillRect(w * 0.025, 0, w * 0.022, h);
    g.fillRect(w * 0.953, 0, w * 0.022, h);
    g.fillStyle = 'rgba(255,255,255,0.55)';
    g.fillRect(w * 0.494, 0, w * 0.012, h * 0.45);
    // wear: erase flecks of the white lines with asphalt colour
    for (let i = 0; i < 260; i++) {
      const v = 70 + Math.floor(r() * 40);
      g.fillStyle = `rgb(${v},${v + 2},${v + 12})`;
      const side = r();
      const x = side < 0.4 ? w * (0.025 + r() * 0.022) : side < 0.8 ? w * (0.953 + r() * 0.022) : w * (0.494 + r() * 0.012);
      g.fillRect(x, r() * h, 1 + r() * 2, 1 + r() * 3);
    }
  }, true);
  const roadPos = [], roadUV = [], roadIdx = [];
  const shPos = [], shIdx = [];
  for (let i = 0; i <= N; i++) {
    const s = i % N, x = tr.x[s], y = tr.y[s], z = tr.z[s];
    const rx = -tr.tz[s], rz = tr.tx[s];
    roadPos.push(x - rx * hw, y, z - rz * hw, x + rx * hw, y, z + rz * hw);
    roadUV.push(0, i * SPACING / 22, 1, i * SPACING / 22);
    const o = hw + 3;
    shPos.push(x - rx * o, y - 0.6, z - rz * o, x - rx * hw, y - 0.01, z - rz * hw,
      x + rx * hw, y - 0.01, z + rz * hw, x + rx * o, y - 0.6, z + rz * o);
    if (i < N) {
      const a = i * 2;
      roadIdx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      const b = i * 4;
      shIdx.push(b, b + 4, b + 1, b + 1, b + 4, b + 5, b + 2, b + 6, b + 3, b + 3, b + 6, b + 7);
    }
  }
  const roadGeo = new THREE.BufferGeometry();
  roadGeo.setAttribute('position', new THREE.Float32BufferAttribute(roadPos, 3));
  roadGeo.setAttribute('uv', new THREE.Float32BufferAttribute(roadUV, 2));
  roadGeo.setIndex(roadIdx);
  roadGeo.computeVertexNormals();
  // asphalt: rough, the aggregate texture also used as a bump map
  const roadMat = toon({ map: roadTex, bumpMap: roadTex, bumpScale: 0.05, roughness: 0.82 });
  // big blotches of lighter / darker asphalt (hides the 22 m repetition) + close-up grain
  roadMat.onBeforeCompile = sh => {
    sh.uniforms.tDetail = { value: detailTex };
    sh.vertexShader = 'varying vec3 vWP;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = 'uniform sampler2D tDetail; varying vec3 vWP;\n' + sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      float rd1 = texture2D(tDetail, vWP.xz * 0.9).r, rd2 = texture2D(tDetail, vWP.xz * 0.037).r, rd3 = texture2D(tDetail, vWP.xz * 0.011).r;
      float rf = smoothstep(60.0, 8.0, length(vWP - cameraPosition));
      diffuseColor.rgb *= (0.8 + 0.4 * rd2) * (0.9 + 0.2 * rd3) * mix(1.0, 0.78 + 0.44 * rd1, rf);`);
  };
  roadMat.customProgramCacheKey = () => 'road';
  const road = new THREE.Mesh(roadGeo, roadMat);
  road.receiveShadow = true;
  group.add(road);
  const shGeo = new THREE.BufferGeometry();
  shGeo.setAttribute('position', new THREE.Float32BufferAttribute(shPos, 3));
  shGeo.setIndex(shIdx);
  shGeo.computeVertexNormals();
  const shoulder = new THREE.Mesh(shGeo, toon({ color: th.shoulder, side: THREE.DoubleSide }));
  shoulder.receiveShadow = true;
  group.add(shoulder);

  // ---- kerbs on corners
  const kPos = [], kCol = [];
  const ca = new THREE.Color(th.kerb[0]), cb = new THREE.Color(th.kerb[1]);
  for (let i = 0; i < N; i++) {
    if (!tr.kerb[i]) continue;
    const j = (i + 1) % N;
    const c = (i & 1) ? ca : cb;
    for (const side of [-1, 1]) {
      const in0 = hw - 0.4, out0 = hw + 1.6;
      const p = (s, l, up) => [tr.x[s] - tr.tz[s] * l * side, tr.y[s] + up, tr.z[s] + tr.tx[s] * l * side];
      const a = p(i, in0, 0.04), b = p(i, out0, 0.04), cc = p(j, in0, 0.04), d = p(j, out0, 0.04);
      const e = p(i, out0 + 0.5, -0.35), f = p(j, out0 + 0.5, -0.35);
      const quad = (q1, q2, q3, q4) => {
        if (side > 0) kPos.push(...q1, ...q3, ...q2, ...q2, ...q3, ...q4);
        else kPos.push(...q1, ...q2, ...q3, ...q2, ...q4, ...q3);
        for (let n = 0; n < 6; n++) kCol.push(c.r, c.g, c.b);
      };
      quad(a, b, cc, d);
      quad(b, e, d, f);
    }
  }
  if (kPos.length) {
    const kg = new THREE.BufferGeometry();
    kg.setAttribute('position', new THREE.Float32BufferAttribute(kPos, 3));
    kg.setAttribute('color', new THREE.Float32BufferAttribute(kCol, 3));
    kg.computeVertexNormals();
    const kerbs = new THREE.Mesh(kg, toon({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.5 }));
    kerbs.receiveShadow = true;
    group.add(kerbs);
  }

  // ---- start line, grid marks
  const checker = canvasTex(128, 32, (g, w, h) => {
    for (let i = 0; i < 16; i++) for (let j = 0; j < 4; j++) {
      g.fillStyle = (i + j) & 1 ? '#111' : '#fff'; g.fillRect(i * 8, j * 8, 8, 8);
    }
  });
  const decal = (idx, lat, along, width, mat, up) => {
    const geo = new THREE.PlaneGeometry(width, along);
    geo.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(geo, mat);
    const s = (idx + N) % N;
    m.position.set(tr.x[s] - tr.tz[s] * lat, tr.y[s] + (up || 0.03), tr.z[s] + tr.tx[s] * lat);
    m.rotation.y = -Math.atan2(tr.tz[s], tr.tx[s]) + Math.PI / 2;
    m.receiveShadow = true;
    group.add(m);
    return m;
  };
  decal(0, 0, 3, tr.def.width, toon({ map: checker }));
  const white = toon({ color: 0xffffff });
  for (let g = 0; g < 8; g++) {
    const slot = gridSlot(tr, g);
    decal(slot.idx + 2, slot.lat, 0.35, 3.2, white, 0.025);
  }

  // ---- terrain
  const b = tr.bounds, margin = 520;
  const tx0 = b.minX - margin, tz0 = b.minZ - margin;
  const tW = b.maxX - b.minX + margin * 2, tD = b.maxZ - b.minZ + margin * 2;
  const step = 6, nx = Math.ceil(tW / step), nz = Math.ceil(tD / step);
  const tPos = new Float32Array((nx + 1) * (nz + 1) * 3), tCol = new Float32Array((nx + 1) * (nz + 1) * 3);
  const g0 = new THREE.Color(th.grass[0]), g1 = new THREE.Color(th.grass[1]), gf = new THREE.Color(th.grassFar);
  const tmp = new THREE.Color();
  const waterLevel = tr.meanY - 9;
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
    const x = tx0 + i * step, z = tz0 + j * step;
    const r = terrainH(x, z);
    const o = (j * (nx + 1) + i) * 3;
    tPos[o] = x; tPos[o + 1] = r.h; tPos[o + 2] = z;
    const nz2 = fbm(x / 40, z / 40, 3, 3);
    if (r.d < hw + BARRIER + 30 && th.water) {
      // mowed lawn stripes near the track
      const stripe = Math.floor((r.idx * SPACING) / 12) & 1;
      tmp.copy(stripe ? g0 : g1);
    } else {
      tmp.copy(nz2 > 0.5 ? g0 : g1).lerp(gf, smooth(60, 300, r.d));
    }
    if (th.water && r.h < waterLevel + 1.2) tmp.lerp(new THREE.Color(0xd8c48a), 0.8);
    if (th.snowCap && r.h > tr.meanY + 40) tmp.set(0xffffff);
    tCol[o] = tmp.r; tCol[o + 1] = tmp.g; tCol[o + 2] = tmp.b;
  }
  const tIdx = [];
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const a = j * (nx + 1) + i, b2 = a + 1, c = a + nx + 1, d = c + 1;
    tIdx.push(a, c, b2, b2, c, d);
  }
  const tGeo = new THREE.BufferGeometry();
  tGeo.setAttribute('position', new THREE.BufferAttribute(tPos, 3));
  tGeo.setAttribute('color', new THREE.BufferAttribute(tCol, 3));
  tGeo.setIndex(tIdx);
  tGeo.computeVertexNormals();
  // steep slopes show bare rock
  {
    const rockC = new THREE.Color(th.rock), rn = tGeo.attributes.normal.array, c2 = new THREE.Color();
    for (let o = 0; o < tCol.length; o += 3) {
      const k = smooth(0.95, 0.74, rn[o + 1]) * (0.75 + 0.5 * fbm(tPos[o] / 25, tPos[o + 2] / 25, 9, 2));
      if (k <= 0.01) continue;
      c2.setRGB(tCol[o], tCol[o + 1], tCol[o + 2]).lerp(rockC.clone().multiplyScalar(0.75 + 0.5 * noise2(tPos[o] / 9, tPos[o + 2] / 9, 4)), clamp(k, 0, 1));
      tCol[o] = c2.r; tCol[o + 1] = c2.g; tCol[o + 2] = c2.b;
    }
    tGeo.attributes.color.needsUpdate = true;
  }
  const terrainMat = toon({ vertexColors: true, roughness: 1 });
  const detailK = def.theme === 'snow' ? '0.45' : def.theme === 'desert' ? '0.8' : '1.0';
  terrainMat.onBeforeCompile = sh => {
    sh.uniforms.tDetail = { value: detailTex };
    sh.vertexShader = 'varying vec3 vWP;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = 'uniform sampler2D tDetail; varying vec3 vWP;\n' + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      float td1 = texture2D(tDetail, vWP.xz * 0.35).r, td2 = texture2D(tDetail, vWP.xz * 0.045).r, td3 = texture2D(tDetail, vWP.xz * 0.0123).r;
      float tf = smoothstep(130.0, 15.0, length(vWP - cameraPosition));
      diffuseColor.rgb *= mix(1.0, 0.6 + 0.8 * td1, tf * ${detailK}) * (0.8 + 0.4 * td2) * (0.92 + 0.16 * td3);`);
  };
  terrainMat.customProgramCacheKey = () => 'terrain' + detailK;
  const terrain = new THREE.Mesh(tGeo, terrainMat);
  terrain.receiveShadow = true;
  group.add(terrain);

  if (th.water) {
    const wg = new THREE.PlaneGeometry(tW, tD);
    wg.rotateX(-Math.PI / 2);
    // lakes: glossy, reflect the sky through the env map, two scrolling ripple normal maps
    const ripples = waterNormals();
    ripples.repeat.set(tW / 24, tD / 24);
    const water = new THREE.Mesh(wg, new THREE.MeshStandardMaterial({
      color: new THREE.Color(th.water).multiplyScalar(0.35), roughness: 0.06, metalness: 0.0,
      normalMap: ripples, normalScale: new THREE.Vector2(0.35, 0.35), envMapIntensity: 1.4,
      transparent: true, opacity: 0.9
    }));
    water.position.set(tx0 + tW / 2, waterLevel, tz0 + tD / 2);
    water.receiveShadow = true;
    group.add(water);
    anim.push((dt, t) => { ripples.offset.set(t * 0.012, t * 0.007); });
  }

  // ---- side barriers (instanced blocks following the offset lines)
  const barrierPts = [];
  for (const side of [-1, 1]) {
    const off = hw + BARRIER;
    let acc = 0, px = null, pz = null;
    for (let i = 0; i < N; i++) {
      const x = tr.x[i] - tr.tz[i] * off * side, z = tr.z[i] + tr.tx[i] * off * side;
      if (px !== null) acc += Math.hypot(x - px, z - pz);
      px = x; pz = z;
      if (px !== null && (barrierPts.length === 0 || acc >= 4)) {
        acc = 0;
        barrierPts.push({ x, z, y: tr.y[i] - 0.3, a: Math.atan2(tr.tz[i], tr.tx[i]) });
      }
    }
  }
  const bGeo = new THREE.BoxGeometry(3.9, 1.1, 0.7);
  bGeo.translate(0, 0.55, 0);
  const bMesh = new THREE.InstancedMesh(bGeo, toon({ roughness: 0.45 }), barrierPts.length);
  const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc1 = new THREE.Vector3(1, 1, 1);
  const bc0 = new THREE.Color(th.barrier[0]), bc1 = new THREE.Color(th.barrier[1]);
  barrierPts.forEach((p, i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -p.a);
    mtx.compose(v.set(p.x, p.y, p.z), q, sc1);
    bMesh.setMatrixAt(i, mtx);
    bMesh.setColorAt(i, i & 1 ? bc0 : bc1);
  });
  bMesh.castShadow = true; bMesh.receiveShadow = true;
  group.add(bMesh);
  group.add(withOutline(bMesh, 0.06));

  // ---- props scattered around (instanced, outlined)
  const rng = RNG(def.seed * 13 + 1);
  const cx = terrainH.center.x, cz = terrainH.center.z, R = terrainH.center.r;
  const keepOut = hw + BARRIER + 4;
  const placeProps = (type, count, opts) => {
    const geo = propGeometry(type);
    if (!geo || !count) return;
    const list = [];
    let guard = 0;
    while (list.length < count && guard++ < count * 40) {
      let x, z;
      if (opts.far) {
        const a = rng() * Math.PI * 2, d = R + 160 + rng() * 380;
        x = cx + Math.cos(a) * d; z = cz + Math.sin(a) * d;
      } else if (rng() < 0.7) {
        // near the track, so the player actually sees them
        const s = Math.floor(rng() * N), side = rng() < 0.5 ? -1 : 1;
        const off = keepOut + 2 + Math.pow(rng(), 1.6) * 90;
        x = tr.x[s] - tr.tz[s] * off * side; z = tr.z[s] + tr.tx[s] * off * side;
      } else {
        x = cx + (rng() * 2 - 1) * (R + 300); z = cz + (rng() * 2 - 1) * (R + 300);
      }
      const n = trackNearest(tr, x, z, keepOut + (opts.big || 0) + 2);
      if (n.idx >= 0) continue;
      const h = terrainH(x, z).h;
      if (th.water && h < waterLevel + 0.6) continue;
      const s = (opts.scale || 1) * (0.75 + rng() * 0.6);
      list.push({ x, z, y: h, s, r: rng() * Math.PI * 2 });
    }
    const mesh = new THREE.InstancedMesh(geo, opts.sway ? windMaterial({ vertexColors: true }, opts.sway, type) : toon({ vertexColors: true }), list.length);
    const tint = new THREE.Color();
    list.forEach((p, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.r);
      mtx.compose(v.set(p.x, p.y - 0.1, p.z), q, new THREE.Vector3(p.s, p.s * (opts.tall ? 0.85 + rng() * 0.4 : 1), p.s));
      mesh.setMatrixAt(i, mtx);
      const k = 0.88 + rng() * 0.2;
      mesh.setColorAt(i, tint.setRGB(k, k, k));
    });
    mesh.castShadow = !opts.far;
    mesh.receiveShadow = true;
    group.add(mesh);
    group.add(withOutline(mesh, opts.outline || 0.07));
  };
  const P = th.props;
  if (def.theme === 'meadow') {
    placeProps('round', P.round, { tall: true, sway: 0.008 });
    placeProps('pine', P.pine, { tall: true, sway: 0.007 });
    placeProps('bush', P.bush, { sway: 0.03 });
    placeProps('rock', P.rock, {});
  } else if (def.theme === 'desert') {
    placeProps('cactus', P.cactus, { tall: true });
    placeProps('redrock', P.rock, { scale: 1.3 });
    placeProps('deadbush', P.deadbush, { sway: 0.03 });
    placeProps('mesa', P.mesa, { far: true, big: 30, outline: 0.25, scale: 1.4 });
  } else {
    placeProps('snowpine', P.snowpine, { tall: true, sway: 0.006 });
    placeProps('snowrock', P.rock, { scale: 1.2 });
    placeProps('snowman', P.snowman, {});
  }

  // ---- ground cover along the track: grass tufts and flowers / dry grass / snow drifts. Instanced
  // in 120 m chunks (r147 does not cull the instances of one mesh), each chunk with its own
  // bounding sphere, and switched off by distance every frame.
  const coverChunks = [];
  {
    const kinds = groundKinds(def.theme), rg = RNG(def.seed * 29 + 3);
    const mats = kinds.map(k => k.wind ? windMaterial({ vertexColors: true, roughness: 0.95, envMapIntensity: 0.35 }, k.wind, 'g' + k.name) : toon({ vertexColors: true, roughness: 0.9 }));
    const total = kinds.reduce((a, k) => a + k.share, 0);
    const widthA = BARRIER - 4.3, startB = hw + BARRIER + 1.5, widthB = 34, flatR = hw + BARRIER + 6;
    const CH = 60, nCh = Math.ceil(N / CH), dummyQ = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3();
    for (let c = 0; c < nCh; c++) {
      const lists = kinds.map(() => []);
      let sx = 0, sz = 0, sy = 0, cnt = 0;
      for (let s = c * CH; s < Math.min(N, (c + 1) * CH); s++) {
        for (const side of [-1, 1]) {
          // run-off area between the shoulder and the barrier (dense), and beyond the barrier (thinner)
          const nA = Math.floor(0.45 * SPACING * widthA + rg()), nB = Math.floor(0.2 * SPACING * widthB + rg());
          for (let n = 0; n < nA + nB; n++) {
            const inA = n < nA;
            const off = inA ? hw + 5.2 + rg() * (widthA - 1.7) : startB + rg() * widthB;
            if (!inA && rg() > 1 - 0.75 * (off - startB) / widthB) continue;   // thins out with distance
            const f = rg() * SPACING;
            const x = tr.x[s] + tr.tx[s] * f - tr.tz[s] * off * side, z = tr.z[s] + tr.tz[s] * f + tr.tx[s] * off * side;
            if (trackNearest(tr, x, z, hw + 4.6).idx >= 0) continue;          // another stretch of road
            const y = off < flatR ? tr.y[s] - 0.3 : terrainH(x, z).h;
            if (th.water && y < waterLevel + 0.4) continue;
            let pick = rg() * total, ki = 0;
            while (ki < kinds.length - 1 && pick > kinds[ki].share) { pick -= kinds[ki].share; ki++; }
            lists[ki].push({ x, y: y - 0.04, z, s: kinds[ki].scale * (0.8 + rg() * 0.7), r: rg() * Math.PI * 2 });
            sx += x; sy += y; sz += z; cnt++;
          }
        }
      }
      if (!cnt) continue;
      const ox = sx / cnt, oy = sy / cnt, oz = sz / cnt;
      let rad = 5;
      for (const l of lists) for (const p of l) rad = Math.max(rad, Math.hypot(p.x - ox, p.y - oy, p.z - oz));
      const meshes = [];
      kinds.forEach((k, ki) => {
        const l = lists[ki];
        if (!l.length) return;
        const geo = k.geo.clone();
        geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), rad + 2);
        const mesh = new THREE.InstancedMesh(geo, mats[ki], l.length);
        mesh.frustumCulled = true;
        mesh.position.set(ox, oy, oz);
        l.forEach((p, i) => {
          dummyQ.setFromAxisAngle(up, p.r);
          mtx.compose(v.set(p.x - ox, p.y - oy, p.z - oz), dummyQ, one.set(p.s, p.s * (0.85 + (i % 5) * 0.08), p.s));
          mesh.setMatrixAt(i, mtx);
        });
        mesh.receiveShadow = true;
        group.add(mesh);
        meshes.push(mesh);
      });
      coverChunks.push({ x: ox, y: oy, z: oz, rad, meshes });
    }
    anim.push((dt, t, cam) => {
      for (const ch of coverChunks) {
        const vis = Math.hypot(cam.position.x - ch.x, cam.position.y - ch.y, cam.position.z - ch.z) - ch.rad < 230;
        for (const m of ch.meshes) m.visible = vis;
      }
    });
  }

  // ---- distant mountain ring
  const mParts = [];
  const mr = RNG(def.seed + 404);
  for (let i = 0; i < 46; i++) {
    const a = (i / 46) * Math.PI * 2 + mr() * 0.1, d = R + 900 + mr() * 400;
    const hgt = 160 + mr() * 260, rad = 160 + mr() * 160;
    const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
    mParts.push({ geo: jitterGeo(new THREE.ConeGeometry(rad, hgt, 7, 1), 20, i), m: M4(x, tr.meanY + hgt / 2 - 20, z, 1, 1, 1, mr() * 3), color: th.mountain });
    if (th.snowCap || mr() < 0.4) {
      mParts.push({ geo: new THREE.ConeGeometry(rad * 0.36, hgt * 0.36, 7, 1), m: M4(x, tr.meanY + hgt * 0.82 - 20 + 1, z, 1.04, 1, 1.04), color: 0xffffff });
    }
  }
  const mountains = new THREE.Mesh(mergeColored(mParts), toon({ vertexColors: true }));
  group.add(mountains);

  // ---- clouds
  const cParts = [];
  const cr = RNG(def.seed + 77);
  for (let i = 0; i < th.clouds; i++) {
    const a = cr() * Math.PI * 2, d = 200 + cr() * 900;
    const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d, y = tr.meanY + 150 + cr() * 120;
    const n = 3 + Math.floor(cr() * 4);
    for (let k = 0; k < n; k++) {
      const s = 14 + cr() * 16;
      cParts.push({ geo: new THREE.IcosahedronGeometry(s, 1), m: M4(x + (k - n / 2) * 18 + cr() * 8, y + cr() * 8, z + cr() * 14, 1, 0.65, 1), color: 0xffffff });
    }
  }
  const clouds = new THREE.Mesh(mergeColored(cParts), toon({ vertexColors: true, fog: false, emissive: 0x8a8f9a, roughness: 1 }));
  group.add(clouds);
  anim.push(dt => { clouds.position.x += dt * 2.5; });

  // ---- start gantry with banner
  {
    const s = 0, gx = tr.x[s], gz = tr.z[s], gy = tr.y[s];
    const a = Math.atan2(tr.tz[s], tr.tx[s]);
    const gant = new THREE.Group();
    gant.position.set(gx, gy, gz);
    gant.rotation.y = -a;
    const span = hw + 3;
    const pillarG = new THREE.BoxGeometry(1.2, 10, 1.2);
    const pm = toon({ color: 0xdddde8, roughness: 0.4, metalness: 0.6 });
    for (const sd of [-1, 1]) {
      const p = new THREE.Mesh(pillarG, pm);
      p.position.set(0, 5, sd * span);
      p.castShadow = true;
      gant.add(p);
      gant.add(withOutline(p, 0.08));
    }
    const banTex = canvasTex(1024, 128, (g, w, h) => {
      for (let i = 0; i < 64; i++) for (let j = 0; j < 2; j++) { g.fillStyle = (i + j) & 1 ? '#111' : '#fff'; g.fillRect(i * 16, j * 16, 16, 16); g.fillRect(i * 16, h - 32 + j * 16, 16, 16); }
      g.fillStyle = '#e8302a'; g.fillRect(0, 32, w, h - 64);
      g.font = 'italic 900 56px "Arial Black", Impact, sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.lineWidth = 8; g.strokeStyle = '#111'; g.strokeText('KARIO MART', w / 2, h / 2 + 2);
      g.fillStyle = '#ffd23a'; g.fillText('KARIO MART', w / 2, h / 2 + 2);
    });
    // local +x is the driving direction, so the wide faces are +x / -x (material slots 0 and 1)
    const banMat = toon({ map: banTex, roughness: 0.6 });
    const ban = new THREE.Mesh(new THREE.BoxGeometry(1, 3, span * 2 + 1.2), [banMat, banMat, pm, pm, pm, pm]);
    ban.position.set(0, 9.2, 0);
    ban.castShadow = true;
    gant.add(ban);
    gant.add(withOutline(ban, 0.08));
    group.add(gant);
  }

  // ---- grandstands beside the start straight
  {
    const crowdPos = [];
    const standMat = toon({ color: 0x8890a8 });
    for (const sd of [1]) {
      for (let k = -1; k <= 1; k++) {
        const s = (k * 22 + N) % N;
        const off = (hw + BARRIER + 7) * sd;
        const gx = tr.x[s] - tr.tz[s] * off, gz = tr.z[s] + tr.tx[s] * off, gy = tr.y[s] - 0.3;
        const st = new THREE.Group();
        st.position.set(gx, gy, gz);
        st.rotation.y = -Math.atan2(tr.tz[s], tr.tx[s]);
        for (let r = 0; r < 5; r++) {
          const bx = new THREE.Mesh(new THREE.BoxGeometry(36, 1.2 + r * 1.2, 2.2), standMat);
          bx.position.set(0, (1.2 + r * 1.2) / 2, sd * (r * 2.2));
          bx.castShadow = bx.receiveShadow = true;
          st.add(bx);
          for (let c = 0; c < 26; c++) crowdPos.push({ g: st, x: -17 + c * 1.35 + Math.random() * 0.3, y: 1.2 + r * 1.2 + 0.5, z: sd * (r * 2.2) });
        }
        const roof = new THREE.Mesh(new THREE.BoxGeometry(38, 0.6, 13), toon({ color: th.barrier[0] }));
        roof.position.set(0, 10.5, sd * 4.4);
        roof.castShadow = true;
        st.add(roof);
        st.add(withOutline(roof, 0.1));
        group.add(st);
      }
    }
    const crowdGeo = new THREE.BoxGeometry(0.8, 1, 0.6);
    const crowd = new THREE.InstancedMesh(crowdGeo, toon({}), crowdPos.length);
    const cc = new THREE.Color();
    const pal = [0xff4d4d, 0x4da6ff, 0xffd84d, 0x5ee07a, 0xff8ad8, 0xffffff, 0xff9a3c, 0x9a7bff];
    crowdPos.forEach((p, i) => {
      p.g.updateMatrixWorld(true);
      v.set(p.x, p.y, p.z).applyMatrix4(p.g.matrixWorld);
      mtx.compose(v, q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.g.rotation.y), sc1);
      crowd.setMatrixAt(i, mtx);
      crowd.setColorAt(i, cc.set(pal[i % pal.length]));
    });
    group.add(crowd);
    const crowdBase = crowdPos.map((p, i) => { const m = new THREE.Matrix4(); crowd.getMatrixAt(i, m); return m; });
    anim.push((dt, t) => {
      // a cheering crowd: every spectator bounces a little
      for (let i = 0; i < crowdBase.length; i++) {
        mtx.copy(crowdBase[i]);
        mtx.elements[13] += Math.max(0, Math.sin(t * 7 + i * 1.7)) * 0.35;
        crowd.setMatrixAt(i, mtx);
      }
      crowd.instanceMatrix.needsUpdate = true;
    });
  }

  return {
    group, sun, sunDir, terrainH,
    update(dt, t, cam) { for (const f of anim) f(dt, t, cam); },
    dispose() {
      scene.remove(group);
      if (envTex) { envTex.dispose(); scene.environment = null; }
      group.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { if (m.map) m.map.dispose(); m.dispose(); });
      });
    }
  };
}

// Tileable ripple normal map for the water (value noise heights -> normals)
function waterNormals() {
  const S = 128, h = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let v = 0, a = 1, f = 4;
    for (let o = 0; o < 4; o++) {
      // tileable: sample on a torus
      const u = x / S * Math.PI * 2, w = y / S * Math.PI * 2;
      v += a * noise2(Math.cos(u) * f / 2 + 10, Math.sin(u) * f / 2 + Math.cos(w) * f / 2 + Math.sin(w) * f / 3, 7 + o);
      a *= 0.5; f *= 2;
    }
    h[y * S + x] = v;
  }
  return canvasTexNormal(S, h);
}
function canvasTexNormal(S, h) {
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d'), img = g.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = h[y * S + (x + 1) % S] - h[y * S + (x - 1 + S) % S];
    const dy = h[((y + 1) % S) * S + x] - h[((y - 1 + S) % S) * S + x];
    const n = new THREE.Vector3(-dx * 6, -dy * 6, 1).normalize();
    const o = (y * S + x) * 4;
    img.data[o] = (n.x * 0.5 + 0.5) * 255; img.data[o + 1] = (n.y * 0.5 + 0.5) * 255; img.data[o + 2] = (n.z * 0.5 + 0.5) * 255; img.data[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// Starting grid: slot 0 is pole position
function gridSlot(tr, g) {
  const row = Math.floor(g / 2), col = g & 1;
  const idx = -6 - row * 5 - col * 2;
  return { idx: (idx + tr.N * 10) % tr.N, lat: (col ? 1 : -1) * tr.hw * 0.45 };
}
