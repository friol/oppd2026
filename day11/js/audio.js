// OPPD-1 audio core: context, master bus, helpers, envelopes, effect slots and the per-part audio chain
'use strict';

const AC = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });

// ---------- small helpers ----------
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lin = (v, a, b) => a + (b - a) * v;
const expmap = (v, a, b) => a * Math.pow(b / a, v);
const mtof = n => 440 * Math.pow(2, (n - 69) / 12);
const idxOf = (v, n) => clamp(Math.round(v * (n - 1)), 0, n - 1);
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteName = n => NOTE_NAMES[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1);
const fmtHz = f => f >= 1000 ? (f / 1000).toFixed(f >= 10000 ? 0 : 1) + 'k' : f >= 100 ? Math.round(f) + 'Hz' : f.toFixed(f >= 10 ? 1 : 2) + 'Hz';
const fmtSec = s => s >= 1 ? s.toFixed(1) + 's' : Math.round(s * 1000) + 'ms';
const pct = v => Math.round(v * 100) + '%';

function tset(param, v, tc) { param.setTargetAtTime(v, AC.currentTime, tc || 0.02); }

// ---------- envelopes ----------
// Attack (linear) to peak, decay (exponential, time constant d/3) to sustain*peak.
function envStart(param, t, a, d, s, peak) {
  param.cancelScheduledValues(t);
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(peak, t + a);
  param.setTargetAtTime(peak * s, t + a, Math.max(0.001, d / 3));
  return { t0: t, a, d, s, peak };
}
// value of an envelope started with envStart at time t (used to release from the right level)
function envAt(e, t) {
  const dt = t - e.t0;
  if (dt <= 0) return 0;
  if (dt < e.a) return e.peak * dt / e.a;
  return e.peak * (e.s + (1 - e.s) * Math.exp(-(dt - e.a) / Math.max(0.001, e.d / 3)));
}
function envStop(param, e, t, r) {
  t = Math.max(t, AC.currentTime);
  const v = envAt(e, t);
  if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(t); else param.cancelScheduledValues(t);
  param.setValueAtTime(v, t);
  param.setTargetAtTime(0, t, Math.max(0.002, r / 4));
}

// ---------- master bus ----------
const AU = { bus: null, out: null, analyser: null, noise: null, crusherOk: false };
(function initCore() {
  const bus = AC.createGain(); bus.gain.value = 0.8;
  const comp = AC.createDynamicsCompressor();
  comp.threshold.value = -10; comp.knee.value = 8; comp.ratio.value = 5;
  comp.attack.value = 0.003; comp.release.value = 0.2;
  const out = AC.createGain(); out.gain.value = 0.8;
  const an = AC.createAnalyser(); an.fftSize = 1024;
  bus.connect(comp); comp.connect(out); out.connect(an); an.connect(AC.destination);
  AU.bus = bus; AU.out = out; AU.analyser = an;

  const len = AC.sampleRate * 2;
  const nb = AC.createBuffer(1, len, AC.sampleRate);
  const d = nb.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  AU.noise = nb;
})();

// ---------- distortion curves ----------
const _curves = {};
function driveCurve(k) {
  k = Math.round(k * 10) / 10;
  if (_curves[k]) return _curves[k];
  const n = 2048, c = new Float32Array(n), d = Math.tanh(k);
  for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; c[i] = Math.tanh(k * x) / d; }
  return (_curves[k] = c);
}
// pre gain -> waveshaper -> post gain, used by engines with a DRIVE parameter
function DriveStage() {
  const pre = AC.createGain(), sh = AC.createWaveShaper(), post = AC.createGain();
  sh.oversample = '2x';
  pre.connect(sh); sh.connect(post);
  return {
    inp: pre, out: post,
    set(v) { sh.curve = driveCurve(1 + v * v * 24); tset(pre.gain, 1 + v * 3); tset(post.gain, 1 / (1 + v * 1.6)); }
  };
}

// ---------- reverb impulse ----------
function makeIR(sec) {
  const sr = AC.sampleRate, n = Math.floor(sr * sec), b = AC.createBuffer(2, n, sr);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / n;
      lp += 0.6 * ((Math.random() * 2 - 1) - lp);
      d[i] = lp * Math.pow(1 - t, 2.2) * (i < sr * 0.004 ? i / (sr * 0.004) : 1);
    }
  }
  return b;
}

// ---------- bitcrusher worklet (data: URL so it also loads from file://) ----------
const CRUSH_SRC = `  // worklet module: bitcrusher + output tap
class OppdCrusher extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: 'bits', defaultValue: 8, minValue: 1, maxValue: 16 },
            { name: 'down', defaultValue: 4, minValue: 1, maxValue: 64 }];
  }
  constructor() { super(); this.ph = 0; this.h = [0, 0]; }
  process(inputs, outputs, params) {
    const inp = inputs[0], out = outputs[0];
    const q = Math.pow(2, params.bits[0] - 1), down = params.down[0];
    let ph = this.ph;
    for (let c = 0; c < out.length; c++) {
      const i = inp[c] || inp[0], o = out[c];
      if (!i) { o.fill(0); continue; }
      let p = this.ph, h = this.h[c] || 0;
      for (let n = 0; n < o.length; n++) {
        p += 1;
        if (p >= down) { p -= down; h = Math.round(i[n] * q) / q; }
        o[n] = h;
      }
      this.h[c] = h; ph = p;
    }
    this.ph = ph;
    return true;
  }
}
registerProcessor('oppd-crusher', OppdCrusher);

// ring buffer of the master output, sent back on request (used by the GRAIN engine's RESAMPLE)
class OppdTap extends AudioWorkletProcessor {
  constructor(o) {
    super();
    this.n = o.processorOptions.len; this.buf = new Float32Array(this.n); this.w = 0;
    this.port.onmessage = () => {
      const out = new Float32Array(this.n);
      out.set(this.buf.subarray(this.w)); out.set(this.buf.subarray(0, this.w), this.n - this.w);
      this.port.postMessage(out, [out.buffer]);
    };
  }
  process(inputs) {
    const i = inputs[0];
    if (i && i[0]) {
      const l = i[0], r = i[1] || l;
      for (let k = 0; k < l.length; k++) { this.buf[this.w] = (l[k] + r[k]) * 0.5; this.w = (this.w + 1) % this.n; }
    }
    return true;
  }
}
registerProcessor('oppd-tap', OppdTap);

// pulsar train: a pulsaret (3 cycles of a waveform under a window) at the start of every period, silence after it
class OppdPulsar extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    const k = 'k-rate';
    return [
      { name: 'freq', defaultValue: 110, minValue: 0.01, maxValue: 20000, automationRate: k },
      { name: 'formant', defaultValue: 440, minValue: 1, maxValue: 22000, automationRate: k },
      { name: 'wave', defaultValue: 0, minValue: 0, maxValue: 3, automationRate: k },
      { name: 'win', defaultValue: 0, minValue: 0, maxValue: 3, automationRate: k },
      { name: 'mask', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: k },
      { name: 'jitter', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: k }
    ];
  }
  constructor() {
    super();
    this.ph = 0.9999; this.pp = 2; this.play = false; this.fc = 440; this.amp = 1; this.dead = false;
    this.port.onmessage = () => { this.dead = true; };
  }
  process(inputs, outputs, P) {
    const o = outputs[0] && outputs[0][0];
    if (!o) return !this.dead;
    const sr = sampleRate, dT = P.freq[0] / sr, ff = P.formant[0];
    const wave = Math.round(P.wave[0]), win = Math.round(P.win[0]), mask = P.mask[0], jit = P.jitter[0];
    const CYC = 3;
    for (let n = 0; n < o.length; n++) {
      this.ph += dT;
      if (this.ph >= 1) {
        this.ph -= Math.floor(this.ph);
        this.play = Math.random() >= mask;                     // stochastic masking
        this.pp = 0;
        this.fc = ff * (1 + (Math.random() * 2 - 1) * jit * 0.4);
        this.amp = 1 - jit * 0.6 * Math.random();
      }
      let y = 0;
      if (this.play && this.pp < 1) {
        const x = this.pp, c = x * CYC;
        let w;
        if (win === 0) { const u = (x - 0.5) / 0.2; w = Math.exp(-0.5 * u * u); }
        else if (win === 1) w = Math.exp(-6 * x) * Math.min(1, x * 40);
        else if (win === 2) w = Math.min(1, x * 40, (1 - x) * 40);
        else w = Math.exp(-6 * (1 - x)) * Math.min(1, (1 - x) * 40);
        let s;
        if (wave === 0) s = Math.sin(2 * Math.PI * c);
        else if (wave === 1) s = 2 * (c - Math.floor(c)) - 1;
        else if (wave === 2) s = (c - Math.floor(c)) < 0.5 ? 1 : -1;
        else s = Math.random() * 2 - 1;
        y = s * w * this.amp;
        this.pp += this.fc / (CYC * sr);
      }
      o[n] = y;
    }
    return !this.dead;
  }
}
registerProcessor('oppd-pulsar', OppdPulsar);

// FOF (formant wave functions): at every period of the voice, each of 5 formants starts a damped sinusoid grain
// with a smooth attack ("skirt"); the formant data (f, amplitude, bandwidth) comes from the main thread.
class OppdFof extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    const k = 'k-rate', d = [{ name: 'freq', defaultValue: 220, minValue: 10, maxValue: 4000, automationRate: k },
      { name: 'vib', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: k },
      { name: 'jitter', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: k },
      { name: 'skirt', defaultValue: 0.003, minValue: 0.0005, maxValue: 0.02, automationRate: k }];
    for (let i = 0; i < 5; i++) {
      d.push({ name: 'f' + i, defaultValue: 500, minValue: 50, maxValue: 12000, automationRate: k });
      d.push({ name: 'a' + i, defaultValue: 0, minValue: 0, maxValue: 2, automationRate: k });
      d.push({ name: 'b' + i, defaultValue: 80, minValue: 10, maxValue: 2000, automationRate: k });
    }
    return d;
  }
  constructor() {
    super();
    const N = 64;
    this.N = N; this.on = new Uint8Array(N); this.f = new Float64Array(N); this.ph = new Float64Array(N);
    this.env = new Float64Array(N); this.dec = new Float64Array(N); this.age = new Float64Array(N); this.rise = new Float64Array(N);
    this.p = 0.9999; this.vp = Math.random(); this.drift = 0; this.dead = false;
    this.port.onmessage = () => { this.dead = true; };
  }
  process(inputs, outputs, P) {
    const o = outputs[0] && outputs[0][0];
    if (!o) return !this.dead;
    const sr = sampleRate, f0 = P.freq[0], vib = P.vib[0], jit = P.jitter[0], rise = Math.max(1, P.skirt[0] * sr);
    const TWO_PI = Math.PI * 2, maxAge = 0.05 * sr, N = this.N;
    for (let n = 0; n < o.length; n++) {
      this.vp += 5.4 / sr;
      this.drift += (Math.random() - 0.5) * 0.002 * jit;
      this.drift *= 0.999;
      const fr = f0 * (1 + vib * 0.025 * Math.sin(TWO_PI * this.vp) + this.drift);
      this.p += fr / sr;
      if (this.p >= 1) {
        this.p -= Math.floor(this.p);
        for (let k = 0; k < 5; k++) {
          const a = P['a' + k][0];
          if (a < 1e-4) continue;
          let s = 0;
          while (s < N && this.on[s]) s++;
          if (s >= N) break;
          this.on[s] = 1;
          this.f[s] = P['f' + k][0] * (1 + (Math.random() - 0.5) * jit * 0.03);
          this.ph[s] = 0; this.age[s] = 0; this.rise[s] = rise;
          this.env[s] = a * (1 - jit * 0.35 * Math.random());
          this.dec[s] = Math.exp(-Math.PI * P['b' + k][0] / sr);
        }
      }
      let y = 0;
      for (let s = 0; s < N; s++) {
        if (!this.on[s]) continue;
        const ag = this.age[s], r = this.rise[s];
        const att = ag < r ? 0.5 * (1 - Math.cos(Math.PI * ag / r)) : 1;
        y += Math.sin(this.ph[s]) * this.env[s] * att;
        this.ph[s] += TWO_PI * this.f[s] / sr;
        this.env[s] *= this.dec[s];
        this.age[s] = ag + 1;
        if (this.env[s] < 1e-4 || ag > maxAge) this.on[s] = 0;
      }
      o[n] = y;
    }
    return !this.dead;
  }
}
registerProcessor('oppd-fof', OppdFof);`;
const TAP_SECONDS = 4;
// AU.grab() resolves with the last TAP_SECONDS of the output (mono Float32Array at AC.sampleRate)
function initTap(worklet) {
  const len = Math.round(AC.sampleRate * TAP_SECONDS);
  const sink = AC.createGain(); sink.gain.value = 0; sink.connect(AC.destination);
  if (worklet) {
    const node = new AudioWorkletNode(AC, 'oppd-tap', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], processorOptions: { len } });
    AU.out.connect(node); node.connect(sink);
    AU.grab = () => new Promise(res => { node.port.onmessage = e => res(e.data); node.port.postMessage('grab'); });
  } else {
    const sp = AC.createScriptProcessor(2048, 2, 1), buf = new Float32Array(len);
    let w = 0;
    sp.onaudioprocess = e => {
      const l = e.inputBuffer.getChannelData(0), r = e.inputBuffer.getChannelData(1);
      for (let k = 0; k < l.length; k++) { buf[w] = (l[k] + r[k]) * 0.5; w = (w + 1) % len; }
    };
    AU.out.connect(sp); sp.connect(sink);
    AU.grab = () => Promise.resolve((() => { const o = new Float32Array(len); o.set(buf.subarray(w)); o.set(buf.subarray(0, w), len - w); return o; })());
  }
}
if (AC.audioWorklet) {
  AC.audioWorklet.addModule('data:application/javascript;charset=utf-8,' + encodeURIComponent(CRUSH_SRC))
    .then(() => { AU.crusherOk = true; initTap(true); })
    .catch(e => { console.warn('OPPD-1: AudioWorklet unavailable, using ScriptProcessor', e && e.message); initTap(false); });
} else initTap(false);
function makeCrusher() {
  if (AU.crusherOk) {
    const node = new AudioWorkletNode(AC, 'oppd-crusher', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
    return { node, set(bits, down) { tset(node.parameters.get('bits'), bits, 0.01); node.parameters.get('down').setValueAtTime(down, AC.currentTime); } };
  }
  const sp = AC.createScriptProcessor(1024, 2, 2);
  let bits = 8, down = 4, ph = 0;
  const h = [0, 0];
  sp.onaudioprocess = e => {
    const q = Math.pow(2, bits - 1), ib = e.inputBuffer, ob = e.outputBuffer;
    let ph2 = ph;
    for (let c = 0; c < ob.numberOfChannels; c++) {
      const i = ib.getChannelData(Math.min(c, ib.numberOfChannels - 1)), o = ob.getChannelData(c);
      let p = ph, hv = h[c];
      for (let n = 0; n < o.length; n++) {
        p += 1;
        if (p >= down) { p -= down; hv = Math.round(i[n] * q) / q; }
        o[n] = hv;
      }
      h[c] = hv; ph2 = p;
    }
    ph = ph2;
  };
  return { node: sp, set(b, d) { bits = b; down = d; } };
}

// ---------- effects ----------
function lfoNode(freq, depth) {
  const o = AC.createOscillator(); o.frequency.value = freq;
  const g = AC.createGain(); g.gain.value = depth;
  o.connect(g); o.start();
  return { o, g };
}
const DELAY_DIVS = [['1/32', 0.125], ['1/16T', 1 / 6], ['1/16', 0.25], ['1/8T', 1 / 3], ['1/8', 0.5], ['1/4T', 2 / 3],
  ['1/8D', 0.75], ['1/4', 1], ['1/4D', 1.5], ['1/2', 2]];

const FX_TYPES = ['OFF', 'DELAY', 'REVERB', 'CHORUS', 'FLANGER', 'PHASER', 'DISTORT', 'BITCRUSH', 'FILTER', 'TREMOLO'];
const FX_DEFS = {
  OFF: { p: ['-', '-'], fmt: [() => '-', () => '-'] },
  DELAY: {
    send: true, p: ['TIME', 'FEEDBK'], fmt: [v => DELAY_DIVS[idxOf(v, DELAY_DIVS.length)][0], pct],
    build() {
      const inp = AC.createGain(), d = AC.createDelay(4), fb = AC.createGain(), lp = AC.createBiquadFilter(), out = AC.createGain();
      lp.type = 'lowpass'; lp.frequency.value = 5000;
      inp.connect(d); d.connect(lp); lp.connect(fb); fb.connect(d); lp.connect(out);
      return { inp, out, set(p1, p2, bpm) { tset(d.delayTime, DELAY_DIVS[idxOf(p1, DELAY_DIVS.length)][1] * 60 / bpm, 0.05); tset(fb.gain, p2 * 0.9); } };
    }
  },
  REVERB: {
    send: true, p: ['SIZE', 'DAMP'], fmt: [v => (0.3 + v * 5.5).toFixed(1) + 's', pct],
    build() {
      const inp = AC.createGain(), cv = AC.createConvolver(), lp = AC.createBiquadFilter(), out = AC.createGain();
      lp.type = 'lowpass';
      inp.connect(cv); cv.connect(lp); lp.connect(out);
      let size = -1, timer = 0;
      return {
        inp, out,
        set(p1, p2) {
          if (Math.abs(p1 - size) > 0.01) {
            const first = size < 0;
            size = p1; clearTimeout(timer);
            const mk = () => { cv.buffer = makeIR(0.3 + size * 5.5); };
            if (first) mk(); else timer = setTimeout(mk, 150);
          }
          tset(lp.frequency, expmap(1 - p2, 1200, 15000));
        },
        stop() { clearTimeout(timer); }
      };
    }
  },
  CHORUS: {
    p: ['RATE', 'DEPTH'], fmt: [v => fmtHz(expmap(v, 0.1, 6)), pct],
    build() {
      const inp = AC.createGain(), out = AC.createGain(), mg = AC.createChannelMerger(2);
      const dl = AC.createDelay(0.1), dr = AC.createDelay(0.1);
      dl.delayTime.value = 0.017; dr.delayTime.value = 0.021;
      const l1 = lfoNode(0.5, 0.003), l2 = lfoNode(0.6, 0.003);
      l1.g.connect(dl.delayTime); l2.g.connect(dr.delayTime);
      inp.connect(dl); inp.connect(dr); dl.connect(mg, 0, 0); dr.connect(mg, 0, 1); mg.connect(out);
      return {
        inp, out,
        set(p1, p2) { const r = expmap(p1, 0.1, 6); tset(l1.o.frequency, r); tset(l2.o.frequency, r * 1.13); tset(l1.g.gain, p2 * 0.007); tset(l2.g.gain, p2 * 0.007); },
        stop() { l1.o.stop(); l2.o.stop(); }
      };
    }
  },
  FLANGER: {
    p: ['RATE', 'DEPTH'], fmt: [v => fmtHz(expmap(v, 0.05, 5)), pct],
    build() {
      const inp = AC.createGain(), out = AC.createGain(), d = AC.createDelay(0.05), fb = AC.createGain();
      d.delayTime.value = 0.004; fb.gain.value = 0.7;
      const l = lfoNode(0.3, 0.002);
      l.g.connect(d.delayTime);
      inp.connect(d); d.connect(fb); fb.connect(d); d.connect(out);
      return {
        inp, out,
        set(p1, p2) { tset(l.o.frequency, expmap(p1, 0.05, 5)); tset(l.g.gain, 0.0002 + p2 * 0.0034); },
        stop() { l.o.stop(); }
      };
    }
  },
  PHASER: {
    p: ['RATE', 'DEPTH'], fmt: [v => fmtHz(expmap(v, 0.05, 6)), pct],
    build() {
      const inp = AC.createGain(), out = AC.createGain(), fb = AC.createGain();
      fb.gain.value = 0.45;
      const l = lfoNode(0.4, 500);
      const st = [];
      for (let i = 0; i < 4; i++) {
        const a = AC.createBiquadFilter(); a.type = 'allpass'; a.frequency.value = 400 + i * 300; a.Q.value = 0.6;
        l.g.connect(a.frequency);
        if (i) st[i - 1].connect(a);
        st.push(a);
      }
      inp.connect(st[0]); st[3].connect(out); st[3].connect(fb); fb.connect(st[0]);
      return {
        inp, out,
        set(p1, p2) { tset(l.o.frequency, expmap(p1, 0.05, 6)); tset(l.g.gain, 100 + p2 * 900); },
        stop() { l.o.stop(); }
      };
    }
  },
  DISTORT: {
    p: ['DRIVE', 'TONE'], fmt: [pct, v => fmtHz(expmap(v, 800, 14000))],
    build() {
      const inp = AC.createGain(), sh = AC.createWaveShaper(), lp = AC.createBiquadFilter(), out = AC.createGain();
      sh.oversample = '4x'; lp.type = 'lowpass';
      inp.connect(sh); sh.connect(lp); lp.connect(out);
      return {
        inp, out,
        set(p1, p2) { sh.curve = driveCurve(1 + p1 * p1 * 40); tset(inp.gain, 1 + p1 * 4); tset(out.gain, 0.9 / (1 + p1 * 1.5)); tset(lp.frequency, expmap(p2, 800, 14000)); }
      };
    }
  },
  BITCRUSH: {
    p: ['BITS', 'RATE'], fmt: [v => Math.round(16 - v * 14) + 'b', v => '/' + (1 + Math.round(v * v * 40))],
    build() {
      const inp = AC.createGain(), out = AC.createGain(), c = makeCrusher();
      inp.connect(c.node); c.node.connect(out);
      return { inp, out, set(p1, p2) { c.set(Math.round(16 - p1 * 14), 1 + Math.round(p2 * p2 * 40)); }, stop() { c.node.onaudioprocess = null; } };
    }
  },
  FILTER: {
    p: ['CUTOFF', 'LFO'], fmt: [v => fmtHz(expmap(v, 80, 14000)), v => v < 0.02 ? 'OFF' : fmtHz(expmap(v, 0.1, 12))],
    build() {
      const inp = AC.createGain(), f = AC.createBiquadFilter(), out = AC.createGain();
      f.type = 'lowpass'; f.Q.value = 7;
      const l = lfoNode(1, 0);
      l.g.connect(f.detune);
      inp.connect(f); f.connect(out);
      return {
        inp, out,
        set(p1, p2) { tset(f.frequency, expmap(p1, 80, 14000)); tset(l.o.frequency, expmap(p2, 0.1, 12)); tset(l.g.gain, p2 < 0.02 ? 0 : 2400); },
        stop() { l.o.stop(); }
      };
    }
  },
  TREMOLO: {
    p: ['RATE', 'DEPTH'], fmt: [v => fmtHz(expmap(v, 0.5, 16)), pct],
    build() {
      const inp = AC.createGain(), out = AC.createGain(), g = AC.createGain();
      const l = lfoNode(4, 0.3);
      l.g.connect(g.gain);
      inp.connect(g); g.connect(out);
      return {
        inp, out,
        set(p1, p2) { tset(l.o.frequency, expmap(p1, 0.5, 16)); tset(l.g.gain, p2 * 0.5); tset(g.gain, 1 - p2 * 0.5); },
        stop() { l.o.stop(); }
      };
    }
  }
};

class FxSlot {
  constructor() {
    this.input = AC.createGain(); this.output = AC.createGain();
    this.dry = AC.createGain(); this.wet = AC.createGain(); this.wet.gain.value = 0;
    this.input.connect(this.dry); this.dry.connect(this.output); this.wet.connect(this.output);
    this.type = 'OFF'; this.fx = null;
  }
  apply(cfg, bpm) {
    if (cfg.type !== this.type) {
      if (this.fx) {
        try { this.input.disconnect(this.fx.inp); } catch (e) { /* already gone */ }
        this.fx.out.disconnect();
        if (this.fx.stop) this.fx.stop();
        this.fx = null;
      }
      this.type = cfg.type;
      if (cfg.type !== 'OFF') {
        this.fx = FX_DEFS[cfg.type].build();
        this.input.connect(this.fx.inp); this.fx.out.connect(this.wet);
      }
    }
    if (this.fx) this.fx.set(cfg.p1, cfg.p2, bpm);
    const m = this.fx ? cfg.mix : 0;
    const send = this.fx && FX_DEFS[cfg.type].send;
    tset(this.dry.gain, send ? 1 : 1 - m);
    tset(this.wet.gain, send ? m * 1.2 : m);
  }
}

// ---------- per-part runtime: engIn -> (engine insert) -> input -> fx1 -> fx2 -> pan -> level -> bus ----------
class PartRT {
  constructor() {
    this.input = AC.createGain(); this.engIn = AC.createGain();
    this.fx = [new FxSlot(), new FxSlot()];
    this.an = AC.createAnalyser(); this.an.fftSize = 512;
    this.pan = AC.createStereoPanner(); this.level = AC.createGain();
    this.input.connect(this.fx[0].input);
    this.fx[0].output.connect(this.fx[1].input);
    this.fx[1].output.connect(this.pan);
    this.fx[1].output.connect(this.an);
    this.pan.connect(this.level); this.level.connect(AU.bus);
    this.voices = []; this.eng = { nodes: [] }; this.held = []; this.arpI = 0; this.arpStart = 0; this.live = {}; this.hit = 0;
  }
}

// RMS level of an analyser (0..~1)
function anLevel(an) {
  if (!an._buf) an._buf = new Float32Array(an.fftSize);
  an.getFloatTimeDomainData(an._buf);
  let s = 0;
  for (let i = 0; i < an._buf.length; i++) s += an._buf[i] * an._buf[i];
  return Math.sqrt(s / an._buf.length);
}
