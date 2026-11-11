// OPPD-1 FOF engine: sung voice by formant wave functions (the 'oppd-fof' AudioWorklet in js/audio.js).
// Five formants per vowel and voice type (classic IRCAM / Csound tables), interpolated between vowels.
'use strict';

const FOF_VOICES = ['BASS', 'TENOR', 'ALTO', 'SOPRANO'];
// [voice][vowel a e i o u] = [[f1..f5], [dB1..dB5], [bw1..bw5]]
const FOF_TABLE = [
  [[[600, 1040, 2250, 2450, 2750], [0, -7, -9, -9, -20], [60, 70, 110, 120, 130]],
    [[400, 1620, 2400, 2800, 3100], [0, -12, -9, -12, -18], [40, 80, 100, 120, 120]],
    [[250, 1750, 2600, 3050, 3340], [0, -30, -16, -22, -28], [60, 90, 100, 120, 120]],
    [[400, 750, 2400, 2600, 2900], [0, -11, -21, -20, -40], [40, 80, 100, 120, 120]],
    [[350, 600, 2400, 2675, 2950], [0, -20, -32, -28, -36], [40, 80, 100, 120, 120]]],
  [[[650, 1080, 2650, 2900, 3250], [0, -6, -7, -8, -22], [80, 90, 120, 130, 140]],
    [[400, 1700, 2600, 3200, 3580], [0, -14, -12, -14, -20], [70, 80, 100, 120, 120]],
    [[290, 1870, 2800, 3250, 3540], [0, -15, -18, -20, -30], [40, 90, 100, 120, 120]],
    [[400, 800, 2600, 2800, 3000], [0, -10, -12, -12, -26], [40, 80, 100, 120, 120]],
    [[350, 600, 2700, 2900, 3300], [0, -20, -17, -14, -26], [40, 60, 100, 120, 120]]],
  [[[800, 1150, 2800, 3500, 4950], [0, -4, -20, -36, -60], [80, 90, 120, 130, 140]],
    [[400, 1600, 2700, 3300, 4950], [0, -24, -30, -35, -60], [60, 80, 120, 150, 200]],
    [[350, 1700, 2700, 3700, 4950], [0, -20, -30, -36, -60], [50, 100, 120, 150, 200]],
    [[450, 800, 2830, 3500, 4950], [0, -9, -16, -28, -55], [70, 80, 100, 130, 135]],
    [[325, 700, 2530, 3500, 4950], [0, -12, -30, -40, -64], [50, 60, 170, 180, 200]]],
  [[[800, 1150, 2900, 3900, 4950], [0, -6, -32, -20, -50], [80, 90, 120, 130, 140]],
    [[350, 2000, 2800, 3600, 4950], [0, -20, -15, -40, -56], [60, 100, 120, 150, 200]],
    [[270, 2140, 2950, 3900, 4950], [0, -12, -26, -26, -44], [60, 90, 100, 120, 120]],
    [[450, 800, 2830, 3800, 4950], [0, -11, -22, -22, -50], [70, 80, 100, 130, 135]],
    [[325, 700, 2700, 3800, 4950], [0, -16, -35, -40, -60], [50, 60, 170, 180, 200]]]
];
// five [f, linear amplitude, bandwidth] for the current settings
function fofFormants(p) {
  const voice = FOF_TABLE[idxOf(p.voice, 4)], pos = clamp(p.vowel * 4, 0, 4);
  const i = Math.min(3, Math.floor(pos)), u = pos - i, a = voice[i], b = voice[i + 1];
  const sh = lin(p.shift, 0.75, 1.35), bw = expmap(p.bandwidth, 0.4, 2.5);
  return [0, 1, 2, 3, 4].map(k => [
    (a[0][k] * (1 - u) + b[0][k] * u) * sh,
    Math.pow(10, (a[1][k] * (1 - u) + b[1][k] * u) / 20),
    (a[2][k] * (1 - u) + b[2][k] * u) * bw
  ]);
}

const FOF = {
  name: 'FOF', poly: 6,
  params: [
    P('vowel', 'VOWEL', 0, v => { const x = v * 4, i = Math.round(x); return Math.abs(x - i) < 0.12 ? VOWEL_NAMES[i] : VOWEL_NAMES[Math.floor(x)] + '>' + VOWEL_NAMES[Math.min(4, Math.floor(x) + 1)]; }),
    P('voice', 'VOICE', 2 / 3, fList(FOF_VOICES), 4), P('shift', 'SHIFT', 0.42, v => 'x' + lin(v, 0.75, 1.35).toFixed(2)), P('bandwidth', 'BANDWIDTH', 0.5, v => 'x' + expmap(v, 0.4, 2.5).toFixed(2)),
    P('vibrato', 'VIBRATO', 0.4, pct), P('jitter', 'JITTER', 0.3, pct), P('skirt', 'SKIRT', 0.4, v => fmtSec(expmap(v, 0.0008, 0.015))),
    P('swell', 'SWELL', 0.45, v => { const e = swellEnv(v); return fmtSec(e.a) + '/' + fmtSec(e.r); })
  ],
  env: p => swellEnv(p.swell),
  play(rt, part, note, vel, t) {
    const p = part.params, env = swellEnv(p.swell);
    const amp = AC.createGain(); amp.gain.value = 0;
    amp.connect(rt.engIn);
    const life = AC.createConstantSource(); life.offset.value = 0; life.connect(amp); life.start(t);
    let node = null;
    if (AU.crusherOk) {
      node = new AudioWorkletNode(AC, 'oppd-fof', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1] });
      const prm = n => node.parameters.get(n);
      const setFormants = smooth => fofFormants(p).forEach(([f, a, b], k) => {
        if (smooth) { tset(prm('f' + k), f); tset(prm('a' + k), a); tset(prm('b' + k), b); }
        else { prm('f' + k).value = f; prm('a' + k).value = a; prm('b' + k).value = b; }
      });
      prm('freq').value = mtof(note);
      prm('vib').value = p.vibrato; prm('jitter').value = p.jitter; prm('skirt').value = expmap(p.skirt, 0.0008, 0.015);
      setFormants(false);
      const out = AC.createGain(); out.gain.value = 0.22;
      node.connect(out); out.connect(amp);
      node._live = id => {
        if (['vowel', 'voice', 'shift', 'bandwidth'].includes(id)) setFormants(true);
        else if (id === 'vibrato') tset(prm('vib'), p.vibrato);
        else if (id === 'jitter') tset(prm('jitter'), p.jitter);
        else if (id === 'skirt') tset(prm('skirt'), expmap(p.skirt, 0.0008, 0.015));
      };
    }
    const e = envStart(amp.gain, t, env.a, env.d, env.s, 0.9 * vel);
    return mkVoice({
      srcs: [life], amp, e, rel: env.r,
      cleanup: () => { if (node) { node.port.postMessage('stop'); try { node.disconnect(); } catch (er) { /* gone */ } } },
      live(id) { if (node) node._live(id); }
    });
  },
  view(g, pi, x, y, w, h) {
    const p = PRJ.parts[pi].params;
    drawFormantView(g, x, y, w, h, fofFormants(p), p.vowel * 4);
    T(g, FOF_VOICES[idxOf(p.voice, 4)], x + 2, y + 8, 7.5, C.dim);
  }
};
ENGINES.fof = FOF;
ENGINE_LIST.push('fof');
