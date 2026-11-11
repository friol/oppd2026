// OPPD-1 SCANNED engine (after Verplank, Mathews, Shaw): a closed ring of masses and springs is simulated slowly
// (~600 steps/s, scannedPump) and its shape is "scanned" at the note's pitch as the waveform of every voice.
// Notes strike the ring; STIR keeps nudging it while notes are held.
'use strict';

const SCAN_N = 48, SCAN_H = 24;            // masses, harmonics of the scanned wave
const SCAN_EXCITE = ['GAUSS', 'PLUCK', 'SQUARE', 'NOISE'];
const SCAN_COS = [], SCAN_SIN = [];
for (let k = 0; k <= SCAN_H; k++) {
  SCAN_COS.push(Float64Array.from({ length: SCAN_N }, (_, i) => Math.cos(2 * Math.PI * k * i / SCAN_N)));
  SCAN_SIN.push(Float64Array.from({ length: SCAN_N }, (_, i) => Math.sin(2 * Math.PI * k * i / SCAN_N)));
}

function scanString(rt) {
  if (!rt.eng.str) rt.eng.str = { x: new Float64Array(SCAN_N), v: new Float64Array(SCAN_N), wave: null, hit: [] };
  return rt.eng.str;
}
function scanExcite(rt, p, vel) {
  const s = scanString(rt), type = idxOf(p.excite, 4), c = p.position * SCAN_N, wd = 5;
  const a = (0.15 + p.hit * 0.9) * vel;
  for (let i = 0; i < SCAN_N; i++) {
    let d = Math.abs(i - c); d = Math.min(d, SCAN_N - d);
    let sh = 0;
    if (type === 0) sh = Math.exp(-2 * (d / wd) ** 2);
    else if (type === 1) sh = Math.max(0, 1 - d / (wd * 1.4));
    else if (type === 2) sh = d < wd ? 1 : 0;
    else sh = d < wd * 1.6 ? Math.random() * 2 - 1 : 0;
    s.x[i] += a * sh;
  }
  s.hit.push({ f: p.position, t: performance.now() });
  if (s.hit.length > 6) s.hit.shift();
}
// build the oscillator wave from the ring's shape (DFT), with a brightness tilt; no normalization: a quiet ring is quiet
function scanWave(rt, p) {
  const s = scanString(rt), re = new Float32Array(SCAN_H + 1), im = new Float32Array(SCAN_H + 1);
  let peak = 0;
  for (let i = 0; i < SCAN_N; i++) peak = Math.max(peak, Math.abs(s.x[i]));
  const kc = 2 + p.bright * p.bright * 22, lim = peak > 1 ? 1 / peak : 1;
  for (let k = 1; k <= SCAN_H; k++) {
    let a = 0, b = 0;
    for (let i = 0; i < SCAN_N; i++) { a += s.x[i] * SCAN_COS[k][i]; b += s.x[i] * SCAN_SIN[k][i]; }
    const tilt = 1 / (1 + (k / kc) ** 2) * lim * 2 / SCAN_N;
    re[k] = a * tilt; im[k] = b * tilt;
  }
  s.wave = AC.createPeriodicWave(re, im, { disableNormalization: true });
  return s.wave;
}

function scannedPump() {
  PRJ.parts.forEach((part, pi) => {
    if (part.engine !== 'scanned') return;
    const rt = RT[pi], p = part.params, s = scanString(rt);
    const active = rt.voices.filter(v => !v.done && v.osc);
    const now = AC.currentTime, held = rt.voices.some(v => v.heldAt(now));
    let energy = 0;
    for (let i = 0; i < SCAN_N; i++) energy += s.x[i] * s.x[i] + s.v[i] * s.v[i];
    if (!active.length && energy < 1e-7) return;
    // physics: springs between neighbours on a ring, damping; semi-implicit Euler at 600 steps/s
    const K = expmap(p.stiff, 40, 60000), D = expmap(p.damp, 0.1, 40), dt = 1 / 600, x = s.x, v = s.v;
    let peak = 0;
    for (let i = 0; i < SCAN_N; i++) peak = Math.max(peak, Math.abs(x[i]));
    for (let step = 0; step < 12; step++) {
      // STIR: random nudges while notes are held, weaker when the ring is already swinging wide
      if (held && p.stir > 0.01 && Math.random() < 0.04) {
        const j = Math.floor(Math.random() * SCAN_N), kick = (Math.random() * 2 - 1) * p.stir * p.stir * 20 * Math.max(0, 1 - peak);
        for (let o = -3; o <= 3; o++) v[(j + o + SCAN_N) % SCAN_N] += kick * Math.exp(-0.5 * o * o / 2);
      }
      for (let i = 0; i < SCAN_N; i++) {
        const l = x[(i + SCAN_N - 1) % SCAN_N], r = x[(i + 1) % SCAN_N];
        v[i] += (K * (l + r - 2 * x[i]) - D * v[i]) * dt;
      }
      for (let i = 0; i < SCAN_N; i++) x[i] += v[i] * dt;
    }
    let mean = 0;
    for (let i = 0; i < SCAN_N; i++) mean += x[i];
    mean /= SCAN_N;
    for (let i = 0; i < SCAN_N; i++) x[i] -= mean;
    // soft energy limit: a ring pushed past full swing is gently pulled back
    if (peak > 0.9) { const k = Math.pow(0.9 / peak, 0.15); for (let i = 0; i < SCAN_N; i++) { x[i] *= k; v[i] *= k; } }
    if (active.length) { const w = scanWave(rt, p); active.forEach(vo => vo.osc.setPeriodicWave(w)); }
  });
}
PUMPS.push(scannedPump);

const SCANNED = {
  name: 'SCANNED', poly: 8,
  params: [
    P('stiff', 'STIFF', 0.5, pct), P('damp', 'DAMP', 0.3, pct), P('stir', 'STIR', 0.3, pct), P('excite', 'EXCITE', 0, fList(SCAN_EXCITE), 4),
    P('hit', 'HIT', 0.6, pct), P('position', 'POSITION', 0.3, pct), P('bright', 'BRIGHT', 0.6, pct),
    P('swell', 'SWELL', 0.5, v => { const e = swellEnv(v); return fmtSec(e.a) + '/' + fmtSec(e.r); })
  ],
  env: p => swellEnv(p.swell),
  play(rt, part, note, vel, t) {
    const p = part.params, env = swellEnv(p.swell);
    scanExcite(rt, p, vel);
    const osc = AC.createOscillator();
    osc.setPeriodicWave(scanWave(rt, p));
    osc.frequency.value = mtof(note); osc.start(t);
    const amp = AC.createGain(); amp.gain.value = 0;
    osc.connect(amp); amp.connect(rt.engIn);
    const e = envStart(amp.gain, t, env.a, env.d, env.s, 0.6 * vel);
    const v = mkVoice({ srcs: [osc], amp, e, rel: env.r, live(id) { if (id === 'bright') osc.setPeriodicWave(scanWave(rt, p)); } });
    v.osc = osc;
    return v;
  },
  // the ring unrolled: masses as dots, strike positions flash
  view(g, pi, x, y, w, h) {
    const rt = RT[pi], s = scanString(rt), p = PRJ.parts[pi].params, cy = y + h * 0.45, hh = h * 0.4;
    g.strokeStyle = C.line; g.lineWidth = 1; g.beginPath(); g.moveTo(x, cy); g.lineTo(x + w, cy); g.stroke();
    const now = performance.now();
    s.hit.forEach(hv => {
      const age = (now - hv.t) / 500;
      if (age > 1) return;
      g.globalAlpha = 0.25 * (1 - age); g.fillStyle = C.accent;
      g.fillRect(x + hv.f * w - 10, y, 20, h - 4);
      g.globalAlpha = 1;
    });
    g.strokeStyle = C.accent; g.lineWidth = 1.6; g.lineJoin = 'round';
    g.beginPath();
    for (let i = 0; i <= SCAN_N; i++) {
      const xx = x + i / SCAN_N * w, yy = cy - clamp(s.x[i % SCAN_N], -1.2, 1.2) * hh;
      if (i) g.lineTo(xx, yy); else g.moveTo(xx, yy);
    }
    g.stroke();
    g.fillStyle = C.ink;
    for (let i = 0; i < SCAN_N; i += 2) g.fillRect(x + i / SCAN_N * w - 1, cy - clamp(s.x[i], -1.2, 1.2) * hh - 1, 2, 2);
    g.fillStyle = KC[1]; g.fillRect(x + p.position * w - 0.5, y + h - 6, 1.5, 6);
  }
};
ENGINES.scanned = SCANNED;
ENGINE_LIST.push('scanned');
