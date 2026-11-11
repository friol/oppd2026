// OPPD-1 FOLD engine: West Coast style wavefolder
// sine (+ FM) -> fold gain (base + envelope) + symmetry offset -> sine folding curve -> low pass gate (filter and VCA together)
'use strict';

const FOLD_MAX = 6;                                  // folds at the top of the range
const FOLD_RATIOS = [0.5, 1, 1.5, 2, 3, 3.5, 4, 7];
// the shaper input range [-1, 1] stands for [-FOLD_MAX, FOLD_MAX]: past each peak the wave folds back
const FOLD_CURVE = (() => {
  const n = 8192, c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; c[i] = Math.sin(Math.PI / 2 * x * FOLD_MAX); }
  return c;
})();
const foldGain = v => (1 + v * (FOLD_MAX - 1)) / FOLD_MAX;   // 0 -> plain sine, 1 -> FOLD_MAX folds
const foldSym = v => (v - 0.5) * 0.5 / FOLD_MAX * 2;          // DC offset before the folder: even harmonics
const foldEnv = p => ({ a: 0.002, d: expmap(p.decay, 0.04, 3), s: p.sustain, r: 0.06 + expmap(p.decay, 0.04, 3) * 0.5 });

const FOLD = {
  name: 'FOLD', poly: 8,
  params: [
    P('fold', 'FOLD', 0.3, pct), P('symmetry', 'SYMMETRY', 0.5, v => { const s = Math.round((v - 0.5) * 200); return s ? (s > 0 ? '+' : '') + s : '0'; }),
    P('fm', 'FM', 0, pct), P('ratio', 'RATIO', 1 / 7, v => FOLD_RATIOS[idxOf(v, FOLD_RATIOS.length)].toString(), FOLD_RATIOS.length),
    P('foldenv', 'FOLD ENV', 0.5, pct), P('decay', 'DECAY', 0.35, fSec(0.04, 3)), P('sustain', 'SUSTAIN', 0, pct), P('lpg', 'LPG', 0.7, pct)
  ],
  setup(rt) {
    // folding with an offset leaves DC behind: block it once per part
    const hp = mkFilter('highpass', 25, 0.7);
    rt.engIn.connect(hp); hp.connect(rt.input);
  },
  env: p => foldEnv(p),
  play(rt, part, note, vel, t) {
    const p = part.params, f = mtof(note), env = foldEnv(p);
    const osc = mkOsc('sine', f, t);
    // FM from a second sine, the "timbre" side of a complex oscillator
    const ratio = FOLD_RATIOS[idxOf(p.ratio, FOLD_RATIOS.length)];
    const mod = mkOsc('sine', f * ratio, t), mg = AC.createGain();
    mg.gain.value = p.fm * p.fm * 4 * f * ratio;
    mod.connect(mg); mg.connect(osc.frequency);
    // fold amount = base + envelope, plus the symmetry offset
    const gBase = AC.createGain(); gBase.gain.value = foldGain(p.fold);
    const gEnv = AC.createGain(); gEnv.gain.value = 0;
    const off = AC.createConstantSource(); off.offset.value = foldSym(p.symmetry); off.start(t);
    const sh = AC.createWaveShaper(); sh.curve = FOLD_CURVE; sh.oversample = '4x';
    osc.connect(gBase); osc.connect(gEnv); gBase.connect(sh); gEnv.connect(sh); off.connect(sh);
    const fe = envStart(gEnv.gain, t, env.a, env.d * 0.8, p.sustain * 0.5, p.foldenv * (FOLD_MAX - 1) / FOLD_MAX * vel);
    // low pass gate: the cutoff opens and closes with the amplitude
    const lpg = mkFilter('lowpass', 18000 * Math.pow(2, -p.lpg * 6), 0.9);
    const le = envStart(lpg.detune, t, env.a, env.d, env.s, p.lpg * 7200);
    const amp = AC.createGain(); amp.gain.value = 0;
    sh.connect(lpg); lpg.connect(amp); amp.connect(rt.engIn);
    // struck sounds through a closed gate carry less energy: give them more peak level
    const e = envStart(amp.gain, t, env.a, env.d, env.s, 0.2 * vel * (1.6 - 0.6 * p.sustain) * (1 + 0.5 * p.lpg));
    return mkVoice({
      srcs: [osc, mod, off], amp, e, rel: env.r,
      onStop: (tt, r) => { envStop(gEnv.gain, fe, tt, r); envStop(lpg.detune, le, tt, r); },
      live(id) {
        if (id === 'fold') tset(gBase.gain, foldGain(p.fold));
        else if (id === 'symmetry') tset(off.offset, foldSym(p.symmetry));
        else if (id === 'fm' || id === 'ratio') {
          const r = FOLD_RATIOS[idxOf(p.ratio, FOLD_RATIOS.length)];
          tset(mod.frequency, f * r); tset(mg.gain, p.fm * p.fm * 4 * f * r);
        } else if (id === 'lpg') tset(lpg.frequency, 18000 * Math.pow(2, -p.lpg * 6));
      }
    });
  }
};
ENGINES.fold = FOLD;
ENGINE_LIST.push('fold');

// one cycle of the folded wave for the display: at rest (dim) and at the envelope peak (bright)
function foldShape(p, withEnv, x) {
  const th = x * Math.PI * 2;
  const r = FOLD_RATIOS[idxOf(p.ratio, FOLD_RATIOS.length)];
  const s = Math.sin(th + p.fm * p.fm * 4 * Math.sin(th * r));
  const g = foldGain(p.fold) + (withEnv ? p.foldenv * (FOLD_MAX - 1) / FOLD_MAX : 0);
  const u = clamp(g * s + foldSym(p.symmetry), -1, 1);
  return Math.sin(Math.PI / 2 * u * FOLD_MAX);
}
