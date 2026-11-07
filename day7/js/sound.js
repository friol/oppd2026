// Synthesized sounds: filtered noise with a grainy envelope. Chalk on the board
// in the dark theme, a pencil on paper in the light one. Starts on the first gesture.
'use strict';

const Sound = (() => {
  let ctx = null, noise = null, on = true;

  function init() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return;
    }
    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  function burst(delay, dur, type, freq, q, level) {
    if (!on || !ctx || ctx.state !== 'running') return;
    const t0 = ctx.currentTime + delay / 1000, d = dur / 1000;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(level, t0 + 0.015);
    for (let t = 0.035; t < d - 0.02; t += 0.025) {
      g.gain.linearRampToValueAtTime(level * (0.5 + Math.random() * 0.6), t0 + t);
    }
    g.gain.linearRampToValueAtTime(0, t0 + d + 0.03);
    src.connect(filter).connect(g).connect(ctx.destination);
    src.start(t0, Math.random() * 0.5);
    src.stop(t0 + d + 0.06);
  }

  function stroke(delay, dur, chalk) {
    if (chalk) burst(delay, dur, 'bandpass', 2300 + Math.random() * 700, 0.9, 0.2);
    else burst(delay, dur, 'highpass', 3600 + Math.random() * 600, 0.7, 0.06);
  }

  function erase(chalk) {
    burst(0, 280, 'lowpass', chalk ? 1100 : 2400, 0.6, chalk ? 0.14 : 0.05);
  }

  return {
    init, stroke, erase,
    get on() { return on; },
    set on(v) { on = !!v; },
  };
})();
