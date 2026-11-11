// OPPD-1 MACRO engine (in the spirit of a "macro oscillator"): one engine, eight models, always the same three
// macro knobs (HARMONICS, TIMBRE, MORPH) whose meaning depends on the model, followed by a low pass gate.
'use strict';

const MACRO_MODELS = ['VA', 'FOLD', 'CHORD', 'SWARM', 'STRING', 'MODAL', 'PARTICLE', 'SPEECH'];
// what the three macros do in each model (shown on the display)
const MACRO_HELP = {
  VA: ['DETUNE', 'CUTOFF', 'SAW>SQR'], FOLD: ['FM', 'FOLD', 'SYMMETRY'], CHORD: ['CHORD', 'INVERSION', 'BRIGHT'],
  SWARM: ['SPREAD', 'DENSITY', 'BRIGHT'], STRING: ['BRIGHT', 'DAMP', 'DECAY'], MODAL: ['INHARM', 'BRIGHT', 'DAMPING'],
  PARTICLE: ['DENSITY', 'PITCH', 'CHAOS'], SPEECH: ['SIZE', 'VOWEL', 'NOISE']
};
const MACRO_CHORDS = [['OCT', [0, 12]], ['5TH', [0, 7, 12]], ['SUS4', [0, 5, 7]], ['MIN', [0, 3, 7]], ['MAJ', [0, 4, 7]],
  ['MIN7', [0, 3, 7, 10]], ['MAJ7', [0, 4, 7, 11]], ['ADD9', [0, 4, 7, 14]], ['4THS', [0, 5, 10, 15]]];
const MODAL_BAR = [1, 2.756, 5.404, 8.933, 13.34, 18.64];   // free bar (marimba-like) partial ratios
const macroModel = p => MACRO_MODELS[idxOf(p.model, MACRO_MODELS.length)];
const macroEnv = p => ({ a: 0.003, d: expmap(p.decay, 0.05, 4), s: p.sustain, r: expmap(p.release, 0.02, 4) });
const chordOf = p => MACRO_CHORDS[idxOf(p.harmonics, MACRO_CHORDS.length)];

// each model builds its sources into `dest` and returns { srcs, live(id) }
const MACRO_BUILD = {
  VA(p, f, t, dest) {
    const lp = mkFilter('lowpass', expmap(p.timbre, 200, 16000), 3), g1 = AC.createGain(), g2 = AC.createGain();
    const o1 = mkOsc('sawtooth', f, t), o2 = mkOsc('square', f, t);
    o2.detune.value = p.harmonics * 1200;
    g1.gain.value = 0.5 * (1 - p.morph); g2.gain.value = 0.4 * (0.3 + p.morph);
    o1.connect(g1); o2.connect(g2); g1.connect(lp); g2.connect(lp); lp.connect(dest);
    return {
      srcs: [o1, o2], live(id) {
        if (id === 'harmonics') tset(o2.detune, p.harmonics * 1200);
        else if (id === 'timbre') tset(lp.frequency, expmap(p.timbre, 200, 16000));
        else if (id === 'morph') { tset(g1.gain, 0.5 * (1 - p.morph)); tset(g2.gain, 0.4 * (0.3 + p.morph)); }
      }
    };
  },
  FOLD(p, f, t, dest) {
    const o = mkOsc('sine', f, t), m = mkOsc('sine', f * 2, t), mg = AC.createGain();
    mg.gain.value = p.harmonics * p.harmonics * 3 * f * 2;
    m.connect(mg); mg.connect(o.frequency);
    const g = AC.createGain(); g.gain.value = foldGain(p.timbre);
    const off = AC.createConstantSource(); off.offset.value = foldSym(p.morph); off.start(t);
    const sh = AC.createWaveShaper(); sh.curve = FOLD_CURVE; sh.oversample = '4x';
    const out = AC.createGain(); out.gain.value = 0.5;
    o.connect(g); g.connect(sh); off.connect(sh); sh.connect(out); out.connect(dest);
    return {
      srcs: [o, m, off], live(id) {
        if (id === 'harmonics') tset(mg.gain, p.harmonics * p.harmonics * 3 * f * 2);
        else if (id === 'timbre') tset(g.gain, foldGain(p.timbre));
        else if (id === 'morph') tset(off.offset, foldSym(p.morph));
      }
    };
  },
  CHORD(p, f, t, dest) {
    const lp = mkFilter('lowpass', expmap(p.morph, 300, 14000), 0.8);
    lp.connect(dest);
    const oscs = [], gains = [];
    const notes = () => {
      const iv = chordOf(p)[1], inv = Math.round(p.timbre * 3);
      return iv.map((s, k) => s + (k < inv ? 12 : 0));
    };
    for (let k = 0; k < 4; k++) {
      const o = mkOsc('sawtooth', f, t), g = AC.createGain();
      o.connect(g); g.connect(lp); oscs.push(o); gains.push(g);
    }
    const tune = smooth => {
      const ns = notes();
      oscs.forEach((o, k) => {
        const on = k < ns.length, fr = f * Math.pow(2, (on ? ns[k] : 0) / 12), gv = on ? 0.45 / Math.sqrt(ns.length) : 0;
        if (smooth) { tset(o.frequency, fr); tset(gains[k].gain, gv); } else { o.frequency.setValueAtTime(fr, t); gains[k].gain.value = gv; }
      });
    };
    tune(false);
    return { srcs: oscs, live(id) { if (id === 'harmonics' || id === 'timbre') tune(true); else if (id === 'morph') tset(lp.frequency, expmap(p.morph, 300, 14000)); } };
  },
  SWARM(p, f, t, dest) {
    const lp = mkFilter('lowpass', expmap(p.morph, 300, 14000), 0.7);
    lp.connect(dest);
    const oscs = [], gains = [], seeds = [];
    for (let k = 0; k < 8; k++) {
      const o = mkOsc('sawtooth', f, t), g = AC.createGain(), pn = AC.createStereoPanner(), sd = Math.random() * 2 - 1;
      o.detune.value = sd * p.harmonics * 50;
      pn.pan.value = (k / 7) * 1.6 - 0.8;
      g.gain.value = k < 2 + p.timbre * 6 ? 0.18 : 0;
      o.connect(g); g.connect(pn); pn.connect(lp);
      oscs.push(o); gains.push(g); seeds.push(sd);
    }
    return {
      srcs: oscs, live(id) {
        if (id === 'harmonics') oscs.forEach((o, k) => tset(o.detune, seeds[k] * p.harmonics * 50));
        else if (id === 'timbre') gains.forEach((g, k) => tset(g.gain, k < 2 + p.timbre * 6 ? 0.18 : 0));
        else if (id === 'morph') tset(lp.frequency, expmap(p.morph, 300, 14000));
      }
    };
  },
  STRING(p, f, t, dest) {
    const s = AC.createBufferSource();
    s.buffer = ksRender(f, 0.25 + p.harmonics * 0.75, p.timbre, expmap(p.morph, 0.3, 6), 0.3);
    const g = AC.createGain(); g.gain.value = 1.1;
    s.connect(g); g.connect(dest); s.start(t);
    return { srcs: [s], live() { } };
  },
  MODAL(p, f, t, dest) {
    const srcs = [], D = expmap(p.decay, 0.05, 4);
    MODAL_BAR.forEach((bar, i) => {
      const k = i + 1, ratio = lin(p.harmonics, k, bar), fr = f * ratio;
      if (fr > AC.sampleRate * 0.45) return;
      const o = mkOsc('sine', fr, t), g = AC.createGain();
      const a = Math.pow(k, -(2 - p.timbre * 1.8)) * 0.5, dk = D * Math.pow(k, -p.morph * 1.5);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(a, t + 0.002); g.gain.setTargetAtTime(0, t + 0.002, Math.max(0.01, dk / 4));
      o.connect(g); g.connect(dest); srcs.push(o);
    });
    return { srcs, live() { } };
  },
  PARTICLE(p, f, t, dest) {
    const life = AC.createConstantSource(); life.offset.value = 0; life.connect(dest); life.start(t);
    if (!AU.crusherOk) return { srcs: [life], live() { } };
    const node = new AudioWorkletNode(AC, 'oppd-pulsar', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1] });
    const prm = n => node.parameters.get(n), g = AC.createGain(); g.gain.value = 2.2;
    prm('freq').value = expmap(p.harmonics, 3, 120); prm('formant').value = f * expmap(p.timbre, 0.5, 4);
    prm('wave').value = 0; prm('win').value = 1; prm('mask').value = 0.35; prm('jitter').value = p.morph;
    node.connect(g); g.connect(dest);
    return {
      srcs: [life],
      cleanup: () => { node.port.postMessage('stop'); try { node.disconnect(); } catch (e) { /* gone */ } },
      live(id) {
        if (id === 'harmonics') tset(prm('freq'), expmap(p.harmonics, 3, 120));
        else if (id === 'timbre') tset(prm('formant'), f * expmap(p.timbre, 0.5, 4));
        else if (id === 'morph') tset(prm('jitter'), p.morph);
      }
    };
  },
  SPEECH(p, f, t, dest) {
    const src = AC.createGain(), o = mkOsc('sawtooth', f, t), og = AC.createGain();
    og.gain.value = 0.5 * (1 - p.morph * 0.7);
    o.connect(og); og.connect(src);
    const nz = AC.createBufferSource(); nz.buffer = AU.noise; nz.loop = true; nz.start(t, Math.random());
    const ng = AC.createGain(); ng.gain.value = p.morph * 1.4;
    nz.connect(ng); ng.connect(src);
    const fs = vocalFormants(p.timbre * 4, p.harmonics), bps = [];
    fs.forEach((fr, k) => {
      const bp = mkFilter('bandpass', fr, k ? 12 : 8), g = AC.createGain();
      g.gain.value = VOCAL_GAIN[k] * 2.6;
      src.connect(bp); bp.connect(g); g.connect(dest); bps.push(bp);
    });
    return {
      srcs: [o, nz], live(id) {
        if (id === 'timbre' || id === 'harmonics') vocalFormants(p.timbre * 4, p.harmonics).forEach((fr, k) => tset(bps[k].frequency, fr));
        else if (id === 'morph') { tset(og.gain, 0.5 * (1 - p.morph * 0.7)); tset(ng.gain, p.morph * 1.4); }
      }
    };
  }
};

const MACRO = {
  name: 'MACRO', poly: 6,
  params: [
    P('model', 'MODEL', 0, fList(MACRO_MODELS), MACRO_MODELS.length),
    P('harmonics', 'HARMONICS', 0.3, function (v) { return 'H ' + Math.round(v * 100); }),
    P('timbre', 'TIMBRE', 0.5, v => 'T ' + Math.round(v * 100)), P('morph', 'MORPH', 0.5, v => 'M ' + Math.round(v * 100)),
    P('decay', 'DECAY', 0.5, fSec(0.05, 4)), P('sustain', 'SUSTAIN', 0.6, pct), P('lpg', 'LPG', 0.3, pct), P('release', 'RELEASE', 0.35, fSec(0.02, 4))
  ],
  env: p => macroEnv(p),
  play(rt, part, note, vel, t) {
    const p = part.params, f = mtof(note), env = macroEnv(p), model = macroModel(p);
    const lpg = mkFilter('lowpass', 18000 * Math.pow(2, -p.lpg * 6), 0.8);
    const amp = AC.createGain(); amp.gain.value = 0;
    lpg.connect(amp); amp.connect(rt.engIn);
    const m = MACRO_BUILD[model](p, f, t, lpg);
    const le = envStart(lpg.detune, t, env.a, env.d, env.s, p.lpg * 7200);
    // MODAL sounds are struck: their partials decay on their own, so the gate stays open
    const e = envStart(amp.gain, t, env.a, model === 'MODAL' ? 100 : env.d, model === 'MODAL' ? 1 : env.s, 0.6 * vel);
    return mkVoice({
      srcs: m.srcs, amp, e, rel: env.r,
      onStop: (tt, r) => envStop(lpg.detune, le, tt, r),
      cleanup: () => { if (m.cleanup) m.cleanup(); },
      live(id) { if (id === 'lpg') tset(lpg.frequency, 18000 * Math.pow(2, -p.lpg * 6)); else m.live(id); }
    });
  },
  // the eight models (current one lit), what the macros mean here, and a live scope
  view(g, pi, x, y, w, h) {
    const p = PRJ.parts[pi].params, model = macroModel(p), cw = w / 4;
    MACRO_MODELS.forEach((n, i) => {
      const cx = x + (i % 4) * cw, cy = y + Math.floor(i / 4) * 13, on = n === model;
      if (on) { g.fillStyle = C.accent; g.fillRect(cx, cy, cw - 3, 11); }
      T(g, n, cx + (cw - 3) / 2, cy + 8.5, 7.5, on ? C.bg : C.dim, 'center', on ? 700 : 400);
    });
    const help = MACRO_HELP[model];
    ['harmonics', 'timbre', 'morph'].forEach((id, i) => {
      const yy = y + 32 + i * 9;
      T(g, help[i], x, yy + 6, 7, KC[i + 1]);
      g.fillStyle = C.line; g.fillRect(x + 62, yy + 2, w - 62, 3);
      g.fillStyle = KC[i + 1]; g.fillRect(x + 62, yy + 2, (w - 62) * p[id], 3);
    });
    if (model === 'CHORD') T(g, chordOf(p)[0], x + w, y + 38, 8, C.ink, 'right', 600);
    drawScope(g, RT[pi].an, x, y + h - 14, w, 14, C.accent);
  }
};
ENGINES.macro = MACRO;
ENGINE_LIST.push('macro');
