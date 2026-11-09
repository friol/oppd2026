// Synthesized sounds (Web Audio): wooden clicks, a portal whoosh, a trap thud
// and a small chime. Starts on the first gesture.
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

  const ready = () => on && ctx && ctx.state === 'running';

  function tone(freq, dur, { type = 'sine', vol = 0.2, delay = 0, to = 0, attack = 0.005 } = {}) {
    if (!ready()) return;
    const t0 = ctx.currentTime + delay;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(ctx.destination);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  function hiss(dur, { type = 'bandpass', freq = 1200, to = 0, q = 1, vol = 0.2, delay = 0, attack = 0.004 } = {}) {
    if (!ready()) return;
    const t0 = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t0);
    if (to) f.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(ctx.destination);
    src.start(t0, Math.random() * 0.5);
    src.stop(t0 + dur + 0.05);
  }

  // A piece set down on wood.
  function place() {
    hiss(0.05, { freq: 1700 + Math.random() * 400, q: 3, vol: 0.32 });
    tone(220 + Math.random() * 30, 0.08, { type: 'triangle', vol: 0.18 });
  }
  function select() { hiss(0.03, { freq: 2600, q: 4, vol: 0.12 }); }
  function capture() {
    hiss(0.06, { freq: 1300, q: 2, vol: 0.3 });
    tone(150, 0.12, { type: 'triangle', vol: 0.18 });
  }
  function warp() {
    hiss(0.55, { freq: 300, to: 4200, q: 6, vol: 0.18, attack: 0.15 });
    tone(320, 0.5, { type: 'sine', to: 1280, vol: 0.08, attack: 0.1 });
    tone(480, 0.45, { type: 'sine', to: 1900, vol: 0.05, delay: 0.06, attack: 0.1 });
  }
  function trap() {
    tone(110, 0.45, { type: 'sine', to: 38, vol: 0.4 });
    hiss(0.3, { type: 'lowpass', freq: 900, to: 120, vol: 0.35 });
  }
  function crown() {
    [880, 1109, 1319].forEach((f, i) => tone(f, 0.5, { type: 'sine', vol: 0.09, delay: i * 0.08 }));
  }
  function demote() {
    [660, 494].forEach((f, i) => tone(f, 0.35, { type: 'triangle', vol: 0.1, delay: i * 0.12 }));
  }
  function shift() {
    hiss(0.8, { freq: 2400, to: 500, q: 3, vol: 0.1, attack: 0.3 });
  }
  function end(win) {
    const notes = win ? [523, 659, 784, 1047] : win === false ? [440, 392, 349, 294] : [523, 523];
    notes.forEach((f, i) => tone(f, 0.45, { type: 'triangle', vol: 0.12, delay: i * 0.13 }));
  }

  return {
    init, place, select, capture, warp, trap, crown, demote, shift, end,
    get on() { return on; },
    set on(v) { on = !!v; },
  };
})();
