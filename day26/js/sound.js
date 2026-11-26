// Synthesised sound effects with Web Audio (no audio files) and a soft rain loop.
'use strict';

const SOUND = (() => {
  let ac = null, master = null, rain = null, rainGain = null;
  let muted = localStorage.getItem('day26.mute') === '1';
  const last = {};

  function ctx() {
    if (!ac) {
      const A = window.AudioContext || window.webkitAudioContext;
      if (!A) return null;
      ac = new A(); master = ac.createGain(); master.gain.value = muted ? 0 : 0.5; master.connect(ac.destination);
    }
    if (ac.state === 'suspended') ac.resume();
    return ac;
  }
  function tone(freq, dur, type = 'square', vol = 0.15, delay = 0, slide = 0) {
    const c = ctx(); if (!c) return;
    const t = c.currentTime + delay, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02);
  }
  function noise(dur, vol = 0.3, freq = 800, delay = 0, q = 0.7) {
    const c = ctx(); if (!c) return;
    const t = c.currentTime + delay, len = Math.floor(c.sampleRate * dur), b = c.createBuffer(1, len, c.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = b; f.type = 'lowpass'; f.frequency.value = freq; f.Q.value = q;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f); f.connect(g); g.connect(master); s.start(t);
  }
  const SFX = {
    click: () => tone(660, 0.05, 'square', 0.08),
    coin: () => { tone(988, 0.08, 'square', 0.1); tone(1319, 0.2, 'square', 0.1, 0.08); },
    jackpot: () => [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => tone(f, 0.16, 'square', 0.1, i * 0.09)),
    doorbell: () => { tone(880, 0.4, 'sine', 0.2); tone(698, 0.6, 'sine', 0.2, 0.35); },
    angry: () => { tone(140, 0.18, 'sawtooth', 0.08); tone(120, 0.2, 'sawtooth', 0.08, 0.12); },
    party: () => [392, 494, 587, 494].forEach((f, i) => tone(f, 0.1, 'square', 0.06, i * 0.12)),
    wedding: () => [523, 523, 659, 784, 659, 784, 1047].forEach((f, i) => tone(f, 0.22, 'triangle', 0.14, i * 0.18)),
    siren: () => { for (let i = 0; i < 3; i++) { tone(700, 0.3, 'sawtooth', 0.05, i * 0.6, 300); tone(1000, 0.3, 'sawtooth', 0.05, i * 0.6 + 0.3, -300); } },
    thunder: () => { noise(2.2, 0.6, 180, 0.1); noise(0.4, 0.4, 1200); },
    quake: () => { noise(3.5, 0.7, 90); tone(40, 3, 'sine', 0.3); },
    flood: () => noise(2.5, 0.35, 600),
    crash: () => { noise(0.5, 0.5, 2000); tone(200, 0.3, 'square', 0.08, 0, -150); },
    power: () => tone(300, 0.6, 'sawtooth', 0.1, 0, -260),
    hail: () => { for (let i = 0; i < 20; i++) noise(0.04, 0.2, 4000, i * 0.07); },
    plane: () => { tone(180, 3.5, 'sawtooth', 0.06, 0, -100); noise(3.5, 0.25, 500); },
    explosion: () => { noise(3, 0.9, 300); noise(0.6, 0.7, 3000); tone(60, 2, 'sine', 0.4); },
    repair: () => { for (let i = 0; i < 4; i++) tone(1200, 0.04, 'square', 0.08, i * 0.15); },
    bell: () => { tone(1046, 0.8, 'sine', 0.15); tone(1568, 0.6, 'sine', 0.08); },
    alert: () => { tone(880, 0.12, 'square', 0.1); tone(660, 0.18, 'square', 0.1, 0.13); }
  };
  function play(name) {
    if (muted || !SFX[name]) return;
    const now = performance.now();
    if (last[name] && now - last[name] < 250) return; // avoid pile-ups at high speed
    last[name] = now;
    // Long effects push the music down for longer.
    if (typeof MUSIC !== 'undefined') MUSIC.duck(['explosion', 'quake', 'plane', 'jackpot', 'wedding', 'siren', 'thunder', 'flood'].includes(name) ? 3.5 : 1.2);
    try { SFX[name](); } catch (e) { }
  }
  // Rain loop that follows the weather.
  function setRain(level) {
    const c = ac; if (!c) return;
    if (!rain) {
      const len = c.sampleRate * 2, b = c.createBuffer(1, len, c.sampleRate), d = b.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      rain = c.createBufferSource(); rain.buffer = b; rain.loop = true;
      const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1400; f.Q.value = 0.5;
      rainGain = c.createGain(); rainGain.gain.value = 0;
      rain.connect(f); f.connect(rainGain); rainGain.connect(master); rain.start();
    }
    rainGain.gain.setTargetAtTime(level, c.currentTime, 0.8);
  }
  function setMuted(m) {
    muted = m; localStorage.setItem('day26.mute', m ? '1' : '0');
    if (master) master.gain.value = m ? 0 : 0.5;
  }
  return { play, setRain, setMuted, unlock: ctx, get muted() { return muted; } };
})();
