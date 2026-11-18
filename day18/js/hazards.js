// Track hazards and jump ramps.
//   Frosty Peaks: ice patches (little grip, the car slides)
//   Canyon Run:   sand patches (the car slows down) and rockslides in the canyon (boulders fall on the road)
//   every track:  jump ramps (a jump with a boost in the air)
// planHazards() decides where they go (static, part of the track), buildHazardMeshes() draws the static
// ones, surfaceAt() / rampState() are asked by the cars, Hazards is the runtime part (the boulders) and
// HazardSfx the synthesized sounds (they go through the same reverb bus as the engine).
'use strict';

// ---------------------------------------------------------------- planning

function planHazards(tr, def) {
  const N = tr.N, cfg = def.hazards || {};
  tr.ice = []; tr.sand = []; tr.ramps = []; tr.slides = [];
  const rng = RNG(def.seed * 53 + 11);
  // samples that are already taken: start straight and grid, item rows, boost pads, canyon / tunnel, arches
  const used = new Uint8Array(N);
  const mod = i => ((i % N) + N) % N;
  const mark = (a, b) => { for (let i = a; i <= b; i++) used[mod(i)] = 1; };
  mark(N - 50, N - 1); mark(0, 50);
  for (const r of tr.itemRows) mark(r - 18, r + 18);
  for (const p of tr.pads) mark(p.idx - 14, p.idx + 14);
  if (tr.canyon) mark(tr.canyon.a - 24, tr.canyon.b + 12);
  if (tr.tunnel) mark(tr.tunnel.a - 24, tr.tunnel.b + 12);
  for (const a of tr.arches) mark(a - 20, a + 20);
  const free = (a, b) => { for (let i = a; i <= b; i++) if (used[mod(i)]) return false; return true; };
  const bend = (a, b) => { let m = 0; for (let i = a; i <= b; i++) m = Math.max(m, Math.abs(tr.ks[mod(i)])); return m; };
  // the k-th of n hazards of a kind goes near k/n of the lap, on the nearest valid spot
  const place = (k, n, len, maxBend, ahead) => {
    const target = Math.floor(((k + 0.25 + rng() * 0.5) / n) * N);
    for (let d = 0; d < N / 2; d += 2) {
      for (const s of d ? [1, -1] : [1]) {
        const a = mod(target + s * d);
        if (a < 90 || a + len + ahead > N - 55) continue;     // not right after the start
        if (!free(a - 4, a + len + ahead + 4) || bend(a, a + len + ahead) > maxBend) continue;
        return a;
      }
    }
    return -1;
  };
  const hw = tr.hw;
  const patches = (list, count, minLen, maxLen) => {
    for (let k = 0; k < count; k++) {
      const len = minLen + Math.floor(rng() * (maxLen - minLen));
      const a = place(k, count, len, 1 / 70, 6);
      if (a < 0) continue;
      let l0 = -hw, l1 = hw;                       // every other patch covers only a part of the road
      if (k % 2) { const w = 0.55 + rng() * 0.15, side = rng() < 0.5 ? -1 : 1; if (side < 0) l1 = -hw + 2 * hw * w; else l0 = hw - 2 * hw * w; }
      list.push({ a, b: a + len, l0, l1, seed: k * 7 + 3 });
      mark(a - 10, a + len + 10);
    }
  };
  // jump ramps: on a straight, with a long straight after them to land on
  const nr = cfg.ramps || 0;
  for (let k = 0; k < nr; k++) {
    const len = 6, ahead = 40;
    let a = place(k, nr, len, 1 / 260, ahead);
    if (a < 0) a = place(k, nr, len, 1 / 200, ahead);       // not straight enough anywhere: a gentle bend will do
    if (a < 0) continue;
    tr.ramps.push({ a, len, lat: (rng() * 2 - 1) * hw * 0.3, w: 8.5, h: 1.5 });
    mark(a - 12, a + len + ahead + 8);
  }
  patches(tr.ice, cfg.ice || 0, 18, 30);
  patches(tr.sand, cfg.sand || 0, 16, 26);
  // rockslide sites inside the canyon (the walls are there), one side after the other
  if (cfg.slides && tr.canyon) {
    const c = tr.canyon, core0 = c.a + c.ramp + 12, core1 = c.b - c.ramp - 4;
    for (let k = 0; k < cfg.slides; k++) tr.slides.push({ idx: Math.round(core0 + (k + 0.5) / cfg.slides * (core1 - core0)), side: k % 2 ? 1 : -1 });
  }
}

// ---------------------------------------------------------------- queries used by the cars

// How much of the surface under (segment i, lateral offset lat) is ice / sand (0..1, soft edges)
const _surf = { ice: 0, sand: 0 };
function surfaceAt(tr, i, lat, out) {
  out = out || _surf;
  out.ice = 0; out.sand = 0;
  for (const p of tr.ice) if (i >= p.a && i <= p.b) out.ice = Math.max(out.ice, smooth(p.l0 - 0.6, p.l0 + 1.0, lat) * smooth(p.l1 + 0.6, p.l1 - 1.0, lat));
  for (const p of tr.sand) if (i >= p.a && i <= p.b) out.sand = Math.max(out.sand, smooth(p.l0 - 0.6, p.l0 + 1.0, lat) * smooth(p.l1 + 0.6, p.l1 - 1.0, lat));
  return out;
}
// Ramp under a car: height of the surface, slope, position along it (in samples). The sides are
// chamfered (0.8 m), the far end is a vertical drop (that is where the car takes off).
const _ramp = { h: 0, pitch: 0, s: -1, r: null };
function rampState(tr, seg, out) {
  out = out || _ramp;
  out.h = 0; out.pitch = 0; out.s = -1; out.r = null;
  for (const r of tr.ramps) {
    const s = seg.i + seg.f - r.a;
    if (s < 0 || s > r.len) continue;
    const dl = Math.abs(seg.lat - r.lat), half = r.w / 2;
    if (dl > half) continue;
    const lf = clamp((half - dl) / 0.8, 0, 1);
    out.h = r.h * (s / r.len) * lf; out.s = s; out.r = r;
    out.pitch = Math.atan2(r.h, r.len * SPACING) * lf;
    break;
  }
  return out;
}
// A point of the track: fractional sample fi, lateral offset lat -> world x, z and the road height
function trackPoint(tr, fi, lat) {
  const N = tr.N, fl = Math.floor(fi), i0 = ((fl % N) + N) % N, i1 = (i0 + 1) % N, f = fi - fl;
  return { x: lerp(tr.x[i0], tr.x[i1], f) - tr.tz[i0] * lat, z: lerp(tr.z[i0], tr.z[i1], f) + tr.tx[i0] * lat, y: lerp(tr.y[i0], tr.y[i1], f) };
}

// ---------------------------------------------------------------- the static meshes

// A ribbon along the road between lateral offsets l0 and l1 for samples a..b, a little above the
// asphalt. Colour alpha is 0 on the two edge columns and at both ends (soft, irregular edges).
function patchGeometry(tr, a, b, l0, l1, up, seed, tile) {
  const inner = 5, cols = inner + 2, n = b - a + 1;
  const pos = [], uv = [], col = [], idx = [];
  for (let s = 0; s < n; s++) {
    const i = a + s;
    const fl = smooth(0, 3, s) * smooth(n - 1, n - 4, s);
    const w0 = l0 - 0.9 + (noise2(i * 0.35, seed, 3) - 0.5) * 1.6, w1 = l1 + 0.9 + (noise2(i * 0.35 + 50, seed, 4) - 0.5) * 1.6;
    for (let c = 0; c < cols; c++) {
      const lat = c === 0 ? w0 : c === cols - 1 ? w1 : lerp(w0 + 0.9, w1 - 0.9, (c - 1) / (inner - 1));
      pos.push(tr.x[i] - tr.tz[i] * lat, tr.y[i] + up, tr.z[i] + tr.tx[i] * lat);
      uv.push(lat / tile, i * SPACING / tile);
      const al = (c === 0 || c === cols - 1) ? 0 : fl * (0.88 + 0.12 * noise2(i * 0.2 + c * 3, seed, 9));
      col.push(1, 1, 1, al);
    }
  }
  for (let s = 0; s < n - 1; s++) for (let c = 0; c < cols - 1; c++) {
    const p = s * cols + c;
    idx.push(p, p + cols, p + 1, p + 1, p + cols, p + cols + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function iceTexture() {
  return canvasTex(256, 256, (g, w, h) => {
    const r = RNG(8);
    g.fillStyle = '#6aaee0'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 40; i++) {                                    // soft clouds of lighter / deeper blue ice
      const x = r() * w, y = r() * h, rad = 20 + r() * 50, gr = g.createRadialGradient(x, y, 0, x, y, rad);
      gr.addColorStop(0, r() < 0.5 ? 'rgba(235,248,255,0.55)' : 'rgba(40,110,190,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    g.lineCap = 'round';
    for (let k = 0; k < 14; k++) {                                    // cracks
      let x = 20 + r() * (w - 40), y = 20 + r() * (h - 40), a = r() * 6.28;
      g.strokeStyle = r() < 0.6 ? 'rgba(255,255,255,0.8)' : 'rgba(70,130,200,0.55)'; g.lineWidth = 1 + r() * 1.2;
      g.beginPath(); g.moveTo(x, y);
      for (let s = 0; s < 10; s++) { a += (r() - 0.5) * 1.1; x += Math.cos(a) * 9; y += Math.sin(a) * 9; if (x < 8 || x > w - 8 || y < 8 || y > h - 8) break; g.lineTo(x, y); }
      g.stroke();
    }
    for (let i = 0; i < 50; i++) { g.fillStyle = 'rgba(255,255,255,0.6)'; g.beginPath(); g.arc(r() * w, r() * h, 0.8 + r() * 1.8, 0, 6.28); g.fill(); }
  }, true);
}
function sandTexture() {
  return canvasTex(256, 256, (g, w, h) => {
    const r = RNG(12);
    g.fillStyle = '#c99a52'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) { const v = r(); g.fillStyle = v < 0.5 ? 'rgba(255,230,160,0.35)' : 'rgba(120,80,30,0.3)'; g.fillRect(r() * w, r() * h, 1 + (r() < 0.2 ? 1 : 0), 1); }
    g.lineWidth = 3;                                                   // wind ripples
    for (let k = 0; k < 14; k++) {
      const y0 = (k + 0.5) * h / 14;
      g.strokeStyle = k % 2 ? 'rgba(255,232,160,0.7)' : 'rgba(110,70,25,0.55)';
      g.beginPath();
      for (let x = 0; x <= w; x += 8) { const y = y0 + Math.sin(x * 0.05 + k * 1.7) * 5 + Math.sin(x * 0.13 + k) * 2; if (x) g.lineTo(x, y); else g.moveTo(x, y); }
      g.stroke();
    }
  }, true);
}
function chevronTexture() {
  return canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#ff7a1a'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffe23a';
    g.beginPath(); g.moveTo(64, 14); g.lineTo(122, 70); g.lineTo(122, 106); g.lineTo(64, 52); g.lineTo(6, 106); g.lineTo(6, 70); g.closePath(); g.fill();
    g.strokeStyle = '#7a2a00'; g.lineWidth = 3; g.stroke();
  }, true);
}
// Warning sign (triangle) with a symbol: 'ice' | 'sand' | 'rocks'
function signTexture(kind) {
  return canvasTex(256, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.beginPath(); g.moveTo(128, 14); g.lineTo(244, 224); g.lineTo(12, 224); g.closePath();
    g.fillStyle = '#ffd23a'; g.fill(); g.lineWidth = 14; g.strokeStyle = '#e8302a'; g.lineJoin = 'round'; g.stroke();
    g.strokeStyle = '#1a1030'; g.fillStyle = '#1a1030'; g.lineWidth = 7; g.lineCap = 'round';
    if (kind === 'ice') {
      g.translate(128, 150);
      for (let k = 0; k < 3; k++) { g.rotate(Math.PI / 3); g.beginPath(); g.moveTo(0, -46); g.lineTo(0, 46); g.stroke(); g.beginPath(); g.moveTo(-13, -30); g.lineTo(0, -40); g.lineTo(13, -30); g.stroke(); g.beginPath(); g.moveTo(-13, 30); g.lineTo(0, 40); g.lineTo(13, 30); g.stroke(); }
    } else if (kind === 'sand') {
      for (let k = 0; k < 3; k++) { g.beginPath(); for (let x = 60; x <= 196; x += 8) { const y = 120 + k * 32 + Math.sin(x * 0.07 + k) * 9; if (x === 60) g.moveTo(x, y); else g.lineTo(x, y); } g.stroke(); }
    } else {
      g.beginPath(); g.moveTo(82, 196); g.lineTo(96, 150); g.lineTo(132, 130); g.lineTo(170, 160); g.lineTo(176, 196); g.closePath(); g.fill();
      g.beginPath(); g.arc(88, 100, 8, 0, 6.28); g.fill(); g.beginPath(); g.arc(120, 82, 6, 0, 6.28); g.fill(); g.beginPath(); g.arc(152, 100, 9, 0, 6.28); g.fill();
    }
  });
}

function buildHazardMeshes(tr, def, group, th) {
  // patches
  const mk = (list, mat, up, tile) => {
    for (const p of list) {
      const m = new THREE.Mesh(patchGeometry(tr, p.a, p.b, p.l0, p.l1, up, p.seed, tile), mat);
      m.receiveShadow = true;
      m.renderOrder = 1;
      group.add(m);
    }
  };
  if (tr.ice.length) mk(tr.ice, toon({ map: iceTexture(), vertexColors: true, transparent: true, roughness: 0.04, metalness: 0.1, envMapIntensity: 1.1, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }), 0.035, 7);
  if (tr.sand.length) mk(tr.sand, toon({ map: sandTexture(), vertexColors: true, transparent: true, roughness: 1, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }), 0.045, 7);

  // ramps: a wedge with chamfered sides, chevrons on top (they glow a little: they bloom)
  const topTex = chevronTexture();
  const topMat = toon({ map: topTex, emissiveMap: topTex, emissive: 0xffffff, emissiveIntensity: 0.5, roughness: 0.55, side: THREE.DoubleSide });
  const sideMat = toon({ color: 0xd9561a, roughness: 0.7, side: THREE.DoubleSide });
  for (const r of tr.ramps) {
    const L = r.len, half = r.w / 2, lats = [-half, -half + 0.8, half - 0.8, half];
    const P = (s, c, hh) => { const i = r.a + s, lat = r.lat + lats[c]; return [tr.x[i] - tr.tz[i] * lat, tr.y[i] + 0.03 + hh, tr.z[i] + tr.tx[i] * lat]; };
    const hs = s => r.h * s / L;
    const top = [], topUV = [], side = [];
    for (let s = 0; s < L; s++) {
      const q = [P(s, 1, hs(s)), P(s, 2, hs(s)), P(s + 1, 1, hs(s + 1)), P(s + 1, 2, hs(s + 1))];
      top.push(...q[0], ...q[2], ...q[1], ...q[1], ...q[2], ...q[3]);
      const v0 = s * SPACING / 4, v1 = (s + 1) * SPACING / 4;
      topUV.push(0, v0, 0, v1, 1, v0, 1, v0, 0, v1, 1, v1);
      for (const [c0, c1] of [[0, 1], [2, 3]]) {              // chamfers
        const hh0 = c0 === 0 ? 0 : hs(s), hh1 = c0 === 0 ? hs(s) : 0, hn0 = c0 === 0 ? 0 : hs(s + 1), hn1 = c0 === 0 ? hs(s + 1) : 0;
        const a = P(s, c0, hh0), b = P(s, c1, hh1), c = P(s + 1, c0, hn0), d = P(s + 1, c1, hn1);
        side.push(...a, ...c, ...b, ...b, ...c, ...d);
      }
    }
    // the vertical drop at the end
    const e0 = P(L, 0, 0), e1 = P(L, 1, 0), e1t = P(L, 1, r.h), e2 = P(L, 2, 0), e2t = P(L, 2, r.h), e3 = P(L, 3, 0);
    side.push(...e1, ...e2, ...e1t, ...e2, ...e2t, ...e1t, ...e0, ...e1, ...e1t, ...e3, ...e2t, ...e2);
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.Float32BufferAttribute(top, 3));
    tg.setAttribute('uv', new THREE.Float32BufferAttribute(topUV, 2));
    tg.computeVertexNormals();
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(side, 3));
    sg.computeVertexNormals();
    for (const [g, mat] of [[tg, topMat], [sg, sideMat]]) {
      const m = new THREE.Mesh(g, mat);
      m.castShadow = m.receiveShadow = true;
      group.add(m);
    }
  }

  // warning signs on the right of the road, 36 m before each patch / the canyon
  const signs = [];
  for (const p of tr.ice) signs.push(['ice', p.a - 18]);
  for (const p of tr.sand) signs.push(['sand', p.a - 18]);
  if (tr.canyon && tr.slides.length) signs.push(['rocks', tr.canyon.a - 30]);
  const poleMat = toon({ color: 0x9aa0ac, roughness: 0.5, metalness: 0.6 });
  const texCache = {};
  for (const [kind, i0] of signs) {
    const i = ((i0 % tr.N) + tr.N) % tr.N, lat = tr.hw + 2.4;
    const x = tr.x[i] - tr.tz[i] * lat, z = tr.z[i] + tr.tx[i] * lat, y = tr.y[i] - 0.1;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 3.6, 6), poleMat);
    pole.position.set(x, y + 1.8, z);
    pole.castShadow = true;
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 2.3), new THREE.MeshBasicMaterial({ map: texCache[kind] || (texCache[kind] = signTexture(kind)), transparent: true, alphaTest: 0.4, side: THREE.DoubleSide }));
    plate.position.set(x, y + 3.9, z);
    plate.rotation.y = Math.atan2(-tr.tx[i], -tr.tz[i]);              // faces the oncoming cars
    group.add(pole, plate);
  }
}

// ---------------------------------------------------------------- synthesized sounds

const HazardSfx = (() => {
  let noise = null, acNow = null;
  const ctx = () => {
    const ac = Engine.context, w = Engine.world;
    if (!ac || !w) return null;
    if (acNow !== ac) {
      acNow = ac;
      noise = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    return { ac, w };
  };
  // loudness from the distance of the camera
  const near = pos => {
    const cp = typeof game !== 'undefined' ? game.camPos : null;
    if (!cp || !pos) return 1;
    return clamp(1 - (Math.hypot(cp.x - pos.x, cp.y - pos.y, cp.z - pos.z) - 8) / 130, 0, 1);
  };
  const hiss = (c, t, dur, type, f0, f1, q, vol, attack) => {
    const src = c.ac.createBufferSource(); src.buffer = noise;
    const f = c.ac.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t); if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = c.ac.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + (attack || 0.004)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(c.w);
    src.start(t, Math.random() * 0.4, dur + 0.05);
  };
  const tone = (c, t, f0, f1, dur, vol) => {
    const o = c.ac.createOscillator(), g = c.ac.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(c.w); o.start(t); o.stop(t + dur + 0.02);
  };
  return {
    // the wall lets go: a deep rumble with cracking stones
    rumble(pos) {
      const c = ctx(); if (!c) return; const v = near(pos); if (v <= 0.02) return;
      const t = c.ac.currentTime + 0.01;
      hiss(c, t, 1.5, 'lowpass', 220, 120, 0.7, 0.85 * v, 0.25);
      tone(c, t, 62, 38, 1.4, 0.7 * v);
      for (let k = 0; k < 7; k++) hiss(c, t + 0.1 + Math.random() * 1.1, 0.07, 'bandpass', 700 + Math.random() * 1400, 500, 2, 0.35 * v);
    },
    // a boulder hits the road: thump + gravel; size 0.7..1.3
    rockImpact(pos, size) {
      const c = ctx(); if (!c) return; const v = near(pos) * clamp(size, 0.5, 1.4); if (v <= 0.02) return;
      const t = c.ac.currentTime + 0.005;
      tone(c, t, 105, 38, 0.32, 1.0 * v);
      hiss(c, t, 0.35, 'lowpass', 1100, 250, 0.8, 0.9 * v, 0.004);
      for (let k = 0; k < 4; k++) hiss(c, t + 0.03 + Math.random() * 0.25, 0.06, 'bandpass', 900 + Math.random() * 1600, 600, 2, 0.3 * v);
    },
    // landing after a jump
    thud(pos, vol) {
      const c = ctx(); if (!c) return; const v = near(pos) * (vol === undefined ? 1 : vol); if (v <= 0.02) return;
      const t = c.ac.currentTime + 0.005;
      tone(c, t, 130, 45, 0.22, 0.8 * v);
      hiss(c, t, 0.18, 'lowpass', 1500, 400, 0.8, 0.6 * v, 0.003);
    },
    // taking off: air rushing up
    launch(pos, vol) {
      const c = ctx(); if (!c) return; const v = near(pos) * (vol === undefined ? 1 : vol); if (v <= 0.02) return;
      const t = c.ac.currentTime + 0.005;
      hiss(c, t, 0.55, 'bandpass', 350, 2800, 1.4, 0.7 * v, 0.12);
      tone(c, t, 300, 900, 0.35, 0.25 * v);
    }
  };
})();

// ---------------------------------------------------------------- runtime: the rockslides

const ROCK_G = 22;
class Hazards {
  constructor(game) {
    this.game = game;
    const tr = game.track;
    this.group = new THREE.Group();
    game.scene.add(this.group);
    this.rocks = [];
    this.events = [];
    this.sites = (tr.slides || []).map((s, k) => ({ idx: s.idx, side: s.side, cool: 1 + k * 1.5 }));
    this.geos = [0, 1, 2].map(k => strataFaces(jitterGeo(new THREE.DodecahedronGeometry(1.5, 0), 0.5, 40 + k), 90 + k));
    this.mat = toon({ vertexColors: true, color: 0x8f7f75, roughness: 1 });   // darker than the walls: they must stand out
    this.ringGeo = new THREE.RingGeometry(0.72, 1.0, 28).rotateX(-Math.PI / 2);
    this.discGeo = new THREE.CircleGeometry(0.72, 28).rotateX(-Math.PI / 2);
    const mat = (color, op) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: op, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    this.ringMat = mat(0xff4a24, 0.9);
    this.discMat = mat(0xff4a24, 0.22);
    this.time = 0;
  }
  dispose() {
    this.game.scene.remove(this.group);
    this.geos.forEach(g => g.dispose());
    this.ringGeo.dispose(); this.discGeo.dispose();
    this.mat.dispose(); this.ringMat.dispose(); this.discMat.dispose();
  }

  // a site lets go: a few boulders, each announced by a red ring on the road where it will land; there is
  // always a free lane
  trigger(site) {
    const tr = this.game.track, hw = tr.hw;
    site.cool = 18 + Math.random() * 8;
    const n = 3 + (Math.random() < 0.5 ? 1 : 0), gap = (Math.random() * 2 - 1) * hw * 0.55, lats = [];
    for (let k = 0; k < n; k++) {
      let l, tries = 0;
      do { l = (Math.random() * 2 - 1) * hw * 0.85; tries++; } while (Math.abs(l - gap) < 2.8 && tries < 20);
      lats.push(l);
    }
    const wall = trackPoint(tr, site.idx, site.side * (hw + tr.barrier[site.idx] + 3));
    HazardSfx.rumble({ x: wall.x, y: wall.y + 12, z: wall.z });
    const fx = this.game.fx;
    for (let k = 0; k < 16; k++) fx.puff(wall.x + (Math.random() - 0.5) * 8, wall.y + 8 + Math.random() * 18, wall.z + (Math.random() - 0.5) * 8,
      (Math.random() - 0.5) * 2, -0.5 - Math.random(), (Math.random() - 0.5) * 2, 0.62, 5, 2.4, 0.5, [1.1, 0.9, 0.7]);
    lats.forEach((l, k) => {
      const fi = site.idx + (Math.random() * 2 - 1) * 3, p = trackPoint(tr, fi, l);
      const marker = new THREE.Group();
      marker.add(new THREE.Mesh(this.ringGeo, this.ringMat), new THREE.Mesh(this.discGeo, this.discMat));
      marker.position.set(p.x, p.y + 0.07, p.z);
      this.group.add(marker);
      this.events.push({ site, t: -(0.8 + k * 0.4 + Math.random() * 0.15), lat: l, fi, marker, rock: null, size: 0.75 + Math.random() * 0.5 });
    });
  }
  spawn(ev) {
    const tr = this.game.track, N = tr.N, site = ev.site, r = 1.5 * ev.size;
    const i0 = Math.round(ev.fi) % N, H = 15 + Math.random() * 11;
    const from = trackPoint(tr, ev.fi, site.side * (tr.hw + tr.barrier[i0] + 3.2)), to = trackPoint(tr, ev.fi, ev.lat);
    const T = Math.sqrt(2 * (H - r) / ROCK_G);
    const mesh = new THREE.Mesh(this.geos[Math.floor(Math.random() * 3)], this.mat);
    mesh.scale.setScalar(ev.size);
    mesh.castShadow = true;
    mesh.position.set(from.x, to.y + H, from.z);
    this.group.add(mesh);
    const rock = { mesh, x: from.x, y: to.y + H, z: from.z, vx: (to.x - from.x) / T, vy: 0, vz: (to.z - from.z) / T, r, size: ev.size, idx: i0, lat: 0,
      ax: (Math.random() - 0.5) * 5, az: (Math.random() - 0.5) * 5, settled: false, rest: 0, landed: false, ev };
    this.rocks.push(rock);
    ev.rock = rock;
    // dust where it breaks away from the wall
    for (let k = 0; k < 5; k++) this.game.fx.puff(from.x, to.y + H, from.z, (Math.random() - 0.5) * 3, Math.random() * 1.5, (Math.random() - 0.5) * 3, 0.58, 3.2, 1.6, 0.5, [1.1, 0.9, 0.7]);
  }
  removeRock(rock) {
    this.group.remove(rock.mesh);
    if (rock.ev && this.events.indexOf(rock.ev) >= 0) this.removeEvent(rock.ev);   // its ring goes too
    const k = this.rocks.indexOf(rock);
    if (k >= 0) this.rocks.splice(k, 1);
  }
  removeEvent(ev) {
    this.group.remove(ev.marker);
    this.events.splice(this.events.indexOf(ev), 1);
  }

  update(dt) {
    const g = this.game, tr = g.track, N = tr.N, fx = g.fx;
    this.time += dt;
    // sites: a car arriving triggers the slide
    for (const site of this.sites) {
      site.cool -= dt;
      if (site.cool > 0) continue;
      for (const c of g.cars) {
        let ahead = site.idx - c.idx;
        if (ahead < -N / 2) ahead += N;
        if (ahead > 16 && ahead < 55 && c.speed > 12 && !c.finished) { this.trigger(site); break; }
      }
    }
    // rings pulse, boulders start falling when their time comes
    for (let k = this.events.length - 1; k >= 0; k--) {
      const ev = this.events[k];
      ev.t += dt;
      const pulse = 1.15 + 0.12 * Math.sin(this.time * 14) + Math.max(0, ev.t) * 0.0;
      ev.marker.scale.set(ev.size * 1.5 * pulse, 1, ev.size * 1.5 * pulse);
      if (ev.t >= 0 && !ev.rock) this.spawn(ev);
      if (ev.rock && ev.rock.landed) this.removeEvent(ev);
    }
    // boulders
    for (let k = this.rocks.length - 1; k >= 0; k--) {
      const rk = this.rocks[k];
      if (!rk.settled) {
        rk.vy -= ROCK_G * dt;
        rk.x += rk.vx * dt; rk.y += rk.vy * dt; rk.z += rk.vz * dt;
        rk.mesh.rotation.x += rk.ax * dt; rk.mesh.rotation.z += rk.az * dt;
      }
      const i = trackLocal(tr, rk.x, rk.z, rk.idx, 10);
      trackProject(tr, rk.x, rk.z, i, proj);
      rk.idx = i; rk.lat = proj.lat;
      const gy = proj.h - (Math.abs(proj.lat) > tr.hw + 1.6 ? 0.3 : 0) + rk.r * 0.8;
      if (!rk.settled && rk.y < gy) {
        rk.y = gy;
        if (rk.vy < -2.5) {
          if (!rk.landed) { rk.landed = true; HazardSfx.rockImpact(rk, rk.size); }
          rk.vy = -rk.vy * 0.3; rk.vx *= 0.6; rk.vz *= 0.6;
          for (let n = 0; n < 4; n++) fx.puff(rk.x, rk.y - rk.r * 0.6, rk.z, (Math.random() - 0.5) * 4, 0.8 + Math.random() * 1.5, (Math.random() - 0.5) * 4, 0.6, 2.4 * rk.size, 1.2, 0.45, [1.1, 0.9, 0.7]);
          for (let n = 0; n < 6; n++) fx.dust(rk.x, rk.y - rk.r * 0.5, rk.z, 0xb08a5a);
        } else {
          rk.vy = 0; rk.landed = true;
          const fr = 1 - damp(2.4, dt);
          rk.vx *= fr; rk.vz *= fr;
          if (Math.hypot(rk.vx, rk.vz) < 0.8) rk.settled = true;
        }
      }
      // the barrier keeps the boulders on the road side
      const limit = tr.hw + tr.barrier[i] - 1.2;
      if (Math.abs(proj.lat) > limit) {
        const s = Math.sign(proj.lat), nx = -proj.tz * s, nz = proj.tx * s, over = Math.abs(proj.lat) - limit;
        rk.x -= nx * over; rk.z -= nz * over;
        const vo = rk.vx * nx + rk.vz * nz;
        if (vo > 0) { rk.vx -= 1.6 * vo * nx; rk.vz -= 1.6 * vo * nz; }
      }
      if (rk.settled) {
        rk.rest += dt;
        if (rk.rest > 8) { const s = Math.max(0, rk.size * (1 - (rk.rest - 8) * 2)); rk.mesh.scale.setScalar(Math.max(0.001, s)); if (s <= 0.01) { this.removeRock(rk); continue; } }
      }
      rk.mesh.position.set(rk.x, rk.y, rk.z);
      // a car in the way: it spins, the boulder breaks
      for (const c of g.cars) {
        if (c.finished) continue;
        const dx = c.x - rk.x, dz = c.z - rk.z;
        if (dx * dx + dz * dz > (rk.r + 1.25) * (rk.r + 1.25) || Math.abs(c.y + c.hopY + 0.7 - rk.y) > rk.r + 1.3) continue;
        c.hit('rock');
        HazardSfx.rockImpact(rk, rk.size);
        fx.burst(rk.x, rk.y, rk.z, 0xd0a070, 16, 9);
        for (let n = 0; n < 7; n++) fx.puff(rk.x, rk.y, rk.z, (Math.random() - 0.5) * 7, 1 + Math.random() * 3, (Math.random() - 0.5) * 7, 0.55, 3 * rk.size, 1.5, 0.55, [1.1, 0.9, 0.7]);
        for (let n = 0; n < 8; n++) fx.dust(rk.x, rk.y, rk.z, 0xb08a5a);
        this.removeRock(rk);
        break;
      }
    }
  }
}
