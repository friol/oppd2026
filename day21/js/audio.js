// AUDIO: synthesized ride sounds with Web Audio (wheels, wind, lift chain, brakes, linear motors, UI beeps).
(function () {
  'use strict';
  const A = { on: true, ctx: null };
  try { A.on = localStorage.getItem('riemann.sound') !== '0'; } catch (e) { }
  // Soundtrack: plain <audio> element (works from file://, unlike a MediaElementSource which would be tainted).
  const MUSIC_VOL = 0.22, MUSIC_DUCK = 0.08;   // kept well below the effects
  let music = null, duckUntil = 0, musicLevel = MUSIC_VOL;
  function musicTarget() { return A.on ? musicLevel : 0; }
  function startMusic() {
    if (!music) {
      music = new Audio('muzik/Weightless Break.mp3');
      music.loop = true; music.preload = 'auto'; music.volume = 0;
    }
    if (music.paused) { const p = music.play(); if (p && p.catch) p.catch(() => { }); }
  }
  // Lower the music briefly so a sound effect stays clear.
  function duck(sec) { duckUntil = performance.now() + sec * 1000; }
  function updateMusic(paused) {
    if (!music) return;
    const want = performance.now() < duckUntil ? MUSIC_DUCK : (paused ? MUSIC_VOL * 0.7 : MUSIC_VOL);
    musicLevel += (want - musicLevel) * 0.08;
    const t = musicTarget();
    music.volume = Math.max(0, Math.min(1, music.volume + (t - music.volume) * 0.15));
  }
  setInterval(() => updateMusic(false), 50);

  let master, noiseBuf, rumble, rumbleF, wind, windF, hiss, motor, motorG, motorF, chainPhase = 0;

  A.start = function () {
    startMusic();
    if (A.ctx) { if (A.ctx.state === 'suspended') A.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = A.ctx = new AC();
    master = ctx.createGain(); master.gain.value = A.on ? 0.8 : 0; master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    let b = 0;
    for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; b = (b + 0.02 * w) / 1.02; d[i] = w * 0.5 + b * 3; }
    const loop = (filterType, freq, q) => {
      const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
      const f = ctx.createBiquadFilter(); f.type = filterType; f.frequency.value = freq; f.Q.value = q || 0.7;
      const g = ctx.createGain(); g.gain.value = 0;
      src.connect(f); f.connect(g); g.connect(master); src.start();
      return [g, f];
    };
    [rumble, rumbleF] = loop('lowpass', 200, 1.5);
    [wind, windF] = loop('bandpass', 600, 0.6);
    [hiss] = loop('highpass', 3500, 0.5);
    motor = ctx.createOscillator(); motor.type = 'sawtooth'; motor.frequency.value = 80;
    motorF = ctx.createBiquadFilter(); motorF.type = 'lowpass'; motorF.frequency.value = 900;
    motorG = ctx.createGain(); motorG.gain.value = 0;
    motor.connect(motorF); motorF.connect(motorG); motorG.connect(master); motor.start();
  };

  A.toggle = function () {
    A.on = !A.on;
    try { localStorage.setItem('riemann.sound', A.on ? '1' : '0'); } catch (e) { }
    if (music && !A.on) music.volume = 0;
    if (master) master.gain.setTargetAtTime(A.on ? 0.8 : 0, A.ctx.currentTime, 0.05);
    return A.on;
  };

  function set(g, v) { g.gain.setTargetAtTime(v, A.ctx.currentTime, 0.06); }

  function click(vol) {
    const ctx = A.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1800 + Math.random() * 400; f.Q.value = 3;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t, Math.random()); src.stop(t + 0.06);
    const o = ctx.createOscillator(); o.frequency.value = 110; const og = ctx.createGain();
    og.gain.setValueAtTime(vol * 0.6, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    o.connect(og); og.connect(master); o.start(t); o.stop(t + 0.08);
  }

  // state: { v, lift, brake, motor, pov, paused }
  A.update = function (dt, st) {
    if (!A.ctx) return;
    const v = Math.abs(st.v || 0);
    if (st.paused) { set(rumble, 0); set(wind, 0); set(hiss, 0); set(motorG, 0); return; }
    const near = st.near;  // 0..1 how close the listener is to the train
    set(rumble, Math.min(0.5, v * 0.025) * near);
    rumbleF.frequency.setTargetAtTime(120 + v * 14, A.ctx.currentTime, 0.1);
    set(wind, Math.min(0.5, v * v * 0.0006) * (st.pov ? 1 : 0.35) * near);
    windF.frequency.setTargetAtTime(300 + v * 28, A.ctx.currentTime, 0.1);
    set(hiss, st.brake && v > 0.5 ? Math.min(0.25, 0.05 + v * 0.02) * near : 0);
    set(motorG, st.motor * 0.06 * near);
    motor.frequency.setTargetAtTime(50 + v * 9, A.ctx.currentTime, 0.05);
    motorF.frequency.setTargetAtTime(500 + v * 40, A.ctx.currentTime, 0.05);
    if (st.lift && v > 0.5) {
      chainPhase += v * dt / 0.55;
      if (chainPhase > 1) { chainPhase %= 1; click(0.22 * near); }
    }
  };

  A.beep = function (freq, dur, vol, type) {
    if (!A.ctx) return;
    const ctx = A.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = type || 'square'; o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol || 0.12, t + 0.01);
    g.gain.setValueAtTime(vol || 0.12, t + dur * 0.7); g.gain.linearRampToValueAtTime(0, t + dur);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 3000;
    o.connect(f); f.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02);
  };
  A.ui = function (kind) {
    if (!A.ctx) return;
    if (kind === 'move') A.beep(880, 0.04, 0.05, 'triangle');
    else if (kind === 'select') { A.beep(660, 0.06, 0.08, 'square'); setTimeout(() => A.beep(990, 0.09, 0.08, 'square'), 60); }
    else if (kind === 'back') A.beep(440, 0.08, 0.06, 'triangle');
  };
  A.countdown = function (n) { A.beep(n > 0 ? 660 : 1320, n > 0 ? 0.15 : 0.4, 0.12, 'square'); };
  A.fanfare = function () {
    duck(2.5);
    const notes = [523, 659, 784, 1047];
    notes.forEach((f, i) => setTimeout(() => A.beep(f, i === 3 ? 0.5 : 0.14, 0.11, 'square'), i * 140));
  };
  A.warn = function () { A.beep(1500, 0.06, 0.06, 'square'); };
  A.checkpoint = function () { A.beep(988, 0.08, 0.08, 'triangle'); setTimeout(() => A.beep(1319, 0.12, 0.08, 'triangle'), 80); };
  A.crash = function () {
    duck(2);
    if (!A.ctx) return;
    const ctx = A.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(3000, t); f.frequency.exponentialRampToValueAtTime(100, t + 1.2);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.7, t); g.gain.exponentialRampToValueAtTime(0.001, t + 1.4);
    src.connect(f); f.connect(g); g.connect(master); src.start(t); src.stop(t + 1.5);
  };

  window.AUDIO = A;
})();
