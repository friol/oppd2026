// OPPD-1 GRAIN engine: granular synthesis over built-in sources or a resample of the last 4 s of the output
// Each note is a cloud of short windowed grains read from the source; all parameters act on the next grain.
'use strict';

const GRAIN_SOURCES = ['CHOIR', 'BELLS', 'STRING', 'GLASS', 'NOISE', 'RESAMPLE'];
const GRAIN_ROOT = 60;          // built-in sources are rendered at C4
const GRAIN_SRC = {};           // name -> AudioBuffer (filled asynchronously at startup)
let GRAIN_VOICES = [];          // active grain clouds, fed by grainPump()

// ---------- built-in sources, rendered offline (no samples shipped) ----------
function renderSource(dur, build) {
  const sr = AC.sampleRate;
  const oc = new OfflineAudioContext(1, Math.round(sr * dur), sr);
  build(oc, oc.destination, dur);
  return oc.startRendering().then(buf => {
    const d = buf.getChannelData(0);
    let pk = 0;
    for (let i = 0; i < d.length; i++) pk = Math.max(pk, Math.abs(d[i]));
    if (pk > 0) for (let i = 0; i < d.length; i++) d[i] *= 0.9 / pk;
    return buf;
  });
}
function ocNoise(oc) {
  const n = oc.createBufferSource();
  n.buffer = AU.noise; n.loop = true;
  return n;
}
const SOURCE_BUILDERS = {
  // ensemble "aah" morphing through the vowels a-e-i-o-u along the buffer
  CHOIR(oc, out, dur) {
    const mix = oc.createGain(); mix.gain.value = 0.3;
    const vib = oc.createOscillator(); vib.frequency.value = 5.2;
    const vg = oc.createGain(); vg.gain.value = 9;
    vib.connect(vg); vib.start();
    [-9, -3, 4, 10].forEach(c => {
      const o = oc.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(GRAIN_ROOT); o.detune.value = c;
      vg.connect(o.detune); o.connect(mix); o.start();
    });
    const br = ocNoise(oc), bg = oc.createGain(); bg.gain.value = 0.05; br.connect(bg); bg.connect(mix); br.start();
    const V = [[800, 1150, 2900], [400, 1700, 2600], [270, 2300, 3000], [450, 800, 2830], [325, 700, 2530]];
    const lp = oc.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 5000; lp.connect(out);
    [1, 0.5, 0.25].forEach((lvl, fi) => {
      const f = oc.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 9 - fi * 2;
      V.forEach((v, i) => f.frequency.linearRampToValueAtTime(v[fi], i / (V.length - 1) * dur));
      const g = oc.createGain(); g.gain.value = lvl * 4;
      mix.connect(f); f.connect(g); g.connect(lp);
    });
  },
  // four FM bells (C E G C) struck one after the other
  BELLS(oc, out) {
    [[0, 0], [4, 0.6], [7, 1.2], [12, 1.8]].forEach(([semi, t]) => {
      const f = mtof(GRAIN_ROOT + semi);
      const c = oc.createOscillator(); c.frequency.value = f;
      const m = oc.createOscillator(); m.frequency.value = f * 3.5;
      const mg = oc.createGain();
      mg.gain.setValueAtTime(0, 0); mg.gain.setValueAtTime(f * 4, t); mg.gain.setTargetAtTime(f * 0.3, t, 0.4);
      const a = oc.createGain();
      a.gain.setValueAtTime(0, 0); a.gain.setValueAtTime(0.5, t); a.gain.setTargetAtTime(0, t, 0.9);
      m.connect(mg); mg.connect(c.frequency); c.connect(a); a.connect(out);
      c.start(); m.start();
    });
  },
  // plucked C major strums (reuses the GUITAR string model)
  STRING(oc, out) {
    const strums = [];
    [[0, 4, 7, 12], [0, 7, 12, 16], [0, 4, 12, 19], [0, 7, 16, 24]].forEach((ch, k) => ch.forEach((semi, i) => strums.push([semi, k + i * 0.035])));
    strums.forEach(([semi, t]) => {
      const s = oc.createBufferSource();
      s.buffer = ksRender(mtof(GRAIN_ROOT + semi), 0.7, 0.3, 1.6, 0.3);
      const g = oc.createGain(); g.gain.value = 0.35;
      s.connect(g); g.connect(out); s.start(t);
    });
  },
  // shimmering Cmaj7 of soft tones with a sparkle of noise
  GLASS(oc, out, dur) {
    [0, 4, 7, 11, 19].forEach((semi, i) => {
      const o = oc.createOscillator(); o.type = i % 2 ? 'sine' : 'triangle'; o.frequency.value = mtof(GRAIN_ROOT + semi);
      const g = oc.createGain(); g.gain.value = 0.15;
      const l = oc.createOscillator(); l.frequency.value = 0.3 + i * 0.37;
      const lg = oc.createGain(); lg.gain.value = 0.12;
      l.connect(lg); lg.connect(g.gain);
      o.connect(g); g.connect(out); o.start(); l.start();
    });
    const n = ocNoise(oc), hp = oc.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7000;
    const ng = oc.createGain(); ng.gain.value = 0.02;
    n.connect(hp); hp.connect(ng); ng.connect(out); n.start();
  },
  // wind: noise through a sweeping resonant band
  NOISE(oc, out, dur) {
    const n = ocNoise(oc), bp = oc.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 5;
    bp.frequency.setValueAtTime(300, 0); bp.frequency.exponentialRampToValueAtTime(2600, dur * 0.45); bp.frequency.exponentialRampToValueAtTime(500, dur);
    const lp = oc.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 200;
    const lg = oc.createGain(); lg.gain.value = 0.5;
    n.connect(bp); bp.connect(out); n.connect(lp); lp.connect(lg); lg.connect(out); n.start();
  }
};
(function renderAllSources() {
  Object.keys(SOURCE_BUILDERS).forEach(name => {
    renderSource(4, SOURCE_BUILDERS[name]).then(b => { GRAIN_SRC[name] = b; }).catch(e => console.warn('OPPD-1: grain source', name, e && e.message));
  });
})();

// ---------- resample storage (16-bit, 24 kHz, base64 in the project) ----------
const SAMPLE_SR = 24000;
function encodeSample(f32, sr) {
  const step = sr / SAMPLE_SR, n = Math.floor(f32.length / step), i16 = new Int16Array(n);
  for (let i = 0; i < n; i++) i16[i] = clamp(Math.round(f32[Math.floor(i * step)] * 32767), -32768, 32767);
  const bytes = new Uint8Array(i16.buffer);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return { sr: SAMPLE_SR, data: btoa(s) };
}
function decodeSample(smp) {
  const bin = atob(smp.data), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const i16 = new Int16Array(bytes.buffer, 0, bytes.length >> 1);
  const buf = AC.createBuffer(1, i16.length, smp.sr), d = buf.getChannelData(0);
  for (let i = 0; i < i16.length; i++) d[i] = i16[i] / 32768;
  return buf;
}
// capture the last 4 s of the output into this part (the grabbed sound plays at its own pitch on C4)
function grainGrab(pi) {
  if (!AU.grab) { OS.toast('NOT READY'); return; }
  AU.grab().then(f32 => {
    let pk = 0;
    for (let i = 0; i < f32.length; i++) pk = Math.max(pk, Math.abs(f32[i]));
    if (pk < 0.005) { OS.toast('SILENCE: PLAY SOMETHING'); return; }
    for (let i = 0; i < f32.length; i++) f32[i] *= 0.9 / pk;
    const part = PRJ.parts[pi];
    part.sample = encodeSample(f32, AC.sampleRate);
    part.params.source = 1;
    RT[pi].eng.sampleBuf = null;
    OS.toast('GRABBED 4 s');
  });
}
function grainBuffer(rt, part) {
  const name = GRAIN_SOURCES[idxOf(part.params.source, GRAIN_SOURCES.length)];
  if (name !== 'RESAMPLE') return GRAIN_SRC[name] || null;
  if (!part.sample) return GRAIN_SRC.CHOIR || null;
  if (!rt.eng.sampleBuf || rt.eng.sampleRef !== part.sample) {
    try { rt.eng.sampleBuf = decodeSample(part.sample); rt.eng.sampleRef = part.sample; } catch (e) { return null; }
  }
  return rt.eng.sampleBuf;
}

// ---------- grains ----------
// local loudness of a source (RMS every 1024 samples), so every read position plays at a similar level
const ENV_HOP = 1024;
function srcEnvelope(buf) {
  if (buf._env) return buf._env;
  const d = buf.getChannelData(0), n = Math.ceil(d.length / ENV_HOP), env = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0, c = 0;
    for (let j = i * ENV_HOP; j < Math.min(d.length, (i + 1) * ENV_HOP); j++) { s += d[j] * d[j]; c++; }
    env[i] = Math.sqrt(s / Math.max(1, c));
  }
  return (buf._env = env);
}
function localGain(buf, pos, span) {
  const env = srcEnvelope(buf), a = Math.floor(pos * buf.sampleRate / ENV_HOP), b = Math.max(a + 1, Math.ceil((pos + span) * buf.sampleRate / ENV_HOP));
  let s = 0;
  for (let i = a; i < b && i < env.length; i++) s += env[i];
  const rms = s / Math.max(1, b - a);
  return rms < 0.003 ? 1 : clamp(0.16 / rms, 0.3, 8);   // near-silence stays quiet
}
const HANN = new Float32Array(64).map((_, i) => Math.sin(Math.PI * i / 63) ** 2);
const scanSpeed = v => { const s = (v - 0.5) * 2; return Math.abs(s) < 0.02 ? 0 : s * Math.abs(s); };
const swellEnv = v => ({ a: expmap(v, 0.004, 3), d: 0.3, s: 1, r: expmap(v, 0.12, 6) });

function spawnGrain(gv, t) {
  const p = gv.part.params, rt = gv.rt, buf = grainBuffer(rt, gv.part);
  if (!buf) return;
  const D = buf.duration, size = expmap(p.size, 0.01, 0.5);
  const cents = (Math.random() * 2 - 1) * p.spread * 45;
  const rate = Math.pow(2, (gv.note - GRAIN_ROOT) / 12 + cents / 1200);
  const span = Math.min(D * 0.9, size * rate);
  const room = Math.max(0.001, D - span);
  let pos = p.position * D + gv.ph + (Math.random() * 2 - 1) * p.spray * p.spray * D * 0.5;
  pos = ((pos % room) + room) % room;
  const src = AC.createBufferSource();
  src.buffer = buf; src.playbackRate.value = rate;
  const g = AC.createGain(); g.gain.value = 0;
  const lvl = localGain(buf, pos, span) * 0.9 / Math.sqrt(Math.max(1, expmap(p.density, 4, 80) * size));
  g.gain.setValueCurveAtTime(HANN.map(x => x * lvl), t, size);
  src.connect(g); g.connect(gv.pans[Math.floor(Math.random() * 3)]);
  src.start(t, pos, span); src.stop(t + size + 0.02);
  const rec = rt.eng.recent || (rt.eng.recent = []);
  rec.push({ f: pos / D, w: span / D, t });
  if (rec.length > 48) rec.shift();
}
// called by the sequencer clock every 20 ms: schedules the grains of every cloud ~100 ms ahead
function grainPump() {
  if (!GRAIN_VOICES.length) return;
  const now = AC.currentTime, ahead = now + 0.1;
  GRAIN_VOICES = GRAIN_VOICES.filter(gv => gv.end > now && gv.part.engine === 'grain');
  const share = Math.min(1, 6 / Math.max(1, GRAIN_VOICES.length));   // keep the total grain rate bounded
  GRAIN_VOICES.forEach(gv => {
    const p = gv.part.params, dens = expmap(p.density, 4, 80) * share;
    if (gv.next < now) gv.next = now;
    while (gv.next < ahead && gv.next < gv.end) {
      spawnGrain(gv, gv.next);
      const dt = (1 / dens) * (0.75 + Math.random() * 0.5);
      gv.ph += scanSpeed(p.scan) * dt;
      gv.next += dt;
    }
  });
}

const GRAIN = {
  name: 'GRAIN', poly: 6,
  params: [
    P('source', 'SOURCE', 0, fList(GRAIN_SOURCES), GRAIN_SOURCES.length), P('position', 'POSITION', 0.3, pct),
    P('scan', 'SCAN', 0.5, v => { const s = scanSpeed(v); return s ? (s > 0 ? '+' : '') + s.toFixed(2) + 'x' : 'FREEZE'; }), P('spray', 'SPRAY', 0.15, pct),
    P('size', 'SIZE', 0.5, fSec(0.01, 0.5)), P('density', 'DENSITY', 0.5, v => Math.round(expmap(v, 4, 80)) + '/s'),
    P('spread', 'SPREAD', 0.3, pct), P('swell', 'SWELL', 0.5, v => { const e = swellEnv(v); return fmtSec(e.a) + '/' + fmtSec(e.r); })
  ],
  hint: 'K1 PRESS = GRAB LAST 4 s',
  press: { source: pi => grainGrab(pi) },
  env: p => swellEnv(p.swell),
  play(rt, part, note, vel, t) {
    const p = part.params, env = swellEnv(p.swell);
    const amp = AC.createGain(); amp.gain.value = 0;
    amp.connect(rt.engIn);
    const pans = [-1, 0, 1].map(k => { const pn = AC.createStereoPanner(); pn.pan.value = k * p.spread; pn.connect(amp); return pn; });
    const e = envStart(amp.gain, t, env.a, env.d, env.s, 0.65 * vel);
    // a silent source only carries the voice lifetime (onended -> cleanup)
    const life = AC.createConstantSource(); life.offset.value = 0; life.connect(amp); life.start(t);
    const gv = { rt, part, note, next: t, end: Infinity, ph: 0, pans };
    GRAIN_VOICES.push(gv);
    const v = mkVoice({
      srcs: [life], amp, e, rel: env.r,
      cleanup: () => { gv.end = 0; },
      live(id) { if (id === 'spread') pans.forEach((pn, k) => tset(pn.pan, (k - 1) * p.spread)); }
    });
    const stop = v.stop, kill = v.kill;
    v.stop = function (tt) { stop.call(this, tt); gv.end = Math.min(gv.end, this.relAt + env.r * 1.3); };
    v.kill = function (tt) { kill.call(this, tt); gv.end = Math.min(gv.end, this.relAt + 0.05); };
    return v;
  }
};
ENGINES.grain = GRAIN;
PUMPS.push(grainPump);
ENGINE_LIST.push('grain');
