// OPPD-1 NOISE engine: noise "tuned" by a bank of six resonant band-passes on the note's harmonics.
// TONE goes from a noisy wash to a clear pitched drone; MOTION / DEPTH sweep the bank slowly (part LFO).
'use strict';

const NOISE_PARTIALS = 6;
const noiseQ = p => expmap(p.tone, 2, 150);
// gain of partial k: harmonic tilt, and more gain for narrow bands (they let less noise energy through)
function noiseGains(p, f) {
  const q = noiseQ(p), tilt = [];
  for (let k = 1; k <= NOISE_PARTIALS; k++) tilt.push(Math.pow(k, -(1.8 - p.harmonics * 1.6)));
  const norm = Math.sqrt(tilt.reduce((a, b) => a + b * b, 0));
  return tilt.map((tk, i) => Math.min(150, tk / norm * Math.sqrt(q * 300 / (f * (i + 1))) * 1.4));
}

const NOISE = {
  name: 'NOISE', poly: 6,
  params: [
    P('color', 'COLOR', 0.6, v => fmtHz(expmap(v, 300, 18000))), P('tone', 'TONE', 0.5, pct), P('harmonics', 'HARMONICS', 0.5, pct), P('air', 'AIR', 0.2, pct),
    P('motion', 'MOTION', 0.3, v => v <= 0.01 ? 'OFF' : fmtHz(expmap(v, 0.02, 6))), P('depth', 'DEPTH', 0.3, pct), P('spread', 'SPREAD', 0.5, pct),
    P('swell', 'SWELL', 0.7, v => { const e = swellEnv(v); return fmtSec(e.a) + '/' + fmtSec(e.r); })
  ],
  setup(rt, part) {
    const l = lfoNode(0.3, 0); rt.eng.lfo = l; rt.eng.nodes.push(l.o);
    rt.engIn.connect(rt.input);
    this.live(rt, part, 'motion');
  },
  live(rt, part, id) {
    const p = part.params;
    if (id === 'motion' || id === 'depth') { tset(rt.eng.lfo.o.frequency, expmap(p.motion, 0.02, 6)); tset(rt.eng.lfo.g.gain, p.motion <= 0.01 ? 0 : p.depth * 1500); }
  },
  env: p => swellEnv(p.swell),
  play(rt, part, note, vel, t) {
    const p = part.params, f = mtof(note), env = swellEnv(p.swell), lfoG = rt.eng.lfo.g;
    const amp = AC.createGain(); amp.gain.value = 0;
    amp.connect(rt.engIn);
    const src = AC.createBufferSource(); src.buffer = AU.noise; src.loop = true; src.start(t, Math.random() * 1.5);
    const color = mkFilter('lowpass', expmap(p.color, 300, 18000), 0.5);
    src.connect(color); lfoG.connect(color.detune);
    const q = noiseQ(p), gs = noiseGains(p, f), bank = [], gains = [], pans = [];
    for (let k = 1; k <= NOISE_PARTIALS; k++) {
      const fk = f * k;
      if (fk > AC.sampleRate * 0.45) break;
      const bp = mkFilter('bandpass', fk, q), g = AC.createGain(), pn = AC.createStereoPanner();
      g.gain.value = gs[k - 1];
      pn.pan.value = (k % 2 ? -1 : 1) * p.spread * Math.min(1, k / 3);
      color.connect(bp); bp.connect(g); g.connect(pn); pn.connect(amp);
      lfoG.connect(bp.detune);
      bank.push(bp); gains.push(g); pans.push(pn);
    }
    const dryG = AC.createGain(); dryG.gain.value = p.air * 0.25;
    color.connect(dryG); dryG.connect(amp);
    const e = envStart(amp.gain, t, env.a, env.d, env.s, 0.8 * vel);
    return mkVoice({
      srcs: [src], amp, e, rel: env.r,
      cleanup: () => { safeDisconnect(lfoG, color.detune); bank.forEach(bp => safeDisconnect(lfoG, bp.detune)); },
      live(id) {
        if (id === 'color') tset(color.frequency, expmap(p.color, 300, 18000));
        else if (id === 'tone' || id === 'harmonics') { const g2 = noiseGains(p, f), q2 = noiseQ(p); bank.forEach((bp, i) => { tset(bp.Q, q2); tset(gains[i].gain, g2[i]); }); }
        else if (id === 'air') tset(dryG.gain, p.air * 0.25);
        else if (id === 'spread') pans.forEach((pn, i) => tset(pn.pan, ((i + 1) % 2 ? -1 : 1) * p.spread * Math.min(1, (i + 1) / 3)));
      }
    });
  },
  // the resonator bank (for a C3) on a log frequency axis, over a flickering noise floor
  view(g, pi, x, y, w, h) {
    const p = PRJ.parts[pi].params, f0 = 130.8, q = noiseQ(p), gs = noiseGains(p, f0), bh = h - 20, base = y + bh;
    const X = f => x + Math.log(f / 50) / Math.log(12000 / 50) * w;
    const lfo = p.motion > 0.01 ? Math.pow(2, p.depth * 1.25 * Math.sin(performance.now() / 1000 * Math.PI * 2 * expmap(p.motion, 0.02, 6))) : 1;
    g.fillStyle = C.faint;
    for (let i = 0; i < w; i += 3) {
      const r = Math.abs(Math.sin(i * 12.9898 + Math.floor(performance.now() / 90) * 7.1)) % 1;
      const fcol = 50 * Math.pow(12000 / 50, i / w), lpA = 1 / (1 + (fcol / expmap(p.color, 300, 18000)) ** 2);
      g.fillRect(x + i, base - r * bh * 0.18 * (0.3 + p.air) * lpA, 2, r * bh * 0.18 * (0.3 + p.air) * lpA);
    }
    const gmax = Math.max(...gs);
    g.strokeStyle = C.accent; g.lineWidth = 1.6;
    g.beginPath();
    for (let i = 0; i <= w; i++) {
      const f = 50 * Math.pow(12000 / 50, i / w);
      let v = 0;
      gs.forEach((gk, k) => { const fc = f0 * (k + 1) * lfo, bw = fc / q; v += gk / gmax / (1 + ((f - fc) / (bw / 2)) ** 2); });
      const yy = base - Math.min(1, v) * bh * 0.92;
      if (i) g.lineTo(x + i, yy); else g.moveTo(x, yy);
    }
    g.stroke();
    T(g, 'Q ' + Math.round(q), x + w, y + 6, 7, C.dim, 'right');
    drawScope(g, RT[pi].an, x, y + h - 14, w, 14, KC[3]);
  }
};
ENGINES.noise = NOISE;
ENGINE_LIST.push('noise');
