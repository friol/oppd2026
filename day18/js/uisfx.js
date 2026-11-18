// Synthesized interface sounds (menus): hover tick, selection move, value change, confirm,
// back and a bigger "start race" sweep. Web Audio only, no files. It shares the AudioContext
// of the engine (created by the first key press / click, see Engine.init); until then the
// calls are silently ignored.
'use strict';

const UiSfx = (() => {
  let lastHover = 0;
  const ctx = () => {
    const ac = Engine.context;
    if (!ac) return null;
    if (ac.state === 'suspended') ac.resume();
    return ac;
  };
  let bus = null, noiseBuf = null, busCtx = null;
  function out(ac) {
    if (bus && busCtx === ac) return bus;
    busCtx = ac;
    bus = ac.createGain();
    bus.gain.value = 0.32;
    bus.connect(ac.destination);
    noiseBuf = ac.createBuffer(1, ac.sampleRate * 0.6, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return bus;
  }
  // One note: pitch glide f0 -> f1, fast attack, exponential decay; `delay` in seconds
  function tone(ac, o, f0, f1, dur, type, vol, delay) {
    const t = ac.currentTime + 0.005 + (delay || 0);
    const osc = ac.createOscillator(), g = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(o);
    osc.start(t); osc.stop(t + dur + 0.02);
  }
  // Filtered noise whoosh, the bandpass centre sweeps f0 -> f1
  function whoosh(ac, o, f0, f1, dur, vol, delay) {
    const t = ac.currentTime + 0.005 + (delay || 0);
    const src = ac.createBufferSource();
    src.buffer = noiseBuf;
    const f = ac.createBiquadFilter();
    f.type = 'bandpass'; f.Q.value = 1.2;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(o);
    src.start(t, 0, dur + 0.05);
  }
  const play = fn => () => { const ac = ctx(); if (ac) fn(ac, out(ac)); };

  return {
    // mouse over a row: a very soft, short tick (throttled)
    hover: () => {
      const n = performance.now();
      if (n - lastHover < 70) return;
      lastHover = n;
      const ac = ctx(); if (!ac) return;
      const o = out(ac);
      tone(ac, o, 1500, 1900, 0.05, 'sine', 0.22);
    },
    // the selection moves to another row
    move: play((ac, o) => { tone(ac, o, 620, 880, 0.08, 'triangle', 0.5); tone(ac, o, 1240, 1760, 0.05, 'sine', 0.12); }),
    // a value changes: up (+1) or down (-1) in pitch
    change: dir => { const ac = ctx(); if (!ac) return; const o = out(ac);
      if (dir > 0) { tone(ac, o, 700, 760, 0.06, 'triangle', 0.45); tone(ac, o, 1000, 1080, 0.09, 'triangle', 0.4, 0.05); }
      else { tone(ac, o, 1000, 940, 0.06, 'triangle', 0.45); tone(ac, o, 700, 640, 0.09, 'triangle', 0.4, 0.05); } },
    // a choice is confirmed: a short rising chime
    confirm: play((ac, o) => {
      [523.25, 659.25, 783.99].forEach((f, i) => { tone(ac, o, f, f, 0.16, 'triangle', 0.4, i * 0.055); tone(ac, o, f * 2, f * 2, 0.1, 'sine', 0.1, i * 0.055); });
    }),
    // back / cancel: a short falling blip
    back: play((ac, o) => { tone(ac, o, 700, 330, 0.12, 'triangle', 0.45); }),
    // the game is paused: two falling notes, the sound "freezes"
    pause: play((ac, o) => {
      tone(ac, o, 880, 860, 0.09, 'triangle', 0.42);
      tone(ac, o, 587.33, 570, 0.16, 'triangle', 0.42, 0.075);
      tone(ac, o, 1760, 700, 0.2, 'sine', 0.1);
    }),
    // the game goes on: two rising notes and a short airy sweep
    resume: play((ac, o) => {
      whoosh(ac, o, 400, 2600, 0.22, 0.16);
      tone(ac, o, 587.33, 600, 0.09, 'triangle', 0.4);
      tone(ac, o, 880, 900, 0.1, 'triangle', 0.4, 0.07);
      tone(ac, o, 1318.5, 1330, 0.22, 'sine', 0.16, 0.14);
    }),
    // start of the race: rising arpeggio over a sweep
    start: play((ac, o) => {
      whoosh(ac, o, 250, 3400, 0.5, 0.5);
      [392, 523.25, 659.25, 783.99, 1046.5].forEach((f, i) => { tone(ac, o, f, f * 1.01, 0.22, 'triangle', 0.42, i * 0.05); tone(ac, o, f * 2, f * 2, 0.14, 'square', 0.05, i * 0.05); });
    })
  };
})();
