'use strict';

// Synthesized sound effects with Web Audio. Starts on the first gesture.
const Sound = (() => {
  let ac = null, master = null, noiseBuf = null;
  let on = true;

  function ensure() {
    if (!ac) {
      const A = window.AudioContext || window.webkitAudioContext;
      if (!A) return null;
      ac = new A();
      master = ac.createGain();
      master.gain.value = 0.5;
      master.connect(ac.destination);
      noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ac.state === 'suspended') ac.resume();
    return ac;
  }

  function env(g, t, a, peak, dur) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }

  function tone(type, f0, f1, dur, peak = 0.3, delay = 0) {
    const t = ac.currentTime + delay;
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    env(g, t, 0.005, peak, dur);
    o.connect(g).connect(master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  function noise(filter, freq, q, dur, peak = 0.3, delay = 0, f1 = freq) {
    const t = ac.currentTime + delay;
    const src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    src.buffer = noiseBuf;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    f.type = filter; f.Q.value = q;
    f.frequency.setValueAtTime(freq, t);
    if (f1 !== freq) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    env(g, t, 0.004, peak, dur);
    src.connect(f).connect(g).connect(master);
    src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.05);
  }

  const SOUNDS = {
    step: () => noise('lowpass', 500 + Math.random() * 200, 1, 0.07, 0.05),
    swish: () => noise('bandpass', 1800, 2, 0.16, 0.12, 0, 600),
    hit: () => { noise('bandpass', 900, 1.5, 0.1, 0.3); tone('triangle', 160, 70, 0.12, 0.25); },
    crit: () => { noise('lowpass', 2400, 0.8, 0.25, 0.35); tone('square', 220, 60, 0.2, 0.18); },
    hurt: () => { tone('sawtooth', 140, 60, 0.2, 0.18); noise('lowpass', 700, 1, 0.12, 0.2); },
    die: () => { tone('square', 330, 70, 0.35, 0.12); noise('lowpass', 1200, 1, 0.3, 0.12, 0.05, 200); },
    coin: () => { tone('square', 988, 988, 0.07, 0.08); tone('square', 1319, 1319, 0.16, 0.08, 0.07); },
    pickup: () => { tone('triangle', 520, 520, 0.08, 0.2); tone('triangle', 780, 780, 0.14, 0.2, 0.08); },
    chest: () => { noise('bandpass', 400, 6, 0.25, 0.25, 0, 900); [660, 880, 1100].forEach((f, i) => tone('triangle', f, f, 0.2, 0.15, 0.2 + i * 0.07)); },
    smash: () => { noise('lowpass', 1600, 0.7, 0.3, 0.4, 0, 300); tone('triangle', 120, 50, 0.15, 0.25); },
    potion: () => { for (let i = 0; i < 4; i++) tone('sine', 300 + i * 90, 600 + i * 120, 0.09, 0.15, i * 0.07); },
    levelup: () => [523, 659, 784, 1047].forEach((f, i) => tone('square', f, f, 0.18, 0.09, i * 0.09)),
    stairs: () => { for (let i = 0; i < 5; i++) noise('lowpass', 700 - i * 90, 1, 0.09, 0.12, i * 0.11); tone('sine', 300, 90, 0.7, 0.15, 0.1); },
    land: () => { noise('lowpass', 600, 1, 0.35, 0.45); tone('sine', 90, 40, 0.35, 0.4); },
    fall: () => tone('sine', 700, 80, 0.6, 0.2),
    door: () => { noise('bandpass', 300, 8, 0.35, 0.25, 0, 650); tone('sawtooth', 90, 110, 0.3, 0.05); },
    spikes: () => { noise('highpass', 3000, 1, 0.12, 0.3); tone('square', 900, 400, 0.08, 0.1); },
    fire: () => noise('lowpass', 800, 0.7, 0.6, 0.45, 0, 3000),
    clank: () => { tone('square', 700, 650, 0.08, 0.15); tone('square', 1040, 990, 0.18, 0.1, 0.03); noise('highpass', 4000, 1, 0.08, 0.2); },
    teleport: () => { tone('sine', 300, 1600, 0.4, 0.18); tone('triangle', 450, 2400, 0.4, 0.1, 0.05); },
    shoot: () => noise('bandpass', 2600, 3, 0.18, 0.15, 0, 900),
    splash: () => noise('bandpass', 900, 1, 0.18, 0.12, 0, 400),
    spot: () => { tone('triangle', 880, 880, 0.08, 0.12); tone('triangle', 660, 660, 0.12, 0.12, 0.08); },
    bump: () => tone('sine', 120, 90, 0.08, 0.12),
    death: () => [392, 349, 311, 262].forEach((f, i) => tone('triangle', f, f * 0.98, 0.4, 0.2, i * 0.25)),
    equip: () => { tone('square', 300, 300, 0.05, 0.12); noise('bandpass', 2200, 4, 0.12, 0.2, 0.04); tone('triangle', 880, 880, 0.18, 0.12, 0.1); },
    roar: () => { tone('sawtooth', 110, 55, 0.9, 0.22); noise('lowpass', 500, 1, 0.8, 0.3, 0, 150); },
    summon: () => { tone('sine', 200, 600, 0.35, 0.15); noise('bandpass', 700, 3, 0.3, 0.12); },
    pages: () => { for (let i = 0; i < 3; i++) noise('highpass', 2500, 0.8, 0.07, 0.12, i * 0.08); },
    vanish: () => { tone('sine', 1200, 200, 0.6, 0.15); noise('highpass', 5000, 1, 0.4, 0.08, 0, 8000); },
    shield: () => [392, 523, 659, 784].forEach((f, i) => { tone('triangle', f, f, 0.5, 0.08, i * 0.05); tone('sine', f * 2, f * 2, 0.4, 0.04, i * 0.05); }),
    sleep: () => [523, 440, 349].forEach((f, i) => tone('sine', f, f * 0.97, 0.5, 0.12, i * 0.22)),
    start: () => [262, 392, 523].forEach((f, i) => tone('triangle', f, f, 0.25, 0.15, i * 0.12)),
    meow: () => { tone('triangle', 620, 1050, 0.16, 0.1); tone('triangle', 1050, 560, 0.28, 0.1, 0.15); },
    purr: () => { for (let i = 0; i < 12; i++) noise('lowpass', 160, 1, 0.045, 0.14, i * 0.055); },
    gong: () => { tone('sine', 140, 136, 2.4, 0.22); tone('sine', 211, 205, 2, 0.12); tone('triangle', 350, 340, 1.2, 0.06); noise('lowpass', 900, 1, 0.2, 0.15); },
    plop: () => { tone('sine', 900, 280, 0.14, 0.2); noise('bandpass', 1200, 2, 0.2, 0.08, 0.06, 500); },
  };

  // ---- ambience: a quiet bed of filtered noise per place, and small sounds now and then

  const AMBIENTS = {
    Crypt: { bed: ['lowpass', 220, 0.6, 0.05, 0.08], every: [4, 9], events: [
      () => tone('sine', 1400, 1100, 0.12, 0.04),
      () => { tone('square', 300, 290, 0.06, 0.025); tone('square', 450, 440, 0.1, 0.02, 0.09); },
      () => tone('sine', 180, 140, 2.2, 0.03),
    ] },
    Caverns: { bed: ['lowpass', 380, 0.6, 0.035, 0.05], every: [0.8, 2.6], events: [
      () => { const f = 1200 + Math.random() * 900; tone('sine', f, f * 0.7, 0.12, 0.05); },
    ] },
    Inferno: { bed: ['lowpass', 110, 0.8, 0.12, 0.1], every: [1, 3.5], events: [
      () => noise('lowpass', 240, 2, 0.25, 0.06, 0, 120),
      () => noise('lowpass', 240, 2, 0.25, 0.06, 0, 120),
      () => { if (Math.random() < 0.25) { tone('sawtooth', 72, 48, 1.8, 0.05); noise('lowpass', 300, 1, 1.5, 0.05, 0, 100); } },
    ] },
    'Overgrown Garden': { bed: ['highpass', 1800, 0.5, 0.012, 0.15], every: [1.2, 3.5], events: [
      () => { const n = 2 + (Math.random() * 3 | 0), f = 2400 + Math.random() * 1200; for (let i = 0; i < n; i++) tone('sine', f, f * 1.35, 0.07, 0.05, i * 0.11); },
      () => { const f = 1800 + Math.random() * 600; tone('sine', f * 1.3, f, 0.18, 0.04); tone('sine', f, f * 1.25, 0.15, 0.04, 0.22); },
    ] },
    'Overgrown Garden night': { bed: ['highpass', 2400, 0.5, 0.008, 0.1], every: [0.5, 1.3], events: [
      () => { for (let i = 0; i < 3; i++) tone('triangle', 4300, 4300, 0.035, 0.025, i * 0.07); },
      () => { for (let i = 0; i < 3; i++) tone('triangle', 4300, 4300, 0.035, 0.025, i * 0.07); },
      () => { if (Math.random() < 0.15) { tone('sine', 420, 400, 0.35, 0.05); tone('sine', 400, 370, 0.5, 0.05, 0.45); } },
    ] },
    'Desert Ruins': { bed: ['bandpass', 520, 0.7, 0.05, 0.25], every: [3, 7], events: [
      () => noise('bandpass', 300, 1.2, 2.2, 0.07, 0, 1100),
    ] },
    'Frozen Hollow': { bed: ['bandpass', 1300, 5, 0.03, 0.3], every: [3, 8], events: [
      () => noise('bandpass', 900, 3, 2.5, 0.05, 0, 2200),
      () => { if (Math.random() < 0.4) noise('highpass', 5000, 1, 0.05, 0.08); },
    ] },
  };
  let amb = null;

  function stopAmbient() {
    if (!amb) return;
    clearTimeout(amb.timer);
    const t = ac.currentTime;
    amb.gain.gain.setTargetAtTime(0.0001, t, 0.4);
    const nodes = amb.nodes;
    setTimeout(() => nodes.forEach(n => { try { n.stop(); } catch (e) { /* already stopped */ } }), 2000);
    amb = null;
  }

  // name: the place (a theme name, maybe with ' night'), or null for silence
  function ambient(name) {
    if (amb && amb.name === name) return;
    if (amb) stopAmbient();
    const def = AMBIENTS[name];
    if (!def || !on || !ensure()) return;
    const [type, freq, q, level, wobble] = def.bed;
    const src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    src.buffer = noiseBuf; src.loop = true;
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    g.gain.value = 0.0001;
    g.gain.setTargetAtTime(level, ac.currentTime, 1.2);
    // a slow swell, like breath or wind
    const lfo = ac.createOscillator(), lg = ac.createGain();
    lfo.frequency.value = 0.07 + Math.random() * 0.08;
    lg.gain.value = level * wobble * 4;
    lfo.connect(lg).connect(g.gain);
    src.connect(f).connect(g).connect(master);
    src.start(); lfo.start();
    amb = { name, gain: g, nodes: [src, lfo], timer: 0 };
    const next = () => {
      if (!amb || amb.name !== name) return;
      const [a, b] = def.every;
      amb.timer = setTimeout(() => {
        if (!amb || amb.name !== name || !on) return;
        def.events[Math.floor(Math.random() * def.events.length)]();
        next();
      }, (a + Math.random() * (b - a)) * 1000);
    };
    next();
  }

  function play(name) {
    if (!on || !ensure() || !SOUNDS[name]) return;
    SOUNDS[name]();
  }

  return {
    play,
    ambient,
    unlock: () => { if (on) ensure(); },
    get on() { return on; },
    set on(v) { on = v; if (v) ensure(); else if (ac) stopAmbient(); },
  };
})();
