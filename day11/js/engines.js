// OPPD-1 synthesis engines: the drum machine voices and the melodic engines (GRAIN and FOLD live in their own files)
// All parameters are stored normalized (0..1); each definition maps and formats its own value.
'use strict';

const WAVES = ['SAW', 'SQUARE', 'TRI', 'SINE'];
const WAVE_T = ['sawtooth', 'square', 'triangle', 'sine'];

function P(id, name, def, fmt, steps) { return { id, name, def, fmt, steps: steps || 0 }; }
const fHz = (a, b) => v => fmtHz(expmap(v, a, b));
const fSec = (a, b) => v => fmtSec(expmap(v, a, b));
const fList = arr => v => arr[idxOf(v, arr.length)];

// Voice wrapper: o = { srcs, amp, e, rel, live(id), cleanup }
function mkVoice(o) {
  const v = {
    // released: a release has been scheduled; relAt: when it starts (pattern notes book it in advance)
    released: false, relAt: Infinity, done: false, live: o.live || null,
    stop(t) {
      t = Math.max(t, AC.currentTime);
      if (this.released && this.relAt <= t) return;      // already releasing earlier: keep that
      this.released = true; this.relAt = t;
      envStop(o.amp.gain, o.e, t, o.rel);
      if (o.onStop) o.onStop(t, o.rel);
      o.srcs.forEach(s => s.stop(t + o.rel * 1.3 + 0.05));
    },
    kill(t) {
      t = Math.max(t, AC.currentTime);
      if (this.released && this.relAt <= t) return;      // its own release is already under way
      this.released = true; this.relAt = t;
      envStop(o.amp.gain, o.e, t, 0.012);
      o.srcs.forEach(s => s.stop(t + 0.06));
    },
    // still held (not yet in its release) at time t
    heldAt(t) { return !this.done && this.relAt > t; }
  };
  o.srcs[0].onended = () => {
    v.done = true;
    try { o.amp.disconnect(); } catch (e) { /* ignore */ }
    if (o.cleanup) o.cleanup();
  };
  return v;
}

function mkOsc(type, f, t) {
  const o = AC.createOscillator();
  o.type = type; o.frequency.setValueAtTime(f, t); o.start(t);
  return o;
}
function mkFilter(type, f, q) {
  const b = AC.createBiquadFilter();
  b.type = type; b.frequency.value = f; b.Q.value = q == null ? 0.7 : q;
  return b;
}
function safeDisconnect(a, b) { try { a.disconnect(b); } catch (e) { /* ignore */ } }

// ---------- PAD: three detuned oscillators spread in stereo, lowpass with LFO ----------
const PAD = {
  name: 'PAD', poly: 8,
  params: [
    P('wave', 'WAVE', 0, fList(WAVES), 4), P('detune', 'DETUNE', 0.4, pct), P('cutoff', 'CUTOFF', 0.6, fHz(150, 14000)), P('reso', 'RESO', 0.15, pct),
    P('attack', 'ATTACK', 0.45, fSec(0.005, 5)), P('release', 'RELEASE', 0.5, fSec(0.05, 8)), P('lfo', 'LFO RATE', 0.3, fHz(0.05, 10)), P('lfoamt', 'LFO AMT', 0.2, pct)
  ],
  setup(rt, part) {
    const l = lfoNode(1, 0); rt.eng.lfo = l; rt.eng.nodes.push(l.o);
    rt.engIn.connect(rt.input);
    this.live(rt, part, 'lfo'); this.live(rt, part, 'lfoamt');
  },
  live(rt, part, id) {
    const p = part.params;
    if (id === 'lfo') tset(rt.eng.lfo.o.frequency, expmap(p.lfo, 0.05, 10));
    if (id === 'lfoamt') tset(rt.eng.lfo.g.gain, p.lfoamt * p.lfoamt * 2400);
  },
  env: p => ({ a: expmap(p.attack, 0.005, 5), d: 0.6, s: 0.85, r: expmap(p.release, 0.05, 8) }),
  play(rt, part, note, vel, t) {
    const p = part.params, f = mtof(note);
    const flt = mkFilter('lowpass', expmap(p.cutoff, 150, 14000), lin(p.reso, 0.5, 14));
    const amp = AC.createGain(); amp.gain.value = 0;
    const lfoG = rt.eng.lfo.g;
    lfoG.connect(flt.detune);
    flt.connect(amp); amp.connect(rt.engIn);
    const oscs = [];
    [-1, 0, 1].forEach(k => {
      const o = mkOsc(WAVE_T[idxOf(p.wave, 4)], f, t);
      o.detune.value = k * p.detune * 30;
      const g = AC.createGain(); g.gain.value = 0.34;
      const pn = AC.createStereoPanner(); pn.pan.value = k * 0.6;
      o.connect(g); g.connect(pn); pn.connect(flt);
      oscs.push(o);
    });
    const e = envStart(amp.gain, t, expmap(p.attack, 0.005, 5), 0.6, 0.85, 0.4 * vel);
    return mkVoice({
      srcs: oscs, amp, e, rel: expmap(p.release, 0.05, 8),
      cleanup: () => safeDisconnect(lfoG, flt.detune),
      live(id) {
        if (id === 'cutoff') tset(flt.frequency, expmap(p.cutoff, 150, 14000));
        else if (id === 'reso') tset(flt.Q, lin(p.reso, 0.5, 14));
        else if (id === 'detune') oscs.forEach((o, k) => tset(o.detune, (k - 1) * p.detune * 30));
        else if (id === 'wave') oscs.forEach(o => { o.type = WAVE_T[idxOf(p.wave, 4)]; });
      }
    });
  }
};

// ---------- mono voice shared by LEAD and BASS (glide from the last pitch, filter envelope via detune) ----------
function monoVoice(rt, part, note, vel, t, o) {
  const p = part.params, f = mtof(note);
  rt.voices.forEach(v => { if (!v.done) v.kill(t); });
  const from = rt.eng.last || f; rt.eng.last = f;
  const glide = p.glide > 0.01 ? expmap(p.glide, 0.005, 0.6) : 0;
  const flt = mkFilter('lowpass', expmap(p.cutoff, o.cut[0], o.cut[1]), lin(p.reso, 0.5, o.qmax));
  const amp = AC.createGain(); amp.gain.value = 0;
  flt.connect(amp); amp.connect(o.dest || rt.engIn);
  const oscs = [], gains = [];
  const add = (type, mult, det, lvl) => {
    const os = AC.createOscillator(); os.type = type; os.detune.value = det;
    os.frequency.setValueAtTime(from * mult, t);
    if (glide) os.frequency.exponentialRampToValueAtTime(f * mult, t + glide);
    else os.frequency.setValueAtTime(f * mult, t);
    const g = AC.createGain(); g.gain.value = lvl;
    os.connect(g); g.connect(flt); os.start(t);
    if (rt.eng.vib) rt.eng.vib.g.connect(os.detune);
    oscs.push(os); gains.push(g);
  };
  o.oscs(add, p);
  const dec = expmap(p.decay, 0.05, 3);
  const fe = envStart(flt.detune, t, 0.003, dec, o.fs, p.envamt * o.envMax);
  const e = envStart(amp.gain, t, 0.004, dec * o.ampDec + 0.05, o.ampS, o.peak * vel);
  return mkVoice({
    srcs: oscs, amp, e, rel: o.rel,
    onStop: (tt, r) => envStop(flt.detune, fe, tt, r),
    cleanup: () => { if (rt.eng.vib) oscs.forEach(os => safeDisconnect(rt.eng.vib.g, os.detune)); },
    live(id) {
      if (id === 'cutoff') tset(flt.frequency, expmap(p.cutoff, o.cut[0], o.cut[1]));
      else if (id === 'reso') tset(flt.Q, lin(p.reso, 0.5, o.qmax));
      else if (id === 'wave') { const ty = WAVE_T[idxOf(p.wave, 4)]; oscs[0].type = ty; if (o.twin) oscs[1].type = ty; }
      else if (o.liveExtra) o.liveExtra(id, p, oscs, gains);
    }
  });
}

const LEAD = {
  name: 'LEAD', poly: 1, mono: true,
  params: [
    P('wave', 'WAVE', 0, fList(WAVES), 4), P('cutoff', 'CUTOFF', 0.6, fHz(100, 12000)), P('reso', 'RESO', 0.2, pct), P('glide', 'GLIDE', 0.15, v => v <= 0.01 ? 'OFF' : fmtSec(expmap(v, 0.005, 0.6))),
    P('envamt', 'ENV AMT', 0.35, pct), P('decay', 'DECAY', 0.35, fSec(0.05, 3)), P('vibrato', 'VIBRATO', 0.2, pct), P('detune', 'DETUNE', 0.3, pct)
  ],
  setup(rt, part) {
    const l = lfoNode(5.5, 0); rt.eng.vib = l; rt.eng.nodes.push(l.o);
    rt.engIn.connect(rt.input);
    this.live(rt, part, 'vibrato');
  },
  live(rt, part, id) { if (id === 'vibrato') tset(rt.eng.vib.g.gain, part.params.vibrato * 45); },
  env: p => ({ a: 0.004, d: expmap(p.decay, 0.05, 3) * 2, s: 0.75, r: 0.12 }),
  play(rt, part, note, vel, t) {
    return monoVoice(rt, part, note, vel, t, {
      cut: [100, 12000], qmax: 16, envMax: 4800, fs: 0.3, ampDec: 2, ampS: 0.75, peak: 0.34, rel: 0.12, twin: true,
      oscs(add, p) { const ty = WAVE_T[idxOf(p.wave, 4)]; add(ty, 1, 0, 0.5); add(ty, 1, p.detune * 25, p.detune > 0.01 ? 0.45 : 0); },
      liveExtra(id, p, oscs, gains) {
        if (id === 'detune') { tset(oscs[1].detune, p.detune * 25); tset(gains[1].gain, p.detune > 0.01 ? 0.45 : 0); }
      }
    });
  }
};

const BASS = {
  name: 'BASS', poly: 1, mono: true,
  params: [
    P('wave', 'WAVE', 0, fList(WAVES), 4), P('cutoff', 'CUTOFF', 0.35, fHz(40, 5000)), P('reso', 'RESO', 0.45, pct), P('envamt', 'ENV AMT', 0.5, pct),
    P('decay', 'DECAY', 0.3, fSec(0.05, 3)), P('sub', 'SUB', 0.5, pct), P('drive', 'DRIVE', 0.2, pct), P('glide', 'GLIDE', 0, v => v <= 0.01 ? 'OFF' : fmtSec(expmap(v, 0.005, 0.6)))
  ],
  setup(rt, part) {
    rt.eng.drive = DriveStage();
    rt.engIn.connect(rt.eng.drive.inp); rt.eng.drive.out.connect(rt.input);
    this.live(rt, part, 'drive');
  },
  live(rt, part, id) { if (id === 'drive') rt.eng.drive.set(part.params.drive); },
  env: p => ({ a: 0.004, d: expmap(p.decay, 0.05, 3) * 2 + 0.1, s: 0.5, r: 0.08 }),
  play(rt, part, note, vel, t) {
    return monoVoice(rt, part, note, vel, t, {
      cut: [40, 5000], qmax: 22, envMax: 4800, fs: 0.1, ampDec: 2, ampS: 0.5, peak: 0.34, rel: 0.08,
      oscs(add, p) { add(WAVE_T[idxOf(p.wave, 4)], 1, 0, 0.6); add('sine', 0.5, 0, p.sub * 0.8); },
      liveExtra(id, p, oscs, gains) { if (id === 'sub') tset(gains[1].gain, p.sub * 0.8); }
    });
  }
};

// ---------- GUITAR: Karplus-Strong string rendered into a buffer, body + amp drive + tone ----------
const _ksCache = new Map();
function ksRender(f, bright, damp, T60, pick) {
  const key = [f.toFixed(2), bright.toFixed(2), damp.toFixed(2), T60.toFixed(2), pick.toFixed(2)].join('|');
  if (_ksCache.has(key)) return _ksCache.get(key);
  const sr = AC.sampleRate;
  const dur = Math.min(6, T60 + 0.1);
  const N = Math.floor(sr * dur);
  const out = new Float32Array(N);
  const D0 = sr / f;
  const w = 0.05 + damp * 0.45;          // averaging weight of the loop filter
  const D = Math.max(2, D0 - w);         // the averaging adds w samples of delay
  const exLen = Math.max(2, Math.round(D0));
  const a = 0.04 + bright * bright * 0.96;
  const ex = new Float32Array(exLen);
  let lp = 0;
  for (let i = 0; i < exLen; i++) { lp += a * ((Math.random() * 2 - 1) - lp); ex[i] = lp; }
  const pd = Math.max(1, Math.round(pick * 0.5 * exLen));
  const ex2 = new Float32Array(exLen);
  for (let i = 0; i < exLen; i++) ex2[i] = ex[i] - (i >= pd ? ex[i - pd] : 0) * 0.9;
  const g = Math.pow(0.001, 1 / (f * T60));
  const rd = pos => { const i0 = Math.floor(pos), fr = pos - i0; return out[i0] * (1 - fr) + out[i0 + 1] * fr; };
  let peak = 0;
  for (let n = 0; n < N; n++) {
    let fb = 0;
    const pos = n - D;
    if (pos >= 1) fb = g * ((1 - w) * rd(pos) + w * rd(pos - 1));
    const y = (n < exLen ? ex2[n] : 0) + fb;
    out[n] = y;
    const ay = y < 0 ? -y : y;
    if (ay > peak) peak = ay;
  }
  const k = peak > 0 ? 0.6 / peak : 1;
  const fade = Math.min(N, Math.floor(sr * 0.05));
  for (let n = 0; n < N; n++) { out[n] *= k; if (n > N - fade) out[n] *= (N - n) / fade; }
  const buf = AC.createBuffer(1, N, sr);
  buf.getChannelData(0).set(out);
  if (_ksCache.size > 96) _ksCache.delete(_ksCache.keys().next().value);
  _ksCache.set(key, buf);
  return buf;
}
const GUITAR = {
  name: 'GUITAR', poly: 6,
  params: [
    P('bright', 'BRIGHT', 0.6, pct), P('damp', 'DAMP', 0.4, pct), P('sustain', 'SUSTAIN', 0.5, fSec(0.3, 8)), P('body', 'BODY', 0.4, pct),
    P('pick', 'PICK POS', 0.3, pct), P('drive', 'DRIVE', 0, pct), P('tone', 'TONE', 0.7, fHz(600, 14000)), P('release', 'RELEASE', 0.3, fSec(0.02, 2))
  ],
  setup(rt, part) {
    const b1 = mkFilter('peaking', 110, 1.4), b2 = mkFilter('peaking', 240, 1.2), b3 = mkFilter('peaking', 2600, 1.0);
    const dr = DriveStage(), tone = mkFilter('lowpass', 8000, 0.7);
    rt.engIn.connect(b1); b1.connect(b2); b2.connect(b3); b3.connect(dr.inp); dr.out.connect(tone); tone.connect(rt.input);
    rt.eng.body = [b1, b2, b3]; rt.eng.drive = dr; rt.eng.tone = tone;
    ['body', 'drive', 'tone'].forEach(id => this.live(rt, part, id));
  },
  live(rt, part, id) {
    const p = part.params;
    if (id === 'body') { const [b1, b2, b3] = rt.eng.body; tset(b1.gain, p.body * 10); tset(b2.gain, p.body * 6); tset(b3.gain, p.body * 4 - 2); }
    if (id === 'drive') rt.eng.drive.set(p.drive);
    if (id === 'tone') tset(rt.eng.tone.frequency, expmap(p.tone, 600, 14000));
  },
  env: p => ({ a: 0.002, d: expmap(p.sustain, 0.3, 8) / 2, s: 0, r: expmap(p.release, 0.02, 2) }),
  play(rt, part, note, vel, t) {
    const p = part.params;
    const buf = ksRender(mtof(note), p.bright, p.damp, expmap(p.sustain, 0.3, 8), p.pick);
    const src = AC.createBufferSource(); src.buffer = buf;
    const amp = AC.createGain(); amp.gain.value = 0;
    src.connect(amp); amp.connect(rt.engIn); src.start(t);
    const e = envStart(amp.gain, t, 0.001, 100, 1, 1.3 * vel);
    return mkVoice({ srcs: [src], amp, e, rel: expmap(p.release, 0.02, 2) });
  }
};

const ENGINES = { pad: PAD, lead: LEAD, bass: BASS, guitar: GUITAR };
const PUMPS = [];   // engine callbacks run by the sequencer clock every ~20 ms (grains, vector motion, string physics)
const ENGINE_LIST = ['pad', 'lead', 'bass', 'guitar'];
function engineDefaults(name) {
  const o = {};
  ENGINES[name].params.forEach(d => { o[d.id] = d.def; });
  return o;
}

// ---------- DRUMS ----------
const DRUM_SOUNDS = ['BD.909', 'BD.808', 'BD.DEEP', 'SN.TIGHT', 'SN.FAT', 'CP.ROOM', 'RIM', 'HH.CLS', 'HH.OPN', 'CYMBAL',
  'TOM.LO', 'TOM.HI', 'COWBELL', 'PERC.07', 'SHAKER', 'ZAP'];

function dEnv(t, peak, dec, att) {
  const g = AC.createGain();
  att = att || 0.001;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(Math.max(0.0002, peak), t + att);
  g.gain.exponentialRampToValueAtTime(0.0001, t + att + dec);
  return g;
}
function dNoise(t, end) {
  const s = AC.createBufferSource(); s.buffer = AU.noise; s.loop = true;
  s.start(t, Math.random() * 1.5); s.stop(end);
  return s;
}
function wire() { for (let i = 0; i < arguments.length - 1; i++) arguments[i].connect(arguments[i + 1]); }

function dKick(c, f0, f1, sweep, dec, click) {
  const { t, r, D, tone, vel, out } = c;
  const d = dec * D;
  const o = mkOsc('sine', f0 * r, t);
  o.frequency.exponentialRampToValueAtTime(f1 * r, t + sweep);
  o.stop(t + d + 0.05);
  wire(o, dEnv(t, vel, d), out);
  if (click > 0) {
    const n = dNoise(t, t + 0.03);
    wire(n, mkFilter('highpass', 1200 + tone * 5000), dEnv(t, vel * click * (0.3 + tone), 0.012), out);
  }
}
function dSnare(c, body, nDec, nf) {
  const { t, r, D, tone, vel, out } = c;
  const o = mkOsc('triangle', body * 1.8 * r, t);
  o.frequency.exponentialRampToValueAtTime(body * r, t + 0.03);
  o.stop(t + 0.3);
  wire(o, dEnv(t, vel * 0.7, 0.1 * D), out);
  const n = dNoise(t, t + nDec * D + 0.05);
  wire(n, mkFilter('highpass', nf + tone * 2500), dEnv(t, vel * 0.8, nDec * D), out);
}
function metalBank(t, end, r) {
  const g = AC.createGain(); g.gain.value = 0.16;
  [205.3, 304.4, 369.6, 522.7, 540, 800].forEach(f => { const o = mkOsc('square', f * r, t); o.stop(end); o.connect(g); });
  return g;
}
function dHat(c, dec, open) {
  const { t, r, D, tone, vel, out, rt } = c;
  const d = dec * D, end = t + d + 0.05;
  const env = dEnv(t, vel * 0.7, d);
  const m = metalBank(t, end, r);
  wire(m, mkFilter('bandpass', 10000, 1), mkFilter('highpass', 5000 + tone * 5000), env);
  const n = dNoise(t, end);
  const ng = AC.createGain(); ng.gain.value = 0.5;
  wire(n, mkFilter('highpass', 7000 + tone * 3000), ng, env);
  env.connect(out);
  // a closed or new open hat chokes the ringing open hat
  if (rt.eng.openHat) {
    const og = rt.eng.openHat.gain;
    og.cancelScheduledValues(t); og.setTargetAtTime(0, t, 0.008);
    rt.eng.openHat = null;
  }
  if (open) rt.eng.openHat = env;
}

const DRUM_FN = {
  'BD.909': c => dKick(c, 320, 52, 0.035, 0.45, 0.8),
  'BD.808': c => dKick(c, 150, 46, 0.06, 1.2, 0.15),
  'BD.DEEP': c => dKick(c, 120, 36, 0.12, 0.8, 0.3),
  'SN.TIGHT': c => dSnare(c, 200, 0.14, 1600),
  'SN.FAT': c => dSnare(c, 160, 0.32, 800),
  'CP.ROOM': c => {
    const { t, D, tone, vel, out } = c;
    const n = dNoise(t, t + 0.4 * D + 0.1);
    const g = AC.createGain();
    g.gain.setValueAtTime(0, t);
    for (let k = 0; k < 3; k++) {
      g.gain.setValueAtTime(vel, t + k * 0.011);
      g.gain.exponentialRampToValueAtTime(0.08, t + k * 0.011 + 0.009);
    }
    g.gain.setValueAtTime(vel * 0.8, t + 0.034);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.034 + 0.25 * D);
    wire(n, mkFilter('bandpass', 1000 + tone * 1600, 1.4), g, out);
  },
  'RIM': c => {
    const { t, r, D, tone, vel, out } = c;
    const o = mkOsc('triangle', 1700 * r, t); o.stop(t + 0.1);
    const o2 = mkOsc('square', 480 * r, t); o2.stop(t + 0.1);
    const env = dEnv(t, vel * 0.6, 0.035 * D);
    const bp = mkFilter('bandpass', 1500 + tone * 2500, 2);
    o.connect(bp); o2.connect(bp); wire(bp, env, out);
  },
  'HH.CLS': c => dHat(c, 0.05, false),
  'HH.OPN': c => dHat(c, 0.42, true),
  'CYMBAL': c => {
    const { t, r, D, tone, vel, out } = c;
    const d = 1.6 * D, end = t + d + 0.05;
    const env = dEnv(t, vel * 0.55, d);
    wire(metalBank(t, end, r * 1.3), mkFilter('highpass', 4000 + tone * 4000), env);
    const n = dNoise(t, end), ng = AC.createGain(); ng.gain.value = 0.6;
    wire(n, mkFilter('highpass', 6000 + tone * 3000), ng, env);
    env.connect(out);
  },
  'TOM.LO': c => dTom(c, 105),
  'TOM.HI': c => dTom(c, 185),
  'COWBELL': c => {
    const { t, r, D, tone, vel, out } = c;
    const d = 0.3 * D;
    const bp = mkFilter('bandpass', 900 + tone * 1500, 2.5), env = dEnv(t, vel * 0.7, d);
    [540, 800].forEach(f => { const o = mkOsc('square', f * r, t); o.stop(t + d + 0.05); o.connect(bp); });
    wire(bp, env, out);
  },
  'PERC.07': c => {
    const { t, r, D, tone, vel, out } = c;
    const o = mkOsc('sine', 900 * r, t);
    o.frequency.exponentialRampToValueAtTime(620 * r, t + 0.05); o.stop(t + 0.2);
    wire(o, dEnv(t, vel * 0.7, 0.08 * D), out);
    const n = dNoise(t, t + 0.1);
    wire(n, mkFilter('bandpass', (1400 + tone * 2000) * r, 25), dEnv(t, vel * 2, 0.06 * D), out);
  },
  'SHAKER': c => {
    const { t, D, tone, vel, out } = c;
    const n = dNoise(t, t + 0.2 * D + 0.05);
    wire(n, mkFilter('bandpass', 5000 + tone * 4000, 1.5), dEnv(t, vel * 0.8, 0.07 * D, 0.02), out);
  },
  'ZAP': c => {
    const { t, r, D, vel, out } = c;
    const o = mkOsc('sine', 2400 * r, t);
    o.frequency.exponentialRampToValueAtTime(60 * r, t + 0.09 * D); o.stop(t + 0.25 * D + 0.05);
    wire(o, dEnv(t, vel * 0.8, 0.18 * D), out);
  }
};
function dTom(c, f) {
  const { t, r, D, tone, vel, out } = c;
  const o = mkOsc('sine', f * 1.7 * r, t);
  o.frequency.exponentialRampToValueAtTime(f * r, t + 0.12);
  o.stop(t + 0.6 * D + 0.05);
  wire(o, dEnv(t, vel * 0.9, 0.45 * D), out);
  const n = dNoise(t, t + 0.05);
  wire(n, mkFilter('lowpass', 1500 + tone * 4000), dEnv(t, vel * 0.25, 0.03), out);
}

const DRUM = {
  setup(rt) {
    if (!rt.rows) {
      rt.rows = [];
      for (let r = 0; r < 5; r++) {
        const g = AC.createGain(), pn = AC.createStereoPanner();
        g.connect(pn); pn.connect(rt.engIn);
        rt.rows.push({ g, pn });
      }
    }
    rt.engIn.connect(rt.input);
  },
  applyRow(rt, row, r) {
    tset(rt.rows[r].g.gain, row.level * row.level * 1.3);
    tset(rt.rows[r].pn.pan, row.pan * 2 - 1);
  },
  hit(rt, row, vel, t, r) {
    const fn = DRUM_FN[row.sound] || DRUM_FN['BD.909'];
    fn({ t, r: Math.pow(2, (row.tune - 0.5) * 2), D: expmap(row.decay, 0.25, 4), tone: row.tone, vel, out: rt.rows[r].g, rt });
  }
};
