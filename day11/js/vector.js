// OPPD-1 VECTOR engine: four sources on the corners of a square (A top-left, B top-right, C bottom-left, D bottom-right),
// mixed by an X/Y point that can also orbit on its own. The mix is updated by vectorPump() from the sequencer clock.
'use strict';

const VEC_SOURCES = ['SINE', 'TRI', 'SAW', 'SQUARE', 'PULSE', 'SUPERSAW', 'VOWEL', 'ORGAN', 'FIFTHS', 'NOISE'];
const _vecWaves = {};
function vecWave(name) {
  if (_vecWaves[name]) return _vecWaves[name];
  const n = 48, re = new Float32Array(n), im = new Float32Array(n);
  if (name === 'PULSE') for (let k = 1; k < n; k++) re[k] = 2 * Math.sin(Math.PI * k * 0.25) / (Math.PI * k);
  if (name === 'VOWEL') {
    // an "aah": harmonic amplitudes shaped by three formants (for a voice around 150 Hz)
    const F = [[700, 130, 1], [1220, 150, 0.5], [2600, 220, 0.3]];
    for (let k = 1; k < n; k++) { const hz = k * 150; im[k] = F.reduce((a, [fc, bw, g]) => a + g * Math.exp(-0.5 * ((hz - fc) / bw) ** 2), 0) + 0.02 / k; }
  }
  if (name === 'ORGAN') [[1, 0.8], [2, 1], [3, 0.5], [4, 0.6], [6, 0.3], [8, 0.4]].forEach(([k, a]) => { im[k] = a; });
  return (_vecWaves[name] = AC.createPeriodicWave(re, im));
}
// start one corner source at pitch f into dest; returns the started source nodes
function vecSource(name, f, t, dest) {
  const nodes = [];
  const osc = (type, freq, det, lvl) => {
    const o = AC.createOscillator();
    if (['PULSE', 'VOWEL', 'ORGAN'].includes(type)) o.setPeriodicWave(vecWave(type)); else o.type = type;
    o.frequency.value = freq; o.detune.value = det || 0;
    const g = AC.createGain(); g.gain.value = lvl;
    o.connect(g); g.connect(dest); o.start(t);
    nodes.push(o);
  };
  if (name === 'SINE') osc('sine', f, 0, 0.9);
  else if (name === 'TRI') osc('triangle', f, 0, 0.9);
  else if (name === 'SAW') osc('sawtooth', f, 0, 0.6);
  else if (name === 'SQUARE') osc('square', f, 0, 0.45);
  else if (name === 'PULSE' || name === 'VOWEL' || name === 'ORGAN') osc(name, f, 0, 0.7);
  else if (name === 'SUPERSAW') [-14, 0, 14].forEach(d => osc('sawtooth', f, d, 0.33));
  else if (name === 'FIFTHS') { osc('sawtooth', f, 0, 0.4); osc('sawtooth', f * 1.5, 0, 0.3); }
  else {
    // pitched noise: white noise through a narrow band at the note
    const s = AC.createBufferSource(); s.buffer = AU.noise; s.loop = true; s.start(t, Math.random());
    const bp = mkFilter('bandpass', f, 14), g = AC.createGain(); g.gain.value = 4;
    s.connect(bp); bp.connect(g); g.connect(dest);
    nodes.push(s);
  }
  return nodes;
}
// current X/Y of a part (the orbit circles around the knob position)
function vecPos(rt, p) {
  const r = p.orbit > 0.01 ? 0.38 : 0, ph = rt.eng.orbitPh || 0;
  return { x: clamp(p.x + r * Math.cos(ph), 0, 1), y: clamp(p.y + r * Math.sin(ph), 0, 1) };
}
const vecGains = ({ x, y }) => [Math.sqrt((1 - x) * y), Math.sqrt(x * y), Math.sqrt((1 - x) * (1 - y)), Math.sqrt(x * (1 - y))];

function vectorPump() {
  const now = AC.currentTime;
  PRJ.parts.forEach((part, pi) => {
    if (part.engine !== 'vector') return;
    const rt = RT[pi], p = part.params, dt = Math.min(0.1, now - (rt.eng.lastT || now));
    rt.eng.lastT = now;
    if (p.orbit > 0.01) rt.eng.orbitPh = ((rt.eng.orbitPh || 0) + dt * Math.PI * 2 * expmap(p.orbit, 0.02, 4)) % (Math.PI * 2);
    const gs = vecGains(vecPos(rt, p));
    rt.voices.forEach(v => { if (!v.done && v.corners) v.corners.forEach((c, i) => c.gain.setTargetAtTime(gs[i], now, 0.03)); });
  });
}
PUMPS.push(vectorPump);

const VECTOR = {
  name: 'VECTOR', poly: 6,
  params: [
    P('srcA', 'SOURCE A', 5 / 9, fList(VEC_SOURCES), VEC_SOURCES.length), P('srcB', 'SOURCE B', 6 / 9, fList(VEC_SOURCES), VEC_SOURCES.length),
    P('srcC', 'SOURCE C', 2 / 9, fList(VEC_SOURCES), VEC_SOURCES.length), P('srcD', 'SOURCE D', 0, fList(VEC_SOURCES), VEC_SOURCES.length),
    P('x', 'X', 0.5, pct), P('y', 'Y', 0.5, pct), P('orbit', 'ORBIT', 0.3, v => v <= 0.01 ? 'OFF' : fmtHz(expmap(v, 0.02, 4))),
    P('swell', 'SWELL', 0.5, v => { const e = swellEnv(v); return fmtSec(e.a) + '/' + fmtSec(e.r); })
  ],
  env: p => swellEnv(p.swell),
  play(rt, part, note, vel, t) {
    const p = part.params, f = mtof(note), env = swellEnv(p.swell);
    const lp = mkFilter('lowpass', 9000, 0.5), amp = AC.createGain(); amp.gain.value = 0;
    lp.connect(amp); amp.connect(rt.engIn);
    const gs = vecGains(vecPos(rt, p));
    const corners = [], srcs = [];
    ['srcA', 'srcB', 'srcC', 'srcD'].forEach((id, i) => {
      const g = AC.createGain(); g.gain.value = gs[i]; g.connect(lp);
      corners.push(g);
      vecSource(VEC_SOURCES[idxOf(p[id], VEC_SOURCES.length)], f, t, g).forEach(n => srcs.push(n));
    });
    const e = envStart(amp.gain, t, env.a, env.d, env.s, 0.32 * vel);
    const v = mkVoice({ srcs, amp, e, rel: env.r });
    v.corners = corners;
    return v;
  },
  // the square with its four sources, the orbit and the mixing point
  view(g, pi, x, y, w, h) {
    const part = PRJ.parts[pi], p = part.params, rt = RT[pi];
    const s = h - 8, sx = x + (w - s) / 2, sy = y + 4;
    g.strokeStyle = C.line; g.lineWidth = 1; g.strokeRect(sx + 0.5, sy + 0.5, s, s);
    const pos = vecPos(rt, p), gs = vecGains(pos);
    const corners = [[sx, sy, 'srcA'], [sx + s, sy, 'srcB'], [sx, sy + s, 'srcC'], [sx + s, sy + s, 'srcD']];
    corners.forEach(([cx, cy, id], i) => {
      g.fillStyle = KC[i]; g.globalAlpha = 0.25 + 0.75 * gs[i];
      g.beginPath(); g.arc(cx, cy, 2 + gs[i] * 5, 0, Math.PI * 2); g.fill(); g.globalAlpha = 1;
      const left = i % 2 === 0;
      T(g, 'ABCD'[i] + ' ' + VEC_SOURCES[idxOf(p[id], VEC_SOURCES.length)], left ? sx - 6 : sx + s + 6, cy + (i < 2 ? 6 : 0), 7.5, KC[i], left ? 'right' : 'left');
    });
    if (p.orbit > 0.01) {
      g.strokeStyle = C.faint; g.setLineDash([2, 3]);
      g.beginPath(); g.ellipse(sx + p.x * s, sy + (1 - p.y) * s, 0.38 * s, 0.38 * s, 0, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
    }
    g.fillStyle = C.ink; g.beginPath(); g.arc(sx + p.x * s, sy + (1 - p.y) * s, 1.5, 0, Math.PI * 2); g.fill();
    g.fillStyle = C.accent; g.beginPath(); g.arc(sx + pos.x * s, sy + (1 - pos.y) * s, 3.5, 0, Math.PI * 2); g.fill();
  }
};
ENGINES.vector = VECTOR;
ENGINE_LIST.push('vector');
