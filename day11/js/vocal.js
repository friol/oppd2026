// OPPD-1 VOCAL engine: a buzzy source (two saws + breath noise) through three formant band-passes.
// The vowel can morph on its own (MORPH RATE / DEPTH), updated by vocalPump() from the sequencer clock.
'use strict';

// three formants per vowel (a e i o u), after Peterson & Barney
const VOCAL_V = [[730, 1090, 2440], [530, 1840, 2480], [270, 2290, 3010], [570, 840, 2410], [300, 870, 2240]];
const VOWEL_NAMES = ['A', 'E', 'I', 'O', 'U'];
// formant frequencies at a vowel position 0..4 (interpolated), scaled by the vocal tract size
function vocalFormants(pos, size) {
  pos = clamp(pos, 0, 4);
  const i = Math.min(3, Math.floor(pos)), u = pos - i, sc = lin(size, 0.8, 1.35);
  return [0, 1, 2].map(k => (VOCAL_V[i][k] * (1 - u) + VOCAL_V[i + 1][k] * u) * sc);
}
const VOCAL_GAIN = [1, 0.6, 0.35];
const vocalQ = (p, k) => lin(p.reso, 3, 16) * (k ? 1.4 : 1);

function vocalPos(rt, p) {
  const d = p.depth * 2, ph = rt.eng.morphPh || 0;
  return clamp(p.vowel * 4 + (p.mrate > 0.01 ? d * Math.sin(ph) : 0), 0, 4);
}
function vocalPump() {
  const now = AC.currentTime;
  PRJ.parts.forEach((part, pi) => {
    if (part.engine !== 'vocal') return;
    const rt = RT[pi], p = part.params, dt = Math.min(0.1, now - (rt.eng.lastT || now));
    rt.eng.lastT = now;
    if (p.mrate > 0.01) rt.eng.morphPh = ((rt.eng.morphPh || 0) + dt * Math.PI * 2 * expmap(p.mrate, 0.05, 6)) % (Math.PI * 2);
    const fs = vocalFormants(vocalPos(rt, p), p.size);
    rt.voices.forEach(v => { if (!v.done && v.formants) v.formants.forEach((bp, k) => bp.frequency.setTargetAtTime(fs[k], now, 0.03)); });
  });
}
PUMPS.push(vocalPump);

const VOCAL = {
  name: 'VOCAL', poly: 6,
  params: [
    P('vowel', 'VOWEL', 0, v => { const x = v * 4, i = Math.round(x); return Math.abs(x - i) < 0.12 ? VOWEL_NAMES[i] : VOWEL_NAMES[Math.floor(x)] + '>' + VOWEL_NAMES[Math.min(4, Math.floor(x) + 1)]; }),
    P('size', 'SIZE', 0.4, pct), P('breath', 'BREATH', 0.15, pct), P('reso', 'RESO', 0.5, pct),
    P('vibrato', 'VIBRATO', 0.3, pct), P('mrate', 'MORPH RATE', 0, v => v <= 0.01 ? 'OFF' : fmtHz(expmap(v, 0.05, 6))), P('depth', 'MORPH DEPTH', 0.5, pct),
    P('swell', 'SWELL', 0.35, v => { const e = swellEnv(v); return fmtSec(e.a) + '/' + fmtSec(e.r); })
  ],
  setup(rt, part) {
    const l = lfoNode(5.3, 0); rt.eng.vib = l; rt.eng.nodes.push(l.o);
    rt.engIn.connect(rt.input);
    this.live(rt, part, 'vibrato');
  },
  live(rt, part, id) { if (id === 'vibrato') tset(rt.eng.vib.g.gain, part.params.vibrato * 40); },
  env: p => swellEnv(p.swell),
  play(rt, part, note, vel, t) {
    const p = part.params, f = mtof(note), env = swellEnv(p.swell);
    const src = AC.createGain(), amp = AC.createGain(), lp = mkFilter('lowpass', 7000, 0.5);
    amp.gain.value = 0;
    const s1 = mkOsc('sawtooth', f, t), s2 = mkOsc('sawtooth', f, t); s2.detune.value = 7;
    const sg = AC.createGain(); sg.gain.value = 0.5 * (1 - p.breath * 0.6);
    s1.connect(sg); s2.connect(sg); sg.connect(src);
    const vibG = rt.eng.vib.g;   // keep the reference: the engine may be switched while the note still rings
    vibG.connect(s1.detune); vibG.connect(s2.detune);
    const nz = AC.createBufferSource(); nz.buffer = AU.noise; nz.loop = true; nz.start(t, Math.random());
    const nhp = mkFilter('highpass', 400, 0.7), ng = AC.createGain(); ng.gain.value = p.breath * 1.2;
    nz.connect(nhp); nhp.connect(ng); ng.connect(src);
    const fs = vocalFormants(vocalPos(rt, p), p.size), formants = [], fgains = [];
    fs.forEach((fr, k) => {
      const q = vocalQ(p, k), bp = mkFilter('bandpass', fr, q), g = AC.createGain();
      g.gain.value = VOCAL_GAIN[k] * Math.sqrt(q) * 0.9;
      src.connect(bp); bp.connect(g); g.connect(lp);
      formants.push(bp); fgains.push(g);
    });
    lp.connect(amp); amp.connect(rt.engIn);
    const e = envStart(amp.gain, t, env.a, env.d, env.s, 0.7 * vel);
    const v = mkVoice({
      srcs: [s1, s2, nz], amp, e, rel: env.r,
      cleanup: () => { safeDisconnect(vibG, s1.detune); safeDisconnect(vibG, s2.detune); },
      live(id) {
        if (id === 'reso') formants.forEach((bp, k) => { const q = vocalQ(p, k); tset(bp.Q, q); tset(fgains[k].gain, VOCAL_GAIN[k] * Math.sqrt(q) * 0.9); });
        else if (id === 'breath') { tset(ng.gain, p.breath * 1.2); tset(sg.gain, 0.5 * (1 - p.breath * 0.6)); }
      }
    });
    v.formants = formants;
    return v;
  },
  view(g, pi, x, y, w, h) { drawFormantView(g, x, y, w, h, vocalFormants(vocalPos(RT[pi], PRJ.parts[pi].params), PRJ.parts[pi].params.size).map((f, k) => [f, VOCAL_GAIN[k], f / vocalQ(PRJ.parts[pi].params, k)]), vocalPos(RT[pi], PRJ.parts[pi].params)); }
};
ENGINES.vocal = VOCAL;
ENGINE_LIST.push('vocal');

// shared by VOCAL and FOF: the spectral envelope (resonance peaks) and the vowel strip with the current position
function drawFormantView(g, x, y, w, h, formants, pos) {
  const top = y + 2, bh = h - 22, fmax = 5000;
  g.strokeStyle = C.line; g.lineWidth = 1;
  [1000, 2000, 3000, 4000].forEach(f => { const xx = x + f / fmax * w; g.beginPath(); g.moveTo(xx, top); g.lineTo(xx, top + bh); g.stroke(); });
  let peak = 0;
  const vals = [];
  for (let i = 0; i <= w; i += 2) {
    const f = i / w * fmax;
    const v = formants.reduce((a, [fc, amp, bw]) => a + amp / (1 + ((f - fc) / (bw / 2)) ** 2), 0);
    vals.push(v); peak = Math.max(peak, v);
  }
  g.beginPath();
  g.moveTo(x, top + bh);
  vals.forEach((v, j) => g.lineTo(x + j * 2, top + bh - v / Math.max(peak, 1e-6) * bh * 0.95));
  g.lineTo(x + w, top + bh);
  g.globalAlpha = 0.15; g.fillStyle = C.accent; g.fill(); g.globalAlpha = 1;
  g.strokeStyle = C.accent; g.lineWidth = 1.6; g.stroke();
  T(g, '5k', x + w, top + 6, 7, C.dim, 'right');
  // vowel strip
  const sy = y + h - 9;
  VOWEL_NAMES.forEach((n, i) => T(g, n, x + 8 + i / 4 * (w - 16), sy + 3, 9, Math.abs(pos - i) < 0.5 ? C.ink : C.dim, 'center', 600));
  g.fillStyle = C.accent; g.fillRect(x + 8 + pos / 4 * (w - 16) - 5, sy + 6, 10, 2);
}
